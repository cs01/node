#!/bin/bash
# Build milo-node — compiles Milo sources, C helpers, and links against V8
set -e

MILO_DIR="${MILO_DIR:-$HOME/git/milo}"
NODE_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$NODE_DIR/out/Release"
JOBS="${JOBS:-8}"

# Generate version.milo with embedded git hash and commit date
GIT_HASH=$(cd "$NODE_DIR" && git rev-parse --short HEAD 2>/dev/null || echo "unknown")
GIT_DATE=$(cd "$NODE_DIR" && git log -1 --format=%cs 2>/dev/null || echo "unknown")
VERSION_FILE="$NODE_DIR/src/milo/runtime/version.milo"
VERSION_CONTENT="fn miloNodeVersion(): string {
    return \"0.1.0+${GIT_HASH}\"
}

fn miloBuildDate(): string {
    return \"${GIT_DATE}\"
}"
if [ ! -f "$VERSION_FILE" ] || [ "$(cat "$VERSION_FILE")" != "$VERSION_CONTENT" ]; then
    echo "$VERSION_CONTENT" > "$VERSION_FILE"
fi

# needs_rebuild: skip if .o is newer than .milo source
needs_rebuild() {
    local src="$1" obj="$2"
    [ ! -f "$obj" ] || [ "$src" -nt "$obj" ]
}

# Compile one Milo file if changed
compile_milo() {
    local src="$1" obj="$2" label="$3"
    if needs_rebuild "$src" "$obj"; then
        cd "$MILO_DIR"
        bun src/main.ts emit-obj --no-entry "$src" -o "$obj"
        cd "$NODE_DIR"
    fi
}

MILO_SOURCES=(
    "src/milo/runtime/version.milo:milo_version"
    "src/milo/runtime/main.milo:milo_main"
    "src/milo/runtime/binding_registry.milo:milo_binding_registry"
    "src/milo/v8/v8.milo:milo_v8"
    "src/milo/bindings/os.milo:milo_os"
    "src/milo/bindings/env.milo:milo_env"
    "src/milo/bindings/process.milo:milo_process"
    "src/milo/bindings/fs.milo:milo_fs"
    "src/milo/bindings/util.milo:milo_util"
    "src/milo/bindings/buffer.milo:milo_buffer"
    "src/milo/bindings/timers.milo:milo_timers"
    "src/milo/bindings/tcp.milo:milo_tcp"
    "src/milo/bindings/crypto.milo:milo_crypto"
    "src/milo/bindings/spawn.milo:milo_spawn"
    "src/milo/bindings/dns.milo:milo_dns"
    "src/milo/bindings/zlib.milo:milo_zlib"
    "src/milo/bindings/vm.milo:milo_vm"
)

echo "=== compiling milo sources ==="
PIDS=()
RUNNING=0
for entry in "${MILO_SOURCES[@]}"; do
    src="${entry%%:*}"
    name="${entry##*:}"
    if needs_rebuild "$NODE_DIR/$src" "$OUT/${name}.o"; then
        (
            cd "$MILO_DIR"
            bun src/main.ts emit-obj --no-entry "$NODE_DIR/$src" -o "$OUT/${name}.o"
        ) &
        PIDS+=($!)
        RUNNING=$((RUNNING + 1))
        # Throttle to $JOBS parallel compilations
        if [ "$RUNNING" -ge "$JOBS" ]; then
            wait "${PIDS[0]}"
            PIDS=("${PIDS[@]:1}")
            RUNNING=$((RUNNING - 1))
        fi
    fi
done
# Wait for remaining
for pid in "${PIDS[@]}"; do
    wait "$pid" || exit 1
done

OPENSSL_PREFIX="$(brew --prefix openssl@3 2>/dev/null || echo /opt/homebrew/opt/openssl@3)"

echo "=== compiling c/c++ ==="
# C helpers + v8capi in parallel, incremental
(
    if needs_rebuild "$NODE_DIR/src/milo/runtime/entry.c" "$OUT/entry.o"; then
        clang -c -I"$NODE_DIR/deps/v8/include" -I"$OPENSSL_PREFIX/include" -o "$OUT/entry.o" src/milo/runtime/entry.c
    fi
) &
P1=$!
(
    if needs_rebuild "$NODE_DIR/src/milo/runtime/binding_registry.c" "$OUT/binding_registry_c.o"; then
        clang -c -o "$OUT/binding_registry_c.o" src/milo/runtime/binding_registry.c
    fi
) &
P2=$!
(
    if needs_rebuild "$NODE_DIR/deps/v8capi/src/v8capi.cc" "$OUT/v8capi.o" || \
       needs_rebuild "$NODE_DIR/deps/v8capi/include/v8capi.h" "$OUT/v8capi.o"; then
        clang++ -c -std=c++20 -fno-rtti \
          -I"$NODE_DIR/deps/v8/include" -I"$NODE_DIR/deps/v8capi/include" \
          -o "$OUT/v8capi.o" deps/v8capi/src/v8capi.cc
    fi
) &
P3=$!
wait $P1 $P2 $P3 || exit 1

echo "=== linking milo-node ==="
clang++ -o "$OUT/milo-node" \
  "$OUT/entry.o" \
  "$OUT/binding_registry_c.o" \
  "$OUT/milo_version.o" \
  "$OUT/milo_main.o" \
  "$OUT/milo_binding_registry.o" \
  "$OUT/milo_v8.o" \
  "$OUT/milo_os.o" \
  "$OUT/milo_env.o" \
  "$OUT/milo_process.o" \
  "$OUT/milo_fs.o" \
  "$OUT/milo_util.o" \
  "$OUT/milo_buffer.o" \
  "$OUT/milo_timers.o" \
  "$OUT/milo_tcp.o" \
  "$OUT/milo_crypto.o" \
  "$OUT/milo_spawn.o" \
  "$OUT/milo_dns.o" \
  "$OUT/milo_zlib.o" \
  "$OUT/milo_vm.o" \
  "$OUT/v8capi.o" \
  -L"$OUT" -L"$OUT/gen/release" \
  -lv8_base_without_compiler -lv8_compiler -lv8_libplatform -lv8_libbase \
  -lv8_init -lv8_initializers -lv8_snapshot -lv8_zlib -labseil \
  -lsimdutf -lsimdjson -lnode_crates \
  -licuucx -licui18n -licudata \
  -framework CoreFoundation -framework Security \
  -L"$OPENSSL_PREFIX/lib" -lssl -lcrypto \
  -lc++ -lpthread -ldl -lz -lresolv

echo "=== done: $OUT/milo-node ==="
"$OUT/milo-node" -e "console.log('milo-node ok:', require('path').join('a','b'))"
