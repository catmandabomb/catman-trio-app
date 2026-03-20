/**
 * test-runner.js — Lightweight test harness for vanilla JS
 *
 * No dependencies. Runs in Node.js.
 * Provides: describe, it, assert helpers, setup/teardown, async support.
 */

let _suites = [];
let _currentSuite = null;
let _totalPass = 0;
let _totalFail = 0;
let _totalSkip = 0;
let _failures = [];

// ─── Suite/Test registration ─────────────────────────────────

function describe(name, fn) {
  const suite = { name, tests: [], beforeEach: null, afterEach: null, beforeAll: null, afterAll: null };
  const prev = _currentSuite;
  _currentSuite = suite;
  fn();
  _currentSuite = prev;
  _suites.push(suite);
}

function it(name, fn) {
  if (!_currentSuite) throw new Error('it() must be inside describe()');
  _currentSuite.tests.push({ name, fn, skip: false });
}

it.skip = function(name, fn) {
  if (!_currentSuite) throw new Error('it.skip() must be inside describe()');
  _currentSuite.tests.push({ name, fn, skip: true });
};

function beforeEach(fn) { if (_currentSuite) _currentSuite.beforeEach = fn; }
function afterEach(fn) { if (_currentSuite) _currentSuite.afterEach = fn; }
function beforeAll(fn) { if (_currentSuite) _currentSuite.beforeAll = fn; }
function afterAll(fn) { if (_currentSuite) _currentSuite.afterAll = fn; }

// ─── Assertions ──────────────────────────────────────────────

class AssertionError extends Error {
  constructor(msg) { super(msg); this.name = 'AssertionError'; }
}

const assert = {
  equal(actual, expected, msg) {
    if (actual !== expected) {
      throw new AssertionError(
        (msg || 'equal') + ` — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
      );
    }
  },

  notEqual(actual, expected, msg) {
    if (actual === expected) {
      throw new AssertionError(
        (msg || 'notEqual') + ` — expected NOT ${JSON.stringify(expected)}`
      );
    }
  },

  deepEqual(actual, expected, msg) {
    const a = JSON.stringify(actual);
    const b = JSON.stringify(expected);
    if (a !== b) {
      throw new AssertionError(
        (msg || 'deepEqual') + ` — expected ${b}, got ${a}`
      );
    }
  },

  ok(val, msg) {
    if (!val) {
      throw new AssertionError((msg || 'ok') + ` — expected truthy, got ${JSON.stringify(val)}`);
    }
  },

  notOk(val, msg) {
    if (val) {
      throw new AssertionError((msg || 'notOk') + ` — expected falsy, got ${JSON.stringify(val)}`);
    }
  },

  throws(fn, msg) {
    let threw = false;
    try { fn(); } catch (_) { threw = true; }
    if (!threw) throw new AssertionError((msg || 'throws') + ' — expected to throw');
  },

  async throwsAsync(fn, msg) {
    let threw = false;
    try { await fn(); } catch (_) { threw = true; }
    if (!threw) throw new AssertionError((msg || 'throwsAsync') + ' — expected to throw');
  },

  includes(arr, val, msg) {
    if (!Array.isArray(arr) || !arr.includes(val)) {
      throw new AssertionError(
        (msg || 'includes') + ` — expected array to include ${JSON.stringify(val)}`
      );
    }
  },

  notIncludes(arr, val, msg) {
    if (Array.isArray(arr) && arr.includes(val)) {
      throw new AssertionError(
        (msg || 'notIncludes') + ` — expected array NOT to include ${JSON.stringify(val)}`
      );
    }
  },

  match(str, regex, msg) {
    if (!regex.test(str)) {
      throw new AssertionError(
        (msg || 'match') + ` — expected "${str}" to match ${regex}`
      );
    }
  },

  closeTo(actual, expected, delta, msg) {
    if (Math.abs(actual - expected) > delta) {
      throw new AssertionError(
        (msg || 'closeTo') + ` — expected ${actual} to be within ${delta} of ${expected}`
      );
    }
  },

  type(val, typeName, msg) {
    if (typeof val !== typeName) {
      throw new AssertionError(
        (msg || 'type') + ` — expected type ${typeName}, got ${typeof val}`
      );
    }
  },

  instanceOf(val, cls, msg) {
    if (!(val instanceof cls)) {
      throw new AssertionError(
        (msg || 'instanceOf') + ` — expected instance of ${cls.name}`
      );
    }
  },

  isNull(val, msg) {
    if (val !== null) {
      throw new AssertionError((msg || 'isNull') + ` — expected null, got ${JSON.stringify(val)}`);
    }
  },

  isUndefined(val, msg) {
    if (val !== undefined) {
      throw new AssertionError((msg || 'isUndefined') + ` — expected undefined, got ${JSON.stringify(val)}`);
    }
  },

  greaterThan(a, b, msg) {
    if (!(a > b)) {
      throw new AssertionError((msg || 'greaterThan') + ` — expected ${a} > ${b}`);
    }
  },

  lessThan(a, b, msg) {
    if (!(a < b)) {
      throw new AssertionError((msg || 'lessThan') + ` — expected ${a} < ${b}`);
    }
  },
};

// ─── Runner ──────────────────────────────────────────────────

async function run() {
  const startTime = Date.now();
  console.log('\n========================================');
  console.log('  Catman Trio App — Unit Test Suite');
  console.log('========================================\n');

  for (const suite of _suites) {
    console.log(`  ${suite.name}`);
    if (suite.beforeAll) await suite.beforeAll();

    for (const test of suite.tests) {
      if (test.skip) {
        _totalSkip++;
        console.log(`    - ${test.name} (SKIPPED)`);
        continue;
      }
      try {
        if (suite.beforeEach) await suite.beforeEach();
        await test.fn();
        if (suite.afterEach) await suite.afterEach();
        _totalPass++;
        console.log(`    + ${test.name}`);
      } catch (e) {
        _totalFail++;
        const errMsg = e instanceof AssertionError ? e.message : `${e.name || 'Error'}: ${e.message}`;
        console.log(`    X ${test.name}`);
        console.log(`      ${errMsg}`);
        _failures.push({ suite: suite.name, test: test.name, error: errMsg });
      }
    }

    if (suite.afterAll) await suite.afterAll();
    console.log('');
  }

  const elapsed = Date.now() - startTime;
  console.log('========================================');
  console.log(`  Results: ${_totalPass} passed, ${_totalFail} failed, ${_totalSkip} skipped`);
  console.log(`  Time: ${elapsed}ms`);
  console.log('========================================');

  if (_failures.length) {
    console.log('\n  FAILURES:\n');
    _failures.forEach((f, i) => {
      console.log(`  ${i + 1}) ${f.suite} > ${f.test}`);
      console.log(`     ${f.error}\n`);
    });
  }

  console.log('');
  return _totalFail === 0;
}

function reset() {
  _suites = [];
  _currentSuite = null;
  _totalPass = 0;
  _totalFail = 0;
  _totalSkip = 0;
  _failures = [];
}

// ─── Exports ─────────────────────────────────────────────────

module.exports = { describe, it, beforeEach, afterEach, beforeAll, afterAll, assert, run, reset };
