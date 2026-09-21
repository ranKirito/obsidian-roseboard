import { useMemo, useState, type DragEvent } from 'react';
import { addDays, blocked, dateOnly, newId, newTask, overdue, type Board, type Task } from '../domain/model';
import { calendarDays, dateLabel, monthOf, plannerTasks, shiftMonth } from '../domain/planner';
import type { Edit } from '../domain/commands';
import type { BoardHost } from './ports';
import { Icon, statusIcon, statusLabel } from './icons';
import { formatDue } from './Nodes';

type TaskEntry = [string, Task];
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
  const [title, setTitle] = useState('');
  const [over, setOver] = useState<string>();
  const groups = useMemo(() => plannerTasks(board, matching, date, today), [board, matching, date, today]);
  const days = useMemo(() => calendarDays(date), [date]);
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
    edit(due ? 'Schedule task' : 'Clear due date', (b) => {
      const task = b.tasks[id];
      if (!task) return;
      if (due) task.dueDate = due;
      else delete task.dueDate;
    });
  };
  const choose = (value: string) => {
    if (dateOnly.safeParse(value).success) setDate(value);
  };
  const drop = (event: DragEvent, due: string) => {
    event.preventDefault();
    setOver(undefined);
    const id = event.dataTransfer.getData('text/roseboard-task');
    if (id && board.tasks[id]) schedule(id, due);
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
      { title: 'Remove date', icon: 'calendar-x', disabled: readOnly, action: () => schedule(id) },
    ]);
  const taskRow = ([id, task]: TaskEntry, unscheduled = false) => (
    <article
      key={id}
      className={`rb-agenda-task${id === activeTask ? ' is-active' : ''}${task.status === 'done' ? ' rb-done' : ''}`}
      draggable={!readOnly}
      onDragStart={(event) => {
        event.dataTransfer.setData('text/roseboard-task', id);
        event.dataTransfer.effectAllowed = 'move';
      }}
      onDragEnd={() => setOver(undefined)}
    >
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
        <span>
          {task.assignee && (
            <span className="rb-meta">
              <Icon name="user-round" />
              {task.assignee}
            </span>
          )}
          {task.dueDate && (
            <span className={overdue(task, today) ? 'rb-overdue' : ''}>{formatDue(task.dueDate, today)}</span>
          )}
          {task.priority !== 'none' && (
            <span className={`rb-priority-${task.priority}`}>{task.priority} priority</span>
          )}
          {blocked(task, board) && task.status !== 'done' && <span className="rb-overdue">Blocked</span>}
          {!!task.checklist.length && (
            <span>
              {task.checklist.filter((item) => item.done).length}/{task.checklist.length} steps
            </span>
          )}
        </span>
      </button>
      {unscheduled ? (
        <button
          disabled={readOnly}
          aria-label={`Schedule ${task.title} for ${date}`}
          onClick={() => schedule(id, date)}
        >
          <Icon name="calendar-plus" />
          Plan
        </button>
      ) : (
        <span className={`rb-chip rb-status rb-status-${task.status}`} title={statusLabel[task.status]}>
          <Icon name={statusIcon[task.status]!} />
        </span>
      )}
      <button
        className="rb-icon-button"
        disabled={readOnly}
        aria-label={`Reschedule ${task.title}`}
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
          b.tasks[newId('task')] = { ...newTask(title.trim()), dueDate: date };
        });
        setTitle('');
      }}
    >
      <Icon name="plus" />
      <input
        maxLength={500}
        disabled={readOnly}
        aria-label="New daily task"
        placeholder="What needs to get done?"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
      />
      <button type="submit" className="rb-primary" disabled={readOnly || !title.trim()}>
        Add task
      </button>
    </form>
  );
  const agenda = (
    <section className="rb-day-agenda" aria-label="Selected day tasks">
      <header className="rb-agenda-heading">
        <div>
          <span className="rb-eyebrow">
            {date === today ? 'TODAY' : dateLabel(date, { weekday: 'long' }).toUpperCase()}
          </span>
          <h2>{dateLabel(date, { month: 'long', day: 'numeric' })}</h2>
        </div>
        <span className="rb-muted">
          {done}/{groups.day.length} complete
        </span>
      </header>
      <progress
        className="rb-day-progress"
        aria-label="Daily task progress"
        value={done}
        max={groups.day.length || 1}
      />
      {composer}
      <div className="rb-agenda-rows">{groups.day.map((entry) => taskRow(entry))}</div>
      {!groups.day.length && (
        <div className="rb-planner-empty">
          <Icon name="sun" />
          <h3>A little room to focus.</h3>
          <p>Add a task for this day or bring one in from Unscheduled.</p>
        </div>
      )}
      {view === 'day' && date === today && groups.overdue.length > 0 && (
        <section className="rb-overdue-section" aria-label="Overdue tasks">
          <h3>
            <Icon name="alarm-clock" />
            Overdue <span>{groups.overdue.length}</span>
          </h3>
          {groups.overdue.map((entry) => taskRow(entry))}
        </section>
      )}
    </section>
  );
  return (
    <section
      className={`rb-planner rb-planner-${view}`}
      aria-label={view === 'calendar' ? 'Task calendar' : 'Daily planner'}
    >
      <header className="rb-planner-heading">
        <div>
          <span className="rb-eyebrow">MAKE SPACE FOR WHAT MATTERS</span>
          <h1>
            {view === 'calendar'
              ? dateLabel(date, { month: 'long', year: 'numeric' })
              : 'Your day, at a glance.'}
          </h1>
          <p>
            {view === 'calendar'
              ? 'Due dates across your board. Select a day to plan it.'
              : 'One place for today’s tasks, loose ends, and what comes next.'}{' '}
            <span>{board.timeZone}</span>
          </p>
        </div>
        <div className="rb-date-navigation">
          <button
            className="rb-icon-button"
            aria-label={view === 'calendar' ? 'Previous month' : 'Previous day'}
            onClick={() => choose(view === 'calendar' ? shiftMonth(date, -1) : addDays(date, -1))}
          >
            <Icon name="chevron-left" />
          </button>
          <button onClick={() => setDate(today)}>Today</button>
          <button
            className="rb-icon-button"
            aria-label={view === 'calendar' ? 'Next month' : 'Next day'}
            onClick={() => choose(view === 'calendar' ? shiftMonth(date, 1) : addDays(date, 1))}
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
      </header>
      <div className="rb-planner-layout">
        {view === 'calendar' ? (
          <section className="rb-calendar" aria-label="Month calendar">
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
                    className={`rb-calendar-day${monthOf(day) !== monthOf(date) ? ' rb-outside-month' : ''}${day === date ? ' is-selected' : ''}${day === today ? ' is-today' : ''}${over === day ? ' is-over' : ''}`}
                    onDragOver={(event) => {
                      if (readOnly || !valid || !event.dataTransfer.types.includes('text/roseboard-task'))
                        return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = 'move';
                      setOver(day);
                    }}
                    onDragLeave={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                        setOver(undefined);
                    }}
                    onDrop={(event) => drop(event, day)}
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
                          event.dataTransfer.setData('text/roseboard-task', id);
                          event.dataTransfer.effectAllowed = 'move';
                        }}
                        onDragEnd={() => setOver(undefined)}
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
        ) : (
          agenda
        )}
        <aside className="rb-planner-sidebar">
          {view === 'calendar' && agenda}
          <section className="rb-unscheduled" aria-label="Unscheduled tasks">
            <header>
              <Icon name="inbox" />
              <h3>Unscheduled</h3>
              <span>{groups.unscheduled.length}</span>
            </header>
            <p className="rb-muted">
              Plan for {date === today ? 'today' : dateLabel(date, { month: 'short', day: 'numeric' })}{' '}
              without moving any canvas cards.
            </p>
            {groups.unscheduled.map((entry) => taskRow(entry, true))}
            {!groups.unscheduled.length && <p className="rb-muted">No unscheduled tasks in this view.</p>}
          </section>
        </aside>
      </div>
    </section>
  );
}
