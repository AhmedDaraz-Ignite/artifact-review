import fs from 'node:fs';
import { Given, When, Then, expect } from '../support/bdd.js';
import { HEAVY_ASSETS } from '../support/network.js';

const PNG_MAGIC = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function isPng(file) {
  if (!file || !fs.existsSync(file)) return false;
  const bytes = fs.readFileSync(file);
  return bytes.length > 100 && bytes.subarray(0, 8).equals(PNG_MAGIC);
}

function drawnRectangle(scene, expected) {
  return (scene.elements || []).some(element =>
    !element.isDeleted &&
    element.type === 'rectangle' &&
    element.width >= expected.width * 0.75 &&
    element.height >= expected.height * 0.75);
}

Given('whiteboard requests are recorded', async ({ network }) => {
  network.watchWhiteboard();
});

Given('every request outside the review server is blocked', async ({ arev, network }) => {
  await network.cutOffEverythingBut(arev.origin);
});

Given(/^the converted "([^"]*)" scene is saved$/, async ({ arev, network }, id) => {
  await arev.savedScene(id);
  network.sceneSaves.length = 0;
});

When(/^the reviewer expands the "([^"]*)" editor to fullscreen$/, async ({ boards }, id) => {
  await boards.board(id).editor.locator('#wbFullscreen').click();
});

When(/^the reviewer summarizes the "([^"]*)" edit as "([^"]*)"$/,
  async ({ boards }, id, summary) => {
    const board = boards.board(id);
    await board.host.scrollIntoViewIfNeeded();
    await board.editor.locator('#wbSummary').fill(summary);
  });

When(/^the reviewer sends the "([^"]*)" diagram edit now$/, async ({ boards }, id) => {
  await boards.board(id).editor.locator('#wbSend').click();
});

Then('no whiteboard asset has been fetched', async ({ network }) => {
  expect(network.heavyAssets).toEqual([]);
});

Then(/^the "([^"]*)" diagram offers an activation control$/, async ({ boards }, id) => {
  await expect(boards.board(id).activation).toBeVisible();
});

Then(/^the "([^"]*)" editor frame is sandboxed away from the review chrome$/,
  async ({ boards }, id) => {
    const board = boards.board(id);
    await expect(board.host).toBeVisible();
    const sandbox = (await board.frames.getAttribute('sandbox') || '').split(/\s+/);
    expect(sandbox).toContain('allow-scripts');
    expect(sandbox).not.toContain('allow-same-origin');
  });

Then(/^the "([^"]*)" editor URL carries no session token$/, async ({ arev, boards }, id) => {
  expect(boards.board(id).editor.url()).not.toContain(arev.token);
});

Then(/^no scene save leaves the browser for (\d+)ms$/,
  async ({ page, boards, network }, quiet) => {
    // Start the quiet window at the edit, not when this step runs.
    // A slow machine can reach this step after a debounced save already fired.
    const drawnAt = boards.board('clean-flow').drawn.completedAt;
    const elapsed = Date.now() - drawnAt;
    if (elapsed < quiet) await page.waitForTimeout(quiet - elapsed);
    expect(network.sceneSaves.filter(at => at - drawnAt < quiet)).toEqual([]);
  });

Then(/^the scene save lands inside the (\d+)ms debounce window$/,
  async ({ boards, network }, debounce) => {
    await expect.poll(() => network.sceneSaves.length, { timeout:5_000 })
      .toBeGreaterThan(0);
    const waited = network.sceneSaves[0] - boards.board('clean-flow').drawn.completedAt;
    expect(waited, 'autosave delay').toBeGreaterThanOrEqual(debounce - 150);
    expect(waited, 'autosave delay').toBeLessThan(debounce + 1700);
  });

Then(/^the saved "([^"]*)" scene holds the drawn rectangle and its source identity$/,
  async ({ arev, boards }, id) => {
    const board = boards.board(id);
    const saved = await arev.savedScene(
      id, entry => drawnRectangle(entry.scene || {}, board.drawn));
    expect(saved.source_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(saved.text_metrics_version).toBe(1);
    expect(saved.updated_at, 'a save timestamp').toBeTruthy();
  });

Then(/^the "([^"]*)" editor reports the autosave$/, async ({ boards }, id) => {
  await expect(boards.board(id).editor.locator('#wbStatus'))
    .toHaveText(/Autosaved|Autosave ready/);
});

Then(/^the "([^"]*)" diagram fills the window with one editor frame$/,
  async ({ boards }, id) => {
    const board = boards.board(id);
    await expect.poll(() => board.host.evaluate(element =>
      element.classList.contains('arev-inline-fullscreen') &&
      element.querySelectorAll('iframe').length === 1)).toBe(true);
  });

Then('the queued whiteboard item has a scene file and a PNG preview', async ({ arev }) => {
  const item = await arev.queuedWhiteboard();
  expect(isPng(item.png_path), 'a PNG preview').toBe(true);
  arev.queuedScene = fs.readFileSync(item.scene_path);
  expect(arev.queuedScene.length, 'scene snapshot bytes').toBeGreaterThan(100);
});

Then('the agent receives one diagram batch summarizing:', async ({ arev }, table) => {
  const expected = table.raw().map(([summary]) => summary).sort();
  const event = await arev.awaitEvent('feedback');
  arev.deliveredBoards = event.items.filter(item => item.kind === 'whiteboard');
  expect(arev.deliveredBoards.map(item => item.summary).sort()).toEqual(expected);
});

Then('both snapshots reuse the same content-addressed blobs', async ({ arev }) => {
  const [first, second] = arev.deliveredBoards;
  expect(second.scene_path).toBe(first.scene_path);
  expect(second.png_path).toBe(first.png_path);
  expect(second.scene_hash).toBe(first.scene_hash);
  expect(second.png_hash).toBe(first.png_hash);
  expect(first.scene_path).toContain('/whiteboards/blobs/');
  expect(fs.readFileSync(first.scene_path).equals(arev.queuedScene),
    'the queued snapshot is still byte-identical').toBe(true);
});

Then('every delivered preview is a valid PNG', async ({ arev }) => {
  expect(arev.deliveredBoards.filter(item => !isPng(item.png_path))).toEqual([]);
});

Then('the artifact source is unchanged', async ({ artifact }) => {
  expect(await artifact.read()).toBe(artifact.original);
});

Then('the artifact renders its Mermaid to SVG offline', async ({ boards }) => {
  await expect(boards.artifact.locator('pre.mermaid svg').first())
    .toBeVisible({ timeout:20_000 });
});

Then(/^the agent receives the diagram note "([^"]*)" with no draft left$/,
  async ({ arev, rail }, summary) => {
    const event = await arev.awaitEvent('feedback');
    arev.deliveredBoards = event.items.filter(item => item.kind === 'whiteboard');
    expect(arev.deliveredBoards.map(item => item.summary)).toEqual([summary]);
    await expect(rail.queueCount).toHaveText('0');
  });

Then('the delivered scene holds the rectangle that was drawn', async ({ arev, boards }) => {
  const [delivered] = arev.deliveredBoards;
  const scene = JSON.parse(fs.readFileSync(delivered.scene_path, 'utf8'));
  expect(drawnRectangle(scene, boards.board('clean-flow').drawn),
    `scene held ${(scene.elements || []).length} elements`).toBe(true);
});

Then('the whiteboard frame, script, and styles all came from the review server',
  async ({ network }) => {
    const served = network.whiteboardAssets.map(asset => new URL(asset).pathname);
    expect(HEAVY_ASSETS.filter(asset => !served.includes(asset))).toEqual([]);
  });

Then('no whiteboard asset URL carries the session token', async ({ arev, network }) => {
  expect(network.whiteboardAssets.filter(asset => asset.includes(arev.token))).toEqual([]);
});

Then('nothing outside the review server was requested', async ({ network }) => {
  expect([...new Set(network.external)]).toEqual([]);
});
