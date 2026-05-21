'use strict';

// Standalone benchmark — runs on node, bun, and milo-node without dependencies.
// Usage: <runtime> bench.js

const WARMUP_MS = 500;
const DURATION_MS = 3000;

function now() {
  // process.hrtime.bigint() is most precise, fall back to Date.now()
  if (process.hrtime && process.hrtime.bigint) {
    return Number(process.hrtime.bigint()) / 1e6;
  }
  return Date.now();
}

function runBench(name, fn) {
  // Warmup
  const warmEnd = now() + WARMUP_MS;
  while (now() < warmEnd) fn();

  // Timed run
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

// --- Benchmarks ---

const smallObj = { id: 1, name: 'test', active: true, tags: ['a', 'b', 'c'] };
const smallJson = JSON.stringify(smallObj);

const mediumObj = {
  users: Array.from({ length: 100 }, (_, i) => ({
    id: i,
    name: `user_${i}`,
    email: `user${i}@example.com`,
    active: i % 2 === 0,
    scores: [i * 10, i * 20, i * 30],
    meta: { created: '2025-01-01', role: i % 3 === 0 ? 'admin' : 'user' },
  })),
};
const mediumJson = JSON.stringify(mediumObj);

const largeObj = {
  data: Array.from({ length: 1000 }, (_, i) => ({
    id: i,
    uuid: `550e8400-e29b-41d4-a716-44665544${String(i).padStart(4, '0')}`,
    payload: { x: Math.random(), y: Math.random(), z: Math.random() },
    tags: Array.from({ length: 10 }, (_, j) => `tag_${i}_${j}`),
    nested: { a: { b: { c: { d: i } } } },
  })),
};
const largeJson = JSON.stringify(largeObj);

const deepObj = (() => {
  let o = { value: 42 };
  for (let i = 0; i < 50; i++) o = { child: o };
  return o;
})();
const deepJson = JSON.stringify(deepObj);

const benchmarks = [
  ['json-stringify-small', () => JSON.stringify(smallObj)],
  ['json-parse-small', () => JSON.parse(smallJson)],
  ['json-stringify-medium', () => JSON.stringify(mediumObj)],
  ['json-parse-medium', () => JSON.parse(mediumJson)],
  ['json-stringify-large', () => JSON.stringify(largeObj)],
  ['json-parse-large', () => JSON.parse(largeJson)],
  ['json-roundtrip-deep', () => JSON.parse(JSON.stringify(deepObj))],
  ['object-keys-medium', () => {
    const users = mediumObj.users;
    let sum = 0;
    for (let i = 0; i < users.length; i++) sum += Object.keys(users[i]).length;
    return sum;
  }],
  ['array-map-filter', () => {
    return mediumObj.users
      .filter(u => u.active)
      .map(u => u.name)
      .join(',');
  }],
  ['regex-match', () => {
    const re = /user_(\d+)@example\.com/g;
    let count = 0;
    for (const u of mediumObj.users) {
      if (re.test(u.email)) count++;
      re.lastIndex = 0;
    }
    return count;
  }],
  ['string-concat', () => {
    let s = '';
    for (let i = 0; i < 1000; i++) s += 'x';
    return s;
  }],
  ['string-template', () => {
    let s = '';
    for (let i = 0; i < 1000; i++) s += `item_${i}_value`;
    return s;
  }],
];

// --- Run ---

const runtime =
  typeof Bun !== 'undefined' ? `bun ${Bun.version}` :
  `${process.argv[0].includes('milo') ? 'milo-node' : 'node'} ${process.version}`;

console.log(`\nRuntime: ${runtime}`);
console.log(`Warmup: ${WARMUP_MS}ms | Duration: ${DURATION_MS}ms per benchmark\n`);
console.log(`${'Benchmark'.padEnd(30)} ${'ops/sec'.padStart(12)} ${'total ops'.padStart(12)}`);
console.log('-'.repeat(56));

const results = [];
for (const [name, fn] of benchmarks) {
  const r = runBench(name, fn);
  results.push(r);
  console.log(`${r.name.padEnd(30)} ${r.opsPerSec.toLocaleString().padStart(12)} ${r.ops.toLocaleString().padStart(12)}`);
}

// Machine-readable output for comparison
console.log(`\n--- JSON ---`);
console.log(JSON.stringify({ runtime, results }));
