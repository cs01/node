// C entry point — bridges CRT main to Milo's entry function
// Milo's codegen adds implicit params before user params, so we can't
// use Milo's main directly as the CRT entry point.

#include <stdio.h>
#include <unistd.h>
#include <sys/types.h>
#include <sys/sysctl.h>
#include <sys/socket.h>
#include <netdb.h>
#include <arpa/inet.h>
#include <string.h>

extern int milo_node_main(int argc, char** argv);
extern char **environ;

char** environ_get(void) { return environ; }

// dns helper: resolve hostname to IP string, returns 0 on success
// family: 0=any, 4=ipv4, 6=ipv6
int nm_dns_lookup(const char* hostname, int family, char* out_ip, int out_len, int* out_family) {
    struct addrinfo hints, *res;
    memset(&hints, 0, sizeof(hints));
    hints.ai_family = family == 4 ? AF_INET : family == 6 ? AF_INET6 : AF_UNSPEC;
    hints.ai_socktype = SOCK_STREAM;

    int err = getaddrinfo(hostname, NULL, &hints, &res);
    if (err != 0 || !res) return -1;

    if (res->ai_family == AF_INET) {
        struct sockaddr_in* addr = (struct sockaddr_in*)res->ai_addr;
        inet_ntop(AF_INET, &addr->sin_addr, out_ip, out_len);
        *out_family = 4;
    } else if (res->ai_family == AF_INET6) {
        struct sockaddr_in6* addr = (struct sockaddr_in6*)res->ai_addr;
        inet_ntop(AF_INET6, &addr->sin6_addr, out_ip, out_len);
        *out_family = 6;
    } else {
        freeaddrinfo(res);
        return -1;
    }

    freeaddrinfo(res);
    return 0;
}

// os helpers — cpu info, network interfaces
#include <mach/mach.h>
#include <mach/processor_info.h>
#include <mach/host_info.h>
#include <ifaddrs.h>
#include <net/if.h>

// Returns CPU frequency in MHz
long long nm_cpu_speed(void) {
    uint64_t freq = 0;
    size_t size = sizeof(freq);
    if (sysctlbyname("hw.cpufrequency", &freq, &size, NULL, 0) == 0) {
        return freq / 1000000;
    }
    // Apple Silicon: hw.cpufrequency unavailable, use hw.tbfrequency / 10000
    uint64_t tb = 0;
    size = sizeof(tb);
    if (sysctlbyname("hw.tbfrequency", &tb, &size, NULL, 0) == 0 && tb > 0) {
        return tb / 10000;
    }
    return 0;
}

// Fills user/sys/idle/nice times (in clock ticks) for each CPU
// Returns number of CPUs, or -1 on error
// out_times must have space for ncpu*4 uint32_t values
int nm_cpu_times(unsigned int* out_times, int max_cpus) {
    natural_t ncpu = 0;
    processor_cpu_load_info_t cpu_load;
    mach_msg_type_number_t count;
    kern_return_t kr = host_processor_info(mach_host_self(), PROCESSOR_CPU_LOAD_INFO, &ncpu, (processor_info_array_t*)&cpu_load, &count);
    if (kr != KERN_SUCCESS) return -1;
    int n = ncpu < max_cpus ? ncpu : max_cpus;
    for (int i = 0; i < n; i++) {
        out_times[i*4+0] = cpu_load[i].cpu_ticks[CPU_STATE_USER];
        out_times[i*4+1] = cpu_load[i].cpu_ticks[CPU_STATE_SYSTEM];
        out_times[i*4+2] = cpu_load[i].cpu_ticks[CPU_STATE_IDLE];
        out_times[i*4+3] = cpu_load[i].cpu_ticks[CPU_STATE_NICE];
    }
    vm_deallocate(mach_task_self(), (vm_address_t)cpu_load, count * sizeof(integer_t));
    return n;
}

// Get network interfaces: fills a buffer with entries
// Format per entry: name\0family(4|6)\0address\0netmask\0mac\0\0
// Returns number of entries
int nm_net_interfaces(char* out, int out_len) {
    struct ifaddrs *ifap, *ifa;
    if (getifaddrs(&ifap) != 0) return 0;
    int pos = 0, count = 0;
    for (ifa = ifap; ifa; ifa = ifa->ifa_next) {
        if (!ifa->ifa_addr) continue;
        if (ifa->ifa_addr->sa_family != AF_INET && ifa->ifa_addr->sa_family != AF_INET6) continue;
        int fam = ifa->ifa_addr->sa_family == AF_INET ? 4 : 6;
        char addr[64] = {0}, mask[64] = {0};
        if (fam == 4) {
            struct sockaddr_in *sa = (struct sockaddr_in*)ifa->ifa_addr;
            inet_ntop(AF_INET, &sa->sin_addr, addr, sizeof(addr));
            if (ifa->ifa_netmask) {
                struct sockaddr_in *nm = (struct sockaddr_in*)ifa->ifa_netmask;
                inet_ntop(AF_INET, &nm->sin_addr, mask, sizeof(mask));
            }
        } else {
            struct sockaddr_in6 *sa = (struct sockaddr_in6*)ifa->ifa_addr;
            inet_ntop(AF_INET6, &sa->sin6_addr, addr, sizeof(addr));
            if (ifa->ifa_netmask) {
                struct sockaddr_in6 *nm = (struct sockaddr_in6*)ifa->ifa_netmask;
                inet_ntop(AF_INET6, &nm->sin6_addr, mask, sizeof(mask));
            }
        }
        // Write: name|family|address|netmask\n
        int n = snprintf(out + pos, out_len - pos, "%s|%d|%s|%s\n", ifa->ifa_name, fam, addr, mask);
        if (n < 0 || pos + n >= out_len) break;
        pos += n;
        count++;
    }
    freeifaddrs(ifap);
    if (pos < out_len) out[pos] = 0;
    return count;
}

// userinfo helper — getpwuid
#include <pwd.h>

// Fills "username|homedir|shell" into out buffer
int nm_userinfo(int uid, char* out, int out_len) {
    struct passwd* pw = getpwuid(uid);
    if (!pw) return -1;
    int n = snprintf(out, out_len, "%s|%s|%s", pw->pw_name, pw->pw_dir, pw->pw_shell);
    return (n >= 0 && n < out_len) ? 0 : -1;
}

// zlib helpers — gzip/gunzip/deflate/inflate
#include <zlib.h>

// Returns compressed size, or -1 on error. Output buffer must be pre-allocated.
int nm_zlib_deflate(const unsigned char* in, int in_len, unsigned char* out, int out_len, int level, int windowBits) {
    z_stream strm;
    memset(&strm, 0, sizeof(strm));
    if (deflateInit2(&strm, level, Z_DEFLATED, windowBits, 8, Z_DEFAULT_STRATEGY) != Z_OK) return -1;
    strm.next_in = (unsigned char*)in;
    strm.avail_in = in_len;
    strm.next_out = out;
    strm.avail_out = out_len;
    int ret = deflate(&strm, Z_FINISH);
    int written = out_len - strm.avail_out;
    deflateEnd(&strm);
    return (ret == Z_STREAM_END) ? written : -1;
}

// Returns decompressed size, or -1 on error.
int nm_zlib_inflate(const unsigned char* in, int in_len, unsigned char* out, int out_len, int windowBits) {
    z_stream strm;
    memset(&strm, 0, sizeof(strm));
    if (inflateInit2(&strm, windowBits) != Z_OK) return -1;
    strm.next_in = (unsigned char*)in;
    strm.avail_in = in_len;
    strm.next_out = out;
    strm.avail_out = out_len;
    int ret = inflate(&strm, Z_FINISH);
    int written = out_len - strm.avail_out;
    inflateEnd(&strm);
    return (ret == Z_STREAM_END || ret == Z_OK) ? written : -1;
}

int main(int argc, char** argv) {
    return milo_node_main(argc, argv);
}
