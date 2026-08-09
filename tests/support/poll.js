import { expect } from '@playwright/test';

// Polls until the reader hands back something truthy, then returns it.
// expect.poll on its own only reports whether the condition held, so the
// caller would otherwise have to smuggle the value out through a local.
export async function pollUntil(read, options) {
  let found = null;
  await expect.poll(async () => {
    found = await read();
    return Boolean(found);
  }, options).toBe(true);
  return found;
}
