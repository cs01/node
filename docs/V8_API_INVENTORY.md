# V8 C++ API Inventory — Node.js src/

Scanned 180 .cc files in src/. Drives v8capi shim surface.

## Tier 1 — Essential (>50 files, implement first)

| Type | Files | Notes |
|------|-------|-------|
| v8::Local<T> | 89 (49%) | 420 uses. Most common handle. |
| v8::Value | 85 (47%) | Base type for all JS values |
| v8::Context | 84 (47%) | Execution environment |
| v8::Isolate | 79 (44%) | Per-thread V8 instance |
| FunctionCallback | 69 files | 786+ refs. Primary binding signature |
| v8::String | 57 (32%) | UTF-8/UTF-16 |
| v8::HandleScope | 54 (30%) | Handle lifetime |
| v8::Maybe<T> | 54 (30%) | Error-safe return |
| v8::Object | ~48 | Property access, internal fields |
| v8::MaybeLocal<T> | 47 (26%) | Handle-or-error |
| v8::Function | ~45 | Call, New, etc |
| v8::FunctionTemplate | 44 (24%) | Constructor/function definition |
| v8::Integer | 40 (22%) | 32/53-bit int |
| v8::Array | ~35 | JS arrays |

## Tier 2 — Important (20-50 files)

| Type | Files | Notes |
|------|-------|-------|
| v8::ArrayBuffer | 26 (14%) | Shared memory container |
| v8::ObjectTemplate | 26 (14%) | Object prototype definition |
| v8::EscapableHandleScope | 24 (13%) | Return handles from functions |
| v8::Int32 | 23 (13%) | Signed 32-bit |
| v8::Number | 22 (12%) | IEEE 754 double |
| v8::Uint32 | 21 (12%) | Unsigned 32-bit |
| v8::Boolean | 18 (10%) | True/false |
| v8::Undefined | 17 (9%) | Undefined value |
| v8::Null | 15 (8%) | Null value |
| v8::CFunction | 13 (7%) | Fast API |
| v8::Global<T> | 12 (7%) | Persistent handles |
| v8::SnapshotCreator | 12 (7%) | Startup snapshots |
| v8::BackingStore | 11 (6%) | Memory lifecycle |
| v8::Exception | 11 (6%) | Create JS exceptions |
| v8::Script | 10 (6%) | Compiled JS |
| v8::DontDelete/ReadOnly/DontEnum | 10/9/6 | Property attributes |
| v8::Signature | 9 (5%) | Method receiver constraints |
| v8::TryCatch | 9 (5%) | Exception capture |
| v8::ArrayBufferView | 9 (5%) | Type-agnostic view |

## Tier 3 — Specialized (<20 files)

| Type | Files | Notes |
|------|-------|-------|
| v8::Symbol | 8 | Unique identifier |
| v8::Promise | 8 | Promise object |
| v8::PropertyCallbackInfo<T> | 8 | Property interception |
| v8::ScriptCompiler | 7 | Compilation cache |
| v8::StackTrace | 7 | Call stack |
| v8::SideEffectType | 7 | Pure function marker |
| v8::Uint8Array | 6 | Byte array |
| v8::BigInt | 6 | Arbitrary precision int |
| v8::ScriptOrigin | 6 | Source location |
| v8::Message | 6 | Exception message |
| v8::WeakCallbackInfo<T> | 5 | GC callback |
| v8::SharedArrayBuffer | 5 | Multi-worker shared mem |
| v8::Locker | 4 | Isolate access lock |
| v8::Float64Array | 4 | 64-bit float array |
| v8::PropertyDescriptor | 4 | Property metadata |
| v8::FastApiCallbackOptions | 3 | Fast API params |
| v8::Module | 3 | ES modules |
| v8::NamedPropertyHandlerConfiguration | 3 | Named prop intercept |
| v8::ValueSerializer/Deserializer | 2/3 | Structured clone |
| v8::MicrotaskQueue | 2 | Microtask scheduling |
| v8::FastOneByteString | 2 | Fast string access |
| v8::IndexedPropertyHandlerConfiguration | 2 | Indexed prop intercept |
| v8::Platform | 1 | Task scheduling |
| v8::Eternal<T> | 1 | Never-relocated handle |

## Callback Signatures

1. **FunctionCallback** (69 files, 786+ refs) — `void(const FunctionCallbackInfo<Value>&)`
2. **PropertyCallbackInfo<T>** (8 files) — getter/setter/deleter/enumerator
3. **WeakCallbackInfo<T>** (5 files) — GC cleanup
4. **FastApiCallback** via CFunction (13 files, 44+ refs) — optimized calling

## Top Files by V8 Usage

| File | Refs | Role |
|------|------|------|
| js_native_api_v8.cc | 607 | N-API implementation |
| util.cc | 203 | Utility functions |
| node_api.cc | 142 | C API |
| node_contextify.cc | 67 | Context wrapping |
| env.cc | 64 | Environment init |
| node_buffer.cc | 52 | Buffer management |
| module_wrap.cc | 46 | Module system |
| node_util.cc | 41 | JS utilities |
| node_messaging.cc | 41 | Worker messaging |
| node_errors.cc | 41 | Error handling |

## v8capi Implementation Status

**Done (tested):** Isolate, Context, HandleScope, EscapableHandleScope, Values (int32/uint32/double/bool/string/null/undefined/bigint/external), Object (get/set/has/delete by string/index/value), Array, Function (new/call), FunctionCallbackInfo (all accessors + return), FunctionTemplate, ObjectTemplate, TryCatch, Exceptions, Script compile+run, Persistent handles, JSON parse/stringify, Symbol, PropertyAttributes.

**Stubbed:** Internal fields (need isolate threading), ArrayBuffer data access, TypedArray ops, template instance/prototype template.

**Not started:** Fast-API CFunction, Module, SnapshotCreator, ValueSerializer, PropertyCallbackInfo, WeakCallbackInfo full impl, Inspector, Profiler.
