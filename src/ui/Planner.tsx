import { useId, useMemo, useState, type DragEvent, type ReactNode } from 'react';
import {
  addDays,
  blocked,
  dateOnly,
  newId,
  newTask,
  overdue,
  routinesOf,
  weekdays,
  type Board,
  type Routine,
  type Task,
} from '../domain/model';
import {
  calendarDays,
  dateLabel,
  isoWeekday,
  monthOf,
  plannerTasks,
  repeatLabel,
  routineOrder,
  routinesOn,
  shiftMonth,
  streak,
  weekOf,
} from '../domain/planner';
import {
  addRoutine,
  moveRoutine,
  placeTask,
  removeRoutine,
  toggleRoutine,
  type Edit,
} from '../domain/commands';
import type { BoardHost, MenuItemSpec } from './ports';
import { Name } from './Name';
import { Icon } from './icons';
import { formatDue } from './Nodes';

type TaskEntry = [string, Task];
const DRAG_TYPE = 'text/roseboard-task';
const weekdayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** Drop target props shared by the day list, the week strip, the tray and calendar cells. */
function useDrop(readOnly: boolean, onTask: (id: string, target: string) => void) {
  const [over, setOver] = useState<string>();
  const target = (key: string, enabled = true) => ({
    onDragOver: (event: DragEvent) => {
      if (readOnly || !enabled || !event.dataTransfer.types.includes(DRAG_TYPE)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      if (over !== key) setOver(key);
    },
    onDragLeave: (event: DragEvent) => {
      if (!(event.currentTarget as Node).contains(event.relatedTarget as Node | null)) setOver(undefined);
    },
    onDrop: (event: DragEvent) => {
      event.preventDefault();
      setOver(undefined);
      const id = event.dataTransfer.getData(DRAG_TYPE);
      if (id && !readOnly && enabled) onTask(id, key);
    },
  });
  return { over, clear: () => setOver(undefined), target };
}

export function Planner({
  host,
  board,
  matching,
  today,
  date,
  setDate,
  view,
  readOnly,
  activeTask,
  edit,
  select,
  complete,
}: {
  host: BoardHost;
  board: Board;
  matching: Set<string>;
  today: string;
  date: string;
  setDate: (date: string) => void;
  view: 'day' | 'calendar';
  readOnly: boolean;
  activeTask?: string;
  edit: (label: string, action: Edit, key?: string) => void;
  select: (id: string) => void;
  complete: (id: string) => void;
}) {
  const uid = useId();
  const [title, setTitle] = useState('');
  const groups = useMemo(() => plannerTasks(board, matching, date, today), [board, matching, date, today]);
  const byDate = useMemo(() => {
    const dates = new Map<string, TaskEntry[]>();
    for (const [id, task] of Object.entries(board.tasks))
      if (task.dueDate && matching.has(id))
        dates.set(task.dueDate, [...(dates.get(task.dueDate) ?? []), [id, task]]);
    return dates;
  }, [board, matching]);
  const done = groups.day.filter(([, task]) => task.status === 'done').length;
  const schedule = (id: string, due?: string) => {
    if (readOnly || (due && !dateOnly.safeParse(due).success)) return;
    const task = board.tasks[id];
    if (!task || task.dueDate === due) return;
    edit(due ? 'Schedule task' : 'Clear due date', (b) => {
      const t = b.tasks[id];
      if (!t) return;
      if (due) t.dueDate = due;
      else delete t.dueDate;
    });
  };
  const drop = useDrop(readOnly, (id, key) => {
    if (!board.tasks[id]) return;
    schedule(id, key === 'unscheduled' ? undefined : key === 'day' ? date : key);
  });
  const choose = (value: string) => {
    if (dateOnly.safeParse(value).success) setDate(value);
  };
  const menu = (id: string, event: { clientX: number; clientY: number }) =>
    host.showMenu({ x: event.clientX, y: event.clientY }, [
      { title: 'Due date', label: true },
      { title: 'Today', icon: 'sun', disabled: readOnly, action: () => schedule(id, today) },
      {
        title: 'Tomorrow',
        icon: 'calendar-plus',
        disabled: readOnly,
        action: () => schedule(id, addDays(today, 1)),
      },
      {
        title: `Selected day · ${date}`,
        icon: 'calendar',
        disabled: readOnly,
        action: () => schedule(id, date),
      },
      {
        title: 'Next week',
        icon: 'calendar-range',
        disabled: readOnly,
        action: () => schedule(id, addDays(date, 7)),
      },
      { title: 'Remove date', icon: 'calendar-x', disabled: readOnly, action: () => schedule(id) },
      { separator: true },
      { title: 'Open details', icon: 'panel-right', action: () => select(id) },
    ]);
  const meta = (task: Task) => {
    const items: ReactNode[] = [];
    if (task.status === 'doing')
      items.push(
        <span key="doing" className="rb-agenda-doing">
          In progress
        </span>,
      );
    if (task.dueDate && task.dueDate !== date)
      items.push(
        <span key="due" className={overdue(task, today) ? 'rb-overdue' : ''}>
          {formatDue(task.dueDate, today)}
        </span>,
      );
    if (task.assignee)
      items.push(
        <span key="who" className="rb-meta">
          <Icon name="user-round" />
          {task.assignee}
        </span>,
      );
    if (task.priority !== 'none')
      items.push(
        <span key="priority" className={`rb-priority-${task.priority}`}>
          {task.priority} priority
        </span>,
      );
    if (blocked(task, board) && task.status !== 'done')
      items.push(
        <span key="blocked" className="rb-overdue">
          Blocked
        </span>,
      );
    if (task.checklist.length)
      items.push(
        <span key="steps">
          {task.checklist.filter((item) => item.done).length}/{task.checklist.length} steps
        </span>,
      );
    return items.length ? <span className="rb-agenda-meta">{items}</span> : null;
  };
  const taskRow = ([id, task]: TaskEntry, unscheduled = false) => (
    <article
      key={id}
      className={`rb-agenda-task${id === activeTask ? ' is-active' : ''}${task.status === 'done' ? ' rb-done' : ''}`}
      draggable={!readOnly}
      title={readOnly ? undefined : 'Drag onto a day to reschedule'}
      onDragStart={(event) => {
        event.dataTransfer.setData(DRAG_TYPE, id);
        event.dataTransfer.effectAllowed = 'move';
        event.currentTarget.classList.add('is-dragging');
      }}
      onDragEnd={(event) => {
        event.currentTarget.classList.remove('is-dragging');
        drop.clear();
      }}
    >
      {!readOnly && (
        <span className="rb-grip" aria-hidden="true">
          <Icon name="grip-vertical" />
        </span>
      )}
      <button
        className="rb-complete"
        disabled={readOnly}
        aria-label={`${task.status === 'done' ? 'Reopen' : 'Complete'} ${task.title}`}
        onClick={() => complete(id)}
      >
        <Icon name={task.status === 'done' ? 'circle-check-big' : 'circle'} />
      </button>
      <button className="rb-agenda-title" onClick={() => select(id)}>
        <strong>{task.title}</strong>
        {meta(task)}
      </button>
      {unscheduled && (
        <button
          className="rb-plan-button"
          disabled={readOnly}
          aria-label={`Schedule ${task.title} for ${date}`}
          title={`Plan for ${dateLabel(date, { month: 'short', day: 'numeric' })}`}
          onClick={() => schedule(id, date)}
        >
          <Icon name="calendar-plus" />
          Plan
        </button>
      )}
      <button
        className="rb-icon-button rb-row-menu"
        disabled={readOnly}
        aria-label={`Reschedule ${task.title}`}
        title="Reschedule"
        onClick={(event) => menu(id, event)}
      >
        <Icon name="ellipsis" />
      </button>
    </article>
  );
  const composer = (
    <form
      className="rb-planner-composer"
      onSubmit={(event) => {
        event.preventDefault();
        if (readOnly || !title.trim()) return;
        edit('Add daily task', (b) => {
          const id = newId('task');
          b.tasks[id] = { ...newTask(title.trim()), dueDate: date };
          placeTask(b, id);
        });
        setTitle('');
      }}
    >
      <Icon name="plus" />
      <input
        maxLength={500}
        disabled={readOnly}
        aria-label="New daily task"
        placeholder={`Add a task for ${date === today ? 'today' : dateLabel(date, { weekday: 'long' })}…`}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
      />
      <button type="submit" className="rb-primary" disabled={readOnly || !title.trim()}>
        Add
      </button>
    </form>
  );
  const tasksCard = (
    <section
      className={`rb-day-card rb-day-tasks${drop.over === 'day' ? ' is-over' : ''}`}
      aria-labelledby={`${uid}-tasks`}
      {...drop.target('day')}
    >
      <Name id={`${uid}-tasks`}>Selected day tasks</Name>
      <header className="rb-day-card-head">
        <span className="rb-day-card-icon">
          <Icon name="list-checks" />
        </span>
        <div>
          <h2>{view === 'calendar' ? dateLabel(date, { month: 'long', day: 'numeric' }) : 'Tasks'}</h2>
          <p>
            {view === 'calendar'
              ? dateLabel(date, { weekday: 'long' })
              : `Due ${date === today ? 'today' : dateLabel(date, { weekday: 'long', month: 'short', day: 'numeric' })}`}
          </p>
        </div>
        <span className="rb-day-count">
          {done}/{groups.day.length}
        </span>
      </header>
      <Name id={`${uid}-progress`}>Daily task progress</Name>
      <progress
        className="rb-day-progress"
        aria-labelledby={`${uid}-progress`}
        value={done}
        max={groups.day.length || 1}
      />
      {composer}
      <div className="rb-agenda-rows">{groups.day.map((entry) => taskRow(entry))}</div>
      {!groups.day.length && (
        <div className="rb-planner-empty">
          <Icon name="sun" />
          <h3>Nothing planned yet.</h3>
          <p>Add a task above, or drag one here from Unscheduled.</p>
        </div>
      )}
      {view === 'day' && date === today && groups.overdue.length > 0 && (
        <section className="rb-overdue-section" aria-labelledby={`${uid}-overdue`}>
          <Name id={`${uid}-overdue`}>Overdue tasks</Name>
          <h3>
            <Icon name="alarm-clock" />
            Overdue <span>{groups.overdue.length}</span>
            <button
              className="rb-text-button"
              disabled={readOnly}
              onClick={() =>
                edit('Move overdue to today', (b) => {
                  for (const [id] of groups.overdue) if (b.tasks[id]) b.tasks[id]!.dueDate = today;
                })
              }
            >
              Move all to today
            </button>
          </h3>
          <div className="rb-agenda-rows">{groups.overdue.map((entry) => taskRow(entry))}</div>
        </section>
      )}
    </section>
  );
  const unscheduledCard = (
    <section
      className={`rb-day-card rb-unscheduled${drop.over === 'unscheduled' ? ' is-over' : ''}`}
      aria-labelledby={`${uid}-unscheduled`}
      {...drop.target('unscheduled')}
    >
      <Name id={`${uid}-unscheduled`}>Unscheduled tasks</Name>
      <header className="rb-day-card-head">
        <span className="rb-day-card-icon">
          <Icon name="inbox" />
        </span>
        <div>
          <h2>Unscheduled</h2>
          <p>
            Drag onto a day, or Plan for{' '}
            {date === today ? 'today' : dateLabel(date, { month: 'short', day: 'numeric' })}
          </p>
        </div>
        <span className="rb-day-count">{groups.unscheduled.length}</span>
      </header>
      <div className="rb-agenda-rows">{groups.unscheduled.map((entry) => taskRow(entry, true))}</div>
      {!groups.unscheduled.length && (
        <p className="rb-muted rb-day-note">No unscheduled tasks. Drop a task here to clear its date.</p>
      )}
    </section>
  );
  if (view === 'calendar')
    return (
      <Calendar
        {...{ board, date, today, readOnly, byDate, choose, setDate, select, drop }}
        sidebar={
          <>
            {tasksCard}
            {unscheduledCard}
          </>
        }
      />
    );
  const routines = routinesOn(board, date);
  const routinesDone = routines.filter(([, r]) => r.done.includes(date)).length;
  const week = weekOf(date);
  const summary = [
    groups.day.length ? `${done} of ${groups.day.length} tasks done` : 'No tasks planned',
    routines.length ? `${routinesDone} of ${routines.length} routines` : '',
    date === today && groups.overdue.length ? `${groups.overdue.length} overdue` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const openOn = (day: string) => (byDate.get(day) ?? []).filter(([, task]) => task.status !== 'done').length;
  return (
    <section className="rb-planner rb-planner-day" aria-labelledby={`${uid}-planner`}>
      <Name id={`${uid}-planner`}>Daily planner</Name>
      <header className="rb-day-header">
        <div className="rb-day-title">
          <span className="rb-eyebrow">
            {date === today
              ? `TODAY · ${dateLabel(date, { weekday: 'long' }).toUpperCase()}`
              : dateLabel(date, { weekday: 'long' }).toUpperCase()}
          </span>
          <h1>
            {dateLabel(date, {
              month: 'long',
              day: 'numeric',
              year: date.slice(0, 4) === today.slice(0, 4) ? undefined : 'numeric',
            })}
          </h1>
          <p>
            {summary}
            <span className="rb-day-zone">{board.timeZone}</span>
          </p>
        </div>
        <DateNavigation {...{ date, today, setDate, choose }} step={(d, n) => addDays(d, n)} unit="day" />
      </header>
      <nav className="rb-week" aria-labelledby={`${uid}-week`}>
        <Name id={`${uid}-week`}>Week</Name>
        {week.map((day) => {
          const count = openOn(day);
          const scheduled = routinesOn(board, day);
          const ticked = scheduled.filter(([, r]) => r.done.includes(day)).length;
          return (
            <button
              key={day}
              className={`rb-week-day${day === date ? ' is-selected' : ''}${day === today ? ' is-today' : ''}${drop.over === day ? ' is-over' : ''}${day < today ? ' is-past' : ''}`}
              aria-pressed={day === date}
              aria-label={`${dateLabel(day, { weekday: 'long', month: 'long', day: 'numeric' })}: ${count} open task${count === 1 ? '' : 's'}`}
              onClick={() => choose(day)}
              {...drop.target(day)}
            >
              <span className="rb-week-name">{dateLabel(day, { weekday: 'short' })}</span>
              <strong>{Number(day.slice(-2))}</strong>
              <span className="rb-week-marks" aria-hidden="true">
                {count > 0 && <span className="rb-week-count">{count > 9 ? '9+' : count}</span>}
                {scheduled.length > 0 && (
                  <span
                    className={`rb-week-ring${ticked === scheduled.length ? ' is-complete' : ''}`}
                    title={`${ticked}/${scheduled.length} routines`}
                  />
                )}
              </span>
            </button>
          );
        })}
      </nav>
      <div className="rb-day-grid">
        {tasksCard}
        <div className="rb-day-side">
          <Routines {...{ board, date, today, readOnly, edit, host }} />
          {unscheduledCard}
        </div>
      </div>
    </section>
  );
}

function DateNavigation({
  date,
  today,
  setDate,
  choose,
  step,
  unit,
}: {
  date: string;
  today: string;
  setDate: (date: string) => void;
  choose: (date: string) => void;
  step: (date: string, offset: number) => string;
  unit: 'day' | 'month';
}) {
  return (
    <div className="rb-date-navigation">
      <button
        className="rb-icon-button"
        aria-label={unit === 'month' ? 'Previous month' : 'Previous day'}
        onClick={() => choose(step(date, -1))}
      >
        <Icon name="chevron-left" />
      </button>
      <button disabled={date === today && unit === 'day'} onClick={() => setDate(today)}>
        Today
      </button>
      <button
        className="rb-icon-button"
        aria-label={unit === 'month' ? 'Next month' : 'Next day'}
        onClick={() => choose(step(date, 1))}
      >
        <Icon name="chevron-right" />
      </button>
      <input
        type="date"
        min="0001-01-01"
        max="9999-12-31"
        aria-label="Planner date"
        value={date}
        onChange={(event) => choose(event.target.value)}
      />
    </div>
  );
}

/** Routines repeat on chosen weekdays and are ticked off per day. They never become tasks. */
function Routines({
  board,
  date,
  today,
  readOnly,
  edit,
  host,
}: {
  board: Board;
  date: string;
  today: string;
  readOnly: boolean;
  edit: (label: string, action: Edit, key?: string) => void;
  host: BoardHost;
}) {
  const uid = useId();
  const [title, setTitle] = useState('');
  const [renaming, setRenaming] = useState<string>();
  const all = Object.entries(routinesOf(board)).sort(routineOrder);
  const scheduled = routinesOn(board, date);
  const resting = all.length - scheduled.length;
  const future = date > today;
  const done = scheduled.filter(([, r]) => r.done.includes(date)).length;
  const setDays = (id: string, days: number[]) =>
    edit('Change routine days', (b) => {
      const routine = b.routines?.[id];
      if (routine && days.length) routine.days = [...days].sort();
    });
  const menu = (id: string, routine: Routine, event: { clientX: number; clientY: number }) => {
    const is = (days: number[]) => routine.days.slice().sort().join() === days.join();
    const presets: [string, number[]][] = [
      ['Every day', [...weekdays]],
      ['Weekdays', [1, 2, 3, 4, 5]],
      ['Weekends', [6, 7]],
    ];
    const items: MenuItemSpec[] = [
      { title: 'Repeat', label: true },
      ...presets.map(([label, days]) => ({
        title: label,
        checked: is(days),
        disabled: readOnly,
        action: () => setDays(id, days),
      })),
      { separator: true },
      { title: 'On these days', label: true },
      ...weekdays.map((day) => ({
        title: weekdayNames[day - 1]!,
        checked: routine.days.includes(day),
        disabled: readOnly || (routine.days.length === 1 && routine.days.includes(day)),
        action: () =>
          setDays(
            id,
            routine.days.includes(day) ? routine.days.filter((d) => d !== day) : [...routine.days, day],
          ),
      })),
      { separator: true },
      { title: 'Rename', icon: 'pencil', disabled: readOnly, action: () => setRenaming(id) },
      {
        title: 'Move up',
        icon: 'arrow-up',
        disabled: readOnly,
        action: () => edit('Reorder routines', (b) => moveRoutine(b, id, -1)),
      },
      {
        title: 'Move down',
        icon: 'arrow-down',
        disabled: readOnly,
        action: () => edit('Reorder routines', (b) => moveRoutine(b, id, 1)),
      },
      { separator: true },
      {
        title: 'Delete routine…',
        icon: 'trash-2',
        warning: true,
        disabled: readOnly,
        action: () => {
          void host
            .confirm(
              'Delete routine?',
              `“${routine.title}” and its completion history are removed from this board. You can undo this action.`,
            )
            .then((ok) => {
              if (ok) edit('Delete routine', (b) => removeRoutine(b, id));
            });
        },
      },
    ];
    host.showMenu({ x: event.clientX, y: event.clientY }, items);
  };
  return (
    <section className="rb-day-card rb-routines" aria-labelledby={`${uid}-routines`}>
      <Name id={`${uid}-routines`}>Routines</Name>
      <header className="rb-day-card-head">
        <span className="rb-day-card-icon rb-routine-icon">
          <Icon name="repeat" />
        </span>
        <div>
          <h2>Routines</h2>
          <p>Recurring habits, ticked off {isoWeekday(date) > 5 ? 'this weekend day' : 'each day'}</p>
        </div>
        <span className="rb-day-count">
          {done}/{scheduled.length}
        </span>
      </header>
      <Name id={`${uid}-routines-progress`}>Routine progress</Name>
      {scheduled.length > 0 && (
        <progress
          className="rb-day-progress rb-routine-progress"
          aria-labelledby={`${uid}-routines-progress`}
          value={done}
          max={scheduled.length}
        />
      )}
      <ul className="rb-routine-list">
        {scheduled.map(([id, routine]) => {
          const ticked = routine.done.includes(date);
          const run = streak(routine, date <= today ? date : today);
          return (
            <li key={id} className={`rb-routine${ticked ? ' is-done' : ''}`}>
              <button
                className="rb-routine-check"
                role="checkbox"
                aria-checked={ticked}
                aria-label={`${ticked ? 'Undo' : 'Complete'} routine ${routine.title}`}
                title={future ? 'Routines can be ticked on the day' : undefined}
                disabled={readOnly || future}
                onClick={() => edit('Tick routine', (b) => toggleRoutine(b, id, date))}
              >
                {ticked && <Icon name="check" />}
              </button>
              {renaming === id ? (
                <input
                  className="rb-routine-rename"
                  aria-label="Routine name"
                  maxLength={200}
                  defaultValue={routine.title}
                  autoFocus
                  onBlur={(event) => {
                    const value = event.target.value.trim();
                    setRenaming(undefined);
                    if (value && value !== routine.title)
                      edit('Rename routine', (b) => {
                        if (b.routines?.[id]) b.routines[id]!.title = value;
                      });
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') event.currentTarget.blur();
                    else if (event.key === 'Escape') {
                      event.stopPropagation();
                      setRenaming(undefined);
                    }
                  }}
                />
              ) : (
                <span className="rb-routine-text" onDoubleClick={() => !readOnly && setRenaming(id)}>
                  <strong>{routine.title}</strong>
                  <span className="rb-agenda-meta">
                    <span>{repeatLabel(routine.days)}</span>
                    {run > 1 && (
                      <span className="rb-streak" title={`${run} scheduled days in a row`}>
                        <Icon name="flame" />
                        {run}
                      </span>
                    )}
                  </span>
                </span>
              )}
              <button
                className="rb-icon-button rb-row-menu"
                aria-label={`Routine options for ${routine.title}`}
                disabled={readOnly}
                onClick={(event) => menu(id, routine, event)}
              >
                <Icon name="ellipsis" />
              </button>
            </li>
          );
        })}
      </ul>
      {!all.length && (
        <p className="rb-muted rb-day-note">
          Add the small things you repeat, like a morning review or inbox zero. They reset each day and keep a
          streak.
        </p>
      )}
      {resting > 0 && (
        <p className="rb-muted rb-day-note">
          {resting} routine{resting === 1 ? '' : 's'} not scheduled on {dateLabel(date, { weekday: 'long' })}
          s.
        </p>
      )}
      <form
        className="rb-planner-composer rb-routine-composer"
        onSubmit={(event) => {
          event.preventDefault();
          const text = title.trim();
          if (readOnly || !text) return;
          edit('Add routine', (b) => {
            addRoutine(b, text);
          });
          setTitle('');
        }}
      >
        <Icon name="plus" />
        <input
          maxLength={200}
          disabled={readOnly}
          aria-label="New routine"
          placeholder="Add a routine…"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <button type="submit" disabled={readOnly || !title.trim()}>
          Add
        </button>
      </form>
    </section>
  );
}

function Calendar({
  board,
  date,
  today,
  readOnly,
  byDate,
  choose,
  setDate,
  select,
  drop,
  sidebar,
}: {
  board: Board;
  date: string;
  today: string;
  readOnly: boolean;
  byDate: Map<string, TaskEntry[]>;
  choose: (date: string) => void;
  setDate: (date: string) => void;
  select: (id: string) => void;
  drop: ReturnType<typeof useDrop>;
  sidebar: ReactNode;
}) {
  const uid = useId();
  const days = useMemo(() => calendarDays(date), [date]);
  return (
    <section className="rb-planner rb-planner-calendar" aria-labelledby={`${uid}-calendar`}>
      <Name id={`${uid}-calendar`}>Task calendar</Name>
      <header className="rb-planner-heading">
        <div>
          <span className="rb-eyebrow">CALENDAR</span>
          <h1>{dateLabel(date, { month: 'long', year: 'numeric' })}</h1>
          <p>
            Due dates across your board. Select a day to plan it.
            <span>{board.timeZone}</span>
          </p>
        </div>
        <DateNavigation {...{ date, today, setDate, choose }} step={shiftMonth} unit="month" />
      </header>
      <div className="rb-planner-layout">
        <section className="rb-calendar" aria-labelledby={`${uid}-month`}>
          <Name id={`${uid}-month`}>Month calendar</Name>
          <div className="rb-weekdays">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
              <span key={day}>{day}</span>
            ))}
          </div>
          <div className="rb-calendar-grid">
            {days.map((day) => {
              const valid = dateOnly.safeParse(day).success;
              const tasks = byDate.get(day) ?? [];
              return (
                <div
                  key={day}
                  className={`rb-calendar-day${monthOf(day) !== monthOf(date) ? ' rb-outside-month' : ''}${day === date ? ' is-selected' : ''}${day === today ? ' is-today' : ''}${drop.over === day ? ' is-over' : ''}`}
                  {...drop.target(day, valid)}
                >
                  <button
                    className="rb-calendar-date"
                    disabled={!valid}
                    aria-label={`Plan ${day}`}
                    aria-pressed={day === date}
                    onClick={() => choose(day)}
                  >
                    <span>{Number(day.slice(-2))}</span>
                    {!!tasks.length && (
                      <small>{tasks.filter(([, task]) => task.status !== 'done').length} open</small>
                    )}
                  </button>
                  {tasks.slice(0, 3).map(([id, task]) => (
                    <button
                      key={id}
                      className={`rb-calendar-task${task.status === 'done' ? ' rb-struck' : ''}`}
                      title={task.title}
                      draggable={!readOnly}
                      onDragStart={(event) => {
                        event.dataTransfer.setData(DRAG_TYPE, id);
                        event.dataTransfer.effectAllowed = 'move';
                      }}
                      onDragEnd={drop.clear}
                      onClick={() => {
                        choose(day);
                        select(id);
                      }}
                    >
                      <span className={`rb-calendar-dot rb-status-${task.status}`} />
                      <span>{task.title}</span>
                    </button>
                  ))}
                  {tasks.length > 3 && (
                    <button className="rb-calendar-more" onClick={() => choose(day)}>
                      +{tasks.length - 3} more
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <p className="rb-muted rb-calendar-hint">
            Drag a task to change its due date, or use its Reschedule menu.
          </p>
        </section>
        <aside className="rb-planner-sidebar">{sidebar}</aside>
      </div>
    </section>
  );
}
