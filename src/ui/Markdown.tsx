import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import type { BoardHost } from './ports';
import { vaultPath } from '../domain/model';
// Raw HTML and embeds are never mounted. No render-time network requests.
export const Markdown = memo(function Markdown({ text, host }: { text: string; host: BoardHost }) {
  return (
    <div className="rb-markdown">
      <ReactMarkdown
        skipHtml
        components={{
          img: ({ alt }) => <span className="rb-muted">[Image omitted: {alt || 'image'}]</span>,
          a: ({ href, children }) => {
            if (!href) return <span>{children}</span>;
            if (/^https?:\/\//i.test(href))
              return (
                <a href={href} target="_blank" rel="noopener noreferrer">
                  {children}
                </a>
              );
            let path = '';
            try {
              path = decodeURIComponent(href);
            } catch {
              return <span>{children}</span>;
            }
            return vaultPath.safeParse(path.split('#')[0]).success ? (
              <button className="rb-text-link nodrag" onClick={() => host.openNote(path)}>
                {children}
              </button>
            ) : (
              <span>{children}</span>
            );
          },
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
