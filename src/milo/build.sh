#!/bin/bash
# Build milo-node — compiles Milo sources, C helpers, and links against V8
set -e

MILO_DIR="${MILO_DIR:-$HOME/git/milo}"
NODE_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$NODE_DIR/out/Release"
OBJCOPY="${OBJCOPY:-/opt/homebrew/opt/llvm/bin/llvm-objcopy}"

echo "=== compiling milo sources ==="
cd "$MILO_DIR"
bun src/main.ts emit-obj --no-entry "$NODE_DIR/src/milo/runtime/main.milo" -o "$OUT/milo_main.o"
bun src/main.ts emit-obj --no-entry "$NODE_DIR/src/milo/runtime/binding_registry.milo" -o "$OUT/milo_binding_registry.o"
bun src/main.ts emit-obj --no-entry "$NODE_DIR/src/milo/bindings/os.milo" -o "$OUT/milo_os.o"
bun src/main.ts emit-obj --no-entry "$NODE_DIR/src/milo/bindings/env.milo" -o "$OUT/milo_env.o"
bun src/main.ts emit-obj --no-entry "$NODE_DIR/src/milo/bindings/process.milo" -o "$OUT/milo_process.o"
bun src/main.ts emit-obj --no-entry "$NODE_DIR/src/milo/bindings/fs.milo" -o "$OUT/milo_fs.o"
cd "$NODE_DIR"

echo "=== compiling c helpers ==="
clang -c -I"$NODE_DIR/deps/v8/include" -o "$OUT/entry.o" src/milo/runtime/entry.c
clang -c -o "$OUT/binding_registry_c.o" src/milo/runtime/binding_registry.c

echo "=== compiling v8capi ==="
clang++ -c -std=c++20 \
  -I"$NODE_DIR/deps/v8/include" -I"$NODE_DIR/deps/v8capi/include" \
  -o "$OUT/v8capi.o" deps/v8capi/src/v8capi.cc

echo "=== localizing milo prelude duplicates ==="
# Milo emits prelude symbols into every .o (needs linkonce_odr fix in compiler)
# Workaround: localize them in all but main.o
LOCALIZE_FLAGS=(
  --localize-symbol=_charIsAlpha --localize-symbol=_charIsAlphanumeric
  --localize-symbol=_charIsDigit --localize-symbol=_charIsWhitespace
  --localize-symbol=_strCharAt --localize-symbol=_strContains
  --localize-symbol=_strEndsWith --localize-symbol=_strIndexOf
  --localize-symbol=_strIndexOfFrom --localize-symbol=_strIsEmpty
  --localize-symbol=_strLastIndexOf --localize-symbol=_strPadEnd
  --localize-symbol=_strPadStart --localize-symbol=_strParseInt
  --localize-symbol=_strRepeat --localize-symbol=_strReplace
  --localize-symbol=_strReplaceFirst --localize-symbol=_strReverse
  --localize-symbol=_strSplit --localize-symbol=_strSplitWhitespace
  --localize-symbol=_strSplitWords --localize-symbol=_strStartsWith
  --localize-symbol=_strToLower --localize-symbol=_strToUpper
  --localize-symbol=_strTrim --localize-symbol=_strTrimEnd
  --localize-symbol=_strTrimStart --localize-symbol=_trim
  --localize-symbol=_vecJoin
  --localize-symbol=_set_method --localize-symbol=_setMethod
  --localize-symbol=_arg_i32 --localize-symbol=_argI32
  --localize-symbol=_getStringArg --localize-symbol=_getIntArg
)
for f in "$OUT"/milo_binding_registry.o "$OUT"/milo_os.o "$OUT"/milo_env.o "$OUT"/milo_process.o "$OUT"/milo_fs.o; do
  "$OBJCOPY" "${LOCALIZE_FLAGS[@]}" "$f"
done

echo "=== linking milo-node ==="
clang++ -o "$OUT/milo-node" \
  "$OUT/entry.o" \
  "$OUT/binding_registry_c.o" \
  "$OUT/milo_main.o" \
  "$OUT/milo_binding_registry.o" \
  "$OUT/milo_os.o" \
  "$OUT/milo_env.o" \
  "$OUT/milo_process.o" \
  "$OUT/milo_fs.o" \
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
