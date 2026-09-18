import { writeFile, mkdir } from 'node:fs/promises';
import { newBoard, newTask, validateBoard, type Board } from '../src/domain/model';
import { boardNote } from '../src/persistence/markdown';
export function stressBoard(): Board {
  const board = newBoard('Stress · 300 tasks / 500 connections');
  board.boardId = 'board-stress';
  board.timeZone = 'Europe/Ljubljana';
  for (let i = 0; i < 300; i++) {
    const id = `task-${i}`;
    board.tasks[id] = {
      ...newTask(`Task ${String(i + 1).padStart(3, '0')}`),
      status: i % 9 === 0 ? 'done' : i % 3 === 0 ? 'doing' : 'todo',
      priority: i % 8 === 0 ? 'high' : 'none',
      tags: [`group-${i % 6}`],
      description: 'Reproducible performance fixture.',
      dependsOn: i > 0 && i <= 250 ? [`task-${i - 1}`] : [],
    };
    board.nodes[`node-${i}`] = {
      type: 'task',
      taskId: id,
      x: (i % 20) * 340,
      y: Math.floor(i / 20) * 230,
      width: 300,
      height: 190,
    };
  }
  for (let i = 0; i < 250; i++)
    board.edges[`edge-${i}`] = {
      source: `node-${i}`,
      target: `node-${i + 20 < 300 ? i + 20 : i + 1}`,
      label: 'relates to',
    };
  return validateBoard(board);
}
const example = newBoard('A little room to make things happen');
example.boardId = 'board-welcome';
example.timeZone = 'Europe/Ljubljana';
const tasks: [string, string, string, string][] = [
  ['brief', 'Shape the idea', 'done', 'low'],
  ['sketch', 'Explore the first direction', 'doing', 'high'],
  ['build', 'Make a small, useful prototype', 'todo', 'medium'],
  ['review', 'Review with fresh eyes', 'todo', 'none'],
  ['ship', 'Ship something thoughtful', 'backlog', 'high'],
  ['later', 'Collect ideas for next week', 'backlog', 'none'],
];
for (const [id, title, status, priority] of tasks)
  example.tasks[id] = {
    ...newTask(title),
    status: status as never,
    priority: priority as never,
    tags: [id === 'later' ? 'someday' : 'studio'],
    description:
      id === 'sketch'
        ? '## Make the work clear\n\nKeep the first version focused. Start with what somebody can actually use.\n\n- Sketch two directions\n- Choose one deliberately'
        : 'One small, concrete step forward.',
    checklist:
      id === 'sketch'
        ? [
            { id: 'check-1', text: 'Gather references', done: true },
            { id: 'check-2', text: 'Sketch two directions', done: false },
            { id: 'check-3', text: 'Pick the clearest one', done: false },
          ]
        : [],
    dependsOn: id === 'build' ? ['sketch'] : id === 'review' ? ['build'] : id === 'ship' ? ['review'] : [],
    ...(id === 'sketch' ? { dueDate: '2026-09-18', notePath: 'Project notes.md' } : {}),
  };
example.nodes = {
  'frame-discover': {
    type: 'frame',
    title: '01  ·  Discover & shape',
    x: 40,
    y: 40,
    width: 720,
    height: 530,
  },
  'frame-deliver': { type: 'frame', title: '02  ·  Make it real', x: 820, y: 40, width: 720, height: 530 },
  'node-brief': {
    type: 'task',
    taskId: 'brief',
    x: 72,
    y: 112,
    width: 300,
    height: 180,
    frameId: 'frame-discover',
  },
  'node-sketch': {
    type: 'task',
    taskId: 'sketch',
    x: 416,
    y: 112,
    width: 300,
    height: 205,
    frameId: 'frame-discover',
  },
  'node-prototype': {
    type: 'task',
    taskId: 'build',
    x: 852,
    y: 112,
    width: 300,
    height: 190,
    frameId: 'frame-deliver',
  },
  'node-review': {
    type: 'task',
    taskId: 'review',
    x: 1196,
    y: 112,
    width: 300,
    height: 190,
    frameId: 'frame-deliver',
  },
  'node-ship': {
    type: 'task',
    taskId: 'ship',
    x: 1196,
    y: 346,
    width: 300,
    height: 190,
    frameId: 'frame-deliver',
  },
  'node-note': {
    type: 'sticky',
    content:
      '### A gentle reminder\n\nMake space for the important things.\n\n**One useful release** beats a hundred ideas left unfinished.',
    x: 72,
    y: 338,
    width: 300,
    height: 198,
    frameId: 'frame-discover',
  },
  'node-reference': {
    type: 'note',
    notePath: 'Project notes.md',
    x: 416,
    y: 358,
    width: 300,
    height: 178,
    frameId: 'frame-discover',
  },
};
example.edges = { 'edge-brief-sketch': { source: 'node-brief', target: 'node-sketch', label: 'informs' } };
await mkdir('examples', { recursive: true });
await writeFile(
  'examples/Welcome to Roseboard.md',
  `A board is an ordinary Markdown note. This paragraph is preserved when Roseboard saves.\n\n${boardNote(validateBoard(example))}\nYour writing can continue below the board.\n`,
);
await writeFile(
  'examples/Project notes.md',
  '# Project notes\n\nThis is an independent vault note. Roseboard stores a reference, not a copy of its contents.\n',
);
await writeFile('examples/stress-300.md', boardNote(stressBoard()));
