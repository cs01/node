// console module
'use strict';

const { inspect } = require('util');

class Console {
  constructor(stdout, stderr) {
    this._stdout = stdout;
    this._stderr = stderr || stdout;
    this._times = new Map();
    this._counts = new Map();
  }

  log(...args) {
    const msg = args.map(a => typeof a === 'object' && a !== null ? inspect(a) : String(a)).join(' ') + '\n';
    if (this._stdout && this._stdout.write) this._stdout.write(msg);
    else internalBinding('_console').write(msg);
  }

  info(...args) { this.log(...args); }
  debug(...args) { this.log(...args); }
  dir(obj, opts) { this.log(inspect(obj, opts)); }

  error(...args) {
    const msg = args.map(a => typeof a === 'object' && a !== null ? inspect(a) : String(a)).join(' ') + '\n';
    if (this._stderr && this._stderr.write) this._stderr.write(msg);
    else internalBinding('_console').writeError(msg);
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

  table(data) { this.log(data); }
  clear() {
    if (this._stdout && this._stdout.isTTY) {
      this._stdout.write('\x1b[1;1H\x1b[0J');
    }
  }
  group(...args) { if (args.length > 0) this.log(...args); }
  groupEnd() {}
  dirxml(...args) { this.log(...args); }
}

module.exports = new Console(null, null);
module.exports.Console = Console;
