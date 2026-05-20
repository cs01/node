// binding_registry.c — mutable global state for binding dispatch table + runtime config
// Milo can't do module-level vars, so the table lives here.

#include <string.h>
#include <stdint.h>
#include <stdlib.h>

typedef void (*binding_init_fn)(void* iso, void* ctx, int32_t exports);

#define MAX_BINDINGS 128

static const char* reg_names[MAX_BINDINGS];
static binding_init_fn reg_inits[MAX_BINDINGS];
static int32_t reg_cache[MAX_BINDINGS];
static int32_t reg_count = 0;

void nm_registry_add(const char* name, binding_init_fn init) {
    if (reg_count >= MAX_BINDINGS) return;
    reg_names[reg_count] = name;
    reg_inits[reg_count] = init;
    reg_cache[reg_count] = -1;
    reg_count++;
}

// Returns cached exports slot or calls init. Returns -1 if not found.
int32_t nm_registry_get(void* iso, void* ctx, const char* name,
                        int32_t (*make_object)(void*)) {
    for (int i = 0; i < reg_count; i++) {
        if (strcmp(reg_names[i], name) == 0) {
            if (reg_cache[i] >= 0) return reg_cache[i];
            int32_t exports = make_object(iso);
            reg_inits[i](iso, ctx, exports);
            reg_cache[i] = exports;
            return exports;
        }
    }
    return -1;
}

// --- lib dir (for loading builtin JS modules from filesystem) ---

static char lib_dir[1024] = {0};

void nm_set_lib_dir(const char* dir) {
    strncpy(lib_dir, dir, sizeof(lib_dir) - 1);
    lib_dir[sizeof(lib_dir) - 1] = '\0';
}

const char* nm_get_lib_dir(void) {
    return lib_dir;
}
