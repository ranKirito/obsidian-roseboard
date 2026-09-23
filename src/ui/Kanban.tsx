import { useId, useState, type DragEvent } from 'react';
import { blocked, overdue, statuses, newId, newTask, type Board, type Status } from '../domain/model';
import { placeTask, setStatus, type Edit } from '../domain/commands';
import type { BoardHost } from './ports';
import { Name } from './Name';
import { Icon, priorityIcon, statusIcon, statusLabel } from './icons';
import { formatDue } from './Nodes';
/**
 * Kanban over the same task records. Dropping a card in a column only changes `status`; canvas
 * placements are untouched. Drag uses the platform drag-and-drop API; touch devices use the
 * per-card move menu instead.
 */
export function Kanban({
  host,
  board,
  matching,
  today,
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
  readOnly: boolean;
  activeTask?: string;
  edit: (label: string, action: Edit, key?: string) => void;
  select: (id: string) => void;
  complete: (id: string) => void;
}) {
  const uid = useId();
  const [over, setOver] = useState<Status>();
  const [dragging, setDragging] = useState<string>();
  const move = (id: string, status: Status) => {
    const task = board.tasks[id];
    if (!task || task.status === status) return;
    if (status === 'done') complete(id);
    else edit('Move task', (b) => setStatus(b, id, status));
  };
  const onDrop = (status: Status) => (e: DragEvent) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/roseboard-task') || dragging;
    setOver(undefined);
    setDragging(undefined);
    if (id && !readOnly) move(id, status);
  };
  const add = (status: Status) =>
    edit('Create task', (b) => {
      const id = newId('task');
      b.tasks[id] = { ...newTask('New task'), status };
      placeTask(b, id);
    });
  return (
    <div className="rb-kanban" aria-labelledby={`${uid}-board`}>
      <Name id={`${uid}-board`}>Kanban board</Name>
      {statuses.map((status) => {
        const ids = Object.keys(board.tasks).filter(
          (id) => matching.has(id) && board.tasks[id]!.status === status,
        );
        return (
          <section
            key={status}
            className={`rb-column rb-column-${status}${over === status ? ' is-over' : ''}`}
            aria-labelledby={`${uid}-${status}`}
            onDragOver={(e) => {
              if (readOnly) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              if (over !== status) setOver(status);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(undefined);
            }}
            onDrop={onDrop(status)}
          >
            <Name id={`${uid}-${status}`}>{`${statusLabel[status]} column`}</Name>
            <header className="rb-column-head">
              <span className={`rb-chip rb-status rb-status-${status}`}>
                <Icon name={statusIcon[status]!} />
                {statusLabel[status]}
              </span>
              <span className="rb-column-count">{ids.length}</span>
              <button
                type="button"
                className="rb-icon-button"
                aria-label={`Add task to ${statusLabel[status]}`}
                disabled={readOnly}
                onClick={() => add(status)}
              >
                <Icon name="plus" />
              </button>
            </header>
            <div className="rb-column-body">
              {ids.map((id) => {
                const t = board.tasks[id]!;
                const isBlocked = blocked(t, board) && t.status !== 'done';
                return (
                  <article
                    key={id}
                    className={`rb-kanban-card${id === activeTask ? ' is-active' : ''}${dragging === id ? ' is-dragging' : ''}${t.status === 'done' ? ' rb-done' : ''}`}
                    draggable={!readOnly}
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/roseboard-task', id);
                      e.dataTransfer.effectAllowed = 'move';
                      setDragging(id);
                    }}
                    onDragEnd={() => {
                      setDragging(undefined);
                      setOver(undefined);
                    }}
                    onClick={() => select(id)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      host.showMenu({ x: e.clientX, y: e.clientY }, [
                        { title: 'Move to', label: true },
                        ...statuses.map((s) => ({
                          title: statusLabel[s]!,
                          icon: statusIcon[s],
                          checked: s === t.status,
                          disabled: readOnly,
                          action: () => move(id, s),
                        })),
                      ]);
                    }}
                  >
                    <div className="rb-kanban-title">
                      <button
                        type="button"
                        className="rb-complete"
                        aria-label={t.status === 'done' ? `Reopen ${t.title}` : `Complete ${t.title}`}
                        disabled={readOnly}
                        onClick={(e) => {
                          e.stopPropagation();
                          complete(id);
                        }}
                      >
                        <Icon name={t.status === 'done' ? 'circle-check-big' : 'circle'} />
                      </button>
                      <strong>{t.title}</strong>
                      {host.platform.touch && (
                        <button
                          type="button"
                          className="rb-icon-button"
                          aria-label={`Move ${t.title}`}
                          disabled={readOnly}
                          onClick={(e) => {
                            e.stopPropagation();
                            host.showMenu({ x: e.clientX, y: e.clientY }, [
                              { title: 'Move to', label: true },
                              ...statuses.map((s) => ({
                                title: statusLabel[s]!,
                                icon: statusIcon[s],
                                checked: s === t.status,
                                action: () => move(id, s),
                              })),
                            ]);
                          }}
                        >
                          <Icon name="move-horizontal" />
                        </button>
                      )}
                    </div>
                    <div className="rb-card-meta">
                      {t.assignee && (
                        <span className="rb-meta">
                          <Icon name="user-round" />
                          {t.assignee}
                        </span>
                      )}
                      {t.priority !== 'none' && (
                        <span className={`rb-chip rb-priority rb-priority-${t.priority}`}>
                          <Icon name={priorityIcon[t.priority]!} />
                          {t.priority}
                        </span>
                      )}
                      {isBlocked && (
                        <span className="rb-chip rb-chip-blocked">
                          <Icon name="ban" />
                          Blocked
                        </span>
                      )}
                      {t.dueDate && (
                        <span className={`rb-meta${overdue(t, today) ? ' rb-overdue' : ''}`}>
                          <Icon name={overdue(t, today) ? 'alarm-clock' : 'calendar'} />
                          {formatDue(t.dueDate, today)}
                        </span>
                      )}
                      {!!t.checklist.length && (
                        <span className="rb-meta">
                          <Icon name="list-checks" />
                          {t.checklist.filter((i) => i.done).length}/{t.checklist.length}
                        </span>
                      )}
                      {!!t.tags.length && (
                        <span className="rb-tags">
                          {t.tags.slice(0, 3).map((tag) => (
                            <span className="rb-tag" key={tag}>
                              #{tag}
                            </span>
                          ))}
                        </span>
                      )}
                    </div>
                  </article>
                );
              })}
              {ids.length === 0 && <p className="rb-column-empty">Drop tasks here</p>}
            </div>
          </section>
        );
      })}
    </div>
  );
}
