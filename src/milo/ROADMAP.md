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

### current pass rates (snapshot 2026-05-30; fs+stream re-tallied 2026-07-15 — fs jumped 99→174, so overall is meaningfully above 36% but full suite not re-run)

Overall: **milo 36%** (full run: 782/2143 pass, 1159 fail, 197 timeout, 5 OOM).
36% is test-weighted across all 30+ modules: the big low-scoring modules (http 210, http2 165, stream 156, crypto 94, child 85, tls 82) dominate the total, so 100% on small modules (buffer 63, process 57) barely moves it.

| module     | pass/total | rate | priority | top blockers |
|------------|-----------|------|----------|--------------|
| event      | 27/28     | 96%  | low      | capture-rejections avoidLoop: when ee[captureRejectionSymbol] async handler itself throws, _err2 must surface as unhandledRejection; works in isolation, fails only in the 8-fn nextTick chain (rejection-tracking during nested tick drain). bootstrap event-loop issue, not events.js |
| require    | 17/19     | 89%  | low      | preserve-symlinks flag, delete-array-iterator |
| module     | 21/26     | 80%  | high     | .node dlopen, circular-dep warning, main-fail stderr |
| worker     | 40/53     | 75%  | low      | heap-snapshot, wasm transfer, type-check/workerdata validation, message-port receive/transfer |
| console    | 9/14      | 64%  | med      | write-error propagation, tty colors, revoked proxy |
| readable   | 3/5       | 60%  | med      | from-web (web streams getReader); Readable.from async-iter error timing |
| v8         | 3/5       | 60%  | —        | mostly passing |
| diagnostics| 10/17     | 58%  | low      | tracingChannel+ALS async propagation, udp |
| util       | 10/19     | 53%  | med      | inspect getters/showHidden, callbackify, deprecate |
| fs         | 174/201   | 86%  | high     | re-tallied 2026-07-15 (was 99 in May snapshot); 25 fail + 2 timeout left: errno fidelity (access EACCES→ENOENT mislabel, readfile-error EIO), readdir withFileTypes .map, watchfile/patch-open timeouts |
| timers     | 45/55     | 82%  | low      | **MEASURED 2026-07-16.** the old "51" was stale drift, not a regression (verified identical with and without the lifecycle fixes) |
| whatwg     | 19/41     | 46%  | med      | URL↔searchParams live-sync, TextDecoder, webstreams |
| stream     | 75/156    | 48%  | high     | re-tallied 2026-07-15; async-fn map/flatMap, web streams, pipe edge cases |
| http       | 85/210    | 40%  | high     | **MEASURED 2026-07-16** (old "91" was stale; real pre-fix 79). lifecycle fixes: 79->85, oom 11->0. 40 timeout left — top blocker is keep-alive socket reuse (req 2 never sent), see lifecycle-probes/PLAYBOOK.md 5a |
| net        | 46/106    | 43%  | high     | **MEASURED 2026-07-16** (old "49" was wrong; real pre-fix 44). lifecycle fixes: 44->46, oom 3->0. Socket DOES extend Duplex already — that blocker is stale. 13 timeout left; see lifecycle-probes/PLAYBOOK.md |
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

### error codes (cross-module) — see `## critical` for ground truth (2026-07-15)
- [x] ~~just adding `.code` to thrown errors~~ — STALE: `.code` now attached on most validation paths (ERR_OUT_OF_RANGE, ERR_UNKNOWN_ENCODING, ERR_ASSERTION all verified live). Remaining work is error *fidelity*, itemized in critical section.

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

### error fidelity (fact-checked 2026-07-15 — old "~435 tests need .code" framing was stale)
`.code` is now present on most throw paths (fs ENOENT, ERR_OUT_OF_RANGE, ERR_UNKNOWN_ENCODING, ERR_ASSERTION verified live). Real remaining gaps:
- [ ] **bindings drop/mangle errno** — no uniform convention: `nm_fs_open` (binding_registry.c:65) returns bare `open()` -1 and never captures errno; fsAccess/nm_fs_utimes return +errno; fsFdRead/fsFdWrite return -errno. Standardize on negative errno (libuv-style) everywhere.
- [ ] **fs.js hardcodes 'ENOENT'** at 8 sites (fs.js:198,227,304,375,397,454,504,1213) because open/stat bindings give it no errno — EACCES/EISDIR mislabeled ENOENT. Route through a `uvException`-style factory once bindings surface errno.
- [ ] **no real `internalBinding('uv')` errno constants/errmap** — THE reason the prior errno-on-fsError attempt was reverted (commit 3a6553a444: copyfile tests assert on missing UV_* map). Port from vendored `lib/internal/errors.js` (`uvErrmapGet` at errors.js:629, `uvException` ~:646).
- [ ] **4 duplicate errno tables with clashing sign conventions** — bootstrap.js:56 (uv map, mixes darwin/win32 numbers), util.js:691 `_errnoMap`, util.js:718 `_sysErrors`, fs.js:801 `_ERRNO_CODES` (macOS-positive). Consolidate to one libuv-negative-keyed table; normalize macOS errno → libuv at the seam.
- [ ] `.errno` numeric property missing on all fs errors (code/syscall/path present, errno undefined)
- [ ] missing arg-type validation throws wrong code: `fs.readFileSync(123)` → EBADF (uses 123 as fd) instead of ERR_INVALID_ARG_TYPE
- [ ] dns lookup failure constructs bare Error (dns.js:17) with no `.code`, crashes process as uncaught — should be ENOTFOUND w/ code
- [ ] `new URL('::::')` doesn't throw — parser too lenient, should be ERR_INVALID_URL

## high

### event loop drain / timeout fixes (~414 tests)
2026-07-16: four real lifecycle bugs found+fixed (see lifecycle-probes/PLAYBOOK.md). ALL OOMs
in net+http are gone (net 3->0, http 11->0) — every one was a busy-spin to v8 fatal-OOM from a
stale/orphaned kqueue registration. net 44->46, http 79->85. Remaining timeouts are NOT spins
(they sleep at ~0.05s cpu); they are missing-feature/logic bugs, chiefly http keep-alive reuse.
- [x] ~~net: socket 'end' event not firing~~ — STALE: verified firing (probe p09). Real bugs were
      the liveness model (map membership vs libuv active-handle) + fd-reuse orphaning.
- [ ] **http keep-alive socket reuse: request 2 is never sent** (playbook 5a) — likely gates a
      large share of http's 40 timeouts; every multi-request test through the default agent stalls
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

- [ ] native addons / N-API: only ~4 of 2143 curated tests touch dlopen/.node (2 test dlopen *error* paths, passable without addons) — ≈0% compat leverage. Defer until goal shifts to ecosystem reach (better-sqlite3/sharp); then port Bun's split: engine-seam C++ (bun src/jsc/bindings/napi*.cpp → our v8capi.cc) + safe body (napi_body.rs → napi.milo). Reference checkout: ~/git/bun (full Rust rewrite, 2026).
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
