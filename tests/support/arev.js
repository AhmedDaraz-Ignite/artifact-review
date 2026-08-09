import { expect } from '@playwright/test';
import { execFile } from 'node:child_process';
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
    this.sessionUrl = null;
    this.lastEvent = null;
  }

  run(args) {
    return execFileAsync(PYTHON, [AREV, ...args], { env:this.env, encoding:'utf8' });
  }

  async open() {
    const { stdout } = await this.run(['open', this.artifact, '--no-browser']);
    const match = stdout.match(/SESSION (\S+)/);
    if (!match) throw new Error(`arev open printed no session URL: ${stdout}`);
    this.sessionUrl = match[1];
  }

  get origin() {
    return new URL(this.sessionUrl).origin;
  }

  get token() {
    return new URL(this.sessionUrl).searchParams.get('t');
  }

  reply(text) {
    return this.run(['reply', this.artifact, text]);
  }

  // Feedback stays durable until acknowledged, so polling after the act still gets it.
  poll(timeoutSeconds = 30) {
    const pending = this.run(['poll', this.artifact, '--timeout', String(timeoutSeconds)]);
    this.polls.add(pending.child);
    return pending.then(
      ({ stdout }) => {
        this.lastEvent = JSON.parse(stdout);
        return this.lastEvent;
      },
      // Teardown kills a poll no scenario is waiting for. That is not a failure.
      error => (pending.child.killed ? null : Promise.reject(error)),
    ).finally(() => this.polls.delete(pending.child));
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

  async awaitEvent(type) {
    const event = await this.poll();
    expect(event.type, `expected a ${type} event`).toBe(type);
    return event;
  }

  async savedScene(id, ready = () => true) {
    let saved = null;
    await expect.poll(async () => {
      saved = (await this.api('GET', `/whiteboard/${id}`)).saved;
      return Boolean(saved && ready(saved));
    }, { timeout:20_000 }).toBe(true);
    return saved;
  }

  // The scene and its preview are exported after the click.
  async queuedWhiteboard() {
    let item = null;
    await expect.poll(async () => {
      item = (await this.api('GET', '/state')).queue
        .find(entry => entry.kind === 'whiteboard');
      return Boolean(item);
    }, { timeout:20_000 }).toBe(true);
    return item;
  }

  async stop() {
    for (const child of this.polls) child.kill('SIGKILL');
    if (!this.sessionUrl) return;
    try {
      await this.run(['stop', this.artifact]);
    } catch {
      // A scenario that already ended its session leaves nothing to stop.
    }
  }
}
