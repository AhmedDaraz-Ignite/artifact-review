import { Then, expect } from '../support/bdd.js';
import { rawRequest } from '../support/raw-http.js';

const DRAFT_BODY = JSON.stringify({ item:{ kind:'chat', text:'must not queue' } });

const tokened = (arev, path, headers = {}) =>
  rawRequest(arev.origin, { path, headers:{ 'X-Arev-Token':arev.token, ...headers } });

Then('these tokenless requests are refused:', async ({ arev }, table) => {
  for (const [method, endpoint] of table.raw()) {
    const posting = method === 'POST';
    const response = await rawRequest(arev.origin, {
      path:endpoint,
      method,
      headers:posting ? { 'Content-Type':'application/json' } : {},
      body:posting ? DRAFT_BODY : undefined,
    });
    expect(response.status, `${method} ${endpoint}`).toBe(403);
  }
});

Then('these tokenless requests succeed and leak no token:', async ({ arev }, table) => {
  for (const [endpoint] of table.raw()) {
    const response = await rawRequest(arev.origin, { path:endpoint });
    expect(response.status, endpoint).toBe(200);
    expect(response.body.includes(arev.token), `${endpoint} body`).toBe(false);
  }
});

Then('these tokenless requests are cross-origin readable assets:', async ({ arev }, table) => {
  for (const [endpoint] of table.raw()) {
    const response = await rawRequest(arev.origin, { path:endpoint });
    expect(response.status, endpoint).toBe(200);
    expect(response.headers['access-control-allow-origin'], endpoint).toBe('*');
    expect(response.body.includes(arev.token), `${endpoint} body`).toBe(false);
  }
});

Then('the artifact injects the SDK from a hashed URL with no token', async ({ arev }) => {
  const { body } = await rawRequest(arev.origin, { path:'/artifact' });
  expect(body).toMatch(/<script[^>]+src="\/sdk\.js\?v=[a-f0-9]{64}"><\/script>/i);
  expect(body).not.toMatch(/sdk\.js\?[^"']*t=/i);
});

Then(/^a request to "([^"]*)" with a wrong token is refused$/, async ({ arev }, endpoint) => {
  const response = await rawRequest(arev.origin, {
    path:endpoint,
    headers:{ 'X-Arev-Token':'not-the-session-token' },
  });
  expect(response.status).toBe(403);
});

Then('these requests with the session token succeed:', async ({ arev }, table) => {
  for (const [endpoint] of table.raw()) {
    const response = await tokened(arev, endpoint);
    expect(response.status, endpoint).toBe(200);
  }
});

Then('the review state grants no cross-origin access', async ({ arev }) => {
  const response = await tokened(arev, '/state');
  expect(response.headers['access-control-allow-origin']).toBeUndefined();
});

Then(/^a request to "([^"]*)" from another host is refused$/, async ({ arev }, endpoint) => {
  const response = await rawRequest(arev.origin, {
    path:endpoint,
    headers:{ Host:'attacker.invalid' },
  });
  expect(response.status).toBe(403);
});

Then(/^a tokened request to "([^"]*)" from another host is refused$/,
  async ({ arev }, endpoint) => {
    const response = await tokened(arev, endpoint, { Host:'attacker.invalid' });
    expect(response.status).toBe(403);
  });

Then(/^requesting "([^"]*)" with the session token returns (\d+)$/,
  async ({ arev }, endpoint, status) => {
    const response = await tokened(arev, endpoint);
    expect(response.status).toBe(status);
    arev.lastRawBody = response.body;
  });

Then(/^that response does not contain "([^"]*)"$/, async ({ arev }, needle) => {
  expect(arev.lastRawBody).not.toContain(needle);
});

Then('the artifact frame runs scripts in an opaque origin', async ({ page }) => {
  const sandbox = (await page.locator('#art').getAttribute('sandbox') || '').split(/\s+/);
  expect(sandbox).toContain('allow-scripts');
  expect(sandbox).not.toContain('allow-same-origin');
});

Then('the artifact cannot read the parent review window', async ({ page, arev }) => {
  const frame = page.frames()
    .find(candidate => new URL(candidate.url()).pathname === '/artifact');
  expect(frame, 'artifact frame').toBeTruthy();
  const isolation = await frame.evaluate(token => {
    let readable = false;
    let parentToken;
    let errorName = '';
    try {
      parentToken = window.parent.AREV?.token;
      readable = true;
    } catch (error) {
      errorName = error.name;
    }
    const resources = performance.getEntriesByType('resource').map(entry => entry.name);
    return {
      readable,
      parentToken,
      errorName,
      markupHasToken:document.documentElement.outerHTML.includes(token),
      resourceHasToken:resources.some(resource => resource.includes(token)),
      locationHasToken:location.href.includes(token),
      scriptHasToken:Array.from(document.scripts)
        .some(script => (script.getAttribute('src') || '').includes(token)),
    };
  }, arev.token);
  expect(isolation).toEqual({
    readable:false,
    parentToken:undefined,
    errorName:'SecurityError',
    markupHasToken:false,
    resourceHasToken:false,
    locationHasToken:false,
    scriptHasToken:false,
  });
});
