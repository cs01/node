// string_decoder module — function-based for util.inherits compat
'use strict';

function StringDecoder(encoding) {
  this.encoding = (encoding || 'utf8').toLowerCase().replace('-', '');
  this.lastNeed = 0;
  this.lastTotal = 0;
  this.lastChar = new Uint8Array(4);
}

StringDecoder.prototype.write = function(buf) {
  if (!buf || buf.length === 0) return '';
  if (typeof buf === 'string') buf = Buffer.from(buf);
  if (this.encoding === 'utf8') return this._utf8Write(buf);
  if (this.encoding === 'base64' || this.encoding === 'base64url') {
    var input = buf;
    if (this._pendingBytes && this._pendingBytes.length > 0) {
      input = Buffer.concat([Buffer.from(this._pendingBytes), buf]);
    }
    var usable = input.length - (input.length % 3);
    if (usable === 0) { this._pendingBytes = Array.from(input); return ''; }
    this._pendingBytes = usable < input.length ? Array.from(input.subarray ? input.subarray(usable) : input.slice(usable)) : [];
    var result = Buffer.from(input.subarray ? input.subarray(0, usable) : input.slice(0, usable)).toString('base64');
    if (this.encoding === 'base64url') { result = result.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, ''); }
    return result;
  }
  if (this.encoding === 'hex') return Buffer.from(buf).toString('hex');
  if (this.encoding === 'utf16le' || this.encoding === 'ucs2') {
    var _input = buf;
    if (this._pendingBytes && this._pendingBytes.length > 0) {
      _input = Buffer.concat([Buffer.from(this._pendingBytes), buf]);
    }
    var _usable = _input.length - (_input.length % 2);
    if (_usable === 0) { this._pendingBytes = Array.from(_input); return ''; }
    this._pendingBytes = _usable < _input.length ? Array.from(_input.subarray ? _input.subarray(_usable) : _input.slice(_usable)) : [];
    return Buffer.from(_input.subarray ? _input.subarray(0, _usable) : _input.slice(0, _usable)).toString('utf16le');
  }
  // latin1/ascii/binary
  var s = '';
  for (var i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
  return s;
};

StringDecoder.prototype.end = function(buf) {
  var r = '';
  if (buf && buf.length) r = this.write(buf);
  if ((this.encoding === 'base64' || this.encoding === 'base64url') && this._pendingBytes && this._pendingBytes.length > 0) {
    var tail = Buffer.from(this._pendingBytes).toString('base64');
    if (this.encoding === 'base64url') { tail = tail.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, ''); }
    r += tail;
    this._pendingBytes = [];
    return r;
  }
  if ((this.encoding === 'utf16le' || this.encoding === 'ucs2') && this._pendingBytes && this._pendingBytes.length > 0) {
    r += Buffer.from(this._pendingBytes).toString('utf16le');
    this._pendingBytes = [];
    return r;
  }
  if (this.lastNeed) {
    r += '�';
    this.lastNeed = 0;
    return r;
  }
  return r;
};

StringDecoder.prototype._utf8Write = function(buf) {
  var s = '';
  var i = 0;
  if (this.lastNeed) {
    // Fill incomplete sequence, validating continuation bytes
    while (i < buf.length && this.lastNeed > 0) {
      if ((buf[i] & 0xc0) !== 0x80) {
        // Not a continuation byte — emit replacement for incomplete sequence
        s += '�';
        this.lastNeed = 0;
        break;
      }
      this.lastChar[this.lastTotal - this.lastNeed] = buf[i];
      this.lastNeed--;
      i++;
    }
    if (this.lastNeed === 0 && i > 0 && (buf[i - 1] & 0xc0) === 0x80) {
      var view = new Uint8Array(this.lastChar.buffer, 0, this.lastTotal);
      s += new TextDecoder().decode(view);
    }
    if (this.lastNeed > 0) return s;
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
  // Returns count of incomplete bytes at end of buf (0 = complete)
  var c = buf.length;
  if (c === 0) return 0;
  // Check last byte
  var b = buf[c - 1];
  if (b < 0x80) return 0; // ASCII, complete
  // Lead byte at last position: entire lead is trailing
  if ((b & 0xe0) === 0xc0) return 1; // 2-byte lead, need 1 more
  if ((b & 0xf0) === 0xe0) return 1; // 3-byte lead, need 2 more
  if ((b & 0xf8) === 0xf0) return 1; // 4-byte lead, need 3 more
  // Continuation byte — walk backwards to find the lead
  if ((b & 0xc0) === 0x80) {
    for (var i = c - 2; i >= 0 && i >= c - 4; i--) {
      b = buf[i];
      if ((b & 0xc0) !== 0x80) {
        var needed = this._utf8ByteLen(b);
        var have = c - i;
        if (have >= needed) return 0; // complete
        return have; // incomplete
      }
    }
    return 0; // no lead found — standalone continuation bytes, let TextDecoder handle them
  }
  return 0;
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
