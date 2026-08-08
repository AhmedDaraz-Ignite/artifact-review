const SEND = '**/send';
const ARTIFACT_RELOAD = '**/artifact?v=*';

// Handles the two send conditions under test: still in flight, and rejected.
export class Network {
  constructor(page) {
    this.page = page;
    this.artifactReloads = 0;
  }

  async holdSend() {
    const seen = Promise.withResolvers();
    const held = Promise.withResolvers();
    this.sendSeen = seen.promise;
    this.releaseSend = held.resolve;
    await this.page.route(SEND, async route => {
      seen.resolve();
      await held.promise;
      await route.continue();
    });
  }

  async failSend(status) {
    await this.page.route(SEND, route => route.fulfill({
      status,
      contentType:'application/json',
      body:JSON.stringify({ error:'synthetic delivery failure' }),
    }));
  }

  // Holds the first reload so a second save lands mid-flight, which is what
  // proves reloads coalesce.
  async holdFirstArtifactReload() {
    const seen = Promise.withResolvers();
    const held = Promise.withResolvers();
    this.firstReloadSeen = seen.promise;
    this.releaseFirstReload = held.resolve;
    await this.page.route(ARTIFACT_RELOAD, async route => {
      this.artifactReloads += 1;
      if (this.artifactReloads !== 1) {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      seen.resolve();
      await held.promise;
      try {
        await route.fulfill({ response });
      } catch {
        // An implementation that overlaps reloads cancels this route, and the
        // reload count assertion catches it.
      }
    });
  }

  async clear() {
    this.releaseSend?.();
    this.releaseFirstReload?.();
    await this.page.unrouteAll({ behavior:'ignoreErrors' });
  }
}
