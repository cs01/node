# milo-node compat roadmap

Goal: 100% Node.js runtime compatibility. Tracks gaps found via audit.
Test only the module you're fixing: `./out/Release/milo-node -e "..."`.
Full build: `bash src/milo/build.sh`

## critical — wrong values or crashes

(none remaining)

## high — missing functionality npm packages depend on

- [ ] `http.request()`/`http.get()` throw, `createServer` is fake
- [ ] `AsyncLocalStorage` doesn't propagate across async boundaries — `lib/async_hooks.js:20-25`
- [ ] `zlib` all operations are pass-through — no actual compression

## medium

- [ ] `fs.watch()`/`watchFile()`/`unwatchFile()` missing
- [ ] `fs.fstatSync` is a stub
- [ ] `tls` entirely stubbed
- [ ] `console.table()` prints raw value
- [ ] `console.log` uses JSON.stringify not util.inspect
- [ ] `net.Socket` — `remoteAddress`/`remotePort` undefined on accepted sockets
- [ ] `crypto` — `createCipheriv`, `createSign`, `pbkdf2`, `scrypt` throw
- [ ] `util` missing `styleText`, `MIMEType`

## low

- [ ] `os.cpus()` returns `speed: 0` and zero times
- [ ] `dgram` entirely stubbed
- [ ] `cluster` entirely stubbed
- [ ] `worker_threads` — `Worker` throws
- [ ] `vm.ContextifyScript` stub does nothing
- [ ] `readline` — no stdin input support
- [ ] `perf_hooks` — `PerformanceObserver` is no-op
- [ ] `process.nextTick` relies on V8 microtask ordering — fragile

## done

- [x] event loop OOM — microtask drain + busy-spin fix
- [x] `setInterval(fn, 0)` treated as one-shot — minimum 1ms interval
- [x] `assert.doesNotReject` missing
- [x] `events.listenerCount` missing listener filter arg
- [x] `events.eventNames` missing Symbol support
- [x] bootstrap `internalBinding` stubs for util, uv, task_queue, performance, async_wrap
- [x] `os.freemem()` — fixed struct offset, reads `(stats as *u32)[0]` for `free_count`
- [x] `os.platform`/`os.arch` — now functions, added `endianness`, `userInfo`, `networkInterfaces`
- [x] `fs.readFileSync` — returns Buffer (string with encoding opt)
- [x] `fs.appendFileSync` — implemented
- [x] `fs.mkdirSync` — `{recursive: true}` support
- [x] fs errors — `.code`/`.syscall`/`.path` on all errors
- [x] `process.hrtime()` — fixed: removed JS stub that shadowed native binding
- [x] `performance.now()` — returns ms-since-start, not epoch
- [x] `URL.searchParams` — full URLSearchParams implementation
- [x] `crypto.createHash` — real SHA-256/SHA-1/SHA-512/MD5 via CommonCrypto
- [x] `crypto.randomBytes` — secure random via `getentropy`
- [x] `crypto.createHmac` — real HMAC implementation
- [x] `process.env` — `Object.keys()` enumerates native environ
- [x] `fs.statSync` — full fields: dev, ino, nlink, uid, gid, atimeMs, ctimeMs, birthtimeMs, Date objects
- [x] `node_modules` resolution — walk up dir tree, read package.json main
- [x] `require.resolve`, `require.cache`, `require.main`
- [x] stream flowing mode — `on('data')` triggers `resume()`, `push()` emits in flowing mode
- [x] `fs.createReadStream`/`createWriteStream` — real fd-backed streams with pipe support
- [x] `fs.openSync`/`readSync`/`writeSync`/`closeSync` — native fd operations
- [x] `Writable.end()` defers 'finish' emit via nextTick (matches Node.js behavior)
- [x] `child_process` — real `execSync`/`spawnSync`/`exec`/`spawn` via posix_spawnp + pipe
- [x] `process.memoryUsage()` — real RSS via mach_task_basic_info
- [x] `process.stdin` — Readable stream on fd 0
- [x] `process.stdout.isTTY` — real isatty() check
- [x] `assert.strict(value)` — checks truthiness not `=== true`
- [x] `module._resolveFilename`/`_cache`/`_extensions` — implemented
- [x] `dns.lookup()` — real getaddrinfo via C helper, IPv4/IPv6, promises API
