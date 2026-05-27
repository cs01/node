// node:test — minimal test runner for Node.js test compatibility
'use strict';

const assert = require('assert');

class TestContext {
  constructor(name) {
    this.name = name;
    this.diagnostic = (msg) => console.log(`# ${msg}`);
    this.signal = new AbortController().signal;
  }
  todo(msg) { console.log(`# TODO: ${msg || this.name}`); }
  skip(msg) { console.log(`# SKIP: ${msg || this.name}`); }
  assert = assert;
  plan(n) { this._plan = n; }
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

async function _drain() {
  if (_running) return;
  _running = true;
  while (_queue.length > 0) {
    const { name, fn, options } = _queue.shift();
    if (options && options.skip) {
      console.log(`ok - ${name} # SKIP`);
      _passed++;
      continue;
    }
    if (options && options.todo) {
      console.log(`ok - ${name} # TODO`);
      _passed++;
      continue;
    }
    const ctx = new TestContext(name);
    try {
      const result = fn(ctx);
      if (result && typeof result.then === 'function') await result;
      _passed++;
    } catch (e) {
      _failed++;
      console.log(`not ok - ${name}`);
      console.log(`  ${e.stack || e.message || e}`);
      process.exitCode = 1;
    }
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
      const result = impl ? impl.apply(this, args) : undefined;
      calls.push({ arguments: args, result, this: this });
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
  timers: {
    enable() {},
    reset() {},
    tick(ms) { return Promise.resolve(); },
    runAll() { return Promise.resolve(); },
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
