import { chromium } from 'playwright';
import fs from 'node:fs';
import {
  TestRun,
  chooseAction,
  eventually,
  openSession,
  sessionApi,
  startPoll,
  stopSession,
  waitForQueueCount,
  within,
} from './test-helpers.mjs';
import {
  openWhiteboard,
  unlockWhiteboard,
  waitForInlineDiagram,
} from './whiteboard-test-helpers.mjs';

const ART = process.argv[2];
const test = new TestRun();
const pageErrors = [];
let browser;

async function savedRecord(api, id, predicate = () => true) {
  return eventually(async () => {
    const response = await api('GET', `/whiteboard/${id}`);
    return response.saved && predicate(response.saved) ? response.saved : null;
  }, { timeout:15000, label:`saved scene ${id}` });
}

try {
  const url = openSession(ART);
  const api = sessionApi(url);
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport:{ width:1540, height:1040 } });
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(url, { waitUntil:'domcontentloaded' });
  await page.locator('#curtain').waitFor({ state:'hidden', timeout:8000 });

  const flow = await waitForInlineDiagram(page, 'request-flow');
  const er = await waitForInlineDiagram(page, 'review-er');
  await openWhiteboard(page, flow);
  await openWhiteboard(page, er);

  test.check(
    'two Mermaid sources mount as independent inline editors',
    flow.editorFrame !== er.editorFrame &&
      await flow.host.locator('iframe').count() === 1 &&
      await er.host.locator('iframe').count() === 1,
  );
  test.check(
    'ER diagram is explicitly documented in-product as editable shapes',
    (await er.editorFrame.locator('#wbTypeBadge').textContent()) ===
      'ER diagram · Editable shapes',
  );
  const erSaved = await savedRecord(
    api,
    'review-er',
    saved => (saved.scene?.elements || []).length > 5,
  );
  const flowSaved = await savedRecord(
    api,
    'request-flow',
    saved => (saved.scene?.elements || []).length > 3,
  );
  const erLiveElements = erSaved.scene.elements.filter(element => !element.isDeleted);
  const flowLiveElements = flowSaved.scene.elements.filter(element => !element.isDeleted);
  test.check(
    'ER conversion produces native elements instead of a blank or image fallback',
    erLiveElements.length > 5 &&
      erLiveElements.some(element => element.type === 'text') &&
      !(
        erLiveElements.length === 1 &&
        erLiveElements[0].type === 'image'
      ),
    `elements=${erLiveElements.length} types=${[...new Set(erLiveElements.map(element => element.type))].join(',')}`,
  );
  const capturedFlowSource = await flow.artifactFrame
    .locator('#request-flow')
    .getAttribute('data-arev-mermaid-source');
  test.check(
    'Mermaid source survives render-to-SVG before the review SDK boots',
    await flow.artifactFrame
      .locator('#request-flow')
      .getAttribute('data-fixture-rendered-before-load') === 'true' &&
      /^flowchart LR/.test(capturedFlowSource || '') &&
      flowLiveElements.some(
        element => element.type === 'text' && /Review API/.test(element.text || ''),
      ),
    capturedFlowSource || '',
  );
  const flowIds = flowLiveElements.map(element => element.id);
  const erIds = erLiveElements.map(element => element.id);
  test.check(
    'final converted scenes contain no duplicate Excalidraw element IDs',
    flowIds.length === new Set(flowIds).size &&
      erIds.length === new Set(erIds).size,
    `flow=${flowIds.length}/${new Set(flowIds).size} er=${erIds.length}/${new Set(erIds).size}`,
  );
  const manifest = JSON.parse(
    fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  );
  test.check(
    'Mermaid runtime is exactly pinned for reproducible ER support',
    manifest.devDependencies.mermaid === '11.16.0',
    manifest.devDependencies.mermaid,
  );

  await page.locator('#annBtn').click();
  await flow.artifactFrame.locator('#node-api-service text').click();
  await page.locator('#pop').waitFor({ state:'visible', timeout:5000 });
  test.check(
    'annotation popover identifies the exact rendered Mermaid node',
    /API Service/.test(await page.locator('#popCtx').textContent()),
  );
  await page.locator('#popText').fill('Rename this node to Review Gateway');
  await chooseAction(page, '#popAction', '#popQueue');
  await waitForQueueCount(page, 1, 5000);
  const queuedTarget = await eventually(async () => {
    const state = await api('GET', '/state');
    return state.queue.find(item => item.target?.type === 'mermaid-node')?.target || null;
  }, { label:'queued Mermaid-node target' });
  test.check(
    'Mermaid-node target is fixed-shape and exact',
    JSON.stringify(Object.keys(queuedTarget).sort()) ===
      JSON.stringify(['diagramId', 'label', 'nodeId', 'selector', 'type']) &&
      queuedTarget.diagramId === 'rendered-flow-map' &&
      queuedTarget.nodeId === 'node-api-service' &&
      queuedTarget.label === 'API Service',
    JSON.stringify(queuedTarget),
  );
  await page.locator('#annBtn').click();

  const firstWorking = flowSaved;
  const originalHash = firstWorking.source_hash;
  let source = fs.readFileSync(ART, 'utf8');
  source = source.replace(
    'API --> Store[(Private scene store)]',
    'API --> Cache[Review cache]\n      Cache --> Store[(Private scene store)]',
  );
  fs.writeFileSync(ART, source);

  await eventually(
    () => !page.frames().includes(flow.editorFrame),
    { timeout:15000, label:'first diagram frame reload' },
  );
  const staleFlow = await waitForInlineDiagram(page, 'request-flow');
  await unlockWhiteboard(staleFlow);
  await staleFlow.editorFrame
    .getByRole('button', { name:'Keep editing saved scene' })
    .waitFor({ timeout:15000 });
  test.check(
    'source-hash mismatch presents explicit stale-scene choices',
    await staleFlow.editorFrame
      .getByRole('button', { name:'Re-convert (discard saved edits)' })
      .isVisible() &&
      await staleFlow.editorFrame
        .getByRole('button', { name:'Keep editing saved scene' })
        .isVisible(),
  );
  await staleFlow.editorFrame
    .getByRole('button', { name:'Keep editing saved scene' })
    .click();
  await staleFlow.editorFrame.locator('.excalidraw').waitFor({ timeout:15000 });
  test.check(
    'Keep editing preserves and labels the older saved scene',
    /older Mermaid source/.test(
      await staleFlow.editorFrame.locator('#wbBanner').textContent(),
    ),
  );
  const kept = await api('GET', '/whiteboard/request-flow');
  test.check(
    'keeping a stale scene retains the hash it was converted from',
    kept.saved.source_hash === originalHash,
    kept.saved.source_hash,
  );

  source = fs.readFileSync(ART, 'utf8').replace(
    'Cache --> Store[(Private scene store)]',
    'Cache --> Store[(Private scene store)]\n      Cache -. metrics .-> Agent',
  );
  fs.writeFileSync(ART, source);
  await eventually(
    () => !page.frames().includes(staleFlow.editorFrame),
    { timeout:15000, label:'second diagram frame reload' },
  );
  const reconvertFlow = await waitForInlineDiagram(page, 'request-flow');
  await unlockWhiteboard(reconvertFlow);
  await reconvertFlow.editorFrame
    .getByRole('button', { name:'Re-convert (discard saved edits)' })
    .waitFor({ timeout:15000 });
  await reconvertFlow.editorFrame
    .getByRole('button', { name:'Re-convert (discard saved edits)' })
    .click();
  await reconvertFlow.editorFrame.locator('.excalidraw').waitFor({ timeout:15000 });
  const reconverted = await savedRecord(
    api,
    'request-flow',
    saved => saved.source_hash !== originalHash,
  );
  test.check(
    'Re-convert replaces stale work with the latest source hash',
    reconverted.source_hash !== originalHash &&
      (reconverted.scene?.elements || []).length > 0,
    `${originalHash} -> ${reconverted.source_hash}`,
  );

  const poll = startPoll(ART, 30);
  await chooseAction(page, '#chatAction', '#chatSend');
  const event = await within(poll.result, 10000, 'Mermaid-node delivery');
  const deliveredNode = event.items.find(
    item => item.target?.type === 'mermaid-node',
  );
  test.check(
    'structured Mermaid-node annotation survives durable delivery',
    deliveredNode?.target?.nodeId === 'node-api-service' &&
      deliveredNode?.comment === 'Rename this node to Review Gateway',
    JSON.stringify(deliveredNode || {}),
  );

  const unexpectedErrors = pageErrors.filter(message =>
    !/subset-worker|Failed to use workers/.test(message)
  );
  test.check(
    'diagram feature drive has no unexpected page errors',
    unexpectedErrors.length === 0,
    unexpectedErrors.join(' | '),
  );
} catch (error) {
  test.check('diagram feature drive completed', false, error.stack || error.message);
} finally {
  await browser?.close();
  stopSession(ART);
  test.finish(pageErrors.filter(message =>
    !/subset-worker|Failed to use workers/.test(message)
  ));
}
