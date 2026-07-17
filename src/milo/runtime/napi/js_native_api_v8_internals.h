#ifndef SRC_MILO_NAPI_JS_NATIVE_API_V8_INTERNALS_H_
#define SRC_MILO_NAPI_JS_NATIVE_API_V8_INTERNALS_H_

// node-milo's replacement for node's src/js_native_api_v8_internals.h.
//
// This is the porting seam node ships FOR non-node embedders: js_native_api_v8.cc is 3748
// lines with exactly one node:: reference and zero uv_ references, so with this header in
// front of it on the include path we compile node's REAL Node-API implementation against
// milo's V8 instead of hand-writing 129 functions. Everything node's own version pulls from
// env.h / node_internals.h is reproduced here standalone.
//
// Deliberately NOT built on deps/v8capi: v8capi's v8c_value is a slot index into a table of
// v8::Global and its HandleScope is a no-op, whereas napi_value IS a v8::Local. N-API must
// sit directly on V8; v8capi is used only at the seam that hands us `exports`.

#include <v8.h>
#include <cstdio>
#include <cstdlib>
#include <utility>
// node's env-inl.h/util-inl.h dragged these in; our stubs do not, so name them explicitly.
#include <string>
#include <memory>
#include <vector>
#include <unordered_map>
#include <unordered_set>

// Defines NAPI_VERSION + NODE_API_SUPPORTED_VERSION_{MIN,MAX} +
// NODE_API_DEFAULT_MODULE_API_VERSION. Self-contained (zero #includes), so it costs us
// nothing to use node's real values rather than restating them.
#include "node_version.h"
// Declarations only (js_native_api.h + node_api_types.h, no uv) — js_native_api_v8.cc calls
// napi_create_external_buffer, which is declared here and implemented on the node_api side.
#include "node_api.h"

#define NAPI_ARRAYSIZE(array) (sizeof(array) / sizeof((array)[0]))

#define NAPI_FIXED_ONE_BYTE_STRING(isolate, string)                            \
  v8::String::NewFromOneByte(                                                  \
      (isolate),                                                               \
      reinterpret_cast<const uint8_t*>(string),                                \
      v8::NewStringType::kInternalized,                                        \
      static_cast<int>(sizeof(string) - 1))                                    \
      .ToLocalChecked()

namespace milo_napi {

// node keeps these two v8::Private keys on its Environment (src/env_properties.h:37-38).
// milo has no Environment, so they hang off the isolate's data slot via a function-local
// static keyed by isolate — the keys must be per-isolate, never global.
// This V8 has no v8::Context::GetIsolate; GetCurrent() is valid everywhere N-API runs
// (always inside an entered isolate).
inline v8::Local<v8::Private> PrivateKey(v8::Local<v8::Context> context,
                                         const char* name) {
  (void)context;
  v8::Isolate* isolate = v8::Isolate::GetCurrent();
  return v8::Private::ForApi(
      isolate,
      v8::String::NewFromUtf8(isolate, name, v8::NewStringType::kInternalized)
          .ToLocalChecked());
}

}  // namespace milo_napi

// Only two suffixes are ever used: `wrapper` and `type_tag` (js_native_api_v8.cc uses
// NAPI_PRIVATE_KEY 6 times). Names match node's so a heap dump reads the same.
#define NAPI_PRIVATE_KEY(context, suffix)                                      \
  (milo_napi::PrivateKey((context), "node:napi:" #suffix))

// --- node's CHECK family, standalone -----------------------------------------------------
#define MILO_NAPI_ABORT(expr)                                                  \
  do {                                                                         \
    fprintf(stderr, "napi CHECK failed: %s at %s:%d\n", expr, __FILE__,        \
            __LINE__);                                                         \
    abort();                                                                   \
  } while (0)

#define CHECK(expr)                                                            \
  do {                                                                         \
    if (!(expr)) MILO_NAPI_ABORT(#expr);                                       \
  } while (0)
#define CHECK_EQ(a, b) CHECK((a) == (b))
#define CHECK_NE(a, b) CHECK((a) != (b))
#define CHECK_LE(a, b) CHECK((a) <= (b))
#define CHECK_LT(a, b) CHECK((a) < (b))
#define CHECK_GE(a, b) CHECK((a) >= (b))
#define CHECK_GT(a, b) CHECK((a) > (b))
#define CHECK_NULL(v) CHECK((v) == nullptr)
#define CHECK_NOT_NULL(v) CHECK((v) != nullptr)

namespace node {

// js_native_api_v8.cc:81 is the ONE node:: reference in the whole file.
template <typename Fn>
struct OnScopeLeaveImpl {
  Fn fn_;
  bool active_;
  explicit OnScopeLeaveImpl(Fn&& fn) : fn_(std::move(fn)), active_(true) {}
  ~OnScopeLeaveImpl() { if (active_) fn_(); }
  OnScopeLeaveImpl(const OnScopeLeaveImpl&) = delete;
  OnScopeLeaveImpl& operator=(const OnScopeLeaveImpl&) = delete;
  OnScopeLeaveImpl(OnScopeLeaveImpl&& other)
      : fn_(std::move(other.fn_)), active_(other.active_) {
    other.active_ = false;
  }
};

template <typename Fn>
inline OnScopeLeaveImpl<Fn> OnScopeLeave(Fn&& fn) {
  return OnScopeLeaveImpl<Fn>{std::move(fn)};
}

}  // namespace node

namespace v8impl {

template <typename T>
using Persistent = v8::Global<T>;

// Mirrors node::PersistentToLocal (src/util.h:802). A weak persistent must round-trip via
// the isolate; a strong one can be reinterpreted directly.
class PersistentToLocal {
 public:
  template <class TypeName>
  static inline v8::Local<TypeName> Strong(
      const v8::PersistentBase<TypeName>& persistent) {
    return *reinterpret_cast<v8::Local<TypeName>*>(
        const_cast<v8::PersistentBase<TypeName>*>(&persistent));
  }

  template <class TypeName>
  static inline v8::Local<TypeName> Weak(
      v8::Isolate* isolate, const v8::PersistentBase<TypeName>& persistent) {
    return v8::Local<TypeName>::New(isolate, persistent);
  }

  template <class TypeName>
  static inline v8::Local<TypeName> Default(
      v8::Isolate* isolate, const v8::PersistentBase<TypeName>& persistent) {
    return persistent.IsWeak() ? Weak(isolate, persistent) : Strong(persistent);
  }
};

[[noreturn]] inline void OnFatalError(const char* location,
                                      const char* message) {
  fprintf(stderr, "FATAL ERROR: %s %s\n", location ? location : "", message);
  fflush(stderr);
  abort();
}

}  // namespace v8impl

#endif  // SRC_MILO_NAPI_JS_NATIVE_API_V8_INTERNALS_H_
