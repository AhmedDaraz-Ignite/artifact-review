const COMPOSER_ACTIONS = {
  'Send now':'#chatSend',
  'Add to review':'#chatQueue',
  'Send and end review':'#chatEnd',
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
    const action = COMPOSER_ACTIONS[label];
    if (!action) throw new Error(`unknown composer action: ${label}`);
    await this.chatAction.click();
    await this.page.locator(action).click();
  }

  latest(state) {
    return this.feed.locator('.state-chip', { hasText:state }).last();
  }
}
