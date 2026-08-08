import { When, Then, expect } from '../support/bdd.js';

const VIEWPORTS = {
  desktop:{ width:1440, height:950 },
  phone:{ width:390, height:844 },
};

When(/^the viewport is a (desktop|phone)$/, async ({ page }, kind) => {
  await page.setViewportSize(VIEWPORTS[kind]);
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
