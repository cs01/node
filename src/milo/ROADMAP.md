# milo-node compat roadmap

Goal: 100% Node.js runtime compatibility.
Test only the module you're fixing: `./out/Release/milo-node -e "..."`.
Full build: `bash src/milo/build.sh`

## high — npm packages depend on these

### http / https
- [ ] `http.request()` / `http.get()` — real outbound HTTP over TCP
- [ ] `http.createServer()` — real request parsing, header population, response body writing
- [ ] `https.request()` / `https.get()` — TLS-wrapped HTTP client
- [ ] `https.createServer()` — TLS server

### crypto
- [ ] `createCipheriv` / `createDecipheriv` — AES-256-CBC, AES-256-GCM, etc.
- [ ] `createSign` / `createVerify` — RSA/ECDSA signing
- [ ] `pbkdf2` / `pbkdf2Sync` — key derivation
- [ ] `scrypt` / `scryptSync` — key derivation
- [ ] `generateKeyPairSync` / `generateKeySync`
- [ ] `getCiphers` / `getCurves` / `getHashes` — return real lists


### fs (async)
- [ ] `fs.watch()` / `watchFile()` / `unwatchFile()` — kqueue-based file watching
- [ ] `fs.fstatSync` — real implementation

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
- [ ] `styleText` — ANSI styling
- [ ] `MIMEType` class

### os
- [ ] `os.cpus()` — real speed and time values (currently `speed: 0`)
- [ ] `os.networkInterfaces()` — real interface data
- [ ] `os.getpriority()` / `os.setpriority()`

### process
- [ ] `process.send()` / IPC when forked
- [ ] `process.channel` for IPC

### stream
- [ ] `stream.Readable.toArray()` / `map()` / `filter()` / `reduce()` — web stream compat
- [ ] `stream.compose()`

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
