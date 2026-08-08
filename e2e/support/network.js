const SEND = '**/send';
const ARTIFACT_RELOAD = '**/artifact?v=*';

// Handles the two send conditions under test: still in flight, and rejected.
export class Network {
  constructor(page) {
    this.page = page;
    this.routes = [];
    this.artifactReloads = 0;
  }

  async holdSend() {
    let markSeen;
    let release;
    this.sendSeen = new Promise(resolve => { markSeen = resolve; });
    const held = new Promise(resolve => { release = resolve; });
    this.releaseSend = release;
    const handler = async route => {
      markSeen();
      await held;
      await route.continue();
    };
    await this.route(SEND, handler);
  }

  async failSend(status) {
    await this.route(SEND, route => route.fulfill({
      status,
      contentType:'application/json',
      body:JSON.stringify({ error:'synthetic delivery failure' }),
    }));
  }

  // Holds the first reload so a second save lands mid-flight, which is what
  // proves reloads coalesce.
  async holdFirstArtifactReload() {
    let markSeen;
    let release;
    this.firstReloadSeen = new Promise(resolve => { markSeen = resolve; });
    const held = new Promise(resolve => { release = resolve; });
    this.releaseFirstReload = release;
    const handler = async route => {
      this.artifactReloads += 1;
      if (this.artifactReloads !== 1) {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      markSeen();
      await held;
      try {
        await route.fulfill({ response });
      } catch {
        // An implementation that overlaps reloads cancels this route, and the
        // reload count assertion catches it.
      }
    };
    await this.route(ARTIFACT_RELOAD, handler);
  }

  async route(pattern, handler) {
    this.routes.push([pattern, handler]);
    await this.page.route(pattern, handler);
  }

  async clear() {
    this.releaseSend?.();
    this.releaseFirstReload?.();
    for (const [pattern, handler] of this.routes.splice(0)) {
      await this.page.unroute(pattern, handler);
    }
  }
}
