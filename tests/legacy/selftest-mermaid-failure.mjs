/*
 * A Mermaid block that fails to render leaves its source showing as plain
 * text. The page audit runs before the offline renderer, so without a second
 * pass the agent is never told the diagram is missing. This drive proves the
 * second pass reports it.
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
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  const art = page.frameLocator('#art');
  await art.locator('#works svg').waitFor({ state: 'visible', timeout: 20000 });
  test.check('a valid Mermaid block still renders offline', true);

  test.check(
    'the broken block keeps its readable source instead of an error graphic',
    (await art.locator('#broken svg').count()) === 0 &&
      (await art.locator('#broken').innerText()).includes('unbalanced'),
  );

  const state = await eventually(async () => {
    const value = await api('GET', '/state');
    return (value.audit?.findings || []).some(
      finding => finding.kind === 'mermaid-render-failed',
    )
      ? value
      : null;
  }, { timeout: 20000, label: 'mermaid failure audit' });

  const failures = (state.audit.findings || []).filter(
    finding => finding.kind === 'mermaid-render-failed',
  );
  test.check(
    'exactly the unrendered diagram is reported',
    failures.length === 1 && failures[0].selector === '#broken',
    JSON.stringify(failures.map(finding => finding.selector)),
  );
  test.check(
    'the finding is severe and names the diagram',
    failures[0]?.severity === 'severe' && failures[0]?.evidence.includes('broken'),
    failures[0]?.evidence,
  );

  const event = await within(poll.result, 15000, 'mermaid failure delivery');
  const kinds = (event.layout_warnings || []).map(warning => warning.kind);
  test.check(
    'the agent poll receives the failure without any human action',
    event.type === 'layout' && kinds.includes('mermaid-render-failed'),
    `${event.type}:${kinds.join(',')}`,
  );
} catch (error) {
  test.check('mermaid failure drive completed', false, error.stack || error.message);
} finally {
  await browser?.close();
  stopSession(ART);
  test.finish(pageErrors);
}
