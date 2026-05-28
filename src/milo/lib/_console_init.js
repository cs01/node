// console setup — internal bootstrap module
'use strict';

const _con = internalBinding('_console');

const _util = require('util');
const _fmt = (a) => typeof a === 'string' ? a : _util.inspect(a, { colors: false, depth: 2 });

// process.stdout / process.stderr / process.stdin
const _isTTY = _con.isatty ? (fd) => !!_con.isatty(fd) : () => false;
const { Readable, Writable } = require('stream');
const tty = require('tty');

if (_isTTY(1)) {
  process.stdout = new tty.WriteStream(1);
} else {
  process.stdout = new Writable({
    write(chunk, enc, cb) { _con.write(typeof chunk === 'string' ? chunk : chunk.toString()); if (cb) cb(); }
  });
  process.stdout.fd = 1;
  process.stdout.isTTY = false;
}

if (_isTTY(2)) {
  process.stderr = new tty.WriteStream(2);
} else {
  process.stderr = new Writable({
    write(chunk, enc, cb) { _con.writeError(typeof chunk === 'string' ? chunk : chunk.toString()); if (cb) cb(); }
  });
  process.stderr.fd = 2;
  process.stderr.isTTY = false;
}

const _stdin = new Readable({ read() {} });
_stdin.fd = 0;
_stdin.isTTY = _isTTY(0);
if (_isTTY(0)) _stdin.setRawMode = (mode) => { _con.setRawMode(0, mode ? 1 : 0); _stdin.isRaw = !!mode; return _stdin; };
_stdin._started = false;
_stdin.resume = function() {
  Readable.prototype.resume.call(this);
  if (!this._started && !this.isTTY) {
    this._started = true;
    const net = require('net');
    const tcp = internalBinding('tcp');
    const spawn = internalBinding('spawn');
    net._ensurePoll();
    const self = this;
    const pipeObj = {
      _fd: 0,
      destroyed: false,
      _onReadable() {
        for (;;) {
          const data = spawn.readPipe(0);
          if (data === undefined) {
            self.push(null);
            net.Socket._sockets.delete(0);
            this.destroyed = true;
            return;
          }
          if (data.length === 0) break;
          self.push(Buffer.from(data));
        }
      }
    };
    net.Socket._sockets.set(0, pipeObj);
    tcp.pollAdd(0, tcp.EVFILT_READ);
  }
  return this;
};
process.stdin = _stdin;

const _counts = {};
const _timers = {};
let _groupIndent = '';
const _fmtArgs = (args) => {
  if (args.length === 0) return '';
  if (typeof args[0] === 'string' && args.length > 1) return _util.format(...args);
  return args.map(_fmt).join(' ');
};
globalThis.console = {
  log(...args) { process.stdout.write(_groupIndent + _fmtArgs(args) + '\n'); },
  info(...args) { process.stdout.write(_groupIndent + _fmtArgs(args) + '\n'); },
  debug(...args) { process.stdout.write(_groupIndent + _fmtArgs(args) + '\n'); },
  error(...args) { process.stderr.write(_groupIndent + _fmtArgs(args) + '\n'); },
  warn(...args) { process.stderr.write(_groupIndent + _fmtArgs(args) + '\n'); },
  dir(obj, opts) { _con.write(_util.inspect(obj, { depth: 2, ...opts }) + '\n'); },
  clear() { if (process.stdout.isTTY) process.stdout.write('\x1b[1;1H\x1b[0J'); },
  assert(val, ...args) { if (!val) console.error('Assertion failed:', ...args); },
  count(label) { if (typeof label === 'symbol') throw new TypeError('Cannot convert a Symbol value to a string'); label = label === undefined ? 'default' : String(label); _counts[label] = (_counts[label] || 0) + 1; console.log(label + ':', _counts[label]); },
  countReset(label) { if (typeof label === 'symbol') throw new TypeError('Cannot convert a Symbol value to a string'); label = label === undefined ? 'default' : String(label); _counts[label] = 0; },
  time(label) { label = label === undefined ? 'default' : String(label); _timers[label] = Date.now(); },
  timeEnd(label) { label = label === undefined ? 'default' : String(label); if (!(label in _timers)) { console.warn(`Timer '${label}' does not exist`); return; } const d = Date.now() - _timers[label]; delete _timers[label]; console.log(label + ': ' + d + 'ms'); },
  timeLog(label, ...args) { label = label === undefined ? 'default' : String(label); if (!(label in _timers)) { console.warn(`Timer '${label}' does not exist`); return; } const d = Date.now() - _timers[label]; console.log(label + ': ' + d + 'ms', ...args); },
  trace(...args) { const e = new Error(); console.error('Trace:', ...args, '\n' + e.stack); },
  group(...args) { if (args.length > 0) _con.write(_groupIndent + _fmtArgs(args) + '\n'); _groupIndent += '  '; },
  groupEnd() { if (_groupIndent.length >= 2) _groupIndent = _groupIndent.slice(2); },
  groupCollapsed(...args) { if (args.length > 0) _con.write(_groupIndent + _fmtArgs(args) + '\n'); _groupIndent += '  '; },
  table(data, columns) {
    if (columns !== undefined && !Array.isArray(columns)) { const e = new TypeError('"columns" argument must be an instance of Array'); e.code = 'ERR_INVALID_ARG_TYPE'; throw e; }
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
  dirxml(...args) { process.stdout.write(_groupIndent + _fmtArgs(args) + '\n'); },
};
// Attach Console class and set prototype for instanceof checks
// require('console') is called AFTER globalThis.console is set so it picks up the right object
const { Console: _Console } = require('console');
globalThis.console.Console = _Console;
Object.setPrototypeOf(globalThis.console, _Console.prototype);
