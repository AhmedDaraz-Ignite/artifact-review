import { expect } from '@playwright/test';
import { pollUntil } from './poll.js';

const OPEN_EDITOR = /edit diagram/i;

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
    this.restingControl = null;
  }

  // Everything a scenario needs to judge the resting control: its shape,
  // whether it shows words, and the outline that answers a pointer.
  activationMetrics() {
    return this.activation.evaluate(node => {
      const style = getComputedStyle(node);
      const box = node.getBoundingClientRect();
      return {
        width:Math.round(box.width),
        height:Math.round(box.height),
        bottom:box.bottom,
        borderWidth:parseFloat(style.borderTopWidth),
        borderColor:style.borderTopColor,
        // What a reader actually sees. The mounted overlay's wording stays in
        // the DOM while the icon shows, so textContent would always find it.
        text:node.innerText.trim(),
      };
    });
  }

  diagramTop() {
    return this.source.evaluate(node => node.getBoundingClientRect().top);
  }

  get canvas() {
    return this.editor.locator('canvas.excalidraw__canvas.interactive');
  }

  // The editor's reduced chrome. The frame owns the rail and fit; the rest are
  // Excalidraw's own controls, kept here so a scenario never names a selector.
  // Fit reuses the rail's box, so exclude it to name the rail proper.
  get modeRail() { return this.editor.locator('.wb-mode-rail:not(.wb-mode-rail--fit)') }
  get lockMode() { return this.editor.locator('#wbLock') }
  get panMode() { return this.editor.locator('#wbHand') }
  get fitControl() { return this.editor.locator('#wbFit') }
  get sceneMenu() { return this.editor.locator('[data-testid="main-menu-trigger"]') }
  // The label, not the inner trigger: hiding only the trigger leaves the
  // checkbox inside it live and focusable.
  get shapeLibrary() { return this.editor.locator('.sidebar-trigger__label-element') }
  get libraryToggle() { return this.editor.getByRole('checkbox', { name:'Library' }) }
  get helpControl() { return this.editor.locator('.help-icon') }
  get toolStrip() { return this.editor.locator('.App-toolbar') }
  get toolStripLock() { return this.toolStrip.locator('[data-testid="toolbar-lock"]') }
  get toolStripPan() { return this.toolStrip.locator('[data-testid="toolbar-hand"]') }
  get undoControl() { return this.editor.locator('[data-testid="button-undo"]') }
  get zoomControls() { return this.editor.locator('.zoom-actions') }

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

  // Moving a shape is what makes Excalidraw re-derive every endpoint bound to
  // it, so this is the action that shows a wrong binding. The scene's own
  // scroll and zoom turn the saved coordinates into canvas ones.
  async dragShape(element, appState) {
    await this.host.scrollIntoViewIfNeeded();
    const canvas = this.canvas;
    if (!await canvas.boundingBox()) {
      throw new Error('the Excalidraw canvas has no bounding box');
    }
    const box = await canvas.boundingBox();
    const zoom = appState.zoom?.value || 1;
    const x = box.x + (element.x + element.width / 2 + appState.scrollX) * zoom;
    const y = box.y + (element.y + element.height / 2 + appState.scrollY) * zoom;
    // Excalidraw re-derives bound endpoints as the pointer moves, so the drag
    // has to arrive as many small steps rather than one jump.
    await this.page.mouse.move(x, y);
    await this.page.mouse.down();
    for (let step = 1; step <= 12; step += 1) {
      await this.page.mouse.move(x + step * 3, y + step, { steps:1 });
      await this.page.waitForTimeout(16);
    }
    await this.page.mouse.up();
    await this.page.waitForTimeout(200);
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

  // Every pair of transition labels whose painted chips share a pixel, and the
  // labels they were found among. A covered label cannot be read, so a
  // readable diagram reports no pairs. The count keeps "no pairs" from also
  // meaning "no labels".
  labelOverlaps() {
    return this.holder.evaluate(element => {
      const labels = [...element.querySelectorAll('g.edgeLabel')]
        .map(label => ({
          text:label.textContent.trim(),
          ...label.getBoundingClientRect().toJSON(),
        }))
        .filter(label => label.text && label.width > 0);
      const pairs = [];
      for (let i = 0; i < labels.length; i++) {
        for (let j = i + 1; j < labels.length; j++) {
          const a = labels[i], b = labels[j];
          const shared = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const stacked = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (shared > 0 && stacked > 0) pairs.push(`"${a.text}" over "${b.text}"`);
        }
      }
      return { count:labels.length, pairs };
    });
  }

  reveal() {
    return this.holder.evaluate(element => {
      element.closest('.diagram-wrap').style.display = '';
    });
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
