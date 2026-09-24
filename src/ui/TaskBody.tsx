import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
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
  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    el.setCssStyles({ height: 'auto' });
    el.setCssStyles({ height: `${el.scrollHeight + 2}px` });
    // The card re-measures its content height as the field grows.
    el.dispatchEvent(new CustomEvent('roseboard-fit', { bubbles: true }));
  }, [text]);
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

/** One-line field for a checklist step. Enter saves; `keepOpen` clears it for the next step. */
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
  const field = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);
  useEffect(() => {
    field.current?.focus();
    if (initial) field.current?.select();
  }, [initial]);
  const save = () => {
    const value = text.trim();
    if (value && value !== initial) onCommit(value);
    return value;
  };
  return (
    <input
      ref={field}
      className="rb-card-field rb-card-step-field nodrag nopan"
      aria-label={label}
      placeholder={placeholder}
      maxLength={2000}
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

/**
 * Description and checklist, read and written directly on the task card. The card keeps the size
 * the person gave it: the description fills the room it has, and the checklist is a collapsible
 * section that scrolls. An open checklist always shows at least one step, and Show more asks the
 * view for room for up to ten. Those extra rows are view-only; the saved size never changes.
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
  const [rows, setRows] = useState(1);
  const [hidden, setHidden] = useState(false);
  const [clamped, setClamped] = useState(false);
  const preview = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const hasDescription = !!task.description.trim();
  const steps = task.checklist;
  const done = steps.filter((item) => item.done).length;
  const adding = editing === 'new-step';
  const change = (label: string, fn: Change) => editTask(taskId, label, fn);
  // Whether text or steps are cut off decides the description fade and the Show more button.
  const measure = () => {
    const text = preview.current,
      items = list.current;
    setClamped(!!text && text.scrollHeight > text.clientHeight + 1);
    setHidden(!!items && items.scrollHeight > items.clientHeight + 1);
  };
  useLayoutEffect(measure);
  useEffect(() => {
    const observer = new ResizeObserver(measure);
    if (preview.current) observer.observe(preview.current);
    if (list.current) observer.observe(list.current);
    return () => observer.disconnect();
  }, [open, hasDescription, steps.length]);
  useEffect(() => {
    if (adding) list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [adding, steps.length]);
  const rowCount = Math.max(1, Math.min(rows, steps.length + (adding || !readOnly ? 1 : 0)));
  const toggleOpen = () => {
    if (open) {
      setRows(1);
      if (adding) setEditing(undefined);
    }
    setOpen(!open);
  };
  return (
    <div className="rb-task-body">
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
          className={`rb-card-desc rb-fit-min${clamped ? ' is-clamped' : ''}`}
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
          className={`rb-card-steps rb-fit-min${open ? ' is-open' : ''}${open && (hidden || rows > 1) ? ' has-more' : ''}`}
          style={{ '--rb-rows': rowCount } as CSSProperties}
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
            <ul ref={list} className="rb-card-checklist nowheel">
              {steps.map((item) => (
                <li
                  key={item.id}
                  className={item.done ? 'is-done' : ''}
                  onDoubleClick={(event) => {
                    if (
                      readOnly ||
                      editing === item.id ||
                      (event.target as HTMLElement).closest('button,input')
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
              {adding ? (
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
              ) : (
                !readOnly && (
                  <li className="rb-card-step-add">
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
                  </li>
                )
              )}
            </ul>
          )}
          {open && (hidden || rows > 1) && (
            <button
              className="rb-card-steps-more nodrag"
              onClick={(event) => {
                event.stopPropagation();
                setRows(hidden && rows < MAX_ROWS ? MAX_ROWS : 1);
              }}
            >
              {hidden && rows < MAX_ROWS ? 'Show more' : 'Show less'}
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
