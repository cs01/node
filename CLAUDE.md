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