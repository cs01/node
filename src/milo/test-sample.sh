#!/bin/zsh
# Sample N random tests from test/parallel/ and report pass/fail rate
# Usage: zsh src/milo/test-sample.sh [N] [timeout_sec] [max_heap_mb]

N="${1:-50}"
TIMEOUT="${2:-10}"
MAX_HEAP="${3:-256}"
NODE="./out/Release/milo-node"
TEST_DIR="test/parallel"

if [ ! -x "$NODE" ]; then
    echo "error: $NODE not found. run build.sh first"
    exit 1
fi

ALL_TESTS=($(find "$TEST_DIR" -maxdepth 1 -name 'test-*.js' | sort))
TOTAL=${#ALL_TESTS[@]}
if [ "$N" -gt "$TOTAL" ]; then N=$TOTAL; fi
SAMPLE=($(printf '%s\n' "${ALL_TESTS[@]}" | sort -R | head -n "$N"))

PASS=0
FAIL=0
TIMEOUT_COUNT=0
OOM_COUNT=0
ERRORS=()

echo "sampling $N / $TOTAL tests (timeout=${TIMEOUT}s, heap=${MAX_HEAP}MB)"
echo ""

run_with_timeout() {
    local cmd="$1"
    local timeout="$2"
    perl -e '
        use POSIX ":sys_wait_h";
        $SIG{ALRM} = sub {
            kill -9, $pid if $pid;
            kill 9, $pid if $pid;
            exit 124;
        };
        alarm $ARGV[1];
        $pid = fork();
        if ($pid == 0) {
            setpgrp(0, 0);
            exec($ARGV[0]);
            exit(127);
        }
        waitpid($pid, 0);
        exit($? >> 8);
    ' "$cmd" "$timeout"
}

I=0
for test in "${SAMPLE[@]}"; do
    I=$((I + 1))
    name=$(basename "$test")
    echo "  ...   [$I/$N] $name"

    # Parse // Flags: header from test file and pass through to milo-node
    FLAGS=$(head -20 "$test" | grep '// Flags:' | sed 's,// Flags:,,' | tr '\n' ' ')
    output=$(run_with_timeout "$NODE --max-old-space-size $MAX_HEAP $FLAGS $test" "$TIMEOUT" 2>&1)
    rc=$?

    # Kill any lingering processes from this test
    pkill -9 -f "$name" 2>/dev/null

    if [ $rc -eq 0 ]; then
        PASS=$((PASS + 1))
        echo "  PASS  [$I/$N] $name"
    elif [ $rc -eq 124 ] || [ $rc -eq 137 ]; then
        TIMEOUT_COUNT=$((TIMEOUT_COUNT + 1))
        FAIL=$((FAIL + 1))
        ERRORS+=("TIMEOUT $name")
        echo "  TIME  [$I/$N] $name"
    elif echo "$output" | grep -aq "out of memory\|OOM\|heap limit"; then
        OOM_COUNT=$((OOM_COUNT + 1))
        FAIL=$((FAIL + 1))
        ERRORS+=("OOM     $name")
        echo "  OOM   [$I/$N] $name"
    else
        FAIL=$((FAIL + 1))
        err=$(echo "$output" | grep -am1 -E 'Error:|TypeError:|ReferenceError:|SyntaxError:|Cannot find|not a function|not defined|FAIL' | head -c 100)
        [ -z "$err" ] && err="exit code $rc"
        ERRORS+=("FAIL    $name — $err")
        echo "  FAIL  [$I/$N] $name — $err"
    fi
done

echo ""
echo "=== results ==="
if [ "$N" -gt 0 ]; then
    RATE=$((PASS * 100 / N))
    echo "pass: $PASS / $N ($RATE%)"
else
    echo "pass: 0 / 0"
fi
echo "fail: $((FAIL - TIMEOUT_COUNT - OOM_COUNT))  timeout: $TIMEOUT_COUNT  oom: $OOM_COUNT"

if [ ${#ERRORS[@]} -gt 0 ]; then
    echo ""
    echo "=== failure summary ==="
    printf '%s\n' "${ERRORS[@]}" | sort
fi
