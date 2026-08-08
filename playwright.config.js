import { defineConfig } from '@playwright/test';
import { defineBddConfig } from 'playwright-bdd';

const bddTestDir = defineBddConfig({
  features:'e2e/features/**/*.feature',
  // support/bdd.js belongs here too. It exports the extended test instance that
  // playwright-bdd needs to resolve before it can generate any spec.
  steps:['e2e/support/bdd.js', 'e2e/steps/**/*.js'],
  outputDir:'.bdd-gen',
});

export default defineConfig({
  fullyParallel:true,
  workers:process.env.CI ? 4 : '50%',
  retries:process.env.CI ? 1 : 0,
  timeout:60_000,
  expect:{ timeout:10_000 },
  reporter:process.env.CI
    ? [['list'], ['html', { open:'never' }]]
    : 'list',
  use:{
    viewport:{ width:1440, height:950 },
    trace:'retain-on-failure',
    video:'retain-on-failure',
  },
  projects:[
    { name:'review', testDir:bddTestDir },
    { name:'perf', testDir:'e2e', testMatch:'**/*.spec.js' },
  ],
});
