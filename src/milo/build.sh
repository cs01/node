#!/bin/bash
# Build milo-node — compiles Milo sources, C helpers, and links against V8
set -e

MILO_DIR="${MILO_DIR:-$HOME/git/milo}"
NODE_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$NODE_DIR/out/Release"

echo "=== compiling milo sources ==="
cd "$MILO_DIR"
bun src/main.ts emit-obj --no-entry "$NODE_DIR/src/milo/runtime/main.milo" -o "$OUT/milo_main.o"
bun src/main.ts emit-obj --no-entry "$NODE_DIR/src/milo/runtime/binding_registry.milo" -o "$OUT/milo_binding_registry.o"
bun src/main.ts emit-obj --no-entry "$NODE_DIR/src/milo/bindings/helpers.milo" -o "$OUT/milo_helpers.o"
bun src/main.ts emit-obj --no-entry "$NODE_DIR/src/milo/bindings/os.milo" -o "$OUT/milo_os.o"
bun src/main.ts emit-obj --no-entry "$NODE_DIR/src/milo/bindings/env.milo" -o "$OUT/milo_env.o"
bun src/main.ts emit-obj --no-entry "$NODE_DIR/src/milo/bindings/process.milo" -o "$OUT/milo_process.o"
bun src/main.ts emit-obj --no-entry "$NODE_DIR/src/milo/bindings/fs.milo" -o "$OUT/milo_fs.o"
bun src/main.ts emit-obj --no-entry "$NODE_DIR/src/milo/bindings/util.milo" -o "$OUT/milo_util.o"
bun src/main.ts emit-obj --no-entry "$NODE_DIR/src/milo/bindings/buffer.milo" -o "$OUT/milo_buffer.o"
cd "$NODE_DIR"

echo "=== compiling c helpers ==="
clang -c -I"$NODE_DIR/deps/v8/include" -o "$OUT/entry.o" src/milo/runtime/entry.c
clang -c -o "$OUT/binding_registry_c.o" src/milo/runtime/binding_registry.c

echo "=== compiling v8capi ==="
clang++ -c -std=c++20 \
  -I"$NODE_DIR/deps/v8/include" -I"$NODE_DIR/deps/v8capi/include" \
  -o "$OUT/v8capi.o" deps/v8capi/src/v8capi.cc

echo "=== linking milo-node ==="
clang++ -o "$OUT/milo-node" \
  "$OUT/entry.o" \
  "$OUT/binding_registry_c.o" \
  "$OUT/milo_main.o" \
  "$OUT/milo_binding_registry.o" \
  "$OUT/milo_helpers.o" \
  "$OUT/milo_os.o" \
  "$OUT/milo_env.o" \
  "$OUT/milo_process.o" \
  "$OUT/milo_fs.o" \
  "$OUT/milo_util.o" \
  "$OUT/milo_buffer.o" \
  "$OUT/v8capi.o" \
  -L"$OUT" -L"$OUT/gen/release" \
  -lv8_base_without_compiler -lv8_compiler -lv8_libplatform -lv8_libbase \
  -lv8_init -lv8_initializers -lv8_snapshot -lv8_zlib -labseil \
  -lsimdutf -lsimdjson -lnode_crates \
  -licuucx -licui18n -licudata \
  -framework CoreFoundation -framework Security \
  -lc++ -lpthread -ldl

echo "=== done: $OUT/milo-node ==="
"$OUT/milo-node" -e "console.log('milo-node ok:', require('path').join('a','b'))"
