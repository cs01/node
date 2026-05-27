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
// Lookup MAC address for an interface name from AF_LINK entries
#include <net/if_dl.h>
static void _get_mac(struct ifaddrs* ifap, const char* name, char* mac, int mac_len) {
    for (struct ifaddrs* ifa = ifap; ifa; ifa = ifa->ifa_next) {
        if (!ifa->ifa_addr || ifa->ifa_addr->sa_family != AF_LINK) continue;
        if (strcmp(ifa->ifa_name, name) != 0) continue;
        struct sockaddr_dl* sdl = (struct sockaddr_dl*)ifa->ifa_addr;
        if (sdl->sdl_alen == 6) {
            unsigned char* m = (unsigned char*)LLADDR(sdl);
            snprintf(mac, mac_len, "%02x:%02x:%02x:%02x:%02x:%02x", m[0], m[1], m[2], m[3], m[4], m[5]);
            return;
        }
    }
    snprintf(mac, mac_len, "00:00:00:00:00:00");
}

int nm_net_interfaces(char* out, int out_len) {
    struct ifaddrs *ifap, *ifa;
    if (getifaddrs(&ifap) != 0) return 0;
    int pos = 0, count = 0;
    for (ifa = ifap; ifa; ifa = ifa->ifa_next) {
        if (!ifa->ifa_addr) continue;
        if (ifa->ifa_addr->sa_family != AF_INET && ifa->ifa_addr->sa_family != AF_INET6) continue;
        int fam = ifa->ifa_addr->sa_family == AF_INET ? 4 : 6;
        char addr[64] = {0}, mask[64] = {0}, mac[24] = {0};
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
        _get_mac(ifap, ifa->ifa_name, mac, sizeof(mac));
        // Write: name|family|address|netmask|mac\n
        int n = snprintf(out + pos, out_len - pos, "%s|%d|%s|%s|%s\n", ifa->ifa_name, fam, addr, mask, mac);
        if (n < 0 || pos + n >= out_len) break;
        pos += n;
        count++;
    }
    freeifaddrs(ifap);
    if (pos < out_len) out[pos] = 0;
    return count;
}

// dns reverse lookup
int nm_dns_reverse(const char* ip, char* out_hostname, int out_len) {
    struct sockaddr_in sa4;
    struct sockaddr_in6 sa6;
    struct sockaddr* sa;
    socklen_t sa_len;

    memset(&sa4, 0, sizeof(sa4));
    memset(&sa6, 0, sizeof(sa6));

    if (inet_pton(AF_INET, ip, &sa4.sin_addr) == 1) {
        sa4.sin_family = AF_INET;
        sa = (struct sockaddr*)&sa4;
        sa_len = sizeof(sa4);
    } else if (inet_pton(AF_INET6, ip, &sa6.sin6_addr) == 1) {
        sa6.sin6_family = AF_INET6;
        sa = (struct sockaddr*)&sa6;
        sa_len = sizeof(sa6);
    } else {
        return -1;
    }

    return getnameinfo(sa, sa_len, out_hostname, out_len, NULL, 0, 0);
}

// DNS record queries via libresolv
#include <resolv.h>
#include <arpa/nameser.h>

// Parses a DNS name from wire format, advances *pos. Returns length written to out.
static int _dns_read_name(const unsigned char* msg, int msglen, int* pos, char* out, int outlen) {
    int n = dn_expand(msg, msg + msglen, msg + *pos, out, outlen);
    if (n < 0) return -1;
    *pos += n;
    return (int)strlen(out);
}

// nm_dns_query(hostname, rrtype, out, outlen) → bytes written to out
// rrtype: 15=MX, 16=TXT, 33=SRV, 2=NS, 5=CNAME, 12=PTR
// Output format: one record per line, fields separated by spaces
// MX: "priority exchange\n", TXT: "text\n", SRV: "priority weight port target\n"
// NS/CNAME/PTR: "name\n"
int nm_dns_query(const char* hostname, int rrtype, char* out, int out_len) {
    unsigned char answer[4096];
    int len = res_query(hostname, ns_c_in, rrtype, answer, sizeof(answer));
    if (len < 0) return -1;

    // Skip header (12 bytes) and question section
    int pos = 12;
    // Skip QDCOUNT questions
    int qdcount = (answer[4] << 8) | answer[5];
    int ancount = (answer[6] << 8) | answer[7];
    for (int i = 0; i < qdcount; i++) {
        char tmp[256];
        int n = dn_expand(answer, answer + len, answer + pos, tmp, sizeof(tmp));
        if (n < 0) return -1;
        pos += n + 4; // skip name + QTYPE(2) + QCLASS(2)
    }

    int written = 0;
    for (int i = 0; i < ancount && written < out_len - 256; i++) {
        char name[256];
        int n = dn_expand(answer, answer + len, answer + pos, name, sizeof(name));
        if (n < 0) break;
        pos += n;

        if (pos + 10 > len) break;
        int rtype = (answer[pos] << 8) | answer[pos+1];
        int rdlength = (answer[pos+8] << 8) | answer[pos+9];
        pos += 10; // TYPE(2) + CLASS(2) + TTL(4) + RDLENGTH(2)

        if (rtype != rrtype) { pos += rdlength; continue; }

        if (rtype == 15) { // MX
            int priority = (answer[pos] << 8) | answer[pos+1];
            int mxpos = pos + 2;
            char exchange[256];
            if (_dns_read_name(answer, len, &mxpos, exchange, sizeof(exchange)) >= 0) {
                written += snprintf(out + written, out_len - written, "%d %s\n", priority, exchange);
            }
        } else if (rtype == 16) { // TXT
            int tpos = pos;
            int end = pos + rdlength;
            while (tpos < end) {
                int tlen = answer[tpos++];
                if (tpos + tlen > end) break;
                int w = tlen < (out_len - written - 2) ? tlen : (out_len - written - 2);
                memcpy(out + written, answer + tpos, w);
                written += w;
                tpos += tlen;
            }
            out[written++] = '\n';
        } else if (rtype == 33) { // SRV
            int priority = (answer[pos] << 8) | answer[pos+1];
            int weight = (answer[pos+2] << 8) | answer[pos+3];
            int port = (answer[pos+4] << 8) | answer[pos+5];
            int srvpos = pos + 6;
            char target[256];
            if (_dns_read_name(answer, len, &srvpos, target, sizeof(target)) >= 0) {
                written += snprintf(out + written, out_len - written, "%d %d %d %s\n", priority, weight, port, target);
            }
        } else if (rtype == 2 || rtype == 5 || rtype == 12) { // NS, CNAME, PTR
            int npos = pos;
            char rname[256];
            if (_dns_read_name(answer, len, &npos, rname, sizeof(rname)) >= 0) {
                written += snprintf(out + written, out_len - written, "%s\n", rname);
            }
        }

        pos += rdlength;
    }

    if (written > 0 && out[written-1] == '\n') written--;
    out[written] = '\0';
    return written;
}

// uname helper — machine architecture string
#include <sys/utsname.h>

int nm_uname_machine(char* out, int out_len) {
    struct utsname u;
    if (uname(&u) != 0) return -1;
    int n = snprintf(out, out_len, "%s", u.machine);
    return (n >= 0 && n < out_len) ? 0 : -1;
}

int nm_uname_sysname(char* out, int out_len) {
    struct utsname u;
    if (uname(&u) != 0) return -1;
    int n = snprintf(out, out_len, "%s", u.sysname);
    return (n >= 0 && n < out_len) ? 0 : -1;
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

// OpenSSL
#include <openssl/evp.h>
#include <openssl/ssl.h>
#include <openssl/err.h>
#include <fcntl.h>

static SSL_CTX* g_ssl_client_ctx = NULL;

static void nm_ssl_ensure_init(void) {
    if (g_ssl_client_ctx) return;
    g_ssl_client_ctx = SSL_CTX_new(TLS_client_method());
    SSL_CTX_set_default_verify_paths(g_ssl_client_ctx);
    SSL_CTX_set_min_proto_version(g_ssl_client_ctx, TLS1_2_VERSION);
}

// Connect TLS over an already-connected fd. Blocks during handshake.
// Returns SSL* as i64, or 0 on failure.
long long nm_ssl_connect(int fd, const char* hostname) {
    nm_ssl_ensure_init();
    int flags = fcntl(fd, F_GETFL, 0);
    fcntl(fd, F_SETFL, flags & ~O_NONBLOCK);

    SSL* ssl = SSL_new(g_ssl_client_ctx);
    SSL_set_fd(ssl, fd);
    if (hostname && hostname[0]) SSL_set_tlsext_host_name(ssl, hostname);
    int ret = SSL_connect(ssl);

    fcntl(fd, F_SETFL, flags);

    if (ret != 1) {
        SSL_free(ssl);
        return 0;
    }
    return (long long)ssl;
}

// Non-blocking SSL_connect: create SSL, set fd, attempt connect.
// Returns: SSL* if handshake complete, 0 if want_read/want_write (call nm_ssl_connect_continue), -1 on error
long long nm_ssl_connect_start(int fd, const char* hostname) {
    nm_ssl_ensure_init();

    // Verify socket is non-blocking
    int flags = fcntl(fd, F_GETFL, 0);
    if (!(flags & O_NONBLOCK)) {
        fcntl(fd, F_SETFL, flags | O_NONBLOCK);
    }

    SSL* ssl = SSL_new(g_ssl_client_ctx);
    SSL_set_fd(ssl, fd);
    if (hostname && hostname[0]) SSL_set_tlsext_host_name(ssl, hostname);

    // Set connect state and attempt handshake
    SSL_set_connect_state(ssl);
    int ret = SSL_do_handshake(ssl);
    if (ret == 1) return (long long)ssl;
    int err = SSL_get_error(ssl, ret);
    if (err == SSL_ERROR_WANT_READ || err == SSL_ERROR_WANT_WRITE) return (long long)ssl;
    SSL_free(ssl);
    return -1;
}

// Continue non-blocking SSL handshake. Returns: 1=done, 0=want_read/write, -1=error
int nm_ssl_connect_continue(long long ssl_ptr) {
    SSL* ssl = (SSL*)(intptr_t)ssl_ptr;
    int ret = SSL_do_handshake(ssl);
    if (ret == 1) return 1;
    int err = SSL_get_error(ssl, ret);
    if (err == SSL_ERROR_WANT_READ || err == SSL_ERROR_WANT_WRITE) return 0;
    return -1;
}

int nm_ssl_read(long long ssl_ptr, char* buf, int len) {
    SSL* ssl = (SSL*)(intptr_t)ssl_ptr;
    int n = SSL_read(ssl, buf, len);
    if (n <= 0) {
        int err = SSL_get_error(ssl, n);
        if (err == SSL_ERROR_WANT_READ || err == SSL_ERROR_WANT_WRITE) return -2;
        if (err == SSL_ERROR_ZERO_RETURN) return 0;
        return -1;
    }
    return n;
}

int nm_ssl_write(long long ssl_ptr, const char* data, int len) {
    SSL* ssl = (SSL*)(intptr_t)ssl_ptr;
    int n = SSL_write(ssl, data, len);
    if (n <= 0) {
        int err = SSL_get_error(ssl, n);
        if (err == SSL_ERROR_WANT_READ || err == SSL_ERROR_WANT_WRITE) return -2;
        return -1;
    }
    return n;
}

int nm_ssl_pending(long long ssl_ptr) {
    SSL* ssl = (SSL*)(intptr_t)ssl_ptr;
    return SSL_pending(ssl);
}

void nm_ssl_shutdown(long long ssl_ptr) {
    SSL* ssl = (SSL*)(intptr_t)ssl_ptr;
    SSL_shutdown(ssl);
    SSL_free(ssl);
}

// TLS server — create server SSL_CTX with cert+key, accept connections
// Returns SSL_CTX* as i64, or 0 on failure
long long nm_ssl_server_ctx_new(const char* cert_pem, int cert_len,
                                 const char* key_pem, int key_len) {
    SSL_CTX* ctx = SSL_CTX_new(TLS_server_method());
    if (!ctx) return 0;
    SSL_CTX_set_min_proto_version(ctx, TLS1_2_VERSION);

    // Load cert from PEM string
    BIO* cert_bio = BIO_new_mem_buf(cert_pem, cert_len);
    X509* cert = PEM_read_bio_X509(cert_bio, NULL, NULL, NULL);
    BIO_free(cert_bio);
    if (!cert) { SSL_CTX_free(ctx); return 0; }
    if (SSL_CTX_use_certificate(ctx, cert) != 1) { X509_free(cert); SSL_CTX_free(ctx); return 0; }
    X509_free(cert);

    // Load private key from PEM string
    BIO* key_bio = BIO_new_mem_buf(key_pem, key_len);
    EVP_PKEY* pkey = PEM_read_bio_PrivateKey(key_bio, NULL, NULL, NULL);
    BIO_free(key_bio);
    if (!pkey) { SSL_CTX_free(ctx); return 0; }
    if (SSL_CTX_use_PrivateKey(ctx, pkey) != 1) { EVP_PKEY_free(pkey); SSL_CTX_free(ctx); return 0; }
    EVP_PKEY_free(pkey);

    return (long long)ctx;
}

// Accept TLS on an already-accepted fd. Blocks briefly during handshake.
// Returns SSL* as i64, or 0 on failure.
long long nm_ssl_accept(long long ctx_ptr, int fd) {
    SSL_CTX* ctx = (SSL_CTX*)(intptr_t)ctx_ptr;

    // Temporarily set blocking for handshake
    int flags = fcntl(fd, F_GETFL, 0);
    fcntl(fd, F_SETFL, flags & ~O_NONBLOCK);

    SSL* ssl = SSL_new(ctx);
    SSL_set_fd(ssl, fd);
    int ret = SSL_accept(ssl);

    // Restore non-blocking
    fcntl(fd, F_SETFL, flags);

    if (ret != 1) {
        SSL_free(ssl);
        return 0;
    }
    return (long long)ssl;
}

// Create SSL object for deferred accept (non-blocking first step)
// Returns SSL* as i64. Caller should poll for readability and call nm_ssl_accept_continue.
long long nm_ssl_accept_new(long long ctx_ptr, int fd) {
    SSL_CTX* ctx = (SSL_CTX*)(intptr_t)ctx_ptr;
    // Ensure non-blocking
    int flags = fcntl(fd, F_GETFL, 0);
    if (!(flags & O_NONBLOCK)) {
        fcntl(fd, F_SETFL, flags | O_NONBLOCK);
    }
    SSL* ssl = SSL_new(ctx);
    SSL_set_fd(ssl, fd);
    SSL_set_accept_state(ssl);
    return (long long)ssl;
}

// Continue SSL handshake (accept side). Returns: 1=done, 0=want_read/want_write, -1=error
int nm_ssl_accept_continue(long long ssl_ptr) {
    SSL* ssl = (SSL*)(intptr_t)ssl_ptr;
    int ret = SSL_do_handshake(ssl);
    if (ret == 1) return 1;
    int err = SSL_get_error(ssl, ret);
    if (err == SSL_ERROR_WANT_READ || err == SSL_ERROR_WANT_WRITE) return 0;
    return -1;
}

void nm_ssl_ctx_free(long long ctx_ptr) {
    SSL_CTX* ctx = (SSL_CTX*)(intptr_t)ctx_ptr;
    if (ctx) SSL_CTX_free(ctx);
}

// RSA/ECDSA signing/verification via OpenSSL EVP
#include <openssl/pem.h>
#include <openssl/rsa.h>

// Sign data with a PEM private key. Returns signature length, -1 on error.
int nm_sign(const char* algorithm, const char* pem_key, int pem_len,
            const unsigned char* data, int data_len,
            unsigned char* sig_out, int sig_out_len) {
    const EVP_MD* md = EVP_get_digestbyname(algorithm);
    if (!md) return -1;

    BIO* bio = BIO_new_mem_buf(pem_key, pem_len);
    if (!bio) return -1;
    EVP_PKEY* pkey = PEM_read_bio_PrivateKey(bio, NULL, NULL, NULL);
    BIO_free(bio);
    if (!pkey) return -1;

    EVP_MD_CTX* ctx = EVP_MD_CTX_new();
    size_t siglen = sig_out_len;
    int ok = 1;
    if (EVP_DigestSignInit(ctx, NULL, md, NULL, pkey) != 1) ok = 0;
    if (ok && EVP_DigestSignUpdate(ctx, data, data_len) != 1) ok = 0;
    if (ok && EVP_DigestSignFinal(ctx, sig_out, &siglen) != 1) ok = 0;
    EVP_MD_CTX_free(ctx);
    EVP_PKEY_free(pkey);
    return ok ? (int)siglen : -1;
}

// Verify signature with a PEM public key (or cert). Returns 1 if valid, 0 if invalid, -1 on error.
int nm_verify(const char* algorithm, const char* pem_key, int pem_len,
              const unsigned char* data, int data_len,
              const unsigned char* sig, int sig_len) {
    const EVP_MD* md = EVP_get_digestbyname(algorithm);
    if (!md) return -1;

    BIO* bio = BIO_new_mem_buf(pem_key, pem_len);
    if (!bio) return -1;
    EVP_PKEY* pkey = PEM_read_bio_PUBKEY(bio, NULL, NULL, NULL);
    if (!pkey) {
        BIO_reset(bio);
        pkey = PEM_read_bio_PrivateKey(bio, NULL, NULL, NULL);
    }
    BIO_free(bio);
    if (!pkey) return -1;

    EVP_MD_CTX* ctx = EVP_MD_CTX_new();
    int ok = 1;
    if (EVP_DigestVerifyInit(ctx, NULL, md, NULL, pkey) != 1) ok = 0;
    if (ok && EVP_DigestVerifyUpdate(ctx, data, data_len) != 1) ok = 0;
    int result = ok ? EVP_DigestVerifyFinal(ctx, sig, sig_len) : -1;
    EVP_MD_CTX_free(ctx);
    EVP_PKEY_free(pkey);
    return result;
}

// Generate RSA key pair. Returns 0 on success, -1 on error.
int nm_generate_rsa_keypair(int bits, char* pub_out, int pub_len, int* pub_written,
                             char* priv_out, int priv_len, int* priv_written) {
    EVP_PKEY_CTX* ctx = EVP_PKEY_CTX_new_id(EVP_PKEY_RSA, NULL);
    if (!ctx) return -1;
    if (EVP_PKEY_keygen_init(ctx) != 1) { EVP_PKEY_CTX_free(ctx); return -1; }
    if (EVP_PKEY_CTX_set_rsa_keygen_bits(ctx, bits) != 1) { EVP_PKEY_CTX_free(ctx); return -1; }
    EVP_PKEY* pkey = NULL;
    if (EVP_PKEY_keygen(ctx, &pkey) != 1) { EVP_PKEY_CTX_free(ctx); return -1; }
    EVP_PKEY_CTX_free(ctx);

    BIO* pub_bio = BIO_new(BIO_s_mem());
    PEM_write_bio_PUBKEY(pub_bio, pkey);
    int plen = BIO_read(pub_bio, pub_out, pub_len);
    *pub_written = plen > 0 ? plen : 0;
    BIO_free(pub_bio);

    BIO* priv_bio = BIO_new(BIO_s_mem());
    PEM_write_bio_PrivateKey(priv_bio, pkey, NULL, NULL, 0, NULL, NULL);
    int klen = BIO_read(priv_bio, priv_out, priv_len);
    *priv_written = klen > 0 ? klen : 0;
    BIO_free(priv_bio);

    EVP_PKEY_free(pkey);
    return 0;
}

// ECDSA key generation — curve is NID name string (e.g. "prime256v1", "secp384r1", "secp521r1")
#include <openssl/ec.h>
#include <openssl/obj_mac.h>
int nm_generate_ec_keypair(const char* curve_name,
                           char* pub_out, int pub_len, int* pub_written,
                           char* priv_out, int priv_len, int* priv_written) {
    int nid = OBJ_txt2nid(curve_name);
    if (nid == NID_undef) return -1;

    EVP_PKEY_CTX* pctx = EVP_PKEY_CTX_new_id(EVP_PKEY_EC, NULL);
    if (!pctx) return -1;
    if (EVP_PKEY_keygen_init(pctx) != 1) { EVP_PKEY_CTX_free(pctx); return -1; }
    if (EVP_PKEY_CTX_set_ec_paramgen_curve_nid(pctx, nid) != 1) { EVP_PKEY_CTX_free(pctx); return -1; }

    EVP_PKEY* pkey = NULL;
    if (EVP_PKEY_keygen(pctx, &pkey) != 1) { EVP_PKEY_CTX_free(pctx); return -1; }
    EVP_PKEY_CTX_free(pctx);

    BIO* pub_bio = BIO_new(BIO_s_mem());
    PEM_write_bio_PUBKEY(pub_bio, pkey);
    int plen = BIO_read(pub_bio, pub_out, pub_len);
    *pub_written = plen > 0 ? plen : 0;
    BIO_free(pub_bio);

    BIO* priv_bio = BIO_new(BIO_s_mem());
    PEM_write_bio_PrivateKey(priv_bio, pkey, NULL, NULL, 0, NULL, NULL);
    int klen = BIO_read(priv_bio, priv_out, priv_len);
    *priv_written = klen > 0 ? klen : 0;
    BIO_free(priv_bio);

    EVP_PKEY_free(pkey);
    return 0;
}

// AES-GCM via OpenSSL EVP

int nm_aes_gcm_crypt(int encrypt,
                      const unsigned char* key, int key_len,
                      const unsigned char* iv, int iv_len,
                      const unsigned char* aad, int aad_len,
                      const unsigned char* input, int input_len,
                      unsigned char* output,
                      unsigned char* tag_buf, int tag_len) {
    const EVP_CIPHER* cipher = NULL;
    if (key_len == 16) cipher = EVP_aes_128_gcm();
    else if (key_len == 24) cipher = EVP_aes_192_gcm();
    else if (key_len == 32) cipher = EVP_aes_256_gcm();
    else return -1;

    EVP_CIPHER_CTX* ctx = EVP_CIPHER_CTX_new();
    if (!ctx) return -1;
    int outlen = 0, tmplen = 0;

    if (encrypt) {
        if (EVP_EncryptInit_ex(ctx, cipher, NULL, NULL, NULL) != 1) goto fail;
        if (EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_GCM_SET_IVLEN, iv_len, NULL) != 1) goto fail;
        if (EVP_EncryptInit_ex(ctx, NULL, NULL, key, iv) != 1) goto fail;
        if (aad && aad_len > 0) {
            if (EVP_EncryptUpdate(ctx, NULL, &tmplen, aad, aad_len) != 1) goto fail;
        }
        if (EVP_EncryptUpdate(ctx, output, &outlen, input, input_len) != 1) goto fail;
        if (EVP_EncryptFinal_ex(ctx, output + outlen, &tmplen) != 1) goto fail;
        if (EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_GCM_GET_TAG, tag_len, tag_buf) != 1) goto fail;
    } else {
        if (EVP_DecryptInit_ex(ctx, cipher, NULL, NULL, NULL) != 1) goto fail;
        if (EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_GCM_SET_IVLEN, iv_len, NULL) != 1) goto fail;
        if (EVP_DecryptInit_ex(ctx, NULL, NULL, key, iv) != 1) goto fail;
        if (aad && aad_len > 0) {
            if (EVP_DecryptUpdate(ctx, NULL, &tmplen, aad, aad_len) != 1) goto fail;
        }
        if (EVP_DecryptUpdate(ctx, output, &outlen, input, input_len) != 1) goto fail;
        // Set expected tag before final
        if (EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_GCM_SET_TAG, tag_len, (void*)tag_buf) != 1) goto fail;
        if (EVP_DecryptFinal_ex(ctx, output + outlen, &tmplen) != 1) {
            EVP_CIPHER_CTX_free(ctx);
            return 1; // auth tag mismatch
        }
    }
    EVP_CIPHER_CTX_free(ctx);
    return 0;
fail:
    EVP_CIPHER_CTX_free(ctx);
    return -2;
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

// Returns: >=0 = complete bytes (Z_STREAM_END), <-1 = truncated (bytes = -(ret+1)), -1 = failure
int nm_zlib_inflate(const unsigned char* in, int in_len, unsigned char* out, int out_len, int windowBits) {
    z_stream strm;
    memset(&strm, 0, sizeof(strm));
    if (inflateInit2(&strm, windowBits) != Z_OK) return -1;
    strm.next_in = (unsigned char*)in;
    strm.avail_in = in_len;
    strm.next_out = out;
    strm.avail_out = out_len;
    int ret = inflate(&strm, Z_NO_FLUSH);
    int written = out_len - strm.avail_out;
    inflateEnd(&strm);
    if (ret == Z_STREAM_END) return written;
    // Partial/truncated: return data as negative-encoded
    if (written > 0 && (ret == Z_OK || ret == Z_BUF_ERROR || ret == Z_DATA_ERROR))
        return -(written + 1);
    return -1;
}

int main(int argc, char** argv) {
    return milo_node_main(argc, argv);
}
