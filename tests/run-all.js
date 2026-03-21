#!/usr/bin/env node
/**
 * run-all.js — Entry point for the Catman Trio App test suite
 *
 * Usage: node tests/run-all.js
 *
 * Loads all test files and runs them through the test runner.
 * Exit code 0 on success, 1 on any failure.
 */

const runner = require('./test-runner');
const { setupGlobals } = require('./mocks');

// Set up browser globals before loading tests
setupGlobals();

// Load all test files (each registers describe/it blocks)
const testFiles = [
  './store.test.js',
  './auth.test.js',
  './router.test.js',
  './utils.test.js',
  './setlists.test.js',
  './sheets.test.js',
  './player.test.js',
  './pdf-viewer.test.js',
  './sync.test.js',
  './service-worker.test.js',
  './modal.test.js',
  './songs.test.js',
  './practice.test.js',
  './messages.test.js',
  './mutation-queue.test.js',
  './navigation.test.js',
];

for (const f of testFiles) {
  try {
    require(f);
  } catch (e) {
    console.error(`Failed to load ${f}: ${e.message}`);
    console.error(e.stack);
  }
}

// Run all registered tests
runner.run().then(allPassed => {
  process.exit(allPassed ? 0 : 1);
}).catch(err => {
  console.error('Test runner error:', err);
  process.exit(1);
});
