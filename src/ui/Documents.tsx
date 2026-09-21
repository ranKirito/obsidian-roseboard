import { useEffect, useMemo, useState } from 'react';
import type { Board } from '../domain/model';
import type { BoardHost } from './ports';
import { Markdown } from './Markdown';
import { Icon } from './icons';

type Note = Awaited<ReturnType<BoardHost['readNote']>>;

/** Each mounted preview watches its own file. Late reads cannot replace a newer selection. */
function useNote(host: BoardHost, path: string) {
  const [state, setState] = useState<{ note?: Note; loading: boolean; error?: string }>({ loading: true });
  useEffect(() => {
    let active = true;
    let revision = 0;
    setState({ loading: true });
    const refresh = () => {
      const request = ++revision;
      void host.readNote(path).then(
        (note) => {
          if (active && request === revision) setState({ note, loading: false });
        },
        (error: unknown) => {
          if (active && request === revision)
            setState({ loading: false, error: error instanceof Error ? error.message : String(error) });
        },
      );
    };
    const unsubscribe = host.subscribeNote(path, refresh);
    refresh();
    return () => {
      active = false;
      unsubscribe();
    };
  }, [host, path]);
  return state;
}

export function NoteContent({
  host,
  path,
  compact = false,
}: {
  host: BoardHost;
  path: string;
  compact?: boolean;
}) {
  const { note, loading, error } = useNote(host, path);
  if (loading)
    return (
      <p className="rb-muted" role="status">
        Loading note…
      </p>
    );
  if (error)
    return (
      <p className="rb-muted" role="status">
        {error}
      </p>
    );
  if (!note)
    return (
      <p className="rb-muted" role="status">
        This note is missing. Relink it or restore it to the vault.
      </p>
    );
  // Properties are metadata, not the opening paragraph of the document.
  const body = note.text.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '');
  const text = compact ? body.slice(0, 2400) : body;
  return (
    <>
      <Markdown text={text.trim() ? text : '*This note is empty.*'} host={host} sourcePath={note.path} />
      {!compact && note.truncated && (
        <p className="rb-muted">
          Preview shows the first 100,000 characters. Open the note to read the rest.
        </p>
      )}
    </>
  );
}

export function Documents({
  host,
  board,
  selected,
  select,
  add,
  readOnly,
}: {
  host: BoardHost;
  board: Board;
  selected?: string;
  select: (path: string) => void;
  add: () => void;
  readOnly: boolean;
}) {
  const [search, setSearch] = useState('');
  const documents = useMemo(() => {
    const paths = new Map<string, string[]>();
    for (const node of Object.values(board.nodes))
      if (node.type === 'note' && !paths.has(node.notePath)) paths.set(node.notePath, []);
    for (const task of Object.values(board.tasks))
      if (task.notePath) paths.set(task.notePath, [...(paths.get(task.notePath) ?? []), task.title]);
    return [...paths].sort(([a], [b]) => a.localeCompare(b));
  }, [board]);
  const current = selected && documents.some(([path]) => path === selected) ? selected : documents[0]?.[0];
  const visible = documents.filter(([path, tasks]) =>
    [path, ...tasks].join(' ').toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <section className="rb-documents" aria-label="Board documents">
      <aside className="rb-document-library" aria-label="Linked documents">
        <header>
          <div>
            <span className="rb-eyebrow">REFERENCE LIBRARY</span>
            <h2>
              Documents <span>{documents.length}</span>
            </h2>
          </div>
        </header>
        <input
          aria-label="Search documents"
          placeholder="Find a linked note…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button className="rb-primary" onClick={add} disabled={readOnly}>
          <Icon name="file-plus-2" />
          Link a document
        </button>
        <nav aria-label="Document list">
          {visible.map(([path, tasks]) => (
            <button
              key={path}
              className={`rb-document-item${current === path ? ' is-active' : ''}`}
              aria-current={current === path ? 'page' : undefined}
              onClick={() => select(path)}
            >
              <Icon name="file-text" />
              <span>
                <strong>{path.split('/').pop()?.replace(/\.md$/, '')}</strong>
                <small>{path}</small>
                {!!tasks.length && (
                  <small>
                    {tasks.length} linked task{tasks.length === 1 ? '' : 's'}
                  </small>
                )}
              </span>
            </button>
          ))}
          {!visible.length && (
            <p className="rb-muted">
              {documents.length
                ? 'No documents match your search.'
                : 'Link project notes, briefs, or meeting notes to keep them close to your work.'}
            </p>
          )}
        </nav>
      </aside>
      {current ? (
        <article className="rb-document-reader" aria-label="Document reader">
          <header>
            <div>
              <span className="rb-eyebrow">LINKED NOTE · LIVE PREVIEW</span>
              <h2>{current.split('/').pop()?.replace(/\.md$/, '')}</h2>
              <span className="rb-path">{current}</span>
            </div>
            <button onClick={() => host.openNote(current)}>
              <Icon name="arrow-up-right" />
              Open in Obsidian
            </button>
          </header>
          <div className="rb-document-page" key={current}>
            <NoteContent host={host} path={current} />
          </div>
        </article>
      ) : (
        <div className="rb-feature-empty">
          <Icon name="book-open" />
          <h2>Your project, in context.</h2>
          <p>Read the notes behind your tasks without leaving the board.</p>
          <button onClick={add} disabled={readOnly}>
            Link your first document
          </button>
        </div>
      )}
    </section>
  );
}
