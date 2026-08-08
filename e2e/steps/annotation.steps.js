import { Given, When, Then, expect } from '../support/bdd.js';

const TARGETS = {
  'the first paragraph':frame => frame.locator('p').first(),
  'the table':frame => frame.locator('table').first(),
};

const MENU_ITEM = { 'Send now':'popSend', 'Add to review':'popQueue' };

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

Then(/^annotation mode is (on|off)$/, async ({ rail }, state) => {
  await expect(rail.annotateToggle)
    .toHaveAttribute('aria-pressed', String(state === 'on'));
});

When(/^the reviewer selects "([^"]*)"$/, async ({ rail, popover }, name) => {
  await target(rail, name).click({ clickCount:3 });
  await expect(popover.root).toBeVisible();
});

When(/^the reviewer clicks "([^"]*)"$/, async ({ rail, popover }, name) => {
  await target(rail, name).click({ position:{ x:10, y:10 } });
  await expect(popover.root).toBeVisible();
});

When(/^the reviewer writes "([^"]*)" in the annotation$/, async ({ popover }, text) => {
  await popover.text.fill(text);
});

When(/^the reviewer chooses "(Send now|Add to review)" in the annotation$/,
  async ({ popover }, action) => {
    await popover.choose(action);
  });

When('the reviewer opens the annotation menu with the keyboard', async ({ page, popover }) => {
  await popover.action.focus();
  await page.keyboard.press('ArrowDown');
  await expect(popover.openMenu).toBeVisible();
});

When(/^the reviewer presses (\w+)$/, async ({ page }, key) => {
  await page.keyboard.press(key);
});

Then(/^the annotation menu focuses "(Send now|Add to review)"$/, async ({ page }, label) => {
  await page.waitForFunction(
    expected => document.activeElement?.id === expected, MENU_ITEM[label]);
});

Then('the annotation composer is closed', async ({ popover }) => {
  await expect(popover.root).toBeHidden();
});

Then(/^the annotation shows "(Draft|Sending|Sent|Failed)"$/, async ({ popover }, state) => {
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
