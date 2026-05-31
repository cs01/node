#!/bin/zsh
# Compare bun vs milo-node on bun's copy of Node.js upstream tests
# Usage: zsh src/milo/test-bun-vs-milo.sh [N] [timeout_sec]

N="${1:-20}"
TIMEOUT="${2:-10}"
BUN_REPO="$HOME/git/bun"
MILO="./out/Release/milo-node"
MILO_REPO="$HOME/git/node"
BUN_TEST_DIR="$BUN_REPO/test/js/node/test/parallel"

if ! command -v bun &>/dev/null; then echo "error: bun not found"; exit 1; fi
if [ ! -x "$MILO_REPO/$MILO" ]; then echo "error: milo-node not found"; exit 1; fi

ALL_TESTS=($(find "$BUN_TEST_DIR" -maxdepth 1 -name 'test-*.js' | sort))
TOTAL=${#ALL_TESTS[@]}
if [ "$N" -gt "$TOTAL" ]; then N=$TOTAL; fi
SAMPLE=($(printf '%s\n' "${ALL_TESTS[@]}" | sort -R | head -n "$N"))

BUN_PASS=0; BUN_FAIL=0
MILO_PASS=0; MILO_FAIL=0; MILO_SKIP=0
BOTH_PASS=0; BUN_ONLY=0; MILO_ONLY=0; BOTH_FAIL=0

echo "comparing bun $(bun --version) vs milo-node on bun's node test suite"
echo "sampling $N / $TOTAL tests (timeout=${TIMEOUT}s)"
echo ""

I=0
for t in "${SAMPLE[@]}"; do
    I=$((I + 1))
    name=$(basename "$t")

    # --- bun ---
    # Match CI: use "bun test" for node:test files, "bun run" otherwise
    if grep -q "node:test" "$t" 2>/dev/null; then
        SUB="test"
    else
        SUB="run"
    fi
    bun_out=$(cd "$BUN_REPO" && timeout "$TIMEOUT" bun $SUB --config=bunfig.node-test.toml "$t" 2>&1)
    bun_rc=$?

    # --- milo ---
    milo_test="$MILO_REPO/test/parallel/$name"
    if [ -f "$milo_test" ]; then
        FLAGS=$(head -20 "$milo_test" | grep '// Flags:' | sed 's,// Flags:,,' | tr '\n' ' ')
        milo_out=$(cd "$MILO_REPO" && timeout "$TIMEOUT" $MILO --max-old-space-size 256 $FLAGS "$milo_test" 2>&1)
        milo_rc=$?
        pkill -9 -f "$name" 2>/dev/null
    else
        milo_rc=999
    fi

    bun_ok=0; milo_ok=0
    if [ $bun_rc -eq 0 ]; then bun_ok=1; BUN_PASS=$((BUN_PASS+1)); else BUN_FAIL=$((BUN_FAIL+1)); fi
    if [ $milo_rc -eq 0 ]; then milo_ok=1; MILO_PASS=$((MILO_PASS+1))
    elif [ $milo_rc -eq 999 ]; then MILO_SKIP=$((MILO_SKIP+1)); MILO_FAIL=$((MILO_FAIL+1))
    else MILO_FAIL=$((MILO_FAIL+1)); fi

    if [ $bun_ok -eq 1 ] && [ $milo_ok -eq 1 ]; then
        BOTH_PASS=$((BOTH_PASS+1)); echo "  BOTH  [$I/$N] $name"
    elif [ $bun_ok -eq 1 ] && [ $milo_ok -eq 0 ]; then
        BUN_ONLY=$((BUN_ONLY+1)); echo "  BUN>  [$I/$N] $name"
    elif [ $bun_ok -eq 0 ] && [ $milo_ok -eq 1 ]; then
        MILO_ONLY=$((MILO_ONLY+1)); echo "  MILO> [$I/$N] $name"
    else
        BOTH_FAIL=$((BOTH_FAIL+1)); echo "  NONE  [$I/$N] $name"
    fi
done

echo ""
echo "=== results ($N tests from bun's node suite) ==="
echo ""
echo "bun:       $BUN_PASS / $N ($((BUN_PASS * 100 / N))%)"
echo "milo-node: $MILO_PASS / $N ($((MILO_PASS * 100 / N))%)  [skip: $MILO_SKIP not in our repo]"
echo ""
echo "both pass: $BOTH_PASS | bun-only: $BUN_ONLY | milo-only: $MILO_ONLY | both fail: $BOTH_FAIL"
