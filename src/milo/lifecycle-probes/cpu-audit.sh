#!/bin/bash
# cpu-audit.sh — CPU on the SUCCESS path, vs the oracle.
#
# WHY THIS EXISTS: run-probes.sh and the compat runner only look at tests that FAIL. That
# sample can only ever find spins in failing tests. The worst spin in the codebase lived in
# PASSING programs: `setTimeout` with no sockets burned 100% CPU (2.52s vs node's 0.04s) for
# who knows how long, because net._pollOnce returned instantly when no kqueue existed. No
# test covers idle CPU, so nothing caught it. See PLAYBOOK.md 5t.
#
# A program that produces the right answer while burning a core is still broken.
# Usage: bash src/milo/lifecycle-probes/cpu-audit.sh
set -u
cd "$(dirname "$0")/../../.." || exit 1
MILO=./out/Release/milo-node
ORACLE=./out/Release/node   # v27 built from THIS tree — never the `node` on PATH (see PLAYBOOK)
[ -x "$MILO" ] || { echo "no $MILO — run bash src/milo/build.sh"; exit 1; }
[ -x "$ORACLE" ] || { echo "no $ORACLE (the oracle must be built from this tree)"; exit 1; }

D=$(mktemp -d); trap 'rm -rf "$D"' EXIT
mkdir -p "$D/quiet"
cat > "$D/timer.js"     <<'EOF'
setTimeout(()=>process.exit(0), 4000);
EOF
cat > "$D/interval.js"  <<'EOF'
const i=setInterval(()=>{},50); setTimeout(()=>{clearInterval(i);process.exit(0)},4000);
EOF
cat > "$D/httpsrv.js"   <<'EOF'
require('http').createServer((q,s)=>s.end('x')).listen(0,()=>{}); setTimeout(()=>process.exit(0),4000);
EOF
cat > "$D/idleconn.js"  <<'EOF'
const net=require('net');
const s=net.createServer(c=>{}).listen(0,()=>{ net.connect(s.address().port,'127.0.0.1',()=>{}); });
setTimeout(()=>process.exit(0),4000);
EOF
cat > "$D/immediate.js" <<'EOF'
setTimeout(()=>process.exit(0),4000); setImmediate(()=>{});
EOF
cat > "$D/stdin.js"     <<'EOF'
process.stdin.resume(); setTimeout(()=>process.exit(0),4000);
EOF
cat > "$D/promise.js"   <<'EOF'
(async()=>{ await new Promise(r=>setTimeout(r,4000)); process.exit(0); })();
EOF
cat > "$D/worker.js"    <<'EOF'
const { Worker, isMainThread, parentPort } = require('worker_threads');
if (!isMainThread) { setTimeout(()=>parentPort.postMessage('x'), 3500); return; }
const w=new Worker(__filename); w.on('message',()=>{w.terminate();process.exit(0)});
EOF
# A watched dir must be QUIET and SMALL: /tmp has ~22k entries and constant churn, so
# watching it measures FSWatcher's O(entries) rescan, not idle cost. That artifact cost a
# round of investigation once already.
cat > "$D/fswatch.js"   <<EOF
const fs=require('fs'); const w=fs.watch('$D/quiet',()=>{}); setTimeout(()=>{w.close();process.exit(0)},4000);
EOF

# CPU is sampled at 3s while the process still runs; a spin shows as ~3s of CPU for 3s of
# wall. Threshold 1.0s ≈ 33% of a core — well above any legitimate idle cost.
cpu_of() {
  "$1" "$2" >/dev/null 2>&1 & local p=$!
  sleep 3
  local t; t=$(ps -o time= -p $p 2>/dev/null | tr -d ' ')
  kill -9 $p 2>/dev/null; wait $p 2>/dev/null
  echo "${t:-EXITED}"
}
fail=0
printf "%-12s %-11s %-11s %s\n" SHAPE MILO ORACLE VERDICT
for f in timer interval httpsrv idleconn immediate stdin promise worker fswatch; do
  m=$(cpu_of "$MILO" "$D/$f.js"); o=$(cpu_of "$ORACLE" "$D/$f.js")
  secs=$(echo "$m" | sed 's/.*://')
  v=$(awk -v s="$secs" 'BEGIN{print (s+0>1.0)?"*** SPIN":"ok"}')
  [ "$v" != "ok" ] && fail=$((fail+1))
  printf "%-12s %-11s %-11s %s\n" "$f" "$m" "$o" "$v"
done
echo "== $fail spinning =="
exit $fail
