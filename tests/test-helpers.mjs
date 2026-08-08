import { execFileSync, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const AREV = path.join(ROOT, 'skills/artifact-review/scripts/arev.py');
export const PYTHON = process.env.PYTHON || 'python3';

export class TestRun {
  constructor() {
    this.failures = [];
  }

  check(name, ok, detail = '') {
    const line = `${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`;
    console.log(line);
    if (!ok) this.failures.push(line);
    return ok;
  }

  finish(pageErrors = []) {
    console.log(`pageerrors: ${pageErrors.join(' | ') || 'none'}`);
    if (this.failures.length) process.exitCode = 1;
  }
}

function runArev(args, options = {}) {
  return execFileSync(PYTHON, [AREV, ...args], {
    encoding: 'utf8',
    ...options,
  });
}

export function openSession(artifact, extraArgs = []) {
  const output = runArev(['open', artifact, '--no-browser', ...extraArgs]);
  const match = output.match(/SESSION (\S+)/);
  if (!match) throw new Error(`arev did not print a session URL: ${output}`);
  return match[1];
}

export function stopSession(artifact) {
  try {
    runArev(['stop', artifact], { stdio: 'ignore' });
  } catch {
    // The suite-wide trap is the final cleanup fallback.
  }
}

export function startPoll(artifact, timeoutSeconds = 30) {
  const child = spawn(
    PYTHON,
    [AREV, 'poll', artifact, '--timeout', String(timeoutSeconds)],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const result = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', code => {
      if (code !== 0) {
        reject(new Error(`arev poll exited ${code}: ${stderr || stdout}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(new Error(`arev poll returned invalid JSON: ${stdout || stderr}`, { cause:error }));
      }
    });
  });
  return { child, result };
}

export async function within(promise, milliseconds, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} exceeded ${milliseconds}ms`)),
          milliseconds,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function eventually(probe, {
  timeout = 8000,
  interval = 100,
  label = 'condition',
} = {}) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await probe();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  throw new Error(`${label} did not become true within ${timeout}ms`, { cause:lastError });
}

export function sessionApi(url) {
  const parsed = new URL(url);
  const origin = parsed.origin;
  const headers = {
    'X-Arev-Token': parsed.searchParams.get('t'),
    'Content-Type': 'application/json',
  };
  return async (method, endpoint, body) => {
    const response = await fetch(origin + endpoint, {
      method,
      headers,
      body:body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) {
      const error = new Error(data.error || `request failed (${response.status})`);
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  };
}

export async function waitForQueueCount(page, expected, timeout = 5000) {
  await page.waitForFunction(
    value => Number(document.getElementById('qCount')?.textContent) === value,
    expected,
    { timeout },
  );
}

export async function chooseAction(page, trigger, item) {
  await page.locator(trigger).click();
  await page.locator(item).click();
}
