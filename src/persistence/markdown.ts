import { BoardError, type Board, serialize, validateBoard } from '../domain/model';
export interface Block {
  start: number;
  end: number;
  raw: string;
  newline: string;
}
export function findBlock(markdown: string): Block {
  const lines = markdown.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const blocks: Block[] = [];
  let offset = 0;
  let fence: { char: string; length: number; rose: boolean; start: number; newline: string } | undefined;
  for (const line of lines) {
    const text = line.replace(/\r?\n$/, '');
    if (!fence) {
      const match = /^ {0,3}(`{3,}|~{3,})([^\r\n]*)$/.exec(text);
      if (match)
        fence = {
          char: match[1]![0]!,
          length: match[1]!.length,
          rose: match[2]!.trim() === 'roseboard',
          start: offset + line.length,
          newline: line.endsWith('\r\n') ? '\r\n' : '\n',
        };
    } else if (new RegExp(`^ {0,3}${fence.char}{${fence.length},}\\s*$`).test(text)) {
      if (fence.rose)
        blocks.push({
          start: fence.start,
          end: offset,
          raw: markdown.slice(fence.start, offset).trim(),
          newline: fence.newline,
        });
      fence = undefined;
    }
    offset += line.length;
  }
  if (fence?.rose)
    throw new BoardError('The roseboard code block has no closing fence. Source has not been changed.');
  if (blocks.length !== 1)
    throw new BoardError(`Expected exactly one roseboard code block; found ${blocks.length}.`);
  return blocks[0]!;
}
/** Parses one raw fenced payload into a validated board. */
export function parseBoard(raw: string): Board {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    throw new BoardError(`Invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return validateBoard(json);
}
export function parseNote(markdown: string): { board: Board; raw: string } {
  const { raw } = findBlock(markdown);
  return { board: parseBoard(raw), raw };
}
export function replaceBlock(markdown: string, board: Board): string {
  const block = findBlock(markdown);
  const json = serialize(board).replace(/\n/g, block.newline);
  return markdown.slice(0, block.start) + json + block.newline + markdown.slice(block.end);
}
export const boardNote = (board: Board) =>
  `# ${board.title.replace(/[\r\n]/g, ' ')}\n\n\`\`\`roseboard\n${serialize(board)}\n\`\`\`\n`;
