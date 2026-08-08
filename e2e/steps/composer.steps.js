import { When, Then, expect } from '../support/bdd.js';

When('the reviewer types {string} in chat', async ({ rail }, text) => {
  await rail.chat.fill(text);
});

When('the reviewer chooses {string}', async ({ rail }, action) => {
  await rail.choose(action);
});

When('the reviewer picks page option {word}', async ({ rail }, value) => {
  await rail.artifact.locator(`input[type="radio"][value="${value}"]`).check();
});

Then('the composer shows {string}', async ({ rail }, state) => {
  await expect(rail.composerState).toHaveText(state);
});

Then('the review holds {int} draft(s)', async ({ rail }, count) => {
  await expect(rail.queueCount).toHaveText(String(count));
});

Then('the chat box is empty', async ({ rail }) => {
  await expect(rail.chat).toHaveValue('');
});

Then('the chat box still contains {string}', async ({ rail }, text) => {
  await expect(rail.chat).toHaveValue(text);
});

Then('the banner explains the feedback was preserved', async ({ rail }) => {
  await expect(rail.banner).toContainText('preserved');
});

Then('the review holds one page choice worth {word}', async ({ arev }, value) => {
  await expect.poll(async () => {
    const state = await arev.api('GET', '/state');
    const controls = state.queue.filter(item => item.kind === 'control');
    return controls.length === 1 ? controls[0].value : null;
  }).toBe(value);
});

Then('the newest feed entry shows {string}', async ({ rail }, state) => {
  await expect(rail.latest(state)).toBeVisible();
});

Then('the feed shows the agent reply {string}', async ({ rail }, text) => {
  await expect(rail.feed).toContainText(text);
});
