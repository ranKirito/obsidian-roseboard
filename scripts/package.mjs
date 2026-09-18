import { mkdir, copyFile, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
await import('./notices.mjs');
const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
const target = join('release', manifest.id);
await mkdir(target, { recursive: true });
for (const file of ['manifest.json', 'main.js', 'styles.css', 'LICENSE', 'THIRD_PARTY_NOTICES.md'])
  await copyFile(file, join(target, file));
const zip = `${manifest.id}-${manifest.version}.zip`;
await rm(join('release', zip), { force: true });
execFileSync('zip', ['-q', '-r', zip, manifest.id], { cwd: 'release' });
const hashes = [];
for (const file of ['main.js', 'styles.css', 'manifest.json', join('release', zip)])
  hashes.push(
    `${createHash('sha256')
      .update(await readFile(file))
      .digest('hex')}  ${file}`,
  );
await writeFile('release/SHA256SUMS.txt', hashes.join('\n') + '\n');
console.log(`Packaged release/${zip}`);
