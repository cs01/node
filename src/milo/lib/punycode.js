// punycode module — RFC 3492
'use strict';

const maxInt = 2147483647, base = 36, tMin = 1, tMax = 26, skew = 38, damp = 700, initialBias = 72, initialN = 128;

function adapt(delta, numPoints, firstTime) {
  delta = firstTime ? Math.floor(delta / damp) : delta >> 1;
  delta += Math.floor(delta / numPoints);
  let k = 0;
  while (delta > ((base - tMin) * tMax) >> 1) { delta = Math.floor(delta / (base - tMin)); k += base; }
  return Math.floor(k + (base - tMin + 1) * delta / (delta + skew));
}

function digitToBasic(d) { return d + 22 + 75 * (d < 26 ? 1 : 0); }
function basicToDigit(c) { if (c - 48 < 10) return c - 22; if (c - 65 < 26) return c - 65; if (c - 97 < 26) return c - 97; return base; }

function decode(input) {
  const output = []; let i = 0, n = initialN, bias = initialBias;
  let basic = input.lastIndexOf('-');
  if (basic < 0) basic = 0;
  for (let j = 0; j < basic; j++) output.push(input.charCodeAt(j));
  for (let idx = basic > 0 ? basic + 1 : 0; idx < input.length;) {
    let oldi = i, w = 1;
    for (let k = base; ; k += base) {
      const digit = basicToDigit(input.charCodeAt(idx++));
      i += digit * w;
      const t = k <= bias ? tMin : k >= bias + tMax ? tMax : k - bias;
      if (digit < t) break;
      w *= base - t;
    }
    bias = adapt(i - oldi, output.length + 1, oldi === 0);
    n += Math.floor(i / (output.length + 1));
    i %= output.length + 1;
    output.splice(i++, 0, n);
  }
  return String.fromCodePoint(...output);
}

function encode(input) {
  const output = []; let n = initialN, delta = 0, bias = initialBias;
  const codePoints = [...input].map(c => c.codePointAt(0));
  for (const cp of codePoints) { if (cp < 0x80) output.push(String.fromCharCode(cp)); }
  let h = output.length, b = output.length;
  if (b > 0) output.push('-');
  while (h < codePoints.length) {
    let m = maxInt;
    for (const cp of codePoints) { if (cp >= n && cp < m) m = cp; }
    delta += (m - n) * (h + 1);
    n = m;
    for (const cp of codePoints) {
      if (cp < n) delta++;
      if (cp === n) {
        let q = delta;
        for (let k = base; ; k += base) {
          const t = k <= bias ? tMin : k >= bias + tMax ? tMax : k - bias;
          if (q < t) break;
          output.push(String.fromCharCode(digitToBasic(t + (q - t) % (base - t))));
          q = Math.floor((q - t) / (base - t));
        }
        output.push(String.fromCharCode(digitToBasic(q)));
        bias = adapt(delta, h + 1, h === b);
        delta = 0;
        h++;
      }
    }
    delta++;
    n++;
  }
  return output.join('');
}

function toASCII(domain) { return domain.split('.').map(l => /[^\x00-\x7E]/.test(l) ? 'xn--' + encode(l) : l).join('.'); }
function toUnicode(domain) { return domain.split('.').map(l => l.startsWith('xn--') ? decode(l.slice(4)) : l).join('.'); }

module.exports = { decode, encode, toASCII, toUnicode, ucs2: { decode: (s) => [...s].map(c => c.codePointAt(0)), encode: (a) => String.fromCodePoint(...a) }, version: '2.3.1' };
