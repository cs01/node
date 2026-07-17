#!/usr/bin/env python3
"""stub-audit.py — enumerate no-op / constant-return stubs in lib/*.js.

The session's defining finding: milo fails by LOOKING LIKE SUCCESS — a stub returns a
plausible value instead of doing the work or failing. Real apps found 8 such bugs the
2143-test suite missed (every one PASSED because the stub looked like success).

This lists the candidates. It does NOT auto-fix: the right response depends on the stub:
  THROW      — feature is absent AND fake success yields garbage/hang and no real caller
               depends on the fake result (e.g. node:test mock.timers.enable, createObjectURL).
  IMPLEMENT  — a request is silently dropped (Agent.addRequest, http2 settings); a THROW here
               breaks working callers, so do the real thing.
  KEEP       — the no-op/const is genuinely correct (cork/uncork advisory; worker.stdout is
               null by default; writableCorked 0 when uncorked).
Classify before acting — blind throwing regresses apps that lean on a benign stub.
"""
import re, glob, os
pat_noop  = re.compile(r'\b([a-zA-Z_$][\w$]*)\s*\([^)]*\)\s*\{\s*\}')
pat_const = re.compile(r'\b([a-zA-Z_$][\w$]*)\s*\([^)]*\)\s*\{\s*return\s+(\{\}|\[\]|true|false|null|0|-1|""|\'\'|\d+)\s*;?\s*\}')
skip = re.compile(r'constructor|=>|\bnoop\b', re.I)
KW={'if','for','while','switch','function','catch','Readable','Writable','Duplex','Transform'}
seen=set()
for f in sorted(glob.glob('src/milo/lib/*.js')):
    src=open(f).read(); b=os.path.basename(f)
    for pat,kind in ((pat_noop,'NOOP'),(pat_const,'CONST')):
        for m in pat.finditer(src):
            n=m.group(1)
            if n in KW or skip.search(m.group(0)): continue
            ln=src[:m.start()].count('\n')+1
            k=(b,n)
            if k in seen: continue
            seen.add(k)
            extra=' '+m.group(2) if kind=='CONST' else ''
            print(f'  {b}:{ln}  {n}()  {kind}{extra}')
print(f'== {len(seen)} candidate stubs — classify each THROW/IMPLEMENT/KEEP before acting ==')
