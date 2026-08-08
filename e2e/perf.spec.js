import { performance } from 'node:perf_hooks';
import { expect, test } from './support/bdd.js';

const DELIVERY_SLO_MS = Number(process.env.AREV_TEST_DELIVERY_SLO_MS || 1500);
const SAMPLES = 5;

function percentile(values, quantile) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil(quantile * ordered.length) - 1)];
}

// The poll starts before the click so the timing excludes process startup.
test('local Send now stays under the delivery SLO', async ({
  artifact, arev, page, rail,
}) => {
  await artifact.from('clean.html');
  await arev.open();
  await page.goto(arev.sessionUrl, { waitUntil:'domcontentloaded' });
  await expect(rail.curtain).toBeHidden();

  const samples = [];
  for (let index = 0; index < SAMPLES; index += 1) {
    const message = `latency sample ${index + 1}`;
    const pending = arev.poll(30);
    await rail.chat.fill(message);
    await rail.chatAction.click();
    const started = performance.now();
    await page.locator('#chatSend').click();
    const event = await pending;
    samples.push(performance.now() - started);
    expect(event.type).toBe('feedback');
    expect(event.items.some(
      item => item.kind === 'chat' && item.text === message,
    )).toBe(true);
  }

  const p95 = percentile(samples, 0.95);
  expect(
    p95,
    `samples=${samples.map(value => value.toFixed(1)).join(',')}`,
  ).toBeLessThan(DELIVERY_SLO_MS);
});
