// HTTP/2 frame codec (RFC 7540 §4-6). Pure Buffer in/out — no I/O here.
'use strict';

const FRAME = {
  DATA: 0x0, HEADERS: 0x1, PRIORITY: 0x2, RST_STREAM: 0x3, SETTINGS: 0x4,
  PUSH_PROMISE: 0x5, PING: 0x6, GOAWAY: 0x7, WINDOW_UPDATE: 0x8, CONTINUATION: 0x9,
};
const FLAG = {
  END_STREAM: 0x1, ACK: 0x1, END_HEADERS: 0x4, PADDED: 0x8, PRIORITY: 0x20,
};
// Client connection preface that opens every HTTP/2 connection.
const PREFACE = Buffer.from('PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n', 'latin1');

// SETTINGS parameter ids
const SETTINGS = {
  HEADER_TABLE_SIZE: 0x1, ENABLE_PUSH: 0x2, MAX_CONCURRENT_STREAMS: 0x3,
  INITIAL_WINDOW_SIZE: 0x4, MAX_FRAME_SIZE: 0x5, MAX_HEADER_LIST_SIZE: 0x6,
};

function serializeFrame(type, flags, streamId, payload) {
  payload = payload || Buffer.alloc(0);
  const len = payload.length;
  const buf = Buffer.allocUnsafe(9 + len);
  buf[0] = (len >>> 16) & 0xff;
  buf[1] = (len >>> 8) & 0xff;
  buf[2] = len & 0xff;
  buf[3] = type & 0xff;
  buf[4] = flags & 0xff;
  buf.writeUInt32BE((streamId >>> 0) & 0x7fffffff, 5);
  if (len) payload.copy(buf, 9);
  return buf;
}

// Parse as many whole frames as `buf` contains. Returns { frames, rest }.
function parseFrames(buf) {
  const frames = [];
  let off = 0;
  while (buf.length - off >= 9) {
    const len = (buf[off] << 16) | (buf[off + 1] << 8) | buf[off + 2];
    if (buf.length - off - 9 < len) break; // wait for the rest of the payload
    const type = buf[off + 3];
    const flags = buf[off + 4];
    const streamId = buf.readUInt32BE(off + 5) & 0x7fffffff;
    const payload = buf.subarray(off + 9, off + 9 + len);
    frames.push({ type, flags, streamId, payload });
    off += 9 + len;
  }
  return { frames, rest: off === 0 ? buf : buf.subarray(off) };
}

// Strip a DATA/HEADERS frame's padding, returning the real payload slice.
// For HEADERS, also skips the priority block when the PRIORITY flag is set.
function stripPadding(payload, flags, isHeaders) {
  let p = payload;
  let padLen = 0;
  if (flags & FLAG.PADDED) { padLen = p[0]; p = p.subarray(1); }
  if (isHeaders && (flags & FLAG.PRIORITY)) p = p.subarray(5); // 4b dep + 1b weight
  if (padLen) p = p.subarray(0, p.length - padLen);
  return p;
}

function packSettings(settings) {
  const entries = Object.entries(settings);
  const buf = Buffer.allocUnsafe(entries.length * 6);
  let o = 0;
  for (const [id, val] of entries) {
    buf.writeUInt16BE(id & 0xffff, o);
    buf.writeUInt32BE(val >>> 0, o + 2);
    o += 6;
  }
  return buf;
}

function unpackSettings(payload) {
  const out = {};
  for (let o = 0; o + 6 <= payload.length; o += 6) {
    out[payload.readUInt16BE(o)] = payload.readUInt32BE(o + 2);
  }
  return out;
}

module.exports = { FRAME, FLAG, PREFACE, SETTINGS, serializeFrame, parseFrames, stripPadding, packSettings, unpackSettings };
