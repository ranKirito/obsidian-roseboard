import { addDays, dateOnly, type Board, type Task } from './model';

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
