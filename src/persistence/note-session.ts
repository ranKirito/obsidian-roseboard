/** A note draft is separate from board history and never stored in the board's JSON. */
export interface NoteDraft {
  path: string;
  baseline: string;
  text: string;
}
export interface NoteStorage {
  read(path: string): Promise<string>;
  process(path: string, transform: (current: string) => string): Promise<string>;
  sourceOpen(path: string): boolean;
  loadDraft(path: string): Promise<NoteDraft | undefined>;
  draft(path: string, draft: NoteDraft | null): Promise<void>;
  copy(path: string, text: string): Promise<string>;
}
export interface NoteState extends NoteDraft {
  status: 'Editing' | 'Saving' | 'Closed';
  issue: string;
  recovered: boolean;
}
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const boardFence = /^ {0,3}(?:`{3,}|~{3,})roseboard\s*$/m;
export function assertEditableNote(text: string) {
  if (text.length > 100000)
    throw new Error('This note is too large for the card editor. Open it in Obsidian to edit the full file.');
  if (boardFence.test(text))
    throw new Error('This note contains a Roseboard. Use Open in Obsidian to edit its source.');
}
/** Shared by cards/views of the same note. Exact-baseline writes refuse concurrent replacements. */
export class NoteSession {
  private state: NoteState;
  private listeners = new Set<() => void>();
  private timer?: ReturnType<typeof setTimeout>;
  private queue = Promise.resolve();
  constructor(
    private storage: NoteStorage,
    draft: NoteDraft,
    recovered = false,
  ) {
    this.state = { ...draft, status: 'Editing', issue: '', recovered };
  }
  static async open(path: string, storage: NoteStorage) {
    if (storage.sourceOpen(path))
      throw new Error('Close this note’s source editor or switch it to Reading view before editing here.');
    const current = await storage.read(path);
    assertEditableNote(current);
    const draft = await storage.loadDraft(path);
    const session = new NoteSession(storage, draft ?? { path, baseline: current, text: current }, !!draft);
    if (draft && draft.baseline !== current)
      session.state.issue =
        'The note changed since this draft. Copy your draft or save it as a new note before starting again.';
    return session;
  }
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  private publish(patch: Partial<NoteState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }
  change = (text: string) => {
    if (this.state.status !== 'Editing') return;
    this.publish({ text });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.stash(), 400);
  };
  /** Flush on view close/unload as well as while typing; never implicitly commit to the source. */
  stash = () => {
    clearTimeout(this.timer);
    const { path, text, baseline } = this.state;
    const draft = this.state.status !== 'Closed' && text !== baseline ? { path, text, baseline } : null;
    const next = this.queue.then(() => this.storage.draft(path, draft));
    this.queue = next.catch((error) =>
      this.publish({ issue: `Could not keep a recovery draft: ${message(error)}` }),
    );
    return this.queue;
  };
  save = async () => {
    if (this.state.status !== 'Editing') return false;
    const { path, text, baseline } = this.state;
    this.publish({ status: 'Saving', issue: '' });
    try {
      assertEditableNote(text);
      await this.storage.process(path, (current) => {
        if (this.storage.sourceOpen(path))
          throw new Error(
            'This note is open in a source editor. Close it or switch it to Reading view, then save again.',
          );
        if (current !== baseline && current !== text)
          throw new Error(
            'This note changed elsewhere. Your draft is safe here; save a copy or discard it to read the latest version.',
          );
        return text;
      });
      this.publish({ baseline: text, status: 'Closed', recovered: false });
      await this.stash();
      return true;
    } catch (error) {
      this.publish({ status: 'Editing', issue: message(error) });
      await this.stash();
      return false;
    }
  };
  discard = async () => {
    if (this.state.status === 'Saving') return;
    this.publish({ text: this.state.baseline, status: 'Closed', issue: '', recovered: false });
    await this.stash();
  };
  rename = (path: string) => {
    const oldPath = this.state.path;
    this.publish({ path });
    clearTimeout(this.timer);
    const { text, baseline, status } = this.state;
    const draft = status !== 'Closed' && text !== baseline ? { path, text, baseline } : null;
    const next = this.queue.then(async () => {
      await this.storage.draft(path, draft);
      await this.storage.draft(oldPath, null);
    });
    this.queue = next.catch((error) => this.publish({ issue: message(error) }));
    return this.queue;
  };
  saveCopy = async () => this.storage.copy(this.state.path, this.state.text);
}
