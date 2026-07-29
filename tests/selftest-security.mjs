import { chromium } from 'playwright';
import http from 'node:http';
import {
  TestRun,
  openSession,
  stopSession,
} from './test-helpers.mjs';

const ART = process.argv[2];
const test = new TestRun();
const pageErrors = [];
let browser;

function rawRequest(baseUrl, {
  path = '/',
  method = 'GET',
  headers = {},
  body,
} = {}) {
  const base = new URL(baseUrl);
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname:base.hostname,
      port:base.port,
      path,
      method,
      headers,
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({
        status:response.statusCode,
        headers:response.headers,
        body:Buffer.concat(chunks).toString('utf8'),
      }));
    });
    request.on('error', reject);
    if (body !== undefined) request.write(body);
    request.end();
  });
}

try {
  const url = openSession(ART);
  const parsed = new URL(url);
  const origin = parsed.origin;
  const token = parsed.searchParams.get('t');

  const artifact = await rawRequest(origin, { path:'/artifact' });
  const sdk = await rawRequest(origin, { path:'/sdk.js' });
  test.check(
    'artifact and injected SDK are tokenless, host-checked resources',
    artifact.status === 200 &&
      sdk.status === 200 &&
      !artifact.body.includes(token) &&
      !sdk.body.includes(token),
    `artifact=${artifact.status} sdk=${sdk.status}`,
  );
  test.check(
    'injected SDK URL carries no session token',
    /<script[^>]+src="\/sdk\.js"><\/script>/i.test(artifact.body) &&
      !/sdk\.js\?[^"']*t=/i.test(artifact.body),
  );

  const controllerWithoutToken = await rawRequest(origin, { path:'/' });
  const stateWithoutToken = await rawRequest(origin, { path:'/state' });
  const assetWithoutToken = await rawRequest(origin, { path:'/whiteboard.css' });
  const mutationWithoutToken = await rawRequest(origin, {
    path:'/queue',
    method:'POST',
    headers:{ 'Content-Type':'application/json' },
    body:JSON.stringify({ item:{ kind:'chat', text:'must not be queued' } }),
  });
  test.check(
    'controller, state, mutations, and controller assets require a token',
    [controllerWithoutToken, stateWithoutToken, assetWithoutToken, mutationWithoutToken]
      .every(response => response.status === 403),
    [
      controllerWithoutToken.status,
      stateWithoutToken.status,
      assetWithoutToken.status,
      mutationWithoutToken.status,
    ].join(','),
  );

  const badToken = await rawRequest(origin, {
    path:'/state',
    headers:{ 'X-Arev-Token':'not-the-session-token' },
  });
  const goodState = await rawRequest(origin, {
    path:'/state',
    headers:{ 'X-Arev-Token':token },
  });
  const goodAsset = await rawRequest(origin, {
    path:'/whiteboard.css',
    headers:{ 'X-Arev-Token':token },
  });
  test.check(
    'bad token is rejected while valid controller requests succeed',
    badToken.status === 403 && goodState.status === 200 && goodAsset.status === 200,
    `bad=${badToken.status} state=${goodState.status} asset=${goodAsset.status}`,
  );

  const badHostArtifact = await rawRequest(origin, {
    path:'/artifact',
    headers:{ Host:'attacker.invalid' },
  });
  const badHostState = await rawRequest(origin, {
    path:'/state',
    headers:{ Host:'attacker.invalid', 'X-Arev-Token':token },
  });
  test.check(
    'bad Host is rejected even for tokenless resources',
    badHostArtifact.status === 403 && badHostState.status === 403,
    `artifact=${badHostArtifact.status} state=${badHostState.status}`,
  );

  const traversal = await rawRequest(origin, {
    path:'/whiteboard.css/..%2f..%2fscripts%2fserver.py',
    headers:{ 'X-Arev-Token':token },
  });
  test.check(
    'encoded traversal cannot read files outside review assets',
    traversal.status === 404 && !traversal.body.includes('ThreadingHTTPServer'),
    `status=${traversal.status}`,
  );

  browser = await chromium.launch();
  const page = await browser.newPage({ viewport:{ width:1280, height:900 } });
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(url, { waitUntil:'domcontentloaded' });
  await page.locator('#curtain').waitFor({ state:'hidden', timeout:8000 });

  const sandbox = (await page.locator('#art').getAttribute('sandbox') || '')
    .split(/\s+/)
    .filter(Boolean);
  test.check(
    'artifact iframe is script-enabled but has an opaque origin',
    sandbox.includes('allow-scripts') && !sandbox.includes('allow-same-origin'),
    sandbox.join(','),
  );

  const frame = page.frames().find(candidate => new URL(candidate.url()).pathname === '/artifact');
  if (!frame) throw new Error('artifact frame was not found');
  const isolation = await frame.evaluate(sessionToken => {
    let parentReadable = false;
    let parentToken;
    let parentError = '';
    try {
      parentToken = window.parent.AREV?.token;
      parentReadable = true;
    } catch (error) {
      parentError = error.name;
    }
    const markup = document.documentElement.outerHTML;
    const resources = performance.getEntriesByType('resource').map(entry => entry.name);
    return {
      parentReadable,
      parentToken,
      parentError,
      markupHasToken:markup.includes(sessionToken),
      resourceHasToken:resources.some(resource => resource.includes(sessionToken)),
      scriptSources:Array.from(document.scripts, script => script.getAttribute('src') || ''),
      location:location.href,
    };
  }, token);
  test.check(
    'artifact cannot read parent.AREV or its token',
    !isolation.parentReadable &&
      isolation.parentToken === undefined &&
      isolation.parentError === 'SecurityError',
    JSON.stringify(isolation),
  );
  test.check(
    'artifact markup, resource URLs, and location reveal no token',
    !isolation.markupHasToken &&
      !isolation.resourceHasToken &&
      !isolation.location.includes(token) &&
      isolation.scriptSources.every(source => !source.includes(token)),
    JSON.stringify(isolation),
  );

  test.check(
    'security drive has no page errors',
    pageErrors.length === 0,
    pageErrors.join(' | '),
  );
} catch (error) {
  test.check('security drive completed', false, error.stack || error.message);
} finally {
  await browser?.close();
  stopSession(ART);
  test.finish(pageErrors);
}
