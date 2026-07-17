// milo's replacement for node's src/node_api.cc — the node-specific slice of Node-API.
//
// The other 129 functions are node's REAL js_native_api_v8.cc, compiled against milo's V8
// (see README.md). This file supplies only what that layer leaves undefined plus addon
// loading. It deliberately does NOT depend on node::Environment or libuv.

#include <v8.h>
#include <dlfcn.h>
#include <cstring>
#include <string>

#include "js_native_api_v8.h"
#include "node_api.h"

namespace {

// node's node_napi_env__ derives its env from node::Environment. milo has none, so this is
// the whole subclass: napi_env__ leaves exactly one pure virtual, CallFinalizer.
class MiloNapiEnv : public napi_env__ {
 public:
  MiloNapiEnv(v8::Local<v8::Context> context, int32_t module_api_version)
      : napi_env__(context, module_api_version) {}

  void CallFinalizer(napi_finalize cb, void* data, void* hint) override {
    v8::HandleScope handle_scope(isolate);
    v8::Context::Scope context_scope(context());
    CallIntoModule([&](napi_env env) { cb(env, data, hint); });
  }
};

}  // namespace

// js_native_api_v8.cc references this (:3137) and node implements it in node_api.cc against
// node's Buffer. milo's Buffer is a JS-side class with no C++ constructor reachable from
// here, so this is an honest feature gap rather than a Uint8Array pretending to be a Buffer —
// an addon gets a clean failure instead of an object that fails later in a confusing way.
napi_status NAPI_CDECL napi_create_external_buffer(napi_env env,
                                                   size_t length,
                                                   void* data,
                                                   napi_finalize finalize_cb,
                                                   void* finalize_hint,
                                                   napi_value* result) {
  (void)length; (void)data; (void)finalize_cb; (void)finalize_hint; (void)result;
  return napi_set_last_error(env, napi_generic_failure);
}

extern "C" {

// process.dlopen(module, filename) binding.
//
// milo's binding callbacks receive `info` as a raw pointer that IS a
// v8::FunctionCallbackInfo<v8::Value>*, so we can take real v8::Locals here rather than
// round-tripping through v8capi's slot table (napi_value is a v8::Local; a slot index is the
// wrong currency — see README).
void nm_napi_dlopen(void* info_ptr, void* rt_data) {
  (void)rt_data;
  const v8::FunctionCallbackInfo<v8::Value>& info =
      *reinterpret_cast<const v8::FunctionCallbackInfo<v8::Value>*>(info_ptr);
  v8::Isolate* isolate = v8::Isolate::GetCurrent();
  v8::HandleScope scope(isolate);
  v8::Local<v8::Context> context = isolate->GetCurrentContext();

  if (info.Length() < 2 || !info[0]->IsObject() || !info[1]->IsString()) {
    isolate->ThrowException(v8::Exception::TypeError(
        v8::String::NewFromUtf8(isolate, "dlopen(module, filename)")
            .ToLocalChecked()));
    return;
  }

  v8::String::Utf8Value filename(isolate, info[1]);
  v8::Local<v8::Object> module = info[0].As<v8::Object>();

  // RTLD_LAZY: an addon's undefined symbols resolve against the host on first use, matching
  // node's DLib::Open default.
  void* handle = dlopen(*filename, RTLD_LAZY);
  if (handle == nullptr) {
    const char* err = dlerror();
    std::string msg = std::string("dlopen failed: ") + (err ? err : "unknown");
    isolate->ThrowException(v8::Exception::Error(
        v8::String::NewFromUtf8(isolate, msg.c_str()).ToLocalChecked()));
    return;
  }

  // The modern entrypoint pair emitted by NAPI_MODULE_INIT(). node also probes the legacy
  // self-registering napi_module_register and its own internal v-numbered symbol; neither is
  // supported here, and an addon built for those gets a clear error rather than a crash.
  using InitFn = napi_value (*)(napi_env, napi_value);
  using VersionFn = int32_t (*)(void);
  InitFn init = reinterpret_cast<InitFn>(dlsym(handle, "napi_register_module_v1"));
  if (init == nullptr) {
    isolate->ThrowException(v8::Exception::Error(
        v8::String::NewFromUtf8(
            isolate,
            "not a Node-API addon: napi_register_module_v1 not found (legacy "
            "node_register_module_v* and napi_module_register are unsupported)")
            .ToLocalChecked()));
    return;
  }

  int32_t module_api_version = NODE_API_DEFAULT_MODULE_API_VERSION;
  VersionFn getver = reinterpret_cast<VersionFn>(
      dlsym(handle, "node_api_module_get_api_version_v1"));
  if (getver != nullptr) module_api_version = getver();

  // `exports` is module.exports — the addon mutates it in place and/or returns a replacement.
  v8::Local<v8::Value> exports_val;
  if (!module->Get(context,
                   v8::String::NewFromUtf8(isolate, "exports").ToLocalChecked())
           .ToLocal(&exports_val) ||
      !exports_val->IsObject()) {
    exports_val = v8::Object::New(isolate);
  }

  napi_env env = new MiloNapiEnv(context, module_api_version);
  napi_value exports =
      reinterpret_cast<napi_value>(*v8::Local<v8::Value>(exports_val));

  napi_value ret = init(env, exports);

  // An addon may return a different object than the one handed to it; honour that.
  if (ret != nullptr) {
    v8::Local<v8::Value> ret_val = *reinterpret_cast<v8::Local<v8::Value>*>(&ret);
    if (!ret_val.IsEmpty()) {
      module
          ->Set(context,
                v8::String::NewFromUtf8(isolate, "exports").ToLocalChecked(),
                ret_val)
          .Check();
    }
  }
}

// internalBinding('napi') init. Signature matches binding_init_fn in binding_registry.c:12;
// `exports` is a v8capi slot, so the v8capi C API attaches the method.
typedef void (*v8c_function_callback)(void* info, void* rt_data);
struct v8c_context;
extern int32_t v8c_function_new(void* ctx, v8c_function_callback cb, void* rt_data);
extern int v8c_object_set(void* ctx, int32_t obj, const char* key, int32_t val);

void nm_init_napi(void* iso, void* ctx, int32_t exports) {
  (void)iso;
  int32_t fn = v8c_function_new(ctx, nm_napi_dlopen, nullptr);
  v8c_object_set(ctx, exports, "dlopen", fn);
}

}  // extern "C"
