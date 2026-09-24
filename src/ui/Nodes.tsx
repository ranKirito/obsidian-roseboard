import {
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { Handle, NodeResizer, Position, useStore, type Node, type NodeProps } from '@xyflow/react';
import { addDays, type BoardNode, type Task } from '../domain/model';
import type { BoardHost } from './ports';
import { Markdown } from './Markdown';
import { CanvasNote } from './CanvasNote';
import { TaskBody } from './TaskBody';
import type { Draft } from 'immer';
import { Icon, priorityIcon, statusIcon, statusLabel } from './icons';
export type CardData = {
  node: BoardNode;
  task?: Task;
  host: BoardHost;
  readOnly: boolean;
  overdue: boolean;
  blocked: boolean;
  missing: boolean;
  count: string;
  today: string;
  /** True for a few seconds after another device changed this record. */
  recent: boolean;
  complete: (id: string) => void;
  previewNote: (path: string) => void;
  expanded: boolean;
  expandNote: (id: string, expanded: boolean) => void;
  resize: (id: string, params: { x: number; y: number; width: number; height: number }) => void;
  begin: () => void;
  /** Inline edit of the card's primary text: task title, frame title or sticky content. */
  setText: (nodeId: string, text: string) => void;
  toggleCheck: (taskId: string, itemId: string) => void;
  editTask: (taskId: string, label: string, change: (task: Draft<Task>) => void) => void;
  /** Reports the height the card's content needs; the view grows the card, never the saved size. */
  fit: (nodeId: string, height: number, expanded: boolean) => void;
};
export type FlowNode = Node<CardData, 'card'>;
const lowDetail = (state: { transform: [number, number, number] }) => state.transform[2] < 0.5;
export function formatDue(due: string, today: string): string {
  if (due === today) return 'Today';
  if (due === addDays(today, 1)) return 'Tomorrow';
  if (due === addDays(today, -1)) return 'Yesterday';
  const [y, m, d] = due.split('-').map(Number) as [number, number, number];
  const date = new Date(y, m - 1, d);
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: y === Number(today.slice(0, 4)) ? undefined : 'numeric',
  }).format(date);
}
/** Text field that commits on Enter/blur and cancels on Escape; used for inline card editing. */
function InlineText({
  value,
  multiline,
  label,
  onCommit,
  onCancel,
}: {
  value: string;
  multiline?: boolean;
  label: string;
  onCommit: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(value);
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const finished = useRef(false);
  const finish = (cancel = false) => {
    if (finished.current) return;
    finished.current = true;
    if (cancel) onCancel();
    else onCommit(text);
  };
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const keyDown = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      finish(true);
    } else if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      finish();
    }
  };
  const props = {
    ref,
    value: text,
    'aria-label': label,
    className: 'rb-inline nodrag nopan nowheel',
    onChange: (e: { target: { value: string } }) => setText(e.target.value),
    onBlur: () => finish(),
    onKeyDown: keyDown,
    onPointerDown: (e: { stopPropagation: () => void }) => e.stopPropagation(),
  };
  return multiline ? <textarea {...props} rows={6} /> : <input {...props} />;
}
const inFlow = (el: Element): el is HTMLElement => {
  if (!(el instanceof HTMLElement)) return false;
  const style = getComputedStyle(el);
  return style.display !== 'none' && style.position !== 'absolute' && style.position !== 'fixed';
};
/** In-flow children, looking through `display: contents` wrappers such as the task body. */
const flowChildren = (el: Element): HTMLElement[] =>
  [...el.children].flatMap((child) =>
    child instanceof HTMLElement && getComputedStyle(child).display === 'contents'
      ? flowChildren(child)
      : inFlow(child)
        ? [child]
        : [],
  );
const verticalBox = (style: CSSStyleDeclaration) =>
  parseFloat(style.paddingTop) +
  parseFloat(style.paddingBottom) +
  parseFloat(style.borderTopWidth) +
  parseFloat(style.borderBottomWidth);
/**
 * Height an element's content needs regardless of the height it currently has. Stretching regions
 * (document previews, the Markdown editor) are measured by their content, so the result does not
 * feed back into itself when the card grows or shrinks.
 */
function contentHeight(el: HTMLElement, root = false): number {
  const style = getComputedStyle(el);
  if (el instanceof HTMLTextAreaElement) {
    const previous = { height: el.style.height, flex: el.style.flex, minHeight: el.style.minHeight };
    el.setCssStyles({ height: '0px', flex: 'none', minHeight: '0px' });
    const needed = el.scrollHeight;
    el.setCssStyles(previous);
    const min = Number(el.dataset.fitMin ?? 160);
    return Math.max(needed, min) + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
  }
  if (el.classList.contains('rb-fit-scroll'))
    return verticalBox(style) + flowChildren(el).reduce((sum, child) => sum + child.offsetHeight, 0);
  // Shrinkable parts (task description, open checklist) count only the room they insist on.
  if (el.classList.contains('rb-fit-min')) return parseFloat(style.minHeight) || 0;
  if (!root && !el.querySelector('.rb-fit-scroll, .rb-fit-min, textarea')) return el.offsetHeight;
  const children = flowChildren(el);
  const gap = parseFloat(style.rowGap) || 0;
  return (
    verticalBox(style) +
    children.reduce((sum, child) => sum + contentHeight(child), 0) +
    gap * Math.max(0, children.length - 1)
  );
}
/** Re-measures when the card resizes, its content changes, or the note editor reports typing. */
function useFit(ref: RefObject<HTMLDivElement | null>, report: (() => void) | undefined) {
  const latest = useRef(report);
  latest.current = report;
  useLayoutEffect(() => latest.current?.());
  const active = !!report;
  useEffect(() => {
    const el = ref.current;
    if (!el || !active) return;
    let frame = 0;
    const schedule = () => {
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          latest.current?.();
        });
    };
    const resize = new ResizeObserver(schedule);
    resize.observe(el);
    const mutation = new MutationObserver(schedule);
    mutation.observe(el, { childList: true, subtree: true, characterData: true });
    el.addEventListener('roseboard-fit', schedule);
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutation.disconnect();
      el.removeEventListener('roseboard-fit', schedule);
    };
  }, [ref, active]);
}
export const Card = memo(function Card({ id, data }: NodeProps<FlowNode>) {
  const { node, task, host, readOnly } = data;
  const minimal = useStore(lowDetail);
  const [editing, setEditing] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  // Task cards report the least room their content needs; documents fit their text while read.
  const autoFit = node.type === 'task' || data.expanded;
  // Content height doubles as the resize minimum, so a card cannot be dragged smaller than its text.
  const [needed, setNeeded] = useState(0);
  useFit(
    cardRef,
    autoFit
      ? () => {
          const el = cardRef.current;
          if (!el?.isConnected) return;
          // The node wrapper's 1px border sits outside the card element.
          const height = Math.ceil(contentHeight(el, true)) + 2;
          data.fit(id, height, data.expanded);
          setNeeded((previous) => (Math.abs(previous - height) < 2 ? previous : height));
        }
      : undefined,
  );
  const tint = node.color ? ` rb-tint-${node.color}` : '';
  const startEdit = () => {
    if (!readOnly) setEditing(true);
  };
  const commit = (text: string) => {
    setEditing(false);
    data.setText(id, text);
  };
  const isFrame = node.type === 'frame';
  return (
    <div
      ref={cardRef}
      className={`rb-card rb-card-${node.type}${task?.status === 'done' ? ' rb-done' : ''}${tint}${data.recent ? ' rb-recent' : ''}${editing ? ' rb-editing' : ''}`}
      data-testid={`card-${node.type}`}
    >
      {/* Always mounted: any edge or corner resizes, not only the selected card's. */}
      <NodeResizer
        isVisible={!readOnly && !data.expanded}
        minWidth={isFrame ? 240 : 180}
        minHeight={isFrame ? 140 : node.type === 'task' ? Math.max(120, needed) : 120}
        onResizeStart={data.begin}
        onResizeEnd={(_, params) => data.resize(id, params)}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="left"
        isConnectable={!readOnly}
        aria-label="Connect from the left"
      />
      <Handle
        type="target"
        position={Position.Top}
        id="top"
        isConnectable={!readOnly}
        aria-label="Connect from the top"
      />
      {node.type === 'task' && task && (
        <>
          <div className="rb-card-head">
            <span className={`rb-chip rb-status rb-status-${task.status}`}>
              <Icon name={statusIcon[task.status]!} />
              {statusLabel[task.status]}
            </span>
            {task.priority !== 'none' && (
              <span
                className={`rb-chip rb-priority rb-priority-${task.priority}`}
                title={`${task.priority} priority`}
              >
                <Icon name={priorityIcon[task.priority]!} />
                {task.priority}
              </span>
            )}
            {data.blocked && task.status !== 'done' && (
              <span className="rb-chip rb-chip-blocked">
                <Icon name="ban" />
                Blocked
              </span>
            )}
          </div>
          <div className="rb-card-title">
            <button
              className="rb-complete nodrag"
              aria-label={task.status === 'done' ? `Reopen ${task.title}` : `Complete ${task.title}`}
              disabled={readOnly}
              onClick={() => data.complete(node.taskId)}
            >
              <Icon name={task.status === 'done' ? 'circle-check-big' : 'circle'} />
            </button>
            {editing ? (
              <InlineText
                value={task.title}
                label="Edit task title"
                onCommit={commit}
                onCancel={() => setEditing(false)}
              />
            ) : (
              <strong onDoubleClick={startEdit} title={readOnly ? undefined : 'Double-click to rename'}>
                {task.title}
              </strong>
            )}
          </div>
          {!minimal && (
            <TaskBody
              taskId={node.taskId}
              task={task}
              host={host}
              readOnly={readOnly}
              editTask={data.editTask}
              toggleCheck={data.toggleCheck}
            />
          )}
          {!minimal && (
            <div className="rb-card-meta">
              {task.assignee && (
                <span className="rb-meta">
                  <Icon name="user-round" />
                  {task.assignee}
                </span>
              )}
              {task.dueDate && (
                <span className={`rb-meta${data.overdue ? ' rb-overdue' : ''}`} title={task.dueDate}>
                  <Icon name={data.overdue ? 'alarm-clock' : 'calendar'} />
                  {data.overdue ? 'Overdue · ' : ''}
                  {formatDue(task.dueDate, data.today)}
                </span>
              )}
              {task.notePath && (
                <button
                  className={`rb-meta rb-note-link nodrag${data.missing ? ' rb-overdue' : ''}`}
                  aria-label={`Read linked note ${task.notePath}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    data.expandNote(id, !data.expanded);
                  }}
                >
                  <Icon name={data.missing ? 'file-x' : 'file-text'} />
                  {data.missing ? 'Missing note' : 'Note'}
                </button>
              )}
              {!!task.tags.length && (
                <span className="rb-tags">
                  {task.tags.slice(0, 4).map((t) => (
                    <span className="rb-tag" key={t}>
                      #{t}
                    </span>
                  ))}
                  {task.tags.length > 4 && <span className="rb-tag">+{task.tags.length - 4}</span>}
                </span>
              )}
            </div>
          )}
          {data.expanded && task.notePath && (
            <CanvasNote
              host={host}
              path={task.notePath}
              expanded
              expand={(value) => data.expandNote(id, value)}
              readOnly={readOnly}
              minimal={minimal}
              missing={data.missing}
            />
          )}
        </>
      )}
      {node.type === 'sticky' && (
        <>
          <div className="rb-card-head rb-card-head-sticky">
            <span className="rb-chip">
              <Icon name="sticky-note" />
              Note
            </span>
          </div>
          {editing ? (
            <InlineText
              value={node.content}
              multiline
              label="Edit note"
              onCommit={commit}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <div className="rb-sticky-body" onDoubleClick={startEdit}>
              <Markdown text={minimal ? node.content.slice(0, 80) : node.content} host={host} />
            </div>
          )}
        </>
      )}
      {node.type === 'note' && (
        <>
          <div className="rb-card-head">
            <span className="rb-chip">
              <Icon name="link" />
              {data.missing ? 'Missing note' : 'Vault note'}
            </span>
          </div>
          <div className="rb-card-title">
            <Icon name={data.missing ? 'file-x' : 'file-text'} className="rb-icon-lg" />
            <strong>{node.notePath.split('/').pop()?.replace(/\.md$/, '')}</strong>
          </div>
          {!minimal && <span className="rb-path">{node.notePath}</span>}
          <CanvasNote
            host={host}
            path={node.notePath}
            expanded={data.expanded}
            expand={(value) => data.expandNote(id, value)}
            readOnly={readOnly}
            minimal={minimal}
            missing={data.missing}
          />
        </>
      )}
      {isFrame && (
        <div className="rb-frame-label">
          {editing ? (
            <InlineText
              value={node.title}
              label="Edit frame name"
              onCommit={commit}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <strong onDoubleClick={startEdit}>{node.title}</strong>
          )}
          <span>{data.count}</span>
        </div>
      )}
      <Handle
        type="source"
        position={Position.Right}
        id="right"
        isConnectable={!readOnly}
        aria-label="Connect to the right"
      />
      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom"
        isConnectable={!readOnly}
        aria-label="Connect to the bottom"
      />
    </div>
  );
});
export const nodeTypes = { card: Card };
