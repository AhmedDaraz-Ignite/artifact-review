import { chromium } from 'playwright';
import fs from 'node:fs';
import {
  TestRun,
  chooseAction,
  openSession,
  startPoll,
  stopSession,
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
const externalRequests = [];
const localControllerAssets = [];
let browser;

try {
  const artifactBefore = fs.readFileSync(ART, 'utf8');
  const url = openSession(ART);
  const allowedOrigin = new URL(url).origin;
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport:{ width:1500, height:980 } });
  await context.route('**/*', route => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.origin === allowedOrigin ||
        requestUrl.protocol === 'data:' ||
        requestUrl.protocol === 'blob:') {
      route.continue();
      return;
    }
    externalRequests.push(requestUrl.href);
    route.abort('internetdisconnected');
  });
  context.on('request', request => {
    const requestUrl = new URL(request.url());
    if (requestUrl.origin === allowedOrigin) {
      if (/whiteboard\.(js|css)/.test(requestUrl.href)) {
        localControllerAssets.push(requestUrl.href);
      }
      return;
    }
    if (requestUrl.protocol !== 'data:' && requestUrl.protocol !== 'blob:') {
      externalRequests.push(requestUrl.href);
    }
  });

  const page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(url, { waitUntil:'domcontentloaded' });
  await page.locator('#curtain').waitFor({ state:'hidden', timeout:8000 });

  const frame = await waitForInlineDiagram(page);
  test.check(
    'offline path renders Mermaid using bundled assets',
    await frame.locator('[id^="arev-board-"] svg').first().isVisible(),
  );
  await openWhiteboard(page, frame);
  const expectedRectangle = await drawLargeRectangle(page);

  const poll = startPoll(ART, 30);
  await page.locator('#boardSummaryText').fill('offline rectangle edit');
  await chooseAction(page, '#boardAction', '#boardSend');
  const event = await within(poll.result, 5000, 'offline whiteboard delivery');
  const whiteboard = event.items.find(item => item.kind === 'whiteboard');
  test.check(
    'whiteboard Send now delivers directly without leaving a draft',
    whiteboard?.summary === 'offline rectangle edit' &&
      Number(await page.locator('#qCount').textContent()) === 0,
    JSON.stringify(whiteboard || {}),
  );

  const scene = whiteboard?.scene_path && fs.existsSync(whiteboard.scene_path)
    ? JSON.parse(fs.readFileSync(whiteboard.scene_path, 'utf8'))
    : {};
  test.check(
    'offline scene persists the reviewer-drawn rectangle',
    sceneHasDrawnRectangle(scene, expectedRectangle),
    `elements=${(scene.elements || []).length}`,
  );
  test.check('offline preview is a valid PNG', isPng(whiteboard?.png_path), whiteboard?.png_path);
  test.check(
    'offline whiteboard loads controller assets locally',
    localControllerAssets.some(asset => asset.includes('/whiteboard.js')) &&
      localControllerAssets.some(asset => asset.includes('/whiteboard.css')),
    localControllerAssets.join(','),
  );
  test.check(
    'offline whiteboard attempts zero external network requests',
    externalRequests.length === 0,
    [...new Set(externalRequests)].join(','),
  );
  test.check(
    'offline whiteboard leaves artifact source untouched',
    fs.readFileSync(ART, 'utf8') === artifactBefore,
  );

  const unexpectedErrors = pageErrors.filter(message =>
    !/subset-worker|Failed to use workers/.test(message)
  );
  test.check(
    'offline whiteboard has no unexpected page errors',
    unexpectedErrors.length === 0,
    unexpectedErrors.join(' | '),
  );
} catch (error) {
  test.check('offline whiteboard drive completed', false, error.stack || error.message);
} finally {
  await browser?.close();
  stopSession(ART);
  test.finish(pageErrors.filter(message =>
    !/subset-worker|Failed to use workers/.test(message)
  ));
}
