# milo-node compat roadmap

Goal: 100% Node.js runtime compatibility.
Test only the module you're fixing: `./out/Release/milo-node -e "..."`.
Full build: `bash src/milo/build.sh`

## medium

### child_process
- [ ] `fork()` with IPC messaging

### process
- [ ] `process.send()` / IPC when forked
- [ ] `process.channel` for IPC

### net
- [ ] net.Socket should extend Duplex (currently extends EventEmitter with ad-hoc methods)

### fastify compat
- [ ] investigate async plugin loading hang (listen promise never resolves)

## low

- [ ] `stream.Writable.toWeb()` / `Readable.toWeb()` — needs ReadableStream/WritableStream globals in V8
- [ ] `cluster` module
- [ ] `worker_threads` — `Worker`, `MessageChannel`, `MessagePort`
- [ ] `vm` — proper sandbox isolation via V8 contexts
- [ ] `perf_hooks` — `monitorEventLoopDelay` real histogram
- [ ] Buffer pooling optimization
- [ ] `domain` module (deprecated but some packages use it)

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
