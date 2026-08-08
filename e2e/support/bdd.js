import { expect } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test as base, createBdd } from 'playwright-bdd';
import { Arev, ROOT } from './arev.js';
import { ReviewRail } from './review-rail.js';

// Chromium reports these while loading bundled fonts. They are not review bugs.
const BENIGN_PAGE_ERRORS = /subset-worker|Failed to use workers/;

export const test = base.extend({
  // One arev state root per worker. The registry and its lock file live here,
  // so a private root keeps parallel workers apart.
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
    await use({
      path:file,
      from:name => fs.copyFile(path.join(ROOT, 'tests/fixtures', name), file),
      append:html => fs.appendFile(file, html),
      read:() => fs.readFile(file, 'utf8'),
    });
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
