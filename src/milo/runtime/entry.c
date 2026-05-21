// C entry point — bridges CRT main to Milo's entry function
// Milo's codegen adds implicit params before user params, so we can't
// use Milo's main directly as the CRT entry point.

#include <unistd.h>

extern int milo_node_main(int argc, char** argv);
extern char **environ;

char** environ_get(void) { return environ; }

int main(int argc, char** argv) {
    return milo_node_main(argc, argv);
}
