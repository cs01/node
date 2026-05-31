#!/bin/zsh
# Run milo-node against bun's curated Node.js test subset
# This is the "compat scoreboard" — tests that bun targets as their Node compat benchmark
# Usage: zsh src/milo/test-compat.sh [N|all] [timeout_sec] [module_filter]
#
# Examples:
#   zsh src/milo/test-compat.sh 200          # random 200 from curated set
#   zsh src/milo/test-compat.sh all           # full 2143 tests
#   zsh src/milo/test-compat.sh all 10 http   # all http tests
#   zsh src/milo/test-compat.sh all 10 stream # all stream tests

N="${1:-200}"
TIMEOUT="${2:-10}"
MODULE_FILTER="${3:-}"
MAX_HEAP="${4:-256}"
NODE="./out/Release/milo-node"
CURATED="src/milo/bun-curated-tests.txt"

if [ ! -x "$NODE" ]; then echo "error: $NODE not found. run build.sh first"; exit 1; fi
if [ ! -f "$CURATED" ]; then echo "error: $CURATED not found"; exit 1; fi

if [ -n "$MODULE_FILTER" ]; then
    ALL_TESTS=($(grep "^test-${MODULE_FILTER}-" "$CURATED" | sed 's|^|test/parallel/|'))
else
    ALL_TESTS=($(sed 's|^|test/parallel/|' "$CURATED"))
fi

TOTAL=${#ALL_TESTS[@]}
if [ "$N" = "all" ]; then
    N=$TOTAL
    SAMPLE=("${ALL_TESTS[@]}")
else
    N=$((N > TOTAL ? TOTAL : N))
    SAMPLE=($(printf '%s\n' "${ALL_TESTS[@]}" | sort -R | head -n "$N"))
fi

PASS=0; FAIL=0; TIMEOUT_COUNT=0; OOM_COUNT=0; SKIP=0
ERRORS=()
declare -A MOD_PASS MOD_FAIL

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

echo "milo-node compat scoreboard (bun's curated subset)"
if [ -n "$MODULE_FILTER" ]; then
    echo "filter: $MODULE_FILTER"
fi
echo "sampling $N / $TOTAL tests (timeout=${TIMEOUT}s, heap=${MAX_HEAP}MB)"
echo ""

I=0
for test in "${SAMPLE[@]}"; do
    I=$((I + 1))
    name=$(basename "$test")

    if [ ! -f "$test" ]; then
        SKIP=$((SKIP + 1))
        continue
    fi

    # Extract module name for per-module stats (handles http2, stream2, etc.)
    mod=$(echo "$name" | sed 's/^test-\([a-z_]*[a-z0-9]*\)-.*/\1/')

    FLAGS=$(head -20 "$test" | grep '// Flags:' | sed 's,// Flags:,,' | tr '\n' ' ')
    output=$(run_with_timeout "$NODE --max-old-space-size $MAX_HEAP $FLAGS $test" "$TIMEOUT" 2>&1)
    rc=$?
    pkill -9 -f "$name" 2>/dev/null

    if [ $rc -eq 0 ]; then
        PASS=$((PASS + 1))
        MOD_PASS[$mod]=$(( ${MOD_PASS[$mod]:-0} + 1 ))
        echo "  PASS  [$I/$N] $name"
    elif [ $rc -eq 124 ] || [ $rc -eq 137 ]; then
        TIMEOUT_COUNT=$((TIMEOUT_COUNT + 1))
        FAIL=$((FAIL + 1))
        MOD_FAIL[$mod]=$(( ${MOD_FAIL[$mod]:-0} + 1 ))
        ERRORS+=("TIMEOUT $name")
        echo "  TIME  [$I/$N] $name"
    elif echo "$output" | grep -aq "out of memory\|OOM\|heap limit"; then
        OOM_COUNT=$((OOM_COUNT + 1))
        FAIL=$((FAIL + 1))
        MOD_FAIL[$mod]=$(( ${MOD_FAIL[$mod]:-0} + 1 ))
        ERRORS+=("OOM     $name")
        echo "  OOM   [$I/$N] $name"
    else
        FAIL=$((FAIL + 1))
        MOD_FAIL[$mod]=$(( ${MOD_FAIL[$mod]:-0} + 1 ))
        err=$(echo "$output" | grep -am1 -E 'Error:|TypeError:|ReferenceError:|SyntaxError:|Cannot find|not a function|not defined|FAIL' | head -c 100)
        [ -z "$err" ] && err="exit code $rc"
        ERRORS+=("FAIL    $name — $err")
        echo "  FAIL  [$I/$N] $name — $err"
    fi
done

echo ""
echo "=== results (milo-node vs bun's curated ${TOTAL} tests) ==="
RUN=$((PASS + FAIL))
if [ "$RUN" -gt 0 ]; then
    RATE=$((PASS * 100 / RUN))
    echo "pass: $PASS / $RUN ($RATE%)"
else
    echo "pass: 0 / 0"
fi
echo "fail: $((FAIL - TIMEOUT_COUNT - OOM_COUNT))  timeout: $TIMEOUT_COUNT  oom: $OOM_COUNT  skip: $SKIP"

# Per-module breakdown
ALL_MODS=()
for k in "${(@k)MOD_PASS}"; do ALL_MODS+=("$k"); done
for k in "${(@k)MOD_FAIL}"; do
    if [[ ! " ${ALL_MODS[*]} " =~ " $k " ]]; then ALL_MODS+=("$k"); fi
done

if [ ${#ALL_MODS[@]} -gt 1 ]; then
    echo ""
    echo "=== per-module breakdown ==="
    printf "%-20s %5s %5s %5s\n" "module" "pass" "fail" "rate"
    for mod in $(printf '%s\n' "${ALL_MODS[@]}" | sort); do
        p=${MOD_PASS[$mod]:-0}
        f=${MOD_FAIL[$mod]:-0}
        t=$((p + f))
        if [ $t -gt 0 ]; then
            r=$((p * 100 / t))
            printf "%-20s %5d %5d %4d%%\n" "$mod" "$p" "$f" "$r"
        fi
    done
fi

if [ ${#ERRORS[@]} -gt 0 ]; then
    echo ""
    echo "=== failure summary ==="
    printf '%s\n' "${ERRORS[@]}" | sort
fi
