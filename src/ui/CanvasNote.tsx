import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { NoteSession } from '../persistence/note-session';
import type { BoardHost } from './ports';
import { NoteContent } from './Documents';
import { Icon } from './icons';

function NoteEditor({
  session,
  host,
  readOnly,
  close,
}: {
  session: NoteSession;
  host: BoardHost;
  readOnly: boolean;
  close: () => void;
}) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const field = useRef<HTMLTextAreaElement>(null);
  const busy = state.status === 'Saving';
  useEffect(() => {
    field.current?.focus();
    return () => {
      void session.stash();
    };
  }, [session]);
  useEffect(() => {
    const element = field.current;
    const save = () => {
      if (!readOnly) void session.save();
    };
    element?.addEventListener('roseboard-note-save', save);
    return () => element?.removeEventListener('roseboard-note-save', save);
  }, [session, readOnly]);
  useEffect(() => {
    if (state.status === 'Closed') close();
  }, [state.status, close]);
  const cancel = async () => {
    if (
      state.text !== state.baseline &&
      !(await host.confirm(
        'Discard note changes?',
        'The original note will stay as it is. Your unsaved draft will be removed.',
      ))
    )
      return;
    await session.discard();
  };
  return (
    <div className="rb-note-editor nodrag nopan nowheel" onKeyDown={(event) => event.stopPropagation()}>
      <div className="rb-note-edit-status" role="status">
        <span>
          {busy
            ? 'Saving note…'
            : state.recovered
              ? 'Draft restored'
              : state.text === state.baseline
                ? 'Editing Markdown'
                : 'Unsaved note changes'}
        </span>
        <span>{host.platform.mac ? '⌘' : 'Ctrl'}↵ to save</span>
      </div>
      <textarea
        ref={field}
        aria-label="Edit document Markdown"
        value={state.text}
        maxLength={100000}
        disabled={busy || readOnly}
        spellCheck
        onChange={(event) => session.change(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault();
            if (!busy && !readOnly) void session.save();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            if (!busy) void cancel();
          }
        }}
      />
      {state.issue && (
        <p className="rb-note-error" role="alert">
          {state.issue}
        </p>
      )}
      <div className="rb-note-edit-actions">
        {state.issue && (
          <button
            disabled={busy}
            onClick={() =>
              void session
                .saveCopy()
                .then((path) => host.notify(`Draft saved to ${path}`))
                .catch(host.notify)
            }
          >
            Save a copy
          </button>
        )}
        <span className="rb-spacer" />
        <button onClick={() => void cancel()} disabled={busy}>
          Cancel
        </button>
        <button className="rb-primary" disabled={busy || readOnly} onClick={() => void session.save()}>
          <Icon name="check" />
          Save note
        </button>
      </div>
    </div>
  );
}

/** Reading and editing stay inside this card; expanded size belongs only to the current view. */
export function CanvasNote({
  host,
  path,
  expanded,
  expand,
  readOnly,
  minimal,
  missing,
}: {
  host: BoardHost;
  path: string;
  expanded: boolean;
  expand: (value: boolean) => void;
  readOnly: boolean;
  minimal: boolean;
  missing: boolean;
}) {
  const [session, setSession] = useState<NoteSession>();
  const [loading, setLoading] = useState(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const begin = () => {
    if (readOnly || loading || session || missing) return;
    expand(true);
    setLoading(true);
    void host
      .editNote(path)
      .then((next) => {
        if (active.current) setSession(next);
      }, host.notify)
      .finally(() => {
        if (active.current) setLoading(false);
      });
  };
  return (
    <div
      className="rb-canvas-note nodrag nopan nowheel"
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => {
        event.stopPropagation();
        if (!(event.target as HTMLElement).closest('button,a,input,textarea')) begin();
      }}
    >
      <div className="rb-note-actions">
        <button
          className={expanded ? 'is-active' : ''}
          disabled={!!session || loading || missing}
          aria-expanded={expanded}
          onClick={(event) => {
            event.stopPropagation();
            expand(!expanded);
          }}
        >
          <Icon name={expanded ? 'minimize-2' : 'book-open'} />
          {expanded ? 'Collapse' : 'Read'}
        </button>
        {expanded && !session && !readOnly && (
          <button onClick={begin} disabled={loading || missing}>
            <Icon name="pencil" />
            Edit
          </button>
        )}
        <span className="rb-spacer" />
        <button
          className="rb-icon-button"
          aria-label="Open in Obsidian"
          title="Open in Obsidian"
          onClick={() => host.openNote(path)}
        >
          <Icon name="arrow-up-right" />
        </button>
      </div>
      {loading ? (
        <p role="status" className="rb-muted">
          Opening editor…
        </p>
      ) : session ? (
        <NoteEditor session={session} host={host} readOnly={readOnly} close={() => setSession(undefined)} />
      ) : (
        (!minimal || expanded) && (
          <div
            className={`rb-note-preview${expanded ? ' rb-note-reading' : ''}`}
            tabIndex={0}
            aria-label={`Read ${path}`}
          >
            <NoteContent host={host} path={path} compact={!expanded} />
          </div>
        )
      )}
      {expanded && !session && !loading && !readOnly && (
        <span className="rb-note-hint">Double-click the document to edit</span>
      )}
    </div>
  );
}
