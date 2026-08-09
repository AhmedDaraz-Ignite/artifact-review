import { When, Then, expect } from '../support/bdd.js';

const VIEWPORTS = {
  desktop:{ width:1440, height:950 },
  // Wide enough that the artifact column is off its 880px floor in both rail states.
  'wide desktop':{ width:1636, height:950 },
  phone:{ width:390, height:844 },
};

When(/^the viewport is a (wide desktop|desktop|phone)$/, async ({ page }, kind) => {
  const { width, height } = VIEWPORTS[kind];
  await page.setViewportSize({ width, height });
  // A headed browser silently clamps a viewport wider than the screen, which would
  // fail a width scenario with a number that blames the CSS.
  expect(await page.evaluate(() => innerWidth)).toBe(width);
});

Then(/^the artifact (column|prose) is (\d+)px wide$/, async ({ rail }, part, expected) => {
  const selector = part === 'column' ? 'main' : 'main > p';
  // The frame relayouts after the rail, so poll rather than read the width once.
  await expect
    .poll(async () => Math.round(await rail.artifactWidth(selector)))
    .toBe(Number(expected));
});

Then('the review rail sits beside the artifact', async ({ page }) => {
  const layout = await page.evaluate(() => {
    const stage = document.querySelector('.stage').getBoundingClientRect();
    const rail = document.querySelector('.review-rail').getBoundingClientRect();
    return {
      railAtRight:rail.left >= stage.right - 1,
      railFits:rail.right <= innerWidth + 1,
    };
  });
  expect(Object.entries(layout).filter(([, ok]) => !ok)).toEqual([]);
});

Then('the review rail overlays the artifact from the right', async ({ page }) => {
  const layout = await page.evaluate(() => {
    const stage = document.querySelector('.stage').getBoundingClientRect();
    const rail = document.querySelector('.review-rail').getBoundingClientRect();
    const workspace = document.querySelector('.workspace').getBoundingClientRect();
    const actions = document.querySelector('.topbar-actions').getBoundingClientRect();
    return {
      railAtRight:Math.abs(rail.right - innerWidth) <= 1,
      railOverlays:rail.left < stage.right && Math.abs(rail.top - stage.top) <= 1,
      stageFillsWorkspace:Math.abs(stage.width - workspace.width) <= 1 &&
        Math.abs(stage.height - workspace.height) <= 1,
      railFitsWidth:rail.left >= -1 && rail.right <= innerWidth + 1,
      railFitsHeight:rail.bottom <= innerHeight + 1,
      actionsFit:actions.right <= innerWidth + 1,
    };
  });
  expect(Object.entries(layout).filter(([, ok]) => !ok)).toEqual([]);
});

Then('the page does not scroll sideways', async ({ page }) => {
  await expect.poll(() => page.evaluate(
    () => document.documentElement.scrollWidth - innerWidth,
  )).toBeLessThanOrEqual(0);
});
