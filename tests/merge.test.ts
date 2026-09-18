import { describe, it, expect } from 'vitest';
import { newBoard, newTask, validateBoard, serialize, canonical, addDays, type Board } from '../src/domain/model';
import { applyEdit, History, setDependency } from '../src/domain/commands';
import { diff, merge, resolve } from '../src/domain/merge';
import { parseBoard } from '../src/persistence/markdown';
function fixture(): Board {
  const b = newBoard('Shared');
  b.boardId = 'shared';
  b.timeZone = 'Europe/Ljubljana';
  b.tasks = {
    a: { ...newTask('Alpha'), tags: ['keep', 'drop'], checklist: [{ id: 'c1', text: 'one', done: false }] },
    b: newTask('Beta'),
    c: newTask('Gamma'),
  };
  b.nodes = {
    na: { type: 'task', taskId: 'a', x: 100, y: 100, width: 300, height: 190 },
    nb: { type: 'task', taskId: 'b', x: 500, y: 100, width: 300, height: 190 },
  };
  return validateBoard(b);
}
const clone = (b: Board): Board => structuredClone(b);
describe('three-way merge of concurrent board edits', () => {
  it('combines edits to different records without overlaps', () => {
    const base = fixture(),
      mine = clone(base),
      theirs = clone(base);
    mine.tasks.a!.title = 'Alpha edited here';
    theirs.tasks.b!.status = 'doing';
    theirs.nodes.nb!.x = 900;
    const result = merge(base, mine, theirs);
    expect(result.overlaps).toEqual([]);
    expect(result.board.tasks.a!.title).toBe('Alpha edited here');
    expect(result.board.tasks.b!.status).toBe('doing');
    expect(result.board.nodes.nb!.x).toBe(900);
    expect(result.remote.map((c) => `${c.kind}:${c.id}:${c.op}:${c.fields.join('+')}`)).toEqual([
      'task:b:changed:status',
      'node:nb:changed:position',
    ]);
  });
  it('keeps both sides when the same card moves on both devices and reports the overlap', () => {
    const base = fixture(),
      mine = clone(base),
      theirs = clone(base);
    Object.assign(mine.nodes.na!, { x: 10, y: 20 });
    Object.assign(theirs.nodes.na!, { x: 30, y: 40 });
    const result = merge(base, mine, theirs);
    expect(result.board.nodes.na).toMatchObject({ x: 10, y: 20 });
    expect(result.overlaps).toEqual([
      { kind: 'node', id: 'na', field: 'position', mine: { x: 10, y: 20 }, theirs: { x: 30, y: 40 }, chosen: 'mine' },
    ]);
    const taken = resolve(result.board, result.overlaps[0]!, 'theirs');
    expect(taken.nodes.na).toMatchObject({ x: 30, y: 40 });
  });
  it('lets the more recent stamp win when both sides changed one field', () => {
    const base = fixture(),
      mine = clone(base),
      theirs = clone(base);
    Object.assign(mine.tasks.a!, { title: 'Older local', updatedAt: '2026-09-18T10:00:00.000Z', updatedBy: 'Mac' });
    Object.assign(theirs.tasks.a!, { title: 'Newer remote', updatedAt: '2026-09-18T10:05:00.000Z', updatedBy: 'Phone' });
    const result = merge(base, mine, theirs);
    expect(result.board.tasks.a).toMatchObject({ title: 'Newer remote', updatedBy: 'Phone' });
    expect(result.overlaps[0]).toMatchObject({ field: 'title', chosen: 'theirs' });
    expect(resolve(result.board, result.overlaps[0]!, 'mine').tasks.a!.title).toBe('Older local');
  });
  it('keeps additions from both sides and removals that nobody edited', () => {
    const base = fixture(),
      mine = clone(base),
      theirs = clone(base);
    mine.tasks.d = newTask('Added here');
    theirs.tasks.e = newTask('Added there');
    delete theirs.tasks.c;
    const result = merge(base, mine, theirs);
    expect(Object.keys(result.board.tasks).sort()).toEqual(['a', 'b', 'd', 'e']);
    expect(result.overlaps).toEqual([]);
  });
  it('prefers keeping a record that one side edited while the other removed it', () => {
    const base = fixture(),
      mine = clone(base),
      theirs = clone(base);
    mine.tasks.c!.title = 'Edited here';
    delete theirs.tasks.c;
    const result = merge(base, mine, theirs);
    expect(result.board.tasks.c!.title).toBe('Edited here');
    expect(result.overlaps[0]).toMatchObject({ kind: 'task', id: 'c', field: 'removed', chosen: 'mine' });
    expect(resolve(result.board, result.overlaps[0]!, 'theirs').tasks.c).toBeUndefined();
  });
  it('repairs a prerequisite on a task the other side deleted', () => {
    const base = fixture(),
      mine = clone(base),
      theirs = clone(base);
    mine.tasks.b!.dependsOn = ['c'];
    delete theirs.tasks.c;
    const result = merge(base, mine, theirs);
    expect(result.board.tasks.b!.dependsOn).toEqual([]);
    expect(result.overlaps).toContainEqual({ kind: 'task', id: 'b', field: 'dependsOn', mine: ['c'], theirs: [], chosen: 'theirs' });
  });
  it('merges tags and prerequisites as sets and checklists by item ID', () => {
    const base = fixture(),
      mine = clone(base),
      theirs = clone(base);
    mine.tasks.a!.tags = ['keep', 'drop', 'mine'];
    theirs.tasks.a!.tags = ['keep', 'theirs'];
    mine.tasks.a!.checklist = [{ id: 'c1', text: 'one', done: true }];
    theirs.tasks.a!.checklist = [
      { id: 'c1', text: 'one renamed', done: false },
      { id: 'c2', text: 'two', done: false },
    ];
    const result = merge(base, mine, theirs);
    expect(result.board.tasks.a!.tags).toEqual(['keep', 'mine', 'theirs']);
    expect(result.board.tasks.a!.checklist).toEqual([
      { id: 'c1', text: 'one renamed', done: true },
      { id: 'c2', text: 'two', done: false },
    ]);
    expect(result.overlaps).toEqual([]);
  });
  it('resolves both devices placing the same task by keeping the already synced card', () => {
    const base = fixture(),
      mine = clone(base),
      theirs = clone(base);
    mine.nodes.mine = { type: 'task', taskId: 'c', x: 0, y: 0, width: 300, height: 190 };
    theirs.nodes.theirs = { type: 'task', taskId: 'c', x: 50, y: 50, width: 300, height: 190 };
    const result = merge(base, mine, theirs);
    expect(Object.keys(result.board.nodes).sort()).toEqual(['na', 'nb', 'theirs']);
    expect(result.overlaps[0]).toMatchObject({ kind: 'node', id: 'mine', field: 'duplicate placement', chosen: 'theirs' });
    const back = resolve(result.board, result.overlaps[0]!, 'mine');
    expect(Object.keys(back.nodes).sort()).toEqual(['mine', 'na', 'nb']);
  });
  it('refuses a combination that would create a dependency cycle', () => {
    const base = fixture(),
      mine = clone(base),
      theirs = clone(base);
    mine.tasks.a!.dependsOn = ['b'];
    theirs.tasks.b!.dependsOn = ['a'];
    expect(() => merge(base, mine, theirs)).toThrow('cycle');
  });
  it('preserves unknown extension fields and board-level edits', () => {
    const base = fixture(),
      mine = clone(base),
      theirs = clone(base);
    (mine as Record<string, unknown>).vendor = { keep: true };
    theirs.title = 'Renamed there';
    (theirs.tasks.a as Record<string, unknown>).ext = 1;
    const result = merge(base, mine, theirs);
    expect(result.board).toMatchObject({ title: 'Renamed there', vendor: { keep: true } });
    expect(result.board.tasks.a).toMatchObject({ ext: 1 });
  });
  it('diff lists additions, removals and grouped field changes', () => {
    const before = fixture(),
      after = clone(before);
    after.tasks.z = { ...newTask('New'), updatedBy: 'Phone' };
    delete after.tasks.c;
    Object.assign(after.nodes.na!, { x: 1, y: 2, width: 400 });
    after.tasks.a!.updatedAt = '2026-09-18T10:00:00Z';
    expect(diff(before, after)).toEqual([
      { kind: 'task', id: 'c', op: 'removed', fields: [], at: undefined, by: undefined },
      { kind: 'task', id: 'z', op: 'added', fields: [], at: undefined, by: 'Phone' },
      { kind: 'node', id: 'na', op: 'changed', fields: ['position', 'size'], at: undefined, by: undefined },
    ]);
  });
});
describe('stamps, canonical serialization and history rebasing', () => {
  it('stamps only the records an edit changed', () => {
    const b = fixture();
    const next = applyEdit(
      b,
      (d) => {
        d.tasks.a!.title = 'Stamped';
        d.nodes.nb!.x = 700;
      },
      { at: '2026-09-18T12:00:00.000Z', by: 'Mac' },
    );
    expect(next.tasks.a).toMatchObject({ updatedAt: '2026-09-18T12:00:00.000Z', updatedBy: 'Mac' });
    expect(next.nodes.nb).toMatchObject({ updatedAt: '2026-09-18T12:00:00.000Z' });
    expect(next.tasks.b!.updatedAt).toBeUndefined();
    expect(next.nodes.na!.updatedAt).toBeUndefined();
    expect(() => validateBoard({ ...b, tasks: { a: { title: 'x', updatedAt: 'yesterday' } } })).toThrow();
  });
  it('serializes records in a stable key order and round-trips exactly', () => {
    const b = fixture();
    const reordered = { ...b, tasks: { c: b.tasks.c!, a: b.tasks.a!, b: b.tasks.b! } } as Board;
    expect(serialize(reordered)).toBe(serialize(b));
    expect(Object.keys(canonical(reordered).tasks)).toEqual(['a', 'b', 'c']);
    expect(parseBoard(serialize(reordered))).toEqual(canonical(b));
    expect(serialize(b)).toContain('\n  "tasks": {\n    "a": {');
  });
  it('rebases undo history across merged remote changes and drops what cannot be rebased', () => {
    const base = fixture();
    const h = new History();
    h.record(base, 'Edit');
    const local = applyEdit(base, (d) => {
      d.tasks.a!.title = 'Local title';
    });
    const remote = clone(base);
    remote.tasks.b!.status = 'done';
    h.rebase((b) => merge(base, b, remote).board);
    const undone = h.undo(merge(base, local, remote).board);
    expect(undone.tasks.a!.title).toBe('Alpha');
    expect(undone.tasks.b!.status).toBe('done');
    h.record(base, 'Older');
    h.record(local, 'Newer');
    h.rebase((b) => {
      if (b === base) throw new Error('cannot');
      return b;
    });
    expect(h.canUndo).toBe(true);
    expect(h.undoLabel).toBe('Newer');
    expect(h.undo(local)).toBe(local);
    expect(h.canUndo).toBe(false);
  });
  it('adds whole days to date-only deadlines without UTC drift', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2026-12-31', 7)).toBe('2027-01-07');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  });
  it('rejects a self-dependency through setDependency at validation', () => {
    expect(() => applyEdit(fixture(), (d) => setDependency(d, 'a', 'a'))).toThrow();
  });
});
