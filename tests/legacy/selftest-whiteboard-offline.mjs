import { chromium } from 'playwright';
import fs from 'node:fs';
import {
  TestRun,
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
const localWhiteboardAssets = [];
let browser;

try {
  const artifactBefore = fs.readFileSync(ART, 'utf8');
  const url = openSession(ART);
  const allowedOrigin = new URL(url).origin;
  const token = new URL(url).searchParams.get('t');
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
      if (/whiteboard(?:-frame)?(?:\.js|\.css)?/.test(requestUrl.pathname)) {
        localWhiteboardAssets.push(requestUrl.href);
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

  let pageMermaidRendered = false;
  try {
    await page.frameLocator('#art').locator('pre.mermaid svg').first()
      .waitFor({ state:'visible', timeout:15000 });
    pageMermaidRendered = true;
  } catch {}
  test.check(
    'offline artifact page renders Mermaid source to SVG without a CDN',
    pageMermaidRendered,
  );

  const diagram = await waitForInlineDiagram(page);
  await openWhiteboard(page, diagram);
  const expectedRectangle = await drawLargeRectangle(page, diagram);

  const poll = startPoll(ART, 30);
  await diagram.host.scrollIntoViewIfNeeded();
  await diagram.editorFrame.locator('#wbSummary').fill('offline rectangle edit');
  await diagram.editorFrame.locator('#wbSend').click();
  const event = await within(poll.result, 10000, 'offline whiteboard delivery');
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
    'offline whiteboard loads frame, script, and styles locally',
    localWhiteboardAssets.some(asset => new URL(asset).pathname === '/whiteboard-frame') &&
      localWhiteboardAssets.some(asset => new URL(asset).pathname === '/whiteboard.js') &&
      localWhiteboardAssets.some(asset => new URL(asset).pathname === '/whiteboard.css'),
    localWhiteboardAssets.join(','),
  );
  test.check(
    'token is absent from every nested-frame asset URL',
    localWhiteboardAssets.every(asset => !asset.includes(token)),
    localWhiteboardAssets.join(','),
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
