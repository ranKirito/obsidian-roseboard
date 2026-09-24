import {
  ItemView,
  Scope,
  MarkdownView,
  MarkdownRenderChild,
  Menu,
  Modal,
  Notice,
  Platform,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  FuzzySuggestModal,
  normalizePath,
  type WorkspaceLeaf,
  type ViewStateResult,
  type Modifier,
} from 'obsidian';
import { createRoot, type Root } from 'react-dom/client';
import { BoardApp } from './ui/Board';
import { BoardSession, type RecoveryDraft, type Storage } from './persistence/session';
import { NoteSession, type NoteDraft, type NoteStorage } from './persistence/note-session';
import { boardNote, findBlock, parseNote } from './persistence/markdown';
import { newBoard, serialize, validateBoard, vaultPath } from './domain/model';
import type { BoardHost, MenuItemSpec, Preferences } from './ui/ports';
const VIEW = 'roseboard-view';
interface Settings extends Preferences {
  defaultFolder: string;
  /** Name written into `updatedBy` on this device's edits. Empty disables attribution. */
  deviceName: string;
  /** Whether edits carry `updatedAt` stamps at all. */
  stamps: boolean;
}
const defaults: Settings = {
  minimap: false,
  snap: false,
  input: 'auto',
  culling: 'auto',
  defaultFolder: 'Boards',
  deviceName: '',
  stamps: true,
};
export default class RoseboardPlugin extends Plugin {
  settings: Settings = defaults;
  private sessions = new Map<string, Promise<BoardSession>>();
  private references = new Map<BoardSession, number>();
  private noteSessions = new Map<string, Promise<NoteSession>>();
  private notesListeners = new Set<() => void>();
  private recoveryQueue: Promise<void> = Promise.resolve();
  private stopped = false;
  async onload() {
    this.settings = { ...defaults, ...(await this.loadData()) };
    this.registerView(VIEW, (leaf) => new RoseboardView(leaf, this));
    this.registerMarkdownCodeBlockProcessor('roseboard', (_source, el, ctx) => {
      const child = new Preview(el, this, ctx.sourcePath);
      ctx.addChild(child);
    });
    this.addRibbonIcon('layout-dashboard', 'Open Roseboard', () => void this.chooseBoard());
    this.addCommand({ id: 'create-board', name: 'Create board', callback: () => void this.createBoard() });
    this.addCommand({ id: 'open-board', name: 'Open board', callback: () => void this.openActive() });
    this.addCommand({
      id: 'new-task',
      name: 'New task in the active board',
      checkCallback: (checking) => {
        const view = this.app.workspace.getActiveViewOfType(RoseboardView);
        if (!view?.session) return false;
        if (!checking) view.dispatch('createTask');
        return true;
      },
    });
    this.addCommand({
      id: 'open-source',
      name: 'Open source',
      callback: () => {
        const view = this.app.workspace.getActiveViewOfType(RoseboardView);
        if (view?.session) void this.openSource(view.session);
        else new Notice('Open a Roseboard first.');
      },
    });
    this.addCommand({
      id: 'validate-board',
      name: 'Validate board',
      callback: () => void this.validateActive(),
    });
    this.addCommand({
      id: 'export-json',
      name: 'Export JSON',
      callback: () => {
        const view = this.app.workspace.getActiveViewOfType(RoseboardView);
        const path = view?.session?.path ?? this.app.workspace.getActiveFile()?.path;
        if (path) void this.exportJSON(path, view?.session).catch(this.notice);
      },
    });
    this.addSettingTab(new RoseboardSettings(this.app, this));
    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        if (file instanceof TFile) void this.sessions.get(file.path)?.then((s) => s.externalChange());
      }),
    );
    this.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => {
        void this.handleRename(file.path, oldPath);
        this.notesChanged();
      }),
    );
    this.registerEvent(
      this.app.vault.on('delete', (file) => {
        for (const [path, promise] of this.sessions)
          if (path === file.path || path.startsWith(file.path + '/')) void promise.then((s) => s.deleted());
        this.notesChanged();
      }),
    );
    this.registerEvent(this.app.vault.on('create', () => this.notesChanged()));
    this.registerEvent(this.app.workspace.on('layout-change', () => this.refreshGuards()));
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.refreshGuards()));
    this.registerEvent(this.app.workspace.on('editor-change', () => this.refreshGuards()));
    this.registerDomEvent(document, 'visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.flushAll();
    });
    this.registerDomEvent(window, 'pagehide', () => this.flushAll());
    this.registerInterval(window.setInterval(() => this.refreshGuards(), 1000));
  }
  notice = (error: unknown) => {
    new Notice(error instanceof Error ? error.message : String(error), 7000);
  };
  private notesChanged() {
    this.notesListeners.forEach((fn) => fn());
  }
  private refreshGuards() {
    if (!this.stopped)
      for (const promise of this.sessions.values())
        void promise.then((s) => s.refreshSourceGuard()).catch(this.notice);
  }
  private flushAll() {
    for (const promise of this.sessions.values()) void promise.then((s) => s.flush()).catch(this.notice);
    for (const promise of this.noteSessions.values()) void promise.then((s) => s.stash()).catch(this.notice);
  }
  sourceOpen = (path: string) =>
    this.app.workspace
      .getLeavesOfType('markdown')
      .some(
        (leaf) =>
          leaf.view instanceof MarkdownView &&
          leaf.view.file?.path === path &&
          leaf.view.getMode() === 'source',
      );
  private file(path: string): TFile {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error(`Note missing: ${path}`);
    return file;
  }
  private get recoveryFolder() {
    return normalizePath(`${this.app.vault.configDir}/plugins/${this.manifest.id}/recovery`);
  }
  private async ensureFolder(path: string) {
    const segments = path.split('/');
    let current = '';
    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment;
      if (!(await this.app.vault.adapter.exists(current))) await this.app.vault.adapter.mkdir(current);
    }
  }
  private async recoveryKey(path: string) {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(path));
    return Array.from(new Uint8Array(bytes))
      .map((n) => n.toString(16).padStart(2, '0'))
      .join('');
  }
  private recoveryWrite(action: () => Promise<void>) {
    const next = this.recoveryQueue.then(action);
    this.recoveryQueue = next.catch(() => {});
    return next;
  }
  private storage: Storage = {
    read: async (path) => this.app.vault.read(this.file(path)),
    process: async (path, transform) => this.app.vault.process(this.file(path), transform),
    sourceOpen: (path) => this.sourceOpen(path),
    stamp: () =>
      this.settings.stamps
        ? { at: new Date().toISOString(), by: this.settings.deviceName.trim() || undefined }
        : undefined,
    loadDraft: async (path) => {
      const location = `${this.recoveryFolder}/draft-${await this.recoveryKey(path)}.json`;
      if (!(await this.app.vault.adapter.exists(location))) return undefined;
      const data = JSON.parse(await this.app.vault.adapter.read(location)) as RecoveryDraft;
      if (data.path !== path || typeof data.baseline !== 'string')
        throw new Error('Invalid recovery draft; original file left untouched.');
      data.board = validateBoard(data.board);
      return data;
    },
    draft: async (path, draft) =>
      this.recoveryWrite(async () => {
        const location = `${this.recoveryFolder}/draft-${await this.recoveryKey(path)}.json`;
        if (draft) {
          await this.ensureFolder(this.recoveryFolder);
          await this.app.vault.adapter.write(location, JSON.stringify(draft));
        } else if (await this.app.vault.adapter.exists(location))
          await this.app.vault.adapter.remove(location);
      }),
    snapshot: async (draft) =>
      this.recoveryWrite(async () => {
        await this.ensureFolder(this.recoveryFolder);
        await this.app.vault.adapter.write(
          `${this.recoveryFolder}/snapshot-${Date.now()}-${crypto.randomUUID()}.json`,
          JSON.stringify(draft, null, 2),
        );
        const list = await this.app.vault.adapter.list(this.recoveryFolder);
        const snapshots = list.files.filter((f) => f.split('/').pop()?.startsWith('snapshot-')).sort();
        for (const file of snapshots.slice(0, -10)) await this.app.vault.adapter.remove(file);
      }),
    localCopy: async (board) => {
      const path = await this.uniquePath(
        `${this.settings.defaultFolder}/${safeName(board.title)} - recovered`,
        'md',
      );
      await this.app.vault.create(path, boardNote(board));
      return path;
    },
  };
  private noteStorage: NoteStorage = {
    read: (path) => this.app.vault.read(this.file(path)),
    process: (path, transform) => this.app.vault.process(this.file(path), transform),
    sourceOpen: this.sourceOpen,
    loadDraft: async (path) => {
      await this.recoveryQueue;
      const location = `${this.recoveryFolder}/note-${await this.recoveryKey(path)}.json`;
      if (!(await this.app.vault.adapter.exists(location))) return undefined;
      const draft = JSON.parse(await this.app.vault.adapter.read(location)) as NoteDraft;
      if (draft.path !== path || typeof draft.baseline !== 'string' || typeof draft.text !== 'string')
        throw new Error('The note recovery draft could not be read. The original note was left untouched.');
      return draft;
    },
    draft: (path, draft) =>
      this.recoveryWrite(async () => {
        const location = `${this.recoveryFolder}/note-${await this.recoveryKey(path)}.json`;
        if (draft) {
          await this.ensureFolder(this.recoveryFolder);
          await this.app.vault.adapter.write(location, JSON.stringify(draft));
        } else if (await this.app.vault.adapter.exists(location))
          await this.app.vault.adapter.remove(location);
      }),
    copy: async (original, text) => {
      const path = await this.uniquePath(`${original.replace(/\.md$/i, '')} - recovered`, 'md');
      await this.app.vault.create(path, text);
      return path;
    },
  };
  private async editNote(path: string, sourcePath: string) {
    const target = this.resolveNote(path, sourcePath);
    if (!target || target.extension !== 'md') throw new Error('Choose an existing Markdown note to edit.');
    const key = target.path;
    const existing = this.noteSessions.get(key);
    const pending = existing
      ? existing.then((session) =>
          session.getSnapshot().status === 'Closed' ? NoteSession.open(key, this.noteStorage) : session,
        )
      : NoteSession.open(key, this.noteStorage);
    this.noteSessions.set(key, pending);
    void pending.catch(() => {
      if (this.noteSessions.get(key) === pending) this.noteSessions.delete(key);
    });
    return pending;
  }
  async acquire(path: string): Promise<BoardSession> {
    let promise = this.sessions.get(path);
    if (!promise) {
      promise = (async () => {
        const session = new BoardSession(path, this.storage);
        try {
          await session.initialize();
        } catch (e) {
          this.notice(e);
        }
        return session;
      })();
      this.sessions.set(path, promise);
    }
    const session = await promise;
    this.references.set(session, (this.references.get(session) ?? 0) + 1);
    return session;
  }
  async release(session: BoardSession) {
    const count = (this.references.get(session) ?? 1) - 1;
    if (count > 0) {
      this.references.set(session, count);
      return;
    }
    this.references.delete(session);
    await session.prepareSource().catch(this.notice);
    // Retain conflicted/dirty documents so reopening cannot lose recoverable in-memory work.
    if (!this.references.has(session) && !session.hasPendingEdits) {
      if (this.sessions.get(session.path)) this.sessions.delete(session.path);
      await session.close();
    }
  }
  showMenu(at: { x: number; y: number }, items: MenuItemSpec[]) {
    const menu = new Menu();
    for (const item of items) {
      if (item.separator) {
        menu.addSeparator();
        continue;
      }
      menu.addItem((entry) => {
        entry.setTitle(item.title);
        if (item.icon) entry.setIcon(item.icon);
        if (item.checked) entry.setChecked(true);
        if (item.disabled) entry.setDisabled(true);
        if (item.warning) entry.setWarning(true);
        if (item.label) entry.setIsLabel(true);
        if (item.action) entry.onClick(() => item.action!());
      });
    }
    menu.showAtPosition({ x: at.x, y: at.y });
  }
  host(session: BoardSession): BoardHost {
    return {
      session,
      openSource: () => this.openSource(session),
      exportJSON: () => this.exportJSON(session.path, session),
      openNote: (path, sourcePath = session.path) => {
        const target = this.resolveNote(path, sourcePath);
        if (!target) {
          new Notice(`Linked note is missing: ${path}`);
          return;
        }
        const hash = path.indexOf('#');
        void this.app.workspace.openLinkText(
          target.path + (hash < 0 ? '' : path.slice(hash)),
          sourcePath,
          true,
        );
      },
      noteExists: (path) => !!this.resolveNote(path, session.path),
      readNote: async (path) => {
        const target = this.resolveNote(path, session.path);
        if (!target) return undefined;
        if (target.extension !== 'md')
          throw new Error('Preview is available for Markdown notes. Open this file in Obsidian to view it.');
        const text = await this.app.vault.cachedRead(target);
        return { path: target.path, text: text.slice(0, 100000), truncated: text.length > 100000 };
      },
      editNote: (path) => this.editNote(path, session.path),
      subscribeNote: (path, callback) => {
        const vault = this.app.vault;
        let target = this.resolveNote(path, session.path);
        const refs = [
          vault.on('modify', (file) => {
            if (file === target) callback();
          }),
          vault.on('rename', () => {
            target = this.resolveNote(path, session.path);
            callback();
          }),
          vault.on('delete', (file) => {
            if (file === target) {
              target = null;
              callback();
            }
          }),
          vault.on('create', () => {
            if (!target) {
              target = this.resolveNote(path, session.path);
              callback();
            }
          }),
        ];
        return () => refs.forEach((ref) => vault.offref(ref));
      },
      pickNote: () =>
        new FilePicker(this.app, this.app.vault.getMarkdownFiles(), 'Choose a vault note').choose(),
      confirm: (title, description) => new ConfirmDialog(this.app, title, description).choose(),
      notify: this.notice,
      showMenu: (at, items) => this.showMenu(at, items),
      preferences: {
        minimap: this.settings.minimap,
        snap: this.settings.snap,
        input: this.settings.input,
        culling: this.settings.culling,
      },
      savePreferences: (prefs) => {
        Object.assign(this.settings, prefs);
        void this.saveData(this.settings);
      },
      subscribeNotes: (callback) => {
        this.notesListeners.add(callback);
        return () => {
          this.notesListeners.delete(callback);
        };
      },
      platform: { touch: Platform.isMobile, mac: Platform.isMacOS },
      deviceName: this.settings.stamps ? this.settings.deviceName.trim() : '',
    };
  }
  private resolveNote(path: string, source: string): TFile | null {
    const base = path.split('#')[0]!;
    if (!vaultPath.safeParse(base).success) return null;
    const exact = this.app.vault.getAbstractFileByPath(base);
    const target =
      this.app.metadataCache.getFirstLinkpathDest(base, source) ?? (exact instanceof TFile ? exact : null);
    return target && vaultPath.safeParse(target.path).success ? target : null;
  }
  private async handleRename(path: string, oldPath: string) {
    for (const [key, promise] of [...this.noteSessions]) {
      if (key === oldPath || key.startsWith(oldPath + '/')) {
        const updated = path + key.slice(oldPath.length);
        this.noteSessions.delete(key);
        const moved = promise.then(async (session) => {
          await session.rename(updated);
          return session;
        });
        this.noteSessions.set(updated, moved);
        void moved.catch(this.notice);
      }
    }
    for (const [key, promise] of [...this.sessions]) {
      const session = await promise;
      if (key === oldPath || key.startsWith(oldPath + '/')) {
        const updated = path + key.slice(oldPath.length);
        this.sessions.delete(key);
        this.sessions.set(updated, promise);
        await session.rename(updated);
      }
      const board = session.getSnapshot().board;
      if (!board) continue;
      const changed = (value: string) => value === oldPath || value.startsWith(oldPath + '/');
      const refs =
        Object.values(board.tasks).some((t) => t.notePath && changed(t.notePath)) ||
        Object.values(board.nodes).some((n) => n.type === 'note' && changed(n.notePath));
      if (refs && session.canEdit())
        session.edit('Update renamed note references', (b) => {
          for (const task of Object.values(b.tasks))
            if (task.notePath && changed(task.notePath))
              task.notePath = path + task.notePath.slice(oldPath.length);
          for (const node of Object.values(b.nodes))
            if (node.type === 'note' && changed(node.notePath))
              node.notePath = path + node.notePath.slice(oldPath.length);
        });
      else if (refs)
        new Notice(
          'A linked note was renamed while this board was read-only. Relink it with Choose note after resolving source editing or conflicts.',
        );
    }
    this.notesChanged();
  }
  async openBoard(path: string) {
    const file = this.file(path);
    if (file.extension !== 'md') throw new Error('Roseboard sources are Markdown notes.');
    const leaf = this.app.workspace.getLeaf('tab');
    await leaf.setViewState({ type: VIEW, state: { path }, active: true });
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
  }
  private async openActive() {
    const active = this.app.workspace.getActiveFile();
    if (active?.extension === 'md') {
      try {
        findBlock(await this.app.vault.read(active));
        await this.openBoard(active.path);
        return;
      } catch {
        /* Fall back to explicit board picker. */
      }
    }
    await this.chooseBoard();
  }
  private async chooseBoard() {
    const files: TFile[] = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      const text = await this.app.vault.cachedRead(file);
      if (/^ {0,3}(?:`{3,}|~{3,})roseboard\s*$/m.test(text)) files.push(file);
    }
    if (!files.length) {
      new Notice('No boards yet. Use Roseboard: Create board.');
      return;
    }
    const path = await new FilePicker(this.app, files, 'Open a Roseboard').choose();
    if (path) await this.openBoard(path);
  }
  private async uniquePath(stem: string, extension: string) {
    if (!vaultPath.safeParse(`${stem}.${extension}`).success)
      throw new Error('Choose a valid relative vault folder.');
    const folder = stem.slice(0, stem.lastIndexOf('/'));
    if (folder) await this.ensureFolder(folder);
    let path = `${stem}.${extension}`,
      n = 2;
    while (await this.app.vault.adapter.exists(path)) path = `${stem} ${n++}.${extension}`;
    return path;
  }
  private async createBoard() {
    const title = await new NameDialog(this.app).choose();
    if (!title) return;
    try {
      const path = await this.uniquePath(`${this.settings.defaultFolder}/${safeName(title)}`, 'md');
      await this.app.vault.create(path, boardNote(newBoard(title)));
      await this.openBoard(path);
    } catch (e) {
      this.notice(e);
    }
  }
  async openSource(session: BoardSession) {
    await session.prepareSource();
    const leaf = this.app.workspace.getLeaf('tab');
    await leaf.openFile(this.file(session.path), { state: { mode: 'source' } });
    await session.refreshSourceGuard();
  }
  async exportJSON(path: string, session?: BoardSession) {
    const board = session?.getSnapshot().board;
    const raw = board ? serialize(board) : findBlock(await this.app.vault.read(this.file(path))).raw;
    const exported = await this.uniquePath(
      `${this.settings.defaultFolder}/${safeName(board?.title ?? 'Roseboard')} - export`,
      'json',
    );
    await this.app.vault.create(exported, raw + '\n');
    new Notice(`JSON exported to ${exported}`);
  }
  private async validateActive() {
    const view = this.app.workspace.getActiveViewOfType(RoseboardView);
    const path = view?.session?.path ?? this.app.workspace.getActiveFile()?.path;
    if (!path) {
      new Notice('Open a board or its source note first.');
      return;
    }
    try {
      parseNote(await this.app.vault.read(this.file(path)));
      new Notice('Roseboard source is valid.');
    } catch (e) {
      this.notice(e);
    }
  }
  onunload() {
    this.stopped = true;
    this.flushAll();
    // Leaves are left in place so an update reopens them where the user had them.
    for (const promise of this.sessions.values()) void promise.then((s) => s.close()).catch(this.notice);
    this.notesListeners.clear();
  }
}
class RoseboardView extends ItemView {
  session?: BoardSession;
  private root?: Root;
  private path = '';
  private closed = false;
  constructor(
    leaf: WorkspaceLeaf,
    private plugin: RoseboardPlugin,
  ) {
    super(leaf);
    this.scope = new Scope(this.app.scope);
    const shortcut = (modifiers: Modifier[], key: string, action: string) =>
      this.scope!.register(modifiers, key, (event) => {
        const target = event.target as HTMLElement | null;
        if (
          !target ||
          !this.contentEl.contains(target) ||
          target.closest('input,textarea,select,[contenteditable="true"]') ||
          // Obsidian's scope runs before React: focused card content must keep text/scroll keys.
          (target.closest('.rb-task-body') && action !== 'undo' && action !== 'redo')
        )
          return;
        if (!this.dispatch(action)) return;
        event.preventDefault();
        event.stopPropagation();
        return false;
      });
    shortcut(['Mod'], 'z', 'undo');
    shortcut(['Mod', 'Shift'], 'z', 'redo');
    shortcut(['Mod'], 'd', 'duplicate');
    shortcut(['Mod'], 'a', 'selectAll');
    shortcut([], 'Delete', 'remove');
    shortcut([], 'Backspace', 'remove');
    // Obsidian's parent scope consumes Mod+Enter before a textarea's DOM handler sees it.
    this.scope.register(['Mod'], 'Enter', (event) => {
      const target = event.target as HTMLElement | null;
      if (!target || !this.contentEl.contains(target) || !target.matches('.rb-note-editor textarea')) return;
      target.dispatchEvent(new CustomEvent('roseboard-note-save'));
      event.preventDefault();
      event.stopPropagation();
      return false;
    });
  }
  /** Sends a named action to the mounted board; returns false when no board is mounted. */
  dispatch(action: string): boolean {
    const root = this.contentEl.querySelector('.roseboard-root');
    if (!root) return false;
    root.dispatchEvent(new CustomEvent('roseboard-shortcut', { detail: action }));
    return true;
  }
  getViewType() {
    return VIEW;
  }
  getDisplayText() {
    return this.session?.getSnapshot().board?.title ?? 'Roseboard';
  }
  getIcon() {
    return 'layout-dashboard';
  }
  getState() {
    return { path: this.session?.path ?? this.path };
  }
  async setState(state: { path?: string }, result: ViewStateResult) {
    if (state.path && state.path !== this.path) {
      this.path = state.path;
      await this.mount();
    }
    await super.setState(state, result);
  }
  async onOpen() {
    this.closed = false;
    this.contentEl.addClass('roseboard-view-content');
    if (this.path) await this.mount();
  }
  private async mount() {
    this.root?.unmount();
    if (this.session) await this.plugin.release(this.session);
    const session = await this.plugin.acquire(this.path);
    if (this.closed) {
      await this.plugin.release(session);
      return;
    }
    this.session = session;
    this.contentEl.empty();
    this.root = createRoot(this.contentEl);
    this.root.render(<BoardApp host={this.plugin.host(session)} />);
  }
  async onClose() {
    this.closed = true;
    this.root?.unmount();
    this.root = undefined;
    if (this.session) await this.plugin.release(this.session);
    this.session = undefined;
  }
}
class Preview extends MarkdownRenderChild {
  private root?: Root;
  private session?: BoardSession;
  private closed = false;
  constructor(
    el: HTMLElement,
    private plugin: RoseboardPlugin,
    private path: string,
  ) {
    super(el);
  }
  onload() {
    void this.mount().catch(this.plugin.notice);
  }
  private async mount() {
    const session = await this.plugin.acquire(this.path);
    if (this.closed) {
      await this.plugin.release(session);
      return;
    }
    this.session = session;
    this.containerEl.empty();
    this.containerEl.addClass('roseboard-preview-shell');
    const mount = this.containerEl.createDiv({ cls: 'roseboard-preview-mount' });
    this.root = createRoot(mount);
    this.root.render(<BoardApp host={this.plugin.host(session)} preview />);
    const button = this.containerEl.createEl('button', {
      text: 'Open board ↗',
      cls: 'roseboard-preview-open',
    });
    this.registerDomEvent(button, 'click', () => void this.plugin.openBoard(session.path));
  }
  onunload() {
    this.closed = true;
    this.root?.unmount();
    this.root = undefined;
    if (this.session) void this.plugin.release(this.session);
  }
}
class FilePicker extends FuzzySuggestModal<TFile> {
  private resolve?: (path: string | undefined) => void;
  private selected = false;
  constructor(
    app: Plugin['app'],
    private files: TFile[],
    placeholder: string,
  ) {
    super(app);
    this.setPlaceholder(placeholder);
  }
  getItems() {
    return this.files;
  }
  getItemText(file: TFile) {
    return file.path;
  }
  onChooseItem(file: TFile) {
    this.selected = true;
    this.resolve?.(file.path);
  }
  onClose() {
    setTimeout(() => {
      if (!this.selected) this.resolve?.(undefined);
    }, 0);
  }
  choose(): Promise<string | undefined> {
    return new Promise((resolve) => {
      this.resolve = resolve;
      this.open();
    });
  }
}
class ConfirmDialog extends Modal {
  private resolve?: (ok: boolean) => void;
  private result = false;
  constructor(
    app: Plugin['app'],
    private heading: string,
    private description: string,
  ) {
    super(app);
  }
  onOpen() {
    this.contentEl.addClass('roseboard-dialog');
    this.contentEl.createEl('h2', { text: this.heading });
    this.contentEl.createEl('p', { text: this.description });
    const actions = this.contentEl.createDiv({ cls: 'roseboard-dialog-actions' });
    const cancel = actions.createEl('button', { text: 'Cancel' });
    cancel.onclick = () => this.close();
    const yes = actions.createEl('button', { text: 'Continue', cls: 'mod-warning' });
    yes.onclick = () => {
      this.result = true;
      this.close();
    };
    cancel.focus();
  }
  onClose() {
    this.resolve?.(this.result);
    this.contentEl.empty();
  }
  choose(): Promise<boolean> {
    return new Promise((resolve) => {
      this.resolve = resolve;
      this.open();
    });
  }
}
class NameDialog extends Modal {
  private resolve?: (name: string | undefined) => void;
  private result?: string;
  onOpen() {
    this.contentEl.addClass('roseboard-dialog');
    this.contentEl.createEl('h2', { text: 'Create a Roseboard' });
    const input = this.contentEl.createEl('input', { type: 'text', placeholder: 'Weekly work' });
    input.setAttribute('aria-label', 'New board title');
    const submit = () => {
      if (input.value.trim()) {
        this.result = input.value.trim();
        this.close();
      }
    };
    input.onkeydown = (e) => {
      if (e.key === 'Enter') submit();
    };
    const button = this.contentEl.createEl('button', { text: 'Create board', cls: 'mod-cta' });
    button.onclick = submit;
    input.focus();
  }
  onClose() {
    this.resolve?.(this.result);
    this.contentEl.empty();
  }
  choose(): Promise<string | undefined> {
    return new Promise((resolve) => {
      this.resolve = resolve;
      this.open();
    });
  }
}
class RoseboardSettings extends PluginSettingTab {
  constructor(
    app: Plugin['app'],
    private plugin: RoseboardPlugin,
  ) {
    super(app, plugin);
  }
  display() {
    this.containerEl.empty();
    const save = () => this.plugin.saveData(this.plugin.settings);
    new Setting(this.containerEl)
      .setName('Device name')
      .setDesc(
        'Recorded on records you edit, for example “Anna · Laptop”. Other devices then see who changed what, and overlapping edits resolve by recency. Leave empty to stay anonymous.',
      )
      .addText((text) =>
        text
          .setPlaceholder('Anna · Laptop')
          .setValue(this.plugin.settings.deviceName)
          .onChange(async (value) => {
            this.plugin.settings.deviceName = value.slice(0, 100);
            await save();
          }),
      );
    new Setting(this.containerEl)
      .setName('Stamp edits with a time')
      .setDesc(
        'Writes updatedAt on tasks and cards you change. Needed for recency-based overlap resolution and the activity feed. Boards stay valid either way.',
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.stamps).onChange(async (value) => {
          this.plugin.settings.stamps = value;
          await save();
        }),
      );
    new Setting(this.containerEl).setName('Canvas').setHeading();
    new Setting(this.containerEl)
      .setName('Pointing device')
      .setDesc(
        'Trackpad: two-finger scroll pans, pinch zooms. Mouse: the wheel zooms, Shift+wheel pans sideways, drag empty space or middle-drag to pan. Auto watches how you scroll.',
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOptions({ auto: 'Auto-detect', trackpad: 'Trackpad', mouse: 'Mouse' })
          .setValue(this.plugin.settings.input)
          .onChange(async (value) => {
            this.plugin.settings.input = value as Settings['input'];
            await save();
          }),
      );
    new Setting(this.containerEl)
      .setName('Render only visible cards')
      .setDesc(
        'Skips cards outside the viewport. Helps large boards; automatic switches it on above 120 cards.',
      )
      .addDropdown((dropdown) =>
        dropdown
          .addOptions({ auto: 'Automatic', on: 'Always', off: 'Never' })
          .setValue(this.plugin.settings.culling)
          .onChange(async (value) => {
            this.plugin.settings.culling = value as Settings['culling'];
            await save();
          }),
      );
    new Setting(this.containerEl).setName('Files').setHeading();
    new Setting(this.containerEl)
      .setName('New boards and exports folder')
      .setDesc('A relative vault folder. Existing boards keep their current locations.')
      .addText((text) =>
        text.setValue(this.plugin.settings.defaultFolder).onChange(async (value) => {
          if (vaultPath.safeParse(value).success) {
            this.plugin.settings.defaultFolder = value;
            await save();
          }
        }),
      );
    this.containerEl.createEl('p', {
      cls: 'setting-item-description',
      text: 'Recovery drafts and the latest 10 recovery snapshots live in .obsidian/plugins/roseboard/recovery (or your configured Obsidian config folder). Saves are local; changes from other devices are merged into open boards when your sync plugin delivers them. This is not simultaneous conflict-free collaboration.',
    });
  }
}
function safeName(title: string) {
  return (
    title
      .replace(/[\\/:*?"<>|\x00-\x1f]/g, '-')
      .replace(/^\.+/, '')
      .trim()
      .slice(0, 100) || 'Board'
  );
}
