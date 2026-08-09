import fs from 'node:fs';
import path from 'node:path';
import { Given, When, Then, expect } from '../support/bdd.js';
import { ROOT } from '../support/arev.js';
import { pollUntil } from '../support/poll.js';

const EDITOR_CHOICE = '(Keep editing saved scene|Re-convert \\(discard saved edits\\))';

// The fixture's node ids, keyed by the label a reviewer reads on the diagram.
const NODES = {
  'API Service':{ diagramId:'rendered-flow-map', nodeId:'node-api-service' },
};

// The Mermaid dialects the converter must turn into shapes, one sample each.
const DIALECTS = {
  subgraph:'flowchart LR\n  A["one"] --> P\n  subgraph S["box"]\n    P["proc"]\n  end',
  state:'stateDiagram-v2\n  [*] --> queued\n  queued --> active\n  active --> [*]',
  class:'classDiagram\n  class Job {\n    +id\n  }\n  Job <|-- Run',
};

const elements = saved => saved.scene?.elements || [];
const live = saved => elements(saved).filter(element => !element.isDeleted);

// Two versions of the same tiny scene: one shape moved, one label changed, one
// arrow added between them.
async function sceneSummary(boards) {
  boards.summary ||= await boards.page.evaluate(async () => {
    const module = await import('/whiteboard.js');
    const rect = id => ({
      id, type:'rectangle', x:10, y:10, width:100, height:40, isDeleted:false,
    });
    const text = (id, containerId, value) => ({
      id, type:'text', containerId, text:value, x:12, y:14, width:60,
      height:20, isDeleted:false,
    });
    return module.summarizeSceneEdits(
      [rect('a'), text('at', 'a', 'API'), rect('b'), text('bt', 'b', 'Store')],
      [
        { ...rect('a'), x:220 }, text('at', 'a', 'API'),
        rect('b'), text('bt', 'b', 'Cache'),
        {
          id:'arrow1', type:'arrow', x:0, y:0, width:10, height:10, isDeleted:false,
          startBinding:{ elementId:'a' }, endBinding:{ elementId:'b' },
        },
      ]);
  });
  return boards.summary;
}

function unrenderedFindings(arev) {
  return pollUntil(async () => {
    const { audit } = await arev.api('GET', '/state');
    const findings = (audit.findings || []).filter(
      finding => finding.kind === 'mermaid-render-failed');
    return findings.length ? findings : null;
  }, { timeout:20_000 });
}

Given(/^the "([^"]*)" diagram has mounted$/, async ({ boards }, id) => {
  await boards.board(id).mount();
});

Given(/^the reviewer has opened the "([^"]*)" diagram editor$/, async ({ arev, boards }, id) => {
  const board = boards.board(id);
  await board.open();
  board.saved = await arev.savedScene(id, saved => live(saved).length > 0);
});

When(/^the reviewer opens the "([^"]*)" diagram editor$/, async ({ boards }, id) => {
  await boards.board(id).open();
});

When(/^the reviewer reopens the "([^"]*)" diagram editor$/, async ({ boards }, id) => {
  await boards.board(id).reopen();
});

When('the agent adds a cache step to the "request-flow" diagram', async ({ artifact }) => {
  await artifact.replace(
    'API --> Store[(Private scene store)]',
    'API --> Cache[Review cache]\n      Cache --> Store[(Private scene store)]');
});

When('the agent adds a metrics edge to the "request-flow" diagram', async ({ artifact }) => {
  await artifact.replace(
    'Cache --> Store[(Private scene store)]',
    'Cache --> Store[(Private scene store)]\n      Cache -. metrics .-> Agent');
});

When(new RegExp(`^the reviewer chooses "${EDITOR_CHOICE}" in the diagram editor$`),
  async ({ boards }, label) => {
    const board = boards.board('request-flow');
    await board.editor.getByRole('button', { name:label }).click();
    await board.editor.locator('.excalidraw').waitFor({ timeout:20_000 });
  });

When(/^the reviewer clicks the "([^"]*)" diagram node$/, async ({ boards, popover }, label) => {
  await boards.node(NODES[label]).locator.click();
  await expect(popover.root).toBeVisible();
});

When(/^the reviewer draws a rectangle on the "([^"]*)" diagram$/, async ({ boards }, id) => {
  await boards.board(id).drawRectangle();
});

// Exporting the scene and its preview takes longer than a normal draft.
When(/^the reviewer adds the "([^"]*)" diagram edit to the review$/,
  async ({ boards, rail }, id) => {
    await boards.board(id).editor.locator('#wbQueue').click();
    await expect(rail.queueCount).not.toHaveText('0', { timeout:20_000 });
  });

Then(/^the "([^"]*)" diagram rendered offline$/, async ({ boards }, id) => {
  await expect(boards.artifact.locator(`#${id} svg`)).toBeVisible({ timeout:20_000 });
});

Then(/^the "([^"]*)" diagram still shows its Mermaid source$/, async ({ boards }, id) => {
  const block = boards.artifact.locator(`#${id}`);
  await expect(block.locator('svg')).toHaveCount(0);
  await expect(block).toContainText('unbalanced');
});

Then(/^only the "([^"]*)" diagram is reported as unrendered$/, async ({ arev }, id) => {
  arev.unrendered = await unrenderedFindings(arev);
  expect(arev.unrendered.map(finding => finding.selector)).toEqual([`#${id}`]);
});

Then('the unrendered finding is severe and names the diagram', async ({ arev }) => {
  const [finding] = arev.unrendered;
  expect(finding.severity).toBe('severe');
  expect(finding.evidence).toContain('broken');
});

Then('no diagram has mounted an editor frame', async ({ boards }) => {
  await expect(boards.editorFrames).toHaveCount(0);
});

Then(/^only the "([^"]*)" diagram holds the one shared editor frame$/,
  async ({ boards }, id) => {
    const board = boards.board(id);
    await expect(boards.editorFrames).toHaveCount(1);
    await expect(board.frames).toHaveCount(1);
    await expect(board.sharedFrame).toHaveCount(1);
    expect(new URL(board.editor.url()).searchParams.get('diagram')).toBe(id);
  });

Then(/^the "([^"]*)" editor is labelled "([^"]*)"$/, async ({ boards }, id, label) => {
  await expect(boards.board(id).editor.locator('#wbTypeBadge')).toHaveText(label);
});

Then(/^the saved "([^"]*)" scene holds more than (\d+) native shapes$/,
  async ({ arev, boards }, id, least) => {
    const board = boards.board(id);
    board.saved = await arev.savedScene(id, saved => live(saved).length > least);
    const elements = live(board.saved);
    const types = [...new Set(elements.map(element => element.type))];
    expect(elements.length, `${id} element count`).toBeGreaterThan(least);
    expect(types, `${id} shape types`).toContain('text');
    expect(types, `${id} fell back to one image`).not.toEqual(['image']);
  });

Then(/^the "([^"]*)" diagram kept the Mermaid source it was rendered from$/,
  async ({ boards }, id) => {
    const block = boards.artifact.locator(`#${id}`);
    await expect(block).toHaveAttribute('data-fixture-rendered-before-load', 'true');
    const source = await block.getAttribute('data-arev-mermaid-source');
    expect(source).toMatch(/^flowchart LR/);
    expect(live(boards.board(id).saved).some(
      element => element.type === 'text' && /Review API/.test(element.text || ''),
    ), 'a converted shape labelled Review API').toBe(true);
  });

Then('no saved scene repeats an element id', async ({ boards }) => {
  for (const board of boards.saved()) {
    const ids = live(board.saved).map(element => element.id);
    expect(new Set(ids).size, `${board.id} unique element ids`).toBe(ids.length);
  }
});

Then('subgraph, state, and class diagrams convert to native shapes', async ({ page }) => {
  const converted = await page.evaluate(async sources => {
    const module = await import('/whiteboard.js');
    const results = {};
    for (const [name, source] of Object.entries(sources)) {
      const parsed = await module.parseMermaidToExcalidraw(source);
      const elements = module.convertToExcalidrawElements(parsed.elements)
        .filter(element => !element.isDeleted);
      results[name] = {
        count:elements.length,
        image:elements.length === 1 && elements[0].type === 'image',
      };
    }
    return results;
  }, DIALECTS);
  expect(Object.entries(converted).filter(
    ([, result]) => result.image || result.count <= 4,
  )).toEqual([]);
});

Then(/^the bundled Mermaid runtime is pinned to "([^"]*)"$/, async ({}, version) => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  expect(manifest.devDependencies.mermaid).toBe(version);
});

Then(/^the annotation names "([^"]*)"$/, async ({ popover }, label) => {
  await expect(popover.context).toContainText(label);
});

Then(/^the queued diagram-node target names "([^"]*)" and nothing more$/,
  async ({ arev, boards }, label) => {
    const node = boards.node(NODES[label]);
    const target = await pollUntil(async () => {
      const state = await arev.api('GET', '/state');
      return state.queue.find(item => item.target?.type === 'mermaid-node')?.target;
    });
    expect(Object.keys(target).sort())
      .toEqual(['diagramId', 'label', 'nodeId', 'selector', 'type']);
    expect(target.diagramId).toBe(node.diagramId);
    expect(target.nodeId).toBe(node.nodeId);
    expect(target.label).toBe(label);
  });

Then(/^the delivered diagram-node target still names "([^"]*)"$/,
  async ({ arev, boards }, label) => {
    const delivered = arev.lastEvent.items.find(
      item => item.target?.type === 'mermaid-node');
    expect(delivered?.target.nodeId).toBe(boards.node(NODES[label]).nodeId);
  });

Then('the editor offers to keep the saved scene or re-convert it', async ({ boards }) => {
  const { editor } = boards.board('request-flow');
  await expect(editor.getByRole('button', { name:'Keep editing saved scene' })).toBeVisible();
  await expect(
    editor.getByRole('button', { name:'Re-convert (discard saved edits)' })).toBeVisible();
});

Then('the editor says the scene came from an older Mermaid source', async ({ boards }) => {
  await expect(boards.board('request-flow').editor.locator('#wbBanner'))
    .toContainText('older Mermaid source');
});

Then(/^the saved "([^"]*)" scene keeps the hash it was converted from$/,
  async ({ arev, boards }, id) => {
    const kept = await arev.api('GET', `/whiteboard/${id}`);
    expect(kept.saved.source_hash).toBe(boards.board(id).saved.source_hash);
  });

Then(/^the saved "([^"]*)" scene is rebuilt from the latest source$/,
  async ({ arev, boards }, id) => {
    const converted = boards.board(id).saved.source_hash;
    const rebuilt = await arev.savedScene(id, saved => saved.source_hash !== converted);
    expect(rebuilt.source_hash).not.toBe(converted);
    expect(live(rebuilt).length).toBeGreaterThan(0);
  });

Then('a moved, relabeled, and reconnected scene reads as per-element sentences',
  async ({ boards }) => {
    const { lines } = await sceneSummary(boards);
    const missing = [
      /Added arrow .*from rectangle "API" to rectangle "Cache"/,
      /Relabeled rectangle: "Store" is now "Cache"/,
      /rectangle "API" moved by \(210, 0\)/,
    ].filter(wanted => !lines.some(line => wanted.test(line)));
    expect(missing.map(String), `summary lines were ${JSON.stringify(lines)}`).toEqual([]);
  });

Then('the scene diff counts fold bound labels into their containers', async ({ boards }) => {
  const summary = await sceneSummary(boards);
  expect(summary.stats).toMatchObject({ added:1, moved:1, relabeled:1 });
  expect(summary.totalChanges).toBe(3);
});

Then('scene link sanitizing keeps only web and mail links', async ({ page }) => {
  const sanitized = await page.evaluate(async () => {
    const module = await import('/whiteboard.js');
    return {
      script:module.sanitizeSceneLink('javascript:alert(1)'),
      data:module.sanitizeSceneLink('data:text/html,x'),
      web:module.sanitizeSceneLink('https://example.com'),
      mail:module.sanitizeSceneLink('mailto:a@b.c'),
    };
  });
  expect(sanitized).toEqual({
    script:'',
    data:'',
    web:'https://example.com',
    mail:'mailto:a@b.c',
  });
});

Then(/^no hostile link reached the saved "([^"]*)" scene$/, async ({ arev }, id) => {
  const saved = await arev.savedScene(id, entry => elements(entry).length > 0);
  const links = elements(saved).map(element => element.link).filter(Boolean);
  expect(links.length, 'the safe link from the diagram').toBeGreaterThan(0);
  expect(links.filter(link => !/^https?:\/\/|^mailto:/i.test(link))).toEqual([]);
});

Then('the queued whiteboard item summarizes the drawing with no typed note',
  async ({ arev }) => {
    const item = await arev.queuedWhiteboard();
    expect(item.summary).toMatch(/\d+ added/);
    expect(item.summary_lines.filter(line => /^Added rectangle/.test(line)).length,
      `summary lines were ${JSON.stringify(item.summary_lines)}`).toBeGreaterThan(0);
    expect(item.note).toBe('');
  });
