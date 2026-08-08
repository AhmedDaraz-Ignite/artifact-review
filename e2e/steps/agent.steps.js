import { Then, expect } from '../support/bdd.js';

Then('the agent receives a chat note saying {string}', async ({ arev }, text) => {
  const event = await arev.poll();
  expect(event.type).toBe('feedback');
  expect(event.items.map(item => item.text)).toContain(text);
});

Then('the agent receives one feedback batch of kinds:', async ({ arev }, table) => {
  const expected = table.raw().map(([kind]) => kind).sort();
  const event = await arev.poll();
  expect(event.type).toBe('feedback');
  expect(event.items.map(item => item.kind).sort()).toEqual(expected);
});
