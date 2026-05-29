// binding_registry.c — binding dispatch table, runtime config, ARM64 variadic wrapper

#include <string.h>
#include <stdint.h>
#include <stdlib.h>
#include <fcntl.h>
#include <sys/stat.h>

typedef void (*binding_init_fn)(void* iso, void* ctx, int32_t exports);

#define MAX_BINDINGS 128

static const char* reg_names[MAX_BINDINGS];
static binding_init_fn reg_inits[MAX_BINDINGS];
static int32_t reg_count = 0;

// Exports are V8 handle slots, which are per-isolate. Each worker runs its own
// isolate on its own thread, so the cache must be thread-local — a process-global
// cache would hand a worker the main isolate's slots (garbage in its handle table).
static _Thread_local int32_t reg_cache_tls[MAX_BINDINGS];
static _Thread_local int reg_cache_init = 0;

void nm_registry_add(const char* name, binding_init_fn init) {
    if (reg_count >= MAX_BINDINGS) return;
    reg_names[reg_count] = name;
    reg_inits[reg_count] = init;
    reg_count++;
}

// Returns cached exports slot or calls init. Returns -1 if not found.
int32_t nm_registry_get(void* iso, void* ctx, const char* name,
                        int32_t (*make_object)(void*)) {
    if (!reg_cache_init) {
        for (int i = 0; i < MAX_BINDINGS; i++) reg_cache_tls[i] = -1;
        reg_cache_init = 1;
    }
    for (int i = 0; i < reg_count; i++) {
        if (strcmp(reg_names[i], name) == 0) {
            if (reg_cache_tls[i] >= 0) return reg_cache_tls[i];
            int32_t exports = make_object(iso);
            reg_inits[i](iso, ctx, exports);
            reg_cache_tls[i] = exports;
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

// Wrapper for variadic open() — ARM64 variadic ABI differs from regular fn ABI
int nm_fs_open(const char* path, int flags, int mode) {
    return open(path, flags, mode);
}
