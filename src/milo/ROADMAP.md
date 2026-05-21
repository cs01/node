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

### stream
- [ ] `stream.Readable` async iterator — event loop doesn't keep alive for `for await` on streams
- [ ] `stream.Writable.toWeb()` / `Readable.toWeb()` — needs ReadableStream/WritableStream globals in V8

## low

- [ ] `dgram` — UDP socket send/receive
- [ ] `cluster` module
- [ ] `worker_threads` — `Worker`, `MessageChannel`, `MessagePort`
- [ ] `vm` — proper sandbox isolation via V8 contexts
- [ ] `perf_hooks` — `monitorEventLoopDelay` real histogram, `eventLoopUtilization`
- [ ] `readline` — real terminal raw mode, completion, history
- [ ] `process.nextTick` — proper implementation (currently microtask-based, fragile)
- [ ] Buffer pooling optimization
- [ ] `domain` module (deprecated but some packages use it)
