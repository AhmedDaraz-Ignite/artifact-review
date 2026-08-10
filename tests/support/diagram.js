import { expect } from '@playwright/test';
import { pollUntil } from './poll.js';

const OPEN_EDITOR = /Open diagram editor|Click to edit diagram/i;

class Board {
  constructor(page, id) {
    this.page = page;
    this.id = id;
    this.artifact = page.frameLocator('#art');
    this.source = this.artifact.locator(`#${id}`);
    this.host = this.artifact.locator(`#arev-board-${id}`);
    this.activation = this.host.getByRole('button', { name:OPEN_EDITOR });
    this.frames = this.host.locator('iframe');
    this.sharedFrame = this.host.locator('#arev-shared-whiteboard-frame');
    this.editor = null;
    this.saved = null;
    this.drawn = null;
    this.diagramHeight = 0;
  }

  get canvas() {
    return this.editor.locator('canvas.excalidraw__canvas.interactive');
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
    const shells = await frame.locator('.wb-shell').count();
    return shells ? frame : null;
  }

  async unlock() {
    await this.host.scrollIntoViewIfNeeded();
    // Measure the SVG the SDK measures, not the source text Mermaid replaces.
    await this.source.locator('svg').waitFor({ state:'visible', timeout:30_000 });
    this.diagramHeight = await this.source.evaluate(
      node => node.getBoundingClientRect().height);
    await this.activation.click();
    await this.frames.waitFor({ state:'visible', timeout:30_000 });
    this.editor = await pollUntil(() => this.readyEditor(), { timeout:30_000 });
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

  // Drawn in the bottom right corner, where the Excalidraw panels are not.
  async drawRectangle() {
    await this.host.scrollIntoViewIfNeeded();
    const tool = this.editor.locator('[data-testid="toolbar-rectangle"]');
    await this.editor.locator('body').press('r');
    if (!await tool.isChecked()) await tool.check({ force:true });
    const canvas = this.canvas;
    const box = await canvas.boundingBox();
    if (!box) throw new Error('the Excalidraw canvas has no bounding box');
    const width = Math.min(150, Math.max(80, box.width * 0.15));
    const height = Math.min(82, Math.max(48, box.height * 0.28));
    const start = {
      x:Math.max(12, box.width - width - 24),
      y:Math.max(12, box.height - height - 18),
    };
    await canvas.hover({ position:start, force:true });
    await this.page.mouse.down();
    await canvas.hover({ position:{ x:start.x + width, y:start.y + height }, force:true });
    await this.page.mouse.up();
    this.drawn = { width, height, completedAt:Date.now() };
    await this.page.waitForTimeout(200);
    return this.drawn;
  }
}

// A Mermaid block the page rendered to SVG on its own, before any editing.
class RenderedDiagram {
  constructor(artifact, id) {
    this.id = id;
    this.holder = artifact.locator(`#${id}`);
    this.svg = this.holder.locator('svg');
    this.before = null;
    this.beforeZoom = null;
    this.beforeWidth = null;
    this.tookTheWheel = null;
    this.keys = null;
  }

  snapshot() {
    return this.holder.evaluate(element => ({
      theme:element.getAttribute('data-arev-mermaid-theme'),
      svgId:element.querySelector('svg')?.id || '',
      markup:element.innerHTML,
      renders:window.__arevRenders || 0,
    }));
  }

  watchRenders() {
    return this.holder.evaluate(() => {
      window.__arevRenders = 0;
      document.addEventListener(
        'arev:mermaid-rendered', () => { window.__arevRenders += 1; });
    });
  }

  nodeKeys() {
    return this.holder.evaluate(element =>
      [...element.querySelectorAll('[data-arev-node-key]')]
        .map(node => node.getAttribute('data-arev-node-key')));
  }

  viewBox() {
    return this.svg.getAttribute('viewBox');
  }

  // One notch is deltaY 120. A trackpad sends one gesture as many small
  // deltas. Returns true when the diagram took the wheel away from the page.
  wheel({ ctrlKey = false, deltaY = -120, times = 1 } = {}) {
    return this.svg.evaluate((svg, options) => {
      const rect = svg.getBoundingClientRect();
      const init = {
        bubbles:true,
        cancelable:true,
        ctrlKey:options.ctrlKey,
        deltaY:options.deltaY,
        clientX:rect.left + rect.width / 2,
        clientY:rect.top + rect.height / 2,
      };
      let taken = false;
      for (let i = 0; i < options.times; i += 1) {
        taken = !svg.dispatchEvent(new WheelEvent('wheel', init));
      }
      return taken;
    }, { ctrlKey, deltaY, times });
  }

  zoom() {
    return this.wheel({ ctrlKey:true });
  }

  pinch() {
    return this.wheel({ ctrlKey:true, deltaY:2, times:15 });
  }

  async viewWidth() {
    return Number((await this.viewBox()).split(/[\s,]+/)[2]);
  }

  hint() {
    return this.svg.evaluate(svg =>
      svg.querySelector(':scope > title')?.textContent || '');
  }

  touchAction() {
    return this.svg.evaluate(svg => getComputedStyle(svg).touchAction);
  }

  reset() {
    return this.svg.evaluate(svg =>
      svg.dispatchEvent(new MouseEvent('dblclick', { bubbles:true })));
  }

  cursor() {
    return this.svg.evaluate(svg => svg.style.cursor);
  }
}

export class Whiteboards {
  constructor(page) {
    this.page = page;
    this.artifact = page.frameLocator('#art');
    this.editorFrames = this.artifact.locator('[id^="arev-board-"] iframe');
    this.themeToggle = this.artifact.locator('#themeToggle');
    this.byId = new Map();
    this.renderedById = new Map();
  }

  board(id) {
    if (!this.byId.has(id)) this.byId.set(id, new Board(this.page, id));
    return this.byId.get(id);
  }

  rendered(id) {
    if (!this.renderedById.has(id)) {
      this.renderedById.set(id, new RenderedDiagram(this.artifact, id));
    }
    return this.renderedById.get(id);
  }

  node({ diagramId, nodeId }) {
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
