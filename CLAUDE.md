# node-milo

Node.js runtime ported to Milo. Compiles to native code via the Milo compiler.

## Build

```bash
cd $HOME/git/milo
bun run src/main.ts emit-obj ../node/src/milo/runtime/main.milo -o ../node/build/main.o
# then link with V8 C wrapper + system libs
```

## Milo Style

- **camelCase** for all identifiers (functions, variables, types). No snake_case except for extern C function names that must match their C signature.
- Only prefix with `nm_` for init functions that are called from the C binding registry.

## Milo Safety Best Practices

Goal: keep `unsafe` contained to the thinnest possible layer. Binding *orchestration* should be safe; only the raw FFI seam should be unsafe.

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

The compiler auto-coerces `string` → `*u8` in extern calls. No cast or unsafe needed when the extern returns a scalar.

```milo
// GOOD — safe, auto-coercion handles it
puts(msg)
write(1, msg, msg.len)

// BAD — unnecessary unsafe
unsafe { puts(msg as *u8) }
```

### Use `.cstr()` for explicit pointer extraction

When you need the `*u8` in a variable (not just passing to an extern), use `.cstr()` instead of casting.

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

Wrap raw FFI in small functions that expose a safe interface. Keep binding logic (argument validation, result construction) outside unsafe.

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

An extern call does NOT need `unsafe` when:
- All pointer params receive auto-coerced args (string→*u8, array→*T, or matching *T)
- Return type is scalar or void

An extern call DOES need `unsafe` when:
- It returns a pointer (*T) — unknown provenance
- A param takes a raw *T that isn't from auto-coercion

## Compat Roadmap

See `src/milo/ROADMAP.md` for the full list of Node.js compatibility gaps. When working on milo-node:
- Pick items from the roadmap (critical first, then high, etc.)
- After fixing, mark the item `[x]` and move to the `## done` section
- Add new gaps as you discover them
- Only run tests relevant to the module you're fixing: `./out/Release/milo-node -e "..."`
- Full rebuild: `bash src/milo/build.sh`

## Architecture

```
JS → V8 C wrapper (v8_c_api.cpp) → Milo bindings → POSIX/macOS syscalls
```

- `v8/v8.milo` — V8 C API wrappers (safe Milo interface over extern fns)
- `bindings/*.milo` — Native module implementations (tcp, fs, os, env, timers, etc.)
- `runtime/main.milo` — Bootstrap, binding registry, JS execution
