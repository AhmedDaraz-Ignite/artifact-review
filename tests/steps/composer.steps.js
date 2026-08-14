import { When, Then, expect } from '../support/bdd.js';

// Naming the allowed values in the pattern turns a typo into an undefined step.
const DELIVERY_STATE =
  '(Draft|Sending|Sent|Received|Answered|Failed|Applied|Saving|Partly saved'
  + '|Nothing to send|Nothing to add)';
const COMPOSER_ACTION =
  '(Send now|Add to review|Send and end review|Save edits to the artifact)';

When(/^the reviewer types "([^"]*)" in chat$/, async ({ rail }, text) => {
  await rail.chat.fill(text);
});

When(new RegExp(`^the reviewer chooses "${COMPOSER_ACTION}"$`), async ({ rail }, action) => {
  await rail.choose(action);
});

When(/^the reviewer picks page option (\w+)$/, async ({ rail }, value) => {
  await rail.artifact.locator(`input[type="radio"][value="${value}"]`).check();
});

Then(new RegExp(`^the composer shows "${DELIVERY_STATE}"$`), async ({ rail }, state) => {
  await expect(rail.composerState).toHaveText(state);
});

Then('the chat box has focus', async ({ rail }) => {
  await expect(rail.chat).toBeFocused();
});

Then(/^the review holds (\d+) drafts?$/, async ({ rail }, count) => {
  await expect(rail.queueCount).toHaveText(String(count));
});

Then('the chat box is empty', async ({ rail }) => {
  await expect(rail.chat).toHaveValue('');
});

Then(/^the chat box still contains "([^"]*)"$/, async ({ rail }, text) => {
  await expect(rail.chat).toHaveValue(text);
});

Then('the banner explains the feedback was preserved', async ({ rail }) => {
  await expect(rail.banner).toContainText('preserved');
});

Then(/^the review holds one page choice worth (\w+)$/, async ({ arev }, value) => {
  await expect.poll(async () => {
    const state = await arev.api('GET', '/state');
    const controls = state.queue.filter(item => item.kind === 'control');
    return controls.length === 1 ? controls[0].value : null;
  }).toBe(value);
});

Then(new RegExp(`^the newest feed entry shows "${DELIVERY_STATE}"$`), async ({ rail }, state) => {
  await expect(rail.latest(state)).toBeVisible();
});

Then(/^the feed shows the agent reply "([^"]*)"$/, async ({ rail }, text) => {
  await expect(rail.feed).toContainText(text);
});
