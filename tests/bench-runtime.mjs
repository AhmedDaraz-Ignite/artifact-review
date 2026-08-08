import { chromium } from 'playwright';
import {
  openSession,
  stopSession,
} from './legacy-drives/test-helpers.mjs';
import {
  openWhiteboard,
  waitForInlineDiagram,
} from './legacy-drives/whiteboard-test-helpers.mjs';

const artifact = process.argv[2];
if (!artifact) throw new Error('usage: node tests/bench-runtime.mjs ARTIFACT');

let browser;
const responses = [];
const startedAt = performance.now();

try {
  const url = openSession(artifact);
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport:{ width:1440, height:950 } });
  page.on('response', response => {
    const headers = response.headers();
    const parsed = new URL(response.url());
    responses.push({
      path:parsed.pathname,
      bytes:Number(headers['content-length'] || 0),
      encoding:headers['content-encoding'] || 'identity',
    });
  });

  await page.goto(url, { waitUntil:'domcontentloaded' });
  await page.locator('#curtain').waitFor({ state:'hidden', timeout:8000 });
  const diagram = await waitForInlineDiagram(page);
  const readyAt = performance.now();
  const beforeActivation = responses.slice();
  const heavyPaths = new Set(['/whiteboard-frame', '/whiteboard.js', '/whiteboard.css']);

  await openWhiteboard(page, diagram);
  await page.waitForTimeout(100);
  const afterActivation = responses.slice(beforeActivation.length);
  const whiteboardResponses = afterActivation.filter(item => heavyPaths.has(item.path));
  const frameCount = page.frames().filter(frame => {
    try {
      return new URL(frame.url()).pathname === '/whiteboard-frame';
    } catch {
      return false;
    }
  }).length;

  console.log(JSON.stringify({
    controller_ready_ms:Number((readyAt - startedAt).toFixed(1)),
    initial_request_count:beforeActivation.length,
    initial_transfer_bytes:beforeActivation.reduce((sum, item) => sum + item.bytes, 0),
    pre_activation_whiteboard_requests:beforeActivation.filter(
      item => heavyPaths.has(item.path),
    ).length,
    post_activation_frame_count:frameCount,
    whiteboard_transfer_bytes:whiteboardResponses.reduce(
      (sum, item) => sum + item.bytes,
      0,
    ),
    whiteboard_encodings:[...new Set(whiteboardResponses.map(item => item.encoding))],
  }));
} finally {
  await browser?.close();
  stopSession(artifact);
}
