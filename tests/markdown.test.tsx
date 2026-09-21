import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Markdown } from '../src/ui/Markdown';
import type { BoardHost } from '../src/ui/ports';
import { documentLink } from '../src/domain/documents';
const host = { openNote: () => {} } as unknown as BoardHost;
const render = (text: string) =>
  renderToStaticMarkup(<Markdown text={text} host={host} sourcePath="Folder/Project.md" />);

describe('safe document Markdown', () => {
  it('resolves explicit relative links and fragments without escaping the visible vault', () => {
    expect(documentLink('./Sibling.md#Context', 'Folder/Project.md')).toBe('Folder/Sibling.md#Context');
    expect(documentLink('../Brief.md', 'Folder/Project.md')).toBe('Brief.md');
    expect(documentLink('#Context', 'Folder/Project.md')).toBe('Folder/Project.md#Context');
    expect(documentLink('../../Outside.md', 'Folder/Project.md')).toBeUndefined();
    expect(documentLink('../.obsidian/data.json', 'Folder/Project.md')).toBeUndefined();
    expect(documentLink('https://example.com/note.md', 'Folder/Project.md')).toBeUndefined();
  });
  it('renders tables and read-only checklists', () => {
    const html = render('| Topic | Owner |\n| --- | --- |\n| Review | Anna |\n\n- [x] Done\n- [ ] Next');
    expect(html).toContain('<table>');
    expect(html).toContain('<td>Anna</td>');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('disabled=""');
  });
  it('turns wiki links into explicit buttons, preserving code as authored', () => {
    const html = render(
      'See [[Project notes#Scope|scope]] and ![[Brief]].\n\n`[[literal]]`\n\n```\n[[also literal]]\n```',
    );
    expect(html).toContain('>scope</button>');
    expect(html).toContain('>Embedded note: Brief</button>');
    expect(html).toContain('<code>[[literal]]</code>');
    expect(html).toContain('[[also literal]]');
  });
  it('does not mount raw HTML or remote images, or make unsafe paths clickable', () => {
    const html = render(
      '<script>bad()</script>\n\n![secret](https://example.com/tracker.png)\n\n[[../hidden]] [[.obsidian/data]] [bad](javascript:alert%281%29)',
    );
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('<button');
    expect(html).toContain('Image omitted');
  });
});
