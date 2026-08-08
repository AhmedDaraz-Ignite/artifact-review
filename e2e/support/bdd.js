import { expect } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test as base, createBdd } from 'playwright-bdd';
import { AnnotationPopover } from './annotation-popover.js';
import { Arev, ROOT } from './arev.js';
import { Network } from './network.js';
import { ReviewRail } from './review-rail.js';

// Chromium logs these while loading bundled fonts, so they are not review bugs.
const BENIGN_PAGE_ERRORS = /subset-worker|Failed to use workers/;

export const test = base.extend({
  // Each worker gets its own state root so the shared registry never contends.
  arevHome:[async ({}, use, workerInfo) => {
    const home = await fs.mkdtemp(
      path.join(os.tmpdir(), `arev-home-${workerInfo.workerIndex}-`));
    await use(home);
    await fs.rm(home, { recursive:true, force:true });
  }, { scope:'worker' }],

  // One real path per scenario, because one path owns one live session.
  artifact:async ({}, use) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'arev-artifact-'));
    const file = path.join(dir, 'artifact.html');
    const handle = {
      path:file,
      // Snapshot the source so a later step can prove nothing rewrote it.
      async from(name) {
        await fs.copyFile(path.join(ROOT, 'tests/fixtures', name), file);
        handle.original = await fs.readFile(file, 'utf8');
      },
      append:html => fs.appendFile(file, html),
      read:() => fs.readFile(file, 'utf8'),
      original:'',
    };
    await use(handle);
    await fs.rm(dir, { recursive:true, force:true });
  },

  arev:async ({ arevHome, artifact }, use) => {
    const arev = new Arev({ home:arevHome, artifact:artifact.path });
    await use(arev);
    await arev.stop();
  },

  rail:async ({ page }, use) => {
    await use(new ReviewRail(page));
  },

  popover:async ({ page }, use) => {
    await use(new AnnotationPopover(page));
  },

  network:async ({ page }, use) => {
    const network = new Network(page);
    await use(network);
    await network.clear();
  },

  // Ending a review opens a confirm dialog that must be accepted, or it cancels.
  dialogs:[async ({ page }, use) => {
    const asked = [];
    page.on('dialog', dialog => {
      asked.push(dialog.message());
      dialog.accept();
    });
    await use(asked);
  }, { auto:true }],

  pageErrors:[async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await use(errors);
    const unexpected = errors.filter(message => !BENIGN_PAGE_ERRORS.test(message));
    expect(unexpected, 'unexpected page errors').toEqual([]);
  }, { auto:true }],
});

export const { Given, When, Then, Before, After } = createBdd(test);
export { expect };
