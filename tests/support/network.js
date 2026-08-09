const SEND = '**/send';
const ARTIFACT_RELOAD = '**/artifact?v=*';
const HEAVY_ASSETS = ['/whiteboard-frame', '/whiteboard.js', '/whiteboard.css'];
const WHITEBOARD_PATH = /whiteboard(?:-frame)?(?:\.js|\.css)?/;
const SCENE_SAVE = /\/whiteboard\/[^/?]+(?:\?|$)/;

// Handles the two send conditions under test: still in flight, and rejected.
export class Network {
  constructor(page) {
    this.page = page;
    this.artifactReloads = 0;
    this.heavyAssets = [];
    this.sceneSaves = [];
    this.whiteboardAssets = [];
    this.external = [];
  }

  watchWhiteboard() {
    this.page.on('request', request => {
      const { pathname } = new URL(request.url());
      if (HEAVY_ASSETS.includes(pathname)) this.heavyAssets.push(pathname);
      if (request.method() === 'PUT' && SCENE_SAVE.test(request.url())) {
        this.sceneSaves.push(Date.now());
      }
    });
  }

  // Allows requests only to the review server under test.
  async cutOffEverythingBut(origin) {
    const reachable = url =>
      url.origin === origin || url.protocol === 'data:' || url.protocol === 'blob:';
    const context = this.page.context();
    context.on('request', request => {
      const url = new URL(request.url());
      if (url.origin === origin) {
        if (WHITEBOARD_PATH.test(url.pathname)) this.whiteboardAssets.push(url.href);
      } else if (!reachable(url)) {
        this.external.push(url.href);
      }
    });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (reachable(url)) {
        route.continue();
        return;
      }
      this.external.push(url.href);
      route.abort('internetdisconnected');
    });
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
    await this.page.context().unrouteAll({ behavior:'ignoreErrors' });
  }
}
