import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { BoardHost } from './ports';
import { vaultPath } from '../domain/model';
import { documentLink } from '../domain/documents';
// Raw HTML and embeds are never mounted. No render-time network requests.
export const Markdown = memo(function Markdown({
  text,
  host,
  sourcePath,
}: {
  text: string;
  host: BoardHost;
  sourcePath?: string;
}) {
  return (
    <div className="rb-markdown">
      <ReactMarkdown
        skipHtml
        remarkPlugins={[remarkGfm, wikiLinks]}
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
            const target = documentLink(path, sourcePath);
            return target ? (
              <button className="rb-text-link nodrag" onClick={() => host.openNote(target, sourcePath)}>
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

type MarkdownNode = { type: string; value?: string; url?: string; children?: MarkdownNode[] };
/** Transform only prose text, leaving code, existing links, and raw HTML alone. */
export function wikiLinks() {
  return (tree: MarkdownNode) => {
    const walk = (node: MarkdownNode) => {
      if (!node.children || ['link', 'linkReference'].includes(node.type)) return;
      node.children = node.children.flatMap((child): MarkdownNode[] => {
        if (child.type !== 'text' || !child.value) {
          walk(child);
          return [child];
        }
        const result: MarkdownNode[] = [];
        const pattern = /(!?)\[\[([^\]\n]+)\]\]/g;
        let cursor = 0;
        for (const match of child.value.matchAll(pattern)) {
          const index = match.index!;
          const [target, alias] = match[2]!.split('|');
          if (!vaultPath.safeParse(target!.split('#')[0]).success) continue;
          result.push({ type: 'text', value: child.value.slice(cursor, index) });
          result.push({
            type: 'link',
            url: encodeURI(target!),
            children: [{ type: 'text', value: `${match[1] ? 'Embedded note: ' : ''}${alias || target}` }],
          });
          cursor = index + match[0].length;
        }
        result.push({ type: 'text', value: child.value.slice(cursor) });
        return result;
      });
    };
    walk(tree);
  };
}
