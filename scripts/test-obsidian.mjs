import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFile, writeFile, realpath } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { join } from 'node:path';
import os from 'node:os';
const runtime = JSON.parse(await readFile('.test-runtime/runtime.json', 'utf8'));
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${runtime.port}`);
const page = browser.contexts()[0].pages()[0];
page.setDefaultTimeout(6000);
await page.setViewportSize({ width: 1440, height: 1000 });
assert.equal(
  await realpath(await page.evaluate(() => app.vault.adapter.getBasePath())),
  await realpath(runtime.vault),
  'Refusing to test outside the isolated temporary vault',
);
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const results = [];
const report = {
  started: new Date().toISOString(),
  environment: {
    platform: os.platform(),
    arch: os.arch(),
    os: os.release(),
    cpu: os.cpus()[0]?.model,
    viewport: '1440 × 1000',
    vault: runtime.vault,
    obsidian: await page.evaluate(() => (typeof apiVersion === 'string' ? apiVersion : 'unknown')),
  },
  results,
  errors,
};
const root = () => page.locator('.roseboard-root:visible').last();
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

const active = () =>
  page.evaluate(
    () =>
      app.workspace.getLeavesOfType('roseboard-view').find((l) => l === app.workspace.getMostRecentLeaf())
        ?.view.session?.path,
  );
const session = (path) =>
  `app.workspace.getLeavesOfType('roseboard-view').find((l) => l.view.session?.path === ${JSON.stringify(path)}).view.session`;
const board = (path) => page.evaluate(`${session(path)}.getSnapshot().board`);
const snapshot = (path) => page.evaluate(`${session(path)}.getSnapshot()`);
const flush = (path) => page.evaluate(`${session(path)}.flush().then(() => ${session(path)}.getSnapshot())`);
const open = async (path) => {
  await page.evaluate((path) => app.plugins.plugins.roseboard.openBoard(path), path);
  await page.waitForFunction((path) => app.workspace.getMostRecentLeaf()?.view?.session?.path === path, path);
  await root().locator('.rb-brand strong').waitFor();
};
const closeBoards = async () =>
  page.evaluate(() => app.workspace.getLeavesOfType('roseboard-view').forEach((l) => l.detach()));
const sourceText = (path) => readFile(join(runtime.vault, path), 'utf8');
const parse = (text) => JSON.parse(text.match(/```roseboard\n([\s\S]*?)\n```/)[1]);
const replace = (text, b) =>
  text.replace(/(```roseboard\n)[\s\S]*?(\n```)/, (_, a, z) => a + JSON.stringify(b, null, 2) + z);
const writeSource = async (path, b) =>
  page.evaluate(
    async ([path, text]) => app.vault.modify(app.vault.getAbstractFileByPath(path), text),
    [path, replace(await sourceText(path), b)],
  );
const eventually = async (fn) => {
  let last;
  for (let i = 0; i < 40; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      await page.waitForTimeout(100);
    }
  }
  throw last;
};
const zoomLabel = () => root().getByLabel('Reset zoom', { exact: true }).innerText();
const wheel = (init) =>
  root()
    .locator('.react-flow__pane')
    .dispatchEvent('wheel', { bubbles: true, cancelable: true, ...init });
async function test(name, fn) {
  const start = performance.now();
  try {
    await fn();
    results.push({ name, result: 'PASS', ms: Math.round(performance.now() - start) });
    console.log(`PASS ${name}`);
  } catch (e) {
    results.push({ name, result: 'FAIL', error: e.message, ms: Math.round(performance.now() - start) });
    console.log(`FAIL ${name}: ${e.message}`);
    await page.screenshot({ path: `docs/failure-${results.length}.png` });
  }
}
const testTitle = `Integration ${Date.now()}`;
let path, taskId, nodeId;
try {
  if (await page.locator('.modal-close-button').count())
    await page.locator('.modal-close-button').last().click();
  await page.evaluate(async () => {
    // A fresh disposable profile starts in restricted mode even when its vault lists the plugin.
    await app.plugins.loadManifests();
    await app.plugins.setEnable(true);
    await app.plugins.enablePlugin('roseboard');
    const plugin = app.plugins.plugins.roseboard;
    Object.assign(plugin.settings, {
      snap: false,
      minimap: false,
      input: 'auto',
      culling: 'off',
      deviceName: 'Test Mac',
      stamps: true,
    });
    await plugin.saveData(plugin.settings);
    app.workspace.leftSplit.collapse();
    app.workspace.rightSplit.collapse();
    app.vault.setConfig('nativeMenus', false); // Temporary test vault only: DOM menus are observable.
  });
  await test('Bundled plugin loads in installed Obsidian; full-pane example canvas', async () => {
    await open('Welcome to Roseboard.md');
    await root().getByRole('button', { name: 'Fit all', exact: true }).click();
    assert.equal(await root().locator('.react-flow__node').count(), 9);
    assert.equal(await root().locator('.react-flow__edge').count(), 4);
    const rect = await root().locator('.rb-canvas').boundingBox();
    assert.ok(rect.width > 1000 && rect.height > 600);
    assert.ok((await root().locator('.rb-icon svg').count()) > 10, 'Lucide icons render');
    await page.screenshot({ path: 'docs/roseboard-desktop.png' });
  });
  await test('Descriptions have a fixed non-scrolling preview and expand fully; checklists start collapsed', async () => {
    const welcome = 'Welcome to Roseboard.md';
    const card = root().locator('[data-id="node-sketch"]');
    const steps = () => board(welcome).then((b) => b.tasks.sketch.checklist.map((c) => c.done));
    assert.equal(await card.locator('.rb-card-checklist').count(), 0, 'checklist starts collapsed');
    await card.getByRole('button', { name: /^Show checklist/ }).click();
    assert.equal(await card.locator('.rb-card-checklist').getByRole('checkbox').count(), 3);
    await card.getByRole('checkbox', { name: 'Complete step Sketch two directions' }).click();
    assert.deepEqual(await steps(), [true, true, false]);
    await action('Undo');
    assert.deepEqual(await steps(), [true, false, false]);
    const original = (await board(welcome)).nodes['node-sketch'];
    await page.evaluate(
      `${session(welcome)}.edit('Readability probe', (b) => {
        b.nodes['node-sketch'].width = 260;
        b.nodes['node-sketch'].height = 120;
        b.tasks.sketch.description = 'A readable description with useful context and details. '.repeat(80) + 'END OF DESCRIPTION';
        b.tasks.sketch.checklist[0].text = 'A longer checklist step that wraps onto several lines in a narrow task card';
        for (let i = 0; i < 9; i++) b.tasks.sketch.checklist.push({ id: 'probe-' + i, text: 'Probe step ' + i, done: false });
      })`,
    );
    const shown = () => card.evaluate((el) => el.offsetHeight);
    const list = () =>
      card.locator('.rb-card-checklist').evaluate((el) => ({
        client: el.clientHeight,
        scroll: el.scrollHeight,
        firstThree: [...el.children].slice(0, 3).reduce((h, row) => h + row.offsetHeight, 0),
      }));
    const readable = async () => {
      const description = await card.locator('.rb-card-desc').evaluate((el) => ({
        height: el.clientHeight,
        scroll: el.scrollHeight,
        mask: getComputedStyle(el).maskImage,
        bottom: el.getBoundingClientRect().bottom,
        next: el.nextElementSibling.getBoundingClientRect().top,
      }));
      assert.equal(description.height, 84, 'description preview has a fixed height');
      assert.ok(description.scroll > description.height);
      assert.equal(description.mask, 'none', 'readable text must never fade away');
      assert.ok(description.bottom <= description.next, 'description and checklist do not overlap');
      const l = await list();
      assert.ok(l.client >= Math.min(320, l.firstThree), JSON.stringify(l));
      assert.ok(l.scroll > l.client);
    };
    await eventually(readable);
    const initial = await shown();
    assert.ok(initial > 120, 'old tiny cards grow only in the view');
    assert.equal((await board(welcome)).nodes['node-sketch'].height, 120);
    await card.locator('.rb-card-title strong').click();
    await root().getByRole('button', { name: 'Close inspector', exact: true }).click();
    const position = (await board(welcome)).nodes['node-sketch'];
    await card.locator('.rb-card-desc').focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Backspace');
    await card.locator('.rb-card-checklist').focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Delete');
    assert.deepEqual(
      (await board(welcome)).nodes['node-sketch'],
      position,
      'focused content does not move or delete the selected card',
    );
    await card.locator('.rb-card-desc').evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    assert.equal(
      await card.locator('.rb-card-desc').evaluate((el) => el.scrollTop),
      0,
      'preview cannot scroll',
    );
    await card.getByRole('button', { name: 'Show more description', exact: true }).click();
    await eventually(async () =>
      assert.ok(await card.locator('.rb-card-desc').evaluate((el) => el.clientHeight >= el.scrollHeight)),
    );
    assert.ok((await shown()) > 1600, 'full descriptions are not cut off by the old card-height limit');
    assert.equal(
      (await board(welcome)).nodes['node-sketch'].height,
      120,
      'description expansion is view-only',
    );
    await card.getByRole('button', { name: 'Show less description', exact: true }).click();
    await eventually(readable);
    await card.getByRole('button', { name: 'Show more', exact: true }).click();
    await eventually(async () => assert.equal((await list()).client, 320));
    assert.ok((await shown()) > initial);
    assert.equal((await board(welcome)).nodes['node-sketch'].height, 120, 'expansion is view-only');
    await card.getByRole('button', { name: 'Show less', exact: true }).click();
    await eventually(async () => assert.equal(await shown(), initial));
    await card.getByRole('button', { name: /^Hide checklist/ }).click();
    assert.equal(await card.locator('.rb-card-checklist').count(), 0);
    await card.getByRole('button', { name: /^Show checklist, 1 of 12 done/ }).click();
    await eventually(readable);
    // The persistent Add step action stays outside the scrolling list; long edits wrap.
    await card.locator('.rb-card-step-add button').click();
    const field = card.getByLabel('New step', { exact: true });
    await field.fill(
      'A long editable checklist item with enough detail to wrap onto several lines in this narrow card. '.repeat(
        3,
      ),
    );
    assert.ok(await field.evaluate((el) => el.clientHeight >= el.scrollHeight - 2));
    assert.ok(await field.evaluate((el) => el.clientHeight > 40));
    await field.press('Escape');
    await eventually(readable);
    // Dragging below the readable minimum must not hide either content region.
    await root()
      .locator('.react-flow__pane')
      .click({ position: { x: 20, y: 20 } });
    const box = await card.boundingBox();
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height - 180, { steps: 10 });
    await page.mouse.up();
    await eventually(readable);
    assert.ok((await shown()) >= initial - 2, 'resize enforces the readable minimum');
    await card.locator('.rb-card-checklist').evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.screenshot({ path: 'docs/roseboard-card-readability.png' });
    // Restore both the synthetic content and any resize command.
    if ((await board(welcome)).nodes['node-sketch'].height !== 120) await action('Undo');
    await action('Undo');
    await eventually(async () => assert.equal((await board(welcome)).tasks.sketch.checklist.length, 3));
    assert.deepEqual((await board(welcome)).nodes['node-sketch'], original);
  });
  await test('Existing compact board geometry stays stable with long wrapped checklists across zoom and tab changes', async () => {
    // Synthetic text with the sizes and row-length distribution of the reported existing board.
    const layouts = [
      [220, 24, 193, [105, 84, 103, 87, 87]],
      [220, 26, 211, [96, 114, 108, 126]],
      [220, 24, 181, [73, 85, 106, 110, 97]],
      [220, 20, 162, [93, 64, 79, 97]],
      [220, 16, 287, []],
      [238, 25, 173, [93, 169, 114, 130, 155]],
      [220, 32, 248, []],
      [482, 28, 136, [146, 62, 68, 67]],
      [220, 30, 174, [175, 79, 160, 121]],
      [220, 27, 199, [130, 147, 125, 94]],
      [220, 33, 615, [74, 66, 80, 74]],
      [220, 32, 280, [76, 87, 145, 149, 123, 204]],
    ];
    const repeat = (length) =>
      'A useful checklist item with several words that wrap inside a compact card. '
        .repeat(12)
        .slice(0, length);
    const b = structuredClone(await board('Welcome to Roseboard.md'));
    b.title = 'Wrapped checklist regression';
    b.tasks = {};
    b.nodes = {};
    b.edges = {};
    delete b.ink;
    layouts.forEach(([height, titleLength, descriptionLength, lengths], i) => {
      const id = 'layout-' + i;
      b.tasks[id] = {
        title: repeat(titleLength),
        description: repeat(descriptionLength),
        status: 'todo',
        priority: 'none',
        tags: [],
        dependsOn: [],
        checklist: lengths.map((length, j) => ({ id: 'step-' + j, text: repeat(length), done: false })),
      };
      b.nodes[id] = {
        type: 'task',
        taskId: id,
        x: (i % 4) * 400,
        y: Math.floor(i / 4) * 290,
        width: 340,
        height,
      };
    });
    const name = 'Wrapped checklist regression ' + Date.now() + '.md';
    const source = '# Layout regression\n\n```roseboard\n' + JSON.stringify(b, null, 2) + '\n```\n';
    await page.evaluate(
      async ([name, source]) => {
        await app.vault.create(name, source);
      },
      [name, source],
    );
    await open(name);
    assert.equal(await root().locator('.rb-card-checklist').count(), 0);
    const check = async () => {
      await root().getByLabel('Reset zoom', { exact: true }).click();
      await eventually(async () =>
        assert.equal(await root().locator('.rb-task-body').count(), layouts.length),
      );
      const heights = () =>
        root()
          .locator('.react-flow__node')
          .evaluateAll((nodes) => nodes.map((n) => n.offsetHeight));
      await page.waitForTimeout(250);
      const before = await heights();
      await page.waitForTimeout(350);
      assert.deepEqual(await heights(), before, 'card fitting settles instead of repeatedly changing height');
      assert.equal(await sourceText(name), source, 'rendering never rewrites saved board data');
    };
    await check();
    // Explicitly cross the old 50% detail threshold: descriptions and open checklist state survive.
    const descCount = await root().locator('.rb-card-desc').count();
    const firstChecklist = root()
      .getByRole('button', { name: /^Show checklist/ })
      .first();
    await firstChecklist.click();
    for (let i = 0; i < 6; i++) await root().getByLabel('Zoom out', { exact: true }).click();
    await eventually(async () => assert.ok(parseInt(await zoomLabel(), 10) < 50));
    assert.equal(await root().locator('.rb-card-desc').count(), descCount);
    assert.equal(
      await root().locator('.rb-card-checklist').count(),
      1,
      'zoom does not reset checklist expansion',
    );
    await root()
      .getByRole('button', { name: /^Hide checklist/ })
      .click();
    await root().getByLabel('Fit all', { exact: true }).click();
    await check();
    await open('Welcome to Roseboard.md');
    await open(name);
    await check();
    await closeBoards();
    await open('Welcome to Roseboard.md');
  });
  await test('Selection actions never overlap the zoom controls, with or without the inspector', async () => {
    const rects = async () => ({
      bar: await root().locator('.rb-selectionbar').boundingBox(),
      nav: await root().locator('.rb-navigation').boundingBox(),
      canvas: await root().locator('.rb-canvas').boundingBox(),
    });
    const apart = (a, b) =>
      a.x >= b.x + b.width || a.x + a.width <= b.x || a.y >= b.y + b.height || a.y + a.height <= b.y;
    for (const width of [1440, 1000, 760, 430]) {
      await page.setViewportSize({ width, height: 900 });
      const close = root().getByRole('button', { name: 'Close inspector', exact: true });
      if (await close.count()) await close.click();
      await root().getByRole('button', { name: 'Fit all', exact: true }).click();
      await root()
        .locator('[data-id="node-brief"]')
        .click({ position: { x: 24, y: 14 } });
      for (const inspector of [true, false]) {
        if (!inspector) await close.click();
        else await root().getByLabel('Inspector', { exact: true }).waitFor();
        const { bar, nav, canvas } = await rects();
        assert.ok(apart(bar, nav), `${width}px, inspector ${inspector}: ${JSON.stringify({ bar, nav })}`);
        assert.ok(
          bar.x >= canvas.x && bar.x + bar.width <= canvas.x + canvas.width + 1,
          `${width}px bar inside canvas`,
        );
      }
      const swatch = await root()
        .locator('.rb-selectionbar .rb-swatch-rose')
        .evaluate((el) => getComputedStyle(el).backgroundColor);
      assert.notEqual(swatch, 'rgba(0, 0, 0, 0)', 'selection colour swatches are visible');
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: 'docs/roseboard-selection.png' });
  });
  await test('Any card edge resizes without selecting first; edge midpoints still start connections', async () => {
    const welcome = 'Welcome to Roseboard.md';
    await root()
      .locator('.react-flow__pane')
      .click({ position: { x: 20, y: 20 } });
    const card = root().locator('[data-id="node-review"]');
    const box = await card.boundingBox();
    const at = (x, y) =>
      page.evaluate(
        ([x, y]) => {
          const el = document.elementFromPoint(x, y);
          return { cls: String(el.className), cursor: getComputedStyle(el).cursor };
        },
        [x, y],
      );
    assert.equal((await at(box.x + box.width, box.y + box.height * 0.25)).cursor, 'ew-resize');
    assert.equal((await at(box.x + box.width * 0.25, box.y + box.height)).cursor, 'ns-resize');
    assert.equal((await at(box.x + box.width, box.y + box.height)).cursor, 'nwse-resize');
    assert.match((await at(box.x + box.width + 1, box.y + box.height / 2)).cls, /react-flow__handle-right/);
    const width = (await board(welcome)).nodes['node-review'].width;
    await page.mouse.move(box.x + box.width, box.y + box.height * 0.25);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width + 60, box.y + box.height * 0.25, { steps: 8 });
    await page.mouse.up();
    assert.ok((await board(welcome)).nodes['node-review'].width > width + 40);
    await action('Undo');
    assert.equal((await board(welcome)).nodes['node-review'].width, width);
  });
  await test('Create board command, task record, inspector edits, quick dates, and on-card description and checklist persist', async () => {
    await page.evaluate(() => app.commands.executeCommandById('roseboard:create-board'));
    await page.getByRole('textbox', { name: 'New board title' }).fill(testTitle);
    await page.getByRole('button', { name: 'Create board', exact: true }).click();
    await page.waitForFunction(
      (title) => app.workspace.getMostRecentLeaf()?.view?.session?.getSnapshot().board?.title === title,
      testTitle,
    );
    path = await active();
    assert.ok(path);
    await root().getByLabel('New task', { exact: true }).click();
    await root().getByRole('textbox', { name: 'Task title', exact: true }).fill('A tested task');
    await root().getByLabel('Task status', { exact: true }).selectOption('doing');
    await root().getByLabel('Task priority', { exact: true }).selectOption('high');
    await root().getByRole('button', { name: 'Due tomorrow', exact: true }).click();
    await root().getByLabel('Due date', { exact: true }).fill('2026-09-18');
    // On the canvas, description and checklist are written on the card, not in the inspector.
    assert.equal(await root().getByLabel('Task description', { exact: true }).count(), 0);
    await root().getByText('Description and checklist are edited on the card', { exact: false }).waitFor();
    const card = root().locator('.react-flow__node').filter({ hasText: 'A tested task' });
    await card.getByRole('button', { name: 'Add description', exact: true }).click();
    await card
      .getByLabel('Edit task description', { exact: true })
      .fill('**Useful** Markdown. <script>window.rbPwned=true</script>');
    await card.getByLabel('Edit task description', { exact: true }).press('Meta+Enter');
    await card.locator('.rb-card-desc strong').getByText('Useful').waitFor();
    assert.equal(await card.locator('script').count(), 0);
    await card.getByRole('button', { name: 'Add checklist', exact: true }).click();
    await card.getByLabel('New step', { exact: true }).fill('Verify persistence');
    await card.getByLabel('New step', { exact: true }).press('Enter');
    await card.getByLabel('New step', { exact: true }).fill('Remove me');
    await card.getByLabel('New step', { exact: true }).press('Enter');
    await card.getByLabel('New step', { exact: true }).press('Escape');
    await card.getByRole('checkbox', { name: 'Complete step Verify persistence' }).click();
    await card.getByRole('button', { name: 'Remove step Remove me', exact: true }).click();
    // Double-click renames a step; arrow keys edit text instead of nudging the card; Escape keeps it.
    const x = (await board(path)).nodes[Object.keys((await board(path)).nodes)[0]].x;
    await card.locator('li').filter({ hasText: 'Verify persistence' }).dblclick();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('Escape');
    assert.equal((await board(path)).nodes[Object.keys((await board(path)).nodes)[0]].x, x);
    await card.getByRole('button', { name: 'Edit description', exact: true }).click();
    await card.getByLabel('Edit task description', { exact: true }).fill('Discarded');
    await card.getByLabel('Edit task description', { exact: true }).press('Escape');
    assert.equal(await page.evaluate(() => window.rbPwned), undefined);
    await flush(path);
    const b = parse(await sourceText(path));
    taskId = Object.keys(b.tasks)[0];
    nodeId = Object.keys(b.nodes)[0];
    assert.equal(b.tasks[taskId].title, 'A tested task');
    assert.deepEqual(
      b.tasks[taskId].checklist.map((c) => [c.text, c.done]),
      [['Verify persistence', true]],
    );
    assert.equal(b.tasks[taskId].description, '**Useful** Markdown. <script>window.rbPwned=true</script>');
    assert.equal(b.tasks[taskId].dueDate, '2026-09-18');
    assert.equal(b.tasks[taskId].updatedBy, 'Test Mac');
    assert.match(b.tasks[taskId].updatedAt, /^\d{4}-\d{2}-\d{2}T/);
  });
  await test('Completed pointer drag is one undo step; resize and 10,000+ coordinates persist', async () => {
    await root().getByRole('button', { name: 'Close inspector' }).click();
    await root().getByRole('button', { name: 'Fit all', exact: true }).click();
    const before = await board(path),
      loc = root().locator(`[data-id="${nodeId}"] .rb-card-title strong`),
      rect = await loc.boundingBox();
    await page.mouse.move(rect.x + 30, rect.y + 10);
    await page.mouse.down();
    await page.mouse.move(rect.x + 150, rect.y + 80, { steps: 12 });
    await page.mouse.up();
    await flush(path);
    let after = await board(path);
    assert.notEqual(after.nodes[nodeId].x, before.nodes[nodeId].x);
    await action('Undo');
    assert.equal((await board(path)).nodes[nodeId].x, before.nodes[nodeId].x);
    await action('Redo');
    await root()
      .locator(`[data-id="${nodeId}"]`)
      .click({ position: { x: 80, y: 70 } });
    const resize = root().locator(`[data-id="${nodeId}"] .react-flow__resize-control.bottom.right.handle`);
    const rr = await resize.boundingBox();
    const width = (await board(path)).nodes[nodeId].width;
    await page.mouse.move(rr.x + rr.width / 2, rr.y + rr.height / 2);
    await page.mouse.down();
    await page.mouse.move(rr.x + rr.width / 2 + 70, rr.y + rr.height / 2 + 35, { steps: 10 });
    await page.mouse.up();
    await flush(path);
    assert.ok((await board(path)).nodes[nodeId].width > width);
    await root().getByLabel('Card x', { exact: true }).fill('12000');
    await root().getByLabel('Card x', { exact: true }).press('Tab');
    await root().getByLabel('Card y', { exact: true }).fill('-11000');
    await root().getByLabel('Card y', { exact: true }).press('Tab');
    await flush(path);
    assert.equal((await board(path)).nodes[nodeId].x, 12000);
    assert.equal((await board(path)).nodes[nodeId].y, -11000);
  });
  await test('Reopen restores same task IDs and coordinates from Markdown', async () => {
    const before = await board(path);
    await closeBoards();
    await open(path);
    const after = await board(path);
    assert.deepEqual(after, before);
    assert.equal(await root().locator('.react-flow__node').count(), 1);
  });
  await test('Inline rename, arrow nudging and card colours edit the record in place', async () => {
    await root().getByRole('button', { name: 'Fit all', exact: true }).click();
    const title = root().locator(`[data-id="${nodeId}"] .rb-card-title strong`);
    await title.dblclick();
    const field = root().getByLabel('Edit task title', { exact: true });
    await field.fill('Renamed inline');
    await field.press('Enter');
    await eventually(async () => assert.equal((await board(path)).tasks[taskId].title, 'Renamed inline'));
    await root()
      .locator(`[data-id="${nodeId}"]`)
      .click({ position: { x: 80, y: 70 } });
    const before = (await board(path)).nodes[nodeId];
    await root().focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Shift+ArrowDown');
    await eventually(async () => {
      const n = (await board(path)).nodes[nodeId];
      assert.equal(n.x, before.x + 8);
      assert.equal(n.y, before.y + 32);
    });
    await root()
      .locator('.rb-selectionbar')
      .getByRole('button', { name: 'mint colour', exact: true })
      .click();
    await eventually(async () => assert.equal((await board(path)).nodes[nodeId].color, 'mint'));
    assert.equal(await root().locator(`[data-id="${nodeId}"] .rb-card.rb-tint-mint`).count(), 1);
    await flush(path);
  });
  await test('Double-click on empty canvas creates a task there; context menu completes it', async () => {
    const countBefore = Object.keys((await board(path)).tasks).length;
    const empty = await root()
      .locator('.react-flow__pane')
      .evaluate((pane) => {
        const rect = pane.getBoundingClientRect();
        for (const fx of [0.25, 0.75, 0.1, 0.9]) {
          for (const fy of [0.3, 0.65, 0.85]) {
            const x = rect.x + rect.width * fx,
              y = rect.y + rect.height * fy;
            if (document.elementFromPoint(x, y) === pane) return { x, y };
          }
        }
        throw new Error('No empty canvas point found');
      });
    await page.mouse.dblclick(empty.x, empty.y);
    await eventually(async () =>
      assert.equal(Object.keys((await board(path)).tasks).length, countBefore + 1),
    );
    const created = Object.entries((await board(path)).nodes).find(([id]) => id !== nodeId);
    assert.ok(created, 'a placement exists for the new task');
    await root().getByRole('button', { name: 'Close inspector' }).click();
    await root()
      .locator(`[data-id="${created[0]}"]`)
      .click({ button: 'right', position: { x: 120, y: 60 } });
    const item = page.locator('.menu .menu-item', { hasText: 'Complete task' });
    await item.waitFor();
    await item.click();
    await eventually(async () => assert.equal((await board(path)).tasks[created[1].taskId].status, 'done'));
    await page.keyboard.press('Escape');
    await root()
      .locator(`[data-id="${created[0]}"]`)
      .click({ position: { x: 120, y: 60 } });
    await root()
      .locator('.rb-selectionbar')
      .getByRole('button', { name: /^Remove card/ })
      .click();
    await mode('List');
    await root().locator('.rb-list-row', { hasText: 'Untitled task' }).locator('.rb-list-title').click();
    await root().getByRole('button', { name: 'Delete task…', exact: true }).click();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await eventually(async () => assert.equal(Object.keys((await board(path)).tasks).length, countBefore));
    await mode('Canvas');
    await flush(path);
  });
  await test('List editing, unplaced tray, placement removal, duplicate/delete and undo', async () => {
    await root().getByRole('button', { name: 'Fit all', exact: true }).click();
    await root()
      .locator(`[data-id="${nodeId}"]`)
      .click({ position: { x: 80, y: 70 } });
    await root().getByRole('button', { name: 'Duplicate', exact: true }).click();
    await eventually(async () => assert.equal(Object.keys((await board(path)).tasks).length, 2));
    await root()
      .getByRole('button', { name: /^Remove card/ })
      .click();
    assert.equal(Object.keys((await board(path)).tasks).length, 2);
    assert.equal(Object.keys((await board(path)).nodes).length, 1);
    await mode('List');
    assert.equal(await root().locator('.rb-list-row').count(), 2);
    await root().getByRole('button', { name: 'Place', exact: true }).click();
    assert.equal(Object.keys((await board(path)).nodes).length, 2);
    await root().locator('.rb-list-title').last().click();
    await root().getByRole('button', { name: 'Delete task…', exact: true }).click();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    assert.equal(Object.keys((await board(path)).tasks).length, 1);
    await action('Undo');
    assert.equal(Object.keys((await board(path)).tasks).length, 2);
    await flush(path);
  });
  await test('External JSON edit reloads valid data, preserves coordinates, keeps undo, and highlights the change', async () => {
    const old = parse(await sourceText(path));
    const updated = structuredClone(old);
    updated.tasks.agent = {
      title: 'Added by external JSON',
      status: 'todo',
      tags: ['external'],
      updatedBy: 'Friend Phone',
    };
    await mode('Canvas');
    await writeSource(path, updated);
    await eventually(async () => assert.ok((await board(path)).tasks.agent));
    assert.deepEqual((await board(path)).nodes, old.nodes);
    const state = await flush(path);
    assert.equal(state.canUndo, true, 'local undo history survives a remote reload');
    assert.equal(state.activity[0].by, 'Friend Phone');
    assert.equal(state.activity[0].changes[0].id, 'agent');
    await action('Activity');
    assert.ok((await root().locator('.rb-activity').innerText()).includes('Friend Phone'));
    await root().getByRole('button', { name: 'Close activity', exact: true }).click();
  });
  await test('Invalid JSON retains last valid display, disables writes, never overwrites source', async () => {
    const text = await sourceText(path);
    await page.evaluate(
      async ([path, text]) => app.vault.modify(app.vault.getAbstractFileByPath(path), text),
      [path, text.replace(/(```roseboard\n)[\s\S]*?(\n```)/, '$1{"unfinished":$2')],
    );
    await eventually(async () => assert.ok((await root().innerText()).includes('Invalid JSON')));
    assert.equal(await root().getByLabel('New task', { exact: true }).isDisabled(), true);
    await page.waitForTimeout(600);
    assert.ok((await sourceText(path)).includes('{"unfinished":'));
    assert.ok((await board(path)).tasks.agent);
    await page.evaluate(
      async ([path, text]) => app.vault.modify(app.vault.getAbstractFileByPath(path), text),
      [path, text],
    );
    await eventually(async () => assert.equal((await flush(path)).status, 'Saved locally'));
  });
  await test('Two open board views share one model and source-editor suspension prevents writes', async () => {
    await page.evaluate(async (path) => {
      const leaf = app.workspace.getLeaf('split');
      await leaf.setViewState({ type: 'roseboard-view', state: { path }, active: true });
    }, path);
    assert.equal(
      await page.evaluate((path) => {
        const views = app.workspace
          .getLeavesOfType('roseboard-view')
          .filter((l) => l.view.session?.path === path);
        return views.length === 2 && views[0].view.session === views[1].view.session;
      }, path),
      true,
    );
    await page.evaluate(
      `${session(path)}.edit('Other view', (b) => { b.tasks.agent.title = 'Shared across views'; })`,
    );
    await flush(path);
    const state = await page.evaluate((path) => {
      const views = app.workspace
        .getLeavesOfType('roseboard-view')
        .filter((l) => l.view.session?.path === path);
      return views.map((l) => l.view.session.getSnapshot().board.tasks.agent.title);
    }, path);
    assert.deepEqual(state, ['Shared across views', 'Shared across views']);
    await page.evaluate(async (path) => {
      const file = app.vault.getAbstractFileByPath(path);
      const leaf = app.workspace.getLeaf('split');
      await leaf.openFile(file, { state: { mode: 'source' } });
    }, path);
    await eventually(async () =>
      assert.equal(await page.evaluate((path) => app.plugins.plugins.roseboard.sourceOpen(path), path), true),
    );
    const blocked = await page.evaluate(
      `(() => { try { ${session(path)}.edit('Must fail', (b) => { b.title = 'OVERWRITTEN'; }); return false; } catch { return true; } })()`,
    );
    assert.equal(blocked, true);
    await page.evaluate(() => app.workspace.getLeavesOfType('markdown').forEach((l) => l.detach()));
    await page.evaluate(() =>
      app.workspace
        .getLeavesOfType('roseboard-view')
        .slice(1)
        .forEach((l) => l.detach()),
    );
    await open(path);
    await eventually(async () => assert.equal((await flush(path)).sourceOpen, false));
  });
  await test('Local edits racing an external change to another record are merged, not conflicted', async () => {
    const before = parse(await sourceText(path));
    await page.evaluate(`${session(path)}.edit('Local pending', (b) => { b.title = 'LOCAL TITLE'; })`);
    const remote = structuredClone(before);
    remote.tasks.agent.status = 'doing';
    remote.tasks.agent.updatedBy = 'Friend Phone';
    await writeSource(path, remote);
    await eventually(async () => {
      const s = await flush(path);
      assert.equal(s.status, 'Saved locally');
      assert.equal(s.board.title, 'LOCAL TITLE');
      assert.equal(s.board.tasks.agent.status, 'doing');
    });
    const saved = parse(await sourceText(path));
    assert.equal(saved.title, 'LOCAL TITLE');
    assert.equal(saved.tasks.agent.status, 'doing');
    assert.equal((await snapshot(path)).overlaps.length, 0);
  });
  await test('Same-field overlap keeps local work, is listed for review, and can take the other side', async () => {
    const before = parse(await sourceText(path));
    await page.evaluate(`${session(path)}.edit('Local pending', (b) => { b.tasks.agent.title = 'Mine'; })`);
    const remote = structuredClone(before);
    remote.tasks.agent.title = 'Theirs';
    await writeSource(path, remote);
    await eventually(async () => assert.equal((await snapshot(path)).overlaps.length, 1));
    await root().locator('.rb-overlaps').waitFor();
    assert.ok((await root().locator('.rb-overlaps').innerText()).includes('title'));
    await flush(path);
    assert.equal(parse(await sourceText(path)).tasks.agent.title, 'Mine');
    await root().locator('.rb-overlaps').getByRole('button', { name: 'Use theirs', exact: true }).click();
    await eventually(async () => assert.equal((await board(path)).tasks.agent.title, 'Theirs'));
    await flush(path);
    assert.equal(parse(await sourceText(path)).tasks.agent.title, 'Theirs');
    assert.equal(await root().locator('.rb-overlaps').count(), 0);
  });
  await test('Uncombinable changes enter Conflict; recovery copy and preserve/reload work', async () => {
    const before = parse(await sourceText(path));
    const ids = Object.keys(before.tasks);
    await page.evaluate(
      `${session(path)}.edit('Local pending', (b) => { b.tasks[${JSON.stringify(ids[0])}].dependsOn = [${JSON.stringify(ids[1])}]; })`,
    );
    const remote = structuredClone(before);
    remote.tasks[ids[1]].dependsOn = [ids[0]];
    await writeSource(path, remote);
    await eventually(async () => assert.equal((await flush(path)).status, 'Conflict'));
    assert.deepEqual(parse(await sourceText(path)).tasks[ids[1]].dependsOn, [ids[0]]);
    const copy = await page.evaluate(`${session(path)}.saveLocalCopy()`);
    assert.deepEqual(parse(await sourceText(copy)).tasks[ids[0]].dependsOn, [ids[1]]);
    await root().getByRole('button', { name: 'Preserve draft & reload' }).click();
    await eventually(async () => assert.deepEqual((await board(path)).tasks[ids[0]].dependsOn, []));
    await flush(path);
  });
  await test('Reading-view preview is resizable and read-only; it does not suspend board writes', async () => {
    await page.evaluate(async (path) => {
      const leaf = app.workspace.getLeaf('split');
      await leaf.openFile(app.vault.getAbstractFileByPath(path), { state: { mode: 'preview' } });
    }, path);
    await page.locator('.roseboard-preview-shell:visible').waitFor();
    assert.equal(
      await page.locator('.roseboard-preview-shell:visible').evaluate((el) => getComputedStyle(el).resize),
      'vertical',
    );
    assert.equal(await page.evaluate((path) => app.plugins.plugins.roseboard.sourceOpen(path), path), false);
    assert.equal(await page.locator('.rb-preview:visible .rb-tool-dock').count(), 0);
    await page.evaluate(() => app.workspace.getLeavesOfType('markdown').forEach((l) => l.detach()));
    await open(path);
  });
  await page.evaluate(async () => {
    if (!app.vault.getAbstractFileByPath('Project notes.md'))
      await app.vault.create('Project notes.md', '# Test note');
  });
  await test('Vault-note picker creates a reference; target rename follows; deletion is explicit', async () => {
    await root().getByRole('button', { name: 'Vault note', exact: true }).click();
    await page.locator('.prompt-input').fill('Project notes');
    await page.locator('.suggestion-item').filter({ hasText: 'Project notes.md' }).first().click();
    await flush(path);
    assert.ok(
      Object.values((await board(path)).nodes).some(
        (n) => n.type === 'note' && n.notePath === 'Project notes.md',
      ),
    );
    await page.evaluate(async () => {
      const previous = app.vault.getAbstractFileByPath('Renamed project notes.md');
      if (previous) await app.vault.delete(previous);
      await app.fileManager.renameFile(
        app.vault.getAbstractFileByPath('Project notes.md'),
        'Renamed project notes.md',
      );
    });
    await eventually(async () =>
      assert.ok(
        Object.values((await board(path)).nodes).some(
          (n) => n.type === 'note' && n.notePath === 'Renamed project notes.md',
        ),
      ),
    );
    await page.evaluate(async () =>
      app.vault.delete(app.vault.getAbstractFileByPath('Renamed project notes.md')),
    );
    await eventually(async () => assert.ok((await root().innerText()).includes('Missing note')));
    await page.evaluate(async () => {
      await app.vault.create('Project notes.md', '# Project notes\n\nIndependent note.\n');
    });
  });
  await test('Sticky safe preview does not mount raw HTML or fetch remote images', async () => {
    await root().getByRole('button', { name: 'New note', exact: true }).click();
    const requests = [];
    const observe = (request) => {
      if (request.url().includes('roseboard-security.invalid')) requests.push(request.url());
    };
    page.on('request', observe);
    await root()
      .getByLabel('Sticky content', { exact: true })
      .fill(
        '<img src=x onerror="window.rbPwned=true">\n\n![remote](https://roseboard-security.invalid/image.png)\n\n[bad](javascript:alert(1))',
      );
    await page.waitForTimeout(400);
    assert.equal(await root().locator('.rb-markdown img,.rb-markdown script').count(), 0);
    assert.equal(await page.evaluate(() => window.rbPwned), undefined);
    assert.equal(requests.length, 0);
    page.off('request', observe);
    await flush(path);
  });
  await test('Frames move their explicit members once and ungroup without deleting tasks', async () => {
    const text = await readFile('examples/Welcome to Roseboard.md', 'utf8');
    await page.evaluate(async (text) => {
      const old = app.vault.getAbstractFileByPath('Feature checks.md');
      if (old) await app.vault.modify(old, text);
      else await app.vault.create('Feature checks.md', text);
    }, text);
    await closeBoards();
    await open('Feature checks.md');
    await root().getByRole('button', { name: 'Fit all', exact: true }).click();
    const before = await board('Feature checks.md');
    const label = root().locator('[data-id="frame-discover"] .rb-frame-label');
    const box = await label.boundingBox();
    await page.mouse.move(box.x + 60, box.y + 10);
    await page.mouse.down();
    await page.mouse.move(box.x + 140, box.y + 60, { steps: 10 });
    await page.mouse.up();
    await flush('Feature checks.md');
    const after = await board('Feature checks.md');
    const dx = after.nodes['frame-discover'].x - before.nodes['frame-discover'].x,
      dy = after.nodes['frame-discover'].y - before.nodes['frame-discover'].y;
    assert.ok(dx > 0 && dy > 0);
    for (const id of ['node-brief', 'node-sketch', 'node-note', 'node-reference']) {
      assert.ok(Math.abs(after.nodes[id].x - before.nodes[id].x - dx) < 0.01);
      assert.ok(Math.abs(after.nodes[id].y - before.nodes[id].y - dy) < 0.01);
    }
    assert.deepEqual(after.nodes['node-prototype'], before.nodes['node-prototype']);
    await action('Undo');
    assert.deepEqual((await board('Feature checks.md')).nodes, before.nodes);
    await label.click();
    await root().getByRole('button', { name: 'Remove card', exact: true }).click();
    let b = await board('Feature checks.md');
    assert.equal(b.nodes['frame-discover'], undefined);
    assert.equal(b.nodes['node-brief'].frameId, undefined);
    assert.equal(Object.keys(b.tasks).length, 6);
    await action('Undo');
  });
  await test('Labelled connectors and dependency connectors have distinct storage; cycles are rejected', async () => {
    await root().locator('[data-id="node-brief"] .rb-card-title strong').click();
    await root().getByRole('button', { name: 'Connect', exact: true }).click();
    await root().getByLabel('New connector label', { exact: true }).fill('context');
    await root().getByLabel('Connect to card', { exact: true }).selectOption('node-reference');
    await root().getByRole('button', { name: 'Connect →', exact: true }).click();
    let b = await board('Feature checks.md');
    assert.ok(Object.values(b.edges).some((e) => e.label === 'context'));
    await root().getByLabel('Connection kind', { exact: true }).selectOption('dependency');
    await root().getByLabel('Connect to card', { exact: true }).selectOption('node-prototype');
    await root().getByRole('button', { name: 'Connect →', exact: true }).click();
    b = await board('Feature checks.md');
    assert.ok(b.tasks.build.dependsOn.includes('brief'));
    assert.equal(Object.keys(b.edges).length, 2);
    await root().getByRole('button', { name: 'Connect', exact: true }).click();
    await root().locator('[data-id="node-sketch"] .rb-card-title strong').click();
    await root().getByLabel('Add prerequisite', { exact: true }).selectOption('ship');
    assert.deepEqual((await board('Feature checks.md')).tasks.sketch.dependsOn, []);
    assert.ok((await page.locator('body').innerText()).includes('cycle'));
  });
  await test('Dragging a connection onto empty canvas creates a linked task', async () => {
    await root().getByRole('button', { name: 'Close inspector' }).click();
    // The previous scenario left the connect bar in dependency mode; make the kind explicit.
    await root().getByRole('button', { name: 'Connect', exact: true }).click();
    await root().getByLabel('Connection kind', { exact: true }).selectOption('relationship');
    await root().getByRole('button', { name: 'Connect', exact: true }).click();
    await root().getByRole('button', { name: 'Fit all', exact: true }).click();
    const before = await board('Feature checks.md');
    await root()
      .locator('[data-id="node-ship"]')
      .hover({ position: { x: 100, y: 60 } });
    const handle = await root().locator('[data-id="node-ship"] .react-flow__handle-bottom').boundingBox();
    const pane = await root().locator('.react-flow__pane').boundingBox();
    const dropY = Math.min(handle.y + 150, pane.y + pane.height - 80);
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2 - 40, dropY, { steps: 12 });
    await page.mouse.up();
    await eventually(async () => {
      const after = await board('Feature checks.md');
      assert.equal(Object.keys(after.tasks).length, Object.keys(before.tasks).length + 1);
      assert.equal(Object.keys(after.edges).length, Object.keys(before.edges).length + 1);
    });
    await action('Undo');
    await eventually(async () =>
      assert.deepEqual(
        Object.keys((await board('Feature checks.md')).tasks).sort(),
        Object.keys(before.tasks).sort(),
      ),
    );
    await flush('Feature checks.md');
  });
  await test('Blocked completion warns, can be cancelled or accepted, and remains undoable', async () => {
    await root()
      .getByRole('button', { name: 'Complete Make a small, useful prototype', exact: true })
      .click();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal((await board('Feature checks.md')).tasks.build.status, 'todo');
    await root()
      .getByRole('button', { name: 'Complete Make a small, useful prototype', exact: true })
      .click();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    assert.equal((await board('Feature checks.md')).tasks.build.status, 'done');
    await action('Undo');
    assert.equal((await board('Feature checks.md')).tasks.build.status, 'todo');
  });
  await test('Kanban drag changes status only and keeps canvas positions', async () => {
    const before = await board('Feature checks.md');
    await mode('Kanban');
    const card = root().locator('.rb-column-todo .rb-kanban-card', { hasText: 'Review with fresh eyes' });
    await card.waitFor();
    await card.dragTo(root().locator('.rb-column-doing .rb-column-body'));
    await eventually(async () =>
      assert.equal((await board('Feature checks.md')).tasks.review.status, 'doing'),
    );
    assert.deepEqual((await board('Feature checks.md')).nodes, before.nodes);
    assert.equal(
      await root().locator('.rb-column-doing .rb-kanban-card', { hasText: 'Review with fresh eyes' }).count(),
      1,
    );
    await root().getByRole('button', { name: 'Add task to Backlog', exact: true }).click();
    await eventually(async () =>
      assert.equal(await root().locator('.rb-column-backlog .rb-kanban-card').count(), 3),
    );
    await action('Undo');
    await action('Undo');
    await eventually(async () =>
      assert.equal((await board('Feature checks.md')).tasks.review.status, 'todo'),
    );
    await mode('Canvas');
    await flush('Feature checks.md');
  });
  await test('Search, status/priority/tag/due/blocked filters and presets preserve positions', async () => {
    const before = (await board('Feature checks.md')).nodes;
    await mode('List');
    await search('prototype');
    assert.equal(await root().locator('.rb-list-row').count(), 1);
    await search('');
    await root().getByRole('button', { name: 'Toggle filters', exact: true }).click();
    await root().getByLabel('Filter status', { exact: true }).selectOption('doing');
    assert.equal(await root().locator('.rb-list-row').count(), 1);
    await root().getByLabel('Filter priority', { exact: true }).selectOption('high');
    await root().getByLabel('Filter tag', { exact: true }).fill('studio');
    assert.equal(await root().locator('.rb-list-row').count(), 1);
    await root().getByRole('button', { name: 'Clear', exact: true }).click();
    const all = await board('Feature checks.md');
    const isBlocked = (t) => t.dependsOn.some((id) => all.tasks[id]?.status !== 'done');
    await root().getByLabel('Filter blocked state', { exact: true }).selectOption('blocked');
    assert.equal(
      await root().locator('.rb-list-row').count(),
      Object.values(all.tasks).filter(isBlocked).length,
    );
    await root().getByRole('button', { name: 'Clear', exact: true }).click();
    await root().locator('.rb-filterbar').getByRole('button', { name: 'Ready', exact: true }).click();
    assert.equal(
      await root().locator('.rb-list-row').count(),
      Object.values(all.tasks).filter((t) => t.status !== 'done' && !isBlocked(t)).length,
    );
    // The example carries a fixed due date, so the expected counts depend on the real calendar day.
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Ljubljana' }).format(new Date());
    const tasks = Object.values(await board('Feature checks.md')).length
      ? Object.values((await board('Feature checks.md')).tasks)
      : [];
    await root().locator('.rb-filterbar').getByRole('button', { name: 'Today', exact: true }).click();
    assert.equal(
      await root().locator('.rb-list-row').count(),
      tasks.filter((t) => t.dueDate === today).length,
    );
    await root().locator('.rb-filterbar').getByRole('button', { name: 'Overdue', exact: true }).click();
    assert.equal(
      await root().locator('.rb-list-row').count(),
      tasks.filter((t) => t.dueDate && t.dueDate < today && t.status !== 'done').length,
    );
    await root().getByRole('button', { name: 'Clear', exact: true }).click();
    await root().getByLabel('Filter due state', { exact: true }).selectOption('none');
    assert.equal(
      await root().locator('.rb-list-row').count(),
      Object.values(all.tasks).filter((t) => !t.dueDate).length,
    );
    await root().getByRole('button', { name: 'Clear', exact: true }).click();
    await root().getByLabel('Sort tasks', { exact: true }).selectOption('priority');
    assert.ok((await root().locator('.rb-list-row').first().innerText()).toLowerCase().includes('high'));
    await root().getByLabel('Sort tasks', { exact: true }).selectOption('created');
    assert.deepEqual((await board('Feature checks.md')).nodes, before);
    await root().getByRole('button', { name: 'Toggle filters', exact: true }).click();
    await mode('Canvas');
  });
  await test('Multi-selection, keyboard duplicate/undo, and shortcuts do not hijack text inputs', async () => {
    await mode('Canvas');
    await root().locator('[data-id="node-brief"] .rb-card-title strong').click();
    await root()
      .locator('[data-id="node-sketch"] .rb-card-title strong')
      .click({ modifiers: ['Shift'] });
    await eventually(async () => assert.equal(await root().locator('.react-flow__node.selected').count(), 2));
    await root().focus();
    await page.keyboard.press('Meta+d');
    await page.waitForTimeout(80);
    assert.equal(Object.keys((await board('Feature checks.md')).tasks).length, 8);
    await page.keyboard.press('Meta+z');
    await page.waitForTimeout(80);
    assert.equal(Object.keys((await board('Feature checks.md')).tasks).length, 6);
    await root().locator('[data-id="node-sketch"] .rb-card-title strong').click();
    const title = root().getByLabel('Task title', { exact: true });
    await title.focus();
    await page.keyboard.press('Meta+d');
    await page.waitForTimeout(80);
    assert.equal(Object.keys((await board('Feature checks.md')).tasks).length, 6);
    await root().focus();
    await page.keyboard.type('the quick brown fox');
    await page.waitForTimeout(80);
    assert.equal(
      Object.keys((await board('Feature checks.md')).tasks).length,
      6,
      'stray typing never creates content',
    );
    assert.equal(
      Object.keys((await board('Feature checks.md')).nodes).length,
      9,
      'stray typing never creates cards',
    );
    await root().getByRole('button', { name: 'Focus task + dependencies', exact: false }).click();
    assert.ok((await root().locator('.rb-dim').count()) > 0);
    await root().getByRole('button', { name: 'Clear focus' }).click();
    await action('Undo');
    await flush('Feature checks.md');
  });
  await test('Source-editor in-progress text is revalidated after closing; raw export command works', async () => {
    await action('Open source');
    await page.waitForFunction(() => app.workspace.getMostRecentLeaf()?.view?.getMode?.() === 'source');
    await page.evaluate(() => {
      const view = app.workspace.getMostRecentLeaf().view;
      view.editor.setValue(
        view.editor
          .getValue()
          .replace('"title": "A little room to make things happen"', '"title": "Source editor title"'),
      );
    });
    await eventually(async () =>
      assert.equal(parse(await sourceText('Feature checks.md')).title, 'Source editor title'),
    );
    await page.evaluate(() => app.workspace.getLeavesOfType('markdown').forEach((l) => l.detach()));
    await open('Feature checks.md');
    await eventually(async () =>
      assert.equal((await board('Feature checks.md')).title, 'Source editor title'),
    );
    await action('Export JSON');
    await eventually(async () => {
      const files = await page.evaluate(() => app.vault.getFiles().map((f) => f.path));
      assert.ok(files.some((f) => f.includes('Source editor title - export') && f.endsWith('.json')));
    });
  });
  await test('Wheel input: trackpad deltas pan, mouse-wheel deltas zoom, Shift+wheel pans sideways', async () => {
    await closeBoards();
    await open('Feature checks.md');
    await root().getByRole('button', { name: 'Fit all', exact: true }).click();
    await page.waitForTimeout(250);
    const viewport = () => root().locator('.react-flow__viewport').getAttribute('style');
    let before = await viewport(),
      zoomBefore = await zoomLabel();
    for (let i = 0; i < 3; i++) await wheel({ deltaX: 3.5, deltaY: 2.25, deltaMode: 0 });
    await page.waitForTimeout(100);
    assert.notEqual(await viewport(), before, 'trackpad-like deltas pan');
    assert.equal(await zoomLabel(), zoomBefore, 'panning does not change zoom');
    for (let i = 0; i < 3; i++) await wheel({ deltaX: 0, deltaY: 3, deltaMode: 1 });
    await page.waitForTimeout(150);
    assert.ok(
      (await root().locator('.rb-navigation [aria-label="Canvas options"]').getAttribute('title')).includes(
        'mouse',
      ),
    );
    zoomBefore = await zoomLabel();
    for (let i = 0; i < 3; i++) await wheel({ deltaX: 0, deltaY: 3, deltaMode: 1 });
    await page.waitForTimeout(150);
    assert.notEqual(await zoomLabel(), zoomBefore, 'mouse-wheel deltas zoom');
    before = await viewport();
    zoomBefore = await zoomLabel();
    await wheel({ deltaX: 0, deltaY: 120, deltaMode: 0, shiftKey: true });
    await page.waitForTimeout(100);
    assert.notEqual(await viewport(), before, 'shift+wheel pans');
    assert.equal(await zoomLabel(), zoomBefore, 'shift+wheel does not zoom');
    await page.evaluate(async () => {
      const plugin = app.plugins.plugins.roseboard;
      plugin.settings.input = 'trackpad';
      await plugin.saveData(plugin.settings);
    });
    await flush('Feature checks.md');
    assert.equal(
      parse(await sourceText('Feature checks.md')).title,
      'Source editor title',
      'camera changes never write',
    );
  });
  await test('Zoom, fit, minimap, snapping and marquee selection operate without camera saves', async () => {
    await closeBoards();
    await open('Feature checks.md');
    await root().getByRole('button', { name: 'Fit all', exact: true }).click();
    await flush('Feature checks.md');
    const before = await sourceText('Feature checks.md');
    const zoomBefore = await zoomLabel();
    await root().getByRole('button', { name: 'Zoom in', exact: true }).click();
    await eventually(async () => assert.notEqual(await zoomLabel(), zoomBefore));
    await root().getByLabel('Reset zoom', { exact: true }).click();
    await eventually(async () => assert.equal(await zoomLabel(), '100%'));
    await menuAction('Canvas options', 'Minimap');
    assert.equal(await root().locator('.react-flow__minimap').count(), 1);
    await menuAction('Canvas options', 'Minimap');
    await menuAction('Canvas options', 'Snap to grid');
    await root().getByRole('button', { name: 'Fit all', exact: true }).click();
    await page.waitForTimeout(250);
    await root().getByRole('button', { name: 'Select mode', exact: true }).click();
    const first = await root().locator('[data-id="node-brief"]').boundingBox(),
      second = await root().locator('[data-id="node-sketch"]').boundingBox();
    await page.mouse.move(first.x - 12, first.y - 14);
    await page.mouse.down();
    await page.mouse.move(second.x + second.width + 12, second.y + second.height + 14, { steps: 12 });
    await page.mouse.up();
    await eventually(async () =>
      assert.ok((await root().locator('.react-flow__node.selected').count()) >= 2),
    );
    await root().getByRole('button', { name: 'Fit selection', exact: true }).click();
    await page.waitForTimeout(300);
    assert.equal(await sourceText('Feature checks.md'), before);
    await root().getByRole('button', { name: 'Hand mode', exact: true }).click();
    await root()
      .locator('.rb-canvas')
      .click({ position: { x: 10, y: 10 } });
    await root().locator('[data-id="node-brief"] .rb-card-title strong').click();
    const b = await board('Feature checks.md');
    const rect = await root().locator('[data-id="node-brief"] .rb-card-title strong').boundingBox();
    await page.mouse.move(rect.x + 40, rect.y + 10);
    await page.mouse.down();
    await page.mouse.move(rect.x + 103, rect.y + 47, { steps: 8 });
    await page.mouse.up();
    await flush('Feature checks.md');
    const after = await board('Feature checks.md');
    assert.equal(after.nodes['node-brief'].x % 16, 0);
    assert.equal(after.nodes['node-brief'].y % 16, 0);
    assert.notEqual(after.nodes['node-brief'].x, b.nodes['node-brief'].x);
    await action('Undo');
    await menuAction('Canvas options', 'Snap to grid');
  });
  await test('Pen draws strokes, eraser removes them, undo restores, wheel still pans while drawing', async () => {
    await closeBoards();
    await open('Feature checks.md');
    await root().getByRole('button', { name: 'Fit all', exact: true }).click();
    await page.waitForTimeout(250);
    const before = await board('Feature checks.md');
    assert.equal(before.ink, undefined);
    await root().getByRole('button', { name: 'Pen tool', exact: true }).click();
    await root().getByRole('radio', { name: 'rose ink', exact: true }).click();
    await root().getByRole('radio', { name: 'Thick ink', exact: true }).click();
    const surface = root().locator('.rb-draw-overlay');
    const box = await surface.boundingBox();
    const sx = box.x + box.width * 0.35,
      sy = box.y + box.height * 0.82;
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    for (let i = 1; i <= 20; i++) await page.mouse.move(sx + i * 12, sy + Math.sin(i / 3) * 24);
    await page.mouse.up();
    await eventually(async () =>
      assert.equal(Object.keys((await board('Feature checks.md')).ink ?? {}).length, 1),
    );
    const stroke = Object.values((await board('Feature checks.md')).ink)[0];
    assert.equal(stroke.color, 'rose');
    assert.equal(stroke.width, 7);
    assert.ok(stroke.points.length >= 6 && stroke.points.length % 2 === 0, 'simplified point pairs');
    assert.equal(stroke.updatedBy, 'Test Mac');
    assert.equal(await root().locator('.rb-ink path.rb-stroke').count(), 1);
    // A second stroke, then the viewport must still respond to wheel input through the overlay.
    await page.mouse.move(sx, sy - 60);
    await page.mouse.down();
    await page.mouse.move(sx + 160, sy - 90, { steps: 8 });
    await page.mouse.up();
    await eventually(async () => assert.equal(Object.keys((await board('Feature checks.md')).ink).length, 2));
    await page.screenshot({ path: 'docs/roseboard-ink.png' });
    const viewportBefore = await root().locator('.react-flow__viewport').getAttribute('style');
    await surface.dispatchEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaX: 4,
      deltaY: 30,
      deltaMode: 0,
    });
    await page.waitForTimeout(150);
    assert.notEqual(
      await root().locator('.react-flow__viewport').getAttribute('style'),
      viewportBefore,
      'wheel pans while drawing',
    );
    await flush('Feature checks.md');
    const saved = parse(await sourceText('Feature checks.md'));
    assert.equal(Object.keys(saved.ink).length, 2);
    assert.deepEqual(saved.nodes, before.nodes, 'drawing never moves cards');
    // Eraser removes only what the drag touches.
    await root().getByRole('button', { name: 'Eraser tool', exact: true }).click();
    const first = await root().locator('.rb-ink path.rb-stroke').first().boundingBox();
    await page.mouse.move(first.x + first.width / 2, first.y - 30);
    await page.mouse.down();
    await page.mouse.move(first.x + first.width / 2, first.y + first.height + 30, { steps: 10 });
    await page.mouse.up();
    await eventually(async () =>
      assert.equal(Object.keys((await board('Feature checks.md')).ink ?? {}).length, 1),
    );
    await page.keyboard.press('Escape');
    await eventually(async () => assert.equal(await root().locator('.rb-draw-overlay').count(), 0));
    await action('Undo');
    await eventually(async () => assert.equal(Object.keys((await board('Feature checks.md')).ink).length, 2));
    await root()
      .locator('.react-flow__pane')
      .click({ button: 'right', position: { x: 30, y: 30 } });
    const clear = page.locator('.menu .menu-item', { hasText: 'Clear all ink' });
    await clear.waitFor();
    await clear.click();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await eventually(async () => assert.equal((await board('Feature checks.md')).ink, undefined));
    await flush('Feature checks.md');
    assert.equal(parse(await sourceText('Feature checks.md')).ink, undefined);
    await action('Undo');
    await eventually(async () => assert.equal(Object.keys((await board('Feature checks.md')).ink).length, 2));
    // History now holds the two strokes only (the undone erase was discarded by the clear): two undos empty the board.
    await action('Undo');
    await action('Undo');
    await eventually(async () => assert.equal((await board('Feature checks.md')).ink, undefined));
    assert.equal(await root().getByRole('button', { name: 'Undo', exact: true }).isDisabled(), true);
    await flush('Feature checks.md');
  });
  await test('Ink written by another device is merged and highlighted like any record', async () => {
    const before = parse(await sourceText('Feature checks.md'));
    await page.evaluate(
      `${session('Feature checks.md')}.edit('Local pending', (b) => { b.tasks.brief.title = 'Local title'; })`,
    );
    const remote = structuredClone(before);
    remote.ink = {
      remoteStroke: {
        points: [100, 900, 200, 950, 300, 900],
        color: 'sky',
        width: 3,
        updatedBy: 'Friend Phone',
      },
    };
    await writeSource('Feature checks.md', remote);
    await eventually(async () => {
      const s = await flush('Feature checks.md');
      assert.equal(s.status, 'Saved locally');
      assert.equal(s.board.tasks.brief.title, 'Local title');
      assert.ok(s.board.ink?.remoteStroke);
    });
    assert.equal(await root().locator('.rb-ink path[data-stroke="remoteStroke"]').count(), 1);
    assert.equal(
      (await snapshot('Feature checks.md')).activity[0].changes.some(
        (c) => c.kind === 'ink' && c.op === 'added',
      ),
      true,
    );
    await page.evaluate(
      `${session('Feature checks.md')}.edit('Clean up', (b) => { delete b.ink; b.tasks.brief.title = 'Shape the idea'; })`,
    );
    await flush('Feature checks.md');
  });
  await test('Tags commit while typing, retain delimiters, and refresh after undo', async () => {
    await root().locator('[data-id="node-sketch"] .rb-card-title strong').click();
    const input = root().getByLabel('Task tags', { exact: true });
    const initial = await input.inputValue();
    await input.fill('alpha, beta,');
    assert.equal(await input.inputValue(), 'alpha, beta,');
    assert.deepEqual((await board('Feature checks.md')).tasks.sketch.tags, ['alpha', 'beta']);
    await action('Undo');
    assert.equal(await input.inputValue(), initial);
    await flush('Feature checks.md');
  });
  await test('Unsupported schema and deleted source stay recoverable without replacement writes', async () => {
    const raw = { schemaVersion: 99, boardId: 'future', title: 'Future board', extensions: { keep: true } };
    await page.evaluate(async (raw) => {
      const file = app.vault.getAbstractFileByPath('Future.md');
      const text = '```roseboard\n' + JSON.stringify(raw) + '\n```\n';
      if (file) await app.vault.modify(file, text);
      else await app.vault.create('Future.md', text);
    }, raw);
    await open('Future.md');
    assert.ok((await root().innerText()).includes('Schema version 99'));
    assert.equal(await root().getByLabel('New task', { exact: true }).isDisabled(), true);
    await page.waitForTimeout(500);
    assert.deepEqual(parse(await sourceText('Future.md')), raw);
    await open('Feature checks.md');
    const saved = await board('Feature checks.md');
    await flush('Feature checks.md');
    await page.evaluate(async () => {
      await app.vault.delete(app.vault.getAbstractFileByPath('Feature checks.md'));
    });
    await eventually(async () => assert.ok((await root().innerText()).includes('Source note was deleted')));
    const copy = await page.evaluate(`${session('Feature checks.md')}.saveLocalCopy()`);
    assert.deepEqual(parse(await sourceText(copy)), saved);
    await page.evaluate(async (saved) => {
      await app.vault.create(
        'Feature checks.md',
        '```roseboard\n' + JSON.stringify(saved, null, 2) + '\n```\n',
      );
    }, saved);
    await root().getByRole('button', { name: 'Preserve draft & reload' }).click();
    await flush('Feature checks.md');
  });
  await test('Narrow viewport uses a drawer and usable List view (desktop emulation only)', async () => {
    await closeBoards();
    await open('Welcome to Roseboard.md');
    await page.setViewportSize({ width: 430, height: 900 });
    await mode('List');
    await root().locator('.rb-list-title').nth(1).click();
    const inspector = await root().locator('.rb-inspector').boundingBox(),
      r = await root().boundingBox();
    assert.ok(inspector.width <= r.width && inspector.width > 300);
    assert.ok(inspector.y > r.y);
    await page.screenshot({ path: 'docs/roseboard-narrow.png' });
    await page.setViewportSize({ width: 1440, height: 1000 });
  });
  await test('Stress fixture: 300 nodes, 500 connections; load, interaction timings and culling', async () => {
    await closeBoards();
    const start = performance.now();
    await open('stress-300.md');
    await eventually(async () => assert.equal(await root().locator('.react-flow__node').count(), 300));
    await eventually(async () => assert.equal(await root().locator('.react-flow__edge').count(), 500));
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const load = performance.now() - start;
    const pan = [];
    const viewportBefore = await root().locator('.react-flow__viewport').getAttribute('style');
    for (let i = 0; i < 15; i++) {
      const start = performance.now();
      await wheel({ deltaX: 20, deltaY: 10 });
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
      pan.push(performance.now() - start);
    }
    assert.notEqual(
      await root().locator('.react-flow__viewport').getAttribute('style'),
      viewportBefore,
      'Wheel events must actually pan the viewport',
    );
    const measuredTitle = `Measured task update ${Date.now()}`;
    const startEdit = performance.now();
    await page.evaluate(
      `${session('stress-300.md')}.edit('Measured edit', (b) => { b.tasks['task-1'].title = ${JSON.stringify(measuredTitle)}; })`,
    );
    await eventually(async () => assert.ok((await root().innerText()).includes(measuredTitle)));
    const edit = performance.now() - startEdit;
    // Viewport culling: at 100 % only a fraction of the 300 cards should be mounted.
    await page.evaluate(async () => {
      const plugin = app.plugins.plugins.roseboard;
      plugin.settings.culling = 'auto';
      await plugin.saveData(plugin.settings);
    });
    await closeBoards();
    await open('stress-300.md');
    await root().getByLabel('Reset zoom', { exact: true }).click();
    await page.waitForTimeout(400);
    const mounted = await root().locator('.react-flow__node').count();
    assert.ok(mounted > 0 && mounted < 300, `culling mounts a subset (${mounted})`);
    await page.evaluate(async () => {
      const plugin = app.plugins.plugins.roseboard;
      plugin.settings.culling = 'off';
      await plugin.saveData(plugin.settings);
    });
    report.stress = {
      taskNodes: 300,
      derivedDependencies: 250,
      ordinaryConnectors: 250,
      loadToTwoPaintsMs: Math.round(load),
      singleTaskEditToDOMMs: Math.round(edit),
      panEventToNextFrameSamplesMs: pan.map((n) => Math.round(n)),
      panMedianMs: Math.round(pan.sort((a, b) => a - b)[7]),
      mountedNodesAt100PercentWithCulling: mounted,
      note: 'CDP-driven event/paint latency includes automation overhead; not a claimed device FPS.',
    };
    await flush('stress-300.md');
    await page.screenshot({ path: 'docs/roseboard-stress.png' });
  });
  await test('Repeated open/close releases React roots, subscriptions and clean sessions', async () => {
    await closeBoards();
    await page.waitForTimeout(700);
    const baseline = await page.evaluate(() => ({
      roots: document.querySelectorAll('.roseboard-root').length,
      sessions: app.plugins.plugins.roseboard.sessions.size,
    }));
    for (let i = 0; i < 6; i++) {
      await open('Welcome to Roseboard.md');
      await closeBoards();
    }
    await page.waitForTimeout(800);
    const after = await page.evaluate(() => ({
      roots: document.querySelectorAll('.roseboard-root').length,
      sessions: app.plugins.plugins.roseboard.sessions.size,
    }));
    assert.equal(after.roots, baseline.roots);
    assert.equal(after.sessions, baseline.sessions);
  });
  await test('Disabling the plugin leaves readable fenced JSON in the source note', async () => {
    const before = await sourceText(path);
    await page.evaluate(() => app.plugins.disablePlugin('roseboard'));
    assert.equal(await sourceText(path), before);
    assert.ok(parse(before).tasks[taskId]);
    await page.evaluate(() => app.plugins.enablePlugin('roseboard'));
    await open('Welcome to Roseboard.md');
    await root().getByRole('button', { name: 'Fit all', exact: true }).click();
  });
} finally {
  report.finished = new Date().toISOString();
  await writeFile('docs/obsidian-test-results.json', JSON.stringify(report, null, 2) + '\n');
  await browser.close();
}
if (results.some((r) => r.result === 'FAIL') || errors.length) process.exitCode = 1;
