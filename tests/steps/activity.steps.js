import { Given, When, Then, expect } from '../support/bdd.js';

Given(/^the agent has posted (\d+) activity entries$/, async ({ arev }, count) => {
  for (let index = 0; index < count; index += 1) {
    await arev.api('POST', '/agent-reply', { text:`History entry ${index}` });
  }
  arev.opening = await arev.api('GET', '/state');
});

When('the reviewer queues a draft through the review API', async ({ arev }) => {
  arev.deltaFrom = (await arev.api('GET', '/state')).revision;
  arev.queued = await arev.api('POST', '/queue', {
    item:{ kind:'chat', text:'delta-only draft' },
  });
});

When(/^(\d+) agent status updates overrun the delta window$/, async ({ arev }, count) => {
  for (let start = 0; start < count; start += 20) {
    await Promise.all(Array.from(
      { length:Math.min(20, count - start) },
      () => arev.api('POST', '/agent-status', { status:'working' })));
  }
});

When('the reviewer loads every earlier activity page', async ({ arev, rail }) => {
  for (
    let loaded = await rail.feedEntries.count();
    loaded < arev.opening.activity.total;
    loaded = await rail.feedEntries.count()
  ) {
    await rail.loadEarlier.click();
    await expect.poll(() => rail.feedEntries.count()).toBeGreaterThan(loaded);
  }
});

Then(/^the opening state holds the newest (\d+) of (\d+) entries$/,
  async ({ arev }, window, total) => {
    const { feed, activity } = arev.opening;
    expect(feed).toHaveLength(window);
    expect(feed[0].text).toBe(`History entry ${total - window}`);
    expect(feed.at(-1).text).toBe(`History entry ${total - 1}`);
    expect(activity.total).toBe(total);
    expect(activity.has_more).toBe(true);
    expect(Number.isInteger(activity.next_before), 'next_before cursor').toBe(true);
  });

Then('the older activity pages join up with no gaps or overlaps', async ({ arev }) => {
  const { feed, activity } = arev.opening;
  const middle = await arev.api('GET', `/activity?before=${activity.next_before}&limit=50`);
  const oldest = await arev.api('GET', `/activity?before=${middle.next_before}&limit=50`);
  expect(middle.items).toHaveLength(50);
  expect(oldest.items).toHaveLength(activity.total - feed.length - middle.items.length);
  expect(oldest.has_more).toBe(false);
  const ids = [...oldest.items, ...middle.items, ...feed].map(entry => entry.id);
  expect(ids).toHaveLength(activity.total);
  expect(new Set(ids).size).toBe(activity.total);
});

Then('the delta carries the queued draft and no activity feed', async ({ arev }) => {
  const delta = await arev.api(
    'GET', `/state/next?after=${arev.deltaFrom}&timeout=1&mode=delta`);
  expect(delta.mode).toBe('delta');
  expect(delta.revision).toBeGreaterThan(arev.deltaFrom);
  expect(delta.changes.queue.map(item => item.qid)).toContain(arev.queued.qid);
  expect(Object.keys(delta.changes)).not.toContain('feed');
  expect(Object.keys(delta.changes)).not.toContain('feed_upserts');
});

Then('a client behind the delta window gets one bounded reset', async ({ arev }) => {
  const reset = await arev.api(
    'GET', `/state/next?after=${arev.deltaFrom}&timeout=1&mode=delta`);
  expect(reset.mode).toBe('reset');
  expect(reset.state.feed).toHaveLength(arev.opening.feed.length);
  expect(reset.state.activity.total).toBe(arev.opening.activity.total);
});

Then(/^the review feed holds (\d+) entries$/, async ({ rail }, count) => {
  await expect(rail.feedEntries).toHaveCount(count);
});

Then(/^the review feed shows all (\d+) entries oldest first with nothing left to load$/,
  async ({ rail }, total) => {
    expect(await rail.loadedHistory()).toEqual({
      count:total,
      first:'History entry 0',
      last:`History entry ${total - 1}`,
      loadHidden:true,
    });
  });
