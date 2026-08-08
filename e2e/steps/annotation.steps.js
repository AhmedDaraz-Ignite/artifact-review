import { Given, When, Then, expect } from '../support/bdd.js';

const TARGETS = {
  'the first paragraph':frame => frame.locator('p').first(),
  'the table':frame => frame.locator('table').first(),
};

function target(rail, name) {
  const resolve = TARGETS[name];
  if (!resolve) throw new Error(`unknown annotation target: ${name}`);
  return resolve(rail.artifact);
}

Given('the reviewer has turned annotation mode on', async ({ rail }) => {
  if (await rail.annotateToggle.getAttribute('aria-pressed') !== 'true') {
    await rail.annotateToggle.click();
  }
  await expect(rail.annotateToggle).toHaveAttribute('aria-pressed', 'true');
});

When('the reviewer toggles annotation mode', async ({ rail }) => {
  await rail.annotateToggle.click();
});

Then('annotation mode is {word}', async ({ rail }, state) => {
  await expect(rail.annotateToggle)
    .toHaveAttribute('aria-pressed', state === 'on' ? 'true' : 'false');
});

When('the reviewer selects {string}', async ({ rail, popover }, name) => {
  await target(rail, name).click({ clickCount:3 });
  await expect(popover.root).toBeVisible();
});

When('the reviewer clicks {string}', async ({ rail, popover }, name) => {
  await target(rail, name).click({ position:{ x:10, y:10 } });
  await expect(popover.root).toBeVisible();
});

When('the reviewer writes {string} in the annotation', async ({ popover }, text) => {
  await popover.text.fill(text);
});

When('the reviewer chooses {string} in the annotation', async ({ popover }, action) => {
  await popover.choose(action);
});

When('the reviewer opens the annotation menu with the keyboard', async ({ page, popover }) => {
  await popover.action.focus();
  await page.keyboard.press('ArrowDown');
  await expect(popover.openMenu).toBeVisible();
});

When('the reviewer presses {word}', async ({ page }, key) => {
  await page.keyboard.press(key);
});

Then('the annotation menu focuses {string}', async ({ page }, label) => {
  const id = label === 'Send now' ? 'popSend' : 'popQueue';
  await page.waitForFunction(
    expected => document.activeElement?.id === expected, id);
});

Then('the annotation composer is closed', async ({ popover }) => {
  await expect(popover.root).toBeHidden();
});

Then('the annotation shows {string}', async ({ popover }, state) => {
  await expect(popover.state).toHaveText(state);
});

Then('the annotation text box is disabled', async ({ popover }) => {
  await expect(popover.text).toBeDisabled();
});

Then('the text annotation carries a durable anchor', async ({ arev }) => {
  const anchor = arev.lastEvent?.items.find(item => item.kind === 'text')?.anchor;
  expect(anchor?.exact, 'anchor exact text').toBeTruthy();
  expect(anchor?.selector, 'anchor selector').toBeTruthy();
});
