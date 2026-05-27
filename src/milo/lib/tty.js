// tty module — ReadStream/WriteStream with raw mode and window size
'use strict';

const net = require('net');
const { Readable, Writable } = require('stream');
const _con = internalBinding('_console');

class ReadStream extends Readable {
  constructor(fd) {
    super();
    this.fd = fd;
    this.isTTY = true;
    this.isRaw = false;
  }

  setRawMode(mode) {
    _con.setRawMode(this.fd, mode ? 1 : 0);
    this.isRaw = !!mode;
    return this;
  }
}

class WriteStream extends Writable {
  constructor(fd) {
    super();
    this.fd = fd;
    this.isTTY = true;
    this._updateSize();
  }

  _updateSize() {
    const size = _con.getWindowSize(this.fd);
    if (size) {
      this.columns = size[0];
      this.rows = size[1];
    } else {
      this.columns = 80;
      this.rows = 24;
    }
  }

  _write(chunk, encoding, cb) {
    const str = typeof chunk === 'string' ? chunk : chunk.toString();
    if (this.fd === 2) _con.writeError(str);
    else _con.write(str);
    if (cb) cb();
  }

  clearLine(dir, cb) {
    const seq = dir < 0 ? '\x1b[1K' : dir > 0 ? '\x1b[0K' : '\x1b[2K';
    this.write(seq);
    if (cb) cb();
    return true;
  }

  cursorTo(x, y, cb) {
    if (typeof y === 'function') { cb = y; y = undefined; }
    if (y !== undefined) this.write(`\x1b[${y + 1};${x + 1}H`);
    else this.write(`\x1b[${x + 1}G`);
    if (cb) cb();
    return true;
  }

  moveCursor(dx, dy, cb) {
    if (dx > 0) this.write(`\x1b[${dx}C`);
    else if (dx < 0) this.write(`\x1b[${-dx}D`);
    if (dy > 0) this.write(`\x1b[${dy}B`);
    else if (dy < 0) this.write(`\x1b[${-dy}A`);
    if (cb) cb();
    return true;
  }

  clearScreenDown(cb) {
    this.write('\x1b[0J');
    if (cb) cb();
    return true;
  }

  getWindowSize() { return [this.columns, this.rows]; }
  getColorDepth() { return 8; }
  hasColors(count) { return (count || 16) <= 256; }
}

function isatty(fd) {
  return !!_con.isatty(fd);
}

module.exports = { ReadStream, WriteStream, isatty };
