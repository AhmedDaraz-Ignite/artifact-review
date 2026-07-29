import fs from 'node:fs';

export async function waitForInlineDiagram(page) {
  const frame = page.frameLocator('#art');
  // The artifact iframe intentionally has an opaque sandbox origin. Query it
  // through Playwright's frame boundary rather than parent.contentDocument.
  await frame.locator('[id^="arev-board-"] svg').first().waitFor({
    state:'visible',
    timeout:30000,
  });
  return frame;
}

export async function openWhiteboard(page, frame) {
  await frame.getByRole('button', { name:/Expand/i }).first().click();
  await page.waitForSelector('#board .excalidraw', { timeout:30000 });
  await page.locator('#board [data-testid="toolbar-rectangle"]').waitFor({
    state:'attached',
    timeout:30000,
  });
}

export async function drawLargeRectangle(page) {
  const tool = page.locator('#board [data-testid="toolbar-rectangle"]');
  await tool.check({ force:true });
  const canvas = page.locator('#board canvas.excalidraw__canvas.interactive');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('interactive Excalidraw canvas has no bounding box');

  const width = Math.min(180, Math.max(120, box.width * 0.18));
  const height = Math.min(105, Math.max(76, box.height * 0.18));
  const startX = box.x + Math.max(24, box.width - width - 48);
  const startY = box.y + Math.max(96, box.height - height - 44);
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + width, startY + height, { steps:10 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  return { width, height };
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
