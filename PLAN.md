# Plan: Fork Node 22, rewrite runtime in Milo

## Context

Fork Node 22.22 (../node). Rewrite entire C++ runtime — 76k LOC, 106 .cc, 66 internal bindings — in Milo. Keep V8 (C++, untouched). Node's JS lib/*.js (341 files) stays JS — runs on V8 unchanged. C deps (openssl, icu, nghttp2, llhttp, c-ares, zlib...) kept as C; Milo FFIs them.

Hard constraint: V8 has no C ABI. Milo only calls C. → one unavoidable thin C++ shim (v8capi) bridging V8's C++ API to a C ABI. Zero Node logic in shim — only V8 marshalling.

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

- **V8**: pinned at 12.
- **Snapshots**: disabled (simpler). Re-enable later if boot time matters.
- **Windows**: out of scope. POSIX-only (darwin-arm64, linux-x64/aarch64).
- **Bounds checks**: safe by default, unsafe fast paths where profiling demands.
- **C deps**: kept as C, FFI'd. libuv is the sole exception — replaced by Milo std/runtime (it's the runtime, not a leaf dep).
- **Fork location**: separate repo, track upstream as remote.

## Phase 0 — Fork + baseline oracle

- Fork ../node → separate repo. Build vanilla 22.22. Pin V8 12.
- Baseline: `python tools/test.py` (regression oracle), `benchmark/` (perf gate).
- darwin-arm64 first, then linux-x64/aarch64.

## Phase 1 — Milo compiler hardening (critical path, ../milo repo)

FFI audit found 4 blocking gaps. All tractable in src/:
1. **C-ABI export** — @export/export fn: C calling conv, no mangling. parser.ts, checker.ts, lower.ts, codegen.ts, tokens.ts.
2. **Object/static-lib emission** — emit-obj, build-lib CLI. main.ts already runs llc -filetype=obj; stop before link, add ar.
3. **Bare C function pointers** — non-capturing fn → raw code pointer, distinct from {ptr,ptr} closures. Needed for V8 callbacks. types.ts, codegen.ts, checker.ts.
4. **repr(C) layout** — guaranteed field order/padding/align for extern struct. codegen.ts struct layout.
- Exported Milo fns must match V8 FunctionCallback + fast-API CFunction signatures.
- **Gate**: Milo .o linked into a C program; C calls Milo; Milo passes callback to C; round-trip test passes.

## Phase 2 — v8capi C++ shim

- Hand-written C++ static lib. Flatten V8-12 subset Node uses → C ABI.
- Inventory: scan ../node/src/*.cc for v8:: usage → drives shim spec.
- Surface: Isolate, Context, HandleScope, Local/Persistent (opaque handles), Object/Array/String/Number, FunctionTemplate, FunctionCallbackInfo accessors, CFunction registration (fast-API), GC + microtask callbacks.
- Exceptions: caught in shim, returned as error codes — C++ exception never crosses into Milo.
- Handle model: Milo holds opaque *u8 handles, never dereferences; lifetime = shim HandleScope.

## Phase 3 — Milo runtime spine

Reimplement in Milo:
- Bootstrap: node_main.cc, node_main_instance.*, node.cc Start path.
- Environment / IsolateData lifecycle (Milo struct owning isolate + loop refs).
- Binding registry (replace NODE_BINDING_CONTEXT_AWARE_INTERNAL).
- JS builtin loader (node_builtins.cc — loads lib/*.js).
- **Gate**: boot `node -e "1+1"` — isolate+context+eval, no I/O bindings.

## Phase 4 — Binding migration (66 bindings)

One .cc → one .milo. JS lib/ unchanged. Node test suite green after each binding.
Per binding: reimpl Initialize (register methods on target), per-method callbacks (C-ABI exported Milo fns), RegisterExternalReferences (snapshot), fast-API CFunctions where Node uses SetFastMethod.

Order by dependency/risk:
1. **Leaf/pure** — constants, os, util, config, debug, internal_only_v8, encoding_binding
2. **Core** — buffer/blob, process_methods, credentials, errors, builtins
3. **I/O** (Milo std/runtime) — timers, fs, fs_dir, fs_event, tcp/udp/pipe/tty wrap, stream_wrap, process spawn
4. **C-dep wrappers** — http_parser→llhttp, http2→nghttp2, cares→c-ares, crypto→openssl/ncrypto, zlib, i18n→icu, sqlite
5. **Engine-coupled** — contextify(vm), serdes, messaging, worker, async_wrap/async_hooks, perf, inspector, snapshotable, heap_utils, sea, report

## Phase 5 — Cutover + parity

- Remove last C++ .cc (only v8capi shim remains C++). main is Milo.
- Full `tools/test.py` green; test262 (JS, unchanged).
- `benchmark/` ≥ baseline.
- linux-x64 + aarch64 parity.

## Cross-cutting

- **Build**: integrate Milo into GYP — custom action .milo → .o, link into libnode. node.gyp, node.gypi, common.gypi.
- **CI**: Node test suite + benchmark gate per binding PR.
- **Snapshot**: disabled until Phase 4 mostly done, then restore with stable exported-fn addresses.

## Critical files

**Milo repo** (Phase 1): src/parser.ts, checker.ts, lower.ts, codegen.ts, main.ts, types.ts, tokens.ts; std/event.*, net.milo, signal.milo, thread.milo, os.milo (Phase 4 reuse).

**Node fork**: src/node_main.cc, node_main_instance.*, node.cc, env.*, node_binding.cc, node_builtins.cc, node_snapshotable.cc (spine); src/node_*.cc ×66 (migration); deps/uv/ (deleted incrementally); node.gyp/node.gypi/common.gypi (build). New: deps/v8capi/ (C++ shim), src/*.milo.

## Verification

- Per-phase gate: C↔Milo round-trip (P1); boot `node -e` (P3); per-binding Node test green (P4).
- Final: `python tools/test.py` full pass darwin-arm64 + linux-x64; `benchmark/` ≥ baseline; test262.
- Diff oracle: forked node behavior == vanilla 22.22.
