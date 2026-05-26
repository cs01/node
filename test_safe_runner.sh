#!/bin/bash
# Safe test runner v5 — ulimit + process group isolation
set -o pipefail
MILO_NODE="./out/Release/milo-node"
TEST_DIR="test/parallel"
export NODE_SKIP_FLAG_CHECK=1
FIXED_LIST=""
if [ "$1" = "--file" ]; then
  FIXED_LIST="$2"
  shift 2
fi
SAMPLE_SIZE="${1:-384}"
MAX_SECS="${2:-8}"
MAX_PROCS="${3:-30}"
RESULTS_FILE="/tmp/milo_safe_results_$$.csv"

echo "SAFE TEST RUNNER v5"

SAMPLE_LIST="/tmp/milo_sample_$$.txt"

if [ -n "$FIXED_LIST" ] && [ -f "$FIXED_LIST" ]; then
  cp "$FIXED_LIST" "$SAMPLE_LIST"
  echo "Fixed list: $FIXED_LIST | Timeout: ${MAX_SECS}s | Max procs: $MAX_PROCS"
else
  echo "Sample: $SAMPLE_SIZE | Timeout: ${MAX_SECS}s | Max procs: $MAX_PROCS"
  DANGEROUS=$(grep -rl "child_process\|\.fork(\|cluster\|\.spawn(" "$TEST_DIR"/test-*.js 2>/dev/null)
  SAFE=$(grep -rL "child_process\|\.fork(\|cluster\|\.spawn(" "$TEST_DIR"/test-*.js 2>/dev/null)

  N_D=$(echo "$DANGEROUS" | wc -l | tr -d ' ')
  N_S=$(echo "$SAFE" | wc -l | tr -d ' ')
  TOTAL=$((N_D + N_S))
  SAMP_D=$((SAMPLE_SIZE * N_D / TOTAL))
  SAMP_S=$((SAMPLE_SIZE - SAMP_D))

  {
    echo "$DANGEROUS" | sort -R | head -n "$SAMP_D"
    echo "$SAFE" | sort -R | head -n "$SAMP_S"
  } | sort -R > "$SAMPLE_LIST"
fi

ACTUAL=$(wc -l < "$SAMPLE_LIST" | tr -d ' ')
echo "Pop: $N_D dangerous + $N_S safe = $TOTAL | Sampling: $SAMP_D + $SAMP_S = $ACTUAL"
echo ""

pass=0; fail=0; timeout_count=0; forkbomb=0; total_run=0

echo "test,result,note" > "$RESULTS_FILE"

while IFS= read -r test_file; do
  [ -z "$test_file" ] && continue
  total_run=$((total_run + 1))
  test_name=$(basename "$test_file")
  outfile="/tmp/milo_tout_$$_${total_run}"

  # Run in subshell with ulimit to cap processes, in its own process group
  # The ulimit -u caps total user processes so fork bombs hit EAGAIN fast
  (
    ulimit -u "$MAX_PROCS" 2>/dev/null
    exec "$MILO_NODE" "$test_file" < /dev/null
  ) > "$outfile" 2>&1 &
  pid=$!

  # Watchdog kills after MAX_SECS
  ( sleep "$MAX_SECS"; kill -9 "$pid" 2>/dev/null ) &
  wdog=$!

  wait "$pid" 2>/dev/null
  exit_code=$?

  # Clean up watchdog
  kill "$wdog" 2>/dev/null 2>&1
  wait "$wdog" 2>/dev/null 2>&1

  # Kill any orphaned milo-node processes from this test
  pkill -9 -P "$pid" 2>/dev/null

  # Aggressive fork bomb check — if >20 milo-node procs exist, kill all
  n_milo=$(pgrep -c milo-node 2>/dev/null || echo 0)
  if [ "$n_milo" -gt 20 ]; then
    forkbomb=$((forkbomb + 1))
    result="FORKBOMB"
    note="$n_milo procs detected"
    pkill -9 -f milo-node 2>/dev/null
    sleep 2
    # Double-tap cleanup
    pkill -9 -f milo-node 2>/dev/null
  elif [ $exit_code -eq 137 ] || [ $exit_code -eq 143 ]; then
    timeout_count=$((timeout_count + 1))
    result="TIMEOUT"
    note=""
  elif [ $exit_code -eq 0 ]; then
    pass=$((pass + 1))
    result="PASS"
    note=""
  else
    fail=$((fail + 1))
    result="FAIL"
    note=$(strings "$outfile" 2>/dev/null | grep -m1 -i "error\|assert\|throw\|Cannot\|not defined\|not a function" | cut -c1-120)
  fi

  echo "$test_name,$result,\"$note\"" >> "$RESULTS_FILE"
  rm -f "$outfile"

  if [ $((total_run % 50)) -eq 0 ]; then
    pct=$((total_run * 100 / ACTUAL))
    echo "[$pct%] $total_run/$ACTUAL | P=$pass F=$fail T=$timeout_count FB=$forkbomb"
  fi
done < "$SAMPLE_LIST"

# Final cleanup
pkill -9 -f "milo-node" 2>/dev/null
rm -f "$SAMPLE_LIST"

echo ""
echo "============ RESULTS ============"
echo "Total: $total_run | Pass: $pass | Fail: $fail | Timeout: $timeout_count | Forkbomb: $forkbomb"

if [ $total_run -gt 0 ]; then
  pass_pct=$(echo "scale=1; $pass * 100 / $total_run" | bc)
  p=$(echo "scale=6; $pass / $total_run" | bc)
  se=$(echo "scale=6; sqrt($p * (1 - $p) / $total_run)" | bc)
  lo=$(echo "scale=1; ($p - 1.96 * $se) * 100" | bc)
  hi=$(echo "scale=1; ($p + 1.96 * $se) * 100" | bc)
  echo "Pass rate: ${pass_pct}%"
  echo "95% CI: [${lo}%, ${hi}%]"
fi

echo ""
echo "FAILURE CATEGORIES:"
grep ",FAIL," "$RESULTS_FILE" | sed 's/.*,"//;s/"$//' | sort | uniq -c | sort -rn | head -20

echo ""
echo "TIMEOUTS:"
grep ",TIMEOUT," "$RESULTS_FILE" | awk -F, '{print $1}'

echo ""
echo "FORKBOMBS:"
grep ",FORKBOMB," "$RESULTS_FILE" | awk -F, '{print $1}'

echo ""
echo "Full results: $RESULTS_FILE"
