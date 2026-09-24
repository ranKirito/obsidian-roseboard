import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
  type Board,
  type BoardNode,
  type Task,
  statuses,
  priorities,
  colors,
  newId,
  blocked,
  addDays,
} from '../domain/model';
import { deleteTask, moveNodes, setDependency, type Edit } from '../domain/commands';
import type { BoardHost } from './ports';
import { Markdown } from './Markdown';
import { Name } from './Name';
import { Icon, priorityIcon, statusIcon, statusLabel } from './icons';
import { NoteContent } from './NoteContent';
const relative = (iso?: string) => {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return '';
  const minutes = Math.round(ms / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString();
};
export function Inspector({
  host,
  board,
  nodeId,
  taskId,
  edgeId,
  readOnly,
  today,
  close,
  focus,
  edit,
  complete,
  previewNote,
  onCard = false,
}: {
  host: BoardHost;
  board: Board;
  nodeId?: string;
  taskId?: string;
  edgeId?: string;
  readOnly: boolean;
  today: string;
  close: () => void;
  focus: (id: string) => void;
  edit: (label: string, action: Edit, key?: string) => void;
  complete: (id: string) => void;
  previewNote: (path: string) => void;
  /** The task is being edited from its canvas card, which shows its description and checklist. */
  onCard?: boolean;
}) {
  const node = nodeId ? board.nodes[nodeId] : undefined;
  const task = taskId ? board.tasks[taskId] : undefined;
  const edge = edgeId ? board.edges[edgeId] : undefined;
  const [tab, setTab] = useState<'edit' | 'preview'>('edit');
  const [newItem, setNewItem] = useState('');
  const assigneeOptions = useId();
  const uid = useId();
  const description = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = description.current;
    if (el) {
      el.setCssStyles({ height: 'auto' });
      el.setCssStyles({ height: `${Math.min(el.scrollHeight + 2, 360)}px` });
    }
  }, [task?.description, tab]);
  const updateTask = (patch: Partial<Task>, key = '') =>
    edit(
      'Edit task',
      (b) => {
        Object.assign(b.tasks[taskId!]!, patch);
      },
      key ? `${taskId}:${key}` : '',
    );
  const updateNode = (patch: Partial<BoardNode>, key = '') =>
    edit(
      'Edit card',
      (b) => {
        Object.assign(b.nodes[nodeId!]!, patch);
      },
      key ? `${nodeId}:${key}` : '',
    );
  const setDue = (value?: string) =>
    edit('Set due date', (b) => {
      if (value) b.tasks[taskId!]!.dueDate = value;
      else delete b.tasks[taskId!]!.dueDate;
    });
  const addItem = () => {
    const text = newItem.trim();
    if (!text) return;
    edit('Add checklist item', (b) => {
      b.tasks[taskId!]!.checklist.push({ id: newId('check'), text, done: false });
    });
    setNewItem('');
  };
  const stamped = (task ?? node) as { updatedAt?: string; updatedBy?: string } | undefined;
  const heading = task
    ? { icon: 'square-check', text: 'Task' }
    : node?.type === 'frame'
      ? { icon: 'frame', text: 'Frame' }
      : node?.type === 'sticky'
        ? { icon: 'sticky-note', text: 'Note' }
        : node?.type === 'note'
          ? { icon: 'link', text: 'Vault note' }
          : edge
            ? { icon: 'spline', text: 'Relationship' }
            : { icon: 'layout-dashboard', text: 'Board' };
  return (
    <aside className="rb-inspector" aria-labelledby={`${uid}-inspector`}>
      <Name id={`${uid}-inspector`}>Inspector</Name>
      <div className="rb-inspector-heading">
        <span>
          <Icon name={heading.icon} />
          {heading.text}
        </span>
        <button aria-label="Close inspector" className="rb-icon-button" onClick={close}>
          <Icon name="x" />
        </button>
      </div>
      <div className="rb-inspector-body">
        <fieldset disabled={readOnly}>
          {task && taskId && (
            <>
              <label>
                Title
                <input
                  aria-label="Task title"
                  value={task.title}
                  onChange={(e) => updateTask({ title: e.target.value || ' ' }, 'title')}
                />
              </label>
              <div className="rb-field-row">
                <label>
                  Status
                  <span className="rb-select-wrap">
                    <Icon name={statusIcon[task.status]!} />
                    <select
                      aria-label="Task status"
                      value={task.status}
                      onChange={(e) => {
                        if (e.target.value === 'done' && task.status !== 'done') complete(taskId);
                        else updateTask({ status: e.target.value as Task['status'] });
                      }}
                    >
                      {statuses.map((s) => (
                        <option key={s} value={s}>
                          {statusLabel[s]}
                        </option>
                      ))}
                    </select>
                  </span>
                </label>
                <label>
                  Priority
                  <span className="rb-select-wrap">
                    <Icon name={priorityIcon[task.priority] || 'minus'} />
                    <select
                      aria-label="Task priority"
                      value={task.priority}
                      onChange={(e) => updateTask({ priority: e.target.value as Task['priority'] })}
                    >
                      {priorities.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </span>
                </label>
              </div>
              <label>
                Due date
                <input
                  aria-label="Due date"
                  type="date"
                  value={task.dueDate ?? ''}
                  onChange={(e) => setDue(e.target.value || undefined)}
                />
                <span className="rb-quick-row">
                  <button type="button" aria-label="Due today" onClick={() => setDue(today)}>
                    Today
                  </button>
                  <button type="button" aria-label="Due tomorrow" onClick={() => setDue(addDays(today, 1))}>
                    Tomorrow
                  </button>
                  <button
                    type="button"
                    aria-label="Due one week later"
                    onClick={() => setDue(addDays(task.dueDate ?? today, 7))}
                  >
                    +1 week
                  </button>
                  {task.dueDate && (
                    <button type="button" aria-label="Clear due date" onClick={() => setDue(undefined)}>
                      Clear
                    </button>
                  )}
                </span>
              </label>
              <label>
                Assignee
                <input
                  aria-label="Task assignee"
                  placeholder="Who is taking this?"
                  maxLength={100}
                  list={assigneeOptions}
                  value={task.assignee ?? ''}
                  onBlur={() => {
                    if (task.assignee && task.assignee !== task.assignee.trim())
                      updateTask({ assignee: task.assignee.trim() });
                  }}
                  onChange={(e) => {
                    const value = e.target.value;
                    edit(
                      'Assign task',
                      (b) => {
                        if (value.trim()) b.tasks[taskId]!.assignee = value;
                        else delete b.tasks[taskId]!.assignee;
                      },
                      `${taskId}:assignee`,
                    );
                  }}
                />
                <datalist id={assigneeOptions}>
                  {[
                    ...new Set(
                      Object.values(board.tasks)
                        .map((t) => t.assignee)
                        .filter(Boolean),
                    ),
                  ]
                    .sort()
                    .map((name) => (
                      <option key={name} value={name} />
                    ))}
                </datalist>
              </label>
              <label>
                Tags · comma separated
                <TagsInput tags={task.tags} onChange={(tags) => updateTask({ tags }, 'tags')} />
              </label>
            </>
          )}
          {node && nodeId && (
            <label>
              Colour
              <span className="rb-swatches" role="radiogroup" aria-labelledby={`${uid}-colour`}>
                <Name id={`${uid}-colour`}>Card colour</Name>
                <button
                  type="button"
                  role="radio"
                  aria-checked={!node.color}
                  aria-label="No colour"
                  className={`rb-swatch rb-swatch-none${node.color ? '' : ' is-active'}`}
                  onClick={() =>
                    edit('Change colour', (b) => {
                      delete b.nodes[nodeId]!.color;
                    })
                  }
                >
                  <Icon name="slash" />
                </button>
                {colors.map((c) => (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={node.color === c}
                    aria-label={`${c} colour`}
                    key={c}
                    className={`rb-swatch rb-swatch-${c}${node.color === c ? ' is-active' : ''}`}
                    onClick={() => updateNode({ color: c })}
                  />
                ))}
              </span>
            </label>
          )}
          {task && taskId && (
            <>
              {onCard ? (
                <p className="rb-muted rb-inspector-hint">
                  <Icon name="square-pen" />
                  Description and checklist are edited on the card itself.
                </p>
              ) : (
                <>
                  <div className="rb-section-title">
                    <span>Description</span>
                    <button type="button" onClick={() => setTab(tab === 'edit' ? 'preview' : 'edit')}>
                      {tab === 'edit' ? 'Preview' : 'Edit Markdown'}
                    </button>
                  </div>
                  {tab === 'edit' ? (
                    <textarea
                      ref={description}
                      aria-label="Task description"
                      rows={4}
                      placeholder="Notes, links, Markdown…"
                      value={task.description}
                      onChange={(e) => updateTask({ description: e.target.value }, 'description')}
                    />
                  ) : (
                    <Markdown text={task.description || '*No description yet.*'} host={host} />
                  )}
                  <div className="rb-section-title">
                    <span>
                      Checklist · {task.checklist.filter((c) => c.done).length}/{task.checklist.length}
                    </span>
                  </div>
                  {task.checklist.map((item) => (
                    <div className="rb-check-item" key={item.id}>
                      <input
                        type="checkbox"
                        aria-label={`Complete checklist ${item.text}`}
                        checked={item.done}
                        onChange={(e) =>
                          edit('Toggle checklist', (b) => {
                            b.tasks[taskId]!.checklist.find((c) => c.id === item.id)!.done = e.target.checked;
                          })
                        }
                      />
                      <GrowingText
                        label="Checklist text"
                        className={item.done ? 'rb-struck' : ''}
                        value={item.text}
                        onEnter={(field) =>
                          field
                            .closest('.rb-inspector')
                            ?.querySelector<HTMLTextAreaElement>('[aria-label="New checklist item"]')
                            ?.focus()
                        }
                        onChange={(text) =>
                          edit(
                            'Edit checklist',
                            (b) => {
                              b.tasks[taskId]!.checklist.find((c) => c.id === item.id)!.text = text;
                            },
                            item.id,
                          )
                        }
                      />
                      <button
                        type="button"
                        className="rb-icon-button"
                        aria-label={`Remove checklist ${item.text}`}
                        onClick={() =>
                          updateTask({ checklist: task.checklist.filter((c) => c.id !== item.id) })
                        }
                      >
                        <Icon name="x" />
                      </button>
                    </div>
                  ))}
                  <div className="rb-check-item rb-check-new">
                    <Icon name="plus" />
                    <GrowingText
                      label="New checklist item"
                      placeholder="Add a step and press Enter"
                      value={newItem}
                      onChange={setNewItem}
                      onEnter={addItem}
                    />
                    <button type="button" aria-label="Add checklist item" onClick={addItem}>
                      Add
                    </button>
                  </div>
                </>
              )}
              <div className="rb-section-title">
                <span>
                  Prerequisites{' '}
                  {task.dependsOn.length ? (blocked(task, board) ? '· blocked' : '· satisfied') : ''}
                </span>
              </div>
              {task.dependsOn.map((id) => (
                <div className="rb-dependency" key={id}>
                  <span>
                    <Icon name={board.tasks[id]?.status === 'done' ? 'circle-check-big' : 'circle'} />
                    {board.tasks[id]?.title ?? `Missing: ${id}`}
                  </span>
                  <button
                    type="button"
                    className="rb-icon-button"
                    aria-label={`Remove prerequisite ${board.tasks[id]?.title}`}
                    onClick={() => edit('Remove dependency', (b) => setDependency(b, id, taskId, false))}
                  >
                    <Icon name="x" />
                  </button>
                </div>
              ))}
              <select
                aria-label="Add prerequisite"
                value=""
                onChange={(e) => {
                  if (e.target.value) edit('Add dependency', (b) => setDependency(b, e.target.value, taskId));
                }}
              >
                <option value="">Add prerequisite…</option>
                {Object.entries(board.tasks)
                  .filter(([id]) => id !== taskId && !task.dependsOn.includes(id))
                  .map(([id, t]) => (
                    <option key={id} value={id}>
                      {t.title}
                    </option>
                  ))}
              </select>
              <button type="button" onClick={() => focus(taskId)}>
                <Icon name="focus" />
                Focus task + dependencies
              </button>
              <div className="rb-section-title">Linked vault note</div>
              {task.notePath && <div className="rb-path">{task.notePath}</div>}
              <div className="rb-field-row">
                <button
                  type="button"
                  onClick={() => {
                    void host.pickNote().then((path) => {
                      if (path) updateTask({ notePath: path });
                    });
                  }}
                >
                  <Icon name="file-search" />
                  Choose note
                </button>
                {task.notePath && (
                  <button
                    type="button"
                    onClick={() =>
                      edit('Unlink note', (b) => {
                        delete b.tasks[taskId]!.notePath;
                      })
                    }
                  >
                    Unlink
                  </button>
                )}
              </div>
            </>
          )}
          {node?.type === 'sticky' && (
            <>
              <label>
                Markdown note
                <textarea
                  aria-label="Sticky content"
                  rows={10}
                  value={node.content}
                  onChange={(e) => updateNode({ content: e.target.value }, 'content')}
                />
              </label>
              <Markdown text={node.content} host={host} />
            </>
          )}
          {node?.type === 'note' && (
            <>
              <div className="rb-path">{node.notePath}</div>
              <button
                type="button"
                onClick={() => {
                  void host.pickNote().then((path) => {
                    if (path) updateNode({ notePath: path });
                  });
                }}
              >
                <Icon name="file-search" />
                Choose another note
              </button>
            </>
          )}
          {node?.type === 'frame' && (
            <label>
              Frame name
              <input
                aria-label="Frame name"
                value={node.title}
                onChange={(e) => updateNode({ title: e.target.value }, 'title')}
              />
            </label>
          )}
          {node && nodeId && (
            <>
              <div className="rb-section-title">Placement · absolute coordinates</div>
              <div className="rb-coordinate-grid">
                {(['x', 'y', 'width', 'height'] as const).map((key) => (
                  <label key={`${nodeId}:${key}:${node[key]}`}>
                    {key}
                    <input
                      aria-label={`Card ${key}`}
                      type="number"
                      defaultValue={Math.round(node[key])}
                      onBlur={(e) => {
                        const value = Number(e.target.value);
                        if (!Number.isFinite(value)) return;
                        edit('Change placement', (b) => {
                          if (key === 'x' || key === 'y')
                            moveNodes(b, {
                              [nodeId]: { x: key === 'x' ? value : node.x, y: key === 'y' ? value : node.y },
                            });
                          else b.nodes[nodeId]![key] = value;
                        });
                      }}
                    />
                  </label>
                ))}
              </div>
              {node.type !== 'frame' && (
                <label>
                  Frame membership
                  <select
                    aria-label="Frame membership"
                    value={node.frameId ?? ''}
                    onChange={(e) =>
                      edit('Change frame membership', (b) => {
                        if (e.target.value) b.nodes[nodeId]!.frameId = e.target.value;
                        else delete b.nodes[nodeId]!.frameId;
                      })
                    }
                  >
                    <option value="">No frame</option>
                    {Object.entries(board.nodes)
                      .filter(([, n]) => n.type === 'frame')
                      .map(([id, n]) => (
                        <option key={id} value={id}>
                          {String(n.title)}
                        </option>
                      ))}
                  </select>
                </label>
              )}
            </>
          )}
          {edge && edgeId && (
            <>
              <p className="rb-muted">Ordinary visual relationship. It does not block tasks.</p>
              <label>
                Connector label
                <input
                  aria-label="Connector label"
                  value={edge.label}
                  onChange={(e) =>
                    edit(
                      'Label connector',
                      (b) => {
                        b.edges[edgeId]!.label = e.target.value;
                      },
                      `edge:${edgeId}`,
                    )
                  }
                />
              </label>
              <button
                type="button"
                className="rb-danger"
                onClick={() => {
                  edit('Remove connector', (b) => {
                    delete b.edges[edgeId];
                  });
                  close();
                }}
              >
                <Icon name="unlink" />
                Remove connector
              </button>
            </>
          )}
          {!task && !node && !edge && (
            <>
              <label>
                Board title
                <input
                  aria-label="Board title"
                  value={board.title}
                  onChange={(e) =>
                    edit(
                      'Rename board',
                      (b) => {
                        b.title = e.target.value || ' ';
                      },
                      'board-title',
                    )
                  }
                />
              </label>
              <label>
                Board timezone
                <input
                  aria-label="Board timezone"
                  defaultValue={board.timeZone}
                  key={board.timeZone}
                  onBlur={(e) =>
                    edit('Change timezone', (b) => {
                      b.timeZone = e.target.value;
                    })
                  }
                />
              </label>
              <div className="rb-section-title">Working together</div>
              <p className="rb-muted">
                {host.deviceName
                  ? `Edits from this device are stamped as “${host.deviceName}”, so overlapping changes from another device resolve by recency and the activity feed can say who changed what.`
                  : 'Set a device name in Roseboard settings to stamp your edits. Without a name, overlapping changes keep the local value and are listed for review.'}
              </p>
              <p className="rb-muted">
                Changes that arrive from another device are merged into your open board; cards they touched
                glow briefly. Sync itself is handled by your vault sync plugin.
              </p>
              <div className="rb-section-title">Shortcuts</div>
              <dl className="rb-shortcuts">
                <dt>V · H · P · E</dt>
                <dd>Select · Hand · Draw · Erase</dd>
                <dt>Space + drag</dt>
                <dd>Pan while in Select mode</dd>
                <dt>Double-click canvas</dt>
                <dd>New task there</dd>
                <dt>Double-click title</dt>
                <dd>Rename in place</dd>
                <dt>Arrows · Shift+Arrows</dt>
                <dd>Nudge cards 8px · 32px</dd>
                <dt>⌘/Ctrl Z · ⇧Z</dt>
                <dd>Undo · redo</dd>
                <dt>⌘/Ctrl D · Delete</dt>
                <dd>Duplicate · remove card</dd>
                <dt>⌘/Ctrl A · Esc</dt>
                <dd>Select all · clear</dd>
                <dt>1 · ⇧1 · ⇧2</dt>
                <dd>100 % · fit all · fit selection</dd>
                <dt>Right-click</dt>
                <dd>Card and canvas menus</dd>
              </dl>
            </>
          )}
        </fieldset>
        {stamped?.updatedAt && (
          <p className="rb-muted rb-stamp">
            <Icon name="history" />
            Updated {relative(stamped.updatedAt)}
            {stamped.updatedBy ? ` by ${stamped.updatedBy}` : ''}
          </p>
        )}
        {(task?.notePath || node?.type === 'note') && (
          <>
            <div className="rb-inspector-document">
              <NoteContent
                host={host}
                path={task?.notePath ?? (node as { notePath: string }).notePath}
                compact
              />
            </div>
            <button
              type="button"
              onClick={() => previewNote(task?.notePath ?? (node as { notePath: string }).notePath)}
            >
              <Icon name="book-open" />
              Read on canvas
            </button>
            <button
              type="button"
              onClick={() => host.openNote(task?.notePath ?? (node as { notePath: string }).notePath)}
            >
              <Icon name="arrow-up-right" />
              Open linked note
            </button>
          </>
        )}
        {task && taskId && (
          <button
            type="button"
            className="rb-danger"
            disabled={readOnly}
            onClick={() => {
              void host
                .confirm(
                  'Delete task?',
                  'This deletes the task record, its card, and references to it in prerequisites. You can undo this action. Removing a card alone keeps the task.',
                )
                .then((ok) => {
                  if (ok) {
                    edit('Delete task', (b) => deleteTask(b, taskId));
                    close();
                  }
                });
            }}
          >
            <Icon name="trash-2" />
            Delete task…
          </button>
        )}
      </div>
    </aside>
  );
}

function parseTags(text: string): string[] {
  return [
    ...new Set(
      text
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
    ),
  ];
}
function TagsInput({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const [text, setText] = useState(tags.join(', '));
  useEffect(() => {
    if (JSON.stringify(parseTags(text)) !== JSON.stringify(tags)) setText(tags.join(', '));
  }, [tags]);
  return (
    <input
      aria-label="Task tags"
      placeholder="project, idea"
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        onChange(parseTags(event.target.value));
      }}
    />
  );
}
/**
 * Single-paragraph text that wraps and grows with its content instead of scrolling sideways.
 * Enter never inserts a newline; it runs `onEnter` (commit, or move to the next field).
 */
function GrowingText({
  value,
  label,
  placeholder,
  className = '',
  onChange,
  onEnter,
}: {
  value: string;
  label: string;
  placeholder?: string;
  className?: string;
  onChange: (text: string) => void;
  onEnter: (field: HTMLTextAreaElement) => void;
}) {
  const field = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    el.setCssStyles({ height: 'auto' });
    el.setCssStyles({ height: `${el.scrollHeight + 2}px` });
  }, [value]);
  return (
    <textarea
      ref={field}
      rows={1}
      aria-label={label}
      placeholder={placeholder}
      className={`rb-growing ${className}`}
      maxLength={2000}
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\r?\n/g, ' '))}
      onKeyDown={(e: KeyboardEvent) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
          e.preventDefault();
          onEnter(e.currentTarget as HTMLTextAreaElement);
        }
      }}
    />
  );
}
