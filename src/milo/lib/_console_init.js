// console setup — internal bootstrap module
'use strict';

const _con = internalBinding('_console');

const _util = require('util');
const _fmt = (a) => typeof a === 'string' ? a : _util.inspect(a, { colors: false, depth: 2 });

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
const _fmtArgs = (args) => {
  if (args.length === 0) return '';
  if (typeof args[0] === 'string' && args.length > 1) return _util.format(...args);
  return args.map(_fmt).join(' ');
};
globalThis.console = {
  log(...args) { _con.write(_fmtArgs(args) + '\n'); },
  info(...args) { _con.write(_fmtArgs(args) + '\n'); },
  debug(...args) { _con.write(_fmtArgs(args) + '\n'); },
  error(...args) { _con.writeError(_fmtArgs(args) + '\n'); },
  warn(...args) { _con.writeError(_fmtArgs(args) + '\n'); },
  dir(obj, opts) { _con.write(_util.inspect(obj, { depth: 2, ...opts }) + '\n'); },
  clear() {},
  assert(val, ...args) { if (!val) console.error('Assertion failed:', ...args); },
  count(label) { label = label || 'default'; _counts[label] = (_counts[label] || 0) + 1; console.log(label + ':', _counts[label]); },
  countReset(label) { label = label || 'default'; _counts[label] = 0; },
  time(label) { label = label || 'default'; _timers[label] = Date.now(); },
  timeEnd(label) { label = label || 'default'; const d = Date.now() - (_timers[label] || 0); delete _timers[label]; console.log(label + ':', d + 'ms'); },
  timeLog(label) { label = label || 'default'; const d = Date.now() - (_timers[label] || 0); console.log(label + ':', d + 'ms'); },
  trace(...args) { const e = new Error(); console.error('Trace:', ...args, '\n' + e.stack); },
  group() {}, groupEnd() {}, groupCollapsed() {},
  table(data, columns) {
    if (!data || typeof data !== 'object') { console.log(data); return; }
    const rows = Array.isArray(data) ? data : Object.entries(data).map(([k, v]) => typeof v === 'object' && v ? { '(index)': k, ...v } : { '(index)': k, Values: v });
    if (rows.length === 0) { console.log(data); return; }
    const keys = columns || [...new Set(rows.flatMap(r => typeof r === 'object' && r ? Object.keys(r) : ['Values']))];
    const header = keys.map(k => String(k));
    const rowStrs = rows.map(r => keys.map(k => typeof r === 'object' && r ? String(r[k] ?? '') : String(r)));
    const widths = header.map((h, i) => Math.max(h.length, ...rowStrs.map(r => (r[i] || '').length)));
    const pad = (s, w) => s + ' '.repeat(Math.max(0, w - s.length));
    const sep = widths.map(w => '-'.repeat(w + 2)).join('+');
    _con.write('| ' + header.map((h, i) => pad(h, widths[i])).join(' | ') + ' |\n');
    _con.write('|' + sep + '|\n');
    for (const row of rowStrs) _con.write('| ' + row.map((c, i) => pad(c || '', widths[i])).join(' | ') + ' |\n');
  },
};
