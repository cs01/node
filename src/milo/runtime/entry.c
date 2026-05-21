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

int main(int argc, char** argv) {
    return milo_node_main(argc, argv);
}
