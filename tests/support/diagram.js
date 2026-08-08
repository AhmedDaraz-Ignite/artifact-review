import { expect } from '@playwright/test';

const OPEN_EDITOR = /Open diagram editor|Click to edit diagram/i;

// Maps the label a reviewer sees to the diagram and node ids behind it.
const NODES = {
  'API Service':{ diagramId:'rendered-flow-map', nodeId:'node-api-service' },
};

class Board {
  constructor(page, id) {
    this.page = page;
    this.id = id;
    this.host = page.frameLocator('#art').locator(`#arev-board-${id}`);
    this.frames = this.host.locator('iframe');
    this.sharedFrame = this.host.locator('#arev-shared-whiteboard-frame');
    this.editor = null;
    this.saved = null;
  }

  mount() {
    return this.host.waitFor({ state:'visible', timeout:30_000 });
  }

  // Every diagram uses the same editor frame. Find it by the diagram in its URL.
  async readyEditor() {
    const frame = this.page.frames().find(candidate => {
      try {
        const url = new URL(candidate.url());
        return url.pathname === '/whiteboard-frame' &&
          url.searchParams.get('diagram') === this.id;
      } catch {
        return false;
      }
    });
    if (!frame) return null;
    return await frame.locator('.wb-shell').count() ? frame : null;
  }

  async unlock() {
    await this.host.scrollIntoViewIfNeeded();
    await this.host.getByRole('button', { name:OPEN_EDITOR }).click();
    await this.frames.waitFor({ state:'visible', timeout:30_000 });
    await expect.poll(async () => {
      this.editor = await this.readyEditor();
      return Boolean(this.editor);
    }, { timeout:30_000 }).toBe(true);
    return this.editor;
  }

  async open() {
    await this.unlock();
    await this.editor.locator('.excalidraw').waitFor({ state:'visible', timeout:30_000 });
    return this.editor;
  }

  // A Mermaid source edit reloads the artifact, which detaches the editor frame.
  async reopen() {
    const detached = this.editor;
    await expect
      .poll(() => this.page.frames().includes(detached), { timeout:20_000 })
      .toBe(false);
    await this.mount();
    return this.unlock();
  }
}

export class Whiteboards {
  constructor(page) {
    this.page = page;
    this.artifact = page.frameLocator('#art');
    this.editorFrames = this.artifact.locator('[id^="arev-board-"] iframe');
    this.byId = new Map();
  }

  board(id) {
    if (!this.byId.has(id)) this.byId.set(id, new Board(this.page, id));
    return this.byId.get(id);
  }

  node(label) {
    const { diagramId, nodeId } = NODES[label];
    return {
      diagramId,
      nodeId,
      locator:this.artifact.locator(`#${diagramId} #${nodeId} text`),
    };
  }

  saved() {
    return [...this.byId.values()].filter(board => board.saved);
  }
}
