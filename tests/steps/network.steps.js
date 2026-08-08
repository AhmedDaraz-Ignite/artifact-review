import { Given, When, expect } from '../support/bdd.js';

Given(/^delivery will fail with (\d+)$/, async ({ network }, status) => {
  await network.failSend(status);
});

Given('delivery is held in flight', async ({ network }) => {
  await network.holdSend();
});

Given('the first artifact reload is held open', async ({ network }) => {
  await network.holdFirstArtifactReload();
});

When('delivery is released', async ({ network }) => {
  await network.sendSeen;
  network.releaseSend();
});

When('delivery starts working again', async ({ network }) => {
  await network.clear();
});

When('the first artifact reload is in flight', async ({ network }) => {
  await network.firstReloadSeen;
});

When('the held artifact reload is released', async ({ network }) => {
  network.releaseFirstReload();
});
