import { When, Then, expect } from '../support/bdd.js';

When('the reviewer types {string} in chat', async ({ rail }, text) => {
  await rail.chat.fill(text);
});

When('the reviewer chooses {string}', async ({ rail }, action) => {
  await rail.choose(action);
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
