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

### current pass rates (2026-05-27)

On bun's curated subset: **bun 99%, milo 40.5%** (full run: 868/2143 pass, 1061 fail, 208 timeout, 6 OOM)
Full runs on process (57 tests) and module (26 tests) below; others from 200-sample.

| module     | pass/total | rate | priority | top blockers |
|------------|-----------|------|----------|--------------|
| dgram      | ~6/9      | 67%  | —        | mostly passing |
| fs         | ~8/14     | 57%  | high     | error codes, write-stream edge cases |
| crypto     | ~4/8      | 50%  | med      | DH/ECDH, sign/verify gaps |
| net        | ~3/7      | 43%  | high     | Socket not extending Duplex |
| child      | ~3/7      | 43%  | med      | child.send, spawn edge cases |
| http       | ~11/26    | 42%  | high     | timeout/abort handling, error codes |
| process    | 22/57     | 38%  | high     | error codes, execve, seteuid, ref/unref, umask |
| vm         | ~4/11     | 36%  | low      | sandbox isolation, SourceTextModule |
| buffer     | ~2/6      | 33%  | high     | error codes, missing methods |
| tls        | ~3/9      | 33%  | med      | connection lifecycle, error codes |
| stream     | ~4/13     | 31%  | high     | Writable.toWeb, pipeline edge cases |
| module     | 7/26      | 26%  | high     | _stat, _nodeModulePaths, _resolveLookupPaths, _extensions |
| zlib       | ~2/9      | 22%  | high     | ZstdDecompress, flush/params |

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

### __dirname resolution (~200 tests)
- [ ] `__dirname` resolves to repo root instead of script's directory
- [ ] fix in module loader: set `__dirname = path.dirname(filename)` when wrapping

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
