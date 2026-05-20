# Roadmap: Rewrite Node.js runtime in Milo

## Context

Fork of nodejs/node (latest main, currently v27.0.0-pre). Rewrite C++ runtime — 76k LOC, 106 .cc, 66 internal bindings — in Milo. V8 stays C++ (untouched). JS lib/*.js (341 files) stays JS on V8. C deps (openssl, icu, nghttp2, llhttp, c-ares, zlib) kept as C; Milo FFIs them.

Hard constraint: V8 has no C ABI. Milo only calls C. → thin C++ shim (v8capi) bridging V8's C++ API to C ABI. Zero Node logic in shim — only V8 marshalling.

## Architecture

```
node binary (main: Milo)
  ├─ Milo runtime  (replaces all src/*.cc)  ──FFI──> v8capi (C++ shim) ──> V8
  ├─ Milo bindings (use Milo std/runtime directly — no libuv)
  └─ C deps (openssl, icu, nghttp2, llhttp, c-ares, zlib) — kept, FFI'd
JS lib/*.js → unchanged on V8
```

No libuv compat layer. Each Milo binding uses std/runtime directly (kqueue/epoll). libuv deleted incrementally as bindings migrate.

## Decisions (locked)

- **V8**: whatever ships with Node (currently 12.4.x)
- **Snapshots**: disabled initially. Re-enable when binding addresses stabilize.
- **Windows**: out of scope. POSIX-only (darwin-arm64, linux-x64/aarch64).
- **Bounds checks**: safe by default, unsafe fast paths where profiling demands.
- **C deps**: kept as C, FFI'd. libuv is sole exception — replaced by Milo std/runtime.
- **Repo**: cs01/node fork, upstream = nodejs/node.

## Open questions

- Panic at FFI boundary: Milo panic inside V8 callback must not unwind through V8. Need longjmp or error-code convention at shim.
- Memory ownership at FFI boundary: who frees when Milo allocates and passes to V8?
- Thread safety: Node uses worker_threads + libuv thread pool. Milo's threading model needs to be compatible.

---

## Phase 0 — Fork + baseline ✅ DONE

- [x] Fork nodejs/node → cs01/node
- [x] Build vanilla Node (darwin-arm64)
- [x] Remotes: origin = cs01/node, upstream = nodejs/node
- [ ] Run baseline test suite (`python tools/test.py`) — regression oracle
- [ ] Baseline benchmark (`benchmark/`)

## Phase 1 — Milo compiler hardening (../milo repo)

FFI audit found 4 blocking gaps:

1. **C-ABI export** — `@export`/`export fn`: C calling convention, no mangling
   - Files: parser.ts, checker.ts, lower.ts, codegen.ts, tokens.ts
   - Status: NOT STARTED

2. **Object/static-lib emission** — `emit-obj`, `build-lib` CLI
   - main.ts already runs `llc -filetype=obj`; stop before link, add `ar`
   - Status: NOT STARTED

3. **Bare C function pointers** — non-capturing fn → raw code pointer
   - Needed for V8 callbacks. Previous node-milo used `fn as *u8` cast — may already work
   - Files: types.ts, codegen.ts, checker.ts
   - Status: PARTIALLY WORKING (needs verification)

4. **repr(C) layout** — guaranteed field order/padding/align for extern struct
   - codegen.ts struct layout. Previous node-milo used extern struct (Timespec, Rusage) successfully
   - Status: PARTIALLY WORKING

**Gate**: Milo .o linked into C program; C calls Milo; Milo passes callback to C; round-trip test passes.

## Phase 2 — v8capi C++ shim ⬅️ IN PROGRESS

Hand-written C++ static lib. Flattens V8 API subset Node uses → C ABI.

**Done:**
- [x] V8 API inventory: 170 types, 3000+ refs across 180 .cc files (see docs/V8_API_INVENTORY.md)
- [x] Tier 1 C ABI header (deps/v8capi/include/v8capi.h)
- [x] Implementation (deps/v8capi/src/v8capi.cc) — handle table, slot-based value model
- [x] Smoke test: 7/7 tests pass (eval, callbacks, strings, objects, arrays, exceptions, type checks)

**TODO:**
- [ ] Internal field ops (need isolate threading through API)
- [ ] ArrayBuffer/TypedArray data access (need isolate param)
- [ ] Fast-API CFunction registration
- [ ] Template instance/prototype template accessors
- [ ] FunctionTemplate::Inherit
- [ ] ObjectTemplate::SetInternalFieldCount
- [ ] Integrate into GYP build (node.gyp)
- [ ] PropertyCallbackInfo (accessor get/set)

**Handle model**: Milo holds `v8c_value { slot: i32 }` handles. Never dereferences V8 pointers. Lifetime managed by Global<> in handle table. HandleScope wrapping via struct embedding (V8 forbids heap-allocated HandleScope).

## Phase 3 — Milo runtime spine

Reimplement in Milo:
- Bootstrap: node_main.cc, node_main_instance.*, node.cc Start path
- Environment / IsolateData lifecycle (Milo struct owning isolate + loop refs)
- Binding registry (replace NODE_BINDING_CONTEXT_AWARE_INTERNAL)
- JS builtin loader (node_builtins.cc — loads lib/*.js)
- **Gate**: boot `node -e "1+1"` — isolate+context+eval, no I/O bindings

## Phase 4 — Binding migration (66 bindings)

One .cc → one .milo. JS lib/ unchanged. Node test suite green after each binding.

Order by dependency/risk:
1. **Leaf/pure** — constants, os, util, config, debug, internal_only_v8, encoding_binding
2. **Core** — buffer/blob, process_methods, credentials, errors, builtins
3. **I/O** (Milo std/runtime) — timers, fs, fs_dir, fs_event, tcp/udp/pipe/tty wrap, stream_wrap, process spawn
4. **C-dep wrappers** — http_parser→llhttp, http2→nghttp2, cares→c-ares, crypto→openssl/ncrypto, zlib, i18n→icu, sqlite
5. **Engine-coupled** — contextify(vm), serdes, messaging, worker, async_wrap/async_hooks, perf, inspector, snapshotable, heap_utils, sea, report

**Salvaged from prior attempt** (src/milo/bindings/):
- fs.milo — POSIX syscall wrappers (stat, read, write, readdir, etc.)
- os.milo — hostname, uid/gid, cpu info, memory, loadavg
- process.milo — hrtime, kill, cpuUsage, utimes via extern struct
- env.milo — getenv via V8 C API
- These need v8capi migration (old node-milo used different v8_c_api.h interface)

## Phase 5 — Cutover + parity

- Remove last C++ .cc (only v8capi shim remains C++)
- Full `tools/test.py` green
- `benchmark/` ≥ baseline
- linux-x64 + aarch64 parity

## Cross-cutting

- **Build**: integrate Milo into GYP — custom action .milo → .o, link into libnode
- **CI**: Node test suite + benchmark gate per binding PR
- **Snapshot**: disabled until Phase 4 mostly done

## Key files

| Area | Files |
|------|-------|
| v8capi shim | deps/v8capi/{include/v8capi.h, src/v8capi.cc, test/test_v8capi.cc} |
| V8 inventory | docs/V8_API_INVENTORY.md |
| Milo bindings (salvaged) | src/milo/bindings/{fs,os,process,env}.milo |
| Milo compiler (Phase 1) | ../milo/src/{parser,checker,lower,codegen,main,types,tokens}.ts |
| Node spine | src/{node_main,node_main_instance,node,env,node_binding,node_builtins}.{cc,h} |
| Build config | node.gyp, node.gypi, common.gypi |

## Verification

- Per-phase gate: C↔Milo round-trip (P1); v8capi smoke test (P2); boot `node -e` (P3); per-binding test green (P4)
- Final: `python tools/test.py` full pass; `benchmark/` ≥ baseline
