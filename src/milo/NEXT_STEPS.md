# next steps (scoped for lower-capability model)

Each task below is deliberately narrow: one module, one recipe, one verification command.
Do them ONE AT A TIME. Finish + verify + commit before starting the next.

## baselines (2026-07-16, post-session re-tally — table in ROADMAP.md is staler)

fs 177/201 · net 49/106 · util 12/19 · whatwg 30/41 · events 5/8 · timers 51/55 · diagnostics 12/17

## ground rules — read before every task

1. **NEVER run the full test suite** — it hangs. Only per-module:
   `bash test_safe_runner.sh --compat --module <mod>` (repo root; NOT src/milo/test-compat.sh).
2. **Baseline first.** Run the module's tests BEFORE touching code, record pass count.
   After the fix, re-run. Pass count must go up or stay equal. Any regression → revert, stop, report.
3. **Prefer lib/*.js and bootstrap.js changes** — hot-loaded, no rebuild needed.
   `.milo` / `v8capi.cc` / `binding_registry.c` changes need `bash src/milo/build.sh` (slow, and the
   milo compiler at ~/git/milo drifts — a failed rebuild may be compiler drift, not your bug; if
   build.sh errors on code you didn't touch, stop and report rather than "fixing" milo syntax).
4. **Port from canonical Node source when possible.** Real Node `lib/` is in this repo — copy the
   real implementation of a pure-JS function instead of inventing one (path went 9→15 this way).
5. **Adapter over refactor.** Wrap existing internals; never restructure a working module to fix one test.
6. **Verify roadmap claims before fixing** — some entries are stale. Reproduce the failure with
   `./out/Release/milo-node -e "..."` first. If it already passes, mark done and move on.
7. Commits: one line, all lowercase, no claude mention. Commit per task.
8. After a flip, update the ROADMAP.md counts + move item to done.

## tier 1 — pure JS, no rebuild (do these first)

### 1. dns lookup error gets .code ENOTFOUND (1+ test, trivial)
`src/milo/lib/dns.js:17` constructs bare `Error` on lookup failure → crashes as uncaught.
Recipe: build error like real node — `code:'ENOTFOUND'`, `errno:-3008`? no — node uses
`ERR_NAME_RESOLUTION_FAILED`-style: `err.code='ENOTFOUND'`, `err.hostname=<host>`, `err.syscall='getaddrinfo'`,
message `getaddrinfo ENOTFOUND <host>`. Verify: `./out/Release/milo-node -e "require('dns').lookup('no.such.host.invalid',(e)=>console.log(e.code,e.syscall,e.hostname))"`.
Then run dns module tests.

### 2. Module._stat / _nodeModulePaths / _resolveLookupPaths / _extensions setter (~4 tests)
All in `src/milo/lib/module.js` (or wherever Module lives — grep). Port from canonical
`lib/internal/modules/cjs/loader.js` in-repo. `_stat` = fs.statSync wrapper returning 0/1/-errno.
Verify: `bash test_safe_runner.sh --compat --module module` (baseline 21/26).

### 3. fs.readdir withFileTypes returns real Array (Dirent[].map fails) (1-2 tests)
Roadmap says `.map` missing on withFileTypes result — likely returning array-like, not Array.
Reproduce first: `./out/Release/milo-node -e "console.log(require('fs').readdirSync('.',{withFileTypes:true}).map(d=>d.name))"`.
Fix in `src/milo/lib/fs.js` — ensure real Array of Dirent objects. Module: fs (baseline 177/201).

### 4. .errno numeric property on fs errors (multiple fs tests assert it)
The `internalBinding('uv')` errmap landed 2026-07-15. Errors now have code/syscall/path but
`errno` is undefined. Find the error factory in `src/milo/lib/fs.js` / bootstrap (grep `uvErrmap` or
`ENOENT`), attach the negative libuv errno number. Verify:
`./out/Release/milo-node -e "try{require('fs').readFileSync('/nope')}catch(e){console.log(e.errno,e.code)}"`
→ must print `-2 ENOENT`. Module: fs.

### 5. util.callbackify (1-2 tests)
Port verbatim from canonical `lib/util.js` in-repo (it's pure JS: promise → errback, including the
null-rejection wrap). Add to `src/milo/lib/util.js`. Module: util (baseline 12/19).

### 6. Console constructor (~up to 10 tests, medium)
`new (require('console').Console)(stdout, stderr)` missing. Port from canonical
`lib/internal/console/constructor.js` — can simplify: constructor stores streams, methods format via
existing util.inspect/format and write to stored streams. Don't rewrite existing global console —
adapter: make global console an instance-alike, or just add Console class alongside. Module: console (baseline 9/14).

### 7. new URL('::::') must throw ERR_INVALID_URL (1 test)
URL parser too lenient. Find parser (grep `ERR_INVALID_URL` / `class URL` in src/milo/lib + bootstrap).
Add strictness ONLY for clearly-invalid inputs; then run FULL whatwg module (baseline 30/41) — URL
changes regress easily, zero-regression rule applies hard here.

### 8. fs mislabeled errno: access EACCES→ENOENT, readfile EIO (2-3 tests)
`src/milo/lib/fs.js` hardcodes 'ENOENT' at ~8 sites because some bindings don't surface errno.
ONLY fix the JS sites where the binding DOES return errno already (fsAccess returns +errno,
fsFdRead/Write return -errno per ROADMAP critical section). Route those through the uv errmap
factory from task 4. Do NOT touch binding_registry.c in this task. Module: fs.

## tier 2 — small C bindings, needs rebuild (only after tier 1 exhausted)

### 9. process.seteuid/setegid/getegid (3 tests)
Add to `binding_registry.c` following the existing getuid/setuid pattern (grep it). These are
non-variadic simple syscalls — direct extern OK. Remember ARM64 rule: only VARIADIC fns need C wrappers.
Rebuild with build.sh, then module: process.

### 10. process.umask(mask) returns OLD mask (2 tests)
umask(2) returns previous mask natively — likely just plumb the return value through. Check current
binding first; may be JS-side fix only (then it's tier 1). Module: process.

### 11. standardize binding errno convention (unlocks rest of task 8)
Make every fs binding return negative errno (libuv style): `nm_fs_open` at binding_registry.c:65
returns bare -1 — capture errno, return -errno. Note prior session already did C-capture for open
dodging an FFI clobber — read that commit (git log --oneline | grep errno) before touching. One
binding per commit, re-run fs module each time.

## big lever IN PROGRESS: event-loop lifecycle

See `src/milo/lifecycle-probes/PLAYBOOK.md` — self-contained diagnosis+fix guide with probe
harness, architecture map, ranked hypotheses, instrumentation recipe. Start there before
any tier above. Probes: `bash src/milo/lifecycle-probes/run-probes.sh`.

## do NOT attempt (other big levers, need the human engaged)

- net.Socket → Duplex refactor
- http timeout/abort/keep-alive
- streams: web streams, async-iter edge cases
- brotli/zstd codecs, ESM/vm.SourceTextModule, worker heap-snapshot
- anything requiring changes to the milo compiler itself
- util.inspect deep fidelity (getters/showHidden) — tempting but historically regression-prone

## per-task workflow (copy this)

```
1. baseline:  bash test_safe_runner.sh --compat --module <mod>   # record N/total
2. reproduce: ./out/Release/milo-node -e "<minimal repro>"
3. fix (smallest possible diff; canonical port if pure JS)
4. re-verify repro, then re-run module suite — need >= N, target > N
5. update ROADMAP.md counts, move item to done
6. git add -A && git commit -m "<mod>: <what> — <module> N->M"   # one line, lowercase
```
