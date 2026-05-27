// console module
'use strict';

const { inspect } = require('util');

class Console {
  constructor(stdout, stderr, opts) {
    if (typeof stdout === 'object' && stdout !== null && !stdout.write) {
      opts = stdout;
      stdout = opts.stdout;
      stderr = opts.stderr;
    }
    this._stdout = stdout;
    this._stderr = stderr || stdout;
    this._times = new Map();
    this._counts = new Map();
    this._groupIndent = '';
    this._colorMode = opts && opts.colorMode;
    this._inspectOptions = opts && opts.inspectOptions;
  }

  _fmt(...args) {
    if (args.length === 0) return '';
    if (typeof args[0] === 'string' && args.length > 1) return require('util').format(...args);
    return args.map(a => typeof a === 'string' ? a : inspect(a)).join(' ');
  }

  log(...args) {
    const msg = this._groupIndent + this._fmt(...args) + '\n';
    try {
      if (this._stdout && this._stdout.write) this._stdout.write(msg);
      else internalBinding('_console').write(msg);
    } catch {}
  }

  info(...args) { this.log(...args); }
  debug(...args) { this.log(...args); }
  dir(obj, opts) { this.log(inspect(obj, opts)); }

  error(...args) {
    const msg = this._groupIndent + this._fmt(...args) + '\n';
    try {
      if (this._stderr && this._stderr.write) this._stderr.write(msg);
      else internalBinding('_console').writeError(msg);
    } catch {}
  }

  warn(...args) { this.error(...args); }

  assert(val, ...args) {
    if (!val) this.error('Assertion failed:', ...args);
  }

  time(label) { this._times.set(label || 'default', Date.now()); }
  timeEnd(label) {
    label = label || 'default';
    const start = this._times.get(label);
    if (start !== undefined) {
      this.log(`${label}: ${Date.now() - start}ms`);
      this._times.delete(label);
    }
  }
  timeLog(label, ...args) {
    label = label || 'default';
    const start = this._times.get(label);
    if (start !== undefined) this.log(`${label}: ${Date.now() - start}ms`, ...args);
  }

  count(label) {
    label = label || 'default';
    const c = (this._counts.get(label) || 0) + 1;
    this._counts.set(label, c);
    this.log(`${label}: ${c}`);
  }
  countReset(label) { this._counts.set(label || 'default', 0); }

  trace(...args) {
    const err = new Error();
    this.error('Trace:', ...args, '\n' + err.stack.split('\n').slice(2).join('\n'));
  }

  table(data, columns) {
    if (columns !== undefined && !Array.isArray(columns)) { const e = new TypeError('"columns" argument must be an instance of Array'); e.code = 'ERR_INVALID_ARG_TYPE'; throw e; }
    this.log(data);
  }
  clear() {
    if (this._stdout && this._stdout.isTTY) {
      this._stdout.write('\x1b[1;1H\x1b[0J');
    }
  }
  group(...args) { if (args.length > 0) this.log(...args); this._groupIndent += '  '; }
  groupEnd() { if (this._groupIndent.length >= 2) this._groupIndent = this._groupIndent.slice(2); }
  groupCollapsed(...args) { this.group(...args); }
  dirxml(...args) { this.log(...args); }
}

module.exports = new Console(null, null);
module.exports.Console = Console;
