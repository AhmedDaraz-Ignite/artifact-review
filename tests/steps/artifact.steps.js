import { Given, When, Then, expect } from '../support/bdd.js';

Given('the artifact is tall enough to scroll', async ({ artifact }) => {
  await artifact.append('\n<div style="height:1800px"></div>\n');
});

When('the reviewer scrolls the artifact down', async ({ rail }) => {
  await rail.artifact.locator('html').evaluate(() => window.scrollTo(0, 300));
});

When(/^the agent appends "([^"]*)" to the artifact$/, async ({ artifact, arev }, id) => {
  arev.savedVersion = (await arev.api('GET', '/state')).version;
  await artifact.append(`\n<p id="${id}">${id}</p>\n`);
});

When('the review server picks up that save', async ({ arev }) => {
  await expect
    .poll(async () => (await arev.api('GET', '/state')).version)
    .not.toBe(arev.savedVersion);
});

Then(/^the artifact shows "([^"]*)"$/, async ({ rail }, id) => {
  await expect(rail.artifact.locator(`#${id}`)).toBeVisible();
});

Then('the artifact keeps its scroll position', async ({ rail }) => {
  await expect
    .poll(() => rail.artifact.locator('html').evaluate(() => window.scrollY))
    .toBeGreaterThan(100);
});

Then(/^the artifact reloaded exactly (\d+) times?$/, async ({ network }, count) => {
  await expect.poll(() => network.artifactReloads).toBe(count);
});

// Wait before counting. A build that overlaps reloads fires the second request
// in this window.
Then(/^the artifact has reloaded (\d+) times? so far$/,
  async ({ page, network }, count) => {
    await page.waitForTimeout(200);
    expect(network.artifactReloads).toBe(count);
  });

// A reload remounts every diagram host. The control that opens the editor lives
// on the diagram itself, so seeing that control again proves the remount worked.
Then(/^the "([^"]*)" diagram still offers its edit control$/,
  async ({ boards }, id) => {
    await expect(boards.board(id).activation).toBeVisible();
  });

Then('the review tooling never rewrote the artifact source', async ({ artifact }) => {
  const now = await artifact.read();
  expect(now.startsWith(artifact.original)).toBe(true);
});
