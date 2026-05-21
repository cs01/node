// console setup — internal bootstrap module
'use strict';

const _con = internalBinding('_console');

const _fmt = (a) => {
  if (a === null) return 'null';
  if (a === undefined) return 'undefined';
  if (typeof a === 'string') return a;
  if (typeof a === 'object') try { return JSON.stringify(a); } catch { return String(a); }
  return String(a);
};

// process.stdout / process.stderr / process.stdin
const _isTTY = _con.isatty ? (fd) => !!_con.isatty(fd) : () => false;
process.stdout = { write(s) { _con.write(typeof s === 'string' ? s : String(s)); return true; }, fd: 1, isTTY: _isTTY(1) };
process.stderr = { write(s) { _con.writeError(typeof s === 'string' ? s : String(s)); return true; }, fd: 2, isTTY: _isTTY(2) };
const { Readable } = require('stream');
process.stdin = new Readable({ read() {} });
process.stdin.fd = 0;
process.stdin.isTTY = _isTTY(0);

const _counts = {};
const _timers = {};
globalThis.console = {
  log(...args) { _con.write(args.map(_fmt).join(' ') + '\n'); },
  info(...args) { _con.write(args.map(_fmt).join(' ') + '\n'); },
  debug(...args) { _con.write(args.map(_fmt).join(' ') + '\n'); },
  error(...args) { _con.writeError(args.map(_fmt).join(' ') + '\n'); },
  warn(...args) { _con.writeError(args.map(_fmt).join(' ') + '\n'); },
  dir(obj) { _con.write(JSON.stringify(obj, null, 2) + '\n'); },
  clear() {},
  assert(val, ...args) { if (!val) console.error('Assertion failed:', ...args); },
  count(label) { label = label || 'default'; _counts[label] = (_counts[label] || 0) + 1; console.log(label + ':', _counts[label]); },
  countReset(label) { label = label || 'default'; _counts[label] = 0; },
  time(label) { label = label || 'default'; _timers[label] = Date.now(); },
  timeEnd(label) { label = label || 'default'; const d = Date.now() - (_timers[label] || 0); delete _timers[label]; console.log(label + ':', d + 'ms'); },
  timeLog(label) { label = label || 'default'; const d = Date.now() - (_timers[label] || 0); console.log(label + ':', d + 'ms'); },
  trace(...args) { const e = new Error(); console.error('Trace:', ...args, '\n' + e.stack); },
  group() {}, groupEnd() {}, groupCollapsed() {},
  table(data) { console.log(data); },
};
