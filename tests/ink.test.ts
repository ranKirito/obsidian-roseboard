import { describe, it, expect } from 'vitest';
import { newBoard, newTask, validateBoard, serialize, canonical, inkOf, type Board } from '../src/domain/model';
import { applyEdit, addStroke, eraseStrokes, clearInk, History } from '../src/domain/commands';
import { diff, merge } from '../src/domain/merge';
import { parseBoard, parseNote, boardNote } from '../src/persistence/markdown';
import { simplify, strokePath, hitStroke, pairs, flatten, distanceToSegment, strokeBounds } from '../src/domain/ink';
function fixture(): Board {
  const b = newBoard('Ink');
  b.boardId = 'ink';
  b.timeZone = 'Europe/Ljubljana';
  b.tasks = { a: newTask('Alpha') };
  b.nodes = { na: { type: 'task', taskId: 'a', x: 0, y: 0, width: 300, height: 190 } };
  return validateBoard(b);
}
describe('ink schema and storage', () => {
  it('validates strokes with defaults and rejects malformed point lists', () => {
    const b = validateBoard({ ...fixture(), ink: { s1: { points: [0, 0, 10, 10] } } });
    expect(b.ink!.s1).toMatchObject({ points: [0, 0, 10, 10], color: 'ink', width: 3 });
    for (const bad of [{ points: [0, 0, 10] }, { points: [0, 0] }, { points: [0, 0, 1, 1], width: 0 }, { points: [0, 0, 1, 1], color: 'red' }])
      expect(() => validateBoard({ ...fixture(), ink: { s1: bad } })).toThrow();
  });
  it('keeps ink through Markdown round trips, sorts stroke keys, and omits an empty map', () => {
    const b = validateBoard({
      ...fixture(),
      ink: { zeta: { points: [1, 1, 2, 2], color: 'rose', width: 2, ext: true }, alpha: { points: [0, 0, 5, 5] } },
    });
    expect(Object.keys(canonical(b).ink!)).toEqual(['alpha', 'zeta']);
    const back = parseNote(boardNote(b)).board;
    expect(back.ink).toEqual(canonical(b).ink);
    expect(back.ink!.zeta).toMatchObject({ ext: true });
    expect(serialize({ ...b, ink: {} })).not.toContain('"ink":');
    expect(serialize(b)).toContain('"ink": {');
    expect(inkOf(fixture())).toEqual({});
  });
  it('is an unknown extension to a reader that ignores it, and survives that reader', () => {
    // A 1.0/1.1 reader treats `ink` as passthrough data; simulate by parsing, editing, serializing.
    const text = serialize(validateBoard({ ...fixture(), ink: { s: { points: [0, 0, 3, 3] } } }));
    const parsed = parseBoard(text) as Board & { ink?: unknown };
    const edited = applyEdit(parsed, (d) => {
      d.tasks.a!.title = 'Edited elsewhere';
    });
    expect(parseBoard(serialize(edited)).ink).toEqual(parsed.ink);
  });
});
describe('ink geometry', () => {
  it('measures distance to segments and stroke bounds', () => {
    expect(distanceToSegment(5, 5, 0, 0, 10, 0)).toBe(5);
    expect(distanceToSegment(-5, 0, 0, 0, 10, 0)).toBe(5);
    expect(strokeBounds([1, 2, 3, -4, -5, 6])).toEqual({ minX: -5, minY: -4, maxX: 3, maxY: 6 });
  });
  it('simplifies collinear noise but keeps corners', () => {
    const line = pairs([0, 0, 1, 0.01, 2, -0.01, 3, 0, 4, 0.02, 5, 0]);
    expect(simplify(line, 0.1)).toEqual([[0, 0], [5, 0]]);
    const corner = pairs([0, 0, 5, 0, 10, 0, 10, 5, 10, 10]);
    expect(simplify(corner, 0.1)).toEqual([[0, 0], [10, 0], [10, 10]]);
    expect(flatten(simplify(pairs([1, 1]), 1))).toEqual([1, 1]);
  });
  it('builds smoothed SVG paths and hit-tests the stroke body', () => {
    expect(strokePath(pairs([0, 0, 10, 0]))).toBe('M0 0L10 0');
    expect(strokePath(pairs([0, 0, 10, 0, 10, 10]))).toBe('M0 0Q10 0 10 5L10 10');
    expect(strokePath(pairs([3, 4]))).toMatch(/^M3 4l/);
    expect(hitStroke([0, 0, 100, 0], 4, 50, 5, 3)).toBe(true);
    expect(hitStroke([0, 0, 100, 0], 4, 50, 6, 3)).toBe(false);
    expect(hitStroke([0, 0], 4, 1, 1, 0)).toBe(true);
  });
});
describe('ink commands, undo and merge', () => {
  it('adds, erases and clears strokes as undoable edits with stamps', () => {
    const h = new History();
    const b0 = fixture();
    let id = '';
    const b1 = applyEdit(
      b0,
      (d) => {
        id = addStroke(d, { points: [0, 0, 20, 20], color: 'mint', width: 2 });
      },
      { at: '2026-09-18T12:00:00.000Z', by: 'Mac' },
    );
    h.record(b0, 'Draw');
    expect(b1.ink![id]).toMatchObject({ color: 'mint', updatedAt: '2026-09-18T12:00:00.000Z', updatedBy: 'Mac' });
    const b2 = applyEdit(b1, (d) => eraseStrokes(d, [id]));
    expect(b2.ink).toBeUndefined();
    expect(h.undo(b1)).toBe(b0);
    const b3 = applyEdit(b1, (d) => clearInk(d));
    expect(b3.ink).toBeUndefined();
    expect(b3.tasks).toBe(b1.tasks);
  });
  it('merges strokes drawn on two devices and honours erasures', () => {
    const base = validateBoard({ ...fixture(), ink: { old: { points: [0, 0, 1, 1] }, gone: { points: [2, 2, 3, 3] } } });
    const mine = structuredClone(base),
      theirs = structuredClone(base);
    mine.ink!.mineStroke = { points: [5, 5, 6, 6], color: 'rose', width: 3 };
    theirs.ink!.theirStroke = { points: [7, 7, 8, 8], color: 'sky', width: 3 };
    delete theirs.ink!.gone;
    const result = merge(base, mine, theirs);
    expect(Object.keys(result.board.ink!).sort()).toEqual(['mineStroke', 'old', 'theirStroke']);
    expect(result.overlaps).toEqual([]);
    expect(result.remote).toEqual([
      { kind: 'ink', id: 'gone', op: 'removed', fields: [], at: undefined, by: undefined },
      { kind: 'ink', id: 'theirStroke', op: 'added', fields: [], at: undefined, by: undefined },
    ]);
    const cleared = structuredClone(base);
    delete cleared.ink;
    expect(merge(base, mine, cleared).board.ink).toEqual({ mineStroke: mine.ink!.mineStroke });
    expect(diff(base, cleared).map((c) => c.id).sort()).toEqual(['gone', 'old']);
  });
});
