import { describe, expect, it } from 'vitest';
import {
  ROUTINE_HISTORY,
  addDays,
  newBoard,
  serialize,
  validateBoard,
  type Board,
} from '../src/domain/model';
import { addRoutine, applyEdit, moveRoutine, removeRoutine, toggleRoutine } from '../src/domain/commands';
import { isoWeekday, repeatLabel, routinesOn, streak, weekOf } from '../src/domain/planner';
import { merge, resolve } from '../src/domain/merge';

// 2026-09-21 is a Monday.
const monday = '2026-09-21';
function fixture(): Board {
  const b = newBoard('Rhythm');
  b.boardId = 'rhythm';
  b.timeZone = 'Europe/Ljubljana';
  b.routines = {
    water: { title: 'Water the plants', days: [1, 2, 3, 4, 5, 6, 7], done: [], order: 1 },
    gym: { title: 'Gym', days: [1, 3, 5], done: [], order: 2 },
  };
  return validateBoard(b);
}
describe('routines', () => {
  it('are optional, omitted when empty, and keep unknown fields', () => {
    const empty = newBoard('No routines');
    expect(empty.routines).toBeUndefined();
    expect(serialize(empty)).not.toContain('"routines"');
    const b = validateBoard({ ...fixture(), routines: { x: { title: 'Stretch', vendor: 1 } } });
    expect(b.routines!.x).toMatchObject({
      title: 'Stretch',
      days: [1, 2, 3, 4, 5, 6, 7],
      done: [],
      vendor: 1,
    });
    expect(() => validateBoard({ ...b, routines: { x: { title: 'Bad', days: [0] } } })).toThrow();
    expect(() => validateBoard({ ...b, routines: { x: { title: 'Bad', done: ['2026-02-30'] } } })).toThrow();
    const cleared = applyEdit(b, (d) => removeRoutine(d, 'x'));
    expect(cleared.routines).toBeUndefined();
  });
  it('schedule by ISO weekday and build Monday-first weeks', () => {
    expect(isoWeekday(monday)).toBe(1);
    expect(isoWeekday(addDays(monday, 6))).toBe(7);
    expect(weekOf('2026-09-24')).toEqual(Array.from({ length: 7 }, (_, i) => addDays(monday, i)));
    const b = fixture();
    expect(routinesOn(b, monday).map(([id]) => id)).toEqual(['water', 'gym']);
    expect(routinesOn(b, addDays(monday, 1)).map(([id]) => id)).toEqual(['water']);
    expect(repeatLabel([1, 2, 3, 4, 5])).toBe('Weekdays');
    expect(repeatLabel([3, 1, 5])).toBe('Mon · Wed · Fri');
  });
  it('toggles completion per day as a stamped, undoable record edit with bounded history', () => {
    const b = fixture();
    const done = applyEdit(b, (d) => toggleRoutine(d, 'water', monday), { at: '2026-09-21T08:00:00+02:00' });
    expect(done.routines!.water!.done).toEqual([monday]);
    expect(done.routines!.water!.updatedAt).toBe('2026-09-21T08:00:00+02:00');
    expect(done.routines!.gym).toBe(b.routines!.gym);
    expect(applyEdit(done, (d) => toggleRoutine(d, 'water', monday)).routines!.water!.done).toEqual([]);
    let long = b;
    for (let i = 0; i < ROUTINE_HISTORY + 5; i++)
      long = applyEdit(long, (d) => toggleRoutine(d, 'water', addDays(monday, -i)));
    expect(long.routines!.water!.done).toHaveLength(ROUTINE_HISTORY);
    expect(long.routines!.water!.done.at(-1)).toBe(monday);
  });
  it('counts streaks over scheduled days only; an open today does not break it', () => {
    const gym = { title: 'Gym', days: [1, 3, 5], done: ['2026-09-14', '2026-09-16', '2026-09-18'] };
    // Monday the 21st, not yet done: streak carries Mon/Wed/Fri of the previous week.
    expect(streak(gym, monday)).toBe(3);
    expect(streak({ ...gym, done: [...gym.done, monday] }, monday)).toBe(4);
    // Wednesday the 23rd with Monday missed: broken.
    expect(streak(gym, '2026-09-23')).toBe(0);
  });
  it('orders routines and swaps neighbours', () => {
    let b = applyEdit(fixture(), (d) => {
      addRoutine(d, 'Read', [7]);
    });
    const ids = () =>
      Object.entries(b.routines!)
        .sort(([, a], [, c]) => a.order! - c.order!)
        .map(([, r]) => r.title);
    expect(ids()).toEqual(['Water the plants', 'Gym', 'Read']);
    b = applyEdit(b, (d) => moveRoutine(d, 'gym', -1));
    expect(ids()).toEqual(['Gym', 'Water the plants', 'Read']);
  });
  it('merges completions from two devices and propagates unticking', () => {
    const base = applyEdit(fixture(), (d) => toggleRoutine(d, 'water', addDays(monday, -1)));
    const mine = applyEdit(base, (d) => toggleRoutine(d, 'water', monday));
    const theirs = applyEdit(base, (d) => {
      toggleRoutine(d, 'water', addDays(monday, -1));
      toggleRoutine(d, 'gym', monday);
    });
    const result = merge(base, mine, theirs);
    expect(result.overlaps).toEqual([]);
    expect(result.board.routines!.water!.done).toEqual([monday]);
    expect(result.board.routines!.gym!.done).toEqual([monday]);
    expect(result.remote.map((c) => `${c.kind}:${c.id}:${c.op}`).sort()).toEqual([
      'routine:gym:changed',
      'routine:water:changed',
    ]);
  });
  it('keeps a routine edited here but removed there, and can take their removal', () => {
    const base = fixture();
    const mine = applyEdit(base, (d) => {
      d.routines!.gym!.title = 'Gym and stretch';
    });
    const theirs = applyEdit(base, (d) => removeRoutine(d, 'gym'));
    const result = merge(base, mine, theirs);
    expect(result.board.routines!.gym!.title).toBe('Gym and stretch');
    expect(result.overlaps[0]).toMatchObject({
      kind: 'routine',
      id: 'gym',
      field: 'removed',
      chosen: 'mine',
    });
    expect(resolve(result.board, result.overlaps[0]!, 'theirs').routines!.gym).toBeUndefined();
  });
});
