// timers/promises module
'use strict';

function setTimeout(delay, value, opts) {
  return new Promise((resolve, reject) => {
    const signal = opts && opts.signal;
    if (signal && signal.aborted) return reject(signal.reason);
    const id = globalThis.setTimeout(() => resolve(value), delay);
    if (signal) signal.addEventListener('abort', () => { globalThis.clearTimeout(id); reject(signal.reason); });
  });
}

function setImmediate(value, opts) {
  return new Promise((resolve, reject) => {
    const signal = opts && opts.signal;
    if (signal && signal.aborted) return reject(signal.reason);
    globalThis.setImmediate(() => resolve(value));
  });
}

function setInterval(delay, value, opts) {
  return (async function*() {
    while (true) { yield await setTimeout(delay, value, opts); }
  })();
}

module.exports = { setTimeout, setImmediate, setInterval };
