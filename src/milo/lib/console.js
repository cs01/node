// console module
'use strict';

const { inspect } = require('util');

// Marks a stream that already has a console-owned 'error'-swallowing listener.
const _kConsoleErrSwallow = Symbol('kConsoleErrSwallow');

function _invalidArgTypeHelper(value) {
  if (value == null) return ' Received ' + value;
  if (typeof value === 'function') return ' Received function ' + (value.name || '');
  if (typeof value === 'object') return ' Received an instance of ' + (value.constructor && value.constructor.name || 'Object');
  return ' Received type ' + typeof value + ' (' + inspect(value, { colors: false }) + ')';
}

// A stack overflow during a write is never swallowed, even with ignoreErrors.
function _isStackOverflow(e) {
  return e instanceof RangeError && typeof e.message === 'string' && e.message.includes('call stack');
}

class Console {
  constructor(stdout, stderr, opts) {
    if (typeof stdout === 'object' && stdout !== null && !stdout.write) {
      opts = stdout;
      stdout = opts.stdout;
      stderr = opts.stderr;
    }
    if (typeof opts === 'boolean') {
      // Console(stdout, stderr, ignoreErrors)
      opts = { ignoreErrors: opts };
    }
    if (!stdout || typeof stdout.write !== 'function') {
      const e = new TypeError('Console expects a writable stream instance for stdout');
      e.code = 'ERR_CONSOLE_WRITABLE_STREAM'; throw e;
    }
    if (stderr && typeof stderr.write !== 'function') {
      const e = new TypeError('Console expects a writable stream instance for stderr');
      e.code = 'ERR_CONSOLE_WRITABLE_STREAM'; throw e;
    }
    if (opts && opts.inspectOptions !== undefined) {
      if (opts.inspectOptions === null || typeof opts.inspectOptions !== 'object') {
        const e = new TypeError('The "options.inspectOptions" property must be of type object.' + _invalidArgTypeHelper(opts.inspectOptions));
        e.code = 'ERR_INVALID_ARG_TYPE'; throw e;
      }
    }
    let groupIndentation = 2;
    if (opts && opts.groupIndentation !== undefined) {
      const gi = opts.groupIndentation;
      if (typeof gi !== 'number') { const e = new TypeError(`The "options.groupIndentation" property must be of type number.${_invalidArgTypeHelper(gi)}`); e.code = 'ERR_INVALID_ARG_TYPE'; throw e; }
      if (!Number.isInteger(gi)) { const e = new RangeError(`The value of "options.groupIndentation" is out of range. It must be an integer. Received ${gi}`); e.code = 'ERR_OUT_OF_RANGE'; throw e; }
      if (gi < 0 || gi > 1000) { const e = new RangeError(`The value of "options.groupIndentation" is out of range. It must be >= 0 && <= 1000. Received ${gi}`); e.code = 'ERR_OUT_OF_RANGE'; throw e; }
      groupIndentation = gi;
    }
    this._stdout = stdout;
    this._stderr = stderr || stdout;
    this._times = new Map();
    this._counts = new Map();
    this._groupIndent = '';
    this._groupIndentationWidth = groupIndentation;
    this._ignoreErrors = opts ? opts.ignoreErrors !== false : true;
    this._colorMode = opts && opts.colorMode;
    this._inspectOptions = opts && opts.inspectOptions;
    // Bind methods so they work when detached (e.g., [1,2,3].forEach(c.log))
    const proto = Object.getPrototypeOf(this);
    const keys = new Set();
    let p = proto;
    while (p && p !== Object.prototype) {
      for (const k of Object.getOwnPropertyNames(p)) {
        if (k !== 'constructor' && !keys.has(k) && typeof p[k] === 'function') {
          keys.add(k);
          const bound = p[k].bind(this);
          Object.defineProperty(bound, 'name', { value: k });
          this[k] = bound;
        }
      }
      p = Object.getPrototypeOf(p);
    }
  }

  _fmt(...args) {
    if (args.length === 0) return '';
    if (typeof args[0] === 'string' && args.length > 1) return require('util').format(...args);
    return args.map(a => typeof a === 'string' ? a : inspect(a)).join(' ');
  }

  _indented(s) {
    // group indentation applies to every line of the output, not just the first.
    return this._groupIndent ? this._groupIndent + s.replace(/\n/g, '\n' + this._groupIndent) + '\n' : s + '\n';
  }

  // Write `msg` to `stream` (or the native binding fallback). With ignoreErrors,
  // both synchronous throws AND asynchronous 'error' events (e.g. a write callback
  // invoked with an error) must be swallowed — hence the temporary 'error' listener
  // plus a write callback that removes it. A stack overflow is never swallowed.
  _writeTo(stream, msg, bindingFn) {
    if (this._ignoreErrors === false) {
      if (stream && stream.write) stream.write(msg);
      else bindingFn(msg);
      return;
    }
    try {
      if (stream && stream.write) {
        // Async write errors surface as an 'error' event (emitted on a later tick),
        // which crashes if unhandled. Attach ONE persistent swallowing listener per
        // stream (idempotent) — avoids per-write add/remove races and listener leaks.
        if (stream.on && !stream[_kConsoleErrSwallow]) {
          stream[_kConsoleErrSwallow] = true;
          stream.on('error', () => {});
        }
        stream.write(msg);
      } else {
        bindingFn(msg);
      }
    } catch (e) { if (_isStackOverflow(e)) throw e; }
  }

  log(...args) {
    this._writeTo(this._stdout, this._indented(this._fmt(...args)), (m) => internalBinding('_console').write(m));
  }

  info(...args) { this.log(...args); }
  debug(...args) { this.log(...args); }
  dir(obj, opts) { this.log(inspect(obj, opts)); }

  error(...args) {
    this._writeTo(this._stderr, this._indented(this._fmt(...args)), (m) => internalBinding('_console').writeError(m));
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
    if (typeof label === 'symbol') throw new TypeError('Cannot convert a Symbol value to a string');
    label = label === undefined ? 'default' : String(label);
    const c = (this._counts.get(label) || 0) + 1;
    this._counts.set(label, c);
    this.log(`${label}: ${c}`);
  }
  countReset(label) {
    if (typeof label === 'symbol') throw new TypeError('Cannot convert a Symbol value to a string');
    this._counts.set(label === undefined ? 'default' : String(label), 0);
  }

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
  group(...args) { if (args.length > 0) this.log(...args); this._groupIndent += ' '.repeat(this._groupIndentationWidth); }
  groupEnd() { const w = this._groupIndentationWidth; if (this._groupIndent.length >= w) this._groupIndent = this._groupIndent.slice(0, this._groupIndent.length - w); }
  groupCollapsed(...args) { this.group(...args); }
  dirxml(...args) { this.log(...args); }
}

// Wrap so Console() works without new (ES6 classes throw otherwise)
function ConsoleWrapper(stdout, stderr, opts) {
  if (new.target) return Reflect.construct(Console, [stdout, stderr, opts], new.target);
  return new Console(stdout, stderr, opts);
}
ConsoleWrapper.prototype = Console.prototype;
Console.prototype.constructor = ConsoleWrapper;
Object.defineProperty(ConsoleWrapper, Symbol.hasInstance, {
  value: (instance) => instance instanceof Console
});

// Always return globalThis.console so require('console') === globalThis.console
const _gc = globalThis.console;
if (_gc && !(_gc instanceof Console)) Object.setPrototypeOf(_gc, Console.prototype);
if (_gc) { _gc.Console = ConsoleWrapper; module.exports = _gc; }
else { module.exports = new Console(null, null); module.exports.Console = ConsoleWrapper; }
