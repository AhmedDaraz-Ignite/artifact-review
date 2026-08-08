const POPOVER_ACTIONS = {
  'Send now':'#popSend',
  'Add to review':'#popQueue',
};

export class AnnotationPopover {
  constructor(page) {
    this.page = page;
    this.root = page.locator('#pop');
    this.text = page.locator('#popText');
    this.action = page.locator('#popAction');
    this.state = page.locator('#popState');
    this.menu = page.locator('#popMenu');
    this.openMenu = page.locator('#popMenu:popover-open');
  }

  async choose(label) {
    const action = POPOVER_ACTIONS[label];
    if (!action) throw new Error(`unknown annotation action: ${label}`);
    await this.action.click();
    await this.page.locator(action).click();
  }
}
