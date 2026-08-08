import { When, Then, expect } from '../support/bdd.js';

When('the reviewer switches the page theme', async ({ boards }) => {
  const flow = boards.rendered('themed-flow');
  flow.before = await flow.snapshot();
  await flow.countRenders();
  await boards.themeToggle.click();
});

When(/^the reviewer zooms the "([^"]*)" diagram$/, async ({ boards }, id) => {
  const diagram = boards.rendered(id);
  diagram.beforeZoom = await diagram.viewBox();
  expect(diagram.beforeZoom, 'the starting viewBox').toBeTruthy();
  await diagram.zoom();
});

When(/^the reviewer resets the "([^"]*)" view$/, async ({ boards }, id) => {
  await boards.rendered(id).reset();
});

Then(/^the "([^"]*)" diagram reports the "(light|dark)" page theme$/,
  async ({ boards }, id, theme) => {
    await expect(boards.rendered(id).holder)
      .toHaveAttribute('data-arev-mermaid-theme', theme);
  });

Then(/^the "([^"]*)" diagram is typeset in "([^"]*)"$/, async ({ boards }, id, font) => {
  const { markup } = await boards.rendered(id).snapshot();
  expect(markup).toMatch(new RegExp(font, 'i'));
});

Then(/^the "([^"]*)" diagram was rebuilt with restyled markup$/, async ({ boards }, id) => {
  const diagram = boards.rendered(id);
  const now = await diagram.snapshot();
  expect(now.svgId, 'a fresh SVG id').not.toBe(diagram.before.svgId);
  expect(now.markup, 'restyled markup').not.toBe(diagram.before.markup);
});

Then('the re-render announced itself to the review SDK', async ({ boards }) => {
  await expect
    .poll(async () => (await boards.rendered('themed-flow').snapshot()).renders)
    .toBeGreaterThan(0);
});

Then(/^the "([^"]*)" diagram carries at least (\d+) node keys$/,
  async ({ boards }, id, least) => {
    const diagram = boards.rendered(id);
    diagram.keys = await diagram.nodeKeys();
    expect(diagram.keys.length, `${id} node keys`).toBeGreaterThanOrEqual(least);
  });

Then(/^no "([^"]*)" node key ends in a render counter$/, async ({ boards }, id) => {
  expect(boards.rendered(id).keys.filter(key => /-\d+$/.test(key))).toEqual([]);
});

Then(/^the "([^"]*)" node keys are unchanged$/, async ({ boards }, id) => {
  const diagram = boards.rendered(id);
  await expect.poll(() => diagram.nodeKeys()).toEqual(diagram.keys);
});

Then(/^the "([^"]*)" view has changed$/, async ({ boards }, id) => {
  const diagram = boards.rendered(id);
  await expect.poll(() => diagram.viewBox()).not.toBe(diagram.beforeZoom);
});

Then(/^the "([^"]*)" view is back where it started$/, async ({ boards }, id) => {
  const diagram = boards.rendered(id);
  await expect.poll(() => diagram.viewBox()).toBe(diagram.beforeZoom);
});

Then(/^the "([^"]*)" view has not changed$/, async ({ boards }, id) => {
  const diagram = boards.rendered(id);
  expect(await diagram.viewBox()).toBe(diagram.beforeZoom);
});

Then(/^the "([^"]*)" diagram stops offering to pan$/, async ({ boards }, id) => {
  await expect.poll(() => boards.rendered(id).cursor()).not.toBe('grab');
});
