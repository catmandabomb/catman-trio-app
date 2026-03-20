# Catman Trio App — Unit Tests

Lightweight unit test suite for the Catman Trio PWA. No npm, no build tools — just Node.js.

## Quick Start

```bash
node tests/run-all.js
```

Exit code 0 = all pass, 1 = failures.

## Structure

```
tests/
  test-runner.js       — Lightweight test harness (describe/it/assert)
  mocks.js             — Browser API mocks (localStorage, fetch, navigator, document)
  run-all.js           — Entry point — loads and runs all test files
  store.test.js        — State management (get/set, initial state, constants)
  auth.test.js         — Role checks, permissions, session persistence
  router.test.js       — Hash parsing, route matching, navStack, roundtrips
  utils.test.js        — esc, highlight, duration, timeAgo, levenshtein, wake lock
  setlists.test.js     — Key distance, jarring transitions, last-played formatting
  wikicharts.test.js   — Transpose, chord parsing, Nashville numbers, diatonic chords
  player.test.js       — Speed steps, volume clamping, format helpers
  pdf-viewer.test.js   — Zoom clamping, page bounds, DPR caps, cache sizing
  sync.test.js         — useCloudflare detection, fingerprinting, schema migration
  service-worker.test.js — Cache versioning, URL routing, audio proxy TTL
  modal.test.js        — Open/close state, escape key, backdrop click
  songs.test.js        — Search/filter logic, tag/key filtering, combined filters
  practice.test.js     — List CRUD, archive toggle, data migration
```

## Design Decisions

- **No ES modules**: Source files use `import/export` but tests replicate the pure logic
  functions to avoid needing a module bundler. This tests the *logic*, not the wiring.
- **No DOM testing**: Functions that manipulate DOM are tested via their logic paths
  (e.g., modal state tracking) with mock elements.
- **Edge cases first**: Tests focus on boundary conditions, null/undefined handling,
  wrapping arithmetic, and things likely to break in production.

## Adding Tests

1. Create `tests/your-module.test.js`
2. Import the test runner: `const { describe, it, assert } = require('./test-runner');`
3. Add your file to `run-all.js`'s `testFiles` array
4. Run: `node tests/run-all.js`

## Test Runner API

```js
describe('Suite Name', () => {
  beforeEach(() => { /* reset state */ });
  afterEach(() => { /* cleanup */ });

  it('test name', () => {
    assert.equal(actual, expected);
  });

  it.skip('skipped test', () => { /* not run */ });
});
```

### Assertions

| Method | Description |
|--------|-------------|
| `assert.equal(a, b)` | Strict equality (`===`) |
| `assert.notEqual(a, b)` | Strict inequality |
| `assert.deepEqual(a, b)` | JSON deep equality |
| `assert.ok(val)` | Truthy |
| `assert.notOk(val)` | Falsy |
| `assert.throws(fn)` | Function throws |
| `assert.throwsAsync(fn)` | Async function throws |
| `assert.includes(arr, val)` | Array includes value |
| `assert.notIncludes(arr, val)` | Array does not include |
| `assert.match(str, regex)` | String matches regex |
| `assert.closeTo(a, b, delta)` | Numbers within delta |
| `assert.type(val, 'string')` | typeof check |
| `assert.isNull(val)` | Strict null |
| `assert.isUndefined(val)` | Strict undefined |
| `assert.greaterThan(a, b)` | a > b |
| `assert.lessThan(a, b)` | a < b |
