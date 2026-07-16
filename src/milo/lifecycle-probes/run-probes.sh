#!/bin/bash
# Event-loop lifecycle probe harness. Each probe must exit 0 on its own (no timeout kill).
# exit 124 = HANG = lifecycle bug. Run: bash src/milo/lifecycle-probes/run-probes.sh
# All probes must pass before AND after any lifecycle change (plus zero net-module regressions).
cd "$(dirname "$0")/../../.."
BIN=./out/Release/milo-node
pass=0; fail=0
for p in src/milo/lifecycle-probes/p*.js; do
  out=$(timeout 5 $BIN "$p" 2>&1); code=$?
  want=$(head -1 "$p" | grep -o 'EXPECT_EXIT=[0-9]*' | cut -d= -f2); want=${want:-0}
  if [ "$code" = "$want" ]; then echo "PASS $p"; pass=$((pass+1));
  else echo "FAIL $p (exit $code, want $want)"; echo "$out" | sed 's/^/       /'; fail=$((fail+1)); fi
done
echo "== $pass pass, $fail fail =="
exit $fail
