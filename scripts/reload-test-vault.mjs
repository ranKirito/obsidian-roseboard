// Copies the current build into the running temporary test vault and reloads the plugin there.
// It never touches a real vault: the target comes from .test-runtime/runtime.json only.
import { chromium } from 'playwright';
import { copyFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
const runtime = JSON.parse(await readFile('.test-runtime/runtime.json', 'utf8'));
for (const file of ['main.js', 'manifest.json', 'styles.css'])
  await copyFile(file, join(runtime.vault, '.obsidian/plugins/roseboard', file));
for (const file of ['Welcome to Roseboard.md', 'Project notes.md', 'stress-300.md'])
  await copyFile(join('examples', file), join(runtime.vault, file));
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${runtime.port}`);
const page = browser.contexts()[0].pages()[0];
await page.evaluate(async () => {
  app.workspace.getLeavesOfType('roseboard-view').forEach((l) => l.detach());
  await app.plugins.disablePlugin('roseboard');
  await app.plugins.enablePlugin('roseboard');
});
console.log('Reloaded roseboard', JSON.parse(await readFile('manifest.json', 'utf8')).version, 'in', runtime.vault);
await browser.close();
