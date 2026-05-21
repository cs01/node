'use strict';

const http = require('http');

// HTTP benchmark: start a server, hammer it with sequential requests, measure throughput.
// Runs identically on node, bun, and milo-node.

const PORT = 0; // auto-assign
const WARMUP_REQS = 200;
const BENCH_DURATION_MS = 5000;

const RESPONSE_SMALL = '{"ok":true}';
const RESPONSE_MEDIUM = JSON.stringify({
  users: Array.from({ length: 50 }, (_, i) => ({
    id: i, name: `user_${i}`, email: `user${i}@test.com`, active: i % 2 === 0,
  })),
});

function now() {
  if (process.hrtime && process.hrtime.bigint) return Number(process.hrtime.bigint()) / 1e6;
  return Date.now();
}

function makeRequest(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path, method: 'GET' }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.end();
  });
}

async function runHttpBench(name, port, path, warmupReqs, durationMs) {
  // Warmup
  for (let i = 0; i < warmupReqs; i++) await makeRequest(port, path);

  // Timed
  let ops = 0;
  const start = now();
  const deadline = start + durationMs;
  while (now() < deadline) {
    await makeRequest(port, path);
    ops++;
  }
  const elapsed = now() - start;
  const rps = Math.round((ops / elapsed) * 1000);
  return { name, ops, elapsed: Math.round(elapsed), rps };
}

// Concurrent variant: fire N requests at once, measure total throughput
async function runHttpBenchConcurrent(name, port, path, concurrency, durationMs) {
  // Warmup
  for (let i = 0; i < 100; i++) await makeRequest(port, path);

  let ops = 0;
  let running = true;
  const start = now();

  setTimeout(() => { running = false; }, durationMs);

  const worker = async () => {
    while (running) {
      await makeRequest(port, path);
      ops++;
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const elapsed = now() - start;
  const rps = Math.round((ops / elapsed) * 1000);
  return { name, ops, elapsed: Math.round(elapsed), rps };
}

async function main() {
  const runtime =
    typeof Bun !== 'undefined' ? `bun ${Bun.version}` :
    `${process.argv[0].includes('milo') ? 'milo-node' : 'node'} ${process.version}`;

  const server = http.createServer((req, res) => {
    if (req.url === '/small') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(RESPONSE_SMALL) });
      res.end(RESPONSE_SMALL);
    } else if (req.url === '/medium') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(RESPONSE_MEDIUM) });
      res.end(RESPONSE_MEDIUM);
    } else if (req.url === '/echo') {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(body) });
        res.end(body);
      });
    } else {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('ok');
    }
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  console.log(`\nRuntime: ${runtime} | Server on :${port}`);
  console.log(`Duration: ${BENCH_DURATION_MS}ms per benchmark\n`);
  console.log(`${'Benchmark'.padEnd(40)} ${'req/sec'.padStart(10)} ${'total'.padStart(10)}`);
  console.log('-'.repeat(62));

  const benches = [
    await runHttpBench('sequential /small (12B)', port, '/small', WARMUP_REQS, BENCH_DURATION_MS),
    await runHttpBench('sequential /medium (2.6KB)', port, '/medium', WARMUP_REQS, BENCH_DURATION_MS),
    await runHttpBenchConcurrent('concurrent/10 /small', port, '/small', 10, BENCH_DURATION_MS),
    await runHttpBenchConcurrent('concurrent/10 /medium', port, '/medium', 10, BENCH_DURATION_MS),
    await runHttpBenchConcurrent('concurrent/50 /small', port, '/small', 50, BENCH_DURATION_MS),
  ];

  for (const r of benches) {
    console.log(`${r.name.padEnd(40)} ${r.rps.toLocaleString().padStart(10)} ${r.ops.toLocaleString().padStart(10)}`);
  }

  server.close();
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
