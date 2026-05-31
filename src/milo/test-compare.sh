#!/bin/zsh
# Compare bun vs milo-node on same random sample of Node.js tests
# Usage: zsh src/milo/test-compare.sh [N] [timeout_sec]

N="${1:-200}"
TIMEOUT="${2:-10}"
MILO="./out/Release/milo-node"
TEST_DIR="test/parallel"
MEM_KB="${MEM_KB:-1048576}"   # 1 GB address-space cap per child
MAX_PROCS="${MAX_PROCS:-64}"  # proc-count cap — stops fork bombs (child_process/cluster tests)

if ! command -v bun &>/dev/null; then echo "error: bun not found"; exit 1; fi
if [ ! -x "$MILO" ]; then echo "error: $MILO not found"; exit 1; fi

ALL_TESTS=($(find "$TEST_DIR" -maxdepth 1 -name 'test-*.js' | sort))
TOTAL=${#ALL_TESTS[@]}
if [ "$N" -gt "$TOTAL" ]; then N=$TOTAL; fi
SAMPLE=($(printf '%s\n' "${ALL_TESTS[@]}" | sort -R | head -n "$N"))

BUN_PASS=0; BUN_FAIL=0; BUN_TIMEOUT=0
MILO_PASS=0; MILO_FAIL=0; MILO_TIMEOUT=0
BOTH_PASS=0; BUN_ONLY=0; MILO_ONLY=0; BOTH_FAIL=0

# perl alarm bounds wall-clock; ulimit caps RAM + proc count so a runaway test
# (native alloc loop, or child_process/cluster fork bomb) can't lock the machine
# before the alarm fires — --max-old-space-size only caps V8 heap, not off-heap/procs.
run_with_timeout() {
    perl -e '
        use POSIX ":sys_wait_h";
        $SIG{ALRM} = sub { kill -9, $pid if $pid; kill 9, $pid if $pid; exit 124; };
        alarm $ARGV[1];
        $pid = fork();
        if ($pid == 0) { setpgrp(0, 0); exec($ARGV[0]); exit(127); }
        waitpid($pid, 0);
        exit($? >> 8);
    ' "$1" "$2"
}

echo "comparing bun $(bun --version) vs milo-node on $N / $TOTAL tests (timeout=${TIMEOUT}s, mem=$((MEM_KB/1024))MB, procs=$MAX_PROCS)"
echo ""

I=0
for test in "${SAMPLE[@]}"; do
    I=$((I + 1))
    name=$(basename "$test")
    FLAGS=$(head -20 "$test" | grep '// Flags:' | sed 's,// Flags:,,' | tr '\n' ' ')

    # Run bun (guarded by subshell ulimits)
    ( ulimit -v "$MEM_KB" 2>/dev/null; ulimit -u "$MAX_PROCS" 2>/dev/null
      exec timeout "$TIMEOUT" bun run "$test" ) >/dev/null 2>&1
    bun_rc=$?

    # Run milo (subshell ulimits + perl alarm + heap cap)
    ( ulimit -v "$MEM_KB" 2>/dev/null; ulimit -u "$MAX_PROCS" 2>/dev/null
      run_with_timeout "$MILO --max-old-space-size 256 $FLAGS $test" "$TIMEOUT" ) >/dev/null 2>&1
    milo_rc=$?
    pkill -9 -f "$name" 2>/dev/null

    bun_ok=0; milo_ok=0
    if [ $bun_rc -eq 0 ]; then bun_ok=1; BUN_PASS=$((BUN_PASS+1)); else BUN_FAIL=$((BUN_FAIL+1)); fi
    if [ $milo_rc -eq 0 ]; then milo_ok=1; MILO_PASS=$((MILO_PASS+1)); else MILO_FAIL=$((MILO_FAIL+1)); fi

    if [ $bun_rc -eq 124 ] || [ $bun_rc -eq 137 ]; then BUN_TIMEOUT=$((BUN_TIMEOUT+1)); fi
    if [ $milo_rc -eq 124 ] || [ $milo_rc -eq 137 ]; then MILO_TIMEOUT=$((MILO_TIMEOUT+1)); fi

    if [ $bun_ok -eq 1 ] && [ $milo_ok -eq 1 ]; then
        BOTH_PASS=$((BOTH_PASS+1));  echo "  BOTH  [$I/$N] $name"
    elif [ $bun_ok -eq 1 ] && [ $milo_ok -eq 0 ]; then
        BUN_ONLY=$((BUN_ONLY+1));    echo "  BUN>  [$I/$N] $name"
    elif [ $bun_ok -eq 0 ] && [ $milo_ok -eq 1 ]; then
        MILO_ONLY=$((MILO_ONLY+1));  echo "  MILO> [$I/$N] $name"
    else
        BOTH_FAIL=$((BOTH_FAIL+1));   echo "  NONE  [$I/$N] $name"
    fi
done

echo ""
echo "=== results ($N tests) ==="
echo ""
BUN_RATE=$((BUN_PASS * 100 / N))
MILO_RATE=$((MILO_PASS * 100 / N))
echo "bun:       $BUN_PASS / $N ($BUN_RATE%)  [timeout: $BUN_TIMEOUT]"
echo "milo-node: $MILO_PASS / $N ($MILO_RATE%)  [timeout: $MILO_TIMEOUT]"
echo ""
echo "both pass: $BOTH_PASS | bun-only: $BUN_ONLY | milo-only: $MILO_ONLY | both fail: $BOTH_FAIL"
echo ""
echo "gap to close: $BUN_ONLY tests where bun passes but milo doesn't"
echo "milo advantage: $MILO_ONLY tests where milo passes but bun doesn't"
