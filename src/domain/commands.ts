import { produce, type Draft } from 'immer';
import {
  type Board,
  type BoardNode,
  type Status,
  type Stroke,
  ROUTINE_HISTORY,
  newId,
  newTask,
  validateBoard,
} from './model';
export type Edit = (board: Draft<Board>) => void;
export interface Stamp {
  at: string;
  by?: string;
}
/**
 * Applies one edit immutably, validates the result, and stamps every task or node record that the
 * edit actually changed. Immer keeps untouched records referentially equal, so the stamp pass is a
 * cheap identity comparison rather than a deep diff.
 */
export function applyEdit(board: Board, edit: Edit, stamp?: Stamp): Board {
  const next = produce(board, edit);
  if (next === board) return board;
  const stamped = !stamp
    ? next
    : produce(next, (draft) => {
        for (const key of ['tasks', 'nodes', 'ink', 'routines'] as const)
          for (const id of Object.keys(next[key] ?? {}))
            if (next[key]![id] !== board[key]?.[id]) {
              const record = draft[key]![id]!;
              record.updatedAt = stamp.at;
              if (stamp.by) record.updatedBy = stamp.by;
              else delete record.updatedBy;
            }
      });
  validateBoard(stamped);
  return stamped;
}
export function addTask(board: Draft<Board>, x = 100, y = 100, title = 'Untitled task'): string {
  const taskId = newId('task'),
    nodeId = newId('node');
  board.tasks[taskId] = newTask(title);
  board.nodes[nodeId] = { type: 'task', taskId, x, y, width: 300, height: 190 };
  return nodeId;
}
export function removePlacements(board: Draft<Board>, ids: string[]): void {
  for (const id of ids) {
    if (board.nodes[id]?.type === 'frame')
      for (const node of Object.values(board.nodes)) if (node.frameId === id) delete node.frameId;
    delete board.nodes[id];
    for (const [edgeId, edge] of Object.entries(board.edges))
      if (edge.source === id || edge.target === id) delete board.edges[edgeId];
  }
}
export function deleteTask(board: Draft<Board>, taskId: string): void {
  removePlacements(
    board,
    Object.keys(board.nodes).filter((id) => {
      const n = board.nodes[id]!;
      return n.type === 'task' && n.taskId === taskId;
    }),
  );
  delete board.tasks[taskId];
  for (const task of Object.values(board.tasks))
    task.dependsOn = task.dependsOn.filter((id) => id !== taskId);
}
export function duplicate(board: Draft<Board>, ids: string[]): string[] {
  const originals = new Set(ids);
  for (const [id, node] of Object.entries(board.nodes))
    if (node.frameId && originals.has(node.frameId)) originals.add(id);
  const nodes = new Map([...originals].map((id) => [id, newId('node')]));
  const tasks = new Map<string, string>();
  for (const id of originals) {
    const n = board.nodes[id];
    if (n?.type === 'task') tasks.set(n.taskId, newId('task'));
  }
  for (const [oldId, newTaskId] of tasks) {
    const t = structuredClone(JSON.parse(JSON.stringify(board.tasks[oldId])));
    t.title += ' (copy)';
    t.checklist = t.checklist.map((i: { id: string }) => ({ ...i, id: newId('check') }));
    t.dependsOn = t.dependsOn.map((id: string) => tasks.get(id) ?? id);
    board.tasks[newTaskId] = t;
  }
  for (const [oldId, newNodeId] of nodes) {
    const original = board.nodes[oldId];
    if (!original) continue;
    const node: BoardNode = JSON.parse(JSON.stringify(original));
    node.x += 48;
    node.y += 48;
    if (node.type === 'task') node.taskId = tasks.get(node.taskId)!;
    if (node.frameId) node.frameId = nodes.get(node.frameId) ?? node.frameId;
    board.nodes[newNodeId] = node;
  }
  return [...nodes.values()];
}
export function moveNodes(board: Draft<Board>, positions: Record<string, { x: number; y: number }>): void {
  // All positions are absolute. A member selected with its frame moves only once.
  for (const [id, position] of Object.entries(positions)) {
    const node = board.nodes[id];
    if (!node || node.type !== 'frame') continue;
    const dx = position.x - node.x,
      dy = position.y - node.y;
    for (const [childId, child] of Object.entries(board.nodes))
      if (child.frameId === id && !positions[childId]) {
        child.x += dx;
        child.y += dy;
      }
  }
  for (const [id, position] of Object.entries(positions))
    if (board.nodes[id]) Object.assign(board.nodes[id]!, position);
}
/** Keyboard nudge: translates the given cards (and explicit frame members) by a fixed offset. */
export function nudge(board: Draft<Board>, ids: string[], dx: number, dy: number): void {
  const positions: Record<string, { x: number; y: number }> = {};
  for (const id of ids) {
    const node = board.nodes[id];
    if (node) positions[id] = { x: node.x + dx, y: node.y + dy };
  }
  moveNodes(board, positions);
}
export function placeAll(board: Draft<Board>, only?: string[]): string[] {
  const placed = new Set(
    Object.values(board.nodes)
      .filter((n) => n.type === 'task')
      .map((n) => n.taskId),
  );
  const ids = Object.keys(board.tasks).filter((id) => !placed.has(id) && (!only || only.includes(id)));
  const top = Object.values(board.nodes).reduce((bottom, n) => Math.max(bottom, n.y + n.height), 0) + 100;
  return ids.map((taskId, i) => {
    const id = newId('node');
    board.nodes[id] = {
      type: 'task',
      taskId,
      x: 100 + (i % 4) * 340,
      y: top + Math.floor(i / 4) * 230,
      width: 300,
      height: 190,
    };
    return id;
  });
}
const SLOT_X = 340,
  SLOT_Y = 230,
  SLOT_GAP = 40;
/**
 * First free card-sized slot on a grid anchored at the board's top-left card, scanning row by row.
 * Frames count as occupied, so a new card never lands inside a frame it does not belong to.
 */
export function freeSlot(board: Board | Draft<Board>, width = 300, height = 190): { x: number; y: number } {
  const nodes = Object.values(board.nodes);
  if (!nodes.length) return { x: 100, y: 100 };
  const left = Math.min(...nodes.map((n) => n.x)),
    top = Math.min(...nodes.map((n) => n.y)),
    right = Math.max(...nodes.map((n) => n.x + n.width)),
    bottom = Math.max(...nodes.map((n) => n.y + n.height));
  const columns = Math.max(4, Math.ceil((right - left) / SLOT_X));
  const free = (x: number, y: number) =>
    !nodes.some(
      (n) =>
        x < n.x + n.width + SLOT_GAP &&
        x + width + SLOT_GAP > n.x &&
        y < n.y + n.height + SLOT_GAP &&
        y + height + SLOT_GAP > n.y,
    );
  // Bounded scan; very large boards fall back to the row below everything.
  for (let cell = 0; cell < 2000; cell++) {
    const x = left + (cell % columns) * SLOT_X,
      y = top + Math.floor(cell / columns) * SLOT_Y;
    if (y > bottom + SLOT_GAP) break;
    if (free(x, y)) return { x, y };
  }
  return { x: left, y: bottom + 100 };
}
/** Gives an unplaced task a card at the first free slot. Returns the node ID, new or existing. */
export function placeTask(board: Draft<Board>, taskId: string): string | undefined {
  if (!board.tasks[taskId]) return undefined;
  const existing = Object.entries(board.nodes).find(([, n]) => n.type === 'task' && n.taskId === taskId);
  if (existing) return existing[0];
  const id = newId('node');
  board.nodes[id] = { type: 'task', taskId, ...freeSlot(board), width: 300, height: 190 };
  return id;
}
export function setDependency(
  board: Draft<Board>,
  prerequisite: string,
  dependent: string,
  enabled = true,
): void {
  const task = board.tasks[dependent];
  if (!task) throw new Error('Dependent task is missing');
  task.dependsOn = task.dependsOn.filter((id) => id !== prerequisite);
  if (enabled) task.dependsOn.push(prerequisite);
}
/** Freehand ink: strokes are records like everything else, so undo and merge apply unchanged. */
export function addStroke(board: Draft<Board>, stroke: Stroke): string {
  const id = newId('ink');
  (board.ink ??= {})[id] = stroke;
  return id;
}
export function eraseStrokes(board: Draft<Board>, ids: string[]): void {
  if (!board.ink) return;
  for (const id of ids) delete board.ink[id];
  if (!Object.keys(board.ink).length) delete board.ink;
}
export function clearInk(board: Draft<Board>): void {
  delete board.ink;
}
export function setStatus(board: Draft<Board>, taskId: string, status: Status): void {
  const task = board.tasks[taskId];
  if (task) task.status = status;
}
/** Aligns or distributes the selected cards; frames move their members through moveNodes. */
export function align(
  board: Draft<Board>,
  ids: string[],
  mode: 'left' | 'right' | 'top' | 'bottom' | 'center-x' | 'center-y' | 'space-x' | 'space-y',
): void {
  const nodes = ids.map((id) => [id, board.nodes[id]] as const).filter((entry) => entry[1]);
  if (nodes.length < 2) return;
  const positions: Record<string, { x: number; y: number }> = {};
  const left = Math.min(...nodes.map(([, n]) => n!.x)),
    right = Math.max(...nodes.map(([, n]) => n!.x + n!.width)),
    top = Math.min(...nodes.map(([, n]) => n!.y)),
    bottom = Math.max(...nodes.map(([, n]) => n!.y + n!.height));
  if (mode.startsWith('space')) {
    const horizontal = mode === 'space-x';
    const sorted = [...nodes].sort(([, a], [, b]) => (horizontal ? a!.x - b!.x : a!.y - b!.y));
    const total = sorted.reduce((sum, [, n]) => sum + (horizontal ? n!.width : n!.height), 0);
    const gap = ((horizontal ? right - left : bottom - top) - total) / (sorted.length - 1);
    let cursor = horizontal ? left : top;
    for (const [id, n] of sorted) {
      positions[id] = horizontal ? { x: cursor, y: n!.y } : { x: n!.x, y: cursor };
      cursor += (horizontal ? n!.width : n!.height) + gap;
    }
  } else
    for (const [id, n] of nodes)
      positions[id] = {
        x:
          mode === 'left'
            ? left
            : mode === 'right'
              ? right - n!.width
              : mode === 'center-x'
                ? (left + right) / 2 - n!.width / 2
                : n!.x,
        y:
          mode === 'top'
            ? top
            : mode === 'bottom'
              ? bottom - n!.height
              : mode === 'center-y'
                ? (top + bottom) / 2 - n!.height / 2
                : n!.y,
      };
  moveNodes(board, positions);
}
export class History {
  private past: { label: string; board: Board }[] = [];
  private future: { label: string; board: Board }[] = [];
  private mergeKey = '';
  private mergeAt = 0;
  get canUndo() {
    return this.past.length > 0;
  }
  get canRedo() {
    return this.future.length > 0;
  }
  get undoLabel() {
    return this.past[this.past.length - 1]?.label;
  }
  get redoLabel() {
    return this.future[this.future.length - 1]?.label;
  }
  record(board: Board, label: string, key = '') {
    if (!key || key !== this.mergeKey || Date.now() - this.mergeAt > 700) this.past.push({ label, board });
    this.past = this.past.slice(-100);
    this.future = [];
    this.mergeKey = key;
    this.mergeAt = Date.now();
  }
  undo(board: Board): Board {
    const item = this.past.pop();
    if (!item) return board;
    this.future.push({ label: item.label, board });
    this.mergeKey = '';
    return item.board;
  }
  redo(board: Board): Board {
    const item = this.future.pop();
    if (!item) return board;
    this.past.push({ label: item.label, board });
    this.mergeKey = '';
    return item.board;
  }
  /**
   * Rewrites every remembered snapshot after remote changes were merged in, so undo steps back
   * through local edits only and never reverts another device's work. Entries that cannot be
   * rewritten are dropped together with everything older.
   */
  rebase(transform: (board: Board) => Board) {
    const rewrite = (items: { label: string; board: Board }[]) => {
      const out: { label: string; board: Board }[] = [];
      for (let i = items.length - 1; i >= 0; i--) {
        try {
          out.unshift({ label: items[i]!.label, board: transform(items[i]!.board) });
        } catch {
          break;
        }
      }
      return out;
    };
    this.past = rewrite(this.past);
    this.future = rewrite(this.future);
    this.mergeKey = '';
  }
  clear() {
    this.past = [];
    this.future = [];
    this.mergeKey = '';
  }
}
/** Routines: records like any other, so stamps, undo and the three-way merge apply unchanged. */
export function addRoutine(board: Draft<Board>, title: string, days?: number[]): string {
  const id = newId('routine');
  const routines = (board.routines ??= {});
  const order = Math.max(0, ...Object.values(routines).map((r) => r.order ?? 0)) + 1;
  routines[id] = { title, days: days ?? [1, 2, 3, 4, 5, 6, 7], done: [], order };
  return id;
}
export function toggleRoutine(board: Draft<Board>, id: string, date: string): void {
  const routine = board.routines?.[id];
  if (!routine) return;
  if (routine.done.includes(date)) routine.done = routine.done.filter((d) => d !== date);
  else routine.done = [...routine.done, date].sort().slice(-ROUTINE_HISTORY);
}
export function removeRoutine(board: Draft<Board>, id: string): void {
  if (!board.routines) return;
  delete board.routines[id];
  if (!Object.keys(board.routines).length) delete board.routines;
}
/** Swaps a routine with its neighbour in display order. */
export function moveRoutine(board: Draft<Board>, id: string, direction: -1 | 1): void {
  const list = Object.entries(board.routines ?? {}).sort(
    ([a, x], [b, y]) => (x.order ?? 0) - (y.order ?? 0) || x.title.localeCompare(y.title) || a.localeCompare(b),
  );
  const index = list.findIndex(([key]) => key === id);
  const other = list[index + direction];
  if (index < 0 || !other) return;
  list.forEach(([, routine], i) => (routine.order = i + 1));
  list[index]![1].order = index + 1 + direction;
  other[1].order = index + 1;
}
