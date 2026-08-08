import fs from 'node:fs';
import path from 'node:path';
import { Given, When, Then, expect } from '../support/bdd.js';
import { ROOT } from '../support/arev.js';

const EDITOR_CHOICE = '(Keep editing saved scene|Re-convert \\(discard saved edits\\))';

// The Mermaid dialects the converter must turn into shapes, one sample each.
const DIALECTS = {
  subgraph:'flowchart LR\n  A["one"] --> P\n  subgraph S["box"]\n    P["proc"]\n  end',
  state:'stateDiagram-v2\n  [*] --> queued\n  queued --> active\n  active --> [*]',
  class:'classDiagram\n  class Job {\n    +id\n  }\n  Job <|-- Run',
};

const live = saved => (saved.scene?.elements || []).filter(element => !element.isDeleted);

async function savedScene(arev, id, ready = () => true) {
  let saved = null;
  await expect.poll(async () => {
    saved = (await arev.api('GET', `/whiteboard/${id}`)).saved;
    return Boolean(saved && ready(saved));
  }, { timeout:20_000 }).toBe(true);
  return saved;
}

async function unrenderedFindings(arev) {
  let findings = [];
  await expect.poll(async () => {
    const { audit } = await arev.api('GET', '/state');
    findings = (audit.findings || []).filter(
      finding => finding.kind === 'mermaid-render-failed');
    return findings.length;
  }, { timeout:20_000 }).toBeGreaterThan(0);
  return findings;
}

Given(/^the "([^"]*)" diagram has mounted$/, async ({ boards }, id) => {
  await boards.board(id).mount();
});

Given(/^the reviewer has opened the "([^"]*)" diagram editor$/, async ({ arev, boards }, id) => {
  const board = boards.board(id);
  await board.open();
  board.saved = await savedScene(arev, id, saved => live(saved).length > 0);
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
  await boards.node(label).locator.click();
  await expect(popover.root).toBeVisible();
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
    board.saved = await savedScene(arev, id, saved => live(saved).length > least);
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
    const node = boards.node(label);
    let target = null;
    await expect.poll(async () => {
      const state = await arev.api('GET', '/state');
      target = state.queue.find(item => item.target?.type === 'mermaid-node')?.target;
      return Boolean(target);
    }).toBe(true);
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
    expect(delivered?.target.nodeId).toBe(boards.node(label).nodeId);
  });

Then('the editor offers to keep the saved scene or re-convert it', async ({ boards }) => {
  const editor = boards.board('request-flow').editor;
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
    const board = boards.board(id);
    const rebuilt = await savedScene(
      arev, id, saved => saved.source_hash !== board.saved.source_hash);
    expect(rebuilt.source_hash).not.toBe(board.saved.source_hash);
    expect(live(rebuilt).length).toBeGreaterThan(0);
  });
