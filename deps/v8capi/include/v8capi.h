// v8capi.h — C ABI shim over V8's C++ API.
// Zero Node logic. Only V8 type marshalling.
// Milo runtime calls these via FFI.

#ifndef V8CAPI_H
#define V8CAPI_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

// ---------------------------------------------------------------------------
// Opaque handle types — Milo holds these as *u8, never dereferences
// ---------------------------------------------------------------------------

typedef struct v8c_isolate v8c_isolate;
typedef struct v8c_context v8c_context;
typedef struct v8c_handle_scope v8c_handle_scope;
typedef struct v8c_escapable_handle_scope v8c_escapable_handle_scope;

// Unified value handle: wraps v8::Local<v8::Value> (or subclass)
// Lifetime tied to enclosing HandleScope
typedef struct { int32_t slot; } v8c_value;

// Persistent handle: survives HandleScope
typedef struct { int32_t slot; } v8c_persistent;

// Template handles
typedef struct { int32_t slot; } v8c_function_template;
typedef struct { int32_t slot; } v8c_object_template;

// Null/invalid sentinel
#define V8C_VALUE_INVALID ((v8c_value){-1})
#define V8C_PERSISTENT_INVALID ((v8c_persistent){-1})

static inline int v8c_value_is_valid(v8c_value v) { return v.slot >= 0; }

// ---------------------------------------------------------------------------
// Callback signatures — match V8's calling conventions
// ---------------------------------------------------------------------------

// FunctionCallback: the primary binding signature
// info is opaque FunctionCallbackInfo*, rt_data is external data pointer
typedef void (*v8c_function_callback)(void* info, void* rt_data);

// Weak reference callback
typedef void (*v8c_weak_callback)(void* data);

// ---------------------------------------------------------------------------
// Platform + Isolate lifecycle
// ---------------------------------------------------------------------------

int32_t   v8c_platform_init(const char* exec_path);
void      v8c_platform_shutdown(void);

v8c_isolate* v8c_isolate_new(void);
void         v8c_isolate_dispose(v8c_isolate* iso);
void         v8c_isolate_enter(v8c_isolate* iso);
void         v8c_isolate_exit(v8c_isolate* iso);

// Microtask / tick control
void v8c_isolate_run_microtasks(v8c_isolate* iso);
void v8c_isolate_request_gc(v8c_isolate* iso);
void v8c_isolate_low_memory_notification(v8c_isolate* iso);

// ---------------------------------------------------------------------------
// HandleScope
// ---------------------------------------------------------------------------

v8c_handle_scope* v8c_handle_scope_new(v8c_isolate* iso);
void              v8c_handle_scope_delete(v8c_handle_scope* hs);

v8c_escapable_handle_scope* v8c_escapable_handle_scope_new(v8c_isolate* iso);
v8c_value v8c_escapable_handle_scope_escape(v8c_escapable_handle_scope* ehs,
                                             v8c_value val);
void      v8c_escapable_handle_scope_delete(v8c_escapable_handle_scope* ehs);

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

v8c_context* v8c_context_new(v8c_isolate* iso);
void         v8c_context_dispose(v8c_context* ctx);
void         v8c_context_enter(v8c_context* ctx);
void         v8c_context_exit(v8c_context* ctx);
v8c_value    v8c_context_global(v8c_context* ctx);

// ---------------------------------------------------------------------------
// Persistent handles
// ---------------------------------------------------------------------------

v8c_persistent v8c_persistent_new(v8c_isolate* iso, v8c_value val);
v8c_value      v8c_persistent_to_local(v8c_isolate* iso, v8c_persistent p);
void           v8c_persistent_reset(v8c_persistent p);
void           v8c_persistent_set_weak(v8c_persistent p,
                                        void* parameter,
                                        v8c_weak_callback callback);

// ---------------------------------------------------------------------------
// Value type checks
// ---------------------------------------------------------------------------

int v8c_value_is_undefined(v8c_isolate* iso, v8c_value val);
int v8c_value_is_null(v8c_isolate* iso, v8c_value val);
int v8c_value_is_null_or_undefined(v8c_isolate* iso, v8c_value val);
int v8c_value_is_true(v8c_isolate* iso, v8c_value val);
int v8c_value_is_false(v8c_isolate* iso, v8c_value val);
int v8c_value_is_string(v8c_isolate* iso, v8c_value val);
int v8c_value_is_number(v8c_isolate* iso, v8c_value val);
int v8c_value_is_int32(v8c_isolate* iso, v8c_value val);
int v8c_value_is_uint32(v8c_isolate* iso, v8c_value val);
int v8c_value_is_boolean(v8c_isolate* iso, v8c_value val);
int v8c_value_is_object(v8c_isolate* iso, v8c_value val);
int v8c_value_is_function(v8c_isolate* iso, v8c_value val);
int v8c_value_is_array(v8c_isolate* iso, v8c_value val);
int v8c_value_is_array_buffer(v8c_isolate* iso, v8c_value val);
int v8c_value_is_array_buffer_view(v8c_isolate* iso, v8c_value val);
int v8c_value_is_uint8array(v8c_isolate* iso, v8c_value val);
int v8c_value_is_promise(v8c_isolate* iso, v8c_value val);
int v8c_value_is_symbol(v8c_isolate* iso, v8c_value val);
int v8c_value_is_bigint(v8c_isolate* iso, v8c_value val);
int v8c_value_is_external(v8c_isolate* iso, v8c_value val);

// Strict equality
int v8c_value_strict_equals(v8c_isolate* iso, v8c_value a, v8c_value b);

// ---------------------------------------------------------------------------
// Primitive constructors
// ---------------------------------------------------------------------------

v8c_value v8c_undefined(v8c_isolate* iso);
v8c_value v8c_null(v8c_isolate* iso);
v8c_value v8c_true(v8c_isolate* iso);
v8c_value v8c_false(v8c_isolate* iso);
v8c_value v8c_boolean(v8c_isolate* iso, int val);
v8c_value v8c_int32(v8c_isolate* iso, int32_t val);
v8c_value v8c_uint32(v8c_isolate* iso, uint32_t val);
v8c_value v8c_number(v8c_isolate* iso, double val);
v8c_value v8c_bigint_i64(v8c_isolate* iso, int64_t val);
v8c_value v8c_bigint_u64(v8c_isolate* iso, uint64_t val);
v8c_value v8c_external(v8c_isolate* iso, void* data);

// ---------------------------------------------------------------------------
// Primitive extractors — return 0 on success, -1 on type error
// ---------------------------------------------------------------------------

int v8c_to_int32(v8c_isolate* iso, v8c_value val, int32_t* out);
int v8c_to_uint32(v8c_isolate* iso, v8c_value val, uint32_t* out);
int v8c_to_double(v8c_isolate* iso, v8c_value val, double* out);
int v8c_to_i64(v8c_isolate* iso, v8c_value val, int64_t* out);
int v8c_to_bool(v8c_isolate* iso, v8c_value val, int* out);
void* v8c_to_external(v8c_isolate* iso, v8c_value val);

// ---------------------------------------------------------------------------
// Strings
// ---------------------------------------------------------------------------

// Create from UTF-8 (null-terminated or with length)
v8c_value v8c_string_utf8(v8c_isolate* iso, const char* data);
v8c_value v8c_string_utf8_len(v8c_isolate* iso, const char* data, int32_t len);

// Read string contents: writes UTF-8 to buf, returns bytes written
// If buf is NULL, returns required size
int32_t v8c_string_write_utf8(v8c_isolate* iso, v8c_value str,
                               char* buf, int32_t bufsize);

// String length (UTF-16 code units, matching JS .length)
int32_t v8c_string_length(v8c_isolate* iso, v8c_value str);

// ---------------------------------------------------------------------------
// Object
// ---------------------------------------------------------------------------

v8c_value v8c_object_new(v8c_isolate* iso);

// Get/set by string key
v8c_value v8c_object_get(v8c_context* ctx, v8c_value obj, const char* key);
int       v8c_object_set(v8c_context* ctx, v8c_value obj, const char* key,
                          v8c_value val);

// Get/set by index
v8c_value v8c_object_get_index(v8c_context* ctx, v8c_value obj, uint32_t idx);
int       v8c_object_set_index(v8c_context* ctx, v8c_value obj, uint32_t idx,
                                v8c_value val);

// Get/set by Value key
v8c_value v8c_object_get_v(v8c_context* ctx, v8c_value obj, v8c_value key);
int       v8c_object_set_v(v8c_context* ctx, v8c_value obj, v8c_value key,
                            v8c_value val);

int v8c_object_has(v8c_context* ctx, v8c_value obj, const char* key);
int v8c_object_delete(v8c_context* ctx, v8c_value obj, const char* key);

// Property names
v8c_value v8c_object_get_own_property_names(v8c_context* ctx, v8c_value obj);

// Internal fields (for BaseObject / wrapped native pointers)
void  v8c_object_set_internal_field(v8c_isolate* iso, v8c_value obj,
                                     int index, v8c_value val);
v8c_value v8c_object_get_internal_field(v8c_isolate* iso, v8c_value obj,
                                         int index);
void  v8c_object_set_aligned_pointer(v8c_isolate* iso, v8c_value obj,
                                      int index, void* ptr);
void* v8c_object_get_aligned_pointer(v8c_isolate* iso, v8c_value obj,
                                      int index);
int   v8c_object_internal_field_count(v8c_isolate* iso, v8c_value obj);

// Prototype chain
v8c_value v8c_object_get_prototype(v8c_isolate* iso, v8c_value obj);
int       v8c_object_set_prototype(v8c_context* ctx, v8c_value obj,
                                    v8c_value proto);

// ---------------------------------------------------------------------------
// Array
// ---------------------------------------------------------------------------

v8c_value v8c_array_new(v8c_isolate* iso, int32_t length);
int32_t   v8c_array_length(v8c_isolate* iso, v8c_value arr);

// ---------------------------------------------------------------------------
// Function
// ---------------------------------------------------------------------------

v8c_value v8c_function_new(v8c_context* ctx, v8c_function_callback cb,
                            void* data);
v8c_value v8c_function_call(v8c_context* ctx, v8c_value func, v8c_value recv,
                             int argc, const v8c_value* argv);

// ---------------------------------------------------------------------------
// FunctionCallbackInfo accessors (used inside v8c_function_callback)
// ---------------------------------------------------------------------------

int32_t   v8c_fci_length(void* info);
v8c_value v8c_fci_arg(void* info, int32_t idx);
v8c_value v8c_fci_this(void* info);
v8c_value v8c_fci_data(void* info);
v8c_value v8c_fci_new_target(void* info);
int       v8c_fci_is_construct_call(void* info);
v8c_isolate* v8c_fci_isolate(void* info);
v8c_context* v8c_fci_context(void* info);

// Return value
void v8c_fci_return(void* info, v8c_value val);
void v8c_fci_return_int32(void* info, int32_t val);
void v8c_fci_return_uint32(void* info, uint32_t val);
void v8c_fci_return_double(void* info, double val);
void v8c_fci_return_bool(void* info, int val);
void v8c_fci_return_string(void* info, const char* str);
void v8c_fci_return_string_len(void* info, const char* str, int32_t len);
void v8c_fci_return_null(void* info);
void v8c_fci_return_undefined(void* info);

// ---------------------------------------------------------------------------
// FunctionTemplate / ObjectTemplate
// ---------------------------------------------------------------------------

v8c_function_template v8c_function_template_new(v8c_isolate* iso,
                                                 v8c_function_callback cb,
                                                 void* data);
v8c_value v8c_function_template_get_function(v8c_context* ctx,
                                              v8c_function_template ft);
v8c_object_template v8c_function_template_instance_template(
    v8c_isolate* iso, v8c_function_template ft);
v8c_object_template v8c_function_template_prototype_template(
    v8c_isolate* iso, v8c_function_template ft);
void v8c_function_template_set_class_name(v8c_function_template ft,
                                           v8c_isolate* iso,
                                           const char* name);
void v8c_function_template_inherit(v8c_isolate* iso,
                                    v8c_function_template child,
                                    v8c_function_template parent);

v8c_object_template v8c_object_template_new(v8c_isolate* iso);
void v8c_object_template_set_internal_field_count(v8c_isolate* iso,
                                                   v8c_object_template ot,
                                                   int count);
v8c_value v8c_object_template_new_instance(v8c_context* ctx,
                                            v8c_object_template ot);

// Set method on template
void v8c_template_set(v8c_isolate* iso, v8c_function_template ft,
                       const char* name, v8c_function_callback cb,
                       void* data);
void v8c_template_set_ot(v8c_isolate* iso, v8c_object_template ot,
                          const char* name, v8c_function_callback cb,
                          void* data);

// ---------------------------------------------------------------------------
// Exceptions
// ---------------------------------------------------------------------------

v8c_value v8c_exception_error(v8c_isolate* iso, const char* msg);
v8c_value v8c_exception_type_error(v8c_isolate* iso, const char* msg);
v8c_value v8c_exception_range_error(v8c_isolate* iso, const char* msg);
v8c_value v8c_exception_syntax_error(v8c_isolate* iso, const char* msg);
v8c_value v8c_exception_reference_error(v8c_isolate* iso, const char* msg);

void v8c_isolate_throw(v8c_isolate* iso, v8c_value exception);

// ---------------------------------------------------------------------------
// TryCatch
// ---------------------------------------------------------------------------

typedef struct v8c_try_catch v8c_try_catch;

v8c_try_catch* v8c_try_catch_new(v8c_isolate* iso);
void           v8c_try_catch_delete(v8c_try_catch* tc);
int            v8c_try_catch_has_caught(v8c_try_catch* tc);
v8c_value      v8c_try_catch_exception(v8c_try_catch* tc);
v8c_value      v8c_try_catch_message(v8c_try_catch* tc);
void           v8c_try_catch_reset(v8c_try_catch* tc);
void           v8c_try_catch_rethrow(v8c_try_catch* tc);

// ---------------------------------------------------------------------------
// Script compilation & execution
// ---------------------------------------------------------------------------

v8c_value v8c_script_compile_run(v8c_context* ctx,
                                  const char* source, int32_t source_len,
                                  const char* filename);

// ---------------------------------------------------------------------------
// ArrayBuffer
// ---------------------------------------------------------------------------

v8c_value v8c_arraybuffer_new(v8c_isolate* iso, size_t byte_length);
v8c_value v8c_arraybuffer_new_backing(v8c_isolate* iso, void* data,
                                       size_t byte_length);
void*     v8c_arraybuffer_data(v8c_isolate* iso, v8c_value ab);
size_t    v8c_arraybuffer_byte_length(v8c_isolate* iso, v8c_value ab);

// Uint8Array
v8c_value v8c_uint8array_new(v8c_isolate* iso, v8c_value ab,
                              size_t offset, size_t length);
// Uint32Array
v8c_value v8c_uint32array_new(v8c_isolate* iso, v8c_value ab,
                               size_t offset, size_t length);
// BigUint64Array
v8c_value v8c_biguint64array_new(v8c_isolate* iso, v8c_value ab,
                                  size_t offset, size_t length);
void*     v8c_typedarray_data(v8c_isolate* iso, v8c_value ta);
size_t    v8c_typedarray_byte_length(v8c_isolate* iso, v8c_value ta);
size_t    v8c_typedarray_byte_offset(v8c_isolate* iso, v8c_value ta);
size_t    v8c_typedarray_length(v8c_isolate* iso, v8c_value ta);

// ---------------------------------------------------------------------------
// Promise
// ---------------------------------------------------------------------------

typedef struct { int32_t slot; } v8c_resolver;

v8c_resolver v8c_promise_resolver_new(v8c_context* ctx);
v8c_value    v8c_resolver_get_promise(v8c_context* ctx, v8c_resolver r);
int          v8c_resolver_resolve(v8c_context* ctx, v8c_resolver r,
                                   v8c_value val);
int          v8c_resolver_reject(v8c_context* ctx, v8c_resolver r,
                                  v8c_value val);

// ---------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------

v8c_value v8c_json_parse(v8c_context* ctx, v8c_value str);
v8c_value v8c_json_stringify(v8c_context* ctx, v8c_value val);

// ---------------------------------------------------------------------------
// Symbol
// ---------------------------------------------------------------------------

v8c_value v8c_symbol_new(v8c_isolate* iso, const char* description);
v8c_value v8c_symbol_for(v8c_isolate* iso, const char* key);

// ---------------------------------------------------------------------------
// Private (V8 Private symbols — invisible to JS, used for internal metadata)
// ---------------------------------------------------------------------------

v8c_value v8c_private_new(v8c_isolate* iso, const char* description);
int       v8c_private_set(v8c_context* ctx, v8c_value obj,
                           v8c_value priv, v8c_value val);
v8c_value v8c_private_get(v8c_context* ctx, v8c_value obj, v8c_value priv);
int       v8c_private_has(v8c_context* ctx, v8c_value obj, v8c_value priv);

// ---------------------------------------------------------------------------
// Object property enumeration
// ---------------------------------------------------------------------------

// filter: 0 = ALL_PROPERTIES, 2 = ONLY_ENUMERABLE (matches V8 PropertyFilter)
v8c_value v8c_object_get_property_names(v8c_context* ctx, v8c_value obj,
                                         int filter);

// ---------------------------------------------------------------------------
// Property attributes
// ---------------------------------------------------------------------------

enum v8c_property_attribute {
    V8C_NONE       = 0,
    V8C_READ_ONLY  = 1 << 0,
    V8C_DONT_ENUM  = 1 << 1,
    V8C_DONT_DELETE = 1 << 2,
};

int v8c_object_define_property(v8c_context* ctx, v8c_value obj,
                                const char* key, v8c_value val,
                                int attributes);

#ifdef __cplusplus
}
#endif

#endif
