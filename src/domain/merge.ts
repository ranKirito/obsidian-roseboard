import { validateBoard, type Board } from './model';
/**
 * Structural three-way merge of a Roseboard document.
 *
 * `base` is the payload this device last loaded or saved, `mine` is the local model with pending
 * edits, and `theirs` is what another device (through LiveSync) or an agent wrote to the file.
 * Records are merged by stable ID and then field by field, so two people moving different cards or
 * editing different tasks never conflict. When both sides changed the same field, the more recent
 * `updatedAt` wins; without stamps the local value wins. Every such overlap is reported so the
 * person can still pick the other value. The result is validated; an impossible result throws and
 * the caller falls back to the explicit conflict path. Nothing here touches the file system.
 */
export type Kind = 'task' | 'node' | 'edge' | 'ink' | 'routine' | 'board';
export interface Overlap {
  kind: Kind;
  id: string;
  field: string;
  mine: unknown;
  theirs: unknown;
  /** Which side the merged result currently holds. */
  chosen: 'mine' | 'theirs';
}
export interface Change {
  kind: Kind;
  id: string;
  op: 'added' | 'removed' | 'changed';
  fields: string[];
  at?: string;
  by?: string;
}
export interface MergeResult {
  board: Board;
  overlaps: Overlap[];
  /** What `theirs` changed relative to `base`; drives highlights and the activity feed. */
  remote: Change[];
}
type Rec = Record<string, unknown>;
const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);
/** Fields that only make sense together. */
const groups: Record<string, string[]> = { position: ['x', 'y'], size: ['width', 'height'] };
const groupOf = (field: string) =>
  Object.entries(groups).find(([, fields]) => fields.includes(field))?.[0] ?? field;
/** Order-free lists: additions and removals from both sides combine. */
const setFields = new Set(['tags', 'dependsOn', 'days', 'done']);
function newer(mine: Rec, theirs: Rec): 'mine' | 'theirs' {
  const a = typeof mine.updatedAt === 'string' ? mine.updatedAt : '',
    b = typeof theirs.updatedAt === 'string' ? theirs.updatedAt : '';
  return a && b && b > a ? 'theirs' : 'mine';
}
function mergeSet(base: unknown[], mine: unknown[], theirs: unknown[]): unknown[] {
  const b = new Set(base.map((v) => JSON.stringify(v))),
    m = new Set(mine.map((v) => JSON.stringify(v))),
    t = new Set(theirs.map((v) => JSON.stringify(v)));
  const out: unknown[] = [];
  const seen = new Set<string>();
  const push = (v: unknown) => {
    const key = JSON.stringify(v);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(v);
    }
  };
  for (const v of mine) if (b.has(JSON.stringify(v)) ? t.has(JSON.stringify(v)) : true) push(v);
  for (const v of theirs) if (!b.has(JSON.stringify(v)) && !m.has(JSON.stringify(v))) push(v);
  return out;
}
function mergeChecklist(
  base: Rec[],
  mine: Rec[],
  theirs: Rec[],
  report: (field: string, mine: unknown, theirs: unknown, chosen: 'mine' | 'theirs') => void,
  prefer: 'mine' | 'theirs',
): Rec[] {
  const byId = (list: Rec[]) => new Map(list.map((i) => [String(i.id), i]));
  const b = byId(base),
    m = byId(mine),
    t = byId(theirs);
  const order = [...mine.map((i) => String(i.id)), ...theirs.map((i) => String(i.id))].filter(
    (id, index, all) => all.indexOf(id) === index,
  );
  const out: Rec[] = [];
  for (const id of order) {
    const bi = b.get(id),
      mi = m.get(id),
      ti = t.get(id);
    if (mi && ti) {
      if (same(mi, ti) || !bi) out.push(same(mi, ti) ? mi : prefer === 'mine' ? mi : ti);
      else {
        const merged: Rec = { ...mi };
        for (const field of new Set([...Object.keys(mi), ...Object.keys(ti)])) {
          const bv = bi[field],
            mv = mi[field],
            tv = ti[field];
          if (same(mv, tv)) merged[field] = mv;
          else if (same(mv, bv)) merged[field] = tv;
          else if (same(tv, bv)) merged[field] = mv;
          else {
            merged[field] = prefer === 'mine' ? mv : tv;
            report(`checklist.${id}.${field}`, mv, tv, prefer);
          }
        }
        out.push(merged);
      }
    } else if (mi && !ti) {
      if (!bi || !same(bi, mi)) out.push(mi); // Added or edited locally; their removal loses to edits.
    } else if (ti && !mi) {
      if (!bi || !same(bi, ti)) out.push(ti);
    }
  }
  return out;
}
function mergeRecord(
  kind: Kind,
  id: string,
  base: Rec | undefined,
  mine: Rec,
  theirs: Rec,
  overlaps: Overlap[],
): Rec {
  const prefer = newer(mine, theirs);
  const out: Rec = {};
  const report = (field: string, m: unknown, t: unknown, chosen: 'mine' | 'theirs') =>
    overlaps.push({ kind, id, field, mine: m, theirs: t, chosen });
  const decided = new Map<string, 'mine' | 'theirs' | 'same'>();
  const fields = [...new Set([...Object.keys(mine), ...Object.keys(theirs)])];
  for (const field of fields) {
    const bv = base?.[field],
      mv = mine[field],
      tv = theirs[field];
    if (field === 'updatedAt') {
      const a = typeof mv === 'string' ? mv : '',
        b = typeof tv === 'string' ? tv : '';
      out.updatedAt = a > b ? a : b;
      continue;
    }
    if (field === 'updatedBy') continue; // Filled in after the winner is known.
    if (same(mv, tv)) {
      if (mv !== undefined) out[field] = mv;
      continue;
    }
    if (setFields.has(field) && Array.isArray(mv) && Array.isArray(tv)) {
      out[field] = mergeSet(Array.isArray(bv) ? bv : [], mv, tv);
      continue;
    }
    if (field === 'checklist' && Array.isArray(mv) && Array.isArray(tv)) {
      out[field] = mergeChecklist(
        Array.isArray(bv) ? (bv as Rec[]) : [],
        mv as Rec[],
        tv as Rec[],
        report,
        prefer,
      );
      continue;
    }
    const group = groupOf(field);
    let choice = decided.get(group);
    if (!choice) {
      const members = groups[group] ?? [field];
      const mineChanged = members.some((f) => !same(mine[f], base?.[f])),
        theirsChanged = members.some((f) => !same(theirs[f], base?.[f]));
      if (base && mineChanged && !theirsChanged) choice = 'mine';
      else if (base && theirsChanged && !mineChanged) choice = 'theirs';
      else {
        choice = prefer;
        const pick = (r: Rec) => (members.length > 1 ? Object.fromEntries(members.map((f) => [f, r[f]])) : r[field]);
        report(group, pick(mine), pick(theirs), prefer);
      }
      decided.set(group, choice);
    }
    const value = choice === 'mine' ? mv : tv;
    if (value !== undefined) out[field] = value;
  }
  const winner = decided.size && [...decided.values()].every((c) => c === 'theirs') ? theirs : mine;
  if (winner.updatedBy !== undefined) out.updatedBy = winner.updatedBy;
  else if ((winner === mine ? theirs : mine).updatedBy !== undefined && decided.size === 0)
    out.updatedBy = (winner === mine ? theirs : mine).updatedBy;
  return out;
}
function mergeCollection(
  kind: Kind,
  base: Record<string, Rec>,
  mine: Record<string, Rec>,
  theirs: Record<string, Rec>,
  overlaps: Overlap[],
): Record<string, Rec> {
  const out: Record<string, Rec> = {};
  for (const id of new Set([...Object.keys(mine), ...Object.keys(theirs), ...Object.keys(base)])) {
    const b = base[id],
      m = mine[id],
      t = theirs[id];
    if (m && t) out[id] = same(m, t) ? m : mergeRecord(kind, id, b, m, t, overlaps);
    else if (m && !t) {
      if (!b) out[id] = m; // Added locally.
      else if (!same(b, m)) {
        out[id] = m; // Edited here, removed there: keep the edited record and say so.
        overlaps.push({ kind, id, field: 'removed', mine: m, theirs: undefined, chosen: 'mine' });
      }
    } else if (t && !m) {
      if (!b) out[id] = t; // Added elsewhere.
      else if (!same(b, t)) {
        out[id] = t; // Removed here, edited there: keep their edits rather than losing data.
        overlaps.push({ kind, id, field: 'removed', mine: undefined, theirs: t, chosen: 'theirs' });
      }
    }
  }
  return out;
}
/**
 * Removes references that a merge can leave dangling, reporting each repair. When two cards place
 * one task, the card other devices already have (`synced`) is kept and the local one is dropped.
 */
function repair(board: Board, overlaps: Overlap[], synced = new Set<string>()): Board {
  const placed = new Map<string, string>();
  const order = Object.entries(board.nodes).sort(([a], [b]) =>
    synced.has(a) !== synced.has(b) ? (synced.has(a) ? -1 : 1) : a < b ? -1 : a > b ? 1 : 0,
  );
  for (const [id, node] of order) {
    if (node.type === 'task') {
      if (!board.tasks[node.taskId]) {
        delete board.nodes[id];
        overlaps.push({ kind: 'node', id, field: 'orphan', mine: node, theirs: undefined, chosen: 'theirs' });
        continue;
      }
      const other = placed.get(node.taskId);
      if (other) {
        delete board.nodes[id];
        overlaps.push({ kind: 'node', id, field: 'duplicate placement', mine: node, theirs: other, chosen: 'theirs' });
        continue;
      }
      placed.set(node.taskId, id);
    }
    if (node.frameId && board.nodes[node.frameId]?.type !== 'frame') delete node.frameId;
  }
  for (const [id, task] of Object.entries(board.tasks)) {
    const kept = task.dependsOn.filter((dep) => board.tasks[dep] && dep !== id);
    if (kept.length !== task.dependsOn.length) {
      overlaps.push({ kind: 'task', id, field: 'dependsOn', mine: task.dependsOn, theirs: kept, chosen: 'theirs' });
      task.dependsOn = kept;
    }
  }
  for (const [id, edge] of Object.entries(board.edges))
    if (!board.nodes[edge.source] || !board.nodes[edge.target]) delete board.edges[id];
  return board;
}
/** Lists what `next` changed relative to `previous`. */
export function diff(previous: Board, next: Board): Change[] {
  const changes: Change[] = [];
  const collections: [Kind, Record<string, Rec>, Record<string, Rec>][] = [
    ['task', previous.tasks, next.tasks],
    ['node', previous.nodes, next.nodes],
    ['edge', previous.edges, next.edges],
    ['ink', previous.ink ?? {}, next.ink ?? {}],
    ['routine', previous.routines ?? {}, next.routines ?? {}],
  ];
  for (const [kind, a, b] of collections)
    for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const before = a[id],
        after = b[id];
      const stampOf = (r?: Rec) => ({
        at: typeof r?.updatedAt === 'string' ? r.updatedAt : undefined,
        by: typeof r?.updatedBy === 'string' ? r.updatedBy : undefined,
      });
      if (!before) changes.push({ kind, id, op: 'added', fields: [], ...stampOf(after) });
      else if (!after) changes.push({ kind, id, op: 'removed', fields: [], ...stampOf(before) });
      else if (before !== after && !same(before, after)) {
        const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])]
          .filter((f) => !['updatedAt', 'updatedBy'].includes(f) && !same(before[f], after[f]))
          .map(groupOf)
          .filter((f, i, all) => all.indexOf(f) === i);
        if (fields.length) changes.push({ kind, id, op: 'changed', fields, ...stampOf(after) });
      }
    }
  const top = ['title', 'timeZone'].filter((f) => !same(previous[f], next[f]));
  if (top.length) changes.push({ kind: 'board', id: previous.boardId, op: 'changed', fields: top });
  return changes;
}
export function merge(base: Board, mine: Board, theirs: Board): MergeResult {
  const overlaps: Overlap[] = [];
  const merged: Rec = {};
  for (const field of new Set([...Object.keys(mine), ...Object.keys(theirs)])) {
    if (['tasks', 'nodes', 'edges', 'ink', 'routines'].includes(field)) continue;
    const bv = (base as Rec)[field],
      mv = (mine as Rec)[field],
      tv = (theirs as Rec)[field];
    if (same(mv, tv)) merged[field] = mv;
    else if (same(mv, bv)) merged[field] = tv;
    else if (same(tv, bv)) merged[field] = mv;
    else {
      merged[field] = mv;
      overlaps.push({ kind: 'board', id: mine.boardId, field, mine: mv, theirs: tv, chosen: 'mine' });
    }
    if (merged[field] === undefined) delete merged[field];
  }
  merged.tasks = mergeCollection('task', base.tasks, mine.tasks, theirs.tasks, overlaps);
  merged.nodes = mergeCollection('node', base.nodes, mine.nodes, theirs.nodes, overlaps);
  merged.edges = mergeCollection('edge', base.edges, mine.edges, theirs.edges, overlaps);
  const ink = mergeCollection('ink', base.ink ?? {}, mine.ink ?? {}, theirs.ink ?? {}, overlaps);
  if (Object.keys(ink).length) merged.ink = ink;
  else delete merged.ink;
  const routines = mergeCollection(
    'routine',
    base.routines ?? {},
    mine.routines ?? {},
    theirs.routines ?? {},
    overlaps,
  );
  if (Object.keys(routines).length) merged.routines = routines;
  else delete merged.routines;
  const board = validateBoard(
    repair(structuredClone(merged) as Board, overlaps, new Set(Object.keys(theirs.nodes))),
  );
  return { board, overlaps, remote: diff(base, theirs) };
}
/** Applies one side's value for a reported overlap, returning the adjusted, validated board. */
export function resolve(board: Board, overlap: Overlap, side: 'mine' | 'theirs'): Board {
  const value = side === 'mine' ? overlap.mine : overlap.theirs;
  const next = structuredClone(board) as Rec;
  const key = overlap.kind === 'ink' ? 'ink' : `${overlap.kind}s`;
  if ((overlap.kind === 'ink' || overlap.kind === 'routine') && !next[key]) next[key] = {};
  const collection = overlap.kind === 'board' ? undefined : (next[key] as Record<string, Rec>);
  if (overlap.field === 'removed') {
    if (!collection) return board;
    if (value === undefined) delete collection[overlap.id];
    else collection[overlap.id] = value as Rec;
  } else if (overlap.field === 'orphan') return board;
  else if (overlap.field === 'duplicate placement') {
    if (!collection || side !== 'mine') return board;
    delete collection[String(overlap.theirs)];
    collection[overlap.id] = overlap.mine as Rec;
  } else {
    const target = collection ? collection[overlap.id] : next;
    if (!target) return board;
    if (overlap.field.startsWith('checklist.')) {
      const [, itemId, field] = overlap.field.split('.') as [string, string, string];
      const item = (target.checklist as Rec[] | undefined)?.find((i) => String(i.id) === itemId);
      if (item) item[field] = value;
    } else if (groups[overlap.field]) Object.assign(target, value as Rec);
    else if (value === undefined) delete target[overlap.field];
    else target[overlap.field] = value;
  }
  return validateBoard(repair(next as Board, []));
}
