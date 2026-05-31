# milo-node compat roadmap

Goal: 100% Node.js runtime compatibility.
Test only the module you're fixing: `./out/Release/milo-node -e "..."`.
Full build: `bash src/milo/build.sh`

Only outstanding work is listed. A module/feature not here is assumed passing.

## bun compat scoreboard

Bun targets 2,185 of Node's 3,979 `test/parallel/` tests (55%). They skip entire subsystems:
repl, inspector, debugger, diagnostics_channel, domain, permission, trace, snapshot, test runner.
We use their curated subset as our primary compat benchmark.

Run safely: `bash test_safe_runner.sh --compat --module <mod>` (root runner — ulimit -v + ulimit -u + RSS watchdog + forkbomb kill).
The per-module `zsh src/milo/test-compat.sh` only caps V8 heap + wall-time — NOT off-heap mem or proc count, so it can OOM/forkbomb on child_process/cluster/large-file tests.
List: `src/milo/bun-curated-tests.txt` (2,143 tests present in our repo)

### current pass rates (snapshot 2026-05-30)

Overall: **milo 36%** (full run: 782/2143 pass, 1159 fail, 197 timeout, 5 OOM).
36% is test-weighted across all 30+ modules: the big low-scoring modules (http 210, http2 165, stream 156, crypto 94, child 85, tls 82) dominate the total, so 100% on small modules (buffer 63, process 57) barely moves it.

| module     | pass/total | rate | priority | top blockers |
|------------|-----------|------|----------|--------------|
| event      | 27/28     | 96%  | low      | capture-rejections avoidLoop: when ee[captureRejectionSymbol] async handler itself throws, _err2 must surface as unhandledRejection; works in isolation, fails only in the 8-fn nextTick chain (rejection-tracking during nested tick drain). bootstrap event-loop issue, not events.js |
| timers     | 49/55     | 89%  | low      | refresh ordering, getLibuvNow (native syntax), ALS, domain |
| require    | 17/19     | 89%  | low      | preserve-symlinks flag, delete-array-iterator |
| module     | 21/26     | 80%  | high     | .node dlopen, circular-dep warning, main-fail stderr |
| worker     | 40/53     | 75%  | low      | heap-snapshot, wasm transfer, type-check/workerdata validation, message-port receive/transfer |
| console    | 9/14      | 64%  | med      | write-error propagation, tty colors, revoked proxy |
| readable   | 3/5       | 60%  | med      | from-web (web streams getReader); Readable.from async-iter error timing |
| v8         | 3/5       | 60%  | —        | mostly passing |
| diagnostics| 10/17     | 58%  | low      | tracingChannel+ALS async propagation, udp |
| util       | 10/19     | 53%  | med      | inspect getters/showHidden, callbackify, deprecate |
| fs         | 99/201    | 49%  | high     | dispose ERR_DIR_CLOSED, readFile+signal, error codes |
| whatwg     | 19/41     | 46%  | med      | URL↔searchParams live-sync, TextDecoder, webstreams |
| stream     | 73/156    | 46%  | high     | async-fn map/flatMap, web streams, pipe edge cases |
| http       | 91/210    | 43%  | high     | timeout/abort, keep-alive, error codes |
| net        | 44/106    | 41%  | high     | Socket not extending Duplex |
| zlib       | 18/56     | 32%  | high     | ZstdDecompress, flush/params |
| vm         | 18/71     | 25%  | low      | real contexts landed; marshaling fidelity (descriptors/globals) next |
| cluster    | 14/54     | 25%  | low      | worker lifecycle |
| tls        | 18/82     | 21%  | med      | connection lifecycle, error codes |
| child      | 17/85     | 20%  | med      | child.send, spawn edge cases |
| crypto     | 19/94     | 20%  | med      | ECDH, sign/verify gaps |
| dgram      | 11/64     | 17%  | low      | bind/send permissions, multicast |
| http2      | 27/165    | 16%  | low      | frame codec + HPACK exist; stream/session edge cases |
| readline   | 2/17      | 11%  | low      | interface, cursor |
| async      | 1/18      | 5%   | med      | async_hooks createHook tracking (ALS propagation DONE) |
| dns        | 1/22      | 4%   | low      | Resolver class |
| webcrypto  | 0/11      | 0%   | low      | subtle crypto gaps |

## quick wins (biggest compat % gain per effort)

### error codes (cross-module) — unlocks ~11 process, ~dozens elsewhere
- [ ] "Missing expected exception" is #1 failure pattern across all modules
- [ ] just adding `.code` to thrown errors would flip many tests

### process (small remaining gaps)
- [ ] `process.seteuid()`, `process.setegid()`, `process.getegid()` — trivial syscall bindings (3 tests)
- [ ] `process.umask(mask)` — return old mask, not current (2 tests)
- [ ] `process.kill(pid)` validation + return value (2 tests)
- [ ] error code validation on cpuUsage, hrtime, nextTick, chdir (4 tests)

### module 80% → ~50%+ remaining
- [ ] `Module._stat` — fs.statSync wrapper, used by require resolution (1 test)
- [ ] `Module._nodeModulePaths` / `Module._resolveLookupPaths` — expose internals (2 tests)
- [ ] `Module._extensions` — setter for custom extensions like `.bar` (1 test)
- [ ] circular dependency detection + warning (1 test)

### zlib 32% → ~50%
- [ ] `zlib.zstdCompress` / `zlib.ZstdDecompress` — Zstandard support
- [ ] `zlib.params()` — dynamic compression level change
- [ ] flush mode edge cases

## critical

### error code validation (~435 tests)
- [ ] native bindings throw errors without `.code` property — tests match on `{ code: 'ERR_xxx' }` in `assert.throws`
- [ ] add `makeNodeError(code, type, msg)` helper, use in all validation paths (fs, buffer, net, dgram, crypto, etc.)
- [ ] covers both "code mismatch" and "Missing expected exception" failure categories

## high

### event loop drain / timeout fixes (~414 tests)
- [ ] net: connections never close, socket 'end' event not firing (6 timeout tests)
- [ ] http: server/client timeout and abort handling (6 timeout tests)
- [ ] tls: connection lifecycle (4 timeout tests)
- [ ] cluster: worker wait/disconnect (4 timeout tests)
- [ ] `unref()` not working on some handle types

### net
- [ ] net.Socket should extend Duplex (currently extends EventEmitter with ad-hoc methods)

### vm marshaling fidelity (real V8 contexts landed; marshaling lossy)
- [ ] shallow value-copy marshaling loses property descriptors/getters and Symbol.toStringTag
      (test-vm-basic wants '[object process]'); new contexts lack Node globals (console etc) the old eval/with(proxy) fake exposed
- [ ] marshal with full descriptors (getOwnPropertyDescriptors) + seed standard globals -> should exceed 20

### missing APIs (scattered but cumulative)
- [ ] `dns.Resolver` class (~30 tests)
- [ ] `crypto.createDiffieHellman/ECDH/getDiffieHellman` (~40 tests)
- [ ] `Utf8Stream` in `node:fs` (~30 tests)
- [ ] `Duplex.fromWeb` (~15 tests)
- [ ] `Console` constructor (~10 tests)
- [ ] `zlib.ZstdDecompress` (~10 tests)
- [ ] `process.execve` (~5 tests)

### fastify compat
- [ ] investigate async plugin loading hang (listen promise never resolves)

## low

- [ ] `stream.Writable.toWeb()` / `Readable.toWeb()` — needs ReadableStream/WritableStream globals in V8
- [ ] `cluster` module
- [ ] `worker_threads` — `Worker` class (needs V8 isolate threading)
- [ ] `vm.SourceTextModule` — ESM module evaluation in V8 contexts
- [ ] `vm` — proper sandbox isolation via V8 contexts
- [ ] `perf_hooks` — `monitorEventLoopDelay` real histogram
- [ ] Buffer pooling optimization
- [ ] `domain` module (deprecated but some packages use it)
- [ ] `--expose-internals` flag (319 tests need it)
- [ ] `--permission` security model (39 tests need it)

## formal verification

Milo has built-in `requires`/`ensures`/`invariant` contracts → SMT-LIB2 → Z3. Zero runtime cost.
Worth adding to pure algorithmic code where off-by-one and bounds bugs bite hardest.

### buffer ops (best candidates)
- [ ] `compareImpl` — ensures result in {-1, 0, 1}, requires lengths >= 0
- [ ] `copyImpl` — ensures bytes copied <= min(srcLen, dstLen - offset), bounds on offset
- [ ] `indexOfImpl` — ensures result == -1 || (result >= 0 && result < haystackLen)
- [ ] `fillImpl` — requires offset >= 0 && offset <= bufLen, end >= offset

### encoding/decoding
- [ ] hex encode/decode — ensures output length == input length * 2 (encode) or / 2 (decode)
- [ ] base64 length calculations — ensures correct padding math
- [ ] utf8 validation — loop invariants on byte position advancement

### stream internals
- [ ] HWM logic — invariant hwm > 0, buffer length tracking
- [ ] backpressure state transitions — ensures consistent needDrain/flowing state
