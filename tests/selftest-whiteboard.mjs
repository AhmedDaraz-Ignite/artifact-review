import { chromium } from 'playwright';
import fs from 'node:fs';
import {
  TestRun,
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
const autosaveRequests = [];
let browser;

try {
  const artifactBefore = fs.readFileSync(ART, 'utf8');
  const url = openSession(ART);
  const token = new URL(url).searchParams.get('t');
  const api = sessionApi(url);
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport:{ width:1500, height:980 } });
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('request', request => {
    if (
      request.method() === 'PUT' &&
      /\/whiteboard\/[^/?]+(?:\?|$)/.test(request.url())
    ) {
      autosaveRequests.push(Date.now());
    }
  });
  await page.goto(url, { waitUntil:'domcontentloaded' });
  await page.locator('#curtain').waitFor({ state:'hidden', timeout:8000 });

  const diagram = await waitForInlineDiagram(page);
  const frameSandbox = (await diagram.host.locator('iframe').getAttribute('sandbox') || '')
    .split(/\s+/)
    .filter(Boolean);
  test.check(
    'Mermaid mounts as an inline sandboxed editor',
    await diagram.host.isVisible() &&
      frameSandbox.includes('allow-scripts') &&
      !frameSandbox.includes('allow-same-origin'),
    frameSandbox.join(','),
  );
  test.check(
    'inline editor URL carries no bearer token',
    !diagram.editorFrame.url().includes(token),
    diagram.editorFrame.url(),
  );
  test.check(
    'inline editor starts locked behind an explicit activation control',
    await diagram.host.getByRole('button', { name:/Click to edit diagram/i }).isVisible(),
  );

  await openWhiteboard(page, diagram);
  test.check(
    'supported flowchart converts to editable shapes',
    /Flowchart · Editable shapes/.test(
      await diagram.editorFrame.locator('#wbTypeBadge').textContent(),
    ),
  );

  await eventually(async () => {
    const result = await api('GET', `/whiteboard/${diagram.id}`);
    return result.saved || null;
  }, { timeout:10000, label:'initial converted-scene autosave' });
  autosaveRequests.length = 0;
  const expectedRectangle = await drawLargeRectangle(page, diagram);
  await page.waitForTimeout(500);
  test.check(
    'autosave debounce does not persist the edit early',
    autosaveRequests.length === 0,
    autosaveRequests.join(','),
  );
  const autosaveRequestedAt = await eventually(
    () => autosaveRequests[0] || null,
    { timeout:3000, label:'timed working-scene autosave request' },
  );
  const autosaveDelay = autosaveRequestedAt - expectedRectangle.completedAt;
  test.check(
    'working-scene autosave honors the 800ms debounce window',
    autosaveDelay >= 650 && autosaveDelay < 2500,
    `delay=${autosaveDelay}ms`,
  );
  const working = await eventually(async () => {
    const result = await api('GET', `/whiteboard/${diagram.id}`);
    return result.saved &&
      sceneHasDrawnRectangle(result.saved.scene || {}, expectedRectangle)
      ? result.saved
      : null;
  }, { timeout:10000, label:'debounced working-scene autosave' });
  test.check(
    '800ms autosave persists the real reviewer edit with source identity',
    /^[0-9a-f]{64}$/.test(working.source_hash) &&
      working.text_metrics_version === 1 &&
      !!working.updated_at,
    JSON.stringify({
      source_hash:working.source_hash,
      text_metrics_version:working.text_metrics_version,
      updated_at:working.updated_at,
    }),
  );
  test.check(
    'editor reports a successful autosave',
    /Autosaved|Autosave ready/.test(
      await diagram.editorFrame.locator('#wbStatus').textContent(),
    ),
  );

  await diagram.editorFrame.locator('#wbFullscreen').click();
  const fullscreenReady = await eventually(
    () => diagram.host.evaluate(element =>
      element.classList.contains('arev-inline-fullscreen') &&
      element.querySelectorAll('iframe').length === 1
    ),
    { label:'enter fullscreen' },
  );
  test.check(
    'inline editor expands fullscreen without mounting a second editor',
    fullscreenReady,
  );
  await page.locator('#railToggle').click();
  await page.waitForTimeout(250);
  const fullscreenWithDock = await diagram.host.evaluate(element =>
    element.classList.contains('arev-inline-fullscreen') &&
    element.querySelectorAll('iframe').length === 1
  );
  await page.locator('#railToggle').click();
  await page.waitForTimeout(250);
  const fullscreenWithPanel = await diagram.host.evaluate(element =>
    element.classList.contains('arev-inline-fullscreen') &&
    element.querySelectorAll('iframe').length === 1
  );
  test.check(
    'diagram fullscreen survives review panel collapse and expansion',
    fullscreenWithDock && fullscreenWithPanel,
  );
  await diagram.editorFrame.locator('#wbFullscreen').click();
  await eventually(
    () => diagram.host.evaluate(element =>
      !element.classList.contains('arev-inline-fullscreen')
    ),
    { label:'exit fullscreen' },
  );

  await diagram.host.scrollIntoViewIfNeeded();
  await diagram.editorFrame.locator('#wbSummary').fill('added a large review rectangle');
  await diagram.editorFrame.locator('#wbQueue').click();
  await waitForQueueCount(page, 1, 10000);
  const firstQueued = await eventually(async () => {
    const state = await api('GET', '/state');
    return state.queue.find(item => item.kind === 'whiteboard') || null;
  }, { label:'queued whiteboard item' });
  const firstSnapshot = fs.readFileSync(firstQueued.scene_path);
  test.check(
    'Add to review creates exact scene and PNG snapshots',
    isPng(firstQueued.png_path) && firstSnapshot.length > 100,
    JSON.stringify(firstQueued),
  );

  const poll = startPoll(ART, 30);
  await diagram.host.scrollIntoViewIfNeeded();
  await diagram.editorFrame.locator('#wbSummary').fill('confirmed the diagram edit');
  await diagram.editorFrame.locator('#wbSend').click();
  const event = await within(poll.result, 10000, 'inline whiteboard delivery');
  const delivered = event.items.filter(item => item.kind === 'whiteboard');
  test.check(
    'Send now delivers drafted and current diagram feedback',
    delivered.length === 2 &&
      delivered.some(item => item.summary === 'added a large review rectangle') &&
      delivered.some(item => item.summary === 'confirmed the diagram edit'),
    JSON.stringify(delivered),
  );
  test.check(
    'feedback snapshots are immutable and uniquely named',
    delivered[0].scene_path !== delivered[1].scene_path &&
      fs.readFileSync(firstQueued.scene_path).equals(firstSnapshot),
    delivered.map(item => item.scene_path).join(','),
  );
  test.check(
    'submitted preview is a valid PNG',
    delivered.every(item => isPng(item.png_path)),
  );
  test.check(
    'whiteboard feedback does not rewrite Mermaid source',
    fs.readFileSync(ART, 'utf8') === artifactBefore,
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
