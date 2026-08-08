import { execFile, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const AREV = path.join(ROOT, 'skills/artifact-review/scripts/arev.py');
export const PYTHON = process.env.PYTHON || 'python3';

export class Arev {
  constructor({ home, artifact }) {
    this.artifact = artifact;
    this.env = { ...process.env, ARTIFACT_REVIEW_HOME:home };
    this.polls = new Set();
    this.stopping = false;
    this.sessionUrl = null;
    this.lastEvent = null;
  }

  run(args) {
    return execFileAsync(PYTHON, [AREV, ...args], { env:this.env, encoding:'utf8' });
  }

  async open(extraArgs = []) {
    const { stdout } = await this.run(['open', this.artifact, '--no-browser', ...extraArgs]);
    const match = stdout.match(/SESSION (\S+)/);
    if (!match) throw new Error(`arev open printed no session URL: ${stdout}`);
    this.sessionUrl = match[1];
    return this.sessionUrl;
  }

  reply(text) {
    return this.run(['reply', this.artifact, text]);
  }

  // Feedback stays durable until acknowledged, so polling after the act still gets it.
  poll(timeoutSeconds = 30) {
    const child = spawn(
      PYTHON,
      [AREV, 'poll', this.artifact, '--timeout', String(timeoutSeconds)],
      { env:this.env, stdio:['ignore', 'pipe', 'pipe'] },
    );
    this.polls.add(child);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    return new Promise((resolve, reject) => {
      child.on('error', reject);
      child.on('exit', code => {
        this.polls.delete(child);
        if (this.stopping) {
          resolve(null);
          return;
        }
        if (code !== 0) {
          reject(new Error(`arev poll exited ${code}: ${stderr || stdout}`));
          return;
        }
        try {
          this.lastEvent = JSON.parse(stdout);
          resolve(this.lastEvent);
        } catch (cause) {
          reject(new Error(`arev poll returned invalid JSON: ${stdout || stderr}`, { cause }));
        }
      });
    });
  }

  async api(method, endpoint, body) {
    if (!this.sessionUrl) throw new Error('no session is open');
    const url = new URL(this.sessionUrl);
    const response = await fetch(url.origin + endpoint, {
      method,
      headers:{
        'X-Arev-Token':url.searchParams.get('t'),
        'Content-Type':'application/json',
      },
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
  }

  async stop() {
    this.stopping = true;
    for (const child of this.polls) child.kill('SIGKILL');
    this.polls.clear();
    if (!this.sessionUrl) return;
    try {
      await this.run(['stop', this.artifact]);
    } catch {
      // A scenario that already ended its session leaves nothing to stop.
    }
  }
}
