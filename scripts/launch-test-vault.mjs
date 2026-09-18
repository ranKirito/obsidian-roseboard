import { mkdtemp, mkdir, writeFile, copyFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
const base = await mkdtemp(join(tmpdir(), 'roseboard-obsidian-'));
const vault = join(base, 'Roseboard Test Vault'),
  profile = join(base, 'profile');
await mkdir(join(vault, '.obsidian/plugins/roseboard'), { recursive: true });
await mkdir(profile, { recursive: true });
for (const file of ['main.js', 'manifest.json', 'styles.css'])
  await copyFile(file, join(vault, '.obsidian/plugins/roseboard', file));
for (const file of ['Welcome to Roseboard.md', 'Project notes.md', 'stress-300.md'])
  await copyFile(join('examples', file), join(vault, file));
await writeFile(join(vault, '.obsidian/community-plugins.json'), JSON.stringify(['roseboard']));
await writeFile(
  join(vault, '.obsidian/app.json'),
  JSON.stringify({ livePreview: false, showUnsupportedFiles: true, communityPluginEnabled: true }),
);
await writeFile(
  join(vault, '.obsidian/core-plugins.json'),
  JSON.stringify(['file-explorer', 'global-search', 'switcher', 'command-palette']),
);
await writeFile(join(vault, '.obsidian/appearance.json'), JSON.stringify({ theme: 'obsidian' }));
await writeFile(
  join(vault, '.obsidian/workspace.json'),
  JSON.stringify({
    main: {
      id: 'main',
      type: 'split',
      children: [
        {
          id: 'leaf-board',
          type: 'leaf',
          state: { type: 'roseboard-view', state: { path: 'Welcome to Roseboard.md' } },
        },
      ],
      direction: 'vertical',
    },
    left: { id: 'left', type: 'split', children: [], direction: 'horizontal', width: 250, collapsed: true },
    right: { id: 'right', type: 'split', children: [], direction: 'horizontal', width: 300, collapsed: true },
    active: 'leaf-board',
    lastOpenFiles: [],
  }),
);
await writeFile(
  join(profile, 'obsidian.json'),
  JSON.stringify({ vaults: { 'roseboard-test': { path: vault, ts: Date.now(), open: true } } }),
);
const app = process.env.OBSIDIAN_EXECUTABLE || '/Applications/Obsidian.app/Contents/MacOS/Obsidian';
const child = spawn(
  app,
  [`--user-data-dir=${profile}`, '--remote-debugging-port=19287', '--remote-debugging-address=127.0.0.1'],
  { stdio: ['ignore', 'pipe', 'pipe'], detached: true },
);
const log = createWriteStream(join(base, 'obsidian.log'));
child.stdout.pipe(log);
child.stderr.pipe(log);
child.unref();
await mkdir('.test-runtime', { recursive: true });
await writeFile(
  '.test-runtime/runtime.json',
  JSON.stringify({ base, vault, profile, pid: child.pid, port: 19287 }, null, 2),
);
console.log(JSON.stringify({ base, vault, profile, pid: child.pid, port: 19287 }));
setTimeout(() => process.exit(0), 1200);
