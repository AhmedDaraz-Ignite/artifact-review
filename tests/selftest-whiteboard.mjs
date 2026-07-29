import { chromium } from 'playwright';
import fs from 'node:fs';
import {
  TestRun,
  chooseAction,
  eventually,
  openSession,
  sessionApi,
  startPoll,
  stopSession,
  waitForQueueCount,
  within,
} from './test-helpers.mjs';
import {
  drawLargeRectangle,
  isPng,
  openWhiteboard,
  sceneHasDrawnRectangle,
  waitForInlineDiagram,
} from './whiteboard-test-helpers.mjs';

const ART = process.argv[2];
const test = new TestRun();
const pageErrors = [];
let browser;

try {
  const artifactBefore = fs.readFileSync(ART, 'utf8');
  const url = openSession(ART);
  const api = sessionApi(url);
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport:{ width:1500, height:980 } });
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(url, { waitUntil:'domcontentloaded' });
  await page.locator('#curtain').waitFor({ state:'hidden', timeout:8000 });

  const frame = await waitForInlineDiagram(page);
  const inlineSvg = frame.locator('[id^="arev-board-"] svg').first();
  const initialSvg = await inlineSvg.evaluate(element => element.outerHTML);
  test.check('Mermaid renders as an inline SVG', await inlineSvg.isVisible());

  await openWhiteboard(page, frame);
  test.check('whiteboard editor mounts in a modal', await page.locator('#board').isVisible());
  test.check(
    'whiteboard uses one menu action with both delivery choices',
    await page.locator('#boardAction[aria-haspopup="menu"]').count() === 1 &&
      await page.locator('#boardMenu [role="menuitem"]').count() === 2 &&
      (await page.locator('#boardMenu').textContent()).includes('Send now') &&
      (await page.locator('#boardMenu').textContent()).includes('Add to review'),
  );

  const expectedRectangle = await drawLargeRectangle(page);
  await page.locator('#boardSummaryText').fill('added a large review rectangle');
  await chooseAction(page, '#boardAction', '#boardQueue');
  await waitForQueueCount(page, 1, 10000);
  test.check('whiteboard Add to review creates a draft and closes editor', !(await page.locator('#board').isVisible()));

  const queued = await eventually(async () => {
    const state = await api('GET', '/state');
    return state.queue.find(item => item.kind === 'whiteboard') || null;
  }, { label:'queued whiteboard item' });
  test.check('queued whiteboard records scene and PNG paths', !!(queued.scene_path && queued.png_path));
  const scene = JSON.parse(fs.readFileSync(queued.scene_path, 'utf8'));
  test.check(
    'saved scene contains the rectangle drawn by the reviewer',
    sceneHasDrawnRectangle(scene, expectedRectangle),
    `elements=${(scene.elements || []).length}`,
  );
  test.check('saved whiteboard preview is a valid PNG', isPng(queued.png_path), queued.png_path);

  await eventually(async () => {
    const current = await inlineSvg.evaluate(element => element.outerHTML);
    return current !== initialSvg;
  }, { label:'updated inline diagram' });
  test.check('inline diagram refreshes after the real scene edit', true);
  test.check(
    'whiteboard feedback does not rewrite Mermaid source',
    fs.readFileSync(ART, 'utf8') === artifactBefore,
  );

  const poll = startPoll(ART, 30);
  await chooseAction(page, '#chatAction', '#chatSend');
  const event = await within(poll.result, 5000, 'queued whiteboard delivery');
  const delivered = event.items.find(item => item.kind === 'whiteboard');
  test.check(
    'a later Send now delivers the drafted whiteboard',
    delivered?.summary === 'added a large review rectangle',
    JSON.stringify(delivered || {}),
  );

  const unexpectedErrors = pageErrors.filter(message =>
    !/subset-worker|Failed to use workers/.test(message)
  );
  test.check(
    'online whiteboard has no unexpected page errors',
    unexpectedErrors.length === 0,
    unexpectedErrors.join(' | '),
  );
} catch (error) {
  test.check('online whiteboard drive completed', false, error.stack || error.message);
} finally {
  await browser?.close();
  stopSession(ART);
  test.finish(pageErrors.filter(message =>
    !/subset-worker|Failed to use workers/.test(message)
  ));
}
