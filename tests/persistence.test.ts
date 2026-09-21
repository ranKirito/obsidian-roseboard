import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BoardSession, type Storage, type RecoveryDraft } from '../src/persistence/session';
import { newBoard, newTask, type Board } from '../src/domain/model';
import { boardNote, parseNote, replaceBlock } from '../src/persistence/markdown';
import {
  NoteSession,
  assertEditableNote,
  type NoteDraft,
  type NoteStorage,
} from '../src/persistence/note-session';
let dir: string,
  storage: Storage,
  source = false,
  writes = 0,
  draftWrites = 0,
  drafts: Map<string, RecoveryDraft>,
  snapshots: RecoveryDraft[],
  sessions: BoardSession[];
const path = 'Board.md';
async function disk() {
  return readFile(join(dir, path), 'utf8');
}
async function external(change: (b: Board) => void) {
  const content = await disk();
  const b = parseNote(content).board;
  change(b);
  await writeFile(join(dir, path), replaceBlock(content, b));
}
async function open() {
  const s = new BoardSession(path, storage);
  await s.initialize();
  sessions.push(s);
  return s;
}
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'roseboard-unit-vault-'));
  source = false;
  writes = 0;
  draftWrites = 0;
  drafts = new Map();
  snapshots = [];
  sessions = [];
  const b = newBoard('Test');
  b.tasks.a = newTask('Alpha');
  b.tasks.b = newTask('Beta');
  b.nodes.a = { type: 'task', taskId: 'a', x: 42, y: 80, width: 300, height: 190 };
  await writeFile(join(dir, path), 'Before\n' + boardNote(b) + 'After\n');
  storage = {
    read: async (p) => readFile(join(dir, p), 'utf8'),
    process: async (p, fn) => {
      const next = fn(await readFile(join(dir, p), 'utf8'));
      writes++;
      await writeFile(join(dir, p), next);
      return next;
    },
    sourceOpen: () => source,
    loadDraft: async (p) => drafts.get(p),
    draft: async (p, d) => {
      if (d) {
        draftWrites++;
        drafts.set(p, d);
      } else drafts.delete(p);
    },
    snapshot: async (d) => {
      snapshots.push(d);
    },
    localCopy: async (b) => {
      await writeFile(join(dir, 'Recovery.md'), boardNote(b));
      return 'Recovery.md';
    },
  };
});
afterEach(async () => {
  for (const s of sessions) await s.close();
  await rm(dir, { recursive: true, force: true });
});
describe('persistence against temporary Markdown files', () => {
  it('create/edit/move/reopen preserves records and surrounding Markdown', async () => {
    const s = await open();
    s.edit('Edit', (b) => {
      b.tasks.a!.title = 'Edited';
      b.nodes.a!.x = 12000;
    });
    await s.flush();
    expect(s.getSnapshot().status).toBe('Saved locally');
    const reopened = await open();
    expect(reopened.getSnapshot().board!.tasks.a!.title).toBe('Edited');
    expect(reopened.getSnapshot().board!.nodes.a!.x).toBe(12000);
    expect((await disk()).startsWith('Before\n')).toBe(true);
    expect((await disk()).endsWith('After\n')).toBe(true);
  });
  it('does not write for subscription/view changes or camera state', async () => {
    const s = await open();
    const off = s.subscribe(() => {});
    await s.refreshSourceGuard();
    off();
    await s.flush();
    expect(writes).toBe(0);
    expect(s.subscriberCount).toBe(0);
  });
  it('debounces text edits and serializes concurrent flush requests', async () => {
    const s = await open();
    s.edit(
      'A',
      (b) => {
        b.title = 'one';
      },
      'title',
    );
    s.edit(
      'B',
      (b) => {
        b.title = 'two';
      },
      'title',
    );
    await Promise.all([s.flush(), s.flush(), s.flush()]);
    expect(writes).toBe(1);
    expect(parseNote(await disk()).board.title).toBe('two');
    s.undo();
    expect(s.getSnapshot().board!.title).toBe('Test');
  });
  it('writes one recovery draft per burst, and none when the save lands first', async () => {
    const s = await open();
    for (let i = 0; i < 5; i++)
      s.edit(
        'Type',
        (b) => {
          b.tasks.a!.description += 'x';
        },
        'desc',
      );
    await s.flush();
    expect(writes).toBe(1);
    expect(draftWrites).toBe(0);
    expect(drafts.has(path)).toBe(false);
    // While a save cannot complete, a burst of edits still produces a single draft file.
    storage.process = () => new Promise(() => {});
    for (let i = 0; i < 5; i++)
      s.edit(
        'Type',
        (b) => {
          b.title = `Pending ${i}`;
        },
        'title',
      );
    await new Promise((r) => setTimeout(r, 950));
    expect(draftWrites).toBe(1);
    expect(drafts.get(path)?.board.title).toBe('Pending 4');
    sessions.pop(); // The hung save would block close(); the temp directory is removed regardless.
  });
  it('stamps changed records with the storage stamp when one is configured', async () => {
    storage.stamp = () => ({ at: '2026-09-18T09:00:00.000Z', by: 'Anna · Laptop' });
    const s = await open();
    s.edit('Edit', (b) => {
      b.tasks.a!.title = 'Stamped';
    });
    await s.flush();
    const saved = parseNote(await disk()).board;
    expect(saved.tasks.a).toMatchObject({
      updatedAt: '2026-09-18T09:00:00.000Z',
      updatedBy: 'Anna · Laptop',
    });
    expect(saved.tasks.b!.updatedAt).toBeUndefined();
  });
  it('reloads external edits without changing stable IDs or coordinates and keeps local undo usable', async () => {
    const s = await open();
    s.edit('Local', (b) => {
      b.title = 'Saved local';
    });
    await s.flush();
    await external((b) => {
      b.tasks.new = newTask('Agent-added');
    });
    await s.externalChange();
    expect(s.getSnapshot().board!.nodes.a!.x).toBe(42);
    expect(s.getSnapshot().board!.tasks.new?.title).toBe('Agent-added');
    expect(s.getSnapshot().status).toBe('Saved locally');
    expect(s.getSnapshot().canUndo).toBe(true);
    s.undo();
    expect(s.getSnapshot().board!.title).toBe('Test');
    expect(s.getSnapshot().board!.tasks.new?.title).toBe('Agent-added');
    expect(s.getSnapshot().activity[0]!.changes).toEqual([
      { kind: 'task', id: 'new', op: 'added', fields: [], at: undefined, by: undefined },
    ]);
    expect(s.getSnapshot().recent).toEqual(['new']);
  });
  it('merges a concurrent external edit to another record instead of conflicting', async () => {
    const s = await open();
    s.edit('Local', (b) => {
      b.tasks.a!.title = 'Local edit';
    });
    await external((b) => {
      b.tasks.b!.status = 'done';
      b.tasks.b!.updatedBy = 'Friend · Phone';
    });
    await s.externalChange();
    expect(s.getSnapshot().status).toBe('Unsaved');
    expect(s.getSnapshot().overlaps).toEqual([]);
    expect(s.getSnapshot().activity[0]!.by).toBe('Friend · Phone');
    await s.flush();
    const saved = parseNote(await disk()).board;
    expect(saved.tasks.a!.title).toBe('Local edit');
    expect(saved.tasks.b!.status).toBe('done');
    expect(s.getSnapshot().status).toBe('Saved locally');
    expect(s.getSnapshot().canUndo).toBe(true);
    s.undo();
    expect(s.getSnapshot().board!.tasks.a!.title).toBe('Alpha');
    expect(s.getSnapshot().board!.tasks.b!.status).toBe('done');
  });
  it('merges at commit time when the file changed under a pending save', async () => {
    const s = await open();
    s.edit('Local', (b) => {
      b.tasks.a!.title = 'Local';
    });
    await external((b) => {
      b.tasks.c = newTask('Written elsewhere');
    });
    await s.flush();
    expect(s.getSnapshot().status).toBe('Saved locally');
    const saved = parseNote(await disk()).board;
    expect(saved.tasks.a!.title).toBe('Local');
    expect(saved.tasks.c!.title).toBe('Written elsewhere');
    expect(s.getSnapshot().board).toEqual(saved);
    expect(drafts.has(path)).toBe(false);
    await s.externalChange();
    expect(s.getSnapshot().activity).toHaveLength(1);
  });
  it('reports same-field overlaps, keeps local work, and can take the other side', async () => {
    const s = await open();
    s.edit('Local', (b) => {
      b.title = 'Local';
    });
    await external((b) => {
      b.title = 'External';
    });
    await s.flush();
    expect(s.getSnapshot().status).toBe('Saved locally');
    expect(parseNote(await disk()).board.title).toBe('Local');
    const overlap = s.getSnapshot().overlaps[0]!;
    expect(overlap).toMatchObject({
      kind: 'board',
      field: 'title',
      mine: 'Local',
      theirs: 'External',
      chosen: 'mine',
    });
    s.resolveOverlap(overlap, 'theirs');
    expect(s.getSnapshot().overlaps).toEqual([]);
    expect(s.getSnapshot().board!.title).toBe('External');
    await s.flush();
    expect(parseNote(await disk()).board.title).toBe('External');
    s.undo();
    expect(s.getSnapshot().board!.title).toBe('Local');
  });
  it('falls back to an explicit conflict when changes cannot be combined', async () => {
    const s = await open();
    s.edit('Local', (b) => {
      b.tasks.a!.dependsOn = ['b'];
    });
    await external((b) => {
      b.tasks.b!.dependsOn = ['a'];
    });
    await s.flush();
    expect(s.getSnapshot().status).toBe('Conflict');
    expect(s.getSnapshot().issue).toContain('cycle');
    expect(parseNote(await disk()).board.tasks.b!.dependsOn).toEqual(['a']);
    expect(drafts.get(path)?.board.tasks.a!.dependsOn).toEqual(['b']);
    const copy = await s.saveLocalCopy();
    expect(parseNote(await readFile(join(dir, copy), 'utf8')).board.tasks.a!.dependsOn).toEqual(['b']);
    expect(() =>
      s.edit('No', (b) => {
        b.title = 'No';
      }),
    ).toThrow();
    // A later external fix that removes the cycle lets the merge succeed and clears the conflict.
    await external((b) => {
      b.tasks.b!.dependsOn = [];
    });
    await s.externalChange();
    expect(s.getSnapshot().status).toBe('Unsaved');
    await s.flush();
    expect(parseNote(await disk()).board.tasks.a!.dependsOn).toEqual(['b']);
  });
  it('invalid JSON retains display and blocks autosave', async () => {
    const s = await open();
    const b = s.getSnapshot().board;
    await writeFile(join(dir, path), 'Before\n```roseboard\n{"partial":\n```\nAfter\n');
    await s.externalChange();
    expect(s.getSnapshot().board).toBe(b);
    expect(s.getSnapshot().status).toBe('Error');
    expect(() =>
      s.edit('Danger', (b) => {
        b.title = 'No';
      }),
    ).toThrow();
    await s.flush();
    expect(writes).toBe(0);
    expect(await disk()).toContain('{"partial":');
  });
  it('unsupported schema opens read-only without an empty replacement', async () => {
    await external((b) => {
      (b as { schemaVersion: number }).schemaVersion = 99;
    });
    const s = await open();
    expect(s.getSnapshot().board).toBeUndefined();
    expect(s.getSnapshot().issue).toContain('99');
    await s.flush();
    expect(writes).toBe(0);
  });
  it('preserves local work before reload and never discards if preservation fails', async () => {
    const s = await open();
    s.edit('Local', (b) => {
      b.tasks.a!.dependsOn = ['b'];
    });
    await external((b) => {
      b.tasks.b!.dependsOn = ['a'];
    });
    await s.externalChange();
    expect(s.getSnapshot().status).toBe('Conflict');
    storage.snapshot = async () => {
      throw Error('Disk full');
    };
    await s.reload(true);
    expect(s.getSnapshot().board!.tasks.a!.dependsOn).toEqual(['b']);
    storage.snapshot = async (d) => {
      snapshots.push(d);
    };
    await s.reload(true);
    expect(snapshots[0]!.board.tasks.a!.dependsOn).toEqual(['b']);
    expect(s.getSnapshot().board!.tasks.b!.dependsOn).toEqual(['a']);
    expect(s.getSnapshot().canUndo).toBe(false);
  });
  it('preserves concurrent changes to prose outside the block', async () => {
    const s = await open();
    s.edit('Local', (b) => {
      b.title = 'Changed';
    });
    await writeFile(join(dir, path), (await disk()).replace('Before', 'New surrounding prose'));
    await s.flush();
    expect(s.getSnapshot().status).toBe('Saved locally');
    expect(await disk()).toContain('New surrounding prose');
  });
  it('source editor suspension blocks new edits and pauses pending writes until revalidated', async () => {
    const s = await open();
    s.edit('Local', (b) => {
      b.title = 'Local';
    });
    source = true;
    await s.refreshSourceGuard();
    await s.flush();
    expect(writes).toBe(0);
    expect(drafts.get(path)?.board.title).toBe('Local');
    expect(() =>
      s.edit('No', (b) => {
        b.title = 'No';
      }),
    ).toThrow();
    source = false;
    await s.refreshSourceGuard();
    await s.flush();
    expect(parseNote(await disk()).board.title).toBe('Local');
  });
  it('source edits made during suspension are combined with local work after the editor closes', async () => {
    const s = await open();
    s.edit('Local', (b) => {
      b.title = 'Local';
    });
    source = true;
    await s.refreshSourceGuard();
    await external((b) => {
      b.tasks.b!.title = 'Edited in source';
    });
    source = false;
    await s.refreshSourceGuard();
    await s.flush();
    expect(s.getSnapshot().status).toBe('Saved locally');
    const saved = parseNote(await disk()).board;
    expect(saved.title).toBe('Local');
    expect(saved.tasks.b!.title).toBe('Edited in source');
  });
  it('source editor opening inside process cannot be overwritten', async () => {
    const s = await open();
    s.edit('Local', (b) => {
      b.title = 'Local';
    });
    const process = storage.process;
    storage.process = async (p, fn) => {
      source = true;
      return process(p, fn);
    };
    await s.flush();
    expect(writes).toBe(0);
    expect(s.getSnapshot().sourceOpen).toBe(true);
    expect(drafts.get(path)?.board.title).toBe('Local');
  });
  it('suppresses self reloads by payload identity and observes the next real change', async () => {
    const s = await open();
    s.edit('Local', (b) => {
      b.title = 'Local';
    });
    await s.flush();
    const revision = s.getSnapshot().revision;
    await s.externalChange();
    expect(s.getSnapshot().revision).toBe(revision);
    await external((b) => {
      b.title = 'Agent';
    });
    await s.externalChange();
    expect(s.getSnapshot().board!.title).toBe('Agent');
  });
  it('recovery draft on restart is combined with newer source, or conflicts if it cannot be', async () => {
    const s = await open();
    s.edit('Local', (b) => {
      b.title = 'Recovered';
    });
    source = true;
    await s.refreshSourceGuard();
    await external((b) => {
      b.tasks.b!.status = 'doing';
    });
    source = false;
    const restarted = await open();
    expect(restarted.getSnapshot().board!.title).toBe('Recovered');
    expect(restarted.getSnapshot().board!.tasks.b!.status).toBe('doing');
    expect(restarted.getSnapshot().status).toBe('Unsaved');
    expect(restarted.canEdit()).toBe(true);
    await restarted.flush();
    expect(parseNote(await disk()).board.title).toBe('Recovered');
    drafts.set(path, {
      path,
      baseline: 'not json',
      board: { ...restarted.getSnapshot().board!, title: 'Orphan draft' },
      at: new Date().toISOString(),
    });
    const conflicted = await open();
    expect(conflicted.getSnapshot().status).toBe('Conflict');
    expect(conflicted.getSnapshot().board!.title).toBe('Orphan draft');
    expect(conflicted.canEdit()).toBe(false);
  });
  it('two subscribers observe one canonical model and shared undo', async () => {
    const s = await open();
    let first = '',
      second = '';
    const a = s.subscribe(() => {
      first = s.getSnapshot().board!.title;
    });
    const b = s.subscribe(() => {
      second = s.getSnapshot().board!.title;
    });
    s.edit('View A', (d) => {
      d.title = 'Shared';
    });
    expect(first).toBe('Shared');
    expect(second).toBe('Shared');
    s.undo();
    expect(first).toBe('Test');
    expect(second).toBe('Test');
    a();
    b();
    expect(s.subscriberCount).toBe(0);
  });
  it('deletion preserves recoverable local copy', async () => {
    const s = await open();
    await rm(join(dir, path));
    s.deleted();
    expect(s.canEdit()).toBe(false);
    expect(await s.saveLocalCopy()).toBe('Recovery.md');
    expect(s.getSnapshot().issue).toContain('deleted');
  });
  it('tracks edits made while an earlier write is in flight', async () => {
    const s = await open();
    let unblock!: () => void;
    const wait = new Promise<void>((r) => {
      unblock = r;
    });
    const process = storage.process;
    storage.process = async (p, fn) => {
      await wait;
      return process(p, fn);
    };
    s.edit('First', (b) => {
      b.title = 'First';
    });
    const flush = s.flush();
    await new Promise((r) => setTimeout(r, 10));
    s.edit('Second', (b) => {
      b.title = 'Second';
    });
    unblock();
    await flush;
    expect(s.hasPendingEdits).toBe(true);
    await s.flush();
    expect(parseNote(await disk()).board.title).toBe('Second');
  });
  it('keeps edits made during a merging write on top of the merged result', async () => {
    const s = await open();
    let unblock!: () => void;
    const wait = new Promise<void>((r) => {
      unblock = r;
    });
    const process = storage.process;
    storage.process = async (p, fn) => {
      await wait;
      return process(p, fn);
    };
    s.edit('First', (b) => {
      b.tasks.a!.title = 'First';
    });
    await external((b) => {
      b.tasks.c = newTask('Remote');
    });
    const flush = s.flush();
    await new Promise((r) => setTimeout(r, 10));
    s.edit('Second', (b) => {
      b.tasks.b!.title = 'Second';
    });
    unblock();
    await flush;
    expect(s.getSnapshot().board!.tasks).toMatchObject({
      a: { title: 'First' },
      b: { title: 'Second' },
      c: { title: 'Remote' },
    });
    expect(s.hasPendingEdits).toBe(true);
    await s.flush();
    expect(parseNote(await disk()).board.tasks.b!.title).toBe('Second');
    expect(parseNote(await disk()).board.tasks.c!.title).toBe('Remote');
  });
});

describe('inline document editing', () => {
  function notes(initial = '---\ntags: [project]\n---\n# Original\n') {
    let text = initial,
      draft: NoteDraft | undefined,
      sourceOpen = false;
    const storage: NoteStorage = {
      read: async () => text,
      process: async (_path, transform) => {
        text = transform(text);
        return text;
      },
      sourceOpen: () => sourceOpen,
      loadDraft: async () => draft,
      draft: async (_path, next) => {
        draft = next ?? undefined;
      },
      copy: async () => 'Copy.md',
    };
    return {
      storage,
      text: () => text,
      draft: () => draft,
      external: (next: string) => {
        text = next;
      },
      source: () => {
        sourceOpen = true;
      },
    };
  }
  it('saves the full Markdown, including properties, without touching board data', async () => {
    const vault = notes();
    const session = await NoteSession.open('Note.md', vault.storage);
    const next = session.getSnapshot().text + '\nNew paragraph.\n';
    session.change(next);
    await session.stash();
    expect(vault.text()).not.toContain('New paragraph');
    expect(vault.draft()?.text).toBe(next);
    expect(await session.save()).toBe(true);
    expect(vault.text()).toBe(next);
    expect(vault.draft()).toBeUndefined();
  });
  it('refuses concurrent edits and restores the unsaved draft after reopening', async () => {
    const vault = notes();
    const session = await NoteSession.open('Note.md', vault.storage);
    session.change('# My draft\n');
    vault.external('# Collaborator\n');
    expect(await session.save()).toBe(false);
    expect(vault.text()).toBe('# Collaborator\n');
    const reopened = await NoteSession.open('Note.md', vault.storage);
    expect(reopened.getSnapshot().text).toBe('# My draft\n');
    expect(reopened.getSnapshot().recovered).toBe(true);
    expect(await reopened.saveCopy()).toBe('Copy.md');
    await reopened.discard();
    expect(vault.draft()).toBeUndefined();
    expect(vault.text()).toBe('# Collaborator\n');
  });
  it('refuses a source editor opened after editing starts', async () => {
    const vault = notes();
    const session = await NoteSession.open('Note.md', vault.storage);
    session.change('Draft');
    const process = vault.storage.process;
    vault.storage.process = async (path, transform) => {
      await Promise.resolve();
      vault.source();
      return process(path, transform);
    };
    expect(await session.save()).toBe(false);
    expect(vault.text()).toContain('# Original');
    expect(vault.draft()?.text).toBe('Draft');
  });
  it('never replaces board notes or saves truncated previews', async () => {
    expect(() => assertEditableNote('```roseboard\n{}\n```')).toThrow('Roseboard');
    expect(() => assertEditableNote('x'.repeat(100001))).toThrow('too large');
    const vault = notes();
    const session = await NoteSession.open('Note.md', vault.storage);
    session.change('~~~roseboard\n{}\n~~~');
    expect(await session.save()).toBe(false);
    expect(vault.text()).toContain('# Original');
    await session.discard();
  });
  it('retains edits when the underlying file cannot be written', async () => {
    const vault = notes();
    vault.storage.process = async () => {
      throw new Error('Note missing: Note.md');
    };
    const session = await NoteSession.open('Note.md', vault.storage);
    session.change('# Draft after deletion');
    expect(await session.save()).toBe(false);
    expect(vault.draft()?.text).toBe('# Draft after deletion');
  });
  it('serializes recovery writes so an older draft cannot reappear after save', async () => {
    const vault = notes();
    const writes: (NoteDraft | null)[] = [];
    vault.storage.draft = async (_path, draft) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      writes.push(draft);
    };
    const session = await NoteSession.open('Note.md', vault.storage);
    session.change('First');
    void session.stash();
    session.change('Second');
    void session.stash();
    await session.save();
    expect(vault.text()).toBe('Second');
    expect(writes.at(-1)).toBeNull();
  });
});
