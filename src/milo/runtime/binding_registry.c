// binding_registry.c — binding dispatch table, runtime config, ARM64 variadic wrapper

#include <string.h>
#include <stdint.h>
#include <stdlib.h>
#include <fcntl.h>
#include <unistd.h>
#include <sys/stat.h>
#include <sys/event.h>
#include <sys/ioctl.h>
#include <sys/time.h>
#include <errno.h>

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

// Wrapper for variadic open() — ARM64 variadic ABI differs from regular fn ABI.
// Capture errno HERE (same fn as the syscall) and return -errno on failure — reading
// errno back in milo after the FFI return races against clobbering, which surfaced
// every open failure as EPERM(-1) instead of the real ENOENT/EACCES/EISDIR.
int nm_fs_open(const char* path, int flags, int mode) {
    int fd = open(path, flags, mode);
    return fd >= 0 ? fd : -errno;
}

// Wrapper for variadic fcntl() — same ARM64 ABI reason. Sets FD_CLOEXEC so the
// fd closes across execve (lets a replaced process image rebind a socket port).
int nm_set_cloexec(int fd) {
    int flags = fcntl(fd, F_GETFD, 0);
    if (flags < 0) return -1;
    return fcntl(fd, F_SETFD, flags | FD_CLOEXEC);
}

// Wrapper for variadic fcntl() — same ARM64 ABI reason as nm_set_cloexec. Without this,
// tcp.milo's direct `extern fn fcntl(fd, cmd, arg)` put arg 3 in w2 while the variadic ABI
// reads it off the stack, so F_SETFL wrote stack garbage and O_NONBLOCK never landed:
// every socket in the process was BLOCKING (lsof showed no NBF, and differing junk flags
// per call site). Reads/accepts never noticed — they only run after kqueue reports
// readiness — but a large write past the kernel sndbuf blocked the whole event loop,
// deadlocking the reader that was supposed to drain it.
// ioctl is variadic in C; declaring it fixed-arity in milo miscompiles silently on AArch64
// (the callee reads the varargs off the stack, not the registers milo fills). Same class of
// bug as the fcntl one that left every socket blocking. The milo compiler now hard-errors on
// this, which is how it was caught — wrap it here where the C ABI is correct.
int nm_ioctl_winsize(int fd, void* ws) {
    return ioctl(fd, TIOCGWINSZ, ws);
}

// --- cross-thread event-loop wakeup (EVFILT_USER) -----------------------------------------
// Until this existed there was NO way to wake milo's kqueue from another thread, so the loop
// capped its poll at 2ms whenever workers existed and busy-checked their queues
// (_timers_init.js). kevent() is thread-safe, so a triggered EVFILT_USER is the kqueue-native
// equivalent of uv_async_send — and the primitive napi_threadsafe_function needs.
#define NM_WAKE_IDENT 0x6d696c6f  /* 'milo' — cannot collide with an fd ident */

int nm_kq_wake_register(int kq) {
    struct kevent kev;
    // EV_CLEAR = edge-triggered: one trigger, exactly one wakeup. A level-triggered wakeup
    // would re-fire every poll and spin the loop to a v8 OOM — the exact failure this
    // codebase already paid for with stale fd registrations.
    EV_SET(&kev, NM_WAKE_IDENT, EVFILT_USER, EV_ADD | EV_CLEAR, 0, 0, NULL);
    return kevent(kq, &kev, 1, NULL, 0, NULL);
}

int nm_kq_wake(int kq);

// kq_fd is thread_local in tcp.milo, so a worker thread cannot see the parent's kqueue.
// The main loop publishes its kq here once (first pollInit wins — the main thread always
// initialises poll before any worker exists) so any thread can wake it.
static int g_main_kq = -1;

void nm_kq_set_main(int kq) {
    if (g_main_kq < 0) g_main_kq = kq;
}

// Wake the MAIN loop from any thread. No-op before the main loop has polled.
int nm_kq_wake_main(void) {
    return g_main_kq >= 0 ? nm_kq_wake(g_main_kq) : 0;
}

// Safe to call from ANY thread.
int nm_kq_wake(int kq) {
    struct kevent kev;
    EV_SET(&kev, NM_WAKE_IDENT, EVFILT_USER, 0, NOTE_TRIGGER, 0, NULL);
    return kevent(kq, &kev, 1, NULL, 0, NULL);
}

int nm_set_nonblock(int fd) {
    int flags = fcntl(fd, F_GETFL, 0);
    if (flags < 0) return -1;
    return fcntl(fd, F_SETFL, flags | O_NONBLOCK);
}

// Capture errno in the same frame as the syscall (see nm_fs_open above) and return
// -errno, so the JS layer can distinguish EAGAIN (-35, backpressure) from a real error.
long nm_write(int fd, const void* buf, long len) {
    long n = write(fd, buf, len);
    return n >= 0 ? n : -errno;
}

// libc utimes() takes a struct timeval[2] by pointer — awkward for the milo FFI
// seam, so build it here. atime/mtime are whole seconds since epoch (the JS layer
// floors sub-second precision). time_t is 64-bit on macOS, so post-2038 is fine.
int nm_fs_utimes(const char* path, int64_t atime_sec, int64_t mtime_sec) {
    struct timeval tv[2];
    tv[0].tv_sec = (time_t)atime_sec; tv[0].tv_usec = 0;
    tv[1].tv_sec = (time_t)mtime_sec; tv[1].tv_usec = 0;
    // return 0 on success, else positive errno so the JS layer can map ENOENT etc.
    return utimes(path, tv) == 0 ? 0 : errno;
}

// futimes() on an open fd — same struct timeval[2] marshalling as nm_fs_utimes.
int nm_fs_futimes(int fd, int64_t atime_sec, int64_t mtime_sec) {
    struct timeval tv[2];
    tv[0].tv_sec = (time_t)atime_sec; tv[0].tv_usec = 0;
    tv[1].tv_sec = (time_t)mtime_sec; tv[1].tv_usec = 0;
    return futimes(fd, tv) == 0 ? 0 : errno;
}

// lutimes() acts on the symlink itself (does not follow) — needed for fs.lutimes.
int nm_fs_lutimes(const char* path, int64_t atime_sec, int64_t mtime_sec) {
    struct timeval tv[2];
    tv[0].tv_sec = (time_t)atime_sec; tv[0].tv_usec = 0;
    tv[1].tv_sec = (time_t)mtime_sec; tv[1].tv_usec = 0;
    return lutimes(path, tv) == 0 ? 0 : errno;
}
