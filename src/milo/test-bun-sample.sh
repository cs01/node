#!/bin/zsh
# Run same Node.js test suite against bun for comparison
# Usage: zsh src/milo/test-bun-sample.sh [N] [timeout_sec] [seed_file]

N="${1:-200}"
TIMEOUT="${2:-10}"
SEED_FILE="${3:-}"
BUN="bun"
TEST_DIR="test/parallel"

if ! command -v bun &>/dev/null; then
    echo "error: bun not found"
    exit 1
fi

ALL_TESTS=($(find "$TEST_DIR" -maxdepth 1 -name 'test-*.js' | sort))
TOTAL=${#ALL_TESTS[@]}
if [ "$N" -gt "$TOTAL" ]; then N=$TOTAL; fi

if [ -n "$SEED_FILE" ] && [ -f "$SEED_FILE" ]; then
    SAMPLE=($(head -n "$N" "$SEED_FILE"))
else
    SAMPLE=($(printf '%s\n' "${ALL_TESTS[@]}" | sort -R | head -n "$N"))
    # Save for reproducibility
    printf '%s\n' "${SAMPLE[@]}" > /tmp/node-test-sample.txt
fi

PASS=0
FAIL=0
TIMEOUT_COUNT=0
ERRORS=()

echo "bun ${$(bun --version)} — sampling $N / $TOTAL tests (timeout=${TIMEOUT}s)"
echo ""

I=0
for test in "${SAMPLE[@]}"; do
    I=$((I + 1))
    name=$(basename "$test")

    output=$(timeout "$TIMEOUT" "$BUN" run "$test" 2>&1)
    rc=$?

    if [ $rc -eq 0 ]; then
        PASS=$((PASS + 1))
        echo "  PASS  [$I/$N] $name"
    elif [ $rc -eq 124 ] || [ $rc -eq 137 ]; then
        TIMEOUT_COUNT=$((TIMEOUT_COUNT + 1))
        FAIL=$((FAIL + 1))
        ERRORS+=("TIMEOUT $name")
        echo "  TIME  [$I/$N] $name"
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
echo "fail: $((FAIL - TIMEOUT_COUNT))  timeout: $TIMEOUT_COUNT"

if [ ${#ERRORS[@]} -gt 0 ]; then
    echo ""
    echo "=== failure summary ==="
    printf '%s\n' "${ERRORS[@]}" | sort
fi
