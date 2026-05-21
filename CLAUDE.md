# node-milo

Node.js runtime ported to Milo. Compiles native via Milo compiler.

## Build

```bash
cd $HOME/git/milo
bun run src/main.ts emit-obj ../node/src/milo/runtime/main.milo -o ../node/build/main.o
# then link with V8 C wrapper + system libs
```

## Milo Style

- **camelCase** all identifiers (functions, variables, types). No snake_case except extern C names matching C signatures.
- Only prefix `nm_` for init functions called from C binding registry.

## Milo Safety Best Practices

Goal: keep `unsafe` in thinnest possible layer. Binding orchestration safe; only raw FFI seam unsafe.

### Use `extern type` for opaque handles

```milo
// GOOD — type-safe, prevents handle mixups
extern type V8Isolate
extern type V8Context
extern type V8Value
extern fn v8c_isolate_new(): *V8Isolate
extern fn v8c_context_new(iso: *V8Isolate): *V8Context

// BAD — all handles are *u8, easy to swap by accident
struct Isolate { ptr: *u8 }
struct Context { ptr: *u8 }
```

### Let strings auto-coerce to *u8

Compiler auto-coerces `string` → `*u8` in extern calls. No cast or unsafe needed when extern returns scalar.

```milo
// GOOD — safe, auto-coercion handles it
puts(msg)
write(1, msg, msg.len)

// BAD — unnecessary unsafe
unsafe { puts(msg as *u8) }
```

### Use `.cstr()` for explicit pointer extraction

When you need `*u8` in variable (not just passing to extern), use `.cstr()` instead of casting.

```milo
// GOOD
let ptr = msg.cstr()

// BAD
unsafe { let ptr = msg as *u8 }
```

### Use `extern struct` for C struct layout

```milo
// GOOD — compiler handles field offsets via GEP
extern struct SockAddrIn {
  sin_family: u16,
  sin_port: u16,
  sin_addr: u32,
  sin_zero: [u8; 8],
}
unsafe { addr.sin_port = htons(port) }

// BAD — manual byte-offset arithmetic
unsafe {
  let p = addr as *u8
  let portPtr = (p as i64 + 2) as *u16
  portPtr[0] = htons(port)
}
```

### Minimize unsafe surface area

Wrap raw FFI in small functions exposing safe interface. Keep binding logic (arg validation, result construction) outside unsafe.

```milo
// GOOD — unsafe is one line
fn getHostName(): string {
  var buf: [u8; 256] = [0; 256]
  unsafe { gethostname(buf, 256) }
  return _cstrToString(buf.cstr())
}

// BAD — entire function body is unsafe
fn getHostName(): string {
  unsafe {
    var buf: [u8; 256] = [0; 256]
    gethostname(buf as *u8, 256)
    return _cstrToString(buf as *u8)
  }
}
```

### Safe extern call rules

Extern call does NOT need `unsafe` when:
- All pointer params receive auto-coerced args (string→*u8, array→*T, or matching *T)
- Return type is scalar or void

Extern call DOES need `unsafe` when:
- Returns pointer (*T) — unknown provenance
- Param takes raw *T not from auto-coercion

## Compat Roadmap

See `src/milo/ROADMAP.md` for full Node.js compatibility gaps. When working on milo-node:
- Pick items from roadmap (critical first, then high)
- After fixing, mark `[x]` and move to `## done` section
- Add new gaps as discovered
- Only run tests for module you're fixing: `./out/Release/milo-node -e "..."`
- Full rebuild: `bash src/milo/build.sh`

## Architecture

```
JS → V8 C wrapper (v8_c_api.cpp) → Milo bindings → POSIX/macOS syscalls
```

- `v8/v8.milo` — V8 C API wrappers (safe Milo interface over extern fns)
- `bindings/*.milo` — Native module implementations (tcp, fs, os, env, timers, etc.)
- `runtime/main.milo` — Bootstrap, binding registry, JS execution

## Fast Call Trampoline Pattern

For hot-path binding ops (buffer compare, copy, indexOf, fill, etc.), use `v8c_fast_call` — a single generic C trampoline that eliminates per-call FFI overhead.

**Problem**: Normal bindings do ~8 FFI round-trips per call (fci_length, fci_arg, isolate, typedArrayData, typedArrayByteLength, etc). For small buffers this overhead dominates.

**Solution**: ONE C function (`v8c_fast_call` in v8capi.cc) walks JS args, extracts typed arrays as raw `(ptr, len)` pairs and numbers as `i32`, then calls a Milo function pointer with a universal signature:

```
JS call → V8 slow callback → v8c_fast_call (extracts all args in C++) → Milo fn(buf0, len0, buf1, len1, i0, i1, i2) → i32
```

### How to use

1. Write a pure Milo impl fn with the universal 7-arg signature:
```milo
fn compareImpl(a: *u8, aLen: i64, b: *u8, bLen: i64, _i0: i32, _i1: i32, _i2: i32): i32 {
    // all logic here, no V8 API calls
}
```

2. Register with `setFastMethod` (trampoline = `v8c_fast_call`, data = Milo fn):
```milo
c.setFastMethod(exp, "compare", v8c_fast_call as *u8, compareImpl as *u8)
```

3. The C trampoline auto-classifies JS args: TypedArrays → buf0/buf1, Numbers → i0/i1/i2. Unused slots are null/0.

### Limits and next steps

- Currently uses V8 slow callback path. Gives ~40% improvement over raw FFI but still 4-6x slower than Node on 1KB buffers. At 1MB, matches Node exactly.
- To close remaining gap: add V8 Fast API (`CFunction` + `CFunctionInfo`) registration that calls same Milo impl fns. This bypasses FunctionCallbackInfo entirely.
- Only works for ops that take typed arrays + ints and return i32. String encode/decode ops still use traditional `setMethod` approach.