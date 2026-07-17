// milo's replacement for node's src/node_api.cc — the node-specific slice of Node-API.
//
// The other 129 functions are node's REAL js_native_api_v8.cc, compiled against milo's V8
// (see README.md). This file supplies only what that layer leaves undefined plus addon
// loading. It deliberately does NOT depend on node::Environment or libuv.

#include <v8.h>
#include <dlfcn.h>
#include <pthread.h>
#include <deque>
#include <cstring>
#include <cstdio>
#include <string>

#include "js_native_api_v8.h"
#include "node_api.h"

extern "C" int nm_kq_wake_main(void);

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

// --- napi_async_work threadpool ------------------------------------------------------------
//
// node hands this to libuv's threadpool; milo has neither libuv nor a pool (pthread_create
// appears exactly once in the tree, for worker_threads). So: a fixed pool drains a work
// queue, `execute` runs off-thread with NO JS access, and `complete` is handed back to the
// LOOP thread — calling into V8 from a pool thread would corrupt the isolate.
//
// The handoff is the EVFILT_USER wakeup: a finished job lands on the done-queue and pings
// nm_kq_wake_main(), which returns the loop's kevent immediately. Before that primitive
// existed there was no way to do this at all.

struct MiloAsyncWork {
  napi_env env;
  napi_async_execute_callback execute;
  napi_async_complete_callback complete;
  void* data;
  napi_status status;      // napi_ok, or napi_cancelled if cancelled before running
  bool cancelled;
};

class AsyncPool {
 public:
  static AsyncPool& get() {
    static AsyncPool inst;
    return inst;
  }

  void submit(MiloAsyncWork* w) {
    pthread_mutex_lock(&mu_);
    ensure_started_locked();
    pending_.push_back(w);
    // Counts submitted-but-not-yet-delivered work. The loop reads this to stay alive:
    // exiting with an addon's callback still owed would silently drop it.
    inflight_++;
    pthread_cond_signal(&cv_);
    pthread_mutex_unlock(&mu_);
  }

  // Cancel only succeeds while the job is still queued — matching node/libuv, which cannot
  // cancel work already picked up by a thread.
  bool cancel(MiloAsyncWork* w) {
    bool found = false;
    pthread_mutex_lock(&mu_);
    for (auto it = pending_.begin(); it != pending_.end(); ++it) {
      if (*it == w) {
        pending_.erase(it);
        w->cancelled = true;
        w->status = napi_cancelled;
        done_.push_back(w);   // still owes its complete callback, with napi_cancelled
        found = true;
        break;
      }
    }
    pthread_mutex_unlock(&mu_);
    if (found) nm_kq_wake_main();
    return found;
  }

  // Drain on the LOOP thread only. Returns how many completions ran.
  int drain() {
    for (;;) {
      MiloAsyncWork* w = nullptr;
      pthread_mutex_lock(&mu_);
      if (!done_.empty()) { w = done_.front(); done_.pop_front(); }
      pthread_mutex_unlock(&mu_);
      if (w == nullptr) break;
      // The callback may re-enter napi (and commonly deletes this work), so the lock must
      // NOT be held here.
      if (w->complete != nullptr) {
        napi_env env = w->env;
        v8::HandleScope scope(env->isolate);
        v8::Context::Scope ctx_scope(env->context());
        env->CallIntoModule([&](napi_env e) { w->complete(e, w->status, w->data); });
      }
      pthread_mutex_lock(&mu_);
      inflight_--;
      pthread_mutex_unlock(&mu_);
      ran_++;
    }
    int n = ran_; ran_ = 0;
    return n;
  }

  bool busy() {
    pthread_mutex_lock(&mu_);
    bool b = inflight_ > 0;
    pthread_mutex_unlock(&mu_);
    return b;
  }

 private:
  AsyncPool() {
    pthread_mutex_init(&mu_, nullptr);
    pthread_cond_init(&cv_, nullptr);
  }

  void ensure_started_locked() {
    if (started_) return;
    started_ = true;
    // 4 threads, matching libuv's default UV_THREADPOOL_SIZE. Started lazily: a process that
    // never loads an async addon should not pay for 4 idle threads.
    for (int i = 0; i < kThreads; i++) pthread_create(&threads_[i], nullptr, &trampoline, this);
  }

  static void* trampoline(void* self) {
    static_cast<AsyncPool*>(self)->run();
    return nullptr;
  }

  void run() {
    for (;;) {
      pthread_mutex_lock(&mu_);
      while (pending_.empty()) pthread_cond_wait(&cv_, &mu_);
      MiloAsyncWork* w = pending_.front();
      pending_.pop_front();
      pthread_mutex_unlock(&mu_);

      // No JS here — this is not the loop thread.
      if (w->execute != nullptr) w->execute(w->env, w->data);
      w->status = napi_ok;

      pthread_mutex_lock(&mu_);
      done_.push_back(w);
      pthread_mutex_unlock(&mu_);
      // Interrupt the loop's kevent so the completion runs now, not at the next timed poll.
      nm_kq_wake_main();
    }
  }

  static const int kThreads = 4;
  pthread_t threads_[kThreads];
  pthread_mutex_t mu_;
  pthread_cond_t cv_;
  std::deque<MiloAsyncWork*> pending_;
  std::deque<MiloAsyncWork*> done_;
  bool started_ = false;
  int inflight_ = 0;
  int ran_ = 0;
};

}  // namespace

// milo's Buffer is a JS-side class with no C++ constructor, but `Buffer.from(arrayBuffer)`
// produces a REAL Buffer sharing the backing store — so an addon gets an object with
// Buffer.prototype, not a Uint8Array wearing its name.
static napi_status MiloBufferFromBackingStore(napi_env env,
                                              v8::Local<v8::ArrayBuffer> ab,
                                              napi_value* result) {
  v8::Isolate* iso = env->isolate;
  v8::Local<v8::Context> ctx = env->context();
  v8::Local<v8::Value> buf_ctor;
  if (!ctx->Global()
           ->Get(ctx, v8::String::NewFromUtf8(iso, "Buffer").ToLocalChecked())
           .ToLocal(&buf_ctor) ||
      !buf_ctor->IsObject()) {
    return napi_set_last_error(env, napi_generic_failure);
  }
  v8::Local<v8::Value> from_fn;
  if (!buf_ctor.As<v8::Object>()
           ->Get(ctx, v8::String::NewFromUtf8(iso, "from").ToLocalChecked())
           .ToLocal(&from_fn) ||
      !from_fn->IsFunction()) {
    return napi_set_last_error(env, napi_generic_failure);
  }
  v8::Local<v8::Value> argv[1] = {ab};
  v8::Local<v8::Value> out;
  if (!from_fn.As<v8::Function>()->Call(ctx, buf_ctor, 1, argv).ToLocal(&out)) {
    return napi_set_last_error(env, napi_pending_exception);
  }
  *result = reinterpret_cast<napi_value>(*out);
  return napi_clear_last_error(env);
}

// Referenced by js_native_api_v8.cc:3137. The finalizer contract (run on the JS thread with
// a live napi_env) is honoured by keeping the data in a V8-owned backing store and invoking
// finalize immediately after the copy — milo cannot adopt foreign memory into a JS Buffer,
// so it copies. Semantically safe; costs one copy versus node.
napi_status NAPI_CDECL napi_create_external_buffer(napi_env env,
                                                   size_t length,
                                                   void* data,
                                                   napi_finalize finalize_cb,
                                                   void* finalize_hint,
                                                   napi_value* result) {
  if (env == nullptr || result == nullptr) return napi_set_last_error(env, napi_invalid_arg);
  v8::HandleScope scope(env->isolate);
  v8::Local<v8::ArrayBuffer> ab = v8::ArrayBuffer::New(env->isolate, length);
  if (data != nullptr && length > 0) memcpy(ab->Data(), data, length);
  napi_status st = MiloBufferFromBackingStore(env, ab, result);
  if (st == napi_ok && finalize_cb != nullptr) finalize_cb(env, data, finalize_hint);
  return st;
}

napi_status NAPI_CDECL napi_create_buffer_copy(napi_env env,
                                               size_t length,
                                               const void* data,
                                               void** result_data,
                                               napi_value* result) {
  if (env == nullptr || result == nullptr) return napi_set_last_error(env, napi_invalid_arg);
  v8::HandleScope scope(env->isolate);
  v8::Local<v8::ArrayBuffer> ab = v8::ArrayBuffer::New(env->isolate, length);
  if (data != nullptr && length > 0) memcpy(ab->Data(), data, length);
  if (result_data != nullptr) *result_data = ab->Data();
  return MiloBufferFromBackingStore(env, ab, result);
}

napi_status NAPI_CDECL napi_create_buffer(napi_env env,
                                          size_t length,
                                          void** data,
                                          napi_value* result) {
  return napi_create_buffer_copy(env, length, nullptr, data, result);
}

// node routes this through async_hooks + its own callback scope. milo has no async_hooks C
// surface, so this is a plain call: correct for the callback itself, missing only the
// async-context bookkeeping (async_id/triggerId) that nothing here consumes.
napi_status NAPI_CDECL napi_make_callback(napi_env env,
                                          napi_async_context async_context,
                                          napi_value recv,
                                          napi_value func,
                                          size_t argc,
                                          const napi_value* argv,
                                          napi_value* result) {
  (void)async_context;
  if (env == nullptr || recv == nullptr || func == nullptr) {
    return napi_set_last_error(env, napi_invalid_arg);
  }
  return napi_call_function(env, recv, func, argc, argv, result);
}

// Terminal by contract — node aborts here too. Print before dying so the addon's reason is
// visible rather than a bare crash.
void NAPI_CDECL napi_fatal_error(const char* location,
                                 size_t location_len,
                                 const char* message,
                                 size_t message_len) {
  fprintf(stderr, "FATAL ERROR: %.*s %.*s\n",
          location_len == NAPI_AUTO_LENGTH ? (int)strlen(location ? location : "") : (int)location_len,
          location ? location : "",
          message_len == NAPI_AUTO_LENGTH ? (int)strlen(message ? message : "") : (int)message_len,
          message ? message : "");
  fflush(stderr);
  abort();
}

// --- napi_async_work public API -------------------------------------------------------------
// async_resource / async_resource_name are node's async-hooks plumbing (async_id, triggerId,
// destroy hooks). milo has no async_hooks C surface, so they are accepted and ignored: the
// work still executes and completes correctly, only async-hooks introspection is absent.
napi_status NAPI_CDECL napi_create_async_work(napi_env env,
                                              napi_value async_resource,
                                              napi_value async_resource_name,
                                              napi_async_execute_callback execute,
                                              napi_async_complete_callback complete,
                                              void* data,
                                              napi_async_work* result) {
  (void)async_resource; (void)async_resource_name;
  if (env == nullptr || execute == nullptr || result == nullptr) {
    return napi_set_last_error(env, napi_invalid_arg);
  }
  MiloAsyncWork* w = new MiloAsyncWork{env, execute, complete, data, napi_ok, false};
  *result = reinterpret_cast<napi_async_work>(w);
  return napi_clear_last_error(env);
}

napi_status NAPI_CDECL napi_delete_async_work(napi_env env, napi_async_work work) {
  if (work == nullptr) return napi_set_last_error(env, napi_invalid_arg);
  delete reinterpret_cast<MiloAsyncWork*>(work);
  return napi_clear_last_error(env);
}

napi_status NAPI_CDECL napi_queue_async_work(node_api_basic_env env, napi_async_work work) {
  if (work == nullptr) return napi_set_last_error((napi_env)env, napi_invalid_arg);
  AsyncPool::get().submit(reinterpret_cast<MiloAsyncWork*>(work));
  return napi_clear_last_error((napi_env)env);
}

napi_status NAPI_CDECL napi_cancel_async_work(node_api_basic_env env, napi_async_work work) {
  if (work == nullptr) return napi_set_last_error((napi_env)env, napi_invalid_arg);
  // Only queued work can be cancelled; already-running work cannot (same as node/libuv).
  if (!AsyncPool::get().cancel(reinterpret_cast<MiloAsyncWork*>(work))) {
    return napi_set_last_error((napi_env)env, napi_generic_failure);
  }
  return napi_clear_last_error((napi_env)env);
}

extern "C" {

// Called by the event loop each turn: runs completion callbacks on the LOOP thread.
void nm_napi_drain(void* info_ptr, void* rt_data) {
  (void)info_ptr; (void)rt_data;
  AsyncPool::get().drain();
}

// Loop liveness: true while any submitted work has not delivered its callback. Exiting with
// an addon's callback still owed would silently drop it.
void nm_napi_busy(void* info_ptr, void* rt_data) {
  (void)rt_data;
  const v8::FunctionCallbackInfo<v8::Value>& info =
      *reinterpret_cast<const v8::FunctionCallbackInfo<v8::Value>*>(info_ptr);
  info.GetReturnValue().Set(AsyncPool::get().busy());
}


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
  v8c_object_set(ctx, exports, "dlopen", v8c_function_new(ctx, nm_napi_dlopen, nullptr));
  v8c_object_set(ctx, exports, "drainAsync", v8c_function_new(ctx, nm_napi_drain, nullptr));
  v8c_object_set(ctx, exports, "asyncBusy", v8c_function_new(ctx, nm_napi_busy, nullptr));
}

}  // extern "C"
