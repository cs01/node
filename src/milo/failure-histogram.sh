#!/bin/zsh
# Run the full curated suite, bucket each failure by a normalized root-cause
# signature, and rank buckets by count. Output: signature histogram + per-bucket
# sample tests. This is the "what single fix unblocks the most" map.
#
# Usage: zsh src/milo/failure-histogram.sh [timeout_sec] [module_filter]
TIMEOUT="${1:-8}"
MODULE="${2:-}"
NODE="./out/Release/milo-node"
CURATED="src/milo/bun-curated-tests.txt"
OUT="src/milo/failure-histogram.out"
RAW="/tmp/fh-raw.txt"

if [ -n "$MODULE" ]; then
  TESTS=($(grep "^test-${MODULE}-" "$CURATED" | sed 's|^|test/parallel/|'))
else
  TESTS=($(sed 's|^|test/parallel/|' "$CURATED"))
fi

: > "$RAW"
total=${#TESTS[@]}
i=0; pass=0; fail=0
for t in "${TESTS[@]}"; do
  i=$((i+1))
  [ $((i % 50)) -eq 0 ] && echo "progress: $i/$total  pass=$pass fail=$fail  ($(basename $t))" > /tmp/fh-progress
  [ -f "$t" ] || continue
  out=$(timeout "$TIMEOUT" "$NODE" "$t" 2>&1); rc=$?
  if [ $rc -eq 0 ]; then pass=$((pass+1)); continue; fi
  fail=$((fail+1))
  sig=""
  if [ $rc -eq 124 ]; then
    sig="TIMEOUT"
  elif echo "$out" | grep -q "JavaScript heap out of memory"; then
    sig="OOM"
  else
    # First meaningful error line.
    line=$(echo "$out" | grep -m1 -E "Error|not a function|not a constructor|is not defined|Cannot read|Cannot set|Missing expected|!==|SyntaxError|Mismatched|expected" | head -1)
    case "$line" in
      *"Missing expected exception"*) sig="ASSERT: Missing expected exception (validation/error-code gap)";;
      *"is not a function"*) sig="MISSING_FN: $(echo "$line" | grep -oE '[A-Za-z_.$]+ is not a function' | head -1)";;
      *"is not a constructor"*) sig="MISSING_CTOR: $(echo "$line" | grep -oE '[A-Za-z_.$]+ is not a constructor' | head -1)";;
      *"is not defined"*) sig="MISSING_GLOBAL: $(echo "$line" | grep -oE '[A-Za-z_.$]+ is not defined' | head -1)";;
      *"Cannot read properties of undefined"*) sig="NULL_DEREF: read of undefined";;
      *"Cannot read properties of null"*) sig="NULL_DEREF: read of null";;
      *"Cannot set property"*) sig="GETTER_ONLY: $(echo "$line" | grep -oE "Cannot set propert[a-z]* [A-Za-z_.$]+" | head -1)";;
      *"SyntaxError"*) sig="SYNTAX_ERROR: $(echo "$line" | grep -oE 'Unexpected token.*' | head -c 40)";;
      *"Mismatched"*) sig="MUSTCALL: handler not invoked (event/callback not firing)";;
      *"code:"*) sig="ASSERT: error-code mismatch";;
      *"!=="*) sig="ASSERT: value mismatch (behavior diff)";;
      *"AssertionError"*) sig="ASSERT: other AssertionError";;
      *"Error"*) sig="ERROR: $(echo "$line" | sed -E 's/[0-9]+//g; s|/[^ ]+||g' | head -c 50)";;
      *) sig="OTHER: exit $rc";;
    esac
  fi
  # module = 2nd dash-segment
  mod=$(basename "$t" | sed -E 's/^test-([a-z0-9]+)-.*/\1/')
  echo "$sig\t$mod\t$(basename $t)" >> "$RAW"
done

{
echo "=== FAILURE HISTOGRAM (timeout=${TIMEOUT}s) ==="
echo "tests=$total pass=$pass fail=$fail"
echo ""
echo "=== ROOT-CAUSE BUCKETS (count | signature) ==="
cut -f1 "$RAW" | sort | uniq -c | sort -rn
echo ""
echo "=== TOP 15 BUCKETS — sample tests + module spread ==="
for s in $(cut -f1 "$RAW" | sort | uniq -c | sort -rn | head -15 | sed -E 's/^ *[0-9]+ //'); do :; done
} > "$OUT"
# detailed per-bucket samples
{
echo ""
echo "=== PER-BUCKET DETAIL (top 20) ==="
cut -f1 "$RAW" | sort | uniq -c | sort -rn | head -20 | while read -r cnt sig; do
  # rebuild full signature line (uniq -c left it after count)
  full=$(echo "$cnt $sig" | sed -E 's/^[0-9]+ //')
  mods=$(grep -F "$(printf '%s\t' "$full")" "$RAW" | cut -f2 | sort | uniq -c | sort -rn | head -5 | tr '\n' ' ')
  samples=$(grep -F "$(printf '%s\t' "$full")" "$RAW" | head -3 | cut -f3 | tr '\n' ' ')
  echo "[$cnt] $full"
  echo "      modules: $mods"
  echo "      e.g.: $samples"
done
} >> "$OUT"
cat "$OUT"
