'use strict';

const WARMUP_MS = 500;
const DURATION_MS = 3000;

function now() {
  if (process.hrtime && process.hrtime.bigint) return Number(process.hrtime.bigint()) / 1e6;
  return Date.now();
}

function runBench(name, fn) {
  const warmEnd = now() + WARMUP_MS;
  while (now() < warmEnd) fn();

  let ops = 0;
  const start = now();
  const deadline = start + DURATION_MS;
  while (now() < deadline) {
    fn();
    ops++;
  }
  const elapsed = now() - start;
  const opsPerSec = Math.round((ops / elapsed) * 1000);
  return { name, ops, elapsed: Math.round(elapsed), opsPerSec };
}

// --- Pre-allocate test data ---
const small = Buffer.from('hello world');
const medium = Buffer.alloc(1024, 0x41);
const large = Buffer.alloc(65536, 0x42);
const chunks = Array.from({ length: 100 }, (_, i) => Buffer.from(`chunk-${i}-data`));
const utf8str = 'The quick brown fox jumps over the lazy dog éèê 1234567890';
const hexBuf = Buffer.from('deadbeef'.repeat(128), 'hex');
const b64str = medium.toString('base64');

const benchmarks = [
  ['alloc(256)', () => Buffer.alloc(256)],
  ['alloc(4096)', () => Buffer.alloc(4096)],
  ['alloc(65536)', () => Buffer.alloc(65536)],
  ['from(string)', () => Buffer.from(utf8str)],
  ['from(array)', () => Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])],
  ['concat(100 chunks)', () => Buffer.concat(chunks)],
  ['toString utf8 (1KB)', () => medium.toString('utf8')],
  ['toString hex (512B)', () => hexBuf.toString('hex')],
  ['toString base64 (1KB)', () => medium.toString('base64')],
  ['from base64 (1KB)', () => Buffer.from(b64str, 'base64')],
  ['slice (1KB)', () => medium.slice(100, 900)],
  ['copy (1KB)', () => { const dst = Buffer.alloc(1024); medium.copy(dst); return dst; }],
  ['readUInt32BE x100', () => { let s = 0; for (let i = 0; i < 400; i += 4) s += medium.readUInt32BE(i); return s; }],
  ['writeUInt32BE x100', () => { const b = Buffer.alloc(400); for (let i = 0; i < 400; i += 4) b.writeUInt32BE(i, i); return b; }],
  ['indexOf (1KB)', () => medium.indexOf(0x41)],
  ['compare', () => Buffer.compare(medium, medium)],
  ['equals', () => medium.equals(medium)],
  ['fill (4KB)', () => { const b = Buffer.alloc(4096); b.fill(0xff); return b; }],
  ['isBuffer check', () => Buffer.isBuffer(medium) && !Buffer.isBuffer('nope')],
  ['byteLength(string)', () => Buffer.byteLength(utf8str, 'utf8')],
];

// --- Run ---
const runtime =
  typeof Bun !== 'undefined' ? `bun ${Bun.version}` :
  `${process.argv[0].includes('milo') ? 'milo-node' : 'node'} ${process.version}`;

console.log(`\nRuntime: ${runtime}`);
console.log(`Warmup: ${WARMUP_MS}ms | Duration: ${DURATION_MS}ms per benchmark\n`);
console.log(`${'Benchmark'.padEnd(30)} ${'ops/sec'.padStart(12)} ${'total ops'.padStart(12)}`);
console.log('-'.repeat(56));

for (const [name, fn] of benchmarks) {
  try {
    const r = runBench(name, fn);
    console.log(`${r.name.padEnd(30)} ${r.opsPerSec.toLocaleString().padStart(12)} ${r.ops.toLocaleString().padStart(12)}`);
  } catch (e) {
    console.log(`${name.padEnd(30)} ${'SKIP'.padStart(12)} ${(e.message || '').slice(0, 20).padStart(12)}`);
  }
}
