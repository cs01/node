// readline module — Interface over streams
'use strict';

const EventEmitter = require('events');

class Interface extends EventEmitter {
  constructor(input, output, completer, terminal) {
    super();
    if (typeof input === 'object' && !(input instanceof require('stream').Readable)) {
      const opts = input;
      input = opts.input;
      output = opts.output;
      completer = opts.completer;
      terminal = opts.terminal;
    }
    this.input = input;
    this.output = output || null;
    this.completer = completer || null;
    this.terminal = terminal !== undefined ? terminal : false;
    this.line = '';
    this.cursor = 0;
    this.closed = false;
    this._buf = '';

    if (input) {
      const onData = (data) => {
        this._buf += String(data);
        let nl;
        while ((nl = this._buf.indexOf('\n')) >= 0) {
          const line = this._buf.slice(0, nl).replace(/\r$/, '');
          this._buf = this._buf.slice(nl + 1);
          this.emit('line', line);
        }
      };
      input.on('data', onData);
      input.on('end', () => {
        if (this._buf.length > 0) { this.emit('line', this._buf); this._buf = ''; }
        this.close();
      });
    }
  }

  prompt(preserveCursor) {
    if (this.output && this._prompt) this.output.write(this._prompt);
  }

  setPrompt(prompt) { this._prompt = prompt; }

  write(data) {
    if (data) this._buf += String(data);
  }

  question(query, cb) {
    if (this.output) this.output.write(query);
    this.once('line', cb);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.emit('close');
  }

  pause() { if (this.input && this.input.pause) this.input.pause(); return this; }
  resume() { if (this.input && this.input.resume) this.input.resume(); return this; }

  [Symbol.asyncIterator]() {
    const lines = [];
    let done = false;
    let resolve = null;
    this.on('line', (line) => { if (resolve) { const r = resolve; resolve = null; r({ value: line, done: false }); } else lines.push(line); });
    this.on('close', () => { done = true; if (resolve) { const r = resolve; resolve = null; r({ done: true }); } });
    return {
      next: () => {
        if (lines.length > 0) return Promise.resolve({ value: lines.shift(), done: false });
        if (done) return Promise.resolve({ done: true });
        return new Promise(r => { resolve = r; });
      }
    };
  }
}

function createInterface(input, output, completer, terminal) {
  return new Interface(input, output, completer, terminal);
}

module.exports = { Interface, createInterface };
