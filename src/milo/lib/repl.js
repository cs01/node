// repl module — full REPL built on readline.Interface
'use strict';

const { Interface } = require('readline');
const vm = require('vm');
const util = require('util');

const REPL_MODE_SLOPPY = Symbol('repl-sloppy');
const REPL_MODE_STRICT = Symbol('repl-strict');

class Recoverable extends SyntaxError {
  constructor(err) {
    super(err.message);
    this.original = err;
  }
}

// Built-in commands — action called with `this` = REPLServer, arg = rest of line
const builtinCommands = {
  help: {
    help: 'Print this help message',
    action() {
      const cmds = Object.keys(this.commands).sort();
      for (const name of cmds) {
        const cmd = this.commands[name];
        const help = cmd.help || '';
        const pad = Math.max(1, 9 - name.length);
        this.output.write(`.${name}${help ? ' '.repeat(pad) + help : ''}\n`);
      }
      this.displayPrompt();
    },
  },
  exit: {
    help: 'Exit the REPL',
    action() { this.close(); },
  },
  clear: {
    help: 'Break, and also clear the local context',
    action() {
      this.output.write('Clearing context...\n');
      this.resetContext();
      this.clearBufferedCommand();
      this.displayPrompt();
    },
  },
  break: {
    help: 'Sometimes you get stuck, this gets you out',
    action() {
      this.clearBufferedCommand();
      this.displayPrompt();
    },
  },
  save: {
    help: '.save <filename> - Save all evaluated commands in this REPL session to a file',
    action(filename) {
      if (!filename) {
        this.output.write('The .save command requires a file path argument.\n');
        this.displayPrompt();
        return;
      }
      try {
        const fs = require('fs');
        fs.writeFileSync(filename.trim(), this.lines.join('\n') + '\n');
        this.output.write('Session saved to: ' + filename.trim() + '\n');
      } catch (e) {
        this.output.write('Failed to save: ' + e.message + '\n');
      }
      this.displayPrompt();
    },
  },
  load: {
    help: '.load <filename> - Load JS from a file into the REPL session',
    action(filename) {
      if (!filename) {
        this.output.write('The .load command requires a file path argument.\n');
        this.displayPrompt();
        return;
      }
      try {
        const fs = require('fs');
        const data = fs.readFileSync(filename.trim(), 'utf8');
        for (const line of data.split('\n')) {
          this.output.write(this.getPrompt() + line + '\n');
        }
        this._eval(data, this.context, 'repl', (err, result) => {
          if (err) this._writeError(err);
          else if (result !== undefined || !this.ignoreUndefined) {
            this.output.write(this.writer(result) + '\n');
          }
          this.displayPrompt();
        });
      } catch (e) {
        this.output.write('Failed to load: ' + e.message + '\n');
        this.displayPrompt();
      }
    },
  },
  editor: {
    help: 'Enter editor mode',
    action() {
      this.editorMode = true;
      this._editorBuffer = '';
      this.output.write('// Entering editor mode (Ctrl+D to finish, Ctrl+C to cancel)\n');
    },
  },
};

class REPLServer extends Interface {
  constructor(prompt, stream, eval_, useGlobal, ignoreUndefined, replMode) {
    let opts = {};
    if (typeof prompt === 'object' && prompt !== null) {
      opts = prompt;
      prompt = opts.prompt;
      stream = opts.input || opts.stream;
      eval_ = opts.eval;
      useGlobal = opts.useGlobal;
      ignoreUndefined = opts.ignoreUndefined;
      replMode = opts.replMode;
    }

    const input = stream || process.stdin;
    const output = opts.output || process.stdout;
    const terminal = opts.terminal !== undefined ? opts.terminal : !!(output && output.isTTY);

    super({ input, output, terminal, prompt: prompt !== undefined ? prompt : '> ' });

    this.input = input;
    this.output = output;
    this.prompt = prompt !== undefined ? prompt : '> ';
    this._eval = eval_ || defaultEval;
    this.useGlobal = !!useGlobal;
    this.ignoreUndefined = !!ignoreUndefined;
    this.replMode = replMode || REPL_MODE_SLOPPY;
    this.useColors = opts.useColors !== undefined ? opts.useColors : false;
    this.preview = opts.preview !== undefined ? opts.preview : true;
    this.breakEvalOnSigint = !!opts.breakEvalOnSigint;

    this.commands = {};
    this.editorMode = false;
    this._editorBuffer = '';
    this.underscoreAssigned = false;
    this.last = undefined;
    this.lines = [];
    this.line = '';
    this.cursor = 0;
    this._domain = null;
    this._bufferedCommand = '';

    Object.defineProperty(this, '_', {
      get: () => this.last,
      set: (v) => { this.last = v; this.underscoreAssigned = true; },
      configurable: true,
      enumerable: true,
    });

    // Writer function for formatting output with inspect
    const writerColors = opts.useColors !== undefined ? opts.useColors : (terminal && output && output.isTTY);
    this.writer = (obj) => util.inspect(obj, this.writer.options);
    this.writer.options = Object.assign({}, util.inspect.defaultOptions, { colors: writerColors });
    if (util.inspect.replDefaults) {
      Object.assign(this.writer.options, util.inspect.replDefaults);
    }

    this.context = this._createContext();

    for (const [name, cmd] of Object.entries(builtinCommands)) {
      this.defineCommand(name, cmd);
    }

    this.setPrompt(this.prompt);

    // Replace readline's line handler with our own
    this.removeAllListeners('line');
    this.on('line', (line) => this._onLine(line));

    this.on('close', () => this.emit('exit'));

    this.on('SIGINT', () => {
      if (this.editorMode) {
        this.editorMode = false;
        this._editorBuffer = '';
        this.output.write('\n');
        if (this._bufferedCommand.length === 0 && this.line.length === 0) {
          this.output.write('(To exit, press Ctrl+C again or Ctrl+D or type .exit)\n');
        }
        this.clearBufferedCommand();
        this.displayPrompt();
        return;
      }
      if (this._bufferedCommand.length > 0) {
        this.clearBufferedCommand();
        this.displayPrompt();
        return;
      }
      if (this.line.length === 0) {
        this.output.write('\n(To exit, press Ctrl+C again or Ctrl+D or type .exit)\n');
        this.displayPrompt();
      } else {
        this.line = '';
        this.cursor = 0;
        this.output.write('\n');
        this.displayPrompt();
      }
    });

    this.displayPrompt();
  }

  _createContext() {
    let context;
    if (this.useGlobal) {
      context = globalThis;
    } else {
      context = vm.createContext();
      for (const name of ['Array', 'Boolean', 'Date', 'Error', 'EvalError',
        'Function', 'Infinity', 'JSON', 'Math', 'NaN', 'Number', 'Object',
        'RangeError', 'ReferenceError', 'RegExp', 'String', 'Symbol',
        'SyntaxError', 'TypeError', 'URIError', 'undefined',
        'parseInt', 'parseFloat', 'isNaN', 'isFinite',
        'decodeURI', 'decodeURIComponent', 'encodeURI', 'encodeURIComponent',
        'Map', 'Set', 'WeakMap', 'WeakSet', 'Promise', 'Proxy', 'Reflect',
        'ArrayBuffer', 'SharedArrayBuffer', 'DataView',
        'Uint8Array', 'Int8Array', 'Uint16Array', 'Int16Array',
        'Uint32Array', 'Int32Array', 'Float32Array', 'Float64Array',
        'BigInt64Array', 'BigUint64Array', 'BigInt',
        'TextEncoder', 'TextDecoder', 'URL', 'URLSearchParams',
        'queueMicrotask', 'structuredClone', 'atob', 'btoa',
        'AbortController', 'AbortSignal',
        'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
        'Buffer', 'process', 'console', 'require']) {
        if (name in globalThis) {
          try { context[name] = globalThis[name]; } catch {}
        }
      }
      try {
        const Console = require('console').Console;
        if (Console) context.console = new Console(this.output);
      } catch {}
      context.global = context;
      context.module = { exports: {} };
    }
    return context;
  }

  _onLine(line) {
    this.line = line;

    if (this.editorMode) {
      this._editorBuffer += line + '\n';
      const match = line.match(/^(\s+)/);
      if (match) {
        this.line = match[1];
        this.cursor = match[1].length;
      } else {
        this.line = '';
        this.cursor = 0;
      }
      return;
    }

    const trimmed = line.trim();
    if (trimmed.startsWith('.') && this._bufferedCommand.length === 0) {
      const spaceIdx = trimmed.indexOf(' ');
      const cmdName = spaceIdx > 0 ? trimmed.substring(1, spaceIdx) : trimmed.substring(1);
      const cmdArg = spaceIdx > 0 ? trimmed.substring(spaceIdx + 1) : '';
      if (this.commands[cmdName]) {
        this.commands[cmdName].action.call(this, cmdArg);
        return;
      }
    }

    this.lines.push(line);
    const code = this._bufferedCommand + line + '\n';

    // Pass to eval — even empty lines go through (Node compat)
    this._eval(code, this.context, 'repl', (err, result) => {
      if (err) {
        if (err instanceof Recoverable || err.repikit) {
          this._bufferedCommand = code;
          this.displayPrompt();
          return;
        }
        this._bufferedCommand = '';
        this._writeError(err);
      } else {
        this._bufferedCommand = '';
        if (!this.underscoreAssigned) this.last = result;
        if (result !== undefined || !this.ignoreUndefined) {
          this.output.write(this.writer(result) + '\n');
        }
      }
      this.displayPrompt();
    });
  }

  _writeError(err) {
    let errStr;
    if (err && err.stack) {
      errStr = err.stack;
    } else if (err && err.message) {
      const name = (err.constructor && err.constructor.name) || 'Error';
      errStr = `Uncaught ${name}: ${err.message}`;
    } else {
      errStr = 'Uncaught ' + String(err);
    }
    if (!errStr.startsWith('Uncaught ') && !errStr.includes('Uncaught ')) {
      errStr = 'Uncaught ' + errStr;
    }
    this.output.write(errStr + '\n');
  }

  write(data, key) {
    if (key && typeof key === 'object') {
      if (key.ctrl && key.name === 'd') {
        if (this.editorMode) {
          this.editorMode = false;
          const code = this._editorBuffer;
          this._editorBuffer = '';
          if (code.trim()) {
            this._eval(code, this.context, 'repl', (err, result) => {
              if (err) this._writeError(err);
              else if (result !== undefined || !this.ignoreUndefined) {
                if (!this.underscoreAssigned) this.last = result;
                this.output.write(this.writer(result) + '\n');
              }
              this.displayPrompt();
            });
          } else {
            this.displayPrompt();
          }
          return;
        }
        if (this.line.length === 0) this.emit('close');
        return;
      }
      if (key.ctrl && key.name === 'c') {
        this.emit('SIGINT');
        return;
      }
      return;
    }
    if (typeof data === 'string') {
      if (this.input && typeof this.input.emit === 'function') {
        this.input.emit('data', data);
      } else {
        this._buf = (this._buf || '') + data;
        let nl;
        while ((nl = this._buf.indexOf('\n')) >= 0) {
          const line = this._buf.slice(0, nl).replace(/\r$/, '');
          this._buf = this._buf.slice(nl + 1);
          this._onLine(line);
        }
      }
    }
  }

  displayPrompt(preserveCursor) {
    if (!this.output) return;
    const prompt = this._bufferedCommand.length > 0 ? '... ' : this.getPrompt();
    if (this.terminal) {
      this.output.write(`\x1b[1G\x1b[0J${prompt}\x1b[${prompt.length + 1}G`);
    } else {
      this.output.write(prompt);
    }
  }

  getPrompt() { return this.prompt; }

  setPrompt(prompt) {
    this.prompt = prompt;
    super.setPrompt(prompt);
  }

  defineCommand(keyword, cmd) {
    if (typeof cmd === 'function') {
      cmd = { action: cmd };
    }
    this.commands[keyword] = {
      help: cmd.help || '',
      action: cmd.action,
    };
  }

  clearBufferedCommand() {
    this._bufferedCommand = '';
    this.line = '';
    this.lines = [];
  }

  setupHistory(historyPath, cb) {
    if (cb) process.nextTick(() => cb(null, this));
  }

  createContext() {
    this.context = this._createContext();
    return this.context;
  }

  resetContext() {
    this.createContext();
    this.underscoreAssigned = false;
    this.last = undefined;
    this.lines = [];
  }

  close() { super.close(); }
  pause() { if (this.input && this.input.pause) this.input.pause(); return this; }
  resume() { if (this.input && this.input.resume) this.input.resume(); return this; }
}

function defaultEval(code, context, file, cb) {
  try {
    let result;
    if (context === globalThis) {
      result = eval(code);
    } else if (vm.runInContext) {
      result = vm.runInContext(code, context, { filename: file });
    } else {
      result = eval(code);
    }
    cb(null, result);
  } catch (e) {
    if (isRecoverableError(e)) {
      cb(new Recoverable(e));
    } else {
      cb(e);
    }
  }
}

function isRecoverableError(e) {
  if (!(e instanceof SyntaxError)) return false;
  const msg = e.message;
  return msg.includes('Unexpected end of input') ||
         msg.includes('Unexpected token') ||
         msg.includes('missing ) after argument list');
}

function start(prompt, source, eval_, useGlobal, ignoreUndefined) {
  if (typeof prompt === 'object' && prompt !== null) {
    return new REPLServer(prompt);
  }
  return new REPLServer(prompt, source, eval_, useGlobal, ignoreUndefined);
}

if (!util.inspect.replDefaults) {
  util.inspect.replDefaults = {};
}

module.exports = {
  start,
  REPLServer,
  REPL_MODE_SLOPPY,
  REPL_MODE_STRICT,
  Recoverable,
  builtinModules: require('module').builtinModules,
};
