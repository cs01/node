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

## What is NOT done

- `node_api.cc`'s 32 node-specific functions (module registration, buffers, async).
- **The async tier is blocked on infrastructure milo lacks**: no threadpool (pthread_create
  appears once, for worker_threads) and no cross-thread event-loop wakeup (worker messaging
  is a mutex-guarded list the loop POLLS every 2ms; no EVFILT_USER, no self-pipe, libuv is
  not linked). `napi_async_work` needs a pool; `napi_threadsafe_function` needs an
  `uv_async_send` equivalent — EVFILT_USER on the existing kqueue is the natural fit.
- `dlopen` + `napi_register_module_v1` lookup. Today `.node` is a hard throw
  (lib/module.js:82, lib/_process_init.js:245).

**`process.versions.napi` already claims '10' (lib/_process_init.js:72) — that is a lie until
the above lands.** Same vacuous-claim pattern as tls's old hardcoded `authorized = true`.

## First milestone

`test/js-native-api/2_function_arguments` — `assert(addon.add(3,5) === 8)`. Needs only
napi_get_cb_info, napi_typeof, napi_get_value_double, napi_create_double,
napi_define_properties. All 5 are in the 129. Zero async, zero libuv.
