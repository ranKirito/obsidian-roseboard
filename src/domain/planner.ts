import { ROUTINE_HISTORY, addDays, dateOnly, routinesOf, type Board, type Routine, type Task } from './model';

export const monthOf = (date: string) => `${date.slice(0, 7)}-01`;

/** Date-only arithmetic keeps calendar cells independent of the device timezone and DST. */
export function shiftMonth(date: string, offset: number): string {
  const value = new Date(`${monthOf(date)}T12:00:00Z`);
  value.setUTCMonth(value.getUTCMonth() + offset);
  const result = value.toISOString().slice(0, 10);
  return dateOnly.safeParse(result).success ? result : monthOf(date);
}

export function calendarDays(date: string): string[] {
  const first = monthOf(date);
  const weekday = new Date(`${first}T12:00:00Z`).getUTCDay();
  const start = addDays(first, -((weekday + 6) % 7));
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export function dateLabel(date: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(undefined, { ...options, timeZone: 'UTC' }).format(
    new Date(`${date}T12:00:00Z`),
  );
}

const priority = { high: 0, medium: 1, low: 2, none: 3 };
export function compareTasks(a: [string, Task], b: [string, Task]): number {
  return (
    Number(a[1].status === 'done') - Number(b[1].status === 'done') ||
    (a[1].dueDate ?? '9999-12-31').localeCompare(b[1].dueDate ?? '9999-12-31') ||
    priority[a[1].priority] - priority[b[1].priority] ||
    a[1].title.localeCompare(b[1].title) ||
    a[0].localeCompare(b[0])
  );
}

export function plannerTasks(board: Board, matching: Set<string>, date: string, today: string) {
  const tasks = Object.entries(board.tasks)
    .filter(([id]) => matching.has(id))
    .sort(compareTasks);
  return {
    day: tasks.filter(([, task]) => task.dueDate === date),
    overdue: tasks.filter(([, task]) => task.status !== 'done' && task.dueDate && task.dueDate < today),
    unscheduled: tasks.filter(([, task]) => task.status !== 'done' && !task.dueDate),
  };
}

/** ISO weekday of a date-only string: 1 = Monday … 7 = Sunday. */
export const isoWeekday = (date: string) => ((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;

/** Monday-to-Sunday week containing `date`. */
export const weekOf = (date: string) =>
  Array.from({ length: 7 }, (_, i) => addDays(date, i + 1 - isoWeekday(date)));

export const routineOrder = (a: [string, Routine], b: [string, Routine]) =>
  (a[1].order ?? 0) - (b[1].order ?? 0) || a[1].title.localeCompare(b[1].title) || a[0].localeCompare(b[0]);

/** Routines scheduled on `date`, in display order. */
export function routinesOn(board: Board, date: string): [string, Routine][] {
  const day = isoWeekday(date);
  return Object.entries(routinesOf(board))
    .filter(([, routine]) => routine.days.includes(day))
    .sort(routineOrder);
}

/**
 * Consecutive scheduled days completed, counting back from `today`. An unfinished routine today
 * does not break the streak until the day is over.
 */
export function streak(routine: Routine, today: string): number {
  const done = new Set(routine.done);
  let date = today;
  if (routine.days.includes(isoWeekday(date)) && !done.has(date)) date = addDays(date, -1);
  let count = 0;
  for (let i = 0; i < ROUTINE_HISTORY; i++, date = addDays(date, -1)) {
    if (!routine.days.includes(isoWeekday(date))) continue;
    if (!done.has(date)) break;
    count++;
  }
  return count;
}

const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
/** Short human label for a routine's weekdays. */
export function repeatLabel(days: number[]): string {
  const set = [...new Set(days)].sort();
  if (set.length === 7) return 'Every day';
  if (set.join() === '1,2,3,4,5') return 'Weekdays';
  if (set.join() === '6,7') return 'Weekends';
  return set.map((d) => dayNames[d - 1]).join(' · ');
}
