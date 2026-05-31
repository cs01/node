// v8capi.cc — C ABI shim implementation.
// Maps v8c_value slots to v8::Local<v8::Value> via per-isolate handle tables.

#include "v8capi.h"
#include "v8.h"
#include "v8-fast-api-calls.h"
#include "libplatform/libplatform.h"

#include <cassert>
#include <cstring>
#include <memory>
#include <vector>
#include <thread>
#include <mutex>
#include <deque>
#include <atomic>
#include <string>
#include <cstdlib>

// ---------------------------------------------------------------------------
// Handle table — maps int32_t slots to v8::Local<v8::Value>
// One per isolate, threaded via isolate slot data.
// ---------------------------------------------------------------------------

static constexpr int kHandleTableSlot = 0;
// slot 1 = TemplateTable (used implicitly as kHandleTableSlot + 1)
static constexpr int kActiveContextSlot = 2;
static constexpr int kPrivateTableSlot = 3;
static constexpr int kMaxSlots = 65536;

// Forward declaration for dynamic import callback
static v8::MaybeLocal<v8::Promise> DynamicImportCallback(
    v8::Local<v8::Context>, v8::Local<v8::Data>,
    v8::Local<v8::Value>, v8::Local<v8::String>,
    v8::Local<v8::FixedArray>);
static void PromiseRejectCallback(v8::PromiseRejectMessage message);

struct HandleTable {
    v8::Isolate* isolate;
    std::vector<v8::Global<v8::Value>> slots;
    std::vector<int32_t> free_list;
    int32_t next_id = 0;

    explicit HandleTable(v8::Isolate* iso) : isolate(iso) {}

    int32_t store(v8::Local<v8::Value> val) {
        int32_t id;
        if (!free_list.empty()) {
            id = free_list.back();
            free_list.pop_back();
            slots[id].Reset(isolate, val);
        } else {
            id = next_id++;
            slots.emplace_back(isolate, val);
        }
        return id;
    }

    v8::Local<v8::Value> get(int32_t slot) {
        if (slot < 0 || slot >= next_id) return v8::Local<v8::Value>();
        return slots[slot].Get(isolate);
    }

    void release(int32_t slot) {
        if (slot >= 0 && slot < next_id) {
            slots[slot].Reset();
            free_list.push_back(slot);
        }
    }
};

// Template handle tables (separate namespace from values)
struct TemplateTable {
    v8::Isolate* isolate;
    std::vector<v8::Global<v8::FunctionTemplate>> fn_templates;
    std::vector<v8::Global<v8::ObjectTemplate>> obj_templates;

    explicit TemplateTable(v8::Isolate* iso) : isolate(iso) {}

    int32_t store_ft(v8::Local<v8::FunctionTemplate> ft) {
        int32_t id = static_cast<int32_t>(fn_templates.size());
        fn_templates.emplace_back(isolate, ft);
        return id;
    }

    v8::Local<v8::FunctionTemplate> get_ft(int32_t slot) {
        return fn_templates[slot].Get(isolate);
    }

    int32_t store_ot(v8::Local<v8::ObjectTemplate> ot) {
        int32_t id = static_cast<int32_t>(obj_templates.size());
        obj_templates.emplace_back(isolate, ot);
        return id;
    }

    v8::Local<v8::ObjectTemplate> get_ot(int32_t slot) {
        return obj_templates[slot].Get(isolate);
    }
};

// Private symbol table — separate from Value handles since Private extends Data, not Value
struct PrivateTable {
    v8::Isolate* isolate;
    std::vector<v8::Global<v8::Private>> privates;

    explicit PrivateTable(v8::Isolate* iso) : isolate(iso) {}

    int32_t store(v8::Local<v8::Private> p) {
        int32_t id = static_cast<int32_t>(privates.size());
        privates.emplace_back(isolate, p);
        return id;
    }

    v8::Local<v8::Private> get(int32_t slot) {
        return privates[slot].Get(isolate);
    }
};

static HandleTable* get_ht(v8c_isolate* iso) {
    auto* i = reinterpret_cast<v8::Isolate*>(iso);
    return static_cast<HandleTable*>(i->GetData(kHandleTableSlot));
}

static TemplateTable* get_tt(v8c_isolate* iso) {
    auto* i = reinterpret_cast<v8::Isolate*>(iso);
    return static_cast<TemplateTable*>(i->GetData(kHandleTableSlot + 1));
}

static HandleTable* get_ht_from_v8(v8::Isolate* iso) {
    return static_cast<HandleTable*>(iso->GetData(kHandleTableSlot));
}

static PrivateTable* get_pt(v8c_isolate* iso) {
    auto* i = reinterpret_cast<v8::Isolate*>(iso);
    return static_cast<PrivateTable*>(i->GetData(kPrivateTableSlot));
}

static PrivateTable* get_pt_from_v8(v8::Isolate* iso) {
    return static_cast<PrivateTable*>(iso->GetData(kPrivateTableSlot));
}

#define ISO(x) (reinterpret_cast<v8::Isolate*>(x))
#define CTX(x) (reinterpret_cast<v8::Persistent<v8::Context>*>(x))

// Store a local value in the handle table, return v8c_value
static v8c_value wrap(v8::Isolate* iso, v8::Local<v8::Value> val) {
    if (val.IsEmpty()) return V8C_VALUE_INVALID;
    auto* ht = get_ht_from_v8(iso);
    return {ht->store(val)};
}

static v8::Local<v8::Value> unwrap(v8::Isolate* iso, v8c_value val) {
    if (val.slot < 0) return v8::Local<v8::Value>();
    auto* ht = get_ht_from_v8(iso);
    return ht->get(val.slot);
}

// ---------------------------------------------------------------------------
// Platform
// ---------------------------------------------------------------------------

static std::unique_ptr<v8::Platform> g_platform;

extern "C" void v8c_set_flags_from_string(const char* flags) {
    v8::V8::SetFlagsFromString(flags);
}

extern "C" int32_t v8c_platform_init(const char* exec_path) {
    v8::V8::InitializeICUDefaultLocation(exec_path);
    v8::V8::InitializeExternalStartupData(exec_path);
    g_platform = v8::platform::NewDefaultPlatform();
    v8::V8::InitializePlatform(g_platform.get());
    v8::V8::Initialize();
    return 0;
}

extern "C" void v8c_platform_shutdown(void) {
    v8::V8::Dispose();
    v8::V8::DisposePlatform();
    g_platform.reset();
}

// ---------------------------------------------------------------------------
// Isolate
// ---------------------------------------------------------------------------

extern "C" v8c_isolate* v8c_isolate_new(void) {
    v8::Isolate::CreateParams params;
    params.array_buffer_allocator =
        v8::ArrayBuffer::Allocator::NewDefaultAllocator();
    v8::Isolate* iso = v8::Isolate::New(params);

    auto* ht = new HandleTable(iso);
    auto* tt = new TemplateTable(iso);
    auto* pt = new PrivateTable(iso);
    iso->SetData(kHandleTableSlot, ht);
    iso->SetData(kHandleTableSlot + 1, tt);
    iso->SetData(kPrivateTableSlot, pt);
    iso->SetHostImportModuleDynamicallyCallback(DynamicImportCallback);
    iso->SetPromiseRejectCallback(PromiseRejectCallback);

    return reinterpret_cast<v8c_isolate*>(iso);
}

extern "C" v8c_isolate* v8c_isolate_new_with_heap_limit(size_t max_heap_mb) {
    v8::Isolate::CreateParams params;
    params.array_buffer_allocator =
        v8::ArrayBuffer::Allocator::NewDefaultAllocator();
    params.constraints.ConfigureDefaultsFromHeapSize(0, max_heap_mb * 1024 * 1024);
    v8::Isolate* iso = v8::Isolate::New(params);

    auto* ht = new HandleTable(iso);
    auto* tt = new TemplateTable(iso);
    auto* pt = new PrivateTable(iso);
    iso->SetData(kHandleTableSlot, ht);
    iso->SetData(kHandleTableSlot + 1, tt);
    iso->SetData(kPrivateTableSlot, pt);
    iso->SetHostImportModuleDynamicallyCallback(DynamicImportCallback);
    iso->SetPromiseRejectCallback(PromiseRejectCallback);

    return reinterpret_cast<v8c_isolate*>(iso);
}

extern "C" void v8c_isolate_dispose(v8c_isolate* iso) {
    auto* i = ISO(iso);
    auto* ht = get_ht(iso);
    auto* tt = get_tt(iso);
    auto* pt = get_pt(iso);
    auto* alloc = i->GetArrayBufferAllocator();
    delete ht;
    delete tt;
    delete pt;
    i->Dispose();
    delete alloc;
}

extern "C" void v8c_isolate_enter(v8c_isolate* iso) {
    ISO(iso)->Enter();
}

extern "C" void v8c_isolate_exit(v8c_isolate* iso) {
    ISO(iso)->Exit();
}

extern "C" void v8c_isolate_run_microtasks(v8c_isolate* iso) {
    ISO(iso)->PerformMicrotaskCheckpoint();
}

// Continuation-preserved embedder data — V8 automatically propagates this across
// promise continuations (await), which is exactly the substrate AsyncLocalStorage
// needs. Stores/reads a single JS Value (an async-context frame object).
extern "C" v8c_value v8c_isolate_get_continuation_data(v8c_isolate* iso) {
    auto* i = ISO(iso);
    v8::HandleScope scope(i);
    auto data = i->GetContinuationPreservedEmbedderDataV2();
    if (data.IsEmpty()) return V8C_VALUE_INVALID;
    auto val = data.As<v8::Value>();
    if (val->IsUndefined()) return V8C_VALUE_INVALID;
    return wrap(i, val);
}

extern "C" void v8c_isolate_set_continuation_data(v8c_isolate* iso, v8c_value v) {
    auto* i = ISO(iso);
    v8::HandleScope scope(i);
    if (v.slot < 0) { i->SetContinuationPreservedEmbedderDataV2(v8::Local<v8::Data>()); return; }
    i->SetContinuationPreservedEmbedderDataV2(unwrap(i, v));
}

extern "C" void v8c_isolate_request_gc(v8c_isolate* iso) {
    ISO(iso)->RequestGarbageCollectionForTesting(
        v8::Isolate::kFullGarbageCollection);
}

extern "C" void v8c_isolate_low_memory_notification(v8c_isolate* iso) {
    ISO(iso)->LowMemoryNotification();
}

// ---------------------------------------------------------------------------
// HandleScope — V8 forbids heap allocation, so wrap in a struct
// ---------------------------------------------------------------------------

struct HandleScopeWrapper {
    v8::HandleScope scope;
    explicit HandleScopeWrapper(v8::Isolate* iso) : scope(iso) {}
};

struct EscapableHandleScopeWrapper {
    v8::EscapableHandleScope scope;
    explicit EscapableHandleScopeWrapper(v8::Isolate* iso) : scope(iso) {}
};

extern "C" v8c_handle_scope* v8c_handle_scope_new(v8c_isolate* iso) {
    return reinterpret_cast<v8c_handle_scope*>(
        new HandleScopeWrapper(ISO(iso)));
}

extern "C" void v8c_handle_scope_delete(v8c_handle_scope* hs) {
    delete reinterpret_cast<HandleScopeWrapper*>(hs);
}

extern "C" v8c_escapable_handle_scope*
v8c_escapable_handle_scope_new(v8c_isolate* iso) {
    return reinterpret_cast<v8c_escapable_handle_scope*>(
        new EscapableHandleScopeWrapper(ISO(iso)));
}

extern "C" v8c_value v8c_escapable_handle_scope_escape(
    v8c_escapable_handle_scope* ehs, v8c_value val) {
    // In our slot-based model, handles outlive scopes via Global storage
    return val;
}

extern "C" void v8c_escapable_handle_scope_delete(
    v8c_escapable_handle_scope* ehs) {
    delete reinterpret_cast<EscapableHandleScopeWrapper*>(ehs);
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

struct ContextWrapper {
    v8::Isolate* isolate;
    v8::Global<v8::Context> context;
};

extern "C" v8c_context* v8c_context_new(v8c_isolate* iso) {
    auto* i = ISO(iso);
    v8::HandleScope scope(i);
    auto ctx = v8::Context::New(i);
    // Share the creating context's security token so cross-context stack frames
    // stay visible in Error traces. Without this each vm context gets a unique
    // token and V8 elides its frames as cross-origin — breaking, e.g., a
    // vm.runInNewContext script that calls back into a host function and expects
    // its filename to appear in the stack (Buffer DEP0005 node_modules check).
    auto entered = i->GetCurrentContext();
    if (!entered.IsEmpty()) {
        ctx->SetSecurityToken(entered->GetSecurityToken());
    }
    auto* cw = new ContextWrapper{i, v8::Global<v8::Context>(i, ctx)};
    return reinterpret_cast<v8c_context*>(cw);
}

extern "C" void v8c_context_dispose(v8c_context* ctx) {
    delete reinterpret_cast<ContextWrapper*>(ctx);
}

extern "C" void v8c_context_enter(v8c_context* ctx) {
    auto* cw = reinterpret_cast<ContextWrapper*>(ctx);
    v8::HandleScope scope(cw->isolate);
    cw->context.Get(cw->isolate)->Enter();
    cw->isolate->SetData(kActiveContextSlot, cw);
}

extern "C" void v8c_context_exit(v8c_context* ctx) {
    auto* cw = reinterpret_cast<ContextWrapper*>(ctx);
    v8::HandleScope scope(cw->isolate);
    cw->context.Get(cw->isolate)->Exit();
}

extern "C" v8c_value v8c_context_global(v8c_context* ctx) {
    auto* cw = reinterpret_cast<ContextWrapper*>(ctx);
    v8::HandleScope scope(cw->isolate);
    auto local_ctx = cw->context.Get(cw->isolate);
    return wrap(cw->isolate, local_ctx->Global());
}

// Helper: get v8::Context from v8c_context*
static v8::Local<v8::Context> ctx_local(v8c_context* ctx) {
    auto* cw = reinterpret_cast<ContextWrapper*>(ctx);
    return cw->context.Get(cw->isolate);
}

static v8::Isolate* ctx_isolate(v8c_context* ctx) {
    return reinterpret_cast<ContextWrapper*>(ctx)->isolate;
}

// ---------------------------------------------------------------------------
// Persistent handles
// ---------------------------------------------------------------------------

// Persistent handles stored in a separate vector
struct PersistentEntry {
    v8::Global<v8::Value> handle;
    void* weak_param = nullptr;
    v8c_weak_callback weak_cb = nullptr;
};

static std::vector<PersistentEntry> g_persistents;
static std::vector<int32_t> g_persistent_free;

extern "C" v8c_persistent v8c_persistent_new(v8c_isolate* iso, v8c_value val) {
    auto* i = ISO(iso);
    auto local = unwrap(i, val);
    if (local.IsEmpty()) return V8C_PERSISTENT_INVALID;

    int32_t id;
    if (!g_persistent_free.empty()) {
        id = g_persistent_free.back();
        g_persistent_free.pop_back();
        g_persistents[id].handle.Reset(i, local);
    } else {
        id = static_cast<int32_t>(g_persistents.size());
        g_persistents.push_back({v8::Global<v8::Value>(i, local)});
    }
    return {id};
}

extern "C" v8c_value v8c_persistent_to_local(v8c_isolate* iso,
                                              v8c_persistent p) {
    if (p.slot < 0) return V8C_VALUE_INVALID;
    auto* i = ISO(iso);
    auto local = g_persistents[p.slot].handle.Get(i);
    return wrap(i, local);
}

extern "C" void v8c_persistent_reset(v8c_persistent p) {
    if (p.slot < 0) return;
    g_persistents[p.slot].handle.Reset();
    g_persistents[p.slot].weak_cb = nullptr;
    g_persistent_free.push_back(p.slot);
}

extern "C" void v8c_persistent_set_weak(v8c_persistent p,
                                         void* parameter,
                                         v8c_weak_callback callback) {
    if (p.slot < 0) return;
    g_persistents[p.slot].weak_param = parameter;
    g_persistents[p.slot].weak_cb = callback;
    // V8 weak callback will call our callback
    g_persistents[p.slot].handle.SetWeak(
        &g_persistents[p.slot],
        [](const v8::WeakCallbackInfo<PersistentEntry>& data) {
            auto* entry = data.GetParameter();
            if (entry->weak_cb) {
                entry->weak_cb(entry->weak_param);
            }
        },
        v8::WeakCallbackType::kParameter);
}

// ---------------------------------------------------------------------------
// Value type checks
// ---------------------------------------------------------------------------

#define TYPE_CHECK(name, method)                                               \
    extern "C" int v8c_value_is_##name(v8c_isolate* iso, v8c_value val) {      \
        auto local = unwrap(ISO(iso), val);                                    \
        return !local.IsEmpty() && local->method();                            \
    }

TYPE_CHECK(undefined, IsUndefined)
TYPE_CHECK(null, IsNull)
TYPE_CHECK(null_or_undefined, IsNullOrUndefined)
TYPE_CHECK(true, IsTrue)
TYPE_CHECK(false, IsFalse)
TYPE_CHECK(string, IsString)
TYPE_CHECK(number, IsNumber)
TYPE_CHECK(int32, IsInt32)
TYPE_CHECK(uint32, IsUint32)
TYPE_CHECK(boolean, IsBoolean)
TYPE_CHECK(object, IsObject)
TYPE_CHECK(function, IsFunction)
TYPE_CHECK(array, IsArray)
TYPE_CHECK(array_buffer, IsArrayBuffer)
TYPE_CHECK(array_buffer_view, IsArrayBufferView)
TYPE_CHECK(uint8array, IsUint8Array)
TYPE_CHECK(promise, IsPromise)
TYPE_CHECK(symbol, IsSymbol)
TYPE_CHECK(bigint, IsBigInt)
TYPE_CHECK(external, IsExternal)

#undef TYPE_CHECK

// True iff the view has materialized its backing ArrayBuffer. V8 keeps small
// typed arrays (<=64 bytes) on-heap with no buffer until .buffer is touched;
// internalBinding('util').arrayBufferViewHasBuffer surfaces that state.
extern "C" int v8c_array_buffer_view_has_buffer(v8c_isolate* iso, v8c_value val) {
    auto local = unwrap(ISO(iso), val);
    if (local.IsEmpty() || !local->IsArrayBufferView()) return 0;
    return local.As<v8::ArrayBufferView>()->HasBuffer() ? 1 : 0;
}

extern "C" int v8c_value_strict_equals(v8c_isolate* iso, v8c_value a,
                                        v8c_value b) {
    auto* i = ISO(iso);
    auto la = unwrap(i, a);
    auto lb = unwrap(i, b);
    if (la.IsEmpty() || lb.IsEmpty()) return 0;
    return la->StrictEquals(lb);
}

// ---------------------------------------------------------------------------
// Primitive constructors
// ---------------------------------------------------------------------------

extern "C" v8c_value v8c_undefined(v8c_isolate* iso) {
    auto* i = ISO(iso);
    return wrap(i, v8::Undefined(i));
}

extern "C" v8c_value v8c_null(v8c_isolate* iso) {
    auto* i = ISO(iso);
    return wrap(i, v8::Null(i));
}

extern "C" v8c_value v8c_true(v8c_isolate* iso) {
    auto* i = ISO(iso);
    return wrap(i, v8::True(i));
}

extern "C" v8c_value v8c_false(v8c_isolate* iso) {
    auto* i = ISO(iso);
    return wrap(i, v8::False(i));
}

extern "C" v8c_value v8c_boolean(v8c_isolate* iso, int val) {
    auto* i = ISO(iso);
    return wrap(i, v8::Boolean::New(i, val != 0));
}

extern "C" v8c_value v8c_int32(v8c_isolate* iso, int32_t val) {
    auto* i = ISO(iso);
    return wrap(i, v8::Integer::New(i, val));
}

extern "C" v8c_value v8c_uint32(v8c_isolate* iso, uint32_t val) {
    auto* i = ISO(iso);
    return wrap(i, v8::Integer::NewFromUnsigned(i, val));
}

extern "C" v8c_value v8c_number(v8c_isolate* iso, double val) {
    auto* i = ISO(iso);
    return wrap(i, v8::Number::New(i, val));
}

extern "C" v8c_value v8c_bigint_i64(v8c_isolate* iso, int64_t val) {
    auto* i = ISO(iso);
    return wrap(i, v8::BigInt::New(i, val));
}

extern "C" v8c_value v8c_bigint_u64(v8c_isolate* iso, uint64_t val) {
    auto* i = ISO(iso);
    return wrap(i, v8::BigInt::NewFromUnsigned(i, val));
}

extern "C" v8c_value v8c_external(v8c_isolate* iso, void* data) {
    auto* i = ISO(iso);
    return wrap(i, v8::External::New(i, data));
}

// ---------------------------------------------------------------------------
// Primitive extractors
// ---------------------------------------------------------------------------

extern "C" int v8c_to_int32(v8c_isolate* iso, v8c_value val, int32_t* out) {
    auto local = unwrap(ISO(iso), val);
    if (local.IsEmpty() || !local->IsNumber()) return -1;
    auto ctx = ISO(iso)->GetCurrentContext();
    v8::Maybe<int32_t> maybe = local->Int32Value(ctx);
    if (maybe.IsNothing()) return -1;
    *out = maybe.FromJust();
    return 0;
}

extern "C" int v8c_to_uint32(v8c_isolate* iso, v8c_value val, uint32_t* out) {
    auto local = unwrap(ISO(iso), val);
    if (local.IsEmpty() || !local->IsNumber()) return -1;
    auto ctx = ISO(iso)->GetCurrentContext();
    v8::Maybe<uint32_t> maybe = local->Uint32Value(ctx);
    if (maybe.IsNothing()) return -1;
    *out = maybe.FromJust();
    return 0;
}

extern "C" int v8c_to_double(v8c_isolate* iso, v8c_value val, double* out) {
    auto* i = ISO(iso);
    auto local = unwrap(i, val);
    if (local.IsEmpty() || !local->IsNumber()) return -1;
    *out = local.As<v8::Number>()->Value();
    return 0;
}

extern "C" int v8c_to_i64(v8c_isolate* iso, v8c_value val, int64_t* out) {
    auto local = unwrap(ISO(iso), val);
    if (local.IsEmpty()) return -1;
    if (local->IsBigInt()) {
        *out = local.As<v8::BigInt>()->Int64Value();
        return 0;
    }
    if (local->IsNumber()) {
        *out = static_cast<int64_t>(local.As<v8::Number>()->Value());
        return 0;
    }
    return -1;
}

extern "C" int v8c_to_bool(v8c_isolate* iso, v8c_value val, int* out) {
    auto* i = ISO(iso);
    auto local = unwrap(i, val);
    if (local.IsEmpty()) return -1;
    *out = local->BooleanValue(i) ? 1 : 0;
    return 0;
}

extern "C" void* v8c_to_external(v8c_isolate* iso, v8c_value val) {
    auto local = unwrap(ISO(iso), val);
    if (local.IsEmpty() || !local->IsExternal()) return nullptr;
    return local.As<v8::External>()->Value();
}

// ---------------------------------------------------------------------------
// Strings
// ---------------------------------------------------------------------------

extern "C" v8c_value v8c_string_utf8(v8c_isolate* iso, const char* data) {
    auto* i = ISO(iso);
    auto maybe = v8::String::NewFromUtf8(i, data);
    v8::Local<v8::String> str;
    if (!maybe.ToLocal(&str)) return V8C_VALUE_INVALID;
    return wrap(i, str);
}

extern "C" v8c_value v8c_string_utf8_len(v8c_isolate* iso, const char* data,
                                          int32_t len) {
    auto* i = ISO(iso);
    auto maybe = v8::String::NewFromUtf8(i, data, v8::NewStringType::kNormal,
                                          len);
    v8::Local<v8::String> str;
    if (!maybe.ToLocal(&str)) return V8C_VALUE_INVALID;
    return wrap(i, str);
}

extern "C" int32_t v8c_string_write_utf8(v8c_isolate* iso, v8c_value str,
                                          char* buf, int32_t bufsize) {
    auto* i = ISO(iso);
    auto local = unwrap(i, str);
    if (local.IsEmpty() || !local->IsString()) return -1;
    auto s = local.As<v8::String>();
    if (!buf) {
        return s->Utf8LengthV2(i);
    }
    return s->WriteUtf8V2(i, buf, bufsize,
                          v8::String::WriteFlags::kNullTerminate);
}

extern "C" int32_t v8c_string_length(v8c_isolate* iso, v8c_value str) {
    auto local = unwrap(ISO(iso), str);
    if (local.IsEmpty() || !local->IsString()) return -1;
    return local.As<v8::String>()->Length();
}

// ---------------------------------------------------------------------------
// Object
// ---------------------------------------------------------------------------

extern "C" v8c_value v8c_object_new(v8c_isolate* iso) {
    auto* i = ISO(iso);
    return wrap(i, v8::Object::New(i));
}

extern "C" v8c_value v8c_object_get(v8c_context* ctx, v8c_value obj,
                                     const char* key) {
    auto* i = ctx_isolate(ctx);
    auto local = unwrap(i, obj);
    if (local.IsEmpty() || !local->IsObject()) return V8C_VALUE_INVALID;
    auto context = ctx_local(ctx);
    auto k = v8::String::NewFromUtf8(i, key).ToLocalChecked();
    auto maybe = local.As<v8::Object>()->Get(context, k);
    v8::Local<v8::Value> result;
    if (!maybe.ToLocal(&result)) return V8C_VALUE_INVALID;
    return wrap(i, result);
}

extern "C" int v8c_object_set(v8c_context* ctx, v8c_value obj,
                               const char* key, v8c_value val) {
    auto* i = ctx_isolate(ctx);
    auto lo = unwrap(i, obj);
    auto lv = unwrap(i, val);
    if (lo.IsEmpty() || !lo->IsObject()) return -1;
    auto context = ctx_local(ctx);
    auto k = v8::String::NewFromUtf8(i, key).ToLocalChecked();
    auto result = lo.As<v8::Object>()->Set(context, k, lv);
    return result.IsJust() ? 0 : -1;
}

extern "C" v8c_value v8c_object_get_index(v8c_context* ctx, v8c_value obj,
                                           uint32_t idx) {
    auto* i = ctx_isolate(ctx);
    auto local = unwrap(i, obj);
    if (local.IsEmpty() || !local->IsObject()) return V8C_VALUE_INVALID;
    auto context = ctx_local(ctx);
    auto maybe = local.As<v8::Object>()->Get(context, idx);
    v8::Local<v8::Value> result;
    if (!maybe.ToLocal(&result)) return V8C_VALUE_INVALID;
    return wrap(i, result);
}

extern "C" int v8c_object_set_index(v8c_context* ctx, v8c_value obj,
                                     uint32_t idx, v8c_value val) {
    auto* i = ctx_isolate(ctx);
    auto lo = unwrap(i, obj);
    auto lv = unwrap(i, val);
    if (lo.IsEmpty() || !lo->IsObject()) return -1;
    auto context = ctx_local(ctx);
    auto result = lo.As<v8::Object>()->Set(context, idx, lv);
    return result.IsJust() ? 0 : -1;
}

extern "C" v8c_value v8c_object_get_v(v8c_context* ctx, v8c_value obj,
                                       v8c_value key) {
    auto* i = ctx_isolate(ctx);
    auto lo = unwrap(i, obj);
    auto lk = unwrap(i, key);
    if (lo.IsEmpty() || !lo->IsObject()) return V8C_VALUE_INVALID;
    auto context = ctx_local(ctx);
    auto maybe = lo.As<v8::Object>()->Get(context, lk);
    v8::Local<v8::Value> result;
    if (!maybe.ToLocal(&result)) return V8C_VALUE_INVALID;
    return wrap(i, result);
}

extern "C" int v8c_object_set_v(v8c_context* ctx, v8c_value obj,
                                 v8c_value key, v8c_value val) {
    auto* i = ctx_isolate(ctx);
    auto lo = unwrap(i, obj);
    auto lk = unwrap(i, key);
    auto lv = unwrap(i, val);
    if (lo.IsEmpty() || !lo->IsObject()) return -1;
    auto context = ctx_local(ctx);
    auto result = lo.As<v8::Object>()->Set(context, lk, lv);
    return result.IsJust() ? 0 : -1;
}

extern "C" int v8c_object_has(v8c_context* ctx, v8c_value obj,
                               const char* key) {
    auto* i = ctx_isolate(ctx);
    auto local = unwrap(i, obj);
    if (local.IsEmpty() || !local->IsObject()) return 0;
    auto context = ctx_local(ctx);
    auto k = v8::String::NewFromUtf8(i, key).ToLocalChecked();
    auto result = local.As<v8::Object>()->Has(context, k);
    return result.IsJust() ? (result.FromJust() ? 1 : 0) : 0;
}

extern "C" int v8c_object_delete(v8c_context* ctx, v8c_value obj,
                                  const char* key) {
    auto* i = ctx_isolate(ctx);
    auto local = unwrap(i, obj);
    if (local.IsEmpty() || !local->IsObject()) return -1;
    auto context = ctx_local(ctx);
    auto k = v8::String::NewFromUtf8(i, key).ToLocalChecked();
    auto result = local.As<v8::Object>()->Delete(context, k);
    return result.IsJust() ? 0 : -1;
}

extern "C" v8c_value v8c_object_get_own_property_names(v8c_context* ctx,
                                                        v8c_value obj) {
    auto* i = ctx_isolate(ctx);
    auto local = unwrap(i, obj);
    if (local.IsEmpty() || !local->IsObject()) return V8C_VALUE_INVALID;
    auto context = ctx_local(ctx);
    auto maybe = local.As<v8::Object>()->GetOwnPropertyNames(context);
    v8::Local<v8::Array> result;
    if (!maybe.ToLocal(&result)) return V8C_VALUE_INVALID;
    return wrap(i, result);
}

extern "C" void v8c_object_set_internal_field(v8c_isolate* iso, v8c_value obj,
                                               int index, v8c_value val) {
    auto* i = ISO(iso);
    auto lo = unwrap(i, obj);
    auto lv = unwrap(i, val);
    if (lo.IsEmpty() || !lo->IsObject()) return;
    lo.As<v8::Object>()->SetInternalField(index, lv);
}

extern "C" v8c_value v8c_object_get_internal_field(v8c_isolate* iso,
                                                    v8c_value obj, int index) {
    auto* i = ISO(iso);
    auto lo = unwrap(i, obj);
    if (lo.IsEmpty() || !lo->IsObject()) return V8C_VALUE_INVALID;
    auto o = lo.As<v8::Object>();
    if (index >= o->InternalFieldCount()) return V8C_VALUE_INVALID;
    auto field = o->GetInternalField(index);
    if (field.IsEmpty()) return V8C_VALUE_INVALID;
    return wrap(i, field.As<v8::Value>());
}

extern "C" void v8c_object_set_aligned_pointer(v8c_isolate* iso, v8c_value obj,
                                                int index, void* ptr) {
    auto* i = ISO(iso);
    auto lo = unwrap(i, obj);
    if (lo.IsEmpty() || !lo->IsObject()) return;
    lo.As<v8::Object>()->SetAlignedPointerInInternalField(index, ptr, {});
}

extern "C" void* v8c_object_get_aligned_pointer(v8c_isolate* iso,
                                                 v8c_value obj, int index) {
    auto* i = ISO(iso);
    auto lo = unwrap(i, obj);
    if (lo.IsEmpty() || !lo->IsObject()) return nullptr;
    auto o = lo.As<v8::Object>();
    if (index >= o->InternalFieldCount()) return nullptr;
    return o->GetAlignedPointerFromInternalField(index, {});
}

extern "C" int v8c_object_internal_field_count(v8c_isolate* iso,
                                                v8c_value obj) {
    auto* i = ISO(iso);
    auto lo = unwrap(i, obj);
    if (lo.IsEmpty() || !lo->IsObject()) return 0;
    return lo.As<v8::Object>()->InternalFieldCount();
}

extern "C" v8c_value v8c_object_get_prototype(v8c_isolate* iso, v8c_value obj) {
    auto* i = ISO(iso);
    auto lo = unwrap(i, obj);
    if (lo.IsEmpty() || !lo->IsObject()) return V8C_VALUE_INVALID;
    return wrap(i, lo.As<v8::Object>()->GetPrototypeV2());
}

extern "C" int v8c_object_set_prototype(v8c_context* ctx, v8c_value obj,
                                         v8c_value proto) {
    auto* i = ctx_isolate(ctx);
    auto lo = unwrap(i, obj);
    auto lp = unwrap(i, proto);
    if (lo.IsEmpty() || !lo->IsObject()) return -1;
    auto context = ctx_local(ctx);
    auto result = lo.As<v8::Object>()->SetPrototypeV2(context, lp);
    return result.IsJust() ? 0 : -1;
}

// ---------------------------------------------------------------------------
// Array
// ---------------------------------------------------------------------------

extern "C" v8c_value v8c_array_new(v8c_isolate* iso, int32_t length) {
    auto* i = ISO(iso);
    return wrap(i, v8::Array::New(i, length));
}

extern "C" int32_t v8c_array_length(v8c_isolate* iso, v8c_value arr) {
    auto local = unwrap(ISO(iso), arr);
    if (local.IsEmpty() || !local->IsArray()) return -1;
    return static_cast<int32_t>(local.As<v8::Array>()->Length());
}

// ---------------------------------------------------------------------------
// Function
// ---------------------------------------------------------------------------

// Trampoline data stored alongside callback
struct CallbackData {
    v8c_function_callback cb;
    void* data;
};

static void function_callback_trampoline(
    const v8::FunctionCallbackInfo<v8::Value>& info) {
    auto* cd = static_cast<CallbackData*>(
        info.Data().As<v8::External>()->Value());
    cd->cb(const_cast<v8::FunctionCallbackInfo<v8::Value>*>(&info), cd->data);
}

extern "C" v8c_value v8c_function_new(v8c_context* ctx,
                                       v8c_function_callback cb, void* data) {
    auto* i = ctx_isolate(ctx);
    auto context = ctx_local(ctx);

    // Leak-safe via weak ref later; for now these are small and long-lived
    auto* cd = new CallbackData{cb, data};
    auto ext = v8::External::New(i, cd);

    auto maybe = v8::Function::New(context, function_callback_trampoline, ext);
    v8::Local<v8::Function> func;
    if (!maybe.ToLocal(&func)) return V8C_VALUE_INVALID;
    return wrap(i, func);
}

extern "C" v8c_value v8c_function_call(v8c_context* ctx, v8c_value func,
                                        v8c_value recv, int argc,
                                        const v8c_value* argv) {
    auto* i = ctx_isolate(ctx);
    auto context = ctx_local(ctx);
    auto lf = unwrap(i, func);
    if (lf.IsEmpty() || !lf->IsFunction()) return V8C_VALUE_INVALID;

    auto lr = unwrap(i, recv);
    if (lr.IsEmpty()) lr = context->Global();

    // Convert argv
    std::vector<v8::Local<v8::Value>> args(argc);
    for (int j = 0; j < argc; j++) {
        args[j] = unwrap(i, argv[j]);
    }

    auto maybe = lf.As<v8::Function>()->Call(
        context, lr, argc, argc > 0 ? args.data() : nullptr);
    v8::Local<v8::Value> result;
    if (!maybe.ToLocal(&result)) return V8C_VALUE_INVALID;
    return wrap(i, result);
}

// ---------------------------------------------------------------------------
// FunctionCallbackInfo accessors
// ---------------------------------------------------------------------------

using FCI = v8::FunctionCallbackInfo<v8::Value>;

extern "C" int32_t v8c_fci_length(void* info) {
    return static_cast<FCI*>(info)->Length();
}

extern "C" v8c_value v8c_fci_arg(void* info, int32_t idx) {
    auto* fci = static_cast<FCI*>(info);
    auto* i = fci->GetIsolate();
    if (idx >= fci->Length()) return wrap(i, v8::Undefined(i));
    return wrap(i, (*fci)[idx]);
}

extern "C" v8c_value v8c_fci_this(void* info) {
    auto* fci = static_cast<FCI*>(info);
    return wrap(fci->GetIsolate(), fci->This());
}

extern "C" v8c_value v8c_fci_data(void* info) {
    auto* fci = static_cast<FCI*>(info);
    return wrap(fci->GetIsolate(), fci->Data());
}

extern "C" v8c_value v8c_fci_new_target(void* info) {
    auto* fci = static_cast<FCI*>(info);
    return wrap(fci->GetIsolate(), fci->NewTarget());
}

extern "C" int v8c_fci_is_construct_call(void* info) {
    return static_cast<FCI*>(info)->IsConstructCall() ? 1 : 0;
}

extern "C" v8c_isolate* v8c_fci_isolate(void* info) {
    return reinterpret_cast<v8c_isolate*>(
        static_cast<FCI*>(info)->GetIsolate());
}

extern "C" v8c_context* v8c_fci_context(void* info) {
    auto* iso = static_cast<FCI*>(info)->GetIsolate();
    return reinterpret_cast<v8c_context*>(iso->GetData(kActiveContextSlot));
}

extern "C" void v8c_fci_return(void* info, v8c_value val) {
    auto* fci = static_cast<FCI*>(info);
    auto local = unwrap(fci->GetIsolate(), val);
    if (!local.IsEmpty()) fci->GetReturnValue().Set(local);
}

extern "C" void v8c_fci_return_int32(void* info, int32_t val) {
    static_cast<FCI*>(info)->GetReturnValue().Set(val);
}

extern "C" void v8c_fci_return_uint32(void* info, uint32_t val) {
    static_cast<FCI*>(info)->GetReturnValue().Set(val);
}

extern "C" void v8c_fci_return_double(void* info, double val) {
    static_cast<FCI*>(info)->GetReturnValue().Set(val);
}

extern "C" void v8c_fci_return_bool(void* info, int val) {
    static_cast<FCI*>(info)->GetReturnValue().Set(val != 0);
}

extern "C" void v8c_fci_return_string(void* info, const char* str) {
    auto* fci = static_cast<FCI*>(info);
    auto* i = fci->GetIsolate();
    auto s = v8::String::NewFromUtf8(i, str).ToLocalChecked();
    fci->GetReturnValue().Set(s);
}

extern "C" void v8c_fci_return_string_len(void* info, const char* str,
                                           int32_t len) {
    auto* fci = static_cast<FCI*>(info);
    auto* i = fci->GetIsolate();
    auto s = v8::String::NewFromUtf8(i, str, v8::NewStringType::kNormal, len)
                 .ToLocalChecked();
    fci->GetReturnValue().Set(s);
}

extern "C" void v8c_fci_return_null(void* info) {
    auto* fci = static_cast<FCI*>(info);
    fci->GetReturnValue().SetNull();
}

extern "C" void v8c_fci_return_undefined(void* info) {
    auto* fci = static_cast<FCI*>(info);
    fci->GetReturnValue().SetUndefined();
}

// ---------------------------------------------------------------------------
// FunctionTemplate / ObjectTemplate
// ---------------------------------------------------------------------------

extern "C" v8c_function_template v8c_function_template_new(
    v8c_isolate* iso, v8c_function_callback cb, void* data) {
    auto* i = ISO(iso);
    auto* tt = get_tt(iso);

    v8::Local<v8::FunctionTemplate> ft;
    if (cb) {
        auto* cd = new CallbackData{cb, data};
        auto ext = v8::External::New(i, cd);
        ft = v8::FunctionTemplate::New(i, function_callback_trampoline, ext);
    } else {
        ft = v8::FunctionTemplate::New(i);
    }
    return {tt->store_ft(ft)};
}

extern "C" v8c_value v8c_function_template_get_function(
    v8c_context* ctx, v8c_function_template ft) {
    auto* i = ctx_isolate(ctx);
    auto* tt = get_ht_from_v8(i) ? static_cast<TemplateTable*>(i->GetData(kHandleTableSlot + 1)) : nullptr;
    if (!tt) return V8C_VALUE_INVALID;
    auto context = ctx_local(ctx);
    auto local_ft = tt->get_ft(ft.slot);
    auto maybe = local_ft->GetFunction(context);
    v8::Local<v8::Function> func;
    if (!maybe.ToLocal(&func)) return V8C_VALUE_INVALID;
    return wrap(i, func);
}

extern "C" v8c_object_template v8c_function_template_instance_template(
    v8c_isolate* iso, v8c_function_template ft) {
    auto* i = ISO(iso);
    auto* tt = static_cast<TemplateTable*>(i->GetData(kHandleTableSlot + 1));
    auto local_ft = tt->get_ft(ft.slot);
    auto it = local_ft->InstanceTemplate();
    return {tt->store_ot(it)};
}

extern "C" v8c_object_template v8c_function_template_prototype_template(
    v8c_isolate* iso, v8c_function_template ft) {
    auto* i = ISO(iso);
    auto* tt = static_cast<TemplateTable*>(i->GetData(kHandleTableSlot + 1));
    auto local_ft = tt->get_ft(ft.slot);
    auto pt = local_ft->PrototypeTemplate();
    return {tt->store_ot(pt)};
}

extern "C" void v8c_function_template_set_class_name(
    v8c_function_template ft, v8c_isolate* iso, const char* name) {
    auto* i = ISO(iso);
    auto* tt = static_cast<TemplateTable*>(i->GetData(kHandleTableSlot + 1));
    auto local_ft = tt->get_ft(ft.slot);
    local_ft->SetClassName(v8::String::NewFromUtf8(i, name).ToLocalChecked());
}

extern "C" void v8c_function_template_inherit(v8c_isolate* iso,
                                               v8c_function_template child,
                                               v8c_function_template parent) {
    auto* i = ISO(iso);
    auto* tt = static_cast<TemplateTable*>(i->GetData(kHandleTableSlot + 1));
    tt->get_ft(child.slot)->Inherit(tt->get_ft(parent.slot));
}

extern "C" v8c_object_template v8c_object_template_new(v8c_isolate* iso) {
    auto* i = ISO(iso);
    auto* tt = static_cast<TemplateTable*>(i->GetData(kHandleTableSlot + 1));
    auto ot = v8::ObjectTemplate::New(i);
    return {tt->store_ot(ot)};
}

extern "C" void v8c_object_template_set_internal_field_count(
    v8c_isolate* iso, v8c_object_template ot, int count) {
    auto* i = ISO(iso);
    auto* tt = static_cast<TemplateTable*>(i->GetData(kHandleTableSlot + 1));
    tt->get_ot(ot.slot)->SetInternalFieldCount(count);
}

extern "C" v8c_value v8c_object_template_new_instance(v8c_context* ctx,
                                                       v8c_object_template ot) {
    auto* i = ctx_isolate(ctx);
    auto* tt = static_cast<TemplateTable*>(i->GetData(kHandleTableSlot + 1));
    auto context = ctx_local(ctx);
    auto local_ot = tt->get_ot(ot.slot);
    auto maybe = local_ot->NewInstance(context);
    v8::Local<v8::Object> obj;
    if (!maybe.ToLocal(&obj)) return V8C_VALUE_INVALID;
    return wrap(i, obj);
}

extern "C" void v8c_template_set(v8c_isolate* iso, v8c_function_template ft,
                                  const char* name, v8c_function_callback cb,
                                  void* data) {
    auto* i = ISO(iso);
    auto* tt = static_cast<TemplateTable*>(i->GetData(kHandleTableSlot + 1));
    auto local_ft = tt->get_ft(ft.slot);

    auto* cd = new CallbackData{cb, data};
    auto ext = v8::External::New(i, cd);
    auto method_ft = v8::FunctionTemplate::New(
        i, function_callback_trampoline, ext);

    local_ft->PrototypeTemplate()->Set(
        v8::String::NewFromUtf8(i, name).ToLocalChecked(), method_ft);
}

extern "C" void v8c_template_set_ot(v8c_isolate* iso, v8c_object_template ot,
                                     const char* name,
                                     v8c_function_callback cb, void* data) {
    auto* i = ISO(iso);
    auto* tt = static_cast<TemplateTable*>(i->GetData(kHandleTableSlot + 1));
    auto local_ot = tt->get_ot(ot.slot);

    auto* cd = new CallbackData{cb, data};
    auto ext = v8::External::New(i, cd);
    auto method_ft = v8::FunctionTemplate::New(
        i, function_callback_trampoline, ext);

    local_ot->Set(v8::String::NewFromUtf8(i, name).ToLocalChecked(),
                  method_ft);
}

// ---------------------------------------------------------------------------
// Exceptions
// ---------------------------------------------------------------------------

extern "C" v8c_value v8c_exception_error(v8c_isolate* iso, const char* msg) {
    auto* i = ISO(iso);
    auto s = v8::String::NewFromUtf8(i, msg).ToLocalChecked();
    return wrap(i, v8::Exception::Error(s));
}

extern "C" v8c_value v8c_exception_type_error(v8c_isolate* iso,
                                               const char* msg) {
    auto* i = ISO(iso);
    auto s = v8::String::NewFromUtf8(i, msg).ToLocalChecked();
    return wrap(i, v8::Exception::TypeError(s));
}

extern "C" v8c_value v8c_exception_range_error(v8c_isolate* iso,
                                                const char* msg) {
    auto* i = ISO(iso);
    auto s = v8::String::NewFromUtf8(i, msg).ToLocalChecked();
    return wrap(i, v8::Exception::RangeError(s));
}

extern "C" v8c_value v8c_exception_syntax_error(v8c_isolate* iso,
                                                 const char* msg) {
    auto* i = ISO(iso);
    auto s = v8::String::NewFromUtf8(i, msg).ToLocalChecked();
    return wrap(i, v8::Exception::SyntaxError(s));
}

extern "C" v8c_value v8c_exception_reference_error(v8c_isolate* iso,
                                                    const char* msg) {
    auto* i = ISO(iso);
    auto s = v8::String::NewFromUtf8(i, msg).ToLocalChecked();
    return wrap(i, v8::Exception::ReferenceError(s));
}

extern "C" void v8c_isolate_throw(v8c_isolate* iso, v8c_value exception) {
    auto* i = ISO(iso);
    auto local = unwrap(i, exception);
    if (!local.IsEmpty()) i->ThrowException(local);
}

// ---------------------------------------------------------------------------
// TryCatch
// ---------------------------------------------------------------------------

struct TryCatchWrapper {
    v8::Isolate* isolate;
    v8::TryCatch try_catch;
    explicit TryCatchWrapper(v8::Isolate* iso) : isolate(iso), try_catch(iso) {}
};

extern "C" v8c_try_catch* v8c_try_catch_new(v8c_isolate* iso) {
    return reinterpret_cast<v8c_try_catch*>(
        new TryCatchWrapper(ISO(iso)));
}

extern "C" void v8c_try_catch_delete(v8c_try_catch* tc) {
    delete reinterpret_cast<TryCatchWrapper*>(tc);
}

extern "C" int v8c_try_catch_has_caught(v8c_try_catch* tc) {
    return reinterpret_cast<TryCatchWrapper*>(tc)->try_catch.HasCaught() ? 1 : 0;
}

extern "C" v8c_value v8c_try_catch_exception(v8c_try_catch* tc) {
    auto* w = reinterpret_cast<TryCatchWrapper*>(tc);
    return wrap(w->isolate, w->try_catch.Exception());
}

extern "C" v8c_value v8c_try_catch_message(v8c_try_catch* tc) {
    auto* w = reinterpret_cast<TryCatchWrapper*>(tc);
    auto msg = w->try_catch.Message();
    if (msg.IsEmpty()) return V8C_VALUE_INVALID;
    return wrap(w->isolate, msg->Get());
}

extern "C" void v8c_try_catch_reset(v8c_try_catch* tc) {
    reinterpret_cast<TryCatchWrapper*>(tc)->try_catch.Reset();
}

extern "C" void v8c_try_catch_rethrow(v8c_try_catch* tc) {
    reinterpret_cast<TryCatchWrapper*>(tc)->try_catch.ReThrow();
}

// ---------------------------------------------------------------------------
// Script compile + run
// ---------------------------------------------------------------------------

extern "C" v8c_value v8c_script_compile_run(v8c_context* ctx,
                                             const char* source,
                                             int32_t source_len,
                                             const char* filename) {
    auto* i = ctx_isolate(ctx);
    auto context = ctx_local(ctx);

    auto src_str = v8::String::NewFromUtf8(i, source,
                                            v8::NewStringType::kNormal,
                                            source_len)
                       .ToLocalChecked();

    v8::ScriptOrigin origin(
        v8::String::NewFromUtf8(i, filename ? filename : "<anonymous>")
            .ToLocalChecked());

    auto maybe_script = v8::Script::Compile(context, src_str, &origin);
    v8::Local<v8::Script> script;
    if (!maybe_script.ToLocal(&script)) return V8C_VALUE_INVALID;

    auto maybe_result = script->Run(context);
    v8::Local<v8::Value> result;
    if (!maybe_result.ToLocal(&result)) return V8C_VALUE_INVALID;
    return wrap(i, result);
}

// ---------------------------------------------------------------------------
// ArrayBuffer
// ---------------------------------------------------------------------------

extern "C" v8c_value v8c_arraybuffer_new(v8c_isolate* iso,
                                          size_t byte_length) {
    auto* i = ISO(iso);
    return wrap(i, v8::ArrayBuffer::New(i, byte_length));
}

extern "C" v8c_value v8c_arraybuffer_new_backing(v8c_isolate* iso, void* data,
                                                  size_t byte_length) {
    auto* i = ISO(iso);
    auto store = v8::ArrayBuffer::NewBackingStore(
        data, byte_length,
        [](void*, size_t, void*) {},  // no-op deleter — caller owns memory
        nullptr);
    return wrap(i, v8::ArrayBuffer::New(i, std::move(store)));
}

extern "C" void* v8c_arraybuffer_data(v8c_isolate* iso, v8c_value ab) {
    auto* i = ISO(iso);
    auto local = unwrap(i, ab);
    if (local.IsEmpty() || !local->IsArrayBuffer()) return nullptr;
    return local.As<v8::ArrayBuffer>()->Data();
}

extern "C" size_t v8c_arraybuffer_byte_length(v8c_isolate* iso, v8c_value ab) {
    auto* i = ISO(iso);
    auto local = unwrap(i, ab);
    if (local.IsEmpty() || !local->IsArrayBuffer()) return 0;
    return local.As<v8::ArrayBuffer>()->ByteLength();
}

extern "C" v8c_value v8c_uint8array_new(v8c_isolate* iso, v8c_value ab,
                                         size_t offset, size_t length) {
    auto* i = ISO(iso);
    auto local = unwrap(i, ab);
    if (local.IsEmpty() || !local->IsArrayBuffer()) return V8C_VALUE_INVALID;
    return wrap(i, v8::Uint8Array::New(local.As<v8::ArrayBuffer>(),
                                       offset, length));
}

extern "C" v8c_value v8c_uint32array_new(v8c_isolate* iso, v8c_value ab,
                                          size_t offset, size_t length) {
    auto* i = ISO(iso);
    auto local = unwrap(i, ab);
    if (local.IsEmpty() || !local->IsArrayBuffer()) return V8C_VALUE_INVALID;
    return wrap(i, v8::Uint32Array::New(local.As<v8::ArrayBuffer>(),
                                        offset, length));
}

extern "C" v8c_value v8c_biguint64array_new(v8c_isolate* iso, v8c_value ab,
                                              size_t offset, size_t length) {
    auto* i = ISO(iso);
    auto local = unwrap(i, ab);
    if (local.IsEmpty() || !local->IsArrayBuffer()) return V8C_VALUE_INVALID;
    return wrap(i, v8::BigUint64Array::New(local.As<v8::ArrayBuffer>(),
                                           offset, length));
}

extern "C" void* v8c_typedarray_data(v8c_isolate* iso, v8c_value ta) {
    auto* i = ISO(iso);
    auto local = unwrap(i, ta);
    if (local.IsEmpty() || !local->IsArrayBufferView()) return nullptr;
    auto view = local.As<v8::ArrayBufferView>();
    return static_cast<uint8_t*>(view->Buffer()->Data()) + view->ByteOffset();
}

extern "C" size_t v8c_typedarray_byte_length(v8c_isolate* iso, v8c_value ta) {
    auto* i = ISO(iso);
    auto local = unwrap(i, ta);
    if (local.IsEmpty() || !local->IsArrayBufferView()) return 0;
    return local.As<v8::ArrayBufferView>()->ByteLength();
}

extern "C" size_t v8c_typedarray_byte_offset(v8c_isolate* iso, v8c_value ta) {
    auto* i = ISO(iso);
    auto local = unwrap(i, ta);
    if (local.IsEmpty() || !local->IsArrayBufferView()) return 0;
    return local.As<v8::ArrayBufferView>()->ByteOffset();
}

extern "C" size_t v8c_typedarray_length(v8c_isolate* iso, v8c_value ta) {
    auto* i = ISO(iso);
    auto local = unwrap(i, ta);
    if (local.IsEmpty() || !local->IsTypedArray()) return 0;
    return local.As<v8::TypedArray>()->Length();
}

// ---------------------------------------------------------------------------
// Dynamic import() — V8 callback that looks up globalThis.__dynamicImportHandler
// ---------------------------------------------------------------------------

static v8::MaybeLocal<v8::Promise> DynamicImportCallback(
    v8::Local<v8::Context> context,
    v8::Local<v8::Data> /* host_defined_options */,
    v8::Local<v8::Value> /* resource_name */,
    v8::Local<v8::String> specifier,
    v8::Local<v8::FixedArray> /* import_attributes */) {

    auto* iso = v8::Isolate::GetCurrent();
    auto global = context->Global();

    auto key = v8::String::NewFromUtf8Literal(iso, "__dynamicImportHandler");
    auto maybe_handler = global->Get(context, key);
    v8::Local<v8::Value> handler_val;
    if (!maybe_handler.ToLocal(&handler_val) || !handler_val->IsFunction()) {
        iso->ThrowError("dynamic import() handler not registered");
        return v8::MaybeLocal<v8::Promise>();
    }

    auto resolver = v8::Promise::Resolver::New(context).ToLocalChecked();
    auto promise = resolver->GetPromise();

    v8::TryCatch tc(iso);
    v8::Local<v8::Value> argv[1] = { specifier };
    auto result = handler_val.As<v8::Function>()->Call(
        context, global, 1, argv);

    if (tc.HasCaught()) {
        resolver->Reject(context, tc.Exception()).FromMaybe(false);
    } else {
        v8::Local<v8::Value> val;
        if (result.ToLocal(&val)) {
            resolver->Resolve(context, val).FromMaybe(false);
        } else {
            auto err = v8::Exception::Error(
                v8::String::NewFromUtf8Literal(iso, "import() returned empty"));
            resolver->Reject(context, err).FromMaybe(false);
        }
    }

    return promise;
}

// Routes V8 promise-rejection events to JS globals so the runtime can implement
// process 'unhandledRejection' / 'rejectionHandled'.
static void PromiseRejectCallback(v8::PromiseRejectMessage message) {
    auto event = message.GetEvent();
    const char* handlerName;
    if (event == v8::kPromiseRejectWithNoHandler) handlerName = "__onPromiseReject";
    else if (event == v8::kPromiseHandlerAddedAfterReject) handlerName = "__onPromiseHandled";
    else return;  // resolve-after-resolved / reject-after-resolved: ignore

    auto promise = message.GetPromise();
    auto* iso = v8::Isolate::GetCurrent();
    v8::HandleScope scope(iso);
    auto context = iso->GetCurrentContext();
    if (context.IsEmpty()) return;
    auto global = context->Global();
    auto key = v8::String::NewFromUtf8(iso, handlerName).ToLocalChecked();
    v8::Local<v8::Value> handler_val;
    if (!global->Get(context, key).ToLocal(&handler_val) || !handler_val->IsFunction()) return;

    v8::TryCatch tc(iso);
    if (event == v8::kPromiseRejectWithNoHandler) {
        auto value = message.GetValue();
        if (value.IsEmpty()) value = v8::Undefined(iso);
        v8::Local<v8::Value> argv[2] = { promise, value };
        (void)handler_val.As<v8::Function>()->Call(context, global, 2, argv);
    } else {
        v8::Local<v8::Value> argv[1] = { promise };
        (void)handler_val.As<v8::Function>()->Call(context, global, 1, argv);
    }
}

// ---------------------------------------------------------------------------
// Promise
// ---------------------------------------------------------------------------

extern "C" v8c_resolver v8c_promise_resolver_new(v8c_context* ctx) {
    auto* i = ctx_isolate(ctx);
    auto context = ctx_local(ctx);
    auto maybe = v8::Promise::Resolver::New(context);
    v8::Local<v8::Promise::Resolver> resolver;
    if (!maybe.ToLocal(&resolver)) return {-1};
    auto* ht = get_ht_from_v8(i);
    return {ht->store(resolver)};
}

extern "C" v8c_value v8c_resolver_get_promise(v8c_context* ctx,
                                               v8c_resolver r) {
    auto* i = ctx_isolate(ctx);
    auto local = unwrap(i, {r.slot});
    if (local.IsEmpty()) return V8C_VALUE_INVALID;
    auto resolver = local.As<v8::Promise::Resolver>();
    return wrap(i, resolver->GetPromise());
}

extern "C" int v8c_resolver_resolve(v8c_context* ctx, v8c_resolver r,
                                     v8c_value val) {
    auto* i = ctx_isolate(ctx);
    auto context = ctx_local(ctx);
    auto local = unwrap(i, {r.slot});
    if (local.IsEmpty()) return -1;
    auto lv = unwrap(i, val);
    auto result = local.As<v8::Promise::Resolver>()->Resolve(context, lv);
    return result.IsJust() ? 0 : -1;
}

extern "C" int v8c_resolver_reject(v8c_context* ctx, v8c_resolver r,
                                    v8c_value val) {
    auto* i = ctx_isolate(ctx);
    auto context = ctx_local(ctx);
    auto local = unwrap(i, {r.slot});
    if (local.IsEmpty()) return -1;
    auto lv = unwrap(i, val);
    auto result = local.As<v8::Promise::Resolver>()->Reject(context, lv);
    return result.IsJust() ? 0 : -1;
}

// ---------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------

extern "C" v8c_value v8c_json_parse(v8c_context* ctx, v8c_value str) {
    auto* i = ctx_isolate(ctx);
    auto context = ctx_local(ctx);
    auto local = unwrap(i, str);
    if (local.IsEmpty() || !local->IsString()) return V8C_VALUE_INVALID;
    auto maybe = v8::JSON::Parse(context, local.As<v8::String>());
    v8::Local<v8::Value> result;
    if (!maybe.ToLocal(&result)) return V8C_VALUE_INVALID;
    return wrap(i, result);
}

extern "C" v8c_value v8c_json_stringify(v8c_context* ctx, v8c_value val) {
    auto* i = ctx_isolate(ctx);
    auto context = ctx_local(ctx);
    auto local = unwrap(i, val);
    if (local.IsEmpty()) return V8C_VALUE_INVALID;
    auto maybe = v8::JSON::Stringify(context, local);
    v8::Local<v8::String> result;
    if (!maybe.ToLocal(&result)) return V8C_VALUE_INVALID;
    return wrap(i, result);
}

// ---------------------------------------------------------------------------
// Symbol
// ---------------------------------------------------------------------------

extern "C" v8c_value v8c_symbol_new(v8c_isolate* iso, const char* description) {
    auto* i = ISO(iso);
    if (description) {
        auto desc = v8::String::NewFromUtf8(i, description).ToLocalChecked();
        return wrap(i, v8::Symbol::New(i, desc));
    }
    return wrap(i, v8::Symbol::New(i));
}

extern "C" v8c_value v8c_symbol_for(v8c_isolate* iso, const char* key) {
    auto* i = ISO(iso);
    auto k = v8::String::NewFromUtf8(i, key).ToLocalChecked();
    return wrap(i, v8::Symbol::For(i, k));
}

// ---------------------------------------------------------------------------
// Private symbols — stored in separate PrivateTable, slots offset by 0x40000000
// ---------------------------------------------------------------------------

static constexpr int32_t kPrivateSlotOffset = 0x40000000;

extern "C" v8c_value v8c_private_new(v8c_isolate* iso, const char* description) {
    auto* i = ISO(iso);
    auto* pt = get_pt(iso);
    v8::Local<v8::Private> priv;
    if (description) {
        auto desc = v8::String::NewFromUtf8(i, description).ToLocalChecked();
        priv = v8::Private::New(i, desc);
    } else {
        priv = v8::Private::New(i);
    }
    int32_t slot = pt->store(priv);
    return {slot + kPrivateSlotOffset};
}

extern "C" int v8c_private_set(v8c_context* ctx, v8c_value obj,
                                v8c_value priv, v8c_value val) {
    auto* i = ctx_isolate(ctx);
    auto context = ctx_local(ctx);
    auto lo = unwrap(i, obj);
    auto lv = unwrap(i, val);
    if (lo.IsEmpty() || !lo->IsObject()) return -1;
    auto* pt = get_pt_from_v8(i);
    auto p = pt->get(priv.slot - kPrivateSlotOffset);
    auto result = lo.As<v8::Object>()->SetPrivate(context, p, lv);
    return result.IsJust() ? 0 : -1;
}

extern "C" v8c_value v8c_private_get(v8c_context* ctx, v8c_value obj,
                                      v8c_value priv) {
    auto* i = ctx_isolate(ctx);
    auto context = ctx_local(ctx);
    auto lo = unwrap(i, obj);
    if (lo.IsEmpty() || !lo->IsObject()) return V8C_VALUE_INVALID;
    auto* pt = get_pt_from_v8(i);
    auto p = pt->get(priv.slot - kPrivateSlotOffset);
    v8::MaybeLocal<v8::Value> result = lo.As<v8::Object>()->GetPrivate(context, p);
    if (result.IsEmpty()) return V8C_VALUE_INVALID;
    return wrap(i, result.ToLocalChecked());
}

extern "C" int v8c_private_has(v8c_context* ctx, v8c_value obj, v8c_value priv) {
    auto* i = ctx_isolate(ctx);
    auto context = ctx_local(ctx);
    auto lo = unwrap(i, obj);
    if (lo.IsEmpty() || !lo->IsObject()) return 0;
    auto* pt = get_pt_from_v8(i);
    auto p = pt->get(priv.slot - kPrivateSlotOffset);
    auto result = lo.As<v8::Object>()->HasPrivate(context, p);
    return result.IsJust() && result.FromJust() ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Object property enumeration
// ---------------------------------------------------------------------------

extern "C" v8c_value v8c_object_get_property_names(v8c_context* ctx,
                                                     v8c_value obj,
                                                     int filter) {
    auto* i = ctx_isolate(ctx);
    auto context = ctx_local(ctx);
    auto lo = unwrap(i, obj);
    if (lo.IsEmpty() || !lo->IsObject()) return V8C_VALUE_INVALID;

    v8::PropertyFilter pf = static_cast<v8::PropertyFilter>(filter);
    v8::MaybeLocal<v8::Array> names = lo.As<v8::Object>()->GetPropertyNames(
        context, v8::KeyCollectionMode::kOwnOnly, pf,
        v8::IndexFilter::kSkipIndices);
    if (names.IsEmpty()) return V8C_VALUE_INVALID;
    return wrap(i, names.ToLocalChecked());
}

// ---------------------------------------------------------------------------
// Property attributes
// ---------------------------------------------------------------------------

extern "C" int v8c_object_define_property(v8c_context* ctx, v8c_value obj,
                                           const char* key, v8c_value val,
                                           int attributes) {
    auto* i = ctx_isolate(ctx);
    auto context = ctx_local(ctx);
    auto lo = unwrap(i, obj);
    auto lv = unwrap(i, val);
    if (lo.IsEmpty() || !lo->IsObject()) return -1;

    auto k = v8::String::NewFromUtf8(i, key).ToLocalChecked();

    v8::PropertyAttribute v8_attrs = v8::None;
    if (attributes & V8C_READ_ONLY) v8_attrs = static_cast<v8::PropertyAttribute>(v8_attrs | v8::ReadOnly);
    if (attributes & V8C_DONT_ENUM) v8_attrs = static_cast<v8::PropertyAttribute>(v8_attrs | v8::DontEnum);
    if (attributes & V8C_DONT_DELETE) v8_attrs = static_cast<v8::PropertyAttribute>(v8_attrs | v8::DontDelete);

    auto result = lo.As<v8::Object>()->DefineOwnProperty(
        context, k, lv, v8_attrs);
    return result.IsJust() ? 0 : -1;
}

// ---------------------------------------------------------------------------
// Fast buffer operations — V8 Fast API for hot buffer ops
// Each op has: _impl (shared logic), Slow* (FCI fallback), Fast* (JIT path)
// ---------------------------------------------------------------------------

struct BufData { uint8_t* data; size_t length; };

static BufData buf_arg(const v8::Local<v8::Value>& val) {
    if (val.IsEmpty() || !val->IsArrayBufferView()) return {nullptr, 0};
    auto view = val.As<v8::ArrayBufferView>();
    return {static_cast<uint8_t*>(view->Buffer()->Data()) + view->ByteOffset(),
            view->ByteLength()};
}

static int32_t int_arg(const FCI& info, int idx, int32_t def) {
    if (idx >= info.Length()) return def;
    auto val = info[idx];
    if (val->IsInt32()) return val.As<v8::Int32>()->Value();
    if (val->IsNumber()) return static_cast<int32_t>(val.As<v8::Number>()->Value());
    return def;
}

// Debug counters for fast path verification (temporary)
static int64_t g_slow_count = 0;
static int64_t g_fast_count = 0;

extern "C" void v8c_fast_api_stats(int64_t* slow_out, int64_t* fast_out) {
    *slow_out = g_slow_count;
    *fast_out = g_fast_count;
}

// ---- compare(a, b) → -1/0/1 ----

static int32_t compare_impl(BufData a, BufData b) {
    size_t m = a.length < b.length ? a.length : b.length;
    if (m > 0) {
        int c = memcmp(a.data, b.data, m);
        if (c < 0) return -1;
        if (c > 0) return 1;
    }
    return a.length < b.length ? -1 : a.length > b.length ? 1 : 0;
}

static void SlowCompare(const FCI& info) {
    g_slow_count++;
    info.GetReturnValue().Set(compare_impl(buf_arg(info[0]), buf_arg(info[1])));
}
static int32_t FastCompare(v8::Local<v8::Value>, v8::Local<v8::Value> a,
                            v8::Local<v8::Value> b,
                            v8::FastApiCallbackOptions&) {
    g_fast_count++;
    return compare_impl(buf_arg(a), buf_arg(b));
}
static v8::CFunction cf_compare(v8::CFunction::Make(FastCompare));

// ---- indexOfByte(buf, byte, offset) → index or -1 ----

static int32_t index_of_byte_impl(BufData buf, int32_t byte_val, int32_t offset) {
    if (offset < 0) offset = 0;
    if (static_cast<size_t>(offset) >= buf.length || !buf.data) return -1;
    auto* p = static_cast<uint8_t*>(
        memchr(buf.data + offset, byte_val & 0xff, buf.length - offset));
    return p ? static_cast<int32_t>(p - buf.data) : -1;
}

static void SlowIndexOfByte(const FCI& info) {
    info.GetReturnValue().Set(
        index_of_byte_impl(buf_arg(info[0]), int_arg(info, 1, 0), int_arg(info, 2, 0)));
}
static int32_t FastIndexOfByte(v8::Local<v8::Value>, v8::Local<v8::Value> buf,
                                int32_t byte_val, int32_t offset,
                                v8::FastApiCallbackOptions&) {
    return index_of_byte_impl(buf_arg(buf), byte_val, offset);
}
static v8::CFunction cf_index_of_byte(v8::CFunction::Make(FastIndexOfByte));

// ---- indexOf(haystack, needle, offset) → index or -1 ----

static int32_t index_of_impl(BufData h, BufData n, int32_t offset) {
    if (offset < 0) offset = 0;
    if (static_cast<size_t>(offset) >= h.length || !h.data) return -1;
    if (n.length == 0) return offset;
    if (n.length > h.length - offset) return -1;
    auto* p = memmem(h.data + offset, h.length - offset, n.data, n.length);
    return p ? static_cast<int32_t>(static_cast<uint8_t*>(p) - h.data) : -1;
}

static void SlowIndexOf(const FCI& info) {
    info.GetReturnValue().Set(
        index_of_impl(buf_arg(info[0]), buf_arg(info[1]), int_arg(info, 2, 0)));
}
static int32_t FastIndexOf(v8::Local<v8::Value>, v8::Local<v8::Value> h,
                            v8::Local<v8::Value> n, int32_t offset,
                            v8::FastApiCallbackOptions&) {
    return index_of_impl(buf_arg(h), buf_arg(n), offset);
}
static v8::CFunction cf_index_of(v8::CFunction::Make(FastIndexOf));

// ---- copy(src, dst, targetStart, sourceStart, sourceEnd) → bytes copied ----

static int32_t copy_impl(BufData src, BufData dst,
                           int32_t ts, int32_t ss, int32_t se) {
    if (ts >= static_cast<int32_t>(dst.length) || ss >= se) return 0;
    int32_t len = se - ss;
    int32_t max = static_cast<int32_t>(dst.length) - ts;
    if (len > max) len = max;
    if (len <= 0 || !src.data || !dst.data) return 0;
    memmove(dst.data + ts, src.data + ss, len);
    return len;
}

static void SlowCopy(const FCI& info) {
    auto src = buf_arg(info[0]);
    info.GetReturnValue().Set(copy_impl(
        src, buf_arg(info[1]), int_arg(info, 2, 0), int_arg(info, 3, 0),
        int_arg(info, 4, static_cast<int32_t>(src.length))));
}
static int32_t FastCopy(v8::Local<v8::Value>, v8::Local<v8::Value> s,
                         v8::Local<v8::Value> d, int32_t ts, int32_t ss,
                         int32_t se, v8::FastApiCallbackOptions&) {
    return copy_impl(buf_arg(s), buf_arg(d), ts, ss, se);
}
static v8::CFunction cf_copy(v8::CFunction::Make(FastCopy));

// ---- fill(buf, value) ----

static void SlowFill(const FCI& info) {
    auto buf = buf_arg(info[0]);
    if (buf.length > 0 && buf.data)
        memset(buf.data, int_arg(info, 1, 0) & 0xff, buf.length);
}
static void FastFill(v8::Local<v8::Value>, v8::Local<v8::Value> b,
                      int32_t val, v8::FastApiCallbackOptions&) {
    auto buf = buf_arg(b);
    if (buf.length > 0 && buf.data) memset(buf.data, val & 0xff, buf.length);
}
static v8::CFunction cf_fill(v8::CFunction::Make(FastFill));

// ---- fillRange(buf, value, offset, end) ----

static void SlowFillRange(const FCI& info) {
    auto buf = buf_arg(info[0]);
    int32_t val = int_arg(info, 1, 0);
    int32_t off = int_arg(info, 2, 0);
    int32_t end = int_arg(info, 3, static_cast<int32_t>(buf.length));
    if (off < 0) off = 0;
    if (end > static_cast<int32_t>(buf.length)) end = static_cast<int32_t>(buf.length);
    if (off < end && buf.data) memset(buf.data + off, val & 0xff, end - off);
}
static void FastFillRange(v8::Local<v8::Value>, v8::Local<v8::Value> b,
                           int32_t val, int32_t off, int32_t end,
                           v8::FastApiCallbackOptions&) {
    auto buf = buf_arg(b);
    if (off < 0) off = 0;
    if (end > static_cast<int32_t>(buf.length)) end = static_cast<int32_t>(buf.length);
    if (off < end && buf.data) memset(buf.data + off, val & 0xff, end - off);
}
static v8::CFunction cf_fill_range(v8::CFunction::Make(FastFillRange));

// ---- Registration: sets fast methods on exports object ----

static void set_fast_method(v8::Isolate* iso, v8::Local<v8::Context> context,
                             v8::Local<v8::Object> obj, const char* name,
                             v8::FunctionCallback slow, const v8::CFunction* fast) {
    auto ft = v8::FunctionTemplate::New(
        iso, slow, v8::Local<v8::Value>(), v8::Local<v8::Signature>(), 0,
        v8::ConstructorBehavior::kThrow, v8::SideEffectType::kHasSideEffect, fast);
    auto key = v8::String::NewFromUtf8(iso, name).ToLocalChecked();
    obj->Set(context, key, ft->GetFunction(context).ToLocalChecked()).Check();
}

// ---- _fastApiStats() → {slow, fast} for perf verification ----

static void SlowFastApiStats(const FCI& info) {
    auto* iso = info.GetIsolate();
    auto ctx = iso->GetCurrentContext();
    auto obj = v8::Object::New(iso);
    obj->Set(ctx, v8::String::NewFromUtf8(iso, "slow").ToLocalChecked(),
             v8::Number::New(iso, static_cast<double>(g_slow_count))).Check();
    obj->Set(ctx, v8::String::NewFromUtf8(iso, "fast").ToLocalChecked(),
             v8::Number::New(iso, static_cast<double>(g_fast_count))).Check();
    info.GetReturnValue().Set(obj);
}

extern "C" void v8c_register_buffer_fast_ops(v8c_context* ctx, v8c_value exports) {
    auto* i = ctx_isolate(ctx);
    auto context = ctx_local(ctx);
    auto obj = unwrap(i, exports).As<v8::Object>();

    set_fast_method(i, context, obj, "compare",     SlowCompare,     &cf_compare);
    set_fast_method(i, context, obj, "indexOfByte",  SlowIndexOfByte, &cf_index_of_byte);
    set_fast_method(i, context, obj, "indexOf",      SlowIndexOf,     &cf_index_of);
    set_fast_method(i, context, obj, "copy",         SlowCopy,        &cf_copy);
    set_fast_method(i, context, obj, "fill",         SlowFill,        &cf_fill);
    set_fast_method(i, context, obj, "fillRange",    SlowFillRange,   &cf_fill_range);

    // stats for verifying fast path activation
    auto ft = v8::FunctionTemplate::New(i, SlowFastApiStats);
    auto key = v8::String::NewFromUtf8(i, "_fastApiStats").ToLocalChecked();
    obj->Set(context, key, ft->GetFunction(context).ToLocalChecked()).Check();
}


// ===========================================================================
// Structured-clone bridge for worker_threads.
// v8::ValueSerializer is a V8 C++ class with no C API, so this thin wrapper is
// unavoidable (same role as the rest of v8capi). Everything else — threads,
// mutexes, the message queue, the worker lifecycle — lives in Milo.
// SharedArrayBuffer backing stores travel by reference (shared memory) via an
// opaque "sab list" handle that Milo carries alongside the serialized bytes.
// ===========================================================================

struct SabList { std::vector<std::shared_ptr<v8::BackingStore>> v; };

class MnSerDelegate : public v8::ValueSerializer::Delegate {
public:
    v8::Isolate* iso;
    SabList* sabs;
    void ThrowDataCloneError(v8::Local<v8::String> msg) override {
        iso->ThrowException(v8::Exception::Error(msg));
    }
    v8::Maybe<uint32_t> GetSharedArrayBufferId(
            v8::Isolate* isolate, v8::Local<v8::SharedArrayBuffer> sab) override {
        sabs->v.push_back(sab->GetBackingStore());
        return v8::Just<uint32_t>(static_cast<uint32_t>(sabs->v.size() - 1));
    }
};

class MnDeserDelegate : public v8::ValueDeserializer::Delegate {
public:
    SabList* sabs;
    v8::MaybeLocal<v8::SharedArrayBuffer> GetSharedArrayBufferFromId(
            v8::Isolate* isolate, uint32_t id) override {
        if (sabs && id < sabs->v.size())
            return v8::SharedArrayBuffer::New(isolate, sabs->v[id]);
        return v8::MaybeLocal<v8::SharedArrayBuffer>();
    }
};

// Serialize `val` to a malloc'd byte buffer (caller frees via free()).
// Returns the buffer (or null on failure); writes length to *out_len and an
// opaque SabList* to *out_sabs (null if no SharedArrayBuffers; free via
// v8c_sab_free). The SabList keeps SAB memory alive across the thread hop.
extern "C" uint8_t* v8c_serialize(v8c_isolate* iso, v8c_context* ctx,
                                  v8c_value val, size_t* out_len, void** out_sabs) {
    auto* i = ISO(iso);
    v8::HandleScope hs(i);
    auto* sabs = new SabList();
    MnSerDelegate del;
    del.iso = i;
    del.sabs = sabs;
    v8::ValueSerializer ser(i, &del);
    ser.WriteHeader();
    bool ok = false;
    if (!ser.WriteValue(ctx_local(ctx), unwrap(i, val)).To(&ok) || !ok) {
        delete sabs;
        *out_len = 0; *out_sabs = nullptr;
        return nullptr;
    }
    std::pair<uint8_t*, size_t> buf = ser.Release();  // malloc'd
    *out_len = buf.second;
    if (sabs->v.empty()) { delete sabs; *out_sabs = nullptr; }
    else { *out_sabs = sabs; }
    return buf.first;
}

extern "C" v8c_value v8c_deserialize(v8c_isolate* iso, v8c_context* ctx,
                                     const uint8_t* data, size_t len, void* sabs) {
    auto* i = ISO(iso);
    v8::HandleScope hs(i);
    MnDeserDelegate del;
    del.sabs = reinterpret_cast<SabList*>(sabs);
    v8::ValueDeserializer deser(i, data, len, &del);
    bool hdr = false;
    if (!deser.ReadHeader(ctx_local(ctx)).To(&hdr) || !hdr) return V8C_VALUE_INVALID;
    v8::Local<v8::Value> out;
    if (!deser.ReadValue(ctx_local(ctx)).ToLocal(&out)) return V8C_VALUE_INVALID;
    return wrap(i, out);
}

extern "C" void v8c_sab_free(void* sabs) {
    delete reinterpret_cast<SabList*>(sabs);
}

// Cross-thread worker termination: interrupt JS running in another isolate.
extern "C" void v8c_isolate_terminate(v8c_isolate* iso) {
    ISO(iso)->TerminateExecution();
}
extern "C" void v8c_isolate_cancel_terminate(v8c_isolate* iso) {
    ISO(iso)->CancelTerminateExecution();
}
