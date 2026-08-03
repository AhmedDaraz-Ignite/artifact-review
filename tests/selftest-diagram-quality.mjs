import { chromium } from 'playwright';
import {
  TestRun,
  eventually,
  openSession,
  sessionApi,
  stopSession,
  waitForQueueCount,
} from './test-helpers.mjs';
import {
  drawLargeRectangle,
  openWhiteboard,
  waitForInlineDiagram,
} from './whiteboard-test-helpers.mjs';

const ART = process.argv[2];
const test = new TestRun();
const pageErrors = [];
let browser;

function artifactFrame(page) {
  const frame = page.frames().find(candidate => {
    try {
      return new URL(candidate.url()).pathname === '/artifact';
    } catch {
      return false;
    }
  });
  if (!frame) throw new Error('artifact frame not found');
  return frame;
}

try {
  const url = openSession(ART);
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport:{ width:1540, height:1040 } });
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(url, { waitUntil:'domcontentloaded' });
  await page.locator('#curtain').waitFor({ state:'hidden', timeout:8000 });

  const art = () => artifactFrame(page);
  await eventually(
    () => art().locator('#themed-flow svg').count(),
    { timeout:10000, label:'offline Mermaid render' },
  );

  /* ---------------------------------------------- theme-matched rendering */

  const lightState = await art().evaluate(() => {
    const holder = document.getElementById('themed-flow');
    return {
      theme: holder.getAttribute('data-arev-mermaid-theme'),
      svgId: holder.querySelector('svg')?.id || '',
      html: holder.innerHTML,
      fontFamily: holder.querySelector('svg')?.style.fontFamily ||
        (holder.innerHTML.match(/font-family:([^;"']+)/) || [])[1] || '',
    };
  });
  test.check(
    'offline render reports the light page theme on the holder',
    lightState.theme === 'light',
    String(lightState.theme),
  );
  test.check(
    'diagram typography follows the page font, not the Mermaid default',
    /Georgia/i.test(lightState.html),
  );

  const renderEventArmed = art().evaluate(() => {
    window.__rerenderEvents = 0;
    document.addEventListener('arev:mermaid-rendered', () => {
      window.__rerenderEvents += 1;
    });
  });
  await renderEventArmed;
  await art().locator('#themeToggle').click();

  const darkState = await eventually(async () => {
    const state = await art().evaluate(() => {
      const holder = document.getElementById('themed-flow');
      return {
        theme: holder.getAttribute('data-arev-mermaid-theme'),
        svgId: holder.querySelector('svg')?.id || '',
        html: holder.innerHTML,
        events: window.__rerenderEvents || 0,
      };
    });
    return state.theme === 'dark' ? state : null;
  }, { timeout:10000, label:'dark re-render' });
  test.check(
    'flipping data-theme re-renders the diagram with the dark palette',
    darkState.theme === 'dark' && darkState.svgId !== lightState.svgId,
    `${lightState.svgId} -> ${darkState.svgId}`,
  );
  test.check(
    'the dark render actually restyles the SVG markup',
    darkState.html !== lightState.html,
  );
  test.check(
    're-renders announce themselves so the SDK can re-attach behavior',
    darkState.events >= 1,
    `events=${darkState.events}`,
  );

  /* ------------------------------------- stable node identity across renders */

  const nodeKeys = await art().evaluate(() => {
    const keys = svg =>
      [...svg.querySelectorAll('[data-arev-node-key]')].map(node =>
        node.getAttribute('data-arev-node-key'));
    return {
      flow: keys(document.querySelector('#themed-flow svg')),
      state: keys(document.querySelector('#themed-state svg')),
    };
  });
  test.check(
    'rendered graph nodes carry stable identity keys',
    nodeKeys.flow.length >= 4 && nodeKeys.state.length >= 2,
    JSON.stringify(nodeKeys),
  );
  test.check(
    'node identity keys carry no per-render counter suffix',
    nodeKeys.flow.every(key => !/-\d+$/.test(key)),
    nodeKeys.flow.join(','),
  );

  await art().locator('#themeToggle').click();
  const relitKeys = await eventually(async () => {
    const state = await art().evaluate(() => ({
      theme: document.getElementById('themed-flow')
        .getAttribute('data-arev-mermaid-theme'),
      flow: [...document.querySelectorAll('#themed-flow [data-arev-node-key]')]
        .map(node => node.getAttribute('data-arev-node-key')),
    }));
    return state.theme === 'light' ? state : null;
  }, { timeout:10000, label:'light re-render' });
  test.check(
    'node identity keys survive a theme re-render unchanged',
    JSON.stringify(relitKeys.flow) === JSON.stringify(nodeKeys.flow),
    `${nodeKeys.flow} -> ${relitKeys.flow}`,
  );

  /* ------------------------------------------------- pan/zoom explore mode */

  const beforeZoom = await art().evaluate(() => {
    const svg = document.querySelector('#themed-flow svg');
    return svg.getAttribute('viewBox');
  });
  await art().evaluate(() => {
    const svg = document.querySelector('#themed-flow svg');
    const rect = svg.getBoundingClientRect();
    svg.dispatchEvent(new WheelEvent('wheel', {
      bubbles:true,
      cancelable:true,
      deltaY:-120,
      clientX:rect.left + rect.width / 2,
      clientY:rect.top + rect.height / 2,
    }));
  });
  const afterZoom = await art().evaluate(() =>
    document.querySelector('#themed-flow svg').getAttribute('viewBox'));
  test.check(
    'wheel zoom changes the diagram viewBox in explore mode',
    Boolean(beforeZoom) && afterZoom !== beforeZoom,
    `${beforeZoom} -> ${afterZoom}`,
  );

  await art().evaluate(() => {
    const svg = document.querySelector('#themed-flow svg');
    svg.dispatchEvent(new MouseEvent('dblclick', { bubbles:true }));
  });
  const afterReset = await art().evaluate(() =>
    document.querySelector('#themed-flow svg').getAttribute('viewBox'));
  test.check(
    'double-click resets the explored view',
    afterReset === beforeZoom,
    `${afterZoom} -> ${afterReset}`,
  );

  await page.locator('#annBtn').click();
  await eventually(async () =>
    (await art().evaluate(() =>
      document.querySelector('#themed-flow svg').style.cursor)) !== 'grab',
  { timeout:5000, label:'annotate freeze reaches the artifact frame' });
  await art().evaluate(() => {
    const svg = document.querySelector('#themed-flow svg');
    const rect = svg.getBoundingClientRect();
    svg.dispatchEvent(new WheelEvent('wheel', {
      bubbles:true,
      cancelable:true,
      deltaY:-120,
      clientX:rect.left + rect.width / 2,
      clientY:rect.top + rect.height / 2,
    }));
  });
  const annotateZoom = await art().evaluate(() =>
    document.querySelector('#themed-flow svg').getAttribute('viewBox'));
  test.check(
    'annotate mode freezes pan/zoom so picks stay precise',
    annotateZoom === afterReset,
    `${afterReset} -> ${annotateZoom}`,
  );
  await page.locator('#annBtn').click();

  /* -------------------------------------------- auto whiteboard summaries */

  const summaryUnit = await page.evaluate(async () => {
    const mod = await import('/whiteboard.js');
    const rect = id => ({
      id, type:'rectangle', x:10, y:10, width:100, height:40, isDeleted:false,
    });
    const text = (id, containerId, value) => ({
      id, type:'text', containerId, text:value, x:12, y:14, width:60,
      height:20, isDeleted:false,
    });
    const baseline = [
      rect('a'), text('at', 'a', 'API'),
      rect('b'), text('bt', 'b', 'Store'),
    ];
    const edited = [
      { ...rect('a'), x:220 }, text('at', 'a', 'API'),
      rect('b'), text('bt', 'b', 'Cache'),
      {
        id:'arrow1', type:'arrow', x:0, y:0, width:10, height:10,
        isDeleted:false,
        startBinding:{ elementId:'a' }, endBinding:{ elementId:'b' },
      },
    ];
    return mod.summarizeSceneEdits(baseline, edited);
  });
  test.check(
    'scene diffs read as labeled per-element sentences',
    summaryUnit.lines.some(line =>
      /Added arrow .*from rectangle "API" to rectangle "Cache"/.test(line)) &&
      summaryUnit.lines.some(line =>
        /Relabeled rectangle: "Store" is now "Cache"/.test(line)) &&
      summaryUnit.lines.some(line =>
        /rectangle "API" moved by \(210, 0\)/.test(line)),
    JSON.stringify(summaryUnit.lines),
  );
  test.check(
    'scene diff counts fold bound labels into their containers',
    summaryUnit.stats.added === 1 &&
      summaryUnit.stats.moved === 1 &&
      summaryUnit.stats.relabeled === 1 &&
      summaryUnit.totalChanges === 3,
    JSON.stringify(summaryUnit.stats),
  );

  const linkUnit = await page.evaluate(async () => {
    const mod = await import('/whiteboard.js');
    return {
      hostile: mod.sanitizeSceneLink('javascript:alert(1)'),
      data: mod.sanitizeSceneLink('data:text/html,x'),
      safe: mod.sanitizeSceneLink('https://example.com'),
      mail: mod.sanitizeSceneLink('mailto:a@b.c'),
    };
  });
  test.check(
    'only web and mail links survive scene sanitization',
    linkUnit.hostile === '' && linkUnit.data === '' &&
      linkUnit.safe === 'https://example.com' && linkUnit.mail === 'mailto:a@b.c',
    JSON.stringify(linkUnit),
  );

  const api = sessionApi(url);
  const linksDiagram = await waitForInlineDiagram(page, 'themed-links');
  await openWhiteboard(page, linksDiagram);
  const linksSaved = await eventually(async () => {
    const response = await api('GET', '/whiteboard/themed-links');
    return response.saved && (response.saved.scene?.elements || []).length
      ? response.saved
      : null;
  }, { timeout:15000, label:'links scene autosave' });
  const sceneLinks = (linksSaved.scene.elements || [])
    .map(element => element.link)
    .filter(Boolean);
  test.check(
    'hostile Mermaid click directives never reach the saved scene',
    sceneLinks.every(link => /^https?:\/\/|^mailto:/i.test(link)),
    JSON.stringify(sceneLinks),
  );

  const drawn = await drawLargeRectangle(page, linksDiagram);
  await linksDiagram.editorFrame.locator('#wbQueue').click();
  await waitForQueueCount(page, 1, 20000);
  const queuedWhiteboard = await eventually(async () => {
    const state = await api('GET', '/state');
    return state.queue.find(item => item.kind === 'whiteboard') || null;
  }, { label:'queued whiteboard item' });
  test.check(
    'whiteboard feedback needs no typed note and carries the auto summary',
    /\d+ added/.test(queuedWhiteboard.summary) &&
      Array.isArray(queuedWhiteboard.summary_lines) &&
      queuedWhiteboard.summary_lines.some(line => /^Added rectangle/.test(line)) &&
      queuedWhiteboard.note === '',
    JSON.stringify({
      summary:queuedWhiteboard.summary,
      lines:queuedWhiteboard.summary_lines,
      drawn:{ width:Math.round(drawn.width), height:Math.round(drawn.height) },
    }),
  );

  const unexpectedErrors = pageErrors.filter(message =>
    !/subset-worker|Failed to use workers/.test(message));
  test.check(
    'diagram quality drive has no unexpected page errors',
    unexpectedErrors.length === 0,
    unexpectedErrors.join(' | '),
  );
} catch (error) {
  test.check('diagram quality drive completed', false, error.stack || error.message);
} finally {
  await browser?.close();
  stopSession(ART);
  test.finish(pageErrors);
}
