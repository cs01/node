# N-API for node-milo

**129 of 161 Node-API functions are node's own code, compiled — not reimplemented.**

`src/js_native_api_v8.cc` is 3748 lines with exactly ONE `node::` reference
(`node::OnScopeLeave`, :81) and ZERO `uv_` references. Node ships
`js_native_api_v8_internals.h` explicitly as a porting seam for non-node embedders. Replacing
that one header with `js_native_api_v8_internals.h` here compiles node's real implementation
against milo's V8. It produces 129 `napi_*` symbols with a single undefined
(`napi_create_external_buffer`, which belongs to the node_api side).

## Why not build on deps/v8capi

`v8capi`'s `v8c_value` is a slot index into a table of `v8::Global`, and its HandleScope is a
no-op ("handles outlive scopes via Global storage", v8capi.cc:307). But `napi_value` IS a
`v8::Local`. N-API must sit directly on V8. v8capi is used only at the seam that hands N-API
the `exports` object.

## Why build/napi holds copies

`js_native_api_v8.cc` does `#include "env-inl.h"` / `"util-inl.h"`, and a quoted include
resolves from the *including file's* directory first — so a `-I` shim can never shadow
node's. The build therefore copies the two files VERBATIM into `build/napi/` next to stub
`env-inl.h` / `util-inl.h` (both just include the seam; the .cc only needs CHECK* +
node::OnScopeLeave from them). Nothing is forked into the tree; the copies regenerate.

## Done since

- **dlopen + napi_register_module_v1** — `require('./foo.node')` loads addons.
- **napi_async_work** — a 4-thread pool (matching libuv's default) runs `execute` off-thread;
  `complete` is handed back to the LOOP thread via the EVFILT_USER wakeup, because calling
  V8 from a pool thread would corrupt the isolate. Pending work keeps the loop alive
  (`asyncBusy()` feeds the exit condition) — exiting while an addon is owed a callback would
  silently drop it. Verified end-to-end: a 200ms off-thread sleep resolves its promise in
  209ms.
- **Buffers** — `napi_create_buffer{,_copy}` / `napi_create_external_buffer` build a REAL
  Buffer via `Buffer.from(arrayBuffer)` on a V8 backing store, not a Uint8Array wearing the
  name. external_buffer copies (milo cannot adopt foreign memory into a JS Buffer) and runs
  the finalizer immediately: semantically safe, one copy more than node.
- **napi_make_callback / napi_fatal_error**.

## What is NOT done

- **`napi_threadsafe_function`** (7 fns) — the EVFILT_USER primitive now exists, so this is
  unblocked, just unwritten.
- **async_hooks context** — `napi_create_async_work`'s async_resource/name and
  `napi_make_callback`'s async_context are accepted and IGNORED. Work executes correctly;
  only async-hooks introspection (async_id/triggerId/destroy) is absent.
- **sharp crashes after succeeding.** `metadata()` AND `resize()` both work (libvips decodes
  and resizes through napi_async_work), then a V8 fatal hits while delivering the result.
  Suspect the drain path: completions run inside a V8 function callback, and resolving a
  promise there re-enters microtasks. INSTRUMENT before guessing — the fatal message is
  truncated by the stack dump; capture it first.

**`process.versions.napi` claims '10' (lib/_process_init.js:72) — still not fully true while
threadsafe_function is missing.**

## First milestone

`test/js-native-api/2_function_arguments` — `assert(addon.add(3,5) === 8)`. Needs only
napi_get_cb_info, napi_typeof, napi_get_value_double, napi_create_double,
napi_define_properties. All 5 are in the 129. Zero async, zero libuv.
