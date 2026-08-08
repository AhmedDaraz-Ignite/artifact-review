import { When, Then, expect } from '../support/bdd.js';

Then(/^the agent receives feedback saying "([^"]*)"$/, async ({ arev }, text) => {
  const event = await arev.poll();
  expect(event.type).toBe('feedback');
  // Chat notes carry words in text, annotations in comment.
  expect(event.items.map(item => item.text ?? item.comment)).toContain(text);
});

Then('the agent receives nothing', async ({ arev }) => {
  const event = await arev.poll(1);
  expect(event.type).toBe('idle');
});

Then('the agent receives one feedback batch of kinds:', async ({ arev }, table) => {
  const expected = table.raw().map(([kind]) => kind).sort();
  const event = await arev.poll();
  expect(event.type).toBe('feedback');
  expect(event.items.map(item => item.kind).sort()).toEqual(expected);
});

Then(/^the agent receives (\d+) chat notes?$/, async ({ arev }, count) => {
  const event = await arev.poll();
  expect(event.type).toBe('feedback');
  expect(event.items.filter(item => item.kind === 'chat')).toHaveLength(count);
});

Then('the batch carries the review event schema', async ({ arev }) => {
  const health = await arev.api('GET', '/health');
  expect(arev.lastEvent.schema).toBe(health.event_schema);
});

When(/^the agent replies "([^"]*)"$/, async ({ arev }, text) => {
  await arev.reply(text);
});
