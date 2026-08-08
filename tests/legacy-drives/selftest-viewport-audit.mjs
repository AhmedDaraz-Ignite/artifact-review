/*
 * The boot audit re-runs at phone and tablet widths behind the curtain, so a
 * layout that only fails on a narrow viewport is still proven, reported to
 * the agent, and shown to the reviewer. This drive uses a fixture that is
 * clean at desktop width and overflows on a phone.
 */
import { chromium } from 'playwright';
import {
  TestRun,
  eventually,
  openSession,
  sessionApi,
  startPoll,
  stopSession,
  within,
} from './test-helpers.mjs';

const ART = process.argv[2];
const test = new TestRun();
const pageErrors = [];
let browser;

try {
  const url = openSession(ART);
  const api = sessionApi(url);
  const poll = startPoll(ART, 30);
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport:{ width:1540, height:1040 } });
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(url, { waitUntil:'domcontentloaded' });

  const state = await eventually(async () => {
    const value = await api('GET', '/state');
    return value.audit?.status && value.audit.status !== 'pending' ? value : null;
  }, { timeout:20000, label:'multi-viewport audit report' });

  const findings = state.audit.findings || [];
  const overflow = findings.filter(finding => finding.kind === 'h-overflow');
  test.check(
    'the phone-only overflow is proven even though the review runs on desktop',
    overflow.some(finding => finding.viewportClass === 'mobile'),
    JSON.stringify(overflow),
  );
  test.check(
    'the desktop pass stays clean for a desktop-clean page',
    !overflow.some(finding => finding.viewportClass === 'desktop'),
    JSON.stringify(overflow),
  );
  const mobile = overflow.find(finding => finding.viewportClass === 'mobile');
  test.check(
    'the finding names its viewport so the fix is unambiguous',
    /\[Mobile 360px\]/.test(mobile?.evidence || ''),
    mobile?.evidence,
  );
  test.check(
    'a proven phone failure gates the review like any severe failure',
    state.audit.status === 'blocked' && mobile?.severity === 'severe',
    `${state.audit.status}:${mobile?.severity}`,
  );
  await page.locator('#curtainTitle').waitFor({ timeout:5000 });
  test.check(
    'the reviewer sees the blocked curtain with the mobile evidence',
    (await page.locator('#curtainTitle').textContent()) ===
      'The layout needs attention' &&
      /Mobile 360px/.test(await page.locator('#curtainList').textContent()),
  );
  test.check(
    'the artifact iframe width is restored after the narrow passes',
    await page.evaluate(() =>
      document.getElementById('art').style.width === ''),
  );

  const event = await within(poll.result, 15000, 'viewport failure delivery');
  const delivered = (event.layout_warnings || []).find(
    warning => warning.kind === 'h-overflow' && warning.viewportClass === 'mobile',
  );
  test.check(
    'the agent hears about the phone failure without any human action',
    event.type === 'layout' && Boolean(delivered),
    JSON.stringify(delivered || {}),
  );
} catch (error) {
  test.check('viewport audit drive completed', false, error.stack || error.message);
} finally {
  await browser?.close();
  stopSession(ART);
  test.finish(pageErrors);
}
