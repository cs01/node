#!/bin/bash
# stream-audit.sh — real-world stream lifecycle patterns, milo vs the ORACLE.
#
# WHY: two stream-lifecycle bugs (5531a4f4107 write()/drain, 0ae226c8c61 autoDestroy on
# ended-not-endEmitted) shipped this session, BOTH found only by a real app (trpc await-drain,
# node-fetch v2 late-attach on a PassThrough) — the 2143-test suite passed the whole time.
# Common cause: a stream self-completing wrong when a consumer attaches AFTER the data/finish.
# This guard exercises those shapes and diffs milo's output against node's, so a regression in
# the family shows up without needing the live app.
#
# Compares to the ORACLE, not hardcoded expectations — so a wrong assumption can't false-fail.
set -u
cd "$(dirname "$0")/../../.." || exit 1
MILO=./out/Release/milo-node
ORACLE=./out/Release/node   # v27 built from THIS tree — never PATH node
[ -x "$MILO" ] && [ -x "$ORACLE" ] || { echo "need both $MILO and $ORACLE"; exit 1; }

D=$(mktemp -d); trap 'rm -rf "$D"' EXIT
cat > "$D/probe.js" <<'EOF'
const {PassThrough,Transform,Readable,Writable,pipeline}=require('stream');
const out=[]; let n=0,t=0;
const run=(name,fn)=>{ t++; try{ fn(r=>{ out.push(name+'='+JSON.stringify(r)); if(++n>=6){print();} }); }catch(e){ out.push(name+'=THROW:'+e.message.slice(0,30)); if(++n>=6){print();} }; };
const print=()=>{ out.sort(); console.log(out.join('\n')); process.exit(0); };
run('late-consumer',(cb)=>{ const p=new PassThrough(); p.end('abcde'); setTimeout(()=>{let k=0;p.on('data',c=>k+=c.length);p.on('end',()=>cb(k));},50); });
run('pipe-chain-late',(cb)=>{ const a=new PassThrough(),b=new PassThrough(); a.pipe(b); a.end('hello'); setTimeout(()=>{let k=0;b.on('data',c=>k+=c.length);b.on('end',()=>cb(k));},50); });
run('transform-flush-late',(cb)=>{ const tr=new Transform({transform(c,e,d){d(null,c)},flush(d){d(null,'TAIL')}}); tr.end('x'); setTimeout(()=>{let s='';tr.on('data',c=>s+=c);tr.on('end',()=>cb(s));},50); });
run('readable-from-late',(cb)=>{ const r=Readable.from(['a','b','c']); setTimeout(()=>{let s='';r.on('data',c=>s+=c);r.on('end',()=>cb(s));},50); });
run('writable-end-cb',(cb)=>{ const w=new Writable({write(c,e,d){d()}}); w.end('z',()=>cb('endcb')); });
run('pipeline-3stage',(cb)=>{ const tr=()=>new Transform({transform(c,e,d){d(null,c)}}); const ch=[]; const sink=new Writable({write(c,e,d){ch.push(c);d()}}); pipeline(Readable.from(['1','2']),tr(),sink,(err)=>cb(err?'ERR':ch.join(''))); });
setTimeout(print,2500);
EOF

runone(){ "$1" "$D/probe.js" > "$2" 2>&1 & local p=$!; sleep 4; kill -9 $p 2>/dev/null; wait $p 2>/dev/null; }
runone "$ORACLE" "$D/o.txt"
runone "$MILO"   "$D/m.txt"
if diff -q "$D/o.txt" "$D/m.txt" >/dev/null 2>&1; then
  echo "== stream-audit: milo matches oracle on all patterns =="; sed 's/^/  /' "$D/m.txt"; exit 0
else
  echo "== stream-audit: DIVERGENCE (oracle | milo) =="; diff "$D/o.txt" "$D/m.txt"; exit 1
fi
