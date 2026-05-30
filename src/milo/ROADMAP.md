# milo-node compat roadmap

Goal: 100% Node.js runtime compatibility.
Test only the module you're fixing: `./out/Release/milo-node -e "..."`.
Full build: `bash src/milo/build.sh`

## bun compat scoreboard

Bun targets 2,185 of Node's 3,979 `test/parallel/` tests (55%). They skip entire subsystems:
repl, inspector, debugger, diagnostics_channel, domain, permission, trace, snapshot, test runner.
We use their curated subset as our primary compat benchmark.

Run: `zsh src/milo/test-compat.sh [N|all] [timeout] [module]`
List: `src/milo/bun-curated-tests.txt` (2,143 tests present in our repo)

### current pass rates (snapshot 2026-05-28 — STALE; several rows verified higher, re-measure before trusting)

On bun's curated subset: **bun 99%, milo 36%** (full run: 782/2143 pass, 1159 fail, 197 timeout, 5 OOM)

| module     | pass/total | rate | priority | top blockers |
|------------|-----------|------|----------|--------------|
| event      | 27/28     | 96%  | —        | captureRejections |
| next       | 9/9       | 100% | —        | done |
| buffer     | 52/63     | 83%  | high     | ucs2 indexOf alignment, inspect extra-props, resizable |
| querystring| 3/3       | 100% | —        | done |
| process    | 45/57     | 78%  | high     | beforeExit re-emit on server close, execve, --title flag, hrtime natives |
| url        | 11/11     | 100% | —        | done (curated); full glob: parse-deprecation DEP0169, pathToFileURL backslash, relative |
| readable   | 4/5       | 80%  | med      | destroy/unpipe edge cases |
| v8         | 3/5       | 60%  | —        | mostly passing |
| timers     | 49/55     | 89%  | low      | refresh ordering, getLibuvNow (native syntax), ALS, domain |
| require    | 14/19     | 73%  | med      | resolve dedup, symlink, exceptions |
| module     | 21/26     | 80%  | high     | .node dlopen, circular-dep warning, main-fail stderr |
| console    | 9/14      | 64%  | med      | write-error propagation, tty colors, revoked proxy |
| path       | 8/15      | 53%  | med      | edge cases |
| diagnostics| 10/17     | 58%  | low      | tracingChannel+ALS async propagation, udp |
| fs         | 99/201    | 49%  | high     | dispose ERR_DIR_CLOSED, readFile+signal, error codes |
| http       | 91/210    | 43%  | high     | timeout/abort, keep-alive, error codes |
| net        | 44/106    | 41%  | high     | Socket not extending Duplex |
| stream     | 73/156    | 46%  | high     | async-fn map/flatMap, web streams, pipe edge cases |
| zlib       | 18/56     | 32%  | high     | ZstdDecompress, flush/params |
| util       | 10/19     | 53%  | med      | inspect getters/showHidden, callbackify, deprecate |
| vm         | 18/71     | 25%  | low      | real contexts landed; marshaling fidelity (descriptors/globals) next |
| whatwg     | 10/41     | 24%  | med      | URL/URLSearchParams edge cases |
| cluster    | 14/54     | 25%  | low      | worker lifecycle |
| child      | 17/85     | 20%  | med      | child.send, spawn edge cases |
| tls        | 18/82     | 21%  | med      | connection lifecycle, error codes |
| dgram      | 11/64     | 17%  | low      | bind/send permissions, multicast |
| readline   | 2/17      | 11%  | low      | interface, cursor |
| crypto     | 19/94     | 20%  | med      | ECDH, sign/verify gaps |
| dns        | 1/22      | 4%   | low      | Resolver class |
| http2      | 27/165    | 16%  | low      | frame codec + HPACK exist; stream/session edge cases |
| worker     | 1/53      | 1%   | low      | needs V8 isolate threading |
| async      | 1/18      | 5%   | med      | async_hooks createHook tracking (ALS propagation DONE) |
| webcrypto  | 0/11      | 0%   | low      | subtle crypto gaps |

## quick wins (biggest compat % gain per effort)

### error codes (cross-module) — unlocks ~11 process, ~dozens elsewhere
- [ ] already tracked below — "Missing expected exception" is #1 failure pattern across all modules
- [ ] just adding `.code` to thrown errors would flip many tests

### process 38% → ~60% (57 tests in curated set, 22 passing)
- [ ] `process.seteuid()`, `process.setegid()`, `process.getegid()` — trivial syscall bindings (3 tests)
- [ ] `process.umask(mask)` — return old mask, not current (2 tests)
- [ ] `process.ref()` / `process.unref()` — missing on process object (1 test)
- [ ] `process.kill(pid)` validation + return value (2 tests)
- [ ] error code validation on cpuUsage, hrtime, nextTick, chdir (4 tests)

### module 26% → ~50% (26 tests in curated set, 7 passing)
- [ ] `Module._stat` — fs.statSync wrapper, used by require resolution (1 test)
- [ ] `Module._nodeModulePaths` / `Module._resolveLookupPaths` — expose internals (2 tests)
- [ ] `Module._extensions` — setter for custom extensions like `.bar` (1 test)
- [ ] circular dependency detection + warning (1 test)

### zlib 22% → ~50% (56 tests in curated set)
- [ ] `zlib.zstdCompress` / `zlib.ZstdDecompress` — Zstandard support
- [ ] `zlib.params()` — dynamic compression level change
- [ ] flush mode edge cases

## critical

### error code validation (~435 tests)
- [ ] native bindings throw errors without `.code` property — tests match on `{ code: 'ERR_xxx' }` in `assert.throws`
- [ ] add `makeNodeError(code, type, msg)` helper, use in all validation paths (fs, buffer, net, dgram, crypto, etc.)
- [ ] covers both "code mismatch" and "Missing expected exception" failure categories

### ~~__dirname resolution~~ — VERIFIED WORKING 2026-05-29
- [x] `__dirname`/`__filename` resolve correctly for main entry AND required submodules
- claim "resolves to repo root" was stale; `_loadModule` already sets `dname = path.dirname(resolved)`

### MessagePort EventEmitter (~93 tests)
- [ ] `MessageChannel` ports lack `.on()`, `.once()`, `.emit()`
- [ ] need `MessagePort.prototype` to inherit from `EventEmitter`

## high

### event loop drain / timeout fixes (~414 tests)
- [ ] net: connections never close, socket 'end' event not firing (6 timeout tests)
- [ ] http: server/client timeout and abort handling (6 timeout tests)
- [ ] tls: connection lifecycle (4 timeout tests)
- [ ] cluster: worker wait/disconnect (4 timeout tests)
- [ ] `unref()` not working on some handle types

### net
- [ ] net.Socket should extend Duplex (currently extends EventEmitter with ad-hoc methods)

### vm real V8 contexts — DONE (foundation), needs marshaling fidelity
- [x] vm binding (bindings/vm.milo): createContext + run via v8c_context_new/v8c_script_compile_run
- [x] true realm isolation — foreign objects get the new context's own Function.prototype (solved util-promisify line 102)
- [x] sandbox<->global marshaling done INSIDE the target context (writes to a foreign global proxy from the main context are silently dropped by V8 — key gotcha)
- [ ] TRADEOFF: curated vm 20->18 — shallow value-copy marshaling is lossy vs Node's interceptor contextify:
      loses property descriptors/getters and Symbol.toStringTag (test-vm-basic wants '[object process]'),
      and new contexts lack Node globals (console etc) the old eval/with(proxy) fake exposed via globalThis fallback.
- [ ] NEXT: marshal with full descriptors (getOwnPropertyDescriptors) + seed standard globals -> should exceed 20

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

## done

- [x] buffer: legacy `new Buffer()` emits DEP0005 once (internal allocs via _newBuffer skip warning); native binding.fill shim range-checks start/end (ERR_OUT_OF_RANGE) — buffer 49->52 (fill, constructor-deprecation-error, pending-deprecation)
- [x] buffer: byteLength accepts cross-realm ArrayBuffer (toStringTag); compare rejects prototype-only fakes (isView brand) — buffer 46->48

- [x] FOUNDATIONAL: AsyncLocalStorage async propagation via V8 ContinuationPreservedEmbedderData — context survives await/.then/timers/nextTick. Curated async tests still need createHook tracking, but ALS works for real frameworks

- [x] stream iterator-helper arg validation (map/filter/drop/take/...) — stream 70->73

- [x] timers: interval _onTimeout/_idleTimeout stop signals + internal/linkedlist port — timers 47->49 (40->49 this session, 89%)

- [x] timers: dispose skips immediate drain; _repeat-set re-arms one-shot as interval — timers 45->47 (40->47 this session)

- [x] timers: fireDue slot-state-before-callback (refresh-from-own-callback re-arms); internal/timers setUnrefTimeout — timers 43->45

- [x] timers: unref-immediate loop semantics (setImmediate(fn).unref() doesnt keep loop alive) — timers 40->43

- [x] FOUNDATIONAL: process unhandledRejection/rejectionHandled (V8 PromiseRejectCallback in v8capi -> bootstrap tracker); EventEmitter captureRejections (prototype-backed default, async listener rejections -> error). timers +1, broadly used

- [x] events.removeAllListeners emits removeListener per-listener (Reflect.ownKeys for symbols) — event 27/28

- [x] nextTick this-binding (was queue tuple) + module top-level this===module.exports; Readable.from validation + async-iter error reject. next 9/9

- [x] require.cache Proxy (Module-object semantics over moduleCache) + _builtinCache for node: bypass; node:-prefix error codes — require 11->13, no load-path risk

- [x] module: require.extensions custom handlers + Module.runMain entry (monkey-patchable via --require) — module 19->21 (53->80% this session)

- [x] --pending/no/throw-deprecation flags derived from cmdline; module.parent deduped DEP0144 getter (module 17->19)

- [x] module loader honors customized Module.wrapper (non-builtin); null-proto package.json (proto-pollution safe) — module 14->17
- [x] util.parseEnv dotenv-compatible parser (quotes/multiline/comments/export/escapes); process.processTicksAndRejections named frame

- [x] util.inspect breakLength multiline wrapping (reduceToSingleString port) — foundational, unblocks console/util/assert-message tests; console-group passes; console 50->57%

- [x] assert.rejects/doesNotReject: regex matchers via .test(), validator-vs-Error-ctor, promiseFn type + non-Promise-return validation, doesNotReject message (CASCADE — affects throws/rejects across suite)
- [x] fs: createReadStream accepts FileHandle as opts.fd; FileHandle is EventEmitter; read/write option-forms + reject-not-throw (fs 94->99)

- [x] fs.read/readSync/FileHandle option-form + customPromisifyArgs; FileHandle is EventEmitter (read cluster, fs 94->97)
- [x] querystring.escape node encodeStr port (surrogate combine, lone-end throws) — querystring 3/3
- [x] url.format type validation (ERR_INVALID_ARG_TYPE) — url 10/11
- [x] events/AbortSignal: real Event on abort, stopImmediatePropagation halts dispatch, listenerCount, once({signal})

- [x] util.promisify faithful port — resolve first value (was returning array: real bug breaking packages), customPromisifyArgs->named object, setPrototypeOf+own-descriptors, no cache; util-promisify now blocked ONLY by vm realm isolation (line 102 cross-realm prototype)
- [x] internal/util sleep (validated msec) + customPromisifyArgs export (util-sleep, timers-nested)
- [x] timers/promises validation + AbortError cause + promisify.custom wiring (timeout/immediate-promisified)
- [x] buffer ascii decode masks high bit (byte & 0x7f), separate from latin1 (test-buffer-ascii)
- [x] process.exit funnels through overridable process.reallyExit; process reports as #<process> (really-exit, exit-code-validation)
- [x] process.kill returns true + propagates kill(2) errno (dead-pid signal-0 probe throws)
- [x] process.emitWarning honors noDeprecation/throwDeprecation; default 'warning' listener prints Error-only (warning, no-deprecation)
- [x] top-level uncaught throws route through process._fatalException — `[main]` runner wraps require(f) in try/catch; capture callbacks + 'uncaughtException' listeners now fire instead of native print+exit (process 68%→71%, broad cross-module win)
- [x] error codes in toString — Error.prototype.toString brackets ERR_* codes ("TypeError [ERR_X]: msg") so assert.throws(/ERR_X/) matches String(err); cross-module win (buffer 33%→73%)
- [x] process.ref/unref — symbol-based (nodejs.ref) + legacy api
- [x] process.setSourceMapsEnabled / getSourceMapsSupport — arg validation
- [x] buffer.isUtf8 — proper unicode well-formed validation (overlong/surrogate/range)
- [x] buffer writeBigInt64/writeBigUInt64 — bigint type + range validation
- [x] structuredClone — honors transfer list (detaches), clones typed arrays/map/set/date
- [x] binary TCP send/recv — WebSocket (ws) package works
- [x] crypto.randomFillSync, randomFill
- [x] crypto.createPublicKey, createPrivateKey
- [x] Buffer.writeUIntBE/LE, readUIntBE/LE, writeIntBE/LE, readIntBE/LE
- [x] HTTP upgrade events (server + client) for WebSocket
- [x] HTTP server setTimeout, listening property
- [x] EventEmitter → function-based constructor (util.inherits compat)
- [x] Stream → function-based constructor
- [x] StringDecoder → function-based constructor
- [x] fs.Dirent + readdirSync withFileTypes
- [x] fs/promises, stream/promises subpath requires
- [x] http2 module (basic)
- [x] util.types: isUint8Array, isArrayBufferView, typed array checks, etc.
- [x] net.Socket: cork/uncork, pause/resume/pipe, read, _readableState/_writableState
- [x] net.Server listen({port, host}) options object
- [x] internalBinding('config').hasCrypto = true
- [x] tty module with raw mode
- [x] per-module require with exports map support
- [x] express 4 full compat (GET/POST/JSON/params/status)
- [x] stream async iterator + Readable.from
- [x] ESM module support — import/export transform, default/named/re-exports, multi-line, #imports
- [x] require('.') and require('..') resolution
- [x] directory-with-same-name-as-file resolution in require
- [x] crypto.webcrypto.subtle — digest, importKey, sign, verify
- [x] globalThis.crypto (WebCrypto API)
- [x] zlib decompression for high-compression-ratio data (progressive buffer sizing)
- [x] pg (postgres) client loads
- [x] 38+ npm packages verified: express, ws, uuid, chalk, nanoid, pg, redis, ioredis, knex, etc.
- [x] `fork()` with IPC messaging (socketpair + kqueue)
- [x] `process.send()` / `process.on('message')` in forked children
- [x] `process.channel` ref/unref for IPC
- [x] env var inheritance in child processes (posix_spawn environ fix)
- [x] `process.env` set/delete synced to real C environ
