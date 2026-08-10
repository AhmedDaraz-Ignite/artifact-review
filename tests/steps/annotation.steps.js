import { Given, When, Then, expect } from '../support/bdd.js';

const TARGET = '(the first paragraph|the table)';
const TARGETS = {
  'the first paragraph':frame => frame.locator('p').first(),
  'the table':frame => frame.locator('table').first(),
};

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

When(new RegExp(`^the reviewer selects "${TARGET}"$`), async ({ rail, popover }, name) => {
  await TARGETS[name](rail.artifact).click({ clickCount:3 });
  await expect(popover.root).toBeVisible();
});

When(new RegExp(`^the reviewer clicks "${TARGET}"$`), async ({ rail, popover }, name) => {
  await TARGETS[name](rail.artifact).click({ position:{ x:10, y:10 } });
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

Then(/^the annotation menu focuses "(Send now|Add to review)"$/,
  async ({ popover }, label) => {
    await expect(popover.menuItem(label)).toBeFocused();
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

Then('the annotation button reads "Send or add"', async ({ popover }) => {
  await expect(popover.action).toHaveText('Send or add');
});

Then('the text annotation carries a durable anchor', async ({ arev }) => {
  const anchor = arev.lastEvent?.items.find(item => item.kind === 'text')?.anchor;
  expect(anchor?.exact, 'anchor exact text').toBeTruthy();
  expect(anchor?.selector, 'anchor selector').toBeTruthy();
});
