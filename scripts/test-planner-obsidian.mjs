import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFile, writeFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { build } from 'esbuild';
import { restrictedReactDOM } from './restrict-react-dom.mjs';
const runtime = JSON.parse(await readFile('.test-runtime/runtime.json', 'utf8'));
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${runtime.port}`);
const page = browser.contexts()[0].pages()[0];
page.setDefaultTimeout(6000);
await page.setViewportSize({ width: 1440, height: 1000 });
assert.equal(
  await realpath(await page.evaluate(() => app.vault.adapter.getBasePath())),
  await realpath(runtime.vault),
  'Refusing to test outside the isolated vault',
);
const results = [],
  errors = [],
  requests = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('request', (request) => {
  if (request.url().includes('roseboard-test.invalid')) requests.push(request.url());
});
const report = {
  version: JSON.parse(await readFile('manifest.json', 'utf8')).version,
  started: new Date().toISOString(),
  results,
  errors,
};
const path = 'Planner acceptance.md';
const notePath = 'Reader fixtures/Project brief.md';
const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Ljubljana',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());
const offset = (n) => {
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const baseTask = (title, extra = {}) => ({
  title,
  description: '',
  status: 'todo',
  priority: 'none',
  tags: [],
  checklist: [],
  dependsOn: [],
  ...extra,
});
const fixture = {
  schemaVersion: 1,
  boardId: 'planner-acceptance',
  title: 'Studio · Weekly rhythm',
  timeZone: 'Europe/Ljubljana',
  tasks: {
    review: baseTask('Review the release brief', {
      dueDate: today,
      assignee: 'Anna',
      priority: 'high',
      notePath,
      checklist: [
        { id: 'scope', text: 'Confirm scope', done: true },
        { id: 'finish', text: 'Share feedback', done: false },
      ],
    }),
    draft: baseTask('Draft the weekly update', { assignee: 'Sam', priority: 'medium' }),
    handoff: baseTask('Confirm the handoff', { dueDate: offset(-1), assignee: 'Anna' }),
    research: baseTask('Collect reference notes', { dueDate: today, status: 'done', assignee: 'Sam' }),
    blocked: baseTask('Publish the update', { dueDate: today, dependsOn: ['draft'] }),
    tomorrow: baseTask('Sketch next week’s priorities', { dueDate: offset(1), assignee: 'Sam' }),
  },
  nodes: {
    reviewCard: { type: 'task', taskId: 'review', x: 60, y: 100, width: 300, height: 220 },
    docCard: { type: 'note', notePath, x: 430, y: 100, width: 420, height: 390 },
  },
  edges: {},
};
const note = `---\ntags: [project]\n---\n# Release brief\n\nA calmer workspace for shared ideas and daily progress.\n\n## The plan\n\n| Workstream | Owner |\n| --- | --- |\n| Documents | Anna |\n| Daily planning | Sam |\n\n- [x] Align on the goal\n- [ ] Review the final build\n\nSee [supporting notes](./Sibling.md#Context) and [[Reader fixtures/Sibling|wiki note]].\n\n> Keep the original notes close to the work.\n\n\`[[literal example]]\`\n\n![Do not fetch](https://roseboard-test.invalid/tracker.png)\n\n<script>window.roseboardReaderUnsafe=true</script>\n`;
const root = () => page.locator('.roseboard-root:visible').last();
const board = () =>
  page.evaluate(
    (path) =>
      app.workspace
        .getLeavesOfType('roseboard-view')
        .find((l) => l.view.session?.path === path)
        .view.session.getSnapshot().board,
    path,
  );
const flush = () =>
  page.evaluate(async (path) => {
    const session = app.workspace.getLeavesOfType('roseboard-view').find((l) => l.view.session?.path === path)
      .view.session;
    await session.flush();
  }, path);
const eventually = async (check) => {
  let last;
  for (let i = 0; i < 50; i++) {
    try {
      await check();
      return;
    } catch (error) {
      last = error;
      await page.waitForTimeout(100);
    }
  }
  throw last;
};
const menuAction = async (label, item) => {
  await root().getByRole('button', { name: label, exact: true }).click();
  await page
    .locator('.menu .menu-item-title')
    .filter({ hasText: new RegExp('^' + item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') })
    .click();
};
const mode = (name) => menuAction('Board view', name);
const action = (name) => menuAction('Board actions', name);
const search = async (value) => {
  if (!(await root().getByRole('textbox', { name: 'Search tasks', exact: true }).count()))
    await root().getByLabel('Toggle task search').click();
  await root().getByRole('textbox', { name: 'Search tasks', exact: true }).fill(value);
};
const closeInspector = async () => {
  const close = root().getByRole('button', { name: 'Close inspector', exact: true });
  if (await close.count()) await close.click();
};
async function test(name, run) {
  const start = Date.now();
  try {
    await run();
    results.push({ name, result: 'PASS', ms: Date.now() - start });
    console.log(`PASS ${name}`);
  } catch (error) {
    results.push({ name, result: 'FAIL', error: error.message });
    console.log(`FAIL ${name}: ${error.message}`);
    await page.screenshot({ path: `docs/failure-planner-${results.length}.png` });
  }
}
try {
  await page.evaluate(
    async ({ path, notePath, fixture, note }) => {
      app.workspace.getLeavesOfType('markdown').forEach((l) => l.detach());
      app.workspace.getLeavesOfType('roseboard-view').forEach((l) => l.detach());
      const plugin = app.plugins.plugins.roseboard;
      await Promise.all([...plugin.noteSessions.values()].map(async (pending) => (await pending).discard()));
      for (const draftPath of [notePath, 'Reader fixtures/Renamed brief.md'])
        await plugin.noteStorage.draft(draftPath, null);
      Object.assign(plugin.settings, { culling: 'off', deviceName: 'Test Mac', stamps: true });
      app.vault.setConfig('nativeMenus', false);
      if (!app.vault.getAbstractFileByPath('Reader fixtures'))
        await app.vault.createFolder('Reader fixtures');
      const recovered = app.vault.getAbstractFileByPath('Reader fixtures/Project brief - recovered.md');
      if (recovered) await app.vault.delete(recovered);
      const renamed = app.vault.getAbstractFileByPath('Reader fixtures/Renamed brief.md');
      if (renamed) await app.vault.delete(renamed);
      for (const [filePath, text] of [
        [notePath, note],
        ['Reader fixtures/Sibling.md', '# Context\n\nRelative link works.'],
        ['Sibling.md', '# Wrong root sibling'],
        [
          path,
          '# A shared workspace\n\n```roseboard\n' +
            JSON.stringify(fixture, null, 2) +
            '\n```\n\nKeep this paragraph.\n',
        ],
      ]) {
        const file = app.vault.getAbstractFileByPath(filePath);
        if (file) await app.vault.modify(file, text);
        else await app.vault.create(filePath, text);
      }
      await plugin.openBoard(path);
    },
    { path, notePath, fixture, note },
  );
  await root().locator('.rb-brand strong').waitFor();
  await test('The bundled renderer rejects script loading and script elements without network requests', async () => {
    const fixture = await build({
      stdin: {
        contents:
          'export { createRoot } from "react-dom/client"; export { preinit, preinitModule } from "react-dom"; export { createElement } from "react";',
        resolveDir: process.cwd(),
      },
      bundle: true,
      platform: 'browser',
      format: 'cjs',
      define: { 'process.env.NODE_ENV': '"production"' },
      plugins: [restrictedReactDOM],
      write: false,
    });
    const result = await page.evaluate(async (code) => {
      const module = { exports: {} };
      new Function('module', 'exports', code)(module, module.exports);
      const renderer = module.exports;
      const messages = [];
      const url = 'https://roseboard-test.invalid/blocked-script.js';
      for (const name of ['preinit', 'preinitModule']) {
        try {
          renderer[name](url, { as: 'script' });
          messages.push('Not blocked');
        } catch (error) {
          messages.push(error.message);
        }
      }
      for (const async of [false, true]) {
        const container = document.body.appendChild(document.createElement('div'));
        let root;
        let timer;
        try {
          messages.push(
            await new Promise((resolve) => {
              timer = window.setTimeout(() => resolve('Not blocked'), 2000);
              root = renderer.createRoot(container, { onUncaughtError: (error) => resolve(error.message) });
              root.render(renderer.createElement('script', { src: url, async }));
            }),
          );
        } finally {
          window.clearTimeout(timer);
          root?.unmount();
          container.remove();
        }
      }
      return { messages, scripts: [...document.scripts].filter((script) => script.src === url).length };
    }, fixture.outputFiles[0].text);
    assert.equal(result.messages.length, 4);
    assert.ok(result.messages.every((message) => message.includes('Roseboard does not support script')));
    assert.equal(result.scripts, 0);
    assert.equal(requests.length, 0);
  });
  await test('Read expands in place; scrolling stays inside the document and the board source is unchanged', async () => {
    await root().getByLabel('Reset zoom', { exact: true }).click();
    const before = JSON.stringify(await board());
    const card = root().locator('[data-id="docCard"]');
    const size = await card.boundingBox();
    const camera = await root().locator('.react-flow__viewport').getAttribute('style');
    await card.getByRole('button', { name: 'Read', exact: true }).click();
    await eventually(async () => assert.ok((await card.boundingBox()).height > size.height));
    assert.equal(await root().locator('.rb-document-reader').count(), 0);
    assert.equal(await root().locator('.react-flow__viewport').getAttribute('style'), camera);
    const full =
      note +
      '\n' +
      Array.from({ length: 80 }, (_, i) => `Paragraph ${i}: enough room to read the entire document.`).join(
        '\n\n',
      ) +
      '\nEnd of document.';
    await page.evaluate(
      async ([path, text]) => app.vault.modify(app.vault.getAbstractFileByPath(path), text),
      [notePath, full],
    );
    await card.getByText('End of document.', { exact: false }).waitFor();
    const reader = card.locator('.rb-note-reading');
    const rect = await reader.boundingBox();
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await page.mouse.wheel(0, 350);
    await eventually(async () => assert.ok(await reader.evaluate((el) => el.scrollTop > 0)));
    assert.equal(await root().locator('.react-flow__viewport').getAttribute('style'), camera);
    await reader.dispatchEvent('wheel', { bubbles: true, deltaY: 120, shiftKey: true });
    assert.equal(await root().locator('.react-flow__viewport').getAttribute('style'), camera);
    await page.screenshot({ path: 'docs/roseboard-canvas-reader.png' });
    await card.getByRole('button', { name: 'Collapse', exact: true }).click();
    await eventually(async () =>
      assert.equal(Math.round((await card.boundingBox()).height), Math.round(size.height)),
    );
    assert.equal(JSON.stringify(await board()), before);
    await page.evaluate(
      async ([path, text]) => app.vault.modify(app.vault.getAbstractFileByPath(path), text),
      [notePath, note],
    );
  });
  await test('Double-click edits inside the card; Save preserves properties and changes only the linked note', async () => {
    const card = root().locator('[data-id="docCard"]');
    const before = JSON.stringify(await board());
    await card.locator('.rb-note-preview').getByText('A calmer workspace', { exact: false }).dblclick();
    const field = card.getByLabel('Edit document Markdown');
    await field.waitFor();
    assert.equal(await field.inputValue(), note);
    await field.fill(note + '\nEdited on the canvas.\n');
    await card.getByRole('button', { name: 'Save note', exact: true }).focus();
    assert.equal(
      await readFile(join(runtime.vault, notePath), 'utf8'),
      note,
      'blur must not discard or commit drafts',
    );
    await page.screenshot({ path: 'docs/roseboard-canvas-editor.png' });
    await field.press('Meta+Enter');
    await field.waitFor({ state: 'detached' });
    assert.equal(await readFile(join(runtime.vault, notePath), 'utf8'), note + '\nEdited on the canvas.\n');
    assert.equal(JSON.stringify(await board()), before);
    await card.getByText('Edited on the canvas.').waitFor();
  });
  await test('Unsaved note edits survive view changes and plugin reload', async () => {
    let card = root().locator('[data-id="docCard"]');
    await card.getByRole('button', { name: 'Edit', exact: true }).click();
    await card.getByLabel('Edit document Markdown').fill(note + '\nRecovered draft.\n');
    await mode('List');
    await mode('Canvas');
    await root().getByLabel('Reset zoom', { exact: true }).click();
    card = root().locator('[data-id="docCard"]');
    await card.getByRole('button', { name: 'Edit', exact: true }).click();
    assert.ok((await card.getByLabel('Edit document Markdown').inputValue()).includes('Recovered draft.'));
    await mode('List');
    await page.evaluate(async () => {
      const plugin = app.plugins.plugins.roseboard;
      app.workspace.getLeavesOfType('roseboard-view').forEach((leaf) => leaf.detach());
      await Promise.all([...plugin.noteSessions.values()].map(async (pending) => (await pending).stash()));
      await app.plugins.disablePlugin('roseboard');
      await app.plugins.enablePlugin('roseboard');
    });
    await page.evaluate((path) => app.plugins.plugins.roseboard.openBoard(path), path);
    await root().getByLabel('Reset zoom', { exact: true }).click();
    card = root().locator('[data-id="docCard"]');
    await card.getByRole('button', { name: 'Read', exact: true }).click();
    await card.getByRole('button', { name: 'Edit', exact: true }).click();
    assert.ok((await card.getByLabel('Edit document Markdown').inputValue()).includes('Recovered draft.'));
    await card.getByText('Draft restored', { exact: true }).waitFor();
    await card.getByRole('button', { name: 'Save note', exact: true }).click();
    await card.getByLabel('Edit document Markdown').waitFor({ state: 'detached' });
  });
  await test('A conflicting note update cannot be overwritten; the draft can be saved separately', async () => {
    const card = root().locator('[data-id="docCard"]');
    await card.getByRole('button', { name: 'Edit', exact: true }).click();
    await card.getByLabel('Edit document Markdown').fill(note + '\nMy unsaved change.\n');
    const remote = note + '\nA collaborator changed this note.\n';
    await page.evaluate(
      async ([path, text]) => app.vault.modify(app.vault.getAbstractFileByPath(path), text),
      [notePath, remote],
    );
    await card.getByRole('button', { name: 'Save note', exact: true }).click();
    await card.getByRole('alert').getByText('This note changed elsewhere.', { exact: false }).waitFor();
    assert.equal(await readFile(join(runtime.vault, notePath), 'utf8'), remote);
    await card.getByRole('button', { name: 'Save a copy', exact: true }).click();
    await eventually(async () =>
      assert.ok(
        (
          await readFile(join(runtime.vault, 'Reader fixtures/Project brief - recovered.md'), 'utf8')
        ).includes('My unsaved change.'),
      ),
    );
    await card.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('heading', { name: 'Discard note changes?', exact: true }).waitFor();
    await page.locator('.modal').getByRole('button', { name: 'Continue', exact: true }).click();
    await card.getByLabel('Edit document Markdown').waitFor({ state: 'detached' });
    assert.equal(await readFile(join(runtime.vault, notePath), 'utf8'), remote);
    await page.evaluate(
      async ([path, text]) => app.vault.modify(app.vault.getAbstractFileByPath(path), text),
      [notePath, note],
    );
  });
  await test('Cards of the same note share edits, and an active draft follows a file rename', async () => {
    const shared = await page.evaluate(
      async ({ path, notePath }) => {
        const plugin = app.plugins.plugins.roseboard;
        const source = app.workspace
          .getLeavesOfType('roseboard-view')
          .find((leaf) => leaf.view.session?.path === path).view.session;
        const host = plugin.host(source);
        const [one, two] = await Promise.all([host.editNote(notePath), host.editNote(notePath)]);
        const same = one === two;
        await one.discard();
        return same;
      },
      { path, notePath },
    );
    assert.equal(shared, true);
    const card = root().locator('[data-id="docCard"]');
    await card.getByRole('button', { name: 'Edit', exact: true }).click();
    await card.getByLabel('Edit document Markdown').fill(note + '\nDraft during rename.\n');
    await page.evaluate(
      async (path) =>
        app.fileManager.renameFile(app.vault.getAbstractFileByPath(path), 'Reader fixtures/Working brief.md'),
      notePath,
    );
    await eventually(async () =>
      assert.equal((await board()).nodes.docCard.notePath, 'Reader fixtures/Working brief.md'),
    );
    await card.getByRole('button', { name: 'Save note', exact: true }).click();
    await card.getByLabel('Edit document Markdown').waitFor({ state: 'detached' });
    assert.ok(
      (await readFile(join(runtime.vault, 'Reader fixtures/Working brief.md'), 'utf8')).includes(
        'Draft during rename.',
      ),
    );
    await page.evaluate(
      async ({ path, text }) => {
        await app.fileManager.renameFile(
          app.vault.getAbstractFileByPath('Reader fixtures/Working brief.md'),
          path,
        );
        await app.vault.modify(app.vault.getAbstractFileByPath(path), text);
      },
      { path: notePath, text: note },
    );
  });
  await test('Document cards render live Markdown safely while reading on the canvas', async () => {
    await root().getByLabel('Reset zoom', { exact: true }).click();
    await root().locator('.rb-note-preview').getByText('A calmer workspace', { exact: false }).waitFor();
    assert.equal(await root().locator('.rb-note-preview table').count(), 1);
    const card = root().locator('[data-id="docCard"]');
    // The editing scenarios above may leave this card open for reading.
    const read = card.getByRole('button', { name: 'Read', exact: true });
    if (await read.count()) await read.click();
    const reader = card.locator('.rb-note-reading');
    assert.ok((await reader.innerText()).includes('Release brief'));
    assert.equal(await reader.locator('input[type=checkbox]:disabled').count(), 2);
    assert.equal(await reader.locator('img, script, iframe').count(), 0);
    assert.equal(requests.length, 0);
    assert.equal(await page.evaluate(() => window.roseboardReaderUnsafe), undefined);
    await page.screenshot({ path: 'docs/roseboard-canvas-reader.png' });
  });
  await test('Reader refreshes external note edits and resolves explicit Markdown links relative to the document', async () => {
    const card = root().locator('[data-id="docCard"]');
    await page.evaluate(
      async ([path, text]) => app.vault.modify(app.vault.getAbstractFileByPath(path), text),
      [notePath, note + '\nFresh content from a collaborator.\n'],
    );
    await card.locator('.rb-note-reading').getByText('Fresh content from a collaborator.').waitFor();
    await card
      .locator('.rb-note-reading')
      .getByRole('button', { name: 'supporting notes', exact: true })
      .click();
    await page.waitForFunction(
      () => app.workspace.getMostRecentLeaf()?.view?.file?.path === 'Reader fixtures/Sibling.md',
    );
    await page.evaluate((path) => {
      app.workspace.getLeavesOfType('markdown').forEach((l) => l.detach());
      const leaf = app.workspace.getLeavesOfType('roseboard-view').find((l) => l.view.session?.path === path);
      app.workspace.setActiveLeaf(leaf, { focus: true });
    }, path);
  });
  await test('Document rename, deletion and restoration update the card without altering note bodies', async () => {
    const card = root().locator('[data-id="docCard"]');
    await page.evaluate(
      async ([oldPath, newPath]) => app.vault.rename(app.vault.getAbstractFileByPath(oldPath), newPath),
      [notePath, 'Reader fixtures/Renamed brief.md'],
    );
    await eventually(async () =>
      assert.equal((await board()).tasks.review.notePath, 'Reader fixtures/Renamed brief.md'),
    );
    await card.locator('.rb-note-reading').getByText('Release brief', { exact: true }).waitFor();
    await page.evaluate(async () =>
      app.vault.delete(app.vault.getAbstractFileByPath('Reader fixtures/Renamed brief.md')),
    );
    await card.getByText('This note is missing.', { exact: false }).waitFor();
    await page.evaluate(async (text) => {
      await app.vault.create('Reader fixtures/Renamed brief.md', text);
    }, note);
    await card.locator('.rb-note-reading').getByText('Release brief', { exact: true }).waitFor();
    assert.equal(await readFile(join(runtime.vault, 'Reader fixtures/Renamed brief.md'), 'utf8'), note);
    await card.getByRole('button', { name: 'Collapse', exact: true }).click();
  });
  await test('Read on canvas from a planner opens the linked card in place; there is no separate reader view', async () => {
    const before = JSON.stringify(await board());
    await mode('Day');
    await root().getByRole('button', { name: 'Board view', exact: true }).click();
    assert.equal(
      await page
        .locator('.menu .menu-item-title')
        .filter({ hasText: /^Documents$/ })
        .count(),
      0,
    );
    await page.keyboard.press('Escape');
    await root().locator('.rb-agenda-title').filter({ hasText: 'Review the release brief' }).click();
    await root().getByRole('button', { name: 'Read on canvas', exact: true }).click();
    await root().locator('[data-id="docCard"] .rb-note-reading').getByText('Release brief').waitFor();
    assert.equal(await root().getByLabel('Inspector', { exact: true }).count(), 0);
    assert.equal(JSON.stringify(await board()), before);
    await root()
      .locator('[data-id="docCard"]')
      .getByRole('button', { name: 'Collapse', exact: true })
      .click();
  });
  await test('Day view capture also places the task on the canvas, tracks progress, and keeps overdue work separate', async () => {
    await mode('Day');
    await root().getByLabel('Planner date').fill(today);
    assert.equal(
      await root()
        .getByLabel('Selected day tasks', { exact: true })
        .locator(':scope > .rb-agenda-rows > article')
        .count(),
      3,
    );
    assert.equal(await root().getByLabel('Daily task progress').getAttribute('value'), '1');
    assert.ok((await root().getByLabel('Overdue tasks').innerText()).includes('Confirm the handoff'));
    await root().getByLabel('New daily task').fill('Prepare the demo');
    await root().getByLabel('New daily task').press('Enter');
    const b = await board();
    const [id, task] = Object.entries(b.tasks).find(([, t]) => t.title === 'Prepare the demo');
    assert.equal(task.dueDate, today);
    const placed = Object.values(b.nodes).filter((n) => n.taskId === id);
    assert.equal(placed.length, 1);
    for (const other of Object.values(b.nodes))
      if (other !== placed[0])
        assert.ok(
          placed[0].x >= other.x + other.width ||
            placed[0].x + placed[0].width <= other.x ||
            placed[0].y >= other.y + other.height ||
            placed[0].y + placed[0].height <= other.y,
          'the new card must not cover an existing card',
        );
    await root().getByRole('button', { name: 'Complete Prepare the demo', exact: true }).click();
    assert.equal((await board()).tasks[id].status, 'done');
    await action('Undo');
    assert.equal((await board()).tasks[id].status, 'todo');
    await page.screenshot({ path: 'docs/roseboard-day.png' });
  });
  await test('Unscheduled planning and accessible rescheduling change only the due date and undo cleanly', async () => {
    const positions = (await board()).nodes;
    await root().getByLabel(`Schedule Draft the weekly update for ${today}`, { exact: true }).click();
    assert.equal((await board()).tasks.draft.dueDate, today);
    await root().getByLabel('Reschedule Draft the weekly update', { exact: true }).click();
    await page.locator('.menu-item').filter({ hasText: 'Tomorrow' }).click();
    assert.equal((await board()).tasks.draft.dueDate, offset(1));
    assert.deepEqual((await board()).nodes, positions);
    await action('Undo');
    assert.equal((await board()).tasks.draft.dueDate, today);
  });
  await test('Day tasks move by drag and drop between Unscheduled, the day list and the week strip', async () => {
    await mode('Day');
    await root().getByLabel('Planner date').fill(today);
    const positions = (await board()).nodes;
    const drag = async (source, target) => {
      const transfer = await page.evaluateHandle(() => new DataTransfer());
      await source.dispatchEvent('dragstart', { dataTransfer: transfer });
      await target.dispatchEvent('dragover', { dataTransfer: transfer });
      await target.dispatchEvent('drop', { dataTransfer: transfer });
      await source.dispatchEvent('dragend', { dataTransfer: transfer }).catch(() => {});
      await transfer.dispose();
    };
    const row = (region, title) =>
      root().getByLabel(region, { exact: true }).locator('.rb-agenda-task').filter({ hasText: title });
    // The previous scenario leaves the draft planned for today.
    assert.equal((await board()).tasks.draft.dueDate, today);
    await drag(
      row('Selected day tasks', 'Draft the weekly update'),
      root().getByLabel('Unscheduled tasks', { exact: true }),
    );
    assert.equal((await board()).tasks.draft.dueDate, undefined);
    await drag(
      row('Unscheduled tasks', 'Draft the weekly update'),
      root().getByLabel('Selected day tasks', { exact: true }),
    );
    assert.equal((await board()).tasks.draft.dueDate, today);
    const weekday = (new Date(`${offset(1)}T12:00:00Z`).getUTCDay() + 6) % 7;
    if (weekday !== 0) {
      await drag(
        row('Selected day tasks', 'Draft the weekly update'),
        root().locator('.rb-week-day').nth(weekday),
      );
      assert.equal((await board()).tasks.draft.dueDate, offset(1));
      await action('Undo');
      assert.equal((await board()).tasks.draft.dueDate, today);
    }
    assert.deepEqual((await board()).nodes, positions);
    await root().getByLabel('Planner date').fill(today);
    await root().getByRole('button', { name: 'Move all to today', exact: true }).click();
    assert.equal((await board()).tasks.handoff.dueDate, today);
    await action('Undo');
    assert.equal((await board()).tasks.handoff.dueDate, offset(-1));
  });
  await test('Routines repeat on chosen weekdays, tick per day, keep a streak, and stay out of tasks and the canvas', async () => {
    const before = await board();
    await root().getByLabel('New routine').fill('Morning review');
    await root().getByLabel('New routine').press('Enter');
    let b = await board();
    const [id, routine] = Object.entries(b.routines).find(([, r]) => r.title === 'Morning review');
    assert.deepEqual(routine.days, [1, 2, 3, 4, 5, 6, 7]);
    assert.deepEqual(b.tasks, before.tasks);
    assert.deepEqual(b.nodes, before.nodes);
    await root().getByRole('checkbox', { name: 'Complete routine Morning review' }).click();
    assert.deepEqual((await board()).routines[id].done, [today]);
    assert.equal(await root().getByLabel('Routine progress').getAttribute('value'), '1');
    // Yesterday counts towards the streak shown today.
    await root().getByLabel('Previous day').click();
    await root().getByRole('checkbox', { name: 'Complete routine Morning review' }).click();
    await root().getByRole('button', { name: 'Today', exact: true }).click();
    await root().locator('.rb-streak').filter({ hasText: '2' }).waitFor();
    // Future days are visible but cannot be ticked early.
    await root().getByLabel('Next day').click();
    assert.ok(await root().getByRole('checkbox', { name: 'Complete routine Morning review' }).isDisabled());
    await root().getByRole('button', { name: 'Today', exact: true }).click();
    // Weekday schedule: a weekday-only routine disappears from a weekend day.
    await root().getByRole('button', { name: 'Routine options for Morning review', exact: true }).click();
    await page
      .locator('.menu .menu-item-title')
      .filter({ hasText: /^Weekdays$/ })
      .click();
    assert.deepEqual((await board()).routines[id].days, [1, 2, 3, 4, 5]);
    const weekday = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7; // 0 = Monday
    const saturday = offset((5 - weekday + 7) % 7 || 7);
    const monday = offset((7 - weekday) % 7 || 7);
    await root().getByLabel('Planner date').fill(saturday);
    assert.equal(
      await root()
        .getByRole('checkbox', { name: /routine Morning review/ })
        .count(),
      0,
    );
    await root().getByText('1 routine not scheduled', { exact: false }).waitFor();
    await root().getByLabel('Planner date').fill(monday);
    await flush();
    const stored = JSON.parse(
      (await readFile(join(runtime.vault, path), 'utf8')).match(/```roseboard\n([\s\S]*?)\n```/)[1],
    );
    assert.deepEqual(stored.routines[id].days, [1, 2, 3, 4, 5]);
    assert.ok(stored.routines[id].done.includes(today));
    await root().getByRole('button', { name: 'Routine options for Morning review', exact: true }).click();
    await page
      .locator('.menu .menu-item-title')
      .filter({ hasText: /^Delete routine…$/ })
      .click();
    await page.getByRole('heading', { name: 'Delete routine?' }).waitFor();
    await page.locator('.modal').getByRole('button', { name: 'Continue', exact: true }).click();
    await eventually(async () => assert.equal((await board()).routines, undefined));
    await action('Undo');
    assert.equal((await board()).routines[id].title, 'Morning review');
    await root().getByLabel('Planner date').fill(today);
    await page.screenshot({ path: 'docs/roseboard-day.png' });
  });
  await test('Assignments are editable, searchable and filter the calendar and daily view', async () => {
    await root().locator('.rb-agenda-title').filter({ hasText: 'Review the release brief' }).click();
    await root().getByLabel('Task assignee', { exact: true }).fill('Alex');
    await root().getByLabel('Task title', { exact: true }).click();
    assert.equal((await board()).tasks.review.assignee, 'Alex');
    await closeInspector();
    await root().getByLabel('Toggle filters', { exact: true }).click();
    await root().getByLabel('Filter assignee').selectOption('name:Alex');
    assert.equal(
      await root()
        .getByLabel('Selected day tasks', { exact: true })
        .locator(':scope > .rb-agenda-rows > article')
        .count(),
      1,
    );
    await mode('Calendar');
    assert.equal(await root().locator('.rb-calendar-task').count(), 1);
    await root().getByRole('button', { name: 'Clear active filters', exact: true }).click();
    await root().getByLabel('Toggle filters', { exact: true }).click();
    await search('Alex');
    assert.equal(await root().locator('.rb-calendar-task').count(), 1);
    await search('');
  });
  await test('Calendar navigation and drag rescheduling preserve canvas positions and persist on disk', async () => {
    const positions = (await board()).nodes;
    const targetDate = offset(3);
    const transfer = await page.evaluateHandle(() => new DataTransfer());
    const task = root().locator('.rb-calendar-task').filter({ hasText: 'Review the release brief' });
    await task.dispatchEvent('dragstart', { dataTransfer: transfer });
    const cell = root().getByLabel(`Plan ${targetDate}`, { exact: true }).locator('..');
    await cell.dispatchEvent('dragover', { dataTransfer: transfer });
    await cell.dispatchEvent('drop', { dataTransfer: transfer });
    await task.dispatchEvent('dragend', { dataTransfer: transfer });
    await transfer.dispose();
    assert.equal((await board()).tasks.review.dueDate, targetDate);
    assert.deepEqual((await board()).nodes, positions);
    await flush();
    const source = await readFile(join(runtime.vault, path), 'utf8');
    assert.ok(source.startsWith('# A shared workspace\n'));
    assert.ok(source.endsWith('Keep this paragraph.\n'));
    assert.equal(
      JSON.parse(source.match(/```roseboard\n([\s\S]*?)\n```/)[1]).tasks.review.dueDate,
      targetDate,
    );
    await root().getByLabel('Next month').click();
    assert.notEqual((await root().getByLabel('Planner date').inputValue()).slice(0, 7), today.slice(0, 7));
    await root().getByRole('button', { name: 'Today', exact: true }).click();
    assert.equal(await root().getByLabel('Planner date').inputValue(), today);
    await page.screenshot({ path: 'docs/roseboard-calendar.png' });
  });
  await test('Blocked completion still requires the existing confirmation', async () => {
    await mode('Day');
    await root().getByRole('button', { name: 'Complete Publish the update', exact: true }).click();
    await page.getByRole('heading', { name: 'Complete a blocked task?' }).waitFor();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal((await board()).tasks.blocked.status, 'todo');
  });
  await test('Source editing makes planner controls read-only; they resume after the editor closes', async () => {
    await action('Open source');
    await page.evaluate((path) => {
      const leaf = app.workspace.getLeavesOfType('roseboard-view').find((l) => l.view.session?.path === path);
      app.workspace.setActiveLeaf(leaf, { focus: true });
    }, path);
    await eventually(async () => assert.ok(await root().getByLabel('New daily task').isDisabled()));
    assert.ok(
      await root().getByRole('button', { name: 'Complete Publish the update', exact: true }).isDisabled(),
    );
    await page.evaluate(() => app.workspace.getLeavesOfType('markdown').forEach((l) => l.detach()));
    await eventually(async () => assert.ok(await root().getByLabel('New daily task').isEnabled()));
  });
  await test('Document and planning shortcuts never edit hidden selected canvas cards', async () => {
    await mode('Canvas');
    await root().locator('[data-id="reviewCard"]').click();
    await closeInspector();
    const before = await board();
    for (const name of ['Day', 'Calendar', 'List']) {
      await mode(name);
      await root().focus();
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('Delete');
      await page.keyboard.press('Meta+d');
      assert.deepEqual((await board()).nodes, before.nodes);
      assert.equal(Object.keys((await board()).tasks).length, Object.keys(before.tasks).length);
    }
  });
  await test('Narrow desktop viewport keeps Day, Calendar and List usable without horizontal overflow', async () => {
    await page.setViewportSize({ width: 430, height: 900 });
    for (const name of ['Day', 'Calendar', 'List']) {
      await mode(name);
      const selector = name === 'List' ? '.rb-list' : '.rb-planner';
      const sizes = await root()
        .locator(selector)
        .evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
      assert.ok(sizes.scroll <= sizes.client + 2, `${name}: ${JSON.stringify(sizes)}`);
    }
    await mode('Day');
    await page.screenshot({ path: 'docs/roseboard-planner-narrow.png' });
    await page.setViewportSize({ width: 1440, height: 1000 });
  });
  await test('New in a planner uses the selected day and adds one card without moving others', async () => {
    await mode('Calendar');
    const selected = offset(4);
    await root().getByLabel('Planner date').fill(selected);
    const before = await board();
    await menuAction('Add to board', 'Task');
    await eventually(async () =>
      assert.equal(Object.keys((await board()).tasks).length, Object.keys(before.tasks).length + 1),
    );
    const after = await board();
    const task = Object.entries(after.tasks).find(([id]) => !before.tasks[id])[1];
    assert.equal(task.dueDate, selected);
    const added = Object.keys(after.nodes).filter((id) => !before.nodes[id]);
    assert.equal(added.length, 1);
    assert.equal(
      after.nodes[added[0]].taskId,
      Object.keys(after.tasks).find((id) => !before.tasks[id]),
    );
    for (const [id, node] of Object.entries(before.nodes)) assert.deepEqual(after.nodes[id], node);
    await closeInspector();
    await action('Undo');
    assert.deepEqual((await board()).tasks, before.tasks);
    assert.deepEqual((await board()).nodes, before.nodes);
  });
  await test('Compact header and tool palette stay within desktop and narrow panes', async () => {
    await mode('Canvas');
    for (const width of [1440, 900, 700, 430, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      const bounds = await root()
        .locator('.rb-toolbar')
        .evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth, height: el.clientHeight }));
      assert.ok(bounds.scroll <= bounds.client + 1, `${width}: ${JSON.stringify(bounds)}`);
      if (width >= 900) assert.ok(bounds.height <= 54, JSON.stringify(bounds));
      const canvas = await root().locator('.rb-canvas').boundingBox();
      const dock = await root().getByLabel('Canvas tools').boundingBox();
      assert.ok(dock.x >= canvas.x && dock.x + dock.width <= canvas.x + canvas.width + 1);
      await menuAction('Canvas options', 'Minimap');
      assert.equal(await root().locator('.react-flow__minimap').count(), 1);
      await menuAction('Canvas options', 'Minimap');
    }
    await page.screenshot({ path: 'docs/roseboard-toolbar-narrow.png' });
    await page.setViewportSize({ width: 1440, height: 1000 });
  });
  await test('Reopening preserves assignments and dates, and creates no copied document body', async () => {
    await flush();
    const expected = await board();
    await page.evaluate(() => app.workspace.getLeavesOfType('roseboard-view').forEach((l) => l.detach()));
    await page.waitForTimeout(200);
    await page.evaluate(async (path) => app.plugins.plugins.roseboard.openBoard(path), path);
    await root().locator('.rb-brand strong').waitFor();
    assert.deepEqual(await board(), expected);
    assert.ok(!JSON.stringify(await board()).includes('A calmer workspace'));
    await mode('Day');
  });
} finally {
  report.finished = new Date().toISOString();
  report.remoteImageRequests = requests;
  await writeFile('docs/planner-test-results.json', JSON.stringify(report, null, 2) + '\n');
  await browser.close();
}
if (errors.length || requests.length || results.some((r) => r.result === 'FAIL')) process.exitCode = 1;
