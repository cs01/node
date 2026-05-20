// platform helpers — C implementations for os/process Milo bindings (macOS)

#include <unistd.h>
#include <sys/types.h>
#include <sys/sysctl.h>
#include <sys/resource.h>
#include <mach/mach.h>
#include <mach/processor_info.h>
#include <mach/mach_host.h>
#include <string.h>
#include <time.h>
#include <stdlib.h>
#include <sys/time.h>

int nm_nprocessors(void) {
    return (int)sysconf(_SC_NPROCESSORS_ONLN);
}

int nm_get_cpu_count(void) {
    return nm_nprocessors();
}

int nm_get_cpu_model(char* buf, int bufsize) {
    size_t len = (size_t)bufsize;
    if (sysctlbyname("machdep.cpu.brand_string", buf, &len, NULL, 0) != 0) {
        strncpy(buf, "unknown", bufsize);
        return -1;
    }
    return 0;
}

int nm_get_cpu_speed(void) {
    // macOS doesn't expose freq via sysctl on Apple Silicon
    // Return 0 — JS layer can handle this
    return 0;
}

void nm_get_cpu_times(int cpu_idx, double* out) {
    // out[0..4] = user, nice, sys, idle, irq
    processor_info_array_t cpuinfo;
    mach_msg_type_number_t numcpuinfo;
    natural_t numcpus;

    memset(out, 0, 5 * sizeof(double));

    if (host_processor_info(mach_host_self(), PROCESSOR_CPU_LOAD_INFO,
                            &numcpus, &cpuinfo, &numcpuinfo) != KERN_SUCCESS)
        return;

    if ((unsigned)cpu_idx < numcpus) {
        int base = cpu_idx * CPU_STATE_MAX;
        out[0] = (double)cpuinfo[base + CPU_STATE_USER];
        out[1] = (double)cpuinfo[base + CPU_STATE_NICE];
        out[2] = (double)cpuinfo[base + CPU_STATE_SYSTEM];
        out[3] = (double)cpuinfo[base + CPU_STATE_IDLE];
        out[4] = 0.0; // irq not available on macOS
    }

    vm_deallocate(mach_task_self(), (vm_address_t)cpuinfo,
                  numcpuinfo * sizeof(integer_t));
}

unsigned long long nm_get_freemem(void) {
    vm_statistics64_data_t stats;
    mach_msg_type_number_t count = HOST_VM_INFO64_COUNT;
    if (host_statistics64(mach_host_self(), HOST_VM_INFO64,
                          (host_info64_t)&stats, &count) != KERN_SUCCESS)
        return 0;
    return (unsigned long long)stats.free_count * (unsigned long long)vm_page_size;
}

unsigned long long nm_get_totalmem(void) {
    uint64_t mem;
    size_t len = sizeof(mem);
    sysctlbyname("hw.memsize", &mem, &len, NULL, 0);
    return mem;
}

void nm_get_loadavg(double* out) {
    double avg[3];
    getloadavg(avg, 3);
    out[0] = avg[0];
    out[1] = avg[1];
    out[2] = avg[2];
}

double nm_get_uptime(void) {
    struct timeval boottime;
    size_t len = sizeof(boottime);
    int mib[2] = { CTL_KERN, KERN_BOOTTIME };
    if (sysctl(mib, 2, &boottime, &len, NULL, 0) != 0)
        return 0.0;
    struct timeval now;
    gettimeofday(&now, NULL);
    return (double)(now.tv_sec - boottime.tv_sec) +
           (double)(now.tv_usec - boottime.tv_usec) / 1e6;
}

int nm_get_os_release(char* buf, int bufsize) {
    size_t len = (size_t)bufsize;
    if (sysctlbyname("kern.osrelease", buf, &len, NULL, 0) != 0) {
        strncpy(buf, "unknown", bufsize);
        return -1;
    }
    return 0;
}

int nm_clock_monotonic_id(void) {
#ifdef __APPLE__
    return CLOCK_MONOTONIC;  // 6 on macOS
#else
    return 1;  // CLOCK_MONOTONIC on Linux
#endif
}
