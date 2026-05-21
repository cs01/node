// C entry point — bridges CRT main to Milo's entry function
// Milo's codegen adds implicit params before user params, so we can't
// use Milo's main directly as the CRT entry point.

#include <unistd.h>
#include <sys/types.h>
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
