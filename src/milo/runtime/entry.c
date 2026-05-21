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
