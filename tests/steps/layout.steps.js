import { When, Then, expect } from '../support/bdd.js';

const VIEWPORTS = {
  desktop:{ width:1440, height:950 },
  // Wide enough that the artifact column is off its 880px floor in both rail states.
  'wide desktop':{ width:1636, height:950 },
  phone:{ width:390, height:844 },
  // The smallest phone the rail supports. It gives the rail the least room.
  'small phone':{ width:360, height:740 },
  // The shortest rail of all, where the composer is the first thing pushed out.
  'landscape phone':{ width:740, height:360 },
};

When(
  new RegExp(`^the viewport is a (${Object.keys(VIEWPORTS).join('|')})$`),
  async ({ page }, kind) => {
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

// A section sized only by leftover space collapses to its floor on a crowded rail,
// which leaves the feed a sliver. Counting whole entries states what that costs.
Then(/^the review feed shows at least (\d+) entries at once$/, async ({ page }, count) => {
  await expect.poll(() => page.evaluate(() => {
    const feed = document.querySelector('#feed');
    const entry = feed.querySelector('.feed-entry');
    return entry ? Math.floor(feed.clientHeight / entry.offsetHeight) : 0;
  })).toBeGreaterThanOrEqual(Number(count));
});

Then('the draft list shows all of its empty state', async ({ rail }) => {
  await expect
    .poll(() => rail.drafts.evaluate(el => el.scrollHeight - el.clientHeight))
    .toBe(0);
});

Then('every rail section keeps its own space', async ({ page, rail }) => {
  // The rail animates, so measure only once it has come to rest.
  await rail.settle();
  const damage = await page.evaluate(() => {
    const name = el => el.id || el.className;
    const panel = document.querySelector('#reviewRailPanel');
    // Scroll the rail to its end first. Whatever still sits below the panel after
    // that is content the reviewer has no way to reach.
    panel.scrollTop = panel.scrollHeight;
    const found = [];
    for (const section of panel.children) {
      const box = section.getBoundingClientRect();
      // A heading drawn outside its own section is the garbled text a reviewer sees.
      for (const heading of section.querySelectorAll('h2')) {
        const head = heading.getBoundingClientRect();
        if (head.top < box.top - 1 || head.bottom > box.bottom + 1) {
          found.push(`"${heading.textContent.trim()}" paints outside ${name(section)}`);
        }
      }
      for (const body of section.querySelectorAll('.drafts, .activity')) {
        const rows = body.querySelectorAll('.draft-row, .feed-entry');
        if (!rows.length) continue;
        // Scroll the list to its end too, then measure against the section, because
        // the section is what clips. A list squeezed to nothing and a list that never
        // became a scroller both fail here.
        body.scrollTop = body.scrollHeight;
        if (rows[rows.length - 1].getBoundingClientRect().bottom > box.bottom + 1) {
          found.push(`${name(body)} cannot scroll to the last of its ${rows.length} rows`);
        }
      }
    }
    const last = panel.lastElementChild;
    if (last.getBoundingClientRect().bottom > panel.getBoundingClientRect().bottom + 1) {
      found.push(`${name(last)} falls out of reach below the rail`);
    }
    return found;
  });
  expect(damage).toEqual([]);
});

Then('the page does not scroll sideways', async ({ page }) => {
  await expect.poll(() => page.evaluate(
    () => document.documentElement.scrollWidth - innerWidth,
  )).toBeLessThanOrEqual(0);
});
