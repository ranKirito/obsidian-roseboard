import { applyEdit, History, type Edit, type Stamp } from '../domain/commands';
import { serialize, type Board } from '../domain/model';
import { diff, merge, resolve, type Change, type Overlap } from '../domain/merge';
import { findBlock, parseBoard, parseNote, replaceBlock } from './markdown';
export type SaveState = 'Saved locally' | 'Unsaved' | 'Saving' | 'Conflict' | 'Error';
export interface RecoveryDraft {
  path: string;
  baseline: string;
  board: Board;
  at: string;
}
export interface Storage {
  read(path: string): Promise<string>;
  process(path: string, transform: (current: string) => string): Promise<string>;
  sourceOpen(path: string): boolean;
  loadDraft(path: string): Promise<RecoveryDraft | undefined>;
  draft(path: string, draft: RecoveryDraft | null): Promise<void>;
  snapshot(draft: RecoveryDraft): Promise<void>;
  localCopy(board: Board): Promise<string>;
  /** Optional edit stamp for records changed by this device. */
  stamp?(): Stamp | undefined;
}
/** One batch of changes that arrived from outside this device or view. */
export interface Activity {
  at: number;
  by?: string;
  changes: Change[];
}
export interface SessionState {
  board?: Board;
  status: SaveState;
  issue: string;
  sourceOpen: boolean;
  revision: number;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel?: string;
  redoLabel?: string;
  /** Same-field edits from two sides, resolved automatically but still reviewable. */
  overlaps: Overlap[];
  /** Newest first, bounded. Never persisted. */
  activity: Activity[];
  /** Increments whenever remote changes are applied; `recent` lists the touched record IDs. */
  remoteRevision: number;
  recent: string[];
}
export const SAVE_DEBOUNCE_MS = 500;
export const SAVE_MAX_WAIT_MS = 2000;
export const DRAFT_DEBOUNCE_MS = 800;
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const sameBoard = (a: Board, b: Board) => a === b || serialize(a) === serialize(b);
export class BoardSession {
  private state: SessionState = {
    status: 'Saved locally',
    issue: '',
    sourceOpen: false,
    revision: 0,
    canUndo: false,
    canRedo: false,
    overlaps: [],
    activity: [],
    remoteRevision: 0,
    recent: [],
  };
  private listeners = new Set<() => void>();
  private history = new History();
  /** Raw fenced payload this device last loaded or wrote, and its parsed form for merging. */
  private baseline = '';
  private base?: Board;
  private dirty = false;
  private timer?: ReturnType<typeof setTimeout>;
  private firstPending = 0;
  private draftTimer?: ReturnType<typeof setTimeout>;
  private queue = Promise.resolve();
  private draftQueue = Promise.resolve();
  private disposed = false;
  private blocked = false;
  private revision = 0;
  private sourceWasOpen = false;
  constructor(
    public path: string,
    private storage: Storage,
  ) {}
  getSnapshot = (): SessionState => this.state;
  subscribe = (callback: () => void) => {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  };
  get subscriberCount() {
    return this.listeners.size;
  }
  get hasPendingEdits() {
    return this.dirty;
  }
  private publish(patch: Partial<SessionState> = {}) {
    const next = {
      ...this.state,
      ...patch,
      revision: this.revision,
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
      undoLabel: this.history.undoLabel,
      redoLabel: this.history.redoLabel,
    };
    if ((Object.keys(next) as (keyof SessionState)[]).every((key) => next[key] === this.state[key])) return;
    this.state = next;
    this.listeners.forEach((fn) => fn());
  }
  private serial(action: () => Promise<void>): Promise<void> {
    const result = this.queue.then(action);
    this.queue = result.catch(() => {});
    return result;
  }
  private recovery(): RecoveryDraft {
    return {
      path: this.path,
      baseline: this.baseline,
      board: this.state.board!,
      at: new Date().toISOString(),
    };
  }
  /** Writes the recovery draft now, in order with other draft operations. */
  private stashNow(): Promise<void> {
    clearTimeout(this.draftTimer);
    this.draftTimer = undefined;
    if (!this.dirty || !this.state.board) return this.draftQueue;
    const draft = this.recovery();
    const result = this.draftQueue.then(() => this.storage.draft(draft.path, draft));
    this.draftQueue = result.catch((e) => {
      this.publish({ status: 'Error', issue: `Recovery draft could not be saved: ${message(e)}` });
    });
    return result;
  }
  /** Debounced draft write: one file per burst of edits instead of one per keystroke. */
  private stash() {
    if (this.draftTimer) return;
    this.draftTimer = setTimeout(() => {
      this.draftTimer = undefined;
      void this.stashNow().catch(() => {});
    }, DRAFT_DEBOUNCE_MS);
  }
  private clearDraft(): Promise<void> {
    clearTimeout(this.draftTimer);
    this.draftTimer = undefined;
    // Keep draft operations ordered, including clear, so a newer edit cannot be erased.
    this.draftQueue = this.draftQueue.then(() => this.storage.draft(this.path, null));
    return this.draftQueue;
  }
  async initialize() {
    await this.reload(false);
    const draft = await this.storage.loadDraft(this.path);
    if (draft) {
      this.dirty = true;
      this.revision++;
      if (draft.baseline === this.baseline && !this.blocked)
        this.publish({ board: draft.board, status: 'Unsaved', issue: 'Recovered an unsaved local draft.' });
      else {
        let combined = false;
        if (this.state.board && this.base && !this.blocked)
          try {
            const result = merge(parseBoard(draft.baseline), draft.board, this.state.board);
            this.dirty = !sameBoard(result.board, this.state.board);
            this.publish({
              board: result.board,
              status: this.dirty ? 'Unsaved' : 'Saved locally',
              issue: 'Recovered an unsaved draft and combined it with newer source changes.',
              overlaps: result.overlaps,
            });
            combined = true;
          } catch {
            /* Fall through to the explicit conflict path. */
          }
        if (!combined) {
          this.blocked = true;
          this.publish({
            board: draft.board,
            status: 'Conflict',
            issue: 'Recovered local draft differs from the source. Save a local copy or preserve and reload.',
          });
        }
      }
    }
    this.sourceWasOpen = this.storage.sourceOpen(this.path);
    this.publish({ sourceOpen: this.sourceWasOpen });
    if (this.dirty && !this.blocked && !this.sourceWasOpen) this.schedule();
  }
  canEdit(): boolean {
    return (
      !!this.state.board &&
      !this.blocked &&
      !this.storage.sourceOpen(this.path) &&
      !this.state.sourceOpen &&
      !this.disposed
    );
  }
  edit(label: string, action: Edit, mergeKey = ''): void {
    if (!this.canEdit())
      throw new Error('Board writes are paused. Close source editing or resolve the recovery notice first.');
    const board = this.state.board!;
    const next = applyEdit(board, action, this.storage.stamp?.());
    if (next === board) return;
    this.history.record(board, label, mergeKey);
    this.changed(next);
  }
  undo = () => {
    if (!this.canEdit() || !this.history.canUndo) return;
    this.changed(this.history.undo(this.state.board!));
  };
  redo = () => {
    if (!this.canEdit() || !this.history.canRedo) return;
    this.changed(this.history.redo(this.state.board!));
  };
  /** Applies one side of a reported overlap and drops it from the review list. */
  resolveOverlap(overlap: Overlap, side: 'mine' | 'theirs' | 'keep') {
    const overlaps = this.state.overlaps.filter((o) => o !== overlap);
    if (side === 'keep' || side === overlap.chosen || !this.canEdit()) {
      this.publish({ overlaps });
      return;
    }
    const board = this.state.board!;
    const next = resolve(board, overlap, side);
    this.history.record(board, `Use ${side === 'mine' ? 'my' : 'their'} ${overlap.field}`);
    this.publish({ overlaps });
    this.changed(next);
  }
  clearOverlaps() {
    this.publish({ overlaps: [] });
  }
  private changed(board: Board) {
    this.dirty = true;
    this.revision++;
    this.publish({ board, status: 'Unsaved', issue: '' });
    this.stash();
    this.schedule();
  }
  private schedule() {
    const now = Date.now();
    if (!this.firstPending) this.firstPending = now;
    clearTimeout(this.timer);
    const wait = Math.max(0, Math.min(SAVE_DEBOUNCE_MS, this.firstPending + SAVE_MAX_WAIT_MS - now));
    this.timer = setTimeout(() => {
      void this.flush();
    }, wait);
  }
  /**
   * Replaces the loaded baseline with what another writer produced, carrying local work across.
   * `previous` is the board the local edits and history were built on; `theirs` is the new source.
   */
  private rebaseLocal(previous: Board, theirs: Board, raw: string, extra: Overlap[] = []) {
    const mine = this.state.board;
    const local = mine && mine !== previous && !sameBoard(mine, previous);
    const result = local ? merge(previous, mine, theirs) : undefined;
    const board = result?.board ?? theirs;
    this.base = theirs;
    this.baseline = raw;
    this.blocked = false;
    this.history.rebase((b) => (b === previous ? theirs : merge(previous, b, theirs).board));
    this.dirty = !sameBoard(board, theirs);
    this.revision++;
    const remote = result?.remote ?? diff(previous, theirs);
    const by = remote.map((c) => c.by).find(Boolean);
    const overlaps = [...this.state.overlaps, ...extra, ...(result?.overlaps ?? [])];
    this.publish({
      board,
      status: this.dirty ? 'Unsaved' : 'Saved locally',
      issue: '',
      overlaps,
      activity: remote.length
        ? [{ at: Date.now(), by, changes: remote }, ...this.state.activity].slice(0, 30)
        : this.state.activity,
      remoteRevision: this.state.remoteRevision + (remote.length ? 1 : 0),
      recent: remote.filter((c) => c.op !== 'removed').map((c) => c.id),
    });
    if (this.dirty) {
      this.stash();
      this.schedule();
    } else void this.clearDraft().catch(() => {});
  }
  async flush(): Promise<void> {
    clearTimeout(this.timer);
    this.firstPending = 0;
    return this.serial(async () => {
      if (!this.dirty || !this.state.board || this.blocked || this.disposed) return;
      if (this.storage.sourceOpen(this.path)) {
        this.publish({ sourceOpen: true, status: 'Unsaved' });
        await this.stashNow().catch(() => {});
        return;
      }
      const board = this.state.board,
        revision = this.revision,
        baseline = this.baseline,
        base = this.base;
      this.publish({ status: 'Saving' });
      let combined: { board: Board; overlaps: Overlap[] } | undefined;
      try {
        const saved = await this.storage.process(this.path, (current) => {
          if (this.storage.sourceOpen(this.path))
            throw new Error(
              'Source editor opened before saving. Local edits are preserved in a recovery draft.',
            );
          const block = findBlock(current);
          if (block.raw !== baseline) {
            // Another writer got here first. Combine both sets of changes inside the same transaction.
            let theirs: Board;
            try {
              theirs = parseBoard(block.raw);
            } catch (error) {
              throw new ConflictError(
                `The board changed outside this view and the new source is not valid: ${message(error)}`,
              );
            }
            if (!base) throw new ConflictError('The board changed outside this view while local edits were pending.');
            try {
              combined = merge(base, board, theirs);
            } catch (error) {
              throw new ConflictError(
                `The board changed outside this view and the changes could not be combined: ${message(error)}`,
              );
            }
            return replaceBlock(current, combined.board);
          }
          return replaceBlock(current, board);
        });
        const raw = findBlock(saved).raw;
        if (combined) {
          // The file now holds the merged board; carry any edits made during the write across it.
          this.rebaseLocal(board, combined.board, raw, combined.overlaps);
          return;
        }
        this.baseline = raw;
        this.base = board;
        if (revision === this.revision) {
          this.dirty = false;
          await this.clearDraft();
          this.publish({ status: 'Saved locally', issue: '' });
        } else {
          this.stash();
          this.publish({ status: 'Unsaved' });
          this.schedule();
        }
      } catch (error) {
        this.blocked = error instanceof ConflictError || !this.storage.sourceOpen(this.path);
        this.publish({
          status: error instanceof ConflictError ? 'Conflict' : 'Error',
          issue: message(error),
          sourceOpen: this.storage.sourceOpen(this.path),
        });
        await this.stashNow().catch(() => {});
      }
    });
  }
  async externalChange(): Promise<void> {
    return this.serial(async () => {
      try {
        const content = await this.storage.read(this.path);
        const block = findBlock(content);
        if (block.raw === this.baseline && !this.blocked) return;
        const { board: theirs, raw } = parseNote(content);
        if (this.dirty && this.state.board && this.base) {
          try {
            this.rebaseLocal(this.base, theirs, raw);
          } catch (error) {
            this.blocked = true;
            this.publish({
              status: 'Conflict',
              issue: `Source and local board both changed and could not be combined automatically (${message(error)}). Local work is preserved; save a local copy or preserve and reload.`,
            });
            await this.stashNow();
          }
          return;
        }
        const previous = this.base;
        if (previous) this.rebaseLocal(previous, theirs, raw);
        else {
          this.base = theirs;
          this.baseline = raw;
          this.blocked = false;
          this.history.clear();
          this.revision++;
          this.publish({ board: theirs, status: 'Saved locally', issue: '' });
        }
      } catch (error) {
        this.blocked = true;
        this.publish({
          status: 'Error',
          issue: `Source is not writable: ${message(error)}. Last valid display retained.`,
        });
      }
    });
  }
  async refreshSourceGuard() {
    const open = this.storage.sourceOpen(this.path),
      was = this.sourceWasOpen;
    this.sourceWasOpen = open;
    this.publish({ sourceOpen: open });
    if (open) {
      clearTimeout(this.timer);
      await this.stashNow().catch(() => {});
    } else if (was) {
      await this.externalChange();
      if (!this.blocked) {
        this.publish({ issue: '', status: this.dirty ? 'Unsaved' : 'Saved locally' });
        if (this.dirty) this.schedule();
      }
    }
  }
  async reload(preserve = true) {
    return this.serial(async () => {
      try {
        if (this.dirty && preserve) {
          await this.stashNow();
          await this.storage.snapshot(this.recovery());
        }
        const { board, raw } = parseNote(await this.storage.read(this.path));
        this.baseline = raw;
        this.base = board;
        this.dirty = false;
        this.blocked = false;
        this.history.clear();
        this.revision++;
        if (preserve) await this.clearDraft();
        this.publish({ board, status: 'Saved locally', issue: '', overlaps: [] });
      } catch (error) {
        this.blocked = true;
        this.publish({ status: 'Error', issue: message(error) });
      }
    });
  }
  async saveLocalCopy(): Promise<string> {
    if (!this.state.board)
      throw new Error('No validated board is available; use Export JSON for the raw payload.');
    await this.storage.snapshot(this.recovery());
    return this.storage.localCopy(this.state.board);
  }
  async prepareSource(): Promise<void> {
    await this.flush();
    if (this.dirty) await this.stashNow();
  }
  async rename(path: string) {
    await this.queue;
    await this.draftQueue;
    const oldPath = this.path;
    this.path = path;
    if (this.dirty) await this.stashNow();
    await this.storage.draft(oldPath, null);
    this.revision++;
    this.publish();
  }
  deleted() {
    clearTimeout(this.timer);
    this.blocked = true;
    this.publish({
      status: 'Error',
      issue: 'Source note was deleted. Save a local copy to recover this board.',
    });
    if (this.state.board) {
      this.dirty = true;
      void this.stashNow().catch(() => {});
    }
  }
  async close() {
    await this.flush();
    await this.stashNow().catch(() => {});
    clearTimeout(this.timer);
    clearTimeout(this.draftTimer);
    this.disposed = true;
    this.listeners.clear();
  }
}
export class ConflictError extends Error {}
