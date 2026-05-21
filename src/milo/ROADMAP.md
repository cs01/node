# milo-node compat roadmap

Goal: 100% Node.js runtime compatibility.
Test only the module you're fixing: `./out/Release/milo-node -e "..."`.
Full build: `bash src/milo/build.sh`

## high — npm packages depend on these

### http / https
- [ ] `https.request()` / `https.get()` — TLS-wrapped HTTP client
- [ ] `https.createServer()` — TLS server
- [ ] HTTP server graceful shutdown (server.close + event loop exit)

### crypto
- [ ] `createSign` / `createVerify` — RSA/ECDSA signing
- [ ] `generateKeyPairSync` / `generateKeySync`
- [ ] AES-GCM mode (authenticated encryption)


### fs
- [ ] `fs.watch()` / `watchFile()` / `unwatchFile()` — kqueue-based file watching

### tls
- [ ] `tls.connect()` — TLS client via SecureTransport or OpenSSL
- [ ] `tls.createServer()` — TLS server

### async_hooks
- [ ] `AsyncLocalStorage` propagation across async boundaries

## medium

### child_process
- [ ] True async `spawn` (currently sync + nextTick emulation)
- [ ] `fork()` with IPC messaging
- [ ] stdio option: `pipe`, `inherit`, `ignore`

### net
- [ ] `socket.setTimeout()` / `setKeepAlive()` — real implementations
- [ ] `server.getConnections()` — real count

### dns
- [ ] MX, TXT, SRV, NS, CNAME, PTR record queries
- [ ] `dns.reverse()` — reverse lookup


### util
- [ ] `util.toUSVString()`
- [ ] `util.aborted()` — AbortSignal watch

### os
- [ ] `os.networkInterfaces()` — MAC addresses (currently all zeros)
- [ ] `os.userInfo()` — use `getpwuid` for username/homedir/shell instead of env vars

### process
- [ ] `process.send()` / IPC when forked
- [ ] `process.channel` for IPC

### stream
- [ ] `stream.Readable` async iterator — event loop doesn't keep alive for `for await` on streams
- [ ] `stream.addAbortSignal()`

## low

- [ ] `dgram` — UDP socket send/receive
- [ ] `cluster` module
- [ ] `worker_threads` — `Worker`, `MessageChannel`, `MessagePort`
- [ ] `vm` — proper sandbox isolation via V8 contexts
- [ ] `readline` — interactive stdin input, Interface class
- [ ] `perf_hooks` — `PerformanceObserver` real implementation
- [ ] `diagnostics_channel` — real channel pub/sub
- [ ] `process.nextTick` — proper implementation (currently microtask-based, fragile)
- [ ] Buffer pooling optimization
- [ ] `domain` module (deprecated but some packages use it)
