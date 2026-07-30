import { chromium } from 'playwright';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import {
  TestRun,
  chooseAction,
  eventually,
  openSession,
  percentile,
  runArev,
  sessionApi,
  startPoll,
  stopSession,
  waitForQueueCount,
  within,
} from './test-helpers.mjs';

const ART = process.argv[2];
const DELIVERY_SLO_MS = Number(process.env.AREV_TEST_DELIVERY_SLO_MS || 1500);
const test = new TestRun();
const pageErrors = [];
let browser;

async function waitForControl(api, value) {
  return eventually(async () => {
    const state = await api('GET', '/state');
    const controls = state.queue.filter(item => item.kind === 'control');
    return controls.length === 1 && controls[0].value === value ? state : null;
  }, { label:`deduped control value ${value}` });
}

try {
  const sourceBefore = fs.readFileSync(ART, 'utf8');
  const url = openSession(ART);
  const api = sessionApi(url);
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport:{ width:1440, height:950 } });
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.goto(url, { waitUntil:'domcontentloaded' });
  await page.locator('#curtain').waitFor({ state:'hidden', timeout:8000 });
  test.check('clean artifact opens after layout check', !(await page.locator('#curtain').isVisible()));

  test.check(
    'chat uses one menu action instead of separate send buttons',
    await page.locator('#chatAction[aria-haspopup="menu"]').count() === 1 &&
      await page.locator('#chatMenu [role="menuitem"]').count() === 2 &&
      await page.locator('#flushBtn').count() === 0,
  );
  test.check(
    'chat menu names both delivery choices',
    (await page.locator('#chatMenu').textContent()).includes('Send now') &&
      (await page.locator('#chatMenu').textContent()).includes('Add to review'),
  );

  const desktopLayout = await page.evaluate(() => {
    const stage = document.querySelector('.stage').getBoundingClientRect();
    const rail = document.querySelector('.review-rail').getBoundingClientRect();
    return {
      railAtRight:rail.left >= stage.right - 1,
      railFits:rail.right <= innerWidth + 1,
      noHorizontalOverflow:document.documentElement.scrollWidth <= innerWidth,
    };
  });
  test.check(
    'desktop layout keeps review rail beside artifact',
    Object.values(desktopLayout).every(Boolean),
    JSON.stringify(desktopLayout),
  );

  await page.setViewportSize({ width:390, height:844 });
  await page.waitForTimeout(100);
  const mobileLayout = await page.evaluate(() => {
    const stage = document.querySelector('.stage').getBoundingClientRect();
    const rail = document.querySelector('.review-rail').getBoundingClientRect();
    const actions = document.querySelector('.topbar-actions').getBoundingClientRect();
    return {
      railBelow:rail.top >= stage.bottom - 1,
      railFitsWidth:rail.left >= -1 && rail.right <= innerWidth + 1,
      railFitsHeight:rail.bottom <= innerHeight + 1,
      actionsFit:actions.right <= innerWidth + 1,
      noHorizontalOverflow:document.documentElement.scrollWidth <= innerWidth,
    };
  });
  test.check(
    'narrow layout stacks a fully reachable review rail below artifact',
    Object.values(mobileLayout).every(Boolean),
    JSON.stringify(mobileLayout),
  );
  await page.setViewportSize({ width:1440, height:950 });

  const frame = page.frameLocator('#art');
  await page.locator('#annBtn').click();
  test.check(
    'annotation toggle exposes pressed state',
    await page.locator('#annBtn').getAttribute('aria-pressed') === 'true',
  );

  await frame.locator('p').first().click({ clickCount:3 });
  await page.locator('#pop').waitFor({ state:'visible', timeout:3000 });
  await page.locator('#popText').fill('tighten this paragraph');
  await page.locator('#popAction').focus();
  await page.keyboard.press('ArrowDown');
  await page.locator('#popMenu:popover-open').waitFor({ state:'visible' });
  await page.waitForFunction(() => document.activeElement?.id === 'popSend');
  test.check(
    'annotation menu opens from keyboard and focuses first action',
    await page.locator('#popSend').evaluate(element => document.activeElement === element),
  );
  await page.keyboard.press('ArrowDown');
  await page.waitForFunction(() => document.activeElement?.id === 'popQueue');
  test.check(
    'annotation menu arrow key reaches Add to review',
    await page.locator('#popQueue').evaluate(element => document.activeElement === element),
  );
  await page.keyboard.press('Enter');
  await waitForQueueCount(page, 1);
  test.check('annotation Add to review creates one draft', !(await page.locator('#pop').isVisible()));

  await page.locator('#chat').fill('drafted chat note');
  await chooseAction(page, '#chatAction', '#chatQueue');
  await waitForQueueCount(page, 2);
  test.check(
    'chat Add to review keeps delivery pending',
    await page.locator('#composerState').textContent() === 'Draft' &&
      await page.locator('#chat').inputValue() === '',
  );

  await page.locator('#annBtn').click();
  test.check(
    'annotation toggle turns off before page controls',
    await page.locator('#annBtn').getAttribute('aria-pressed') === 'false',
  );
  for (const value of ['b', 'a', 'b']) {
    await frame.locator(`input[type="radio"][value="${value}"]`).check();
    await waitForControl(api, value);
  }
  const controlState = await api('GET', '/state');
  const controls = controlState.queue.filter(item => item.kind === 'control');
  test.check(
    'repeated page choices dedupe to the last value',
    controls.length === 1 && controls[0].value === 'b',
    JSON.stringify(controls),
  );
  await waitForQueueCount(page, 3);

  await page.locator('#annBtn').click();
  await frame.locator('table').first().click({ position:{ x:10, y:10 } });
  await page.locator('#pop').waitFor({ state:'visible', timeout:3000 });
  await page.locator('#popText').fill('add a totals row');

  let releaseAnnotationSend;
  let annotationRequestSeen;
  const annotationRequest = new Promise(resolve => { annotationRequestSeen = resolve; });
  const annotationHold = new Promise(resolve => { releaseAnnotationSend = resolve; });
  const holdSend = async route => {
    annotationRequestSeen();
    await annotationHold;
    await route.continue();
  };
  await page.route('**/send', holdSend);
  const annotationPoll = startPoll(ART, 30);
  await page.locator('#popAction').click();
  await page.locator('#popSend').click();
  await within(annotationRequest, 3000, 'annotation send request');
  test.check(
    'annotation exposes Sending while delivery is in flight',
    await page.locator('#popState').textContent() === 'Sending' &&
      await page.locator('#popText').isDisabled(),
  );
  releaseAnnotationSend();
  const annotationEvent = await within(annotationPoll.result, 5000, 'annotation feedback delivery');
  await page.unroute('**/send', holdSend);
  const annotationKinds = annotationEvent.items.map(item => item.kind).sort();
  test.check(
    'annotation Send now includes all existing drafts exactly once',
    JSON.stringify(annotationKinds) === JSON.stringify(['chat', 'control', 'element', 'text']),
    annotationKinds.join(','),
  );
  const anchor = annotationEvent.items.find(item => item.kind === 'text')?.anchor;
  test.check(
    'text annotation retains a durable range anchor',
    !!(anchor?.exact && anchor?.selector),
    JSON.stringify(anchor || {}).slice(0, 100),
  );
  await page.locator('#feed .state-chip', { hasText:'Received' }).last().waitFor({
    timeout:5000,
  });
  test.check('agent acknowledgement advances delivery to Received', true);
  await waitForQueueCount(page, 0);

  await page.locator('#annBtn').click();
  await page.locator('#chat').fill('queued before retry');
  await chooseAction(page, '#chatAction', '#chatQueue');
  await waitForQueueCount(page, 1);
  await page.locator('#chat').fill('preserve this unsent note');
  const failSend = route => route.fulfill({
    status:503,
    contentType:'application/json',
    body:JSON.stringify({ error:'synthetic delivery failure' }),
  });
  await page.route('**/send', failSend);
  await chooseAction(page, '#chatAction', '#chatSend');
  await page.locator('#composerState').filter({ hasText:'Failed' }).waitFor({ timeout:3000 });
  test.check(
    'failed Send now preserves unsent text and queued review',
    await page.locator('#chat').inputValue() === 'preserve this unsent note' &&
      Number(await page.locator('#qCount').textContent()) === 1,
  );
  test.check(
    'failed Send now explains preservation',
    (await page.locator('#banner').textContent()).includes('preserved'),
  );
  await page.unroute('**/send', failSend);

  await chooseAction(page, '#chatAction', '#chatSend');
  await page.locator('#composerState').filter({ hasText:'Sent' }).waitFor({ timeout:3000 });
  await page.locator('#feed .state-chip', { hasText:'Sent' }).last().waitFor({ timeout:3000 });
  test.check(
    'successful retry clears input and exposes Sent before acknowledgement',
    await page.locator('#chat').inputValue() === '' &&
      Number(await page.locator('#qCount').textContent()) === 0,
  );
  const retryPoll = startPoll(ART, 30);
  const retryEvent = await within(retryPoll.result, 5000, 'retry feedback delivery');
  test.check(
    'successful retry delivers queued and current notes',
    retryEvent.items.filter(item => item.kind === 'chat').length === 2,
  );
  await page.locator('#feed .state-chip', { hasText:'Received' }).last().waitFor({
    timeout:5000,
  });

  const deliverySamples = [];
  for (let index = 0; index < 5; index += 1) {
    const message = `latency sample ${index + 1}`;
    const poll = startPoll(ART, 30);
    await page.locator('#chat').fill(message);
    await page.locator('#chatAction').click();
    const started = performance.now();
    await page.locator('#chatSend').click();
    const event = await within(poll.result, 3000, `latency sample ${index + 1}`);
    deliverySamples.push(performance.now() - started);
    test.check(
      `latency sample ${index + 1} reached agent`,
      event.type === 'feedback' &&
        event.items.some(item => item.kind === 'chat' && item.text === message),
    );
  }
  const p95 = percentile(deliverySamples, 0.95);
  test.check(
    `local Send now p95 is under ${DELIVERY_SLO_MS}ms`,
    p95 < DELIVERY_SLO_MS,
    `p95=${p95.toFixed(1)}ms samples=${deliverySamples.map(value => value.toFixed(1)).join(',')}`,
  );

  runArev(['reply', ART, 'Applied. Totals row added.']);
  await page.locator('#feed').filter({ hasText:'Totals row added' }).waitFor({ timeout:3000 });
  await page.locator('#feed .state-chip', { hasText:'Answered' }).last().waitFor({
    timeout:3000,
  });
  test.check('agent reply advances the related delivery to Answered', true);

  await frame.locator('html').evaluate(() => window.scrollTo(0, 300));
  fs.appendFileSync(ART, '\n<p id="fresh-edit">LIVE RELOAD MARKER</p>\n');
  await frame.locator('#fresh-edit').waitFor({ timeout:8000 });
  const scrollY = await eventually(async () => {
    const position = await frame.locator('html').evaluate(() => window.scrollY);
    return position > 100 ? position : null;
  }, { timeout:3000, label:'artifact scroll restoration' });
  test.check('live reload preserves artifact scroll', scrollY > 100, `y=${scrollY}`);
  const diagramCount = await eventually(async () => {
    const count = await page.getByRole('button', { name:/Focus diagram editor:/ }).count();
    return count >= 1 ? count : null;
  }, { timeout:3000, label:'Mermaid re-index after live reload' });
  test.check(
    'Mermaid diagram exposes one edit entry',
    diagramCount >= 1,
  );
  test.check(
    'review tooling never rewrites the artifact source',
    fs.readFileSync(ART, 'utf8').startsWith(sourceBefore),
  );

  const endPoll = startPoll(ART, 30);
  await page.locator('#sessionMenuBtn').click();
  await page.locator('#endBtn').click();
  const endedEvent = await within(endPoll.result, 5000, 'ended event delivery');
  await page.locator('#banner').filter({ hasText:'read-only' }).waitFor({ timeout:3000 });
  test.check(
    'ended session becomes read-only and notifies agent',
    endedEvent.type === 'ended' && endedEvent.by === 'user' &&
      await page.locator('#annBtn').isDisabled() &&
      await page.locator('#chat').isDisabled() &&
      await page.locator('#chatAction').isDisabled(),
  );

  let refused = false;
  try {
    runArev(['open', ART, '--no-browser'], { stdio:'pipe' });
  } catch (error) {
    refused = String(error.stderr).includes('reopen');
  }
  test.check('user-ended review refuses accidental reopen', refused);
  const reopened = runArev(['open', ART, '--no-browser', '--reopen']);
  test.check('explicit reopen is accepted', reopened.includes('SESSION'));

  const unexpectedErrors = pageErrors.filter(message =>
    !/subset-worker|Failed to use workers/.test(message)
  );
  test.check(
    'review loop has no unexpected page errors',
    unexpectedErrors.length === 0,
    unexpectedErrors.join(' | '),
  );
} catch (error) {
  test.check('review loop drive completed', false, error.stack || error.message);
} finally {
  await browser?.close();
  stopSession(ART);
  test.finish(pageErrors.filter(message =>
    !/subset-worker|Failed to use workers/.test(message)
  ));
}
