import { Given, When, Then, expect } from '../support/bdd.js';

const SECTION = '(drafts|activity|new feedback)';

const near = (actual, expected) => Math.abs(actual - expected) <= 1;

// Reports which named facts failed instead of a bare false.
function expectAllTrue(facts) {
  expect(Object.entries(facts).filter(([, ok]) => !ok)).toEqual([]);
}

Given('the reviewer has collapsed the review panel', async ({ rail }) => {
  await rail.collapse();
});

Given('the reviewer has the narrow drawer open', async ({ rail }) => {
  if (await rail.toggle.getAttribute('aria-expanded') !== 'true') await rail.expand();
  await expect(rail.scrim).toBeVisible();
});

When('the reviewer collapses the review panel', async ({ rail }) => {
  await rail.collapse();
});

When('the reviewer expands the review panel', async ({ rail }) => {
  await rail.expand();
});

When('the reviewer reloads the review page', async ({ page, rail }) => {
  await page.reload({ waitUntil:'domcontentloaded' });
  await expect(rail.curtain).toBeHidden();
});

When(new RegExp(`^the reviewer opens ${SECTION} from the dock$`), async ({ rail }, section) => {
  await rail.dock(section).button.click();
  await rail.settle();
});

When(new RegExp(`^the reviewer hovers the ${SECTION} dock control$`), async ({ rail }, section) => {
  await rail.dock(section).button.hover();
});

When('the reviewer scrolls the draft list', async ({ rail }) => {
  rail.draftScroll = await rail.drafts.evaluate(element => {
    element.scrollTop = 420;
    return element.scrollTop;
  });
  expect(rail.draftScroll, 'draft list scroll offset').toBeGreaterThan(0);
});

When('the reviewer prefers reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion:'reduce' });
});

When('the reviewer focuses the composer', async ({ rail }) => {
  await rail.chat.focus();
});

When('the reviewer focuses the last drawer control', async ({ rail }) => {
  await rail.root.evaluate(element => {
    const reachable = [...element.querySelectorAll(
      'button:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
    )].filter(candidate => !candidate.closest('[inert]'));
    reachable.at(-1).focus();
  });
});

When('the reviewer taps the scrim', async ({ rail }) => {
  await rail.scrim.click({ position:{ x:12, y:12 } });
});

When(/^the agent queues (\d+) drafts$/, async ({ arev, rail }, count) => {
  for (let start = 0; start < count; start += 20) {
    await Promise.all(Array.from(
      { length:Math.min(20, count - start) },
      (_, offset) => arev.api('POST', '/queue', {
        item:{ kind:'chat', text:`dock draft ${start + offset + 1}` },
      })));
  }
  await expect(rail.queueCount).toHaveText(String(count));
});

Then(/^the review panel exposes its (\d+) stable controls$/, async ({ rail }, count) => {
  await expect(rail.railParts).toHaveCount(count);
});

Then(/^the review panel collapses from (\d+)px into a right-aligned (\d+)px dock$/,
  async ({ page, rail }, open, docked) => {
    const collapsed = await rail.metrics();
    const expanded = rail.expandedMetrics;
    const state = await rail.state();
    expectAllTrue({
      openWidth:near(expanded.rail.width, open),
      dockWidth:near(collapsed.rail.width, docked),
      stageTookTheSpace:near(collapsed.stage.width - expanded.stage.width, open - docked),
      dockAtRightEdge:near(collapsed.rail.right, page.viewportSize().width),
      toggleReportsCollapsed:state.expanded === 'false',
      panelHiddenFromReaders:state.panelHidden === 'true',
      panelInert:state.panelInert === true,
      rootMarkedCollapsed:state.rail === 'collapsed',
    });
  });

Then(/^the collapsed panel still holds (\d+) activity entries$/, async ({ rail }, count) => {
  await expect(rail.panel).toHaveCount(1);
  await expect(rail.feedEntries).toHaveCount(count);
});

Then(new RegExp(`^the review panel expands with ${SECTION} selected and focused$`),
  async ({ rail }, section) => {
    const dock = rail.dock(section);
    await expect(rail.toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(dock.button).toHaveClass(/selected/);
    await expect(dock.focus).toBeFocused();
  });

Then('the collapsed panel preference is stored', async ({ rail }) => {
  expect((await rail.state()).stored).toBe('collapsed');
});

Then(/^the review panel is still a (\d+)px collapsed dock$/, async ({ rail }, width) => {
  const state = await rail.state();
  const metrics = await rail.metrics();
  expectAllTrue({
    rootMarkedCollapsed:state.rail === 'collapsed',
    toggleReportsCollapsed:state.expanded === 'false',
    panelInert:state.panelInert === true,
    dockWidth:near(metrics.rail.width, width),
  });
});

Then(/^the draft dock badge reads "([^"]*)" and names (\d+) drafts$/,
  async ({ rail }, text, count) => {
    await expect(rail.draftBadge).toBeVisible();
    await expect(rail.draftBadge).toHaveText(text);
    await expect(rail.dock('drafts').button)
      .toHaveAttribute('aria-label', new RegExp(String(count)));
    await expect(rail.draftTooltip).toContainText(String(count));
  });

Then('the draft list keeps its scroll position', async ({ rail }) => {
  await expect
    .poll(() => rail.drafts.evaluate(element => element.scrollTop))
    .toBe(rail.draftScroll);
});

Then(/^one more draft is refused and the queue still holds (\d+)$/, async ({ arev }, limit) => {
  const refused = await arev.api('POST', '/queue', {
    item:{ kind:'chat', text:'one draft past the boundary' },
  }).then(() => null, error => error);
  expect(refused?.status, 'queue overflow status').toBe(413);
  expect(refused.data).toMatchObject({ resource:'queue_items', limit, current:limit + 1 });
  expect((await arev.api('GET', '/state')).queue).toHaveLength(limit);
});

Then(new RegExp(`^the ${SECTION} dock control is a (\\d+)px square next to a (\\d+)px divider$`),
  async ({ rail }, section, size, dividerWidth) => {
    const control = await rail.dock(section).button.boundingBox();
    const divider = await rail.dockDivider.boundingBox();
    expectAllTrue({
      controlWidth:control.width === size,
      controlHeight:control.height === size,
      dividerWidth:divider.width === dividerWidth,
      dividerHeight:divider.height === 1,
    });
  });

Then('the dock tooltip is fully visible', async ({ rail }) => {
  await expect(rail.draftTooltip).toBeVisible();
  await expect
    .poll(() => rail.draftTooltip.evaluate(
      element => Number(getComputedStyle(element).opacity)))
    .toBeGreaterThan(0.9);
});

Then('the review panel has no transition', async ({ rail }) => {
  const durations = await rail.root.evaluate(
    element => getComputedStyle(element).transitionDuration);
  expect(durations.split(',').map(value => value.trim()).filter(value => value !== '0s'))
    .toEqual([]);
});

Then(/^the narrow dock fills the workspace edge at (\d+)px$/, async ({ page, rail }, width) => {
  const dock = await rail.metrics();
  expectAllTrue({
    dockWidth:near(dock.rail.width, width),
    dockAtRightEdge:near(dock.rail.right, page.viewportSize().width),
    dockStartsAtWorkspace:near(dock.rail.top, dock.workspace.top),
    dockFillsWorkspace:near(dock.rail.height, dock.workspace.bottom - dock.workspace.top),
  });
});

Then(/^the drawer overlays the artifact at (\d+)px without resizing it$/,
  async ({ page, rail }, width) => {
    await expect(rail.scrim).toBeVisible();
    const drawer = await rail.metrics();
    const dock = rail.collapsedMetrics;
    const state = await rail.state();
    expectAllTrue({
      drawerWidth:near(drawer.rail.width, width),
      drawerAtRightEdge:near(drawer.rail.right, page.viewportSize().width),
      stageKeptItsWidth:near(drawer.stage.width, dock.stage.width),
      stageKeptItsHeight:near(drawer.stage.height, dock.stage.height),
      drawerIsModal:state.modal === 'true',
    });
  });

Then('focus stays inside the drawer on the panel toggle', async ({ rail }) => {
  await expect(rail.toggle).toBeFocused();
  expect(await rail.root.evaluate(
    element => element.contains(document.activeElement))).toBe(true);
});

Then('the narrow drawer is closed with focus back on the panel toggle', async ({ rail }) => {
  await expect(rail.toggle).toBeFocused();
  await expect(rail.scrim).toBeHidden();
  expect((await rail.state()).expanded).toBe('false');
});

Then('the review panel stays open for inspection', async ({ rail }) => {
  await expect(rail.toggle).toBeEnabled();
  await expect(rail.dock('drafts').button).toBeEnabled();
  await expect(rail.dock('activity').button).toBeEnabled();
});

Then('the new feedback dock control is disabled', async ({ rail }) => {
  await expect(rail.dock('new feedback').button).toBeDisabled();
});
