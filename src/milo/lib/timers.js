// timers module — capture refs early so deleting globals doesn't break require('timers')
'use strict';

const _setTimeout = globalThis.setTimeout;
const _clearTimeout = globalThis.clearTimeout;
const _setInterval = globalThis.setInterval;
const _clearInterval = globalThis.clearInterval;
const _setImmediate = globalThis.setImmediate;
const _clearImmediate = globalThis.clearImmediate;

const promises = require('timers_promises');

// util.promisify(setTimeout) must return the timers/promises version (Node wires
// this via the custom-promisify symbol on the global timer functions).
const _promisifyCustom = Symbol.for('nodejs.util.promisify.custom');
if (promises.setTimeout) _setTimeout[_promisifyCustom] = promises.setTimeout;
if (promises.setImmediate) _setImmediate[_promisifyCustom] = promises.setImmediate;

module.exports = {
  setTimeout: _setTimeout,
  clearTimeout: _clearTimeout,
  setInterval: _setInterval,
  clearInterval: _clearInterval,
  setImmediate: _setImmediate,
  clearImmediate: _clearImmediate,
  promises,
};
