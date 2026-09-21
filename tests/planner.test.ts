import { describe, expect, it } from 'vitest';
import {
  addDays,
  emptyFilters,
  localDate,
  matches,
  newBoard,
  newTask,
  validateBoard,
} from '../src/domain/model';
import { calendarDays, monthOf, plannerTasks, shiftMonth } from '../src/domain/planner';
import { applyEdit, History } from '../src/domain/commands';
import { merge, resolve } from '../src/domain/merge';
import { boardNote, parseNote } from '../src/persistence/markdown';

function fixture() {
  const board = newBoard('Plan together');
  board.timeZone = 'Europe/Ljubljana';
  board.tasks = {
    a: { ...newTask('Today'), dueDate: '2026-09-19', assignee: 'Anna' },
    b: { ...newTask('Earlier'), dueDate: '2026-09-18', assignee: 'Sam' },
    c: { ...newTask('Unscheduled'), priority: 'high' },
    d: { ...newTask('Finished earlier'), dueDate: '2026-09-18', status: 'done' },
    e: { ...newTask('Finished today'), dueDate: '2026-09-19', status: 'done' },
  };
  board.nodes = { na: { type: 'task', taskId: 'a', x: 800, y: -400, width: 300, height: 190 } };
  return board;
}
describe('calendar and daily planning', () => {
  it('builds six Monday-first weeks, including leap days and adjacent months', () => {
    const days = calendarDays('2024-02-29');
    expect(days).toHaveLength(42);
    expect(days[0]).toBe('2024-01-29');
    expect(days[41]).toBe('2024-03-10');
    expect(days).toContain('2024-02-29');
    expect(new Set(days).size).toBe(42);
    expect(calendarDays('2026-03-31')).toContain('2026-03-29');
  });
  it('navigates month and year boundaries without day overflow', () => {
    expect(shiftMonth('2024-01-31', 1)).toBe('2024-02-01');
    expect(shiftMonth('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftMonth('2026-01-01', -1)).toBe('2025-12-01');
    expect(monthOf('2026-09-19')).toBe('2026-09-01');
    expect(shiftMonth('9999-12-01', 1)).toBe('9999-12-01');
    expect(shiftMonth('0001-01-01', -1)).toBe('0001-01-01');
  });
  it('keeps small years, leap days and DST date arithmetic intact', () => {
    expect(addDays('0099-12-31', 1)).toBe('0100-01-01');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30');
    expect(addDays('2026-10-25', -1)).toBe('2026-10-24');
    expect(localDate('Pacific/Kiritimati', new Date('2026-09-18T12:00:00Z'))).toBe('2026-09-19');
  });
  it('includes unplaced tasks, keeps completed daily tasks, and excludes completed overdue work', () => {
    const board = fixture();
    const groups = plannerTasks(board, new Set(Object.keys(board.tasks)), '2026-09-19', '2026-09-19');
    expect(groups.day.map(([id]) => id)).toEqual(['a', 'e']);
    expect(groups.overdue.map(([id]) => id)).toEqual(['b']);
    expect(groups.unscheduled.map(([id]) => id)).toEqual(['c']);
    expect(plannerTasks(board, new Set(['a']), '2026-09-19', '2026-09-19').overdue).toEqual([]);
  });
  it('rescheduling survives a source round trip and undo without creating or moving cards', () => {
    const base = fixture();
    const history = new History();
    history.record(base, 'Schedule task');
    const next = applyEdit(base, (b) => {
      b.tasks.a!.dueDate = '2026-10-02';
    });
    expect(parseNote(boardNote(next)).board.tasks.a!.dueDate).toBe('2026-10-02');
    expect(next.nodes).toEqual(base.nodes);
    expect(history.undo(next)).toEqual(base);
    expect(history.redo(base)).toEqual(next);
  });
});
describe('assignees and collaboration', () => {
  it('reads old boards unchanged, preserves assignments and rejects malformed owners', () => {
    expect(validateBoard(newBoard()).tasks).toEqual({});
    expect(parseNote(boardNote(fixture())).board.tasks.a!.assignee).toBe('Anna');
    expect(() => validateBoard({ ...fixture(), tasks: { a: { title: 'A', assignee: 9 } } })).toThrow();
    expect(() =>
      validateBoard({ ...fixture(), tasks: { a: { title: 'A', assignee: 'x'.repeat(101) } } }),
    ).toThrow();
  });
  it('filters everyone, one assignee, unassigned work, and searches by owner', () => {
    const b = fixture();
    expect(matches(b.tasks.a!, b, { ...emptyFilters, assignee: 'Anna' })).toBe(true);
    expect(matches(b.tasks.b!, b, { ...emptyFilters, assignee: 'Anna' })).toBe(false);
    expect(matches(b.tasks.c!, b, { ...emptyFilters, unassigned: true })).toBe(true);
    expect(matches(b.tasks.a!, b, { ...emptyFilters, unassigned: true })).toBe(false);
    expect(matches(b.tasks.a!, b, { ...emptyFilters, search: 'anna' })).toBe(true);
  });
  it('combines assignment with concurrent scheduling and reviews assignment overlaps', () => {
    const base = fixture();
    const mine = applyEdit(base, (b) => {
      b.tasks.a!.assignee = 'Sam';
    });
    const theirs = applyEdit(base, (b) => {
      b.tasks.a!.dueDate = '2026-09-25';
    });
    const combined = merge(base, mine, theirs);
    expect(combined.overlaps).toEqual([]);
    expect(combined.board.tasks.a).toMatchObject({ assignee: 'Sam', dueDate: '2026-09-25' });
    const other = applyEdit(base, (b) => {
      b.tasks.a!.assignee = 'Alex';
    });
    const overlap = merge(base, mine, other);
    expect(overlap.overlaps[0]?.field).toBe('assignee');
    expect(resolve(overlap.board, overlap.overlaps[0]!, 'theirs').tasks.a!.assignee).toBe('Alex');
  });
});
