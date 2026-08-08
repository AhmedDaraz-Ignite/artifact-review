import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT,
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
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport:{ width:1280, height:900 } });
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(url, { waitUntil:'domcontentloaded' });

  const curtain = page.locator('#curtain');
  await curtain.waitFor({ state:'hidden', timeout:8000 });
  const initialState = await api('GET', '/state');
  test.check(
    'initial clean artifact passes layout gate',
    initialState.audit.status === 'clear' && !(await curtain.isVisible()),
    `status=${initialState.audit.status}`,
  );

  const layoutPoll = startPoll(ART, 30);
  fs.copyFileSync(path.join(ROOT, 'tests/fixtures/broken.html'), ART);

  await page.locator('#curtainTitle').filter({ hasText:'layout needs attention' }).waitFor({
    state:'visible',
    timeout:10000,
  });
  test.check('clean to broken reload restores blocking curtain', await curtain.isVisible());
  test.check(
    'blocking curtain shows proven failures',
    (await page.locator('#curtainList li').count()) >= 3,
  );
  test.check('Show anyway is offered', await page.locator('#showAnyway').isVisible());

  const event = await within(layoutPoll.result, 5000, 'layout event delivery');
  test.check('agent poll receives layout event without human action', event.type === 'layout');
  const kinds = (event.layout_warnings || []).map(warning => warning.kind);
  test.check(
    'layout event carries proven warning kinds',
    ['escaped-markup', 'clipped-text', 'h-overflow'].every(kind => kinds.includes(kind)),
    kinds.join(','),
  );
  test.check(
    'layout event carries overflow evidence',
    (event.layout_warnings || []).some(warning => warning.overflowPx > 24),
  );

  await page.locator('#showAnyway').click();
  await curtain.waitFor({ state:'hidden', timeout:3000 });
  test.check('Show anyway temporarily lifts blocking curtain', !(await curtain.isVisible()));

  fs.copyFileSync(path.join(ROOT, 'tests/fixtures/clean.html'), ART);
  await page.frameLocator('#art').getByRole('heading', { name:'Clean artifact fixture' }).waitFor({
    timeout:10000,
  });
  await curtain.waitFor({ state:'hidden', timeout:10000 });
  const cleanState = await eventually(async () => {
    const state = await api('GET', '/state');
    return state.audit.status === 'clear' ? state : null;
  }, { label:'clean re-audit' });
  test.check(
    'broken to clean reload clears the gate',
    cleanState.audit.status === 'clear' && !(await curtain.isVisible()),
  );
} catch (error) {
  test.check('layout gate drive completed', false, error.stack || error.message);
} finally {
  await browser?.close();
  stopSession(ART);
  test.finish(pageErrors);
}
