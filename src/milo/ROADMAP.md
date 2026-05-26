# milo-node compat roadmap

Goal: 100% Node.js runtime compatibility.
Test only the module you're fixing: `./out/Release/milo-node -e "..."`.
Full build: `bash src/milo/build.sh`

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
