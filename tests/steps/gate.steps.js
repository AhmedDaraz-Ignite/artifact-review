import { Given, When, Then, expect } from '../support/bdd.js';

async function settledAudit(arev) {
  return expect.poll(async () => {
    const state = await arev.api('GET', '/state');
    return state.audit.status === 'pending' ? null : state.audit;
  }, { timeout:20_000 }).not.toBe(null)
    .then(async () => (await arev.api('GET', '/state')).audit);
}

Given('a scaffolded artifact', async ({ arev, artifact }) => {
  await arev.run(['new', artifact.path, '--title', 'Scaffold check', '--force']);
  artifact.original = await artifact.read();
});

Given('the reviewer opens a review session the layout gate blocks',
  async ({ arev, page, rail }) => {
    await arev.open();
    await page.goto(arev.sessionUrl, { waitUntil:'domcontentloaded' });
    const audit = await settledAudit(arev);
    expect(audit.status).toBe('blocked');
    await expect(rail.curtain).toBeVisible();
  });

When(/^the agent replaces the artifact with "([^"]*)"$/, async ({ artifact }, name) => {
  await artifact.from(name);
});

Then(/^the layout gate reports "(clear|blocked)"$/, async ({ arev }, status) => {
  await expect.poll(async () => (await arev.api('GET', '/state')).audit.status,
    { timeout:20_000 }).toBe(status);
});

Then('the review is not blocked', async ({ rail }) => {
  await expect(rail.curtain).toBeHidden();
});

Then(/^the review is blocked with at least (\d+) proven failures$/,
  async ({ page }, count) => {
    await expect(page.locator('#curtainTitle'))
      .toContainText('layout needs attention', { timeout:15_000 });
    await expect.poll(() => page.locator('#curtainList li').count())
      .toBeGreaterThanOrEqual(count);
  });

Then('{string} is offered', async ({ page }, label) => {
  await expect(page.getByRole('button', { name:label })).toBeVisible();
});

When('the reviewer chooses {string} on the curtain', async ({ page }, label) => {
  await page.getByRole('button', { name:label }).click();
});

Then('the agent receives a layout event', async ({ arev }) => {
  await arev.awaitEvent('layout');
});

Then('the layout event names the kinds:', async ({ arev }, table) => {
  const kinds = (arev.lastEvent.layout_warnings || []).map(warning => warning.kind);
  for (const [kind] of table.raw()) expect(kinds, kind).toContain(kind);
});

Then('the layout event carries overflow evidence', async ({ arev }) => {
  expect((arev.lastEvent.layout_warnings || [])
    .some(warning => warning.overflowPx > 24)).toBe(true);
});

Then('the audit proves a severe overflow on a phone', async ({ arev }) => {
  const audit = await settledAudit(arev);
  const mobile = (audit.findings || [])
    .find(finding => finding.kind === 'h-overflow' && finding.viewportClass === 'mobile');
  expect(mobile, 'a mobile h-overflow finding').toBeTruthy();
  expect(mobile.severity).toBe('severe');
  expect(mobile.evidence).toMatch(/\[Mobile 360px\]/);
});

Then('the audit finds no overflow on the desktop pass', async ({ arev }) => {
  const audit = await settledAudit(arev);
  expect((audit.findings || []).filter(
    finding => finding.kind === 'h-overflow' && finding.viewportClass === 'desktop',
  )).toEqual([]);
});

Then('the curtain shows the phone evidence', async ({ page }) => {
  await expect(page.locator('#curtainTitle')).toHaveText('The layout needs attention');
  await expect(page.locator('#curtainList')).toContainText('Mobile 360px');
});

Then('the artifact frame width is restored', async ({ page }) => {
  await expect
    .poll(() => page.evaluate(() => document.getElementById('art').style.width))
    .toBe('');
});

Then('the agent hears about the phone overflow', async ({ arev }) => {
  const event = await arev.awaitEvent('layout');
  expect((event.layout_warnings || []).some(
    warning => warning.kind === 'h-overflow' && warning.viewportClass === 'mobile',
  )).toBe(true);
});
