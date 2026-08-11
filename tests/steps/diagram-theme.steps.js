import { When, Then, expect } from '../support/bdd.js';

When('the reviewer switches the page theme', async ({ boards }) => {
  const flow = boards.rendered('themed-flow');
  flow.before = await flow.snapshot();
  await flow.watchRenders();
  await boards.themeToggle.click();
});

const GESTURES = {
  'zooms':'zoom',
  'scrolls the wheel over':'wheel',
  'pinches':'pinch',
};

When(/^the reviewer (zooms|scrolls the wheel over|pinches) the "([^"]*)" diagram$/,
  async ({ boards }, gesture, id) => {
    const diagram = boards.rendered(id);
    diagram.beforeZoom = await diagram.viewBox();
    expect(diagram.beforeZoom, 'the starting viewBox').toBeTruthy();
    diagram.beforeWidth = await diagram.viewWidth();
    diagram.tookTheWheel = await diagram[GESTURES[gesture]]();
  });

When(/^the reviewer opens the panel holding the "([^"]*)" diagram$/,
  async ({ boards }, id) => {
    await boards.rendered(id).reveal();
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

Then(/^all (\d+) "([^"]*)" transition labels are readable$/,
  async ({ boards }, expected, id) => {
    const diagram = boards.rendered(id);
    await expect.poll(() => diagram.labelOverlaps())
      .toEqual({ count:Number(expected), pairs:[] });
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

Then(/^the "([^"]*)" wheel was (left to|taken from) the page$/,
  async ({ boards }, id, fate) => {
    expect(boards.rendered(id).tookTheWheel, 'the diagram cancelled the wheel')
      .toBe(fate === 'taken from');
  });

Then(/^the "([^"]*)" diagram says how to zoom and how to restore it$/,
  async ({ boards }, id) => {
    const hint = await boards.rendered(id).hint();
    expect(hint).toMatch(/ctrl/i);
    expect(hint).toMatch(/double-click/i);
  });

Then(/^the "([^"]*)" gesture moved the view a step, not to the limit$/,
  async ({ boards }, id) => {
    const diagram = boards.rendered(id);
    const width = await diagram.viewWidth();
    expect(width, 'the zoomed viewBox width').toBeGreaterThan(diagram.beforeWidth);
    expect(width, 'the zoomed viewBox width').toBeLessThan(diagram.beforeWidth * 1.5);
  });

Then(/^the "([^"]*)" diagram leaves vertical touch scrolling to the page$/,
  async ({ boards }, id) => {
    expect(await boards.rendered(id).touchAction()).toBe('pan-y');
  });

Then(/^the "([^"]*)" diagram says nothing about gestures$/,
  async ({ boards }, id) => {
    expect(await boards.rendered(id).hint()).toBe('');
  });

Then(/^the "([^"]*)" diagram stops offering to pan$/, async ({ boards }, id) => {
  await expect.poll(() => boards.rendered(id).cursor()).not.toBe('grab');
});
