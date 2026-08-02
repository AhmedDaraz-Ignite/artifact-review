import { chromium } from 'playwright';
import {
  TestRun,
  openSession,
  sessionApi,
  stopSession,
  waitForQueueCount,
} from './test-helpers.mjs';

const ART = process.argv[2];
const test = new TestRun();
const pageErrors = [];
let browser;

try {
  const url = openSession(ART);
  const api = sessionApi(url);
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport:{ width:1440, height:950 } });
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(url, { waitUntil:'domcontentloaded' });
  await page.locator('#curtain').waitFor({ state:'hidden', timeout:8000 });

  const controls = await page.locator([
    '#railToggle',
    '#draftDockBtn',
    '#activityDockBtn',
    '#newFeedbackDockBtn',
    '#reviewRailPanel',
  ].join(',')).count();
  test.check(
    'review panel exposes one stable Chrome-style control set',
    controls === 5,
    `found=${controls}`,
  );
  const expanded = await page.evaluate(() => {
    const stage = document.querySelector('.stage').getBoundingClientRect();
    const rail = document.getElementById('reviewRail').getBoundingClientRect();
    return { stageWidth:stage.width, railWidth:rail.width, railRight:rail.right };
  });
  await page.locator('#chat').fill('preserve this unsent panel note');
  await page.locator('#railToggle').click();
  await page.waitForTimeout(250);
  const collapsed = await page.evaluate(() => {
    const stage = document.querySelector('.stage').getBoundingClientRect();
    const rail = document.getElementById('reviewRail').getBoundingClientRect();
    const panel = document.getElementById('reviewRailPanel');
    const toggle = document.getElementById('railToggle');
    return {
      stageWidth:stage.width,
      railWidth:rail.width,
      railRight:rail.right,
      expanded:toggle.getAttribute('aria-expanded'),
      panelHidden:panel.getAttribute('aria-hidden'),
      panelInert:panel.inert,
      state:document.documentElement.dataset.reviewRail,
    };
  });
  test.check(
    'desktop panel collapses into a right-aligned 64px dock',
    Math.abs(expanded.railWidth - 360) <= 1 &&
      Math.abs(collapsed.railWidth - 64) <= 1 &&
      Math.abs(collapsed.stageWidth - expanded.stageWidth - 296) <= 1 &&
      Math.abs(collapsed.railRight - 1440) <= 1 &&
      collapsed.expanded === 'false' &&
      collapsed.panelHidden === 'true' &&
      collapsed.panelInert === true &&
      collapsed.state === 'collapsed',
    JSON.stringify({ expanded, collapsed }),
  );
  test.check(
    'collapse keeps the live composer DOM and text intact',
    await page.locator('#reviewRailPanel').count() === 1 &&
      await page.locator('#chat').inputValue() === 'preserve this unsent panel note',
  );

  async function activateDockTarget(button, expectedFocus) {
    if (await page.locator('#railToggle').getAttribute('aria-expanded') === 'true') {
      await page.locator('#railToggle').click();
      await page.waitForTimeout(200);
    }
    await page.locator(button).click();
    await page.waitForTimeout(200);
    return page.evaluate(focusId => ({
      expanded:document.getElementById('railToggle').getAttribute('aria-expanded'),
      activeId:document.activeElement?.id,
      selected:[...document.querySelectorAll('.dock-control.selected')]
        .map(control => control.id),
      expectedFocus:focusId,
    }), expectedFocus);
  }

  const draftTarget = await activateDockTarget('#draftDockBtn', 'draftSectionTitle');
  const activityTarget = await activateDockTarget('#activityDockBtn', 'activitySectionTitle');
  const newTarget = await activateDockTarget('#newFeedbackDockBtn', 'chat');
  test.check(
    'dock controls expand and focus their existing review sections',
    draftTarget.expanded === 'true' &&
      draftTarget.activeId === draftTarget.expectedFocus &&
      draftTarget.selected.includes('draftDockBtn') &&
      activityTarget.expanded === 'true' &&
      activityTarget.activeId === activityTarget.expectedFocus &&
      activityTarget.selected.includes('activityDockBtn') &&
      newTarget.expanded === 'true' &&
      newTarget.activeId === newTarget.expectedFocus &&
      newTarget.selected.includes('newFeedbackDockBtn'),
    JSON.stringify({ draftTarget, activityTarget, newTarget }),
  );

  await page.locator('#railToggle').click();
  await page.waitForTimeout(200);
  const storedRailState = await page.evaluate(() =>
    localStorage.getItem('artifact-review:rail-state:v1'));
  await page.reload({ waitUntil:'domcontentloaded' });
  await page.locator('#curtain').waitFor({ state:'hidden', timeout:8000 });
  const restoredRail = await page.evaluate(() => {
    const rail = document.getElementById('reviewRail').getBoundingClientRect();
    return {
      state:document.documentElement.dataset.reviewRail,
      width:rail.width,
      expanded:document.getElementById('railToggle').getAttribute('aria-expanded'),
      panelInert:document.getElementById('reviewRailPanel').inert,
    };
  });
  test.check(
    'collapsed preference restores on controller reload',
    storedRailState === 'collapsed' &&
      restoredRail.state === 'collapsed' &&
      Math.abs(restoredRail.width - 64) <= 1 &&
      restoredRail.expanded === 'false' &&
      restoredRail.panelInert === true,
    JSON.stringify({ storedRailState, restoredRail }),
  );

  for (let index = 0; index < 100; index += 1) {
    await api('POST', '/queue', {
      item:{ kind:'chat', text:`dock badge draft ${index + 1}` },
    });
  }
  await waitForQueueCount(page, 100, 8000);
  const badge = await page.evaluate(() => {
    const button = document.getElementById('draftDockBtn');
    const value = document.getElementById('draftDockBadge');
    return {
      text:value.textContent,
      hidden:value.hidden,
      label:button.getAttribute('aria-label'),
      tooltip:document.getElementById('draftDockTooltip').textContent,
    };
  });
  test.check(
    'draft dock badge caps visually at 99+ and exposes the full count',
    badge.text === '99+' &&
      badge.hidden === false &&
      badge.label.includes('100') &&
      badge.tooltip.includes('100'),
    JSON.stringify(badge),
  );

  await page.locator('#draftDockBtn').click();
  await page.waitForTimeout(200);
  const draftScroll = await page.locator('#queue').evaluate(element => {
    element.scrollTop = 420;
    return element.scrollTop;
  });
  await page.locator('#railToggle').click();
  await page.waitForTimeout(200);
  await page.locator('#draftDockBtn').click();
  await page.waitForTimeout(200);
  const restoredDraftScroll = await page.locator('#queue').evaluate(element => element.scrollTop);
  test.check(
    'panel round trip preserves internal draft scroll',
    draftScroll > 0 && restoredDraftScroll === draftScroll,
    JSON.stringify({ draftScroll, restoredDraftScroll }),
  );
  await page.locator('#railToggle').click();
  await page.waitForTimeout(200);
  await page.locator('#draftDockBtn').hover();
  await page.waitForTimeout(160);
  const dockCraft = await page.evaluate(() => {
    const control = document.getElementById('draftDockBtn').getBoundingClientRect();
    const divider = document.querySelector('.dock-divider').getBoundingClientRect();
    const tooltipStyle = getComputedStyle(document.getElementById('draftDockTooltip'));
    return {
      control:{ width:control.width, height:control.height },
      divider:{ width:divider.width, height:divider.height },
      tooltipVisibility:tooltipStyle.visibility,
      tooltipOpacity:Number(tooltipStyle.opacity),
    };
  });
  test.check(
    'collapsed dock keeps Chrome-style targets, divider, and tooltip',
    dockCraft.control.width === 44 &&
      dockCraft.control.height === 44 &&
      dockCraft.divider.width === 32 &&
      dockCraft.divider.height === 1 &&
      dockCraft.tooltipVisibility === 'visible' &&
      dockCraft.tooltipOpacity > 0.9,
    JSON.stringify(dockCraft),
  );
  await page.emulateMedia({ reducedMotion:'reduce' });
  const reducedMotion = await page.locator('#reviewRail').evaluate(element =>
    getComputedStyle(element).transitionDuration);
  test.check(
    'reduced motion removes review panel transitions',
    reducedMotion.split(',').every(value => value.trim() === '0s'),
    reducedMotion,
  );
  await page.emulateMedia({ reducedMotion:'no-preference' });

  await page.setViewportSize({ width:390, height:844 });
  await page.waitForTimeout(250);
  const narrowCollapsed = await page.evaluate(() => {
    const stage = document.querySelector('.stage').getBoundingClientRect();
    const rail = document.getElementById('reviewRail').getBoundingClientRect();
    const workspace = document.querySelector('.workspace').getBoundingClientRect();
    return {
      stage:{ left:stage.left, top:stage.top, width:stage.width, height:stage.height },
      rail:{ left:rail.left, top:rail.top, right:rail.right, width:rail.width, height:rail.height },
      workspace:{ top:workspace.top, bottom:workspace.bottom },
    };
  });
  await page.locator('#railToggle').click();
  await page.waitForTimeout(250);
  const narrowExpanded = await page.evaluate(() => {
    const stage = document.querySelector('.stage').getBoundingClientRect();
    const rail = document.getElementById('reviewRail').getBoundingClientRect();
    const scrim = document.getElementById('railScrim');
    return {
      stage:{ left:stage.left, top:stage.top, width:stage.width, height:stage.height },
      rail:{ left:rail.left, top:rail.top, right:rail.right, width:rail.width, height:rail.height },
      scrimVisible:!scrim.hidden && getComputedStyle(scrim).display !== 'none',
      modal:document.getElementById('reviewRail').getAttribute('aria-modal'),
    };
  });
  test.check(
    'narrow review panel stays right and expands as an overlay',
    Math.abs(narrowCollapsed.rail.width - 64) <= 1 &&
      Math.abs(narrowCollapsed.rail.right - 390) <= 1 &&
      Math.abs(narrowCollapsed.rail.top - narrowCollapsed.workspace.top) <= 1 &&
      Math.abs(narrowCollapsed.rail.height -
        (narrowCollapsed.workspace.bottom - narrowCollapsed.workspace.top)) <= 1 &&
      Math.abs(narrowExpanded.rail.width - 326) <= 1 &&
      Math.abs(narrowExpanded.rail.right - 390) <= 1 &&
      Math.abs(narrowExpanded.stage.width - narrowCollapsed.stage.width) <= 1 &&
      Math.abs(narrowExpanded.stage.height - narrowCollapsed.stage.height) <= 1 &&
      narrowExpanded.scrimVisible &&
      narrowExpanded.modal === 'true',
    JSON.stringify({ narrowCollapsed, narrowExpanded }),
  );

  await page.locator('#chat').fill('preserve this narrow-screen note');
  await page.evaluate(() => {
    const focusable = [...document.querySelectorAll(
      '#reviewRail button:not(:disabled), #reviewRail textarea:not(:disabled), #reviewRail [tabindex]:not([tabindex="-1"])',
    )].filter(element => !element.closest('[inert]'));
    focusable.at(-1)?.focus();
  });
  await page.keyboard.press('Tab');
  const trappedFocus = await page.evaluate(() => ({
    activeId:document.activeElement?.id,
    inside:document.getElementById('reviewRail').contains(document.activeElement),
  }));
  test.check(
    'narrow drawer contains forward keyboard focus',
    trappedFocus.inside && trappedFocus.activeId === 'railToggle',
    JSON.stringify(trappedFocus),
  );

  await page.locator('#chat').focus();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const escaped = await page.evaluate(() => ({
    expanded:document.getElementById('railToggle').getAttribute('aria-expanded'),
    activeId:document.activeElement?.id,
    scrimHidden:document.getElementById('railScrim').hidden,
  }));
  test.check(
    'Escape collapses the narrow drawer and returns focus without losing text',
    escaped.expanded === 'false' &&
      escaped.activeId === 'railToggle' &&
      escaped.scrimHidden &&
      await page.locator('#chat').inputValue() === 'preserve this narrow-screen note',
    JSON.stringify(escaped),
  );

  if (await page.locator('#railToggle').getAttribute('aria-expanded') !== 'true') {
    await page.locator('#railToggle').click();
    await page.waitForTimeout(200);
  }
  await page.locator('#railScrim').click({ position:{ x:12, y:12 } });
  await page.waitForTimeout(200);
  const scrimClosed = await page.evaluate(() => ({
    expanded:document.getElementById('railToggle').getAttribute('aria-expanded'),
    activeId:document.activeElement?.id,
    scrimHidden:document.getElementById('railScrim').hidden,
  }));
  test.check(
    'narrow scrim closes the drawer and preserves composer state',
    scrimClosed.expanded === 'false' &&
      scrimClosed.activeId === 'railToggle' &&
      scrimClosed.scrimHidden &&
      await page.locator('#chat').inputValue() === 'preserve this narrow-screen note',
    JSON.stringify(scrimClosed),
  );

  await api('POST', '/end', { by:'user' });
  await page.locator('#banner').filter({ hasText:'read-only' }).waitFor({ timeout:3000 });
  const endedControls = await page.evaluate(() => ({
    toggle:document.getElementById('railToggle').disabled,
    draft:document.getElementById('draftDockBtn').disabled,
    activity:document.getElementById('activityDockBtn').disabled,
    compose:document.getElementById('newFeedbackDockBtn').disabled,
  }));
  test.check(
    'ended review keeps inspection available and disables only new feedback',
    endedControls.toggle === false &&
      endedControls.draft === false &&
      endedControls.activity === false &&
      endedControls.compose === true,
    JSON.stringify(endedControls),
  );
} catch (error) {
  test.check('review rail drive completed', false, error.stack || error.message);
} finally {
  await browser?.close();
  stopSession(ART);
  test.finish(pageErrors);
}
