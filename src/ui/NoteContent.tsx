import { useEffect, useState } from 'react';
import type { BoardHost } from './ports';
import { Markdown } from './Markdown';

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
