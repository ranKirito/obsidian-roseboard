import { z } from 'zod';

const id = z
  .string()
  .min(1)
  .max(200)
  .refine((v) => !['__proto__', 'constructor', 'prototype'].includes(v), 'Reserved ID');
export const vaultPath = z
  .string()
  .min(1)
  .max(1000)
  .refine(
    (v) =>
      !/^[\/\\]|[:\\\x00-\x1f]/.test(v) &&
      !v.split('/').some((s) => s === '..' || s === '.' || s === '' || s.startsWith('.')),
    'Use a relative, visible vault path',
  );
export const statuses = ['backlog', 'todo', 'doing', 'done'] as const;
export const priorities = ['none', 'low', 'medium', 'high'] as const;
/** Named card tints. Stored as names so a theme can reinterpret them; never as raw hex. */
export const colors = ['rose', 'amber', 'mint', 'sky', 'violet', 'slate'] as const;
const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const [y, m, d] = v.split('-').map(Number) as [number, number, number];
    const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
    return (
      y > 0 &&
      m >= 1 &&
      m <= 12 &&
      d >= 1 &&
      d <= ([31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1] ?? 0)
    );
  }, 'Invalid calendar date');
/**
 * Optional edit stamps. They let two devices that edited the same record resolve the overlap by
 * recency, and they feed the activity feed. Boards written without them remain fully valid.
 */
const stamp = {
  updatedAt: z.iso.datetime({ offset: true }).optional(),
  updatedBy: z.string().max(100).optional(),
};
export const taskSchema = z
  .object({
    title: z.string().min(1).max(500),
    description: z.string().max(100000).default(''),
    status: z.enum(statuses).default('todo'),
    priority: z.enum(priorities).default('none'),
    dueDate: dateOnly.optional(),
    tags: z.array(z.string().max(100)).max(100).default([]),
    checklist: z
      .array(z.object({ id, text: z.string().max(2000), done: z.boolean().default(false) }).passthrough())
      .max(1000)
      .default([]),
    dependsOn: z.array(id).max(10000).default([]),
    notePath: vaultPath.optional(),
    ...stamp,
  })
  .passthrough();
const placement = {
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().min(160).max(100000).default(300),
  height: z.number().min(100).max(100000).default(190),
  frameId: id.optional(),
  color: z.enum(colors).optional(),
  ...stamp,
};
export const nodeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('task'), taskId: id, ...placement }).passthrough(),
  z
    .object({ type: z.literal('sticky'), content: z.string().max(100000).default(''), ...placement })
    .passthrough(),
  z.object({ type: z.literal('note'), notePath: vaultPath, ...placement }).passthrough(),
  z
    .object({ type: z.literal('frame'), title: z.string().max(500).default('Frame'), ...placement })
    .passthrough(),
]);
/** Freehand ink colours: the default foreground plus the card tints. */
export const inkColors = ['ink', ...colors] as const;
export const strokeSchema = z
  .object({
    points: z
      .array(z.number().finite())
      .min(4)
      .max(40000)
      .refine((p) => p.length % 2 === 0, 'Points come in x/y pairs'),
    color: z.enum(inkColors).default('ink'),
    width: z.number().min(1).max(40).default(3),
    ...stamp,
  })
  .passthrough();
export const boardSchema = z
  .object({
    schemaVersion: z.literal(1),
    boardId: id,
    title: z.string().min(1).max(500),
    timeZone: z
      .string()
      .default(() => Intl.DateTimeFormat().resolvedOptions().timeZone)
      .refine((v) => {
        try {
          new Intl.DateTimeFormat('en', { timeZone: v });
          return true;
        } catch {
          return false;
        }
      }, 'Invalid IANA time zone'),
    tasks: z.record(id, taskSchema).default({}),
    nodes: z.record(id, nodeSchema).default({}),
    edges: z
      .record(id, z.object({ source: id, target: id, label: z.string().max(500).default('') }).passthrough())
      .default({}),
    /** Optional freehand ink. Absent on boards without drawings; unknown to readers before 1.2. */
    ink: z.record(id, strokeSchema).optional(),
  })
  .passthrough();
export type Task = z.infer<typeof taskSchema>;
export type BoardNode = z.infer<typeof nodeSchema>;
export type Board = z.infer<typeof boardSchema>;
export type Stroke = z.infer<typeof strokeSchema>;
export type Status = Task['status'];
export const inkOf = (board: Board): Record<string, Stroke> => board.ink ?? {};
export type Priority = Task['priority'];
export type Color = (typeof colors)[number];
export class BoardError extends Error {}
export class UnsupportedVersion extends BoardError {}
export const newId = (prefix = 'id') => `${prefix}-${crypto.randomUUID()}`;
export const newBoard = (title = 'Untitled board'): Board =>
  boardSchema.parse({ schemaVersion: 1, boardId: newId('board'), title });
export const newTask = (title = 'Untitled task'): Task => taskSchema.parse({ title });
export function validateBoard(value: unknown): Board {
  if (value && typeof value === 'object' && 'schemaVersion' in value && value.schemaVersion !== 1)
    throw new UnsupportedVersion(
      `Schema version ${String(value.schemaVersion)} is not supported. Open source or export the raw JSON; writes are disabled.`,
    );
  const result = boardSchema.safeParse(value);
  if (!result.success)
    throw new BoardError(
      result.error.issues
        .slice(0, 8)
        .map((i) => `${i.path.join('.') || 'board'}: ${i.message}`)
        .join('\n'),
    );
  const board = result.data;
  const errors: string[] = [];
  const placed = new Set<string>();
  for (const [key, task] of Object.entries(board.tasks)) {
    if (new Set(task.checklist.map((i) => i.id)).size !== task.checklist.length)
      errors.push(`${key}: duplicate checklist IDs`);
    if (new Set(task.dependsOn).size !== task.dependsOn.length)
      errors.push(`${key}: duplicate prerequisites`);
    for (const dep of task.dependsOn) {
      if (!Object.hasOwn(board.tasks, dep)) errors.push(`${key}: missing prerequisite ${dep}`);
      if (dep === key) errors.push(`${key}: cannot depend on itself`);
    }
  }
  // Iterative topological check avoids recursion limits on long valid chains.
  const degree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  for (const [key, task] of Object.entries(board.tasks)) {
    degree.set(key, task.dependsOn.length);
    for (const dep of task.dependsOn) outgoing.set(dep, [...(outgoing.get(dep) ?? []), key]);
  }
  const queue = [...degree].filter(([, n]) => n === 0).map(([key]) => key);
  for (let i = 0; i < queue.length; i++)
    for (const dependent of outgoing.get(queue[i]!) ?? []) {
      degree.set(dependent, degree.get(dependent)! - 1);
      if (degree.get(dependent) === 0) queue.push(dependent);
    }
  if (queue.length !== degree.size && !errors.some((e) => e.includes('missing prerequisite')))
    errors.push('Dependency cycle detected');
  for (const [key, node] of Object.entries(board.nodes)) {
    if (node.type === 'task') {
      if (!Object.hasOwn(board.tasks, node.taskId)) errors.push(`${key}: missing task ${node.taskId}`);
      if (placed.has(node.taskId)) errors.push(`${key}: task already has a placement`);
      placed.add(node.taskId);
    }
    if (node.frameId && (node.type === 'frame' || board.nodes[node.frameId]?.type !== 'frame'))
      errors.push(`${key}: invalid frame membership; frames may not nest`);
  }
  for (const [key, edge] of Object.entries(board.edges))
    if (!Object.hasOwn(board.nodes, edge.source) || !Object.hasOwn(board.nodes, edge.target))
      errors.push(`${key}: missing connector endpoint`);
  if (errors.length) throw new BoardError(errors.slice(0, 12).join('\n'));
  return board;
}
/**
 * Canonical form for serialization: record keys sorted so that two devices writing the same set of
 * records produce the same lines. Line-based sync merges (LiveSync) then only see local differences.
 * Checklist and tag order is meaningful and is kept as authored.
 */
export function canonical(board: Board): Board {
  const sortRecord = <T>(record: Record<string, T>): Record<string, T> =>
    Object.fromEntries(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  const out: Board = { ...board, tasks: sortRecord(board.tasks), nodes: sortRecord(board.nodes), edges: sortRecord(board.edges) };
  if (board.ink && Object.keys(board.ink).length) out.ink = sortRecord(board.ink);
  else delete out.ink;
  return out;
}
export const serialize = (board: Board): string => JSON.stringify(canonical(board), null, 2);
export function localDate(timeZone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
/** Adds whole days to a date-only string without any UTC round trip. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
}
export const blocked = (task: Task, board: Board): boolean =>
  task.dependsOn.some((id) => board.tasks[id]?.status !== 'done');
export const overdue = (task: Task, today: string): boolean =>
  task.status !== 'done' && !!task.dueDate && task.dueDate < today;
export interface Filters {
  search: string;
  status: string;
  priority: string;
  tag: string;
  due: string;
  blocked: string;
  preset: string;
}
export const emptyFilters: Filters = {
  search: '',
  status: '',
  priority: '',
  tag: '',
  due: '',
  blocked: '',
  preset: '',
};
export const filtersActive = (f: Filters) => Object.values(f).some(Boolean);
export function matches(
  task: Task,
  board: Board,
  filters: Filters,
  today = localDate(board.timeZone),
): boolean {
  const isBlocked = blocked(task, board);
  if (
    filters.search &&
    ![task.title, task.description, ...task.tags]
      .join(' ')
      .toLowerCase()
      .includes(filters.search.toLowerCase())
  )
    return false;
  if (
    (filters.status && task.status !== filters.status) ||
    (filters.priority && task.priority !== filters.priority) ||
    (filters.tag && !task.tags.includes(filters.tag))
  )
    return false;
  if (
    (filters.blocked === 'blocked' && !isBlocked) ||
    (filters.blocked === 'ready' && (isBlocked || task.status === 'done'))
  )
    return false;
  const due = filters.preset === 'today' ? 'today' : filters.preset === 'overdue' ? 'overdue' : filters.due;
  if (
    (due === 'today' && task.dueDate !== today) ||
    (due === 'overdue' && !overdue(task, today)) ||
    (due === 'none' && task.dueDate) ||
    (due === 'upcoming' && (!task.dueDate || task.dueDate <= today || task.status === 'done'))
  )
    return false;
  return filters.preset !== 'ready' || (task.status !== 'done' && !isBlocked);
}
