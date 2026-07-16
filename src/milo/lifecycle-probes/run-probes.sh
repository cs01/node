#!/bin/bash
# Event-loop lifecycle probe harness.
#
# EXPECT_EXIT is GROUND TRUTH FROM ./out/Release/node (v27.0.0-pre, built from THIS tree) —
# verify with `ORACLE=1 bash run-probes.sh` or `./out/Release/node <probe>` before changing
# one. Do NOT use the `node` on PATH: it is v25.3.0, this repo is node 27, and version-skewed
# behavior (e.g. node 27's Keep-Alive: timeout=65 default) makes it silently wrong. Several probes are SUPPOSED to hang (EXPECT_EXIT=124): an open handle must
# keep the process alive. 124 here means "still running when the watchdog fired".
#
# MAX_CPU is the assertion that matters. A correct hang and a busy-loop-to-OOM both look like
# "still running"; only CPU time separates them. A sleeping loop burns ~0.05s over a 6s probe;
# a spinning one burns ~6s and then fatal-OOMs. CPU is sampled just BEFORE the kill.
#
# Deliberately does NOT use timeout(1): the `timeout` on this PATH is milo-built and returns
# 124 WITHOUT killing its child. Orphans then keep spinning and write their OOM output into a
# later probe's log, which fakes both OOM failures and CPU readings. We use our own watchdog
# and SIGKILL, and give every probe its own output file.
#
# Run: bash src/milo/lifecycle-probes/run-probes.sh
cd "$(dirname "$0")/../../.."
# ORACLE=1 runs the probes against the repo-built node instead of milo — use it to
# re-derive EXPECT_EXIT values from ground truth.
BIN=${BIN:-./out/Release/milo-node}
[ -n "$ORACLE" ] && BIN=./out/Release/node
WALL=${WALL:-6}
LOGDIR=$(mktemp -d)
trap 'rm -rf "$LOGDIR"' EXIT

# "M:SS.ss" (ps time format) -> seconds
cputime_of() { ps -o time= -p "$1" 2>/dev/null | tr -d ' ' | awk -F: '{if (NF==2) printf "%.2f", $1*60+$2; else printf "0"}'; }

pass=0; fail=0
for p in src/milo/lifecycle-probes/p*.js; do
  name=$(basename "$p"); outf="$LOGDIR/$name.out"
  hdr=$(head -1 "$p")
  want=$(echo "$hdr" | grep -o 'EXPECT_EXIT=[0-9]*' | cut -d= -f2); want=${want:-0}
  maxcpu=$(echo "$hdr" | grep -o 'MAX_CPU=[0-9.]*' | cut -d= -f2); maxcpu=${maxcpu:-2.0}

  "$BIN" "$p" > "$outf" 2>&1 &
  pid=$!
  cpu=0; code=0
  for ((i=0; i<WALL*10; i++)); do kill -0 $pid 2>/dev/null || break; sleep 0.1; done
  if kill -0 $pid 2>/dev/null; then
    cpu=$(cputime_of $pid)          # sample while alive — this is the busy-spin detector
    kill -9 $pid 2>/dev/null; wait $pid 2>/dev/null; code=124
  else
    wait $pid; code=$?
  fi

  why=""
  [ "$code" = "$want" ] || why="exit $code want $want"
  awk "BEGIN{exit !($cpu > $maxcpu)}" && why="${why:+$why; }cpu ${cpu}s > ${maxcpu}s (busy-loop?)"
  grep -q 'out of memory' "$outf" && why="${why:+$why; }FATAL OOM"

  if [ -z "$why" ]; then echo "PASS $name (exit $code, cpu ${cpu}s)"; pass=$((pass+1))
  else echo "FAIL $name — $why"; head -6 "$outf" | sed 's/^/       /'; fail=$((fail+1)); fi
done
echo "== $pass pass, $fail fail =="
exit $fail
