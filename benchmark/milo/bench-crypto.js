'use strict';

const crypto = require('crypto');

const WARMUP_MS = 500;
const DURATION_MS = 3000;

function now() {
  if (process.hrtime && process.hrtime.bigint) {
    return Number(process.hrtime.bigint()) / 1e6;
  }
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

// --- Test data ---
const small = Buffer.from('hello world');
const medium = crypto.randomBytes(1024);
const large = crypto.randomBytes(65536);

const benchmarks = [
  ['sha256-small (11B)', () => crypto.createHash('sha256').update(small).digest('hex')],
  ['sha256-medium (1KB)', () => crypto.createHash('sha256').update(medium).digest('hex')],
  ['sha256-large (64KB)', () => crypto.createHash('sha256').update(large).digest('hex')],
  ['sha512-medium (1KB)', () => crypto.createHash('sha512').update(medium).digest('hex')],
  ['md5-medium (1KB)', () => crypto.createHash('md5').update(medium).digest('hex')],
  ['hmac-sha256 (1KB)', () => crypto.createHmac('sha256', 'secret-key').update(medium).digest('hex')],
  ['randomBytes(16)', () => crypto.randomBytes(16)],
  ['randomBytes(256)', () => crypto.randomBytes(256)],
  ['randomBytes(4096)', () => crypto.randomBytes(4096)],
  ['randomFillSync(256)', () => { const b = Buffer.alloc(256); crypto.randomFillSync(b); return b; }],
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
  const r = runBench(name, fn);
  console.log(`${r.name.padEnd(30)} ${r.opsPerSec.toLocaleString().padStart(12)} ${r.ops.toLocaleString().padStart(12)}`);
}
