import fs from 'node:fs';
import { eventually } from './test-helpers.mjs';

export async function waitForInlineDiagram(page, diagramId) {
  const artifactFrame = page.frameLocator('#art');
  const host = diagramId
    ? artifactFrame.locator(`#arev-board-${diagramId}`)
    : artifactFrame.locator('[id^="arev-board-"]').first();
  await host.locator('iframe').waitFor({ state:'visible', timeout:30000 });
  const resolvedId = diagramId || (await host.getAttribute('id')).slice('arev-board-'.length);
  const editorFrame = await eventually(async () => {
    const candidate = page.frames().find(frame => {
      try {
        const url = new URL(frame.url());
        return url.pathname === '/whiteboard-frame' &&
          url.searchParams.get('diagram') === resolvedId;
      } catch {
        return false;
      }
    });
    if (!candidate) return null;
    return await candidate.locator('.wb-shell').count() ? candidate : null;
  }, { timeout:30000, label:`inline editor frame ${resolvedId}` });
  return { artifactFrame, editorFrame, host, id:resolvedId };
}

export async function unlockWhiteboard(diagram) {
  await diagram.host.scrollIntoViewIfNeeded();
  await diagram.host.getByRole('button', { name:/Click to edit diagram/i }).click();
}

export async function openWhiteboard(page, diagram) {
  await unlockWhiteboard(diagram);
  await diagram.editorFrame.locator('.excalidraw').waitFor({
    state:'visible',
    timeout:30000,
  });
}

export async function drawLargeRectangle(page, diagram) {
  await diagram.host.scrollIntoViewIfNeeded();
  const tool = diagram.editorFrame.locator('[data-testid="toolbar-rectangle"]');
  await diagram.editorFrame.locator('body').press('r');
  if (!(await tool.isChecked())) await tool.check({ force:true });
  const canvas = diagram.editorFrame.locator('canvas.excalidraw__canvas.interactive');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('interactive Excalidraw canvas has no bounding box');

  const width = Math.min(150, Math.max(80, box.width * 0.15));
  const height = Math.min(82, Math.max(48, box.height * 0.28));
  const start = {
    x:Math.max(12, box.width - width - 24),
    y:Math.max(12, box.height - height - 18),
  };
  await canvas.hover({ position:start, force:true });
  await page.mouse.down();
  await canvas.hover({
    position:{ x:start.x + width, y:start.y + height },
    force:true,
  });
  await page.mouse.up();
  const completedAt = Date.now();
  await page.waitForTimeout(200);
  return { width, height, completedAt };
}

export function sceneHasDrawnRectangle(scene, expected) {
  return (scene.elements || []).some(element =>
    !element.isDeleted &&
    element.type === 'rectangle' &&
    element.width >= expected.width * 0.75 &&
    element.height >= expected.height * 0.75
  );
}

export function isPng(path) {
  if (!path || !fs.existsSync(path)) return false;
  const bytes = fs.readFileSync(path);
  return bytes.length > 100 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
}
