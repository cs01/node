// string_decoder module
'use strict';

class StringDecoder {
  constructor(encoding) {
    this.encoding = (encoding || 'utf8').toLowerCase().replace('-', '');
    this.lastNeed = 0;
    this.lastTotal = 0;
    this.lastChar = new Uint8Array(4);
  }

  write(buf) {
    if (!buf || buf.length === 0) return '';
    if (this.encoding === 'utf8' || this.encoding === 'utf-8') return this._utf8Write(buf);
    let s = '';
    for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
    return s;
  }

  end(buf) {
    let r = '';
    if (buf && buf.length) r = this.write(buf);
    if (this.lastNeed) return r + '�';
    return r;
  }

  _utf8Write(buf) {
    let s = '';
    let i = 0;
    if (this.lastNeed) {
      const need = Math.min(buf.length, this.lastNeed);
      for (let j = 0; j < need; j++) this.lastChar[this.lastTotal - this.lastNeed + j] = buf[j];
      this.lastNeed -= need;
      i = need;
      if (this.lastNeed === 0) {
        const view = new Uint8Array(this.lastChar.buffer, 0, this.lastTotal);
        s += new TextDecoder().decode(view);
      } else return '';
    }
    if (i >= buf.length) return s;
    const remaining = buf.subarray ? buf.subarray(i) : buf.slice(i);
    const trail = this._utf8Trailing(remaining);
    if (trail === 0) return s + new TextDecoder().decode(remaining);
    const safe = remaining.subarray ? remaining.subarray(0, remaining.length - trail) : remaining.slice(0, remaining.length - trail);
    if (safe.length > 0) s += new TextDecoder().decode(safe);
    const partial = remaining.subarray ? remaining.subarray(remaining.length - trail) : remaining.slice(remaining.length - trail);
    this.lastNeed = this._utf8ByteLen(partial[0]) - trail;
    this.lastTotal = this._utf8ByteLen(partial[0]);
    for (let j = 0; j < trail; j++) this.lastChar[j] = partial[j];
    return s;
  }

  _utf8Trailing(buf) {
    let c = buf.length;
    if (c === 0) return 0;
    let last = buf[c - 1];
    if (last < 0x80) return 0;
    if ((last & 0xc0) === 0x80) {
      if (c < 2) return 1;
      last = buf[c - 2];
      if ((last & 0xe0) === 0xc0) return 0;
      if ((last & 0xc0) === 0x80) {
        if (c < 3) return 2;
        last = buf[c - 3];
        if ((last & 0xf0) === 0xe0) return 0;
        if ((last & 0xc0) === 0x80) return 3;
        return 0;
      }
      return 0;
    }
    if ((last & 0xe0) === 0xc0) return 1;
    if ((last & 0xf0) === 0xe0) return 2;
    if ((last & 0xf8) === 0xf0) return 3;
    return 0;
  }

  _utf8ByteLen(b) {
    if (b < 0x80) return 1;
    if ((b & 0xe0) === 0xc0) return 2;
    if ((b & 0xf0) === 0xe0) return 3;
    if ((b & 0xf8) === 0xf0) return 4;
    return 1;
  }
}

module.exports = { StringDecoder };
