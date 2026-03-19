// @ts-check
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30000,
  expect: { timeout: 5000 },
  fullyParallel: true,
  retries: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:8080',
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npx serve . -p 8080 -s',
    port: 8080,
    reuseExistingServer: true,
  },
  projects: [
    { name: 'firefox', use: { browserName: 'firefox' } },
  ],
});
