// string_decoder module — function-based for util.inherits compat
'use strict';

function StringDecoder(encoding) {
  if (!(this instanceof StringDecoder)) return new StringDecoder(encoding);
  this.encoding = (encoding || 'utf8').toLowerCase().replace('-', '');
  this.lastNeed = 0;
  this.lastTotal = 0;
  this.lastChar = new Uint8Array(4);
}

StringDecoder.prototype.write = function(buf) {
  if (!buf || buf.length === 0) return '';
  if (this.encoding === 'utf8' || this.encoding === 'utf-8') return this._utf8Write(buf);
  var s = '';
  for (var i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
  return s;
};

StringDecoder.prototype.end = function(buf) {
  var r = '';
  if (buf && buf.length) r = this.write(buf);
  if (this.lastNeed) return r + '�';
  return r;
};

StringDecoder.prototype._utf8Write = function(buf) {
  var s = '';
  var i = 0;
  if (this.lastNeed) {
    var need = Math.min(buf.length, this.lastNeed);
    for (var j = 0; j < need; j++) this.lastChar[this.lastTotal - this.lastNeed + j] = buf[j];
    this.lastNeed -= need;
    i = need;
    if (this.lastNeed === 0) {
      var view = new Uint8Array(this.lastChar.buffer, 0, this.lastTotal);
      s += new TextDecoder().decode(view);
    } else return '';
  }
  if (i >= buf.length) return s;
  var remaining = buf.subarray ? buf.subarray(i) : buf.slice(i);
  var trail = this._utf8Trailing(remaining);
  if (trail === 0) return s + new TextDecoder().decode(remaining);
  var safe = remaining.subarray ? remaining.subarray(0, remaining.length - trail) : remaining.slice(0, remaining.length - trail);
  if (safe.length > 0) s += new TextDecoder().decode(safe);
  var partial = remaining.subarray ? remaining.subarray(remaining.length - trail) : remaining.slice(remaining.length - trail);
  this.lastNeed = this._utf8ByteLen(partial[0]) - trail;
  this.lastTotal = this._utf8ByteLen(partial[0]);
  for (var k = 0; k < trail; k++) this.lastChar[k] = partial[k];
  return s;
};

StringDecoder.prototype._utf8Trailing = function(buf) {
  var c = buf.length;
  if (c === 0) return 0;
  var last = buf[c - 1];
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
};

StringDecoder.prototype._utf8ByteLen = function(b) {
  if (b < 0x80) return 1;
  if ((b & 0xe0) === 0xc0) return 2;
  if ((b & 0xf0) === 0xe0) return 3;
  if ((b & 0xf8) === 0xf0) return 4;
  return 1;
};

module.exports = { StringDecoder };
