import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import type { Draft } from 'immer';
import { newId, type Task } from '../domain/model';
import type { BoardHost } from './ports';
import { Markdown } from './Markdown';
import { Icon } from './icons';

type Change = (task: Draft<Task>) => void;
/** Keeps typing inside a card from reaching React Flow (arrow-key moves, selection, panning). */
const contain = {
  onPointerDown: (event: { stopPropagation: () => void }) => event.stopPropagation(),
  onClick: (event: { stopPropagation: () => void }) => event.stopPropagation(),
  onDoubleClick: (event: { stopPropagation: () => void }) => event.stopPropagation(),
};

/** Keep wrapped text visible when typing or changing the card width. */
function useGrowingField(field: RefObject<HTMLTextAreaElement | null>, text: string) {
  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    const grow = () => {
      el.setCssStyles({ height: '0px' });
      el.setCssStyles({ height: `${el.scrollHeight + 2}px` });
      el.dispatchEvent(new CustomEvent('roseboard-fit', { bubbles: true }));
    };
    grow();
    // Rewrap while resizing the card without observing our own height changes.
    let width = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      grow();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [field, text]);
}

/** Multi-line field that grows with its text. Blur or Cmd/Ctrl+Enter saves; Escape cancels. */
function GrowingField({
  initial,
  label,
  placeholder,
  onCommit,
  onCancel,
}: {
  initial: string;
  label: string;
  placeholder: string;
  onCommit: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const field = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  const finish = (cancel = false) => {
    if (done.current) return;
    done.current = true;
    if (cancel) onCancel();
    else onCommit(text);
  };
  useEffect(() => {
    const el = field.current;
    el?.focus();
    el?.setSelectionRange(el.value.length, el.value.length);
  }, []);
  useGrowingField(field, text);
  return (
    <textarea
      ref={field}
      className="rb-card-field rb-card-desc-field nodrag nopan nowheel"
      aria-label={label}
      placeholder={placeholder}
      data-fit-min="60"
      maxLength={100000}
      rows={2}
      value={text}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => finish()}
      onKeyDown={(event: KeyboardEvent) => {
        event.stopPropagation();
        if (event.key === 'Escape') {
          event.preventDefault();
          finish(true);
        } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          finish();
        }
      }}
      {...contain}
    />
  );
}

/** Wrapping field for a checklist step. Enter saves; `keepOpen` clears it for the next step. */
function StepField({
  initial = '',
  label,
  placeholder,
  keepOpen = false,
  onCommit,
  onClose,
}: {
  initial?: string;
  label: string;
  placeholder: string;
  keepOpen?: boolean;
  onCommit: (text: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(initial);
  const field = useRef<HTMLTextAreaElement>(null);
  const cancelled = useRef(false);
  useEffect(() => {
    field.current?.focus();
    if (initial) field.current?.select();
  }, [initial]);
  useGrowingField(field, text);
  const save = () => {
    const value = text.trim();
    if (value && value !== initial) onCommit(value);
    return value;
  };
  return (
    <textarea
      ref={field}
      className="rb-card-field rb-card-step-field nodrag nopan nowheel"
      aria-label={label}
      placeholder={placeholder}
      maxLength={2000}
      rows={1}
      data-fit-min="32"
      value={text}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => {
        if (!cancelled.current) save();
        onClose();
      }}
      onKeyDown={(event: KeyboardEvent) => {
        event.stopPropagation();
        if (event.key === 'Escape') {
          event.preventDefault();
          // Escape discards the text in this field only; earlier steps are already saved.
          cancelled.current = true;
          onClose();
        } else if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
          event.preventDefault();
          // A kept-open field saves here; otherwise blur performs the single save.
          if (keepOpen && save()) setText('');
          else field.current?.blur();
        }
      }}
      {...contain}
    />
  );
}

/** Steps shown before the list scrolls; the card grows to this many rows at most on Show more. */
const MAX_ROWS = 10;
const DEFAULT_ROWS = 3;

/**
 * Description and checklist, read and written directly on the task card. The card keeps the size
 * the person gave it as a minimum, with room reserved for readable text and three checklist rows.
 * Long content scrolls; Show more reserves up to ten rows. These fitted sizes are view-only.
 */
export function TaskBody({
  taskId,
  task,
  host,
  readOnly,
  editTask,
  toggleCheck,
}: {
  taskId: string;
  task: Task;
  host: BoardHost;
  readOnly: boolean;
  editTask: (taskId: string, label: string, change: Change) => void;
  toggleCheck: (taskId: string, itemId: string) => void;
}) {
  // 'description', 'new-step', or the ID of the step being renamed.
  const [editing, setEditing] = useState<string>();
  const [open, setOpen] = useState(true);
  const [rows, setRows] = useState(DEFAULT_ROWS);
  const [descriptionMinimum, setDescriptionMinimum] = useState(64);
  const [listMinimum, setListMinimum] = useState(96);
  const preview = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const hasDescription = !!task.description.trim();
  const steps = task.checklist;
  const done = steps.filter((item) => item.done).length;
  const adding = editing === 'new-step';
  const change = (label: string, fn: Change) => editTask(taskId, label, fn);
  // Measure wrapped rows, not a nominal line count, so a narrow card keeps useful content visible.
  const measure = () => {
    const text = preview.current,
      items = list.current;
    if (text) setDescriptionMinimum(Math.min(84, Math.max(24, text.firstElementChild?.scrollHeight ?? 0)));
    if (items) {
      const visible = [...items.children].slice(0, rows);
      setListMinimum(
        Math.min(
          320,
          visible.reduce((height, item) => height + (item as HTMLElement).offsetHeight, 0),
        ),
      );
    }
  };
  useLayoutEffect(measure);
  useEffect(() => {
    const observer = new ResizeObserver(measure);
    if (preview.current) observer.observe(preview.current);
    if (list.current) observer.observe(list.current);
    for (const item of list.current?.children ?? []) observer.observe(item);
    return () => observer.disconnect();
  }, [open, hasDescription, steps.length, editing, rows]);
  useEffect(() => {
    if (adding) list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [adding, steps.length]);
  const toggleOpen = () => {
    if (open) {
      setRows(DEFAULT_ROWS);
      if (adding) setEditing(undefined);
    }
    setOpen(!open);
  };
  return (
    <div
      className="rb-task-body"
      onKeyDown={(event) => {
        // Focused content scrolls/selects text; it must not nudge or delete the card.
        if (!((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z')) event.stopPropagation();
      }}
    >
      {editing === 'description' ? (
        <GrowingField
          initial={task.description}
          label="Edit task description"
          placeholder="Add details, links or Markdown…"
          onCommit={(text) => {
            setEditing(undefined);
            if (text !== task.description)
              change('Edit description', (t) => {
                t.description = text;
              });
          }}
          onCancel={() => setEditing(undefined)}
        />
      ) : hasDescription ? (
        <div
          ref={preview}
          className="rb-card-desc rb-fit-min nodrag nopan nowheel"
          style={{ minHeight: descriptionMinimum }}
          tabIndex={0}
          role="region"
          aria-label="Task description"
          title={readOnly ? undefined : 'Double-click to edit'}
          onDoubleClick={(event) => {
            if (readOnly || (event.target as HTMLElement).closest('a,button')) return;
            event.stopPropagation();
            setEditing('description');
          }}
        >
          <Markdown text={task.description} host={host} />
        </div>
      ) : (
        !readOnly && (
          <button
            className="rb-card-desc-empty nodrag"
            onClick={(event) => {
              event.stopPropagation();
              setEditing('description');
            }}
          >
            Add a description…
          </button>
        )
      )}
      {(steps.length > 0 || adding) && (
        <section
          className={`rb-card-steps rb-fit-min${open ? ' is-open' : ''}${open && steps.length > DEFAULT_ROWS ? ' has-more' : ''}${!readOnly && !adding ? ' can-add' : ''}`}
          style={{ '--rb-list-height': `${listMinimum}px` } as CSSProperties}
        >
          <button
            className="rb-card-steps-head nodrag"
            aria-expanded={open}
            aria-label={`${open ? 'Hide' : 'Show'} checklist, ${done} of ${steps.length} done`}
            onClick={(event) => {
              event.stopPropagation();
              toggleOpen();
            }}
          >
            <Icon name="chevron-right" className="rb-card-steps-chevron" />
            <span>Checklist</span>
            <span className="rb-card-steps-count">
              {done}/{steps.length}
            </span>
            <span className="rb-progress-bar" aria-hidden="true">
              <span style={{ width: `${steps.length ? Math.round((done / steps.length) * 100) : 0}%` }} />
            </span>
          </button>
          {open && (
            <ul
              ref={list}
              className="rb-card-checklist nodrag nopan nowheel"
              tabIndex={0}
              aria-label="Checklist steps"
            >
              {steps.map((item) => (
                <li
                  key={item.id}
                  className={item.done ? 'is-done' : ''}
                  onDoubleClick={(event) => {
                    if (
                      readOnly ||
                      editing === item.id ||
                      (event.target as HTMLElement).closest('button,textarea')
                    )
                      return;
                    event.stopPropagation();
                    setEditing(item.id);
                  }}
                >
                  <button
                    className="rb-card-check nodrag"
                    role="checkbox"
                    aria-checked={item.done}
                    aria-label={`${item.done ? 'Reopen' : 'Complete'} step ${item.text}`}
                    disabled={readOnly}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleCheck(taskId, item.id);
                    }}
                  >
                    <Icon name={item.done ? 'square-check' : 'square'} />
                  </button>
                  {editing === item.id ? (
                    <StepField
                      initial={item.text}
                      label="Edit step"
                      placeholder="Step"
                      onCommit={(text) =>
                        change('Edit checklist', (t) => {
                          const step = t.checklist.find((c) => c.id === item.id);
                          if (step) step.text = text;
                        })
                      }
                      onClose={() => setEditing(undefined)}
                    />
                  ) : (
                    <span
                      className="rb-card-step-text"
                      title={readOnly ? undefined : 'Double-click to rename'}
                    >
                      {item.text.trim() || 'Untitled step'}
                    </span>
                  )}
                  {!readOnly && editing !== item.id && (
                    <button
                      className="rb-card-step-remove nodrag"
                      aria-label={`Remove step ${item.text}`}
                      title="Remove step"
                      onClick={(event) => {
                        event.stopPropagation();
                        change('Remove checklist item', (t) => {
                          t.checklist = t.checklist.filter((c) => c.id !== item.id);
                        });
                      }}
                    >
                      <Icon name="x" />
                    </button>
                  )}
                </li>
              ))}
              {adding && (
                <li className="rb-card-step-new">
                  <span className="rb-card-check" aria-hidden="true">
                    <Icon name="square" />
                  </span>
                  <StepField
                    label="New step"
                    placeholder="New step, then Enter"
                    keepOpen
                    onCommit={(text) =>
                      change('Add checklist item', (t) => {
                        t.checklist.push({ id: newId('check'), text, done: false });
                      })
                    }
                    onClose={() => setEditing(undefined)}
                  />
                </li>
              )}
            </ul>
          )}
          {open && !readOnly && !adding && (
            <div className="rb-card-step-add">
              <button
                className="nodrag"
                onClick={(event) => {
                  event.stopPropagation();
                  setEditing('new-step');
                }}
              >
                <Icon name="plus" />
                Add step
              </button>
            </div>
          )}
          {/* Keep this control independent of measured overflow: its own height changes overflow. */}
          {open && steps.length > DEFAULT_ROWS && (
            <button
              className="rb-card-steps-more nodrag"
              onClick={(event) => {
                event.stopPropagation();
                setRows(rows < MAX_ROWS ? MAX_ROWS : DEFAULT_ROWS);
              }}
            >
              {rows < MAX_ROWS ? 'Show more' : 'Show less'}
            </button>
          )}
        </section>
      )}
      {!readOnly && !editing && (
        // Floats in the card's top-right corner on hover, so it never adds height.
        <div className="rb-card-actions">
          <button
            className="nodrag"
            aria-label={hasDescription ? 'Edit description' : 'Add description'}
            title={hasDescription ? 'Edit description' : 'Add description'}
            onClick={(event) => {
              event.stopPropagation();
              setEditing('description');
            }}
          >
            <Icon name={hasDescription ? 'pencil' : 'align-left'} />
          </button>
          <button
            className="nodrag"
            aria-label={steps.length ? 'Add step' : 'Add checklist'}
            title={steps.length ? 'Add step' : 'Add checklist'}
            onClick={(event) => {
              event.stopPropagation();
              setOpen(true);
              setEditing('new-step');
            }}
          >
            <Icon name="list-plus" />
          </button>
        </div>
      )}
    </div>
  );
}
