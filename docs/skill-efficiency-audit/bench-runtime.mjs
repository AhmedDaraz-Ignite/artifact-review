// Measures what the review page costs to open and what a whiteboard adds.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const AREV = path.join(ROOT, 'skills/artifact-review/scripts/arev.py');
const PYTHON = process.env.PYTHON || 'python3';
const HEAVY_PATHS = new Set(['/whiteboard-frame', '/whiteboard.js', '/whiteboard.css']);

const artifact = process.argv[2];
if (!artifact) {
  throw new Error('usage: node docs/skill-efficiency-audit/bench-runtime.mjs ARTIFACT');
}

function openSession() {
  const output = execFileSync(
    PYTHON, [AREV, 'open', artifact, '--no-browser'], { encoding:'utf8' });
  const match = output.match(/SESSION (\S+)/);
  if (!match) throw new Error(`arev did not print a session URL: ${output}`);
  return match[1];
}

function stopSession() {
  try {
    execFileSync(PYTHON, [AREV, 'stop', artifact], { stdio:'ignore' });
  } catch {
    // A session that already stopped leaves nothing to stop.
  }
}

function whiteboardFrames(page) {
  return page.frames().filter(frame => {
    try {
      return new URL(frame.url()).pathname === '/whiteboard-frame';
    } catch {
      return false;
    }
  });
}

async function waitUntil(probe, label, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`${label} did not happen within ${timeout}ms`);
}

async function mountDiagram(page) {
  const host = page.frameLocator('#art').locator('[id^="arev-board-"]').first();
  await host.waitFor({ state:'visible', timeout:30000 });
  return host;
}

async function openWhiteboard(page, host) {
  await host.scrollIntoViewIfNeeded();
  await host.getByRole('button', {
    name:/Open diagram editor|Click to edit diagram/i,
  }).click();
  await host.locator('iframe').waitFor({ state:'visible', timeout:30000 });
  const editor = await waitUntil(async () => {
    const [frame] = whiteboardFrames(page);
    return frame && await frame.locator('.wb-shell').count() ? frame : null;
  }, 'the inline editor frame');
  await editor.locator('.excalidraw').waitFor({ state:'visible', timeout:30000 });
}

let browser;
const responses = [];
const startedAt = performance.now();

try {
  const url = openSession();
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport:{ width:1440, height:950 } });
  page.on('response', response => {
    const headers = response.headers();
    responses.push({
      path:new URL(response.url()).pathname,
      bytes:Number(headers['content-length'] || 0),
      encoding:headers['content-encoding'] || 'identity',
    });
  });

  await page.goto(url, { waitUntil:'domcontentloaded' });
  await page.locator('#curtain').waitFor({ state:'hidden', timeout:8000 });
  const host = await mountDiagram(page);
  const readyAt = performance.now();
  const beforeActivation = responses.slice();

  await openWhiteboard(page, host);
  await page.waitForTimeout(100);
  const afterActivation = responses.slice(beforeActivation.length);
  const whiteboardResponses = afterActivation.filter(item => HEAVY_PATHS.has(item.path));

  console.log(JSON.stringify({
    controller_ready_ms:Number((readyAt - startedAt).toFixed(1)),
    initial_request_count:beforeActivation.length,
    initial_transfer_bytes:beforeActivation.reduce((sum, item) => sum + item.bytes, 0),
    pre_activation_whiteboard_requests:beforeActivation.filter(
      item => HEAVY_PATHS.has(item.path),
    ).length,
    post_activation_frame_count:whiteboardFrames(page).length,
    whiteboard_transfer_bytes:whiteboardResponses.reduce(
      (sum, item) => sum + item.bytes,
      0,
    ),
    whiteboard_encodings:[...new Set(whiteboardResponses.map(item => item.encoding))],
  }));
} finally {
  await browser?.close();
  stopSession();
}
