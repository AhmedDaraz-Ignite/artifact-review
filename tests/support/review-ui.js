import { expect } from '@playwright/test';

const COMPOSER_ACTIONS = {
  'Send now':'#chatSend',
  'Add to review':'#chatQueue',
  'Send and end review':'#chatEnd',
};

const POPOVER_ACTIONS = {
  'Send now':'#popSend',
  'Add to review':'#popQueue',
};

const DOCK_SECTIONS = {
  drafts:{ button:'#draftDockBtn', focus:'#draftSectionTitle' },
  activity:{ button:'#activityDockBtn', focus:'#activitySectionTitle' },
  'new feedback':{ button:'#newFeedbackDockBtn', focus:'#chat' },
};

const RAIL_STATE_KEY = 'artifact-review:rail-state:v1';

export class ReviewRail {
  constructor(page) {
    this.page = page;
    this.curtain = page.locator('#curtain');
    this.chat = page.locator('#chat');
    this.chatAction = page.locator('#chatAction');
    this.endLabel = page.locator('#chatEndLabel');
    this.queueCount = page.locator('#qCount');
    this.composerState = page.locator('#composerState');
    this.banner = page.locator('#banner');
    this.feed = page.locator('#feed');
    this.feedEntries = page.locator('#feed .feed-entry');
    this.loadEarlier = page.locator('#loadEarlierActivity');
    this.annotateToggle = page.locator('#annBtn');
    this.artifact = page.frameLocator('#art');
    this.root = page.locator('#reviewRail');
    this.toggle = page.locator('#railToggle');
    this.panel = page.locator('#reviewRailPanel');
    this.scrim = page.locator('#railScrim');
    this.drafts = page.locator('#queue');
    this.draftBadge = page.locator('#draftDockBadge');
    this.draftTooltip = page.locator('#draftDockTooltip');
    this.dockDivider = page.locator('.dock-divider');
    // The whole dock set: one toggle, three dock controls, one panel.
    this.railParts = page.locator(
      '#railToggle, #draftDockBtn, #activityDockBtn, #newFeedbackDockBtn, #reviewRailPanel');
  }

  async choose(label) {
    await this.chatAction.click();
    await this.page.locator(COMPOSER_ACTIONS[label]).click();
  }

  latest(state) {
    return this.feed.locator('.state-chip', { hasText:state }).last();
  }

  dock(section) {
    const { button, focus } = DOCK_SECTIONS[section];
    return { button:this.page.locator(button), focus:this.page.locator(focus) };
  }

  // One snapshot, because the next server update repaints the feed.
  loadedHistory() {
    return this.page.evaluate(() => {
      const entries = [...document.querySelectorAll('#feed .feed-entry pre')];
      return {
        count:entries.length,
        first:entries[0]?.textContent,
        last:entries.at(-1)?.textContent,
        loadHidden:document.getElementById('loadEarlierActivity').hidden,
      };
    });
  }

  // Collapsing and expanding animate. Measuring early reads a mid-flight width.
  async settle() {
    await this.root.evaluate(element => Promise.all(
      element.getAnimations({ subtree:true })
        .map(animation => animation.finished.catch(() => {}))));
  }

  async metrics() {
    await this.settle();
    return this.page.evaluate(() => {
      const box = selector => {
        const { left, top, right, bottom, width, height } =
          document.querySelector(selector).getBoundingClientRect();
        return { left, top, right, bottom, width, height };
      };
      return { stage:box('.stage'), rail:box('#reviewRail'), workspace:box('.workspace') };
    });
  }

  // The artifact is a cross-origin frame, so its boxes are measured through the frame
  // locator rather than the host document.
  async artifactWidth(selector) {
    await this.settle();
    return (await this.artifact.locator(selector).first().boundingBox()).width;
  }

  state() {
    return this.page.evaluate(key => ({
      expanded:document.getElementById('railToggle').getAttribute('aria-expanded'),
      panelHidden:document.getElementById('reviewRailPanel').getAttribute('aria-hidden'),
      panelInert:document.getElementById('reviewRailPanel').inert,
      rail:document.documentElement.dataset.reviewRail,
      modal:document.getElementById('reviewRail').getAttribute('aria-modal'),
      stored:localStorage.getItem(key),
    }), RAIL_STATE_KEY);
  }

  async collapse() {
    this.expandedMetrics = await this.metrics();
    await this.toggle.click();
    await expect(this.toggle).toHaveAttribute('aria-expanded', 'false');
    await this.settle();
  }

  async expand() {
    this.collapsedMetrics = await this.metrics();
    await this.toggle.click();
    await expect(this.toggle).toHaveAttribute('aria-expanded', 'true');
    await this.settle();
  }
}

// The popover repeats two of the composer labels. It has its own trigger, so
// it stays a separate object.
export class AnnotationPopover {
  constructor(page) {
    this.page = page;
    this.root = page.locator('#pop');
    this.context = page.locator('#popCtx');
    this.text = page.locator('#popText');
    this.action = page.locator('#popAction');
    this.state = page.locator('#popState');
    this.openMenu = page.locator('#popMenu:popover-open');
  }

  menuItem(label) {
    return this.page.locator(POPOVER_ACTIONS[label]);
  }

  async choose(label) {
    await this.action.click();
    await this.menuItem(label).click();
  }
}
