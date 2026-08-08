import { When, Then, expect } from '../support/bdd.js';

When('the reviewer opens the composer menu', async ({ rail }) => {
  await rail.chatAction.click();
});

Then('the end action reads {string}', async ({ rail }, label) => {
  await expect(rail.endLabel).toHaveText(label);
});

Then('the composer menu offers every delivery choice', async ({ page, rail }) => {
  const menu = page.locator('#chatMenu');
  await expect(page.locator('#chatAction[aria-haspopup="menu"]')).toHaveCount(1);
  await expect(menu.locator('[role="menuitem"]')).toHaveCount(3);
  await expect(menu).toContainText('Send now');
  await expect(menu).toContainText('Add to review');
  // The end label reads "End review" or "Send and end review", so match either.
  await expect(rail.endLabel).toContainText(/end review/i);
});

Then('there is no separate send button', async ({ page }) => {
  await expect(page.locator('#flushBtn')).toHaveCount(0);
});

Then('ending the review lives only in the composer menu', async ({ page }) => {
  await expect(page.locator('#sessionMenu [role="menuitem"]')).toHaveCount(1);
  await expect(page.locator('#endBtn')).toHaveCount(0);
});

Then('the reviewer was asked to confirm', async ({ dialogs }) => {
  expect(dialogs).not.toHaveLength(0);
});

Then('the agent is told the review ended by the user', async ({ arev }) => {
  const event = await arev.poll();
  expect(event.type).toBe('ended');
  expect(event.by).toBe('user');
  arev.endedState = await arev.api('GET', '/state');
});

Then('the review surface is read-only', async ({ page, rail }) => {
  await expect(rail.banner).toContainText('read-only');
  await expect(rail.annotateToggle).toBeDisabled();
  await expect(rail.chat).toBeDisabled();
  await expect(rail.chatAction).toBeDisabled();
  await expect(page.locator('#chatEnd')).toBeDisabled();
});

Then('reopening the review is refused', async ({ arev }) => {
  await expect(arev.run(['open', arev.artifact, '--no-browser'])).rejects
    .toThrow(/reopen/);
});

When('the agent reopens the review explicitly', async ({ arev }) => {
  const { stdout } = await arev.run(['open', arev.artifact, '--no-browser', '--reopen']);
  expect(stdout).toContain('SESSION');
});

Then('the reopened session accepts feedback again', async ({ arev }) => {
  const written = await arev.api('POST', '/queue', {
    item:{ kind:'chat', text:'feedback after live reopen' },
  });
  expect(written.ok).toBe(true);
  const state = await arev.api('GET', '/state');
  expect(state.ended).toBe(false);
  expect(state.ended_by).toBe(null);
});

Then('the reopened session keeps the earlier activity', async ({ arev }) => {
  const state = await arev.api('GET', '/state');
  expect(state.feed).toHaveLength(arev.endedState.feed.length);
});

Then('the open browser re-audits the reopened session', async ({ arev }) => {
  await expect
    .poll(async () => (await arev.api('GET', '/state')).audit.status)
    .toBe('clear');
});

Then('reopening again changes nothing', async ({ arev }) => {
  const reopened = await arev.api('POST', '/reopen', {});
  expect(reopened.ended).toBe(false);
  expect(reopened.ended_by).toBe(null);
});

When('the agent shuts the review server down', async ({ page, arev }) => {
  arev.health = await arev.api('GET', '/health');
  await page.close();
  arev.shutdown = await arev.api('POST', '/shutdown', {});
});

Then('the shutdown names the server that stopped', async ({ arev }) => {
  expect(arev.shutdown.ok).toBe(true);
  expect(arev.shutdown.instance_id).toBe(arev.health.instance_id);
});

Then('the review server is no longer reachable', async ({ arev }) => {
  await expect.poll(async () => {
    try {
      await arev.api('GET', '/health');
      return 'reachable';
    } catch {
      return 'stopped';
    }
  }).toBe('stopped');
});
