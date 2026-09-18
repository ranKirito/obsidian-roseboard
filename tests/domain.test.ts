import { describe, it, expect } from 'vitest';
import {
  newBoard,
  newTask,
  validateBoard,
  blocked,
  overdue,
  localDate,
  matches,
  emptyFilters,
  UnsupportedVersion,
  vaultPath,
} from '../src/domain/model';
import {
  applyEdit,
  deleteTask,
  duplicate,
  moveNodes,
  placeAll,
  removePlacements,
  setDependency,
  History,
} from '../src/domain/commands';
import { boardNote, findBlock, parseNote, replaceBlock } from '../src/persistence/markdown';
function fixture() {
  const b = newBoard('Test');
  b.boardId = 'test';
  b.timeZone = 'Europe/Ljubljana';
  b.tasks = { a: newTask('Alpha'), b: newTask('Beta') };
  b.nodes = {
    na: { type: 'task', taskId: 'a', x: 100, y: 120, width: 300, height: 190 },
    nb: { type: 'task', taskId: 'b', x: 500, y: 120, width: 300, height: 190 },
  };
  return b;
}
describe('schema and safe round trips', () => {
  it('documents defaults while retaining IDs and extensions at every level', () => {
    const b = validateBoard({
      schemaVersion: 1,
      boardId: 'agent',
      title: 'AI board',
      extension: { version: 99 },
      tasks: {
        a: { title: 'AI task', vendor: { score: 9 }, checklist: [{ id: 'check', text: 'item', ext: 2 }] },
      },
      nodes: { node: { type: 'task', taskId: 'a', x: 12345, y: -12345, vendor: 7 } },
      edges: { edge: { source: 'node', target: 'node', ext: 8 } },
    });
    expect(b.tasks.a).toMatchObject({
      status: 'todo',
      priority: 'none',
      description: '',
      tags: [],
      dependsOn: [],
      vendor: { score: 9 },
    });
    expect(b.nodes.node).toMatchObject({ x: 12345, y: -12345, width: 300 });
    expect(parseNote(boardNote(b)).board).toEqual(b);
  });
  it('rejects unsupported versions without converting', () => {
    expect(() => validateBoard({ ...fixture(), schemaVersion: 2 })).toThrow(UnsupportedVersion);
  });
  it('rejects invalid shapes, positions and missing references', () => {
    for (const patch of [
      { tasks: { a: { title: 'A', status: 'waiting' } } },
      { nodes: { n: { type: 'task', taskId: 'missing', x: 0, y: 0 } } },
      { nodes: { n: { type: 'sticky', x: Infinity, y: 0 } } },
      { edges: { e: { source: 'na', target: 'absent' } } },
    ])
      expect(() => validateBoard({ ...fixture(), ...patch })).toThrow();
  });
  it('rejects duplicate placements and checklist IDs', () => {
    const b = fixture();
    b.nodes.copy = { ...b.nodes.na! };
    expect(() => validateBoard(b)).toThrow('already has a placement');
    delete b.nodes.copy;
    b.tasks.a!.checklist = [
      { id: 'same', text: 'a', done: false },
      { id: 'same', text: 'b', done: false },
    ];
    expect(() => validateBoard(b)).toThrow('duplicate checklist');
  });
  it('preserves all surrounding bytes, CRLF and long fences', () => {
    const b = fixture();
    const raw =
      '---\r\nfoo: bar\r\n---\r\n\r\n~~~roseboard\r\n' + JSON.stringify(b) + '\r\n~~~\r\nAFTER  \r\n';
    const block = findBlock(raw);
    const next = replaceBlock(raw, { ...b, title: 'Changed' });
    expect(next.slice(0, block.start)).toBe(raw.slice(0, block.start));
    expect(next.endsWith(raw.slice(block.end))).toBe(true);
    expect(next).not.toMatch(/(?<!\r)\n/);
  });
  it('ignores roseboard fences nested inside other fences', () => {
    const b = fixture();
    const note = '````markdown\n```roseboard\nnot a board\n```\n````\n' + boardNote(b);
    expect(parseNote(note).board).toEqual(b);
  });
  it('rejects zero, multiple and unfinished blocks and partial JSON', () => {
    for (const source of [
      '',
      boardNote(fixture()) + boardNote(fixture()),
      '```roseboard\n{}',
      '```roseboard\n{\n```',
    ])
      expect(() => parseNote(source)).toThrow();
  });
  it('blocks non-vault paths and permits spaces/unicode', () => {
    for (const p of [
      '../secrets',
      '/etc/passwd',
      'https://x',
      'javascript:alert(1)',
      'a/../../b',
      'a\\b',
      '.obsidian/config',
      'a//b',
    ])
      expect(vaultPath.safeParse(p).success).toBe(false);
    expect(vaultPath.safeParse('Notes/Življenje.md').success).toBe(true);
  });
});
describe('task graph, dates and filters', () => {
  it('rejects missing, self and cyclic prerequisites', () => {
    const b = fixture();
    for (const deps of [['missing'], ['a']]) {
      b.tasks.a!.dependsOn = deps;
      expect(() => validateBoard(b)).toThrow();
    }
    b.tasks.a!.dependsOn = ['b'];
    b.tasks.b!.dependsOn = ['a'];
    expect(() => validateBoard(b)).toThrow('cycle');
  });
  it('derives blockage and keeps relationships independent', () => {
    let b = fixture();
    b = applyEdit(b, (d) => setDependency(d, 'a', 'b'));
    expect(blocked(b.tasks.b!, b)).toBe(true);
    expect(b.edges).toEqual({});
    b = applyEdit(b, (d) => {
      d.tasks.a!.status = 'done';
    });
    expect(blocked(b.tasks.b!, b)).toBe(false);
  });
  it('validates real calendar days, including leap years', () => {
    const b = fixture();
    for (const date of ['2026-02-29', '2026-13-01', '2026-04-31', '2026-9-01', '2026-09-16T00:00:00Z']) {
      b.tasks.a!.dueDate = date;
      expect(() => validateBoard(b)).toThrow();
    }
    b.tasks.a!.dueDate = '2028-02-29';
    expect(validateBoard(b).tasks.a!.dueDate).toBe('2028-02-29');
  });
  it('uses the board calendar day on both sides of UTC and DST', () => {
    const now = new Date('2026-09-16T00:30:00Z');
    expect(localDate('America/Los_Angeles', now)).toBe('2026-09-15');
    expect(localDate('Europe/Ljubljana', now)).toBe('2026-09-16');
    expect(localDate('Europe/Ljubljana', new Date('2026-03-28T23:30:00Z'))).toBe('2026-03-29');
  });
  it('keeps Today separate from Overdue and excludes done from overdue/ready', () => {
    const b = fixture();
    b.tasks.a!.dueDate = '2026-09-15';
    expect(overdue(b.tasks.a!, '2026-09-16')).toBe(true);
    expect(matches(b.tasks.a!, b, { ...emptyFilters, preset: 'today' }, '2026-09-16')).toBe(false);
    b.tasks.a!.status = 'done';
    expect(overdue(b.tasks.a!, '2026-09-16')).toBe(false);
    expect(matches(b.tasks.a!, b, { ...emptyFilters, preset: 'ready' })).toBe(false);
  });
  it('searches descriptions and tags without moving cards', () => {
    const b = fixture();
    b.tasks.a!.description = 'A useful experiment';
    b.tasks.a!.tags = ['science'];
    const positions = JSON.stringify(b.nodes);
    expect(matches(b.tasks.a!, b, { ...emptyFilters, search: 'EXPERIMENT' })).toBe(true);
    expect(matches(b.tasks.a!, b, { ...emptyFilters, tag: 'science', status: 'todo' })).toBe(true);
    expect(JSON.stringify(b.nodes)).toBe(positions);
  });
});
describe('commands and undo', () => {
  it('removing a card preserves its task and dependencies', () => {
    const b = applyEdit(fixture(), (d) => {
      setDependency(d, 'a', 'b');
      removePlacements(d, ['na']);
    });
    expect(b.tasks.a).toBeDefined();
    expect(b.tasks.b!.dependsOn).toEqual(['a']);
    expect(b.nodes.na).toBeUndefined();
  });
  it('deleting a task removes placements and incoming dependencies and is undoable', () => {
    const b = applyEdit(fixture(), (d) => setDependency(d, 'a', 'b'));
    const history = new History();
    history.record(b, 'Delete');
    const next = applyEdit(b, (d) => deleteTask(d, 'a'));
    expect(next.tasks.a).toBeUndefined();
    expect(next.tasks.b!.dependsOn).toEqual([]);
    expect(history.undo(next)).toBe(b);
  });
  it('duplicates with independent task/node/checklist IDs and extension fields', () => {
    const b = fixture();
    b.tasks.a!.checklist = [{ id: 'c', text: 'item', done: false }];
    b.tasks.a!.custom = 99;
    let ids: string[] = [];
    const n = applyEdit(b, (d) => {
      ids = duplicate(d, ['na']);
    });
    const node = n.nodes[ids[0]!]!;
    expect(node.type).toBe('task');
    if (node.type !== 'task') throw Error();
    expect(node.taskId).not.toBe('a');
    expect(n.tasks[node.taskId]?.custom).toBe(99);
    expect(n.tasks[node.taskId]?.checklist[0]?.id).not.toBe('c');
    expect(n.tasks.a).toBe(b.tasks.a);
  });
  it('moves frame members once even with mixed selection and ungroups on frame delete', () => {
    const b = fixture();
    b.nodes.f = { type: 'frame', title: 'Group', x: 0, y: 0, width: 1000, height: 500 };
    b.nodes.na!.frameId = 'f';
    b.nodes.nb!.frameId = 'f';
    const moved = applyEdit(b, (d) => moveNodes(d, { f: { x: 100, y: 200 }, na: { x: 200, y: 320 } }));
    expect(moved.nodes.na).toMatchObject({ x: 200, y: 320 });
    expect(moved.nodes.nb).toMatchObject({ x: 600, y: 320 });
    const removed = applyEdit(moved, (d) => removePlacements(d, ['f']));
    expect(removed.nodes.na!.frameId).toBeUndefined();
    expect(Object.keys(removed.tasks)).toHaveLength(2);
  });
  it('rejects nested frames', () => {
    const b = fixture();
    b.nodes.f = { type: 'frame', title: 'f', x: 0, y: 0, width: 300, height: 200, frameId: 'f' };
    expect(() => validateBoard(b)).toThrow('frames may not nest');
  });
  it('places unplaced tasks in a new area without moving existing cards', () => {
    const b = fixture();
    b.tasks.c = newTask('Unplaced');
    const n = applyEdit(b, (d) => {
      placeAll(d);
    });
    expect(n.nodes.na).toBe(b.nodes.na);
    expect(n.nodes.nb).toBe(b.nodes.nb);
    const placed = Object.values(n.nodes).find((n) => n.type === 'task' && n.taskId === 'c')!;
    expect(placed.y).toBeGreaterThan(310);
  });
  it('undo/redo groups text changes but one completed move is one command', () => {
    const h = new History();
    const b = fixture();
    h.record(b, 'Move');
    const n = applyEdit(b, (d) => moveNodes(d, { na: { x: 10000, y: 10000 } }));
    expect(h.undo(n)).toEqual(b);
    expect(h.redo(b)).toEqual(n);
    h.clear();
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
  });
  it('does not commit a rejected command', () => {
    const b = fixture();
    expect(() => applyEdit(b, (d) => setDependency(d, 'a', 'a'))).toThrow();
    expect(b.tasks.a!.dependsOn).toEqual([]);
  });
});
