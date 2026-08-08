const COMPOSER_ACTIONS = {
  'Send now':'#chatSend',
  'Add to review':'#chatQueue',
  'Send and end review':'#chatEnd',
};

const POPOVER_ACTIONS = {
  'Send now':'#popSend',
  'Add to review':'#popQueue',
};

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
    this.annotateToggle = page.locator('#annBtn');
    this.artifact = page.frameLocator('#art');
  }

  async choose(label) {
    await this.chatAction.click();
    await this.page.locator(COMPOSER_ACTIONS[label]).click();
  }

  latest(state) {
    return this.feed.locator('.state-chip', { hasText:state }).last();
  }
}

// The popover repeats two of the composer labels. It has its own trigger, so
// it stays a separate object.
export class AnnotationPopover {
  constructor(page) {
    this.page = page;
    this.root = page.locator('#pop');
    this.text = page.locator('#popText');
    this.action = page.locator('#popAction');
    this.state = page.locator('#popState');
    this.openMenu = page.locator('#popMenu:popover-open');
  }

  async choose(label) {
    await this.action.click();
    await this.page.locator(POPOVER_ACTIONS[label]).click();
  }
}
