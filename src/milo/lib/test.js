// node:test — minimal test runner for Node.js test compatibility
'use strict';

const assert = require('assert');

class TestContext {
  constructor(name) {
    this.name = name;
    this.fullName = name;
    this.diagnostic = (msg) => console.log(`# ${msg}`);
    this.signal = new AbortController().signal;
    this._restores = [];
    // per-context mock: spies are auto-restored when this test ends, so
    // consecutive subtests spying the same method don't stack wrappers
    this.mock = {
      fn: (...a) => mock.fn(...a),
      method: (obj, m, impl) => {
        const mocked = mock.method(obj, m, impl);
        this._restores.push(() => { try { mocked.mock.restore(); } catch {} });
        return mocked;
      },
      getter: (obj, p, impl) => {
        const mocked = mock.getter(obj, p, impl);
        this._restores.push(() => { try { mocked.mock.restore(); } catch {} });
        return mocked;
      },
      reset() {}, restoreAll() {},
      get timers() { return mock.timers; },
    };
  }
  todo(msg) { console.log(`# TODO: ${msg || this.name}`); }
  skip(msg) { console.log(`# SKIP: ${msg || this.name}`); }
  assert = assert;
  plan(n) { this._plan = n; }
  // subtest: runs inline and sequentially; callers await it. A failing subtest
  // fails the process (exitCode) but does not throw into the parent, like node:test.
  test(name, options, fn) {
    if (typeof name === 'function') { fn = name; name = fn.name || '<anonymous>'; options = {}; }
    if (typeof options === 'function') { fn = options; options = {}; }
    if (!fn) fn = () => {};
    return _runTest(`${this.fullName} > ${name}`, fn, options);
  }
  after(fn) { this._restores.push(() => fn(new TestContext(this.name + ':after'))); }
  beforeEach() {}
  afterEach() {}
  _cleanup() {
    for (const r of this._restores.reverse()) { try { r(); } catch {} }
    this._restores.length = 0;
  }
}

let _exitRegistered = false;
let _passed = 0;
let _failed = 0;
const _queue = [];
let _running = false;

function _registerExit() {
  if (_exitRegistered) return;
  _exitRegistered = true;
  process.on('exit', () => {
    if (_failed > 0) process.exitCode = 1;
  });
}

async function _runTest(name, fn, options) {
  if (options && options.skip) { console.log(`ok - ${name} # SKIP`); _passed++; return; }
  if (options && options.todo) { console.log(`ok - ${name} # TODO`); _passed++; return; }
  const ctx = new TestContext(name);
  try {
    let result;
    if (fn.length >= 2) {
      // (t, done) callback style: completion is the done() call; a returned
      // promise rejecting still fails the test.
      result = new Promise((resolve, reject) => {
        const done = (err) => { if (err) reject(err); else resolve(); };
        try {
          const r = fn(ctx, done);
          if (r && typeof r.then === 'function') r.catch(reject);
        } catch (e) { reject(e); }
      });
    } else {
      result = fn(ctx);
    }
    if (result && typeof result.then === 'function') await result;
    _passed++;
  } catch (e) {
    _failed++;
    console.log(`not ok - ${name}`);
    console.log(`  ${e.stack || e.message || e}`);
    process.exitCode = 1;
  } finally {
    ctx._cleanup();
  }
}

async function _drain() {
  if (_running) return;
  _running = true;
  while (_queue.length > 0) {
    const { name, fn, options, resolve } = _queue.shift();
    await _runTest(name, fn, options);
    if (resolve) resolve();
  }
  _running = false;
}

function test(name, options, fn) {
  if (typeof name === 'function') { fn = name; name = fn.name || '<anonymous>'; options = {}; }
  if (typeof options === 'function') { fn = options; options = {}; }
  if (!fn) fn = () => {};
  _registerExit();
  const p = new Promise((resolve) => {
    _queue.push({ name, fn, options, resolve });
  });
  process.nextTick(_drain);
  return p;
}

function describe(name, options, fn) {
  if (typeof options === 'function') { fn = options; options = {}; }
  if (options && options.skip) return;
  if (typeof fn === 'function') fn();
}

function suite(name, options, fn) {
  return describe(name, options, fn);
}

function it(name, options, fn) {
  return test(name, options, fn);
}
it.skip = function(name) { /* no-op: skip this test */ };
it.todo = function(name) { /* no-op: mark as todo */ };
describe.skip = function(name) { /* no-op: skip this suite */ };
describe.todo = function(name) { /* no-op: mark as todo */ };

function before(fn) {
  _queue.push({ name: 'before', fn, options: {} });
}
function after(fn) {
  process.on('exit', () => { try { fn(); } catch {} });
}
function beforeEach() {}
function afterEach() {}

// Minimal mock implementation
const mock = {
  fn(impl) {
    const calls = [];
    const mockFn = function(...args) {
      let result, error;
      try { result = impl ? impl.apply(this, args) : undefined; }
      catch (e) { error = e; calls.push({ arguments: args, result: undefined, error, this: this }); throw e; }
      calls.push({ arguments: args, result, error: undefined, this: this });
      return result;
    };
    mockFn.mock = { calls, callCount() { return calls.length; }, resetCalls() { calls.length = 0; } };
    Object.defineProperty(mockFn.mock, 'callCount', {
      get() { return calls.length; },
    });
    return mockFn;
  },
  method(obj, method, impl) {
    const original = obj[method];
    const mocked = mock.fn(impl || original);
    obj[method] = mocked;
    mocked.mock.restore = () => { obj[method] = original; };
    return mocked;
  },
  getter(obj, prop, impl) {
    const desc = Object.getOwnPropertyDescriptor(obj, prop);
    const mocked = mock.fn(impl);
    Object.defineProperty(obj, prop, { get: mocked, configurable: true });
    mocked.mock.restore = () => { if (desc) Object.defineProperty(obj, prop, desc); else delete obj[prop]; };
    return mocked;
  },
  reset() {},
  restoreAll() {},
  // mock.timers was a silent lie: enable() no-op'd, tick(ms) returned a resolved promise
  // claiming `ms` elapsed. A test that enables mock timers then ran against REAL timers and
  // asserted garbage or hung with no hint. Node's mock.timers is real; milo has not
  // implemented it. Throw loudly (ERR_NOT_IMPLEMENTED semantics) so the test fails with a
  // clear reason instead of a vacuous pass — silence is the failure mode this whole runtime
  // is being hardened against. Implement for real (timers are JS-driven in _timers_init.js)
  // to make these tests pass honestly.
  timers: {
    enable() { const e = new Error('t.mock.timers is not implemented in milo (would run against real timers and lie)'); e.code = 'ERR_NOT_IMPLEMENTED'; throw e; },
    reset() {},
    tick() { const e = new Error('t.mock.timers.tick is not implemented in milo'); e.code = 'ERR_NOT_IMPLEMENTED'; throw e; },
    runAll() { const e = new Error('t.mock.timers.runAll is not implemented in milo'); e.code = 'ERR_NOT_IMPLEMENTED'; throw e; },
  },
};

module.exports = test;
module.exports.test = test;
module.exports.describe = describe;
module.exports.suite = suite;
module.exports.it = it;
module.exports.before = before;
module.exports.after = after;
module.exports.beforeEach = beforeEach;
module.exports.afterEach = afterEach;
module.exports.mock = mock;
module.exports.run = () => {};
module.exports.getTestContext = () => new TestContext('root');
