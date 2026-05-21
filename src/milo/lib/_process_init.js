// process setup — internal bootstrap module
'use strict';

process.emitWarning = (msg) => console.error('Warning:', msg);

const _envB = internalBinding('env');
const _envOverrides = {};
const _envDeleted = new Set();
process.env = new Proxy({}, {
  get(_, key) {
    if (key === Symbol.toStringTag) return 'process.env';
    const k = String(key); if (_envDeleted.has(k)) return undefined; if (k in _envOverrides) return _envOverrides[k]; return _envB.get(k);
  },
  set(_, key, value) { const k = String(key); _envDeleted.delete(k); _envOverrides[k] = String(value); return true; },
  has(_, key) { const k = String(key); if (_envDeleted.has(k)) return false; return k in _envOverrides || _envB.get(k) !== undefined; },
  deleteProperty(_, key) { const k = String(key); delete _envOverrides[k]; _envDeleted.add(k); return true; },
  ownKeys() {
    const nativeKeys = (_envB.enumerate ? _envB.enumerate() : []).map(e => e.split('=')[0]);
    const all = new Set([...nativeKeys, ...Object.keys(_envOverrides)]);
    for (const k of _envDeleted) all.delete(k);
    return [...all];
  },
  getOwnPropertyDescriptor(_, key) { const v = this.get(null, key); if (v !== undefined) return { value: v, writable: true, enumerable: true, configurable: true }; return undefined; },
});

process.config = { variables: { asan: 0, v8_enable_i18n_support: 0 }, target_defaults: { default_configuration: 'Release' } };
process.features = { inspector: false, debug: false, uv: true, ipv6: true, tls: false };
if (!process.versions) process.versions = {};
process.versions.node = '24.0.0'; process.versions.v8 = '13.6.233.5'; process.versions.modules = '135';
process.version = 'v24.0.0'; process.release = { name: 'node' };
if (!process.cwd) process.cwd = () => _envB.get('PWD') || '/';
if (!process.chdir) process.chdir = () => {};
if (!process.umask) process.umask = (mask) => { if (mask !== undefined) return 0o22; return 0o22; };

if (!process.hrtime) {
  const b = internalBinding('process_methods');
  process.hrtime = (...a) => {
    const r = b.hrtime();
    if (a.length && a[0]) { r[0] -= a[0][0]; r[1] -= a[0][1]; if (r[1] < 0) { r[0]--; r[1] += 1e9; } }
    return r;
  };
  process.hrtime.bigint = b.hrtimeBigint;
}

// Proper nextTick queue — runs before promises, drains recursively
process._nextTickQueue = [];
process._tickCallback = function() {
  while (process._nextTickQueue.length > 0) {
    const entry = process._nextTickQueue.shift();
    try { entry[0](...entry[1]); }
    catch (e) {
      const handlers = process.listeners && process.listeners('uncaughtException');
      if (handlers && handlers.length > 0) process.emit('uncaughtException', e);
      else throw e;
    }
  }
};
process.nextTick = (fn, ...args) => { process._nextTickQueue.push([fn, args]); };

if (!process.on) {
  const _h = {};
  process.on = (ev, fn) => { (_h[ev] ??= []).push(fn); return process; };
  process.addListener = process.on;
  process.once = (ev, fn) => { const w = (...a) => { process.removeListener(ev, w); fn(...a); }; return process.on(ev, w); };
  process.removeListener = (ev, fn) => { const h = _h[ev]; if (h) { const i = h.indexOf(fn); if (i >= 0) h.splice(i, 1); } return process; };
  process.emit = (ev, ...args) => { const hs = _h[ev]; if (!hs || hs.length === 0) return false; for (const fn of [...hs]) fn(...args); return true; };
  process.listeners = (ev) => [...(_h[ev] || [])];
  process.listenerCount = (ev) => (_h[ev] || []).length;
  process.removeAllListeners = (ev) => { if (ev) delete _h[ev]; else for (const k of Object.keys(_h)) delete _h[k]; return process; };
  process.prependListener = (ev, fn) => { (_h[ev] ??= []).unshift(fn); return process; };
  process.prependOnceListener = (ev, fn) => { const w = (...a) => { process.removeListener(ev, w); fn(...a); }; return process.prependListener(ev, w); };
  process.off = process.removeListener;
  process.eventNames = () => Object.keys(_h).filter(k => _h[k] && _h[k].length > 0);
}

const _startTime = Date.now();
if (!process.uptime) process.uptime = () => (Date.now() - _startTime) / 1000;
if (!process.title) process.title = 'milo-node';
if (!process.execPath) process.execPath = process.argv[0] || '';
if (!process.execArgv) process.execArgv = [];
if (!process.allowedNodeEnvironmentFlags) process.allowedNodeEnvironmentFlags = new Set();
if (!process.kill) process.kill = () => {};
if (!process.binding) process.binding = (name) => { throw new Error('process.binding is not supported'); };

let _uncaughtExceptionCallback = null;
process.setUncaughtExceptionCaptureCallback = (fn) => {
  if (fn !== null && typeof fn !== 'function') throw new TypeError('The "fn" argument must be of type function or null');
  _uncaughtExceptionCallback = fn;
};
process.hasUncaughtExceptionCaptureCallback = () => _uncaughtExceptionCallback !== null;

if (!process.memoryUsage) {
  const _pmb = internalBinding('process_methods');
  process.memoryUsage = () => _pmb.memoryUsage();
  process.memoryUsage.rss = () => _pmb.memoryUsage().rss;
}
if (!process.cpuUsage) process.cpuUsage = () => ({ user: 0, system: 0 });
if (!process.resourceUsage) process.resourceUsage = () => ({ userCPUTime: 0, systemCPUTime: 0, maxRSS: 0, sharedMemorySize: 0, unsharedDataSize: 0, unsharedStackSize: 0, minorPageFault: 0, majorPageFault: 0, swappedOut: 0, fsRead: 0, fsWrite: 0, ipcSent: 0, ipcReceived: 0, signalsCount: 0, voluntaryContextSwitches: 0, involuntaryContextSwitches: 0 });
