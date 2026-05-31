#!/bin/bash
# Triage fs failures: run each guarded, capture first meaningful error line.
# Output: /tmp/fs_triage.txt  (one line: testname :: errline)
# Guards: ulimit -v 1GB + ulimit -u 64 + perl alarm 8s + output head-capped.
cd "$(dirname "$0")/../.." || exit 1
OUT=/tmp/fs_triage.txt
: > "$OUT"
LIST="${1:-/tmp/fs_fails.txt}"

# NODE_SKIP_FLAG_CHECK=1 stops common/index.js re-spawning the test as a child_process
# when required // Flags: are absent (that re-spawn is what produced the useless rc=128).
export NODE_SKIP_FLAG_CHECK=1
run1() {
  rm -rf test/.tmp.* 2>/dev/null
  local flags
  flags=$(head -20 "test/parallel/$1" | grep '// Flags:' | sed 's,// Flags:,,' | tr '\n' ' ')
  ( ulimit -v 1048576 2>/dev/null; ulimit -u 64 2>/dev/null
    perl -e '$SIG{ALRM}=sub{kill -9,$p if $p; exit 124}; alarm 8;
             $p=fork; if($p==0){setpgrp(0,0); exec(@ARGV); exit 127} waitpid($p,0); exit($?>>8)' \
      ./out/Release/milo-node $flags "test/parallel/$1" 2>&1 | head -c 8000 )
}

while IFS= read -r t; do
  [ -z "$t" ] && continue
  [ -f "test/parallel/$t" ] || { echo "$t :: (missing file)" >> "$OUT"; continue; }
  out=$(run1 "$t"); rc=$?
  pkill -9 -f "$t" 2>/dev/null
  if [ "$rc" = "0" ]; then echo "$t :: PASS(rc0)" >> "$OUT"; continue; fi
  if [ "$rc" = "124" ]; then echo "$t :: TIMEOUT" >> "$OUT"; continue; fi
  # first error-ish line that isn't a stack frame
  err=$(printf '%s\n' "$out" | grep -aE 'Error|assert|throw|Cannot|not a function|not defined|ERR_|Expected|actual|!==|undefined is|TypeError|RangeError|reject' \
        | grep -avE '^\s*at ' | head -1 | cut -c1-160)
  [ -z "$err" ] && err="(rc=$rc, no err: $(printf '%s' "$out" | tr '\n' ' ' | cut -c1-100))"
  echo "$t :: $err" >> "$OUT"
done < "$LIST"
echo "DONE $(wc -l < "$OUT") lines" >> "$OUT"
