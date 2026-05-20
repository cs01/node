// Smoke test: init V8 via C ABI, create context, eval JS, check result.

#include "v8capi.h"
#include <stdio.h>
#include <string.h>
#include <assert.h>

static void test_callback(void* info, void* data) {
    // Return 42 + first argument
    int32_t argc = v8c_fci_length(info);
    v8c_isolate* iso = v8c_fci_isolate(info);

    if (argc > 0) {
        v8c_value arg = v8c_fci_arg(info, 0);
        int32_t val;
        if (v8c_to_int32(iso, arg, &val) == 0) {
            v8c_fci_return_int32(info, 42 + val);
            return;
        }
    }
    v8c_fci_return_int32(info, 42);
}

int main(int argc, char** argv) {
    // Init platform
    assert(v8c_platform_init(argv[0]) == 0);

    // Create isolate
    v8c_isolate* iso = v8c_isolate_new();
    assert(iso);
    v8c_isolate_enter(iso);

    // HandleScope
    v8c_handle_scope* hs = v8c_handle_scope_new(iso);

    // Context
    v8c_context* ctx = v8c_context_new(iso);
    v8c_context_enter(ctx);

    // Test 1: eval simple expression
    const char* src1 = "1 + 1";
    v8c_value result = v8c_script_compile_run(ctx, src1, strlen(src1), "test1");
    assert(v8c_value_is_valid(result));
    int32_t val;
    assert(v8c_to_int32(iso, result, &val) == 0);
    assert(val == 2);
    printf("PASS: 1+1 = %d\n", val);

    // Test 2: create and call native function
    v8c_value global = v8c_context_global(ctx);
    v8c_value fn = v8c_function_new(ctx, test_callback, NULL);
    v8c_object_set(ctx, global, "nativeAdd42", fn);

    const char* src2 = "nativeAdd42(8)";
    result = v8c_script_compile_run(ctx, src2, strlen(src2), "test2");
    assert(v8c_value_is_valid(result));
    assert(v8c_to_int32(iso, result, &val) == 0);
    assert(val == 50);
    printf("PASS: nativeAdd42(8) = %d\n", val);

    // Test 3: string round-trip
    v8c_value str = v8c_string_utf8(iso, "hello from C");
    char buf[64];
    int32_t len = v8c_string_write_utf8(iso, str, buf, sizeof(buf));
    assert(len > 0);
    assert(strcmp(buf, "hello from C") == 0);
    printf("PASS: string round-trip: '%s'\n", buf);

    // Test 4: object creation and property access
    v8c_value obj = v8c_object_new(iso);
    v8c_object_set(ctx, obj, "x", v8c_int32(iso, 99));
    v8c_value x = v8c_object_get(ctx, obj, "x");
    assert(v8c_to_int32(iso, x, &val) == 0);
    assert(val == 99);
    printf("PASS: obj.x = %d\n", val);

    // Test 5: exception handling
    v8c_try_catch* tc = v8c_try_catch_new(iso);
    const char* bad_src = "throw new Error('boom')";
    v8c_value bad = v8c_script_compile_run(ctx, bad_src, strlen(bad_src), "test5");
    assert(!v8c_value_is_valid(bad));
    assert(v8c_try_catch_has_caught(tc));
    printf("PASS: exception caught\n");
    v8c_try_catch_delete(tc);

    // Test 6: array
    v8c_value arr = v8c_array_new(iso, 3);
    v8c_object_set_index(ctx, arr, 0, v8c_int32(iso, 10));
    v8c_object_set_index(ctx, arr, 1, v8c_int32(iso, 20));
    v8c_object_set_index(ctx, arr, 2, v8c_int32(iso, 30));
    assert(v8c_array_length(iso, arr) == 3);
    v8c_value elem = v8c_object_get_index(ctx, arr, 1);
    assert(v8c_to_int32(iso, elem, &val) == 0);
    assert(val == 20);
    printf("PASS: array[1] = %d\n", val);

    // Test 7: type checks
    assert(v8c_value_is_string(iso, str));
    assert(!v8c_value_is_number(iso, str));
    assert(v8c_value_is_number(iso, v8c_number(iso, 3.14)));
    assert(v8c_value_is_undefined(iso, v8c_undefined(iso)));
    assert(v8c_value_is_null(iso, v8c_null(iso)));
    assert(v8c_value_is_object(iso, obj));
    assert(v8c_value_is_array(iso, arr));
    assert(v8c_value_is_function(iso, fn));
    printf("PASS: type checks\n");

    printf("\nAll v8capi tests passed.\n");

    // Cleanup
    v8c_context_exit(ctx);
    v8c_context_dispose(ctx);
    v8c_handle_scope_delete(hs);
    v8c_isolate_exit(iso);
    v8c_isolate_dispose(iso);
    v8c_platform_shutdown();

    return 0;
}
