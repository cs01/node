# event-loop lifecycle playbook (self-contained — no human needed)

## READ FIRST: four traps that will fool you (learned the hard way, 2026-07-16)

1. **Validate every probe against real node — and use the RIGHT node.**
   **THE ORACLE IS `./out/Release/node` (v27.0.0-pre, built from THIS tree). NOT the `node`
   on PATH (v25.3.0).** This repo is node **27.0.0** (src/node_version.h); v27 is not
   released (nvm's newest is 26.x), so the only correct binary is the one already built in
   out/Release. I used PATH node all session and it silently misled me: three keep-alive
   tests "fail in real node" only because 25.3.0 predates node 27's `Keep-Alive: timeout=65`
   default. PATH node is a fine oracle for semantics unchanged 25->27 (most things), but for
   anything version-specific it is WRONG. Second-best oracle, always correct: the repo's own
   `lib/*.js` IS node 27's canonical source — port from it rather than inventing.
   Still true: **a "hang" is often correct** — p01 hangs in real node too (its server never
   reads the buffered data, so 'end' correctly never fires).
1b. **A probe that races is not ground truth, in EITHER runtime.** The original p02 unref'd
   inside the client's connect callback, racing the server's accept: real node returned 124
   under no load and 0 under load. I sampled it ONCE, wrote "node hangs here" into this file
   as fact, and then "confirmed" milo matched — two coin flips agreeing. Rewritten to unref
   only after both ends are established; now node27 and milo agree 5/5 at exit 0. If a probe
   can race, fix the probe; do not record either outcome as truth.
2. **`timeout` on this PATH is milo-built and DOES NOT KILL ITS CHILD** — it returns 124
   and leaves the process running. The orphan keeps spinning, and (if you reuse one temp
   file) writes its later OOM into the NEXT probe's log. That fabricated both a phantom
   "p07 idle server OOMs" and the p04 "flake". Use SIGKILL + a hand-rolled watchdog +
   per-probe logs (run-probes.sh does). `gtimeout` (homebrew) is a working alternative.
   Note test_safe_runner.sh does NOT use timeout(1), so the module suites are unaffected.
3. **Exit code alone cannot distinguish "correctly asleep" from "spinning to death"** —
   both look like a hang. CPU time is the real assertion. Sample it BEFORE killing
   (`ps -o time= -p PID`). Sleeping ≈0.03s over 6s; spinning ≈6s then fatal-OOM.
4. **Never conclude from one run of a flaky probe.** p04 is ~50/50 both with and without
   any fix; a single A/B sample "proved" a regression that did not exist. Run 10x.
5b. **YOUR OWN MEASUREMENT CAN BE THE WRONG ONE — the runner cripples fork-dependent tests.**
   `test_safe_runner.sh:101` does `ulimit -u $MAX_PROCS` (default 30), but **RLIMIT_NPROC is
   PER-USER** and this box carries ~283 ambient procs — so every fork/spawn inside every test
   fails EAGAIN. child is 85/85 fork-dependent, cluster 54/54, tls ~14/82. I "measured" child
   at 2/85 and wrote it into ROADMAP as a triumphant correction of the recorded 17. Real
   answer with `--compat --module child all 8 400`: **24/85** — the record was closer than my
   measurement, and reality was BETTER than recorded. **Use `all 8 400` for child/cluster/tls.**
   (Arg trap: in --module mode positional 1 is still eaten as sample_size, so
   `--module cluster 8 100` sets TIMEOUT=100s and leaves procs at 30.)
   Also: **serialize suite runs.** Two sessions running suites concurrently cross-kill via the
   runner's global `pkill -9 -f milo-node` (line 181) and its >20-proc forkbomb check.
5. **Recorded baselines are not evidence.** Every inherited number was wrong: net "49" was
   44, timers "51" was 45. Both looked like regressions from my change; both were drift from
   unrelated commits (timers measured 45 with AND without my diff). Before believing you
   regressed something, re-run that module with your change reverted — `git show <commit>:path
   > path` is enough, no stash dance. Baselines rot; only an A/B on the current tree counts.

Mission: fix TCP handle lifecycle so processes exit when work is done, don't busy-spin,
and honor ref/unref. Prize: 12 TIMEOUT + 3 OOM tests in net alone, plus http/tls/cluster
timeouts downstream (~400 total across modules).

Everything below was verified live on 2026-07-16. Baselines: net 44 PASS / 47 FAIL /
12 TIMEOUT / 3 OOM (`net-baseline-2026-07-16.csv` in this dir).

## LEVER CLOSED (2026-07-16). Read this before starting another lifecycle hypothesis.

The premise this playbook was built on — "the hangs are busy-loops that OOM at
`pollWait -> v8c_array_new`" — is RESOLVED. Exit criterion measured, not assumed: every
remaining net+tls TIMEOUT was CPU-sampled at 6s and **all 15 sleep (0.04-0.09s CPU). Zero
spin. Zero OOM.**
```
net: 57 PASS / 0 OOM /  5 TIMEOUT      (start of grind: 44 PASS / 3 OOM / 12 TIMEOUT)
tls: 23 PASS / 0 OOM / 10 TIMEOUT      (3 spin-OOMs killed by 5l)
probes 9/9
```
The remaining timeouts are ordinary hangs and feature gaps (see 5q: `tls.connect({socket})`
is simply unimplemented and accounts for 3 of them). **They will not yield to lifecycle
instrumentation** — do not run the spin playbook against them. Diagnose them as normal test
failures: read the test, run it, find what never fires.

If a NEW spin appears, the machinery here still works: section 0 for discovery, section 4 for
instrumentation, `run-probes.sh` as the acceptance gate. Otherwise this file is now history +
the traps list, which stays valuable (READ FIRST is still accurate).

## 0. the one big discovery — read this first

**"Hangs" are NOT sleep-hangs. They are hot busy-loops that OOM.**
Failing probes die with `Fatal JavaScript out of memory` after ~10-15s, C stack:
`pollWait → v8c_array_new` (tcp.milo pollWait allocating the events array every
iteration). kqueue is level-triggered, so a dead/EOF'd fd that stays registered makes
`pollWait` return instantly forever → the JS loop spins at full speed allocating events
→ V8 heap dies. Any OOM with `pollWait` in the stack = "an fd was left in the kqueue
that shouldn't be there." Find WHICH fd and WHY it wasn't removed; that is the whole game.

**CONFIRMED + FIXED (H1), 2026-07-16.** Instrumentation named the fd precisely:
`poll#200 fd=6 filter=-1 eof=true known=true destroyed=false rEnded=true` — the
server-side accepted socket, readable side ALREADY ended, still registered for
EVFILT_READ, re-firing EV_EOF on every poll. The old EOF branch (`net.js:462`) was
guarded on `!ended`, so an already-ended socket hit it and did *nothing* — the event
just re-fired forever. Fix: `Socket._stopReading()` deregisters EVFILT_READ exactly once
when the peer's FIN is seen (called from `_onReadable` on EOF, and unconditionally from
the EV_EOF branch). p01 went from 7.32s CPU + fatal-OOM to 0.03s CPU.
**Note the loop itself was never the problem** — it correctly sleeps when nothing is
pending (idle server = 0 iterations). The bug was purely a stale kqueue registration.

## 0a. THE fd-REUSE RACE (H7) — found + fixed 2026-07-16. Root cause of the p04 "flake".

`Socket._destroy` closed the fd immediately but **deferred `Socket._sockets.delete(fd)` to
the 'close' event**. fd numbers are recycled aggressively — `close(5)` frees 5, and the very
next `accept()` hands 5 to a NEW socket. When the deferred handler finally ran, it deleted
the *new* owner's entry. The live server-side socket was orphaned: `_pollOnce` could no
longer find it, its 'close' never fired, `s.close()` never ran, process hung forever.

Caught by this trace from every hanging run (and never a passing one):
```
fd5 startReading | fd5 _destroy | server fd4 acceptable | accept -> 5 | fd5 startReading | emit connection fd5
```
Fix: only evict your own entry — `if (Socket._sockets.get(fd) === this) delete(fd)` — in
BOTH `Socket._destroy` and `Server.close`. p04 went 4/10 → **12/12** (real node: 10/10).

This was also the true source of the orphaned-fd storms (§0, §5c): an orphaned socket's
registration has no owner left to clean it up. Fix the eviction, and the orphans stop being
created in the first place.

**TECHNIQUE THAT MATTERED — the heisenbug trap.** This race vanishes under observation:
`writeSync` per event is slow enough that the fd never gets recycled in the window (6/6
passed while logging, 4/10 without). If adding a log makes your bug disappear, DO NOT
conclude it's gone. Trace into an in-memory array (`_lcTrace` in net.js — an array push, no
syscall) and flush it later from the loop's 500ms dump. Perturb after the race, never during.

## 0b. THE ARCHITECTURAL BUG (H6) — found + fixed 2026-07-16

**Milo counted "socket exists in `Socket._sockets`" as "keeps the loop alive". Node/libuv
counts only an *ACTIVE* handle** — one with a read started or a write pending. An open TCP
fd with nothing pending does NOT hold libuv's loop open.

Proof (`/tmp/unread.js` pattern — client never reads; server sends data + FIN):
real node **exits 0 without ever emitting the client's 'close'**; milo hung forever.
The client socket had consumed EOF and finished writing, but sat in the map → `io=true`
→ `__hasIO()` true → loop never exits. This is why tests hung with only *0.05s of CPU* —
nothing was spinning, the exit check simply never went false.

Fix (`_timers_init.js` `__hasIO`, adapter-style — no read-path refactor): skip sockets where
`_readableState.ended && (_writableState.finished || _writableState.ended)`. Such a socket
can never produce another event, so it is libuv-inactive by definition. Servers, connecting
sockets, and sockets still reading are unaffected — p01/p02/p07 still correctly hang.

This flipped `test-net-socket-close-after-end.js` to PASS.

**The general lesson for the rest of this work:** when a test hangs at ~0s CPU, do NOT hunt
for a spin. Dump `__hasIO`'s view (§4) and ask *which handle is claiming to be pending, and
would real node consider it active?* Milo's liveness model is coarser than libuv's, and that
gap is the remaining lever. The next refinement is pending-write / read-started tracking.

## 1. probe harness (acceptance tests — run first, run after every change)

```
bash src/milo/lifecycle-probes/run-probes.sh
```

Status after the H1 fix (2026-07-16) — all EXPECT_EXIT values verified against real node:
| probe | expect | status | meaning |
|---|---|---|---|
| p01 graceful end, server.close from client side | 124 | PASS (0.03s cpu) | hangs in real node TOO; guards no-spin. Was 7.32s + OOM before H1 fix |
| p02 socket/server unref | 124 | PASS (0.03s cpu) | hangs in real node TOO (accepted socket not unref'd); guards no-spin |
| p03 graceful end, server.close from server side | 0 | PASS | graceful path works |
| p04 destroy path | 0 | PASS — **12/12** after the §0a fd-reuse fix (real node 10/10) | was the ~50% flake; root cause was fd recycling, see §0a |
| p05 close idle server | 0 | PASS | |
| p06 timer unref | 0 | PASS | timers fine — don't touch |
| p07 open server keeps process alive | 124 | PASS (0.03s cpu) | idle loop correctly sleeps |
| p08 http roundtrip + close exits | 0 | PASS | don't regress |
| p09 data/end/close event sequence | 0 | PASS | FIN→'end' wiring works — don't touch stream.js first |

## 2. architecture map (verified file:line, 2026-07-16)

The loop is **JS-driven**. All lifecycle logic is in hot-loaded JS (`src/milo/lib/*.js`)
— **no rebuild needed** for most fixes. Only `tcp.milo` changes need `bash src/milo/build.sh`.

- **Loop:** `src/milo/lib/_timers_init.js:200-267` — `__runEventLoop`, infinite `for(;;)`.
  Entry from native: `src/milo/runtime/main.milo:1277-1282`.
- **Exit condition** (`_timers_init.js:217-240`): loop exits when ALL six are false, checked
  twice around a `beforeExit` emit:
  1. `__hasActiveWorkers()`
  2. hasTimers: native `_tb.hasPending()` AND some timer id not in `_unrefTimers`
  3. `__hasIO()` (`:279-300`) — **true if any non-`_unref` entry exists in
     `net.Socket._sockets` (Map fd→sock) or `net.Server._servers`**
  4. `process._nextTickQueue.length > 0`
  5. `_hasRefImmediate()` (`:171-174`)
  6. `_pendingCloseRefs > 0` (`__pendingCloseRef/Unref` `:196-198`)
- **Liveness = map membership.** Sockets registered in `_startReading` (`net.js:62-66`,
  does `tcp.pollAdd(fd, EVFILT_READ)` + `Socket._sockets.set(fd,this)`); removed ONLY in a
  deferred 'close' handler (`net.js:205` sockets, `:398` servers). If 'close' never emits
  for one fd, the process lives forever. No reaper, no backstop.
- **Socket** (`src/milo/lib/net.js`): extends Duplex (`:29`). No libuv handle — raw fd in
  `this._fd`. `connect` `:68-128` (EVFILT_WRITE until connected, `_onConnected` `:130-157`),
  `_onReadable` `:159-167` (recvBinary undefined = EOF → `push(null)`), `_final` `:191-194`
  (= end(): `tcp.shutdown(fd,1)` SHUT_WR), `_destroy` `:196-208` (pollRemove READ+WRITE,
  `tcp.close(fd)`, `__pendingCloseRef`, defer map-delete to 'close').
- **Server** (`net.js`): `_onAcceptable` `:371-381`, `close()` `:388-402` — pollRemove,
  tcp.close, `process.nextTick(emit('close'))`. NOTE: real node defers server 'close'
  until all connections are gone; milo emits immediately — yet in p01 it never emits at all.
- **Poll pump:** `_pollOnce` (`net.js:419-472`) calls `tcp.pollWait`, dispatches by fd:
  servers→accept, sockets→`_onConnected`/`_onReadable`; explicit `EV_EOF` branch
  `:462-469` (drain + push(null)). Loop calls it at `_timers_init.js:256-257` with waitMs
  from next-timer distance (default 100ms).
- **ref/unref:** `Socket.ref/unref` set `this._unref` (`net.js:249-250`); `Server` same
  (`:406-407`); `__hasIO` claims to skip `_unref` entries (`_timers_init.js:283-297`).
  p02 proves this is broken somewhere — but ALSO note p02's busy-spin may be H1 again.
- **kqueue** (`src/milo/bindings/tcp.milo`): pollInit `:426-432`, pollAdd/Remove `:435-456`
  (EV_ADD, **level-triggered**, no EV_CLEAR), pollWait `:459-499` (blocks, 64-event array —
  the per-iteration alloc that OOMs when spinning). recvBinary `:329-353` (read()==0 → undefined).
- **stream glue** (`src/milo/lib/stream.js`): push(null)→'end' `:236-258`; half-open
  auto-close `:254` (allowHalfOpen=false → auto end()); finish→autoDestroy `:985-988`.
  p09 passes — this layer works; suspect it LAST.

## 3. ranked hypotheses + how to confirm each

**H1 — CONFIRMED AND FIXED 2026-07-16 (see §0). Kept below for the diagnosis method.**
After FIN arrives, `push(null)` fires but the fd stays polled until `_destroy` runs. If
the destroy chain stalls for ONE socket (see H2/H3), every `pollWait` returns that fd's
EV_EOF instantly → busy-loop → OOM. Even when destroy DOES eventually run, the window
between EOF and destroy is a hot spin (likely the p04 flake).
Confirm: instrumentation (§4) — log fds returned by pollWait; in a failing p01 run you'll
see the same fd repeating thousands of times.
Fix shape: on EOF (both the recvBinary-undefined path `net.js:162` and EV_EOF branch
`:462-469`), immediately `tcp.pollRemove(fd, EVFILT_READ)` (idempotent guard: only once —
add a `sock._readPollRemoved` flag). The fd stays open for writing until destroy; only the
READ registration must go. This alone may fix p01, p04 flake, and several TIMEOUT tests.

**H2 — WITHDRAWN.** The premise was false. `server.close()`'s callback "never firing" in
p01 was not a swallowed throw: the client 'close' handler that calls it legitimately never
runs, because the server never reads the buffered data so the socket never ends. Real node
behaves identically. There is no bug here.

**H6 — CONFIRMED AND FIXED 2026-07-16. See §0b. The biggest one: liveness model mismatch
(map-membership vs libuv active-handle). Remaining refinement: milo still counts a socket as
pending whenever its readable side hasn't ended, even if nothing ever started reading it —
node would call that handle inactive. That gap is the next lever.**

**H5 (was "the p04 destroy-path race", ~50% hang): status uncertain — p04 passed after the
H6 fix, but it is a flaky probe, so ONE green run proves nothing. Re-measure 10x before
declaring it fixed. It may have been a symptom of H6 all along.**
`client.connect() → client.destroy()` immediately. Server-side socket should see EOF →
push(null) → 'end' → (allowHalfOpen=false) auto end() → finish → autoDestroy → 'close' →
`s.close()` → exit. It completes ~50% of runs, hangs the rest — same rate before and after
the H1 fix, so it is an independent, pre-existing race.
Suspicion: destroying the client *immediately after* connect races the server's accept /
first poll registration — the server-side fd may be registered for READ after the peer is
already gone, so the EOF event is delivered once and dropped (or never delivered), leaving
the socket alive with nothing to wake it. Note `_onConnected` (`net.js:130-157`) and
`_onAcceptable` (`:371-381`) both mutate poll registration.
Confirm: run p04 in a 10x loop with MILO_LIFECYCLE_DEBUG=1, diff a hanging run's trace
against a passing one — compare which fds get registered and which events arrive. The
hanging run should show a server-side fd in `socks=[...]` that never receives EV_EOF.

**H3: unbalanced `_pendingCloseRefs` or a map entry whose 'close' never emits.**
`_destroy` increments `__pendingCloseRef` and only the 'close' emit decrements + deletes
from `Socket._sockets`. Any path that destroys without emitting 'close' (double-destroy,
error during destroy, autoDestroy ordering) leaks both the counter and the map entry.
Confirm: instrumentation dump (§4) — at spin time, print `_pendingCloseRefs` and map keys.

**H4 (p02, unref): `_unref` flag set but socket still counted — OR the unref'd fd still
spins via H1.** Check `__hasIO` (`_timers_init.js:279-300`) actually reads the same
property `Socket.prototype.unref` sets, including for CONNECTING sockets (connect-pending
sockets might be tracked in a different structure, `net.js:68-128`). Fix H1 first; retest p02.

## 4. instrumentation recipe (all JS, hot-loaded, zero rebuild)

Gate everything behind `process.env.MILO_LIFECYCLE_DEBUG` so it can ship committed.

In `_timers_init.js` `__runEventLoop`, add at top of the for(;;) body:
```js
if (process.env.MILO_LIFECYCLE_DEBUG) {
  globalThis.__loopIter = (globalThis.__loopIter || 0) + 1;
  if (globalThis.__loopIter % 1000 === 0) {
    const net = _req('net');
    process._rawDebug(`[loop ${globalThis.__loopIter}] timers=${hasTimers} io=${globalThis.__hasIO()} ticks=${process._nextTickQueue.length} imm=${_hasRefImmediate()} pclose=${_pendingCloseRefs} socks=[${[...net.Socket._sockets.keys()]}] srvs=[${[...net.Server._servers.keys()]}]`);
  }
}
```
(Adapt names to what's in scope; `_rawDebug` bypasses stdout buffering — if it doesn't
exist, use `require('fs').writeSync(2, msg + '\n')`. A healthy run logs nothing at %1000;
a busy-loop hits iter 1000 in <1s — the dump tells you exactly which fd/counter is stuck.)

In `net.js` `_pollOnce` event dispatch loop: log `fd, filter, flags & EV_EOF` per event
(same env gate, same %-sampling if noisy). In `Socket.prototype._destroy`,
`Server.prototype.close`, and both map-delete sites: log fd + action, and wrap bodies in
try/catch that logs before rethrowing — this catches H2's swallowed exception.

Run: `MILO_LIFECYCLE_DEBUG=1 timeout 5 ./out/Release/milo-node src/milo/lifecycle-probes/p01-*.js 2>&1 | head -50`
(always `timeout 5` + `head` — a spinning run generates unbounded output).

## 5. rules of engagement

1. **Order: instrument → confirm ONE hypothesis → smallest fix → verify → commit.** One
   hypothesis per commit. Never fix two things in one diff.
2. **JS files only unless truly forced.** `net.js`, `_timers_init.js`, `stream.js` are
   hot-loaded. `tcp.milo` needs a rebuild AND risks milo-compiler drift — if `build.sh`
   errors on code you didn't touch, STOP, `git stash`, report; do not "fix" milo syntax.
3. **Adapter over refactor.** Do NOT restructure Socket/Server or replace the map-based
   liveness scheme. Patch the specific broken transition. The map scheme is crude but
   it's what 44 passing tests depend on.
4. **Don't touch stream.js until p01/p02/p04 are green via net.js/_timers_init.js fixes.**
   p09 proves stream glue works.
5. Verification ladder after EVERY change, in order (stop at first regression, revert):
   a. `bash src/milo/lifecycle-probes/run-probes.sh` — must be ≥ baseline table above
   b. `bash test_safe_runner.sh --compat --module net` — must be ≥ 44 PASS, ≤ 12 TIMEOUT
   c. if loop/_timers_init touched: also `--module timers` (baseline 51/55) and
      `--module http` (baseline 91/210) — the loop is shared.
6. Leave instrumentation in, env-gated. Update the probe-status table in this file and
   the counts in ROADMAP.md as things flip. Commit style: one line, lowercase.
7. If genuinely stuck after instrumenting (no repeating fd, no exception caught, counters
   balanced): write findings into this file under a `## findings` section and stop —
   don't thrash.

## 5a. ~~http keep-alive socket reuse~~ — RESOLVED 2026-07-16 by the fd-reuse fix (§0a)

**This turned out to be a SYMPTOM, not a bug of its own.** The pooled keep-alive socket was
exactly the socket being orphaned by the fd-reuse race: request 1's socket closed, its fd was
recycled for request 2's socket, and the stale deferred delete evicted the new one — so
request 2 was written to a socket the poll loop no longer dispatched. Fixing §0a fixed this;
the repro below now passes with the default agent, and 4 of the 8 former http OOM tests pass
outright (the other 4 now fail cleanly with assertions — real logic bugs, no longer masked).

Worth internalizing: **one root cause wore three different masks** (busy-spin OOMs, the p04
"flake", and "keep-alive is broken"). Before building a theory for each symptom, check whether
one lifecycle invariant explains them all.

Kept for reference — the repro (3 sequential http.get to one server, each from the prior 'end'):

```js
const http = require('http');
const s = http.createServer((req, res) => { console.log('server: req', ++n); res.end('hello\n'); });
s.listen(0, () => go(1));
function go(i) { http.get({port: s.address().port}, (res) => {
  res.on('end', () => { if (i < 3) go(i+1); else s.close(); }); res.resume(); }); }
```
Before §0a milo completed request 1 then request 2 NEVER REACHED THE SERVER. Now: 3 requests,
exits 0, same as real node.

## 5d. H10 — http request timeouts (found + fixed 2026-07-16)

`ClientRequest.setTimeout()` (http.js ~843) was a **no-op stub**: `if (cb) this.once('timeout',
cb); return this;` — it registered the callback and armed NOTHING, so `req.on('timeout')` could
never fire. Also, the client never emitted **'socket'** on the request (node does, once the
socket is assigned in `doConnect`), so anything deferring work to that event waited forever.
Fix: emit 'socket' on a nextTick from doConnect, and make ClientRequest.setTimeout arm the
underlying socket + forward the socket's 'timeout' onto the request.
Flipped `test-http-client-timeout` and `test-http-client-timeout-agent` to PASS.

**TRAP — patch the class that's actually used.** http.js defines FOUR `setTimeout(ms, cb)`
methods (IncomingMessage:42, OutgoingMessage:94, Server:526, ClientRequest:843). I "fixed"
OutgoingMessage first and nothing changed, because **ClientRequest extends EventEmitter, NOT
OutgoingMessage** — its own stub shadowed everything. Before editing a method that exists in
several classes, confirm which one the object really is:
`awk 'NR<=850 && /^class /{cls=$2} /methodName/{print NR": ["cls"] "$0}' http.js`
Note IncomingMessage:42 and Server:526 are still stubs — likely the same bug for
`res.setTimeout()` / `server.setTimeout()`. Untested; a candidate next lever.

## 5e. AUDIT FINDINGS (independent review, 2026-07-16) — verified, ranked, mostly OPEN

An independent audit caught a real regression I had already committed, plus the biggest
remaining lever. Both verified first-hand. Open items are the best next work:

**#1 (OPEN, biggest test-flipper): `fcntl` is variadic → EVERY fd is BLOCKING.**
`extern fn fcntl` is declared directly (tcp.milo:14) and called at tcp.milo:176-177, 235-236,
829-830 and spawn.milo:371-380, 521-522 — the exact ARM64 variadic trap that
binding_registry.c:73-78 already documents for FD_CLOEXEC. So `F_SETFL` writes a garbage
value and O_NONBLOCK never lands. Evidence: `sample` of hung test-net-throttle shows **881/881
samples inside `tcpSendBinary → write()`** (a blocked syscall — the [lc] dump froze at iter=1);
`lsof +fg` shows no NBF flag and garbage flags (ASYN/DSYN/FSYN = stack trash).
Explains ~5 of 13 net timeouts (throttle, write-slow, write-fully-async-*, bytes-written-large)
plus write-heavy http. Fix: a `milo_set_nonblock(fd)` C wrapper next to the cloexec one
(~20 lines + rebuild) — **must ship together with EAGAIN backpressure in `_write`** (queue the
remainder, pollAdd EVFILT_WRITE, flush on writable, cb after flush), or previously-blocking
writes turn into instant 'write failed'. Then tighten `__hasIO` to `ws.finished`-only (below).

**#2 (OPEN, diagnostic multiplier — do FIRST, it's JS-only and tiny): user exceptions in
request handlers are swallowed → TIMEOUT instead of a visible assert.**
`emit('request')` runs inside `_pollOnce`'s try/catch (net.js:508) → `_emitSocketError`
(net.js:434) → the socket always has an 'error' listener (http.js:377 forwards clientError) →
a user's AssertionError silently becomes a `clientError`. Since node tests are
`common.mustCall((req,res) => { assert... })`, **every behavioral diff inside a handler shows
up as an opaque TIMEOUT.** Fix: in `_emitSocketError`, route only genuine I/O errors
(has `.syscall`/known errno code) to the socket; send everything else to
`process._fatalException`. Converts a large opaque slice of the 38 http timeouts into honest,
diagnosable failures — the same OOM→assert unmasking that already paid off twice today.

**#3 (OPEN, ~6 tests): missing `ERR_STREAM_ALREADY_FINISHED` / `ERR_STREAM_WRITE_AFTER_END`.**
Zero hits for either code in http.js. `res.end()` twice must error-callback ALREADY_FINISHED;
`res.end('x')` after end must WRITE_AFTER_END. Cluster: outgoing-end-multiple, outgoing-
finished, server-write-after-end, write-callbacks, res-write-end-dont-take-array,
outgoing-write-types.

**LANDMINE in the §0b `__hasIO` fix (act on it when #1 lands):** the `(ws.finished ||
ws.ended)` clause is only safe because `_write` (net.js:180) is currently SYNCHRONOUS, so
`ended` implies flushed. The moment async/queued writes exist (which #1 requires), `ws.ended`
with unflushed data becomes real and the process will exit mid-flush. Tighten to
`ws.finished` only at that point.

**HARDENING (small, open):**
- `_startReading` (net.js:62) never resets `_readPollRemoved`, so a reconnected Socket would
  EOF-storm. Latent only because reconnect is already broken upstream ('connect' never
  re-emits). One-line insurance.
- net.js:521 calls `sock._stopReading()` **outside any try/catch**, but the pipe objects in
  `Socket._sockets` (child_process.js:344-365, _console_init.js, _process_init.js, dgram.js:63)
  have no such method. Saved today only because their `_onReadable` sets `destroyed=true` on
  the same EOF event. Guard with `typeof sock._stopReading === 'function'`.
- **Mid-batch fd recycling** (same class as §0a, one level down): `_pollOnce`'s event array is
  a snapshot. If event *i* destroys fd 5 and event *j>i* is an accept that recycles fd 5, a
  stale event for fd 5 later in the batch dispatches to the NEW socket and `push(null)`s a
  brand-new connection. Fix: track fds closed during the current batch, skip their remaining
  events.
- http.js:475 deletes a LIVE socket's `_sockets` entry (fd still open) then destroys on
  setImmediate — an orphan window now papered over by the unowned-dereg. Redundant since the
  §0a fix; remove it.

**DISCONFIRMED:** the setTimeout-stub hypothesis is NOT a lever. Of the 40 http timeouts only
ONE uses `IncomingMessage.setTimeout` and ZERO use `Server.setTimeout` (measured: the
Server.setTimeout fix flipped exactly 0 tests). Fix them for correctness, not for score.

## 5f. NEXT TARGET: the http keep-alive cluster (5 tests, partially done 2026-07-16)

Tests: test-http-server-keep-alive-defaults, -keep-alive-pipeline-max-requests,
-server-keep-alive-max-requests-null, -keep-alive-drop-requests, -server-keepalive-req-gc.
**THREE NOW PASS.** The blocker was a MISSING ONE-LINER: `Socket` never emitted **'ready'**
after 'connect' (node: lib/net.js:1690-1691). The tests write their pipelined requests from
inside `socket.on('ready')`, so they sat mute and timed out — while the real cause looked like
"keep-alive is broken". Pipelining already worked. Two still fail (-drop-requests, -req-gc).
Moral: when a test produces NO output at all, suspect a missing EVENT before suspecting the
subsystem it appears to be testing. Three groundwork bugs are already fixed (each verified byte-identical
to `./out/Release/node`), but they were necessary-not-sufficient — the cluster needs the
remaining items below:

DONE:
- node 27's `keepAliveTimeout` default is **65_000**, not node's old 5000 (lib/_http_server.js:544).
- `Connection: keep-alive` + `Keep-Alive: timeout=N[, max=M]` are now emitted
  (ported from lib/_http_outgoing.js:470-495). Neither header was EVER sent before:
  `keepAliveTimeout`/`maxRequestsPerSocket` existed only as constructor assignments that
  nothing read — the same "declared once, never read" shape as `maxConnections`.
  **Grep for more of these: `grep -n 'this\.[a-zA-Z]* =' http.js` then check each has a reader.**
- **RFC 7230 3.5 leading-CRLF skip**: the tests write a stray `\r\n\r\n` after the body, which
  on a keep-alive connection lands as the next "request". Milo parsed it as a request with an
  empty method and undefined url and emitted a BOGUS 'request' event — the client got two
  responses for one request and the connection desynchronised. Now skipped like node.

STILL MISSING (the actual blockers — verify each against ./out/Release/node):
- `keepAliveTimeout` is emitted in the header but never ENFORCED: nothing arms a timer to
  close an idle keep-alive socket after N ms.
- `maxRequestsPerSocket` is advertised as `max=N` but never enforced: node answers the
  (N+1)th request on a connection with `Connection: close` and sets
  `maxRequestsOnConnectionReached` (see lib/_http_outgoing.js:478).
- HTTP pipelining (several requests in flight on one socket) — needed by
  -keep-alive-pipeline-max-requests.
Method: `MILO_LIFECYCLE_DEBUG=1` + compare a raw-socket transcript against
`./out/Release/node` side by side; the tests drive raw sockets, so a byte-diff of the two
transcripts localises it fast.

## 5g. NEXT LEVER: net.connect resolves in C, so 'lookup' never fires (~3 tests)

Failing and dependent on it: test-net-dns-lookup, test-net-dns-error, test-net-dns-custom-lookup.
(test-net-dns-lookup-skip already passes.)

Verified against `./out/Release/node`: node emits `'lookup'` ONLY for hostnames — an IP
literal emits nothing (checked: `lookup emitted: false`). Milo passes `host` straight to
`tcp.connect(fd, host, port)` (net.js ~:120), so getaddrinfo happens inside C and there is no
JS-visible resolution step to hook. Canonical: `lib/net.js:1468-1469`
`lookup(host, dnsopts, function emitLookup(err, ip, addressType) { self.emit('lookup', err, ip, addressType, host); ...`

Design (port from lib/net.js `lookupAndConnect`, do not invent):
```js
if (net.isIP(host)) { /* connect straight to the literal, emit NO 'lookup' */ }
else {
  const lookupFn = opts.lookup || require('dns').lookup;      // custom-lookup test needs this
  lookupFn(host, { family: opts.family || 0, hints: opts.hints }, (err, ip, family) => {
    this.emit('lookup', err, ip, family, host);               // fires even on error
    if (err) { /* destroy(err) — dns-error test */ } else { /* connect to ip */ }
  });
}
```
**RISK — why this was deferred:** it makes `connect()` asynchronous where it is currently
synchronous, and `connect()` is the most load-bearing function in net.js — every net (52) and
http (92) pass runs through it, plus `_onConnected`'s EVFILT_WRITE dance. Do it FIRST in a
session, never last, and run the full ladder (probes + net + http) before believing it.
Validate `opts.lookup` arity/behavior against node: it is called with (host, opts, cb).

## 5h. options.signal: half done (2026-07-16)

`net.connect({signal})` now destroys with AbortError/ABORT_ERR, byte-identical to
`./out/Release/node` for live and already-aborted signals (net.js connect()). **Gotcha that
cost a cycle:** `connect()` reassigns `port` from the options object to `opts.port` early, so
the signal must be captured while the object is still in scope (`_signalOpt`) — reading
`port.signal` after that point silently yields undefined and the fix does nothing.

**DONE — test-net-connect-abort-controller PASSES.** The real gap was that node honors
`signal` on `new net.Socket({signal})` as well (inherited from Duplex), and a connect-only
fix left the test's three constructor cases hanging forever. Shared `_addAbortSignal` helper
now used by both paths. Subtlety worth keeping: a PRE-ABORTED signal must register ZERO
listeners (nextTick the abort instead), while a live one registers exactly one — the test
asserts both counts.

**A WRONG GUESS, RECORDED AS A WARNING:** this section previously claimed the blocker was
leaked abort listeners needing node's disposable pattern. It was wrong — measured, node
leaves the identical 1 listener milo does. Checking against the oracle before implementing
is what caught it; acting on the note would have produced a fix that matched node LESS well.
**Scoped notes in this file are hypotheses, not findings — re-verify before acting on them.**

## 5i. WHAT'S ACTUALLY LEFT (measured 2026-07-16 end of session)

net 53/106 (5 timeout, 0 oom) · http 93/210 (18 timeout, 0 oom) · probes 9/9.
The one-line gaps are exhausted. Both remaining pools are concentrated in TWO real features:

**A. DNS lookup in connect — DONE 2026-07-16 (net 53->56, timeout 5->4).** Kept for the
lesson: the de-risk was keeping IP literals on the fully SYNCHRONOUS path (node skips
resolution for literals too), so only hostname connects went async. Even so it regressed
test-net-autoselectfamily-ipv4first — async connect means no fd exists when user code writes
right after connect(), and milo rejected those writes ('Socket is closed') where node buffers
them; pre-connect writes now park and flush from _onConnected. **The ladder caught that; two
individually-green tests had made it look safe.** Original design notes below.
`connect()` hands the hostname to C, so `'lookup'` never fires and hostname-error messages
are wrong (test-net-better-error-messages-port-hostname, -connect-options-port,
-dns-lookup, -dns-error, -dns-custom-lookup). **Do this FIRST in a session** — it makes
`connect()` async and every net (53) and http (93) pass routes through it.

**B. 100-continue — SERVER HALF DONE, client half blocked on an architectural gap.**
Done + verified byte-identical to the oracle: `checkContinue` dispatch, `res.writeContinue()`,
`res.writeInformation()` (http.js). Drive it with a RAW socket client and it works end to end.

**The real blocker is bigger than 100-continue: milo's ClientRequest buffers everything and
sends on `end()`, while node flushes the header block as soon as the socket is assigned.**
Proved: with `r.end()` never called, node's raw server saw `PUT / HTTP/1.1`; milo sent ZERO
bytes. 100-continue deadlocks by construction on that — the client waits for 'continue'
before calling end(), so the server never sees the request. Also needed once headers flush:
the client must parse an interim 1xx WITHOUT treating it as the real response and emit
**'continue'** (lib/_http_client.js:736-748 `statusIsInformational` -> `req.emit('continue')`,
`req.res = null`).
Scope: restructure the client write path to flush headers on socket assignment and stream the
body after. Same risk class as §5g (touches every http client path — 93 passes route through
it). **Do it FIRST in a session, with the full ladder after.** Blocks test-http-expect-continue
and test-http-write-callbacks.

Everything else in the http pool looks individually shaped (response-close, outgoing-buffer,
header-overflow, agent-remove, server-delete-parser). Triage each against
`./out/Release/node` before assuming it is milo's bug.

## 5j. THE http.js STUB/SHADOWING TRAP — hit FOUR times, check it FIRST

http.js is riddled with methods that exist but do nothing, and with classes whose
inheritance is not what you'd assume. Every time, the symptom was identical: **a correct-
looking fix that changed nothing**, and hours lost looking elsewhere.

Hit so far:
1. `ClientRequest.setTimeout` — a stub; and ClientRequest extends **EventEmitter**, NOT
   OutgoingMessage, so the OutgoingMessage.setTimeout I "fixed" was never reached.
2. `Server.setTimeout` — stored `_timeout`, nothing read it.
3. `ServerResponse.write/end` — override OutgoingMessage's, so guards added to the parent
   never ran; and they dropped the callback when passed in the 2nd position.
4. `OutgoingMessage.flushHeaders()` — an EMPTY `{}` stub; ServerResponse defined only
   `_flushHeaders`, so `res.flushHeaders()` resolved to the stub and sent nothing.

**Before editing ANY http.js method, run this and patch the class that is actually used:**
```
awk 'NR<=900 && /^class /{cls=$2} /methodName/{print NR": ["cls"] "$0}' src/milo/lib/http.js
grep -n 'class .* extends' src/milo/lib/http.js     # the inheritance is NOT what you assume
```
**THE ASSIGNED-BUT-NEVER-READ SWEEP — 4 for 4, do this early in any session.** Properties
that look implemented, read fine in the constructor, and do nothing:
```
for prop in $(grep -oE 'this\.[a-zA-Z_][a-zA-Z0-9_]* =' src/milo/lib/http.js | sed 's/this\.//; s/ =//' | sort -u); do
  a=$(grep -cE "this\.$prop =" src/milo/lib/http.js); u=$(grep -cE "\.$prop\b" src/milo/lib/http.js)
  [ "$u" -le "$a" ] && echo "$prop (assigns=$a, other-uses=$((u-a)))"
done
```
**7 for 7.** Found: `maxConnections` (servers accepted unboundedly); `keepAliveTimeout` +
`maxRequestsPerSocket` (no Connection/Keep-Alive header ever sent); `sendDate` (**no Date
header on ANY response** — RFC 7231 requires it); `localAddress`/`localPort` (undefined
though getSockName already worked); `METHODS` (35 of them, unused — the parser accepted
"GARBAGE NOT HTTP" as a request line); and **`_authority` — MY OWN**, in a fix I had already
shipped: the `:authority` default read a field nothing ever set, so it silently never fired.
**That last one is the point: a fix that reads a field into existence looks identical to one
that works.** Run this sweep on code you just wrote, not only on legacy.

**Sibling sweep — wrapper re-emits selectively (2 for 2):** `grep -n "_net\.on(\|_server\.on(" src/milo/lib/*.js`
then diff the forwarded set against node's documented events. Http2Server forwarded only
'error' (cost 4 attempts and made a whole test file emit ZERO bytes); http.Server likewise
never emitted 'connection'. **Any class wrapping another and re-emitting by hand is suspect.**
Caveats: plenty of false positives — public API props that only USERS read (`writableEnded`,
`headersSent`), and cross-file readers (`_unref` is read in `_timers_init.js`, not net.js).
Always confirm against `./out/Release/node` before "fixing". Still unswept: the Agent
(`maxSockets`, `keepAlive`, `freeSockets`, `maxFreeSockets`, `scheduling`, `maxTotalSockets`,
`totalSocketCount` all assigned, none read) — likely a stub Agent; and `maxHeadersCount`.

## 5k. SOCKET RECONNECT — unfinished, 3 attempts, handing off (2026-07-16)

`new net.Socket()` reused across two `connect()` calls is a real node idiom
(test-net-socket-local-address does exactly this). Node reconnects a destroyed socket:
`self._undestroy()` (lib/net.js:323) + clear `_handle`/`_peername`/`_sockname` (:1317).
Milo reset NOTHING, so the 2nd connect() hung.

Done (committed, harmless, insufficient): in `connect()`, if `this.destroyed` -> `_undestroy()`,
reset the readable state by hand, clear `_handle`/`_fd`/`_readPollRemoved`/`_pendingWrite`/
`_preConnectWrites`/`_peerDisconnected`/`_connecting`.

**PROGRESS: 'connect' now fires on a reused socket.** Two bugs found and fixed:
1. **The fd-reuse race, THIRD mask.** `_destroy`'s deferred eviction was guarded by
   `Socket._sockets.get(fd) === this` — which catches a DIFFERENT socket recycling the fd but
   is blind to the SAME socket reconnecting: the user's 'close' handler runs BEFORE
   _destroy's, so connect() re-adds the entry and the stale handler deletes the fresh one.
   An identity check cannot express "this fd, this connection attempt". Fixed with a
   per-attempt `_gen` counter, snapshotted in _destroy and re-checked before evicting.
2. **My own reset bug:** I wrote `rs.destroyed = false` where the field is `rs._destroyed`.
   JS silently created a new property; the readable side stayed dead. (The Duplex `destroyed`
   getter at stream.js:1121 ORs both states — check both.)

**STILL BROKEN (handing off):** the 2nd connection never emits 'close', so the go->close->go
chain stalls and test-net-socket-local-address still hangs. Verified state at +50ms after the
2nd connect is CLEAN: `inMap=true fd=5 connecting=false`, both _destroyed flags false, and
'connect' fired. So the connection is up; what fails is the teardown of the SECOND connection.
Next: does the server's FIN reach it — trace 'end'/EOF on the reused socket. Suspect a
readable-state field my hand-reset misses (see the _undestroy note below) or `_readPollRemoved`
/EOF-dereg state surviving the reconnect.

**RELATED LATENT BUG:** milo's `stream.js:1068 _undestroy()` resets only the WRITABLE state;
node's resets both sides. That is why the readable reset above had to be done by hand in
net.js. Fixing `_undestroy` properly is probably the right move — but it is stream.js, so
ladder net+http+timers after.

## 5l. SOLVED (2026-07-16, attempt 5). The spins are gone. Read the RESOLUTION first.

**RESOLUTION: the WRITE spin was never the disease — net.js drained TLS sockets at the RAW
TCP layer.** On EV_EOF, net.js called `recvBinary(fd)` directly, bypassing SSL, pushed null,
and deregistered reads via `_stopReading()`. But SSL usually has NOT seen its own EOF yet
(`sslRead` still reports WANT_READ), so the socket became unreadable forever and was never
destroyed — pinned in `_sockets`, io=true, loop never exits (`socks=[8] srvs=[]`). The WRITE
spin masked this by re-firing `_onReadable` until `sslRead` finally reported closed, so
teardown DEPENDED on the busy-loop. Remove the spin and teardown broke — which is why
attempts 1-4 each lost `connect-no-host` and looked like the spin was load-bearing.
Fix: on EV_EOF, a TLS socket drains via `_onReadable()` (SSL) and is then destroyed
unconditionally — TCP EOF ends the TLS session, there is no half-open TLS. With that in
place the READ-only handshake lands clean: **tls 23 PASS held, OOM 3 -> 0, spin CPU
9.2s -> 0.05s, net 57/5 unchanged, probes 9/9.**
Lesson: four attempts blamed the mechanism that EXPOSED the bug. A masked defect looks like
the unmasking change's fault. When removing X breaks Y, ask what X was silently doing FOR Y.

**Historical (attempts 1-4) — the reasoning that was wrong, kept deliberately:**
## 5l-old. THE LAST 3 SPINS — tls.js needs a redesign, not a patch (2026-07-16)

`test-tls-inception`, `test-tls-on-empty-socket`, `test-tls-reuse-host-from-socket` are the
ONLY spins left in 681 tests (everything else now sleeps). Signature:
`poll#200 fd=7 filter=-2 eof=false known=true destroyed=false` at **9.5s CPU** — a known
socket, EVFILT_WRITE re-firing forever on a stalled handshake.

**Cause:** tls.js registers EVFILT_WRITE for the handshake (`:157` client, `:230` server) and
only removes it on `result === 1` (success). Any other outcome — and a stalled handshake never
reaches success — leaks the registration onto an always-writable fd.

**MY FIX WAS WRONG. Do not repeat it.** I made the handshake drop WRITE when SSL reports
WANT_READ. It killed all 3 spins (9.5s -> 0.05s), TLS round-trip stayed green, and it looked
perfect — but it cost `test-tls-connect-no-host` (PASS -> TIMEOUT). A/B proved it:
reverting tls.js alone fixed that test; reverting net.js did not. **Why: milo drives the
handshake from `_onReadable`, which `_pollOnce` invokes for BOTH filters, so the WRITE
registration is load-bearing as a general wakeup — not merely SSL's WANT_WRITE signal.**
Trade measured: 3 OOMs eliminated for 1 pass lost. Rejected (pass count must not regress).

**SECOND ATTEMPT (2026-07-16), also reverted — but it measured the trade exactly.**
Did the full redesign: READ-only on both the client (`_onConnected`) and server (accept)
paths, WRITE added on demand via `_wantWrite(result === 3)` using entry.c's 2/3 signal.
**It works: all 3 spins died, 9.2s CPU -> 0.05s, and the TLS round-trip is fine over v4 AND
v6.** Measured: **tls 14 -> 12, OOM 3 -> 0** — i.e. -2 passes (test-tls-client-abort,
test-tls-connect-no-host) for -3 crashes. Rejected under the no-regression rule, same as
attempt 1 (-1 for -3). Consistency, not conviction: the rule exists to stop exactly this
rationalisation.

**Also found and reverted with it (SEPARABLE — worth redoing on its own):** `tls.connect` has
a DUPLICATE connect path that bypasses net.js entirely — `tcp.socket()` with **no family**
(v4-only), `'localhost'` hardcoded to `127.0.0.1`, and `dns.lookup(host, 4)` pinning family 4.
So TLS silently misses all the dns / IPv6 / autoSelectFamily handling. Fixing it in isolation
still costs test-tls-client-abort, so it needs its own investigation — but a duplicate connect
path WILL keep drifting from the real one.

**THIRD ATTEMPT (2026-07-16) — REVERTED, but it finally found the ROOT CAUSE. Read this
before attempting a fourth.**
Steps 1 and 2 below were cleared first: client-abort was fixed by the destroyed-guard, and
verification now exists (5p), so `connect-no-host` is a REAL pass, not a vacuous one. Landed
READ-only + `_wantWrite(result === 3)` on both paths. Result: **all 3 spins died (9.2s CPU ->
0.06s, OOM 3 -> 0)** and `connect-no-host` STILL broke (PASS -> TIMEOUT). tls 23 -> 22.
Reverted under the no-regression rule — third time.

**CORRECTION (same day): the root cause is in net.js, NOT the accept path.**
`nm_ssl_accept_continue` ALREADY returns -1 on peer-gone, so "the accept path has no EOF
handling" (below) was wrong — SSL never reports the error because EOF never reaches it. The
real culprit is net.js's `EV_EOF` branch: it drained raw bytes, pushed null and called
`_stopReading()` (deregistering READ) but NEVER destroyed the socket. Mid-handshake that
socket stays `_pendingTlsAccept=true` in `_sockets` forever -> io=true -> loop cannot exit.
TLSSocket overrides `_onReadable` and never reaches net.js's recvBinary EOF path while the
handshake is pending, so nothing else could notice. Fixed: destroy on EOF when a handshake is
pending (an unfinishable handshake has exactly one correct outcome). Neutral with the spin
present (net 57/5, tls 23/7/3 unchanged) because the spin masks it — its value is unblocking
the READ-only work.

**ROOT CAUSE as first recorded (partially wrong, kept for the lesson: I asserted a cause from
one trace without checking the C side, which already handled the case I claimed it didn't):** Traced with MILO_TLS_DEBUG + MILO_LIFECYCLE_DEBUG:
```
[tls] _onReadable fd=8 pendAcc=true   <- server handshake STILL PENDING when the client left
[lc] iter=18 io=true socks=[8] srvs=[]  <- fd 8 pinned forever, loop cannot exit
```
The client completes (`result=1`, verify OK) and destroys. The SERVER's accept handshake is
still at `result=2` (WANT_READ) and never completes: **the accept path has no EOF/stall
handling.** When the peer vanishes mid-handshake, `sslAcceptContinue` reports WANT_READ
forever, the socket is never destroyed, never leaves `_sockets`, and `io=true` pins the loop.

**Therefore the WRITE spin is LOAD-BEARING.** A connected socket is always writable, so the
spin re-fires `_onReadable` continuously, and THAT is what re-drives a stalled accept
handshake to completion. Removing the spin doesn't create the bug — it exposes it. This is
why all three attempts lost the same test. The spin is a splint over a missing EOF path.

**FOURTH ATTEMPT (2026-07-16) — the EOF-destroy prerequisite LANDED (a62e28329c6) and did
NOT unblock READ-only. `connect-no-host` still hangs. Do not assume it is now clear.**
With EOF-destroy committed, re-applying READ-only again gives: 3 spins dead (0.05s CPU) and
`connect-no-host` HUNG, `socks=[8] srvs=[]`. **No EV_EOF event arrives on fd 8 at all**, so
the EOF-destroy fix never fires. The pin is therefore NOT the mid-handshake EOF case.

**Next hypothesis to test (NOT yet confirmed — instrument before trusting):** fd 8 is the
server-ACCEPTED socket. The test's callback demonstrably runs (`srvs=[]` proves server.close()
executed, and the client asserted `authorized` and destroyed). So the client's fd closed and a
FIN went out — yet fd 8 sees no EOF. Either (a) fd 8's READ registration is already gone by
then, or (b) fd 8 ended normally (push(null) + _stopReading) but **nothing ever destroys it**
— net.js's EV_EOF path ends a socket without destroying it, and an orphaned accepted socket
whose server has closed has no one left to call destroy(). Under the spin it survives because
the WRITE re-fires keep driving it. Check (b) first: does milo auto-destroy on 'end' the way
node does (allowHalfOpen=false -> autoDestroy)? A TLSSocket may be missing that wiring.
Instrument fd 8's registration state + destroy path before writing any more code.

**Superseded plan (the accept path did NOT need this — see CORRECTION above):**
- detect peer-gone during handshake (`sslAcceptContinue` needs to distinguish a clean EOF /
  ECONNRESET from WANT_READ — the C side can check `SSL_get_error` for SSL_ERROR_ZERO_RETURN
  and SSL_ERROR_SYSCALL with a 0 read, and return a new code, e.g. -2)
- on that code, destroy the socket so it leaves `_sockets` and stops pinning the loop
- only then remove the WRITE registration; the spin will no longer be needed as a wakeup
A/B proof this is real: pre-5l tls.js exits clean on the same repro; READ-only pins fd 8.

**What the earlier attempts needed (steps 1-2 now DONE, kept for history):**
1. Find why `client-abort` depends on the current connect path — it is the cheaper of the two.
2. `checkServerIdentity` is absent (tls.js is 269 lines vs node's ~3000). `connect-no-host`
   uses `ca: cert` with rejectUnauthorized defaulting TRUE, and likely passes today only
   because milo skips validation and sets `authorized` unconditionally. Verify that before
   trusting it as a canary.
3. Then the READ-only handshake lands cleanly.

**The real fix is node's model:** register READ; write only when SSL asks (WANT_WRITE), using
the now-available signal from `nm_ssl_connect_continue`/`accept_continue` (2=want_read,
3=want_write — landed, unused). That means restructuring tls.js's handshake so it does not
depend on WRITE as a wakeup. tls.js is 269 lines vs node's ~3000; this is a redesign of its
event wiring, so do it FIRST in a session with the full ladder (net+tls+http) after.

Note `_wantWrite` bookkeeping gotcha if you rebuild it: the flag starts `undefined`, so a
naive `if (on === !!this._writeRegistered) return;` early-returns on the first
deregister-while-actually-registered and the fd spins anyway. Set the flag at EVERY pollAdd site.

## 5q. DONE (2026-07-16): tls.connect({socket}) implemented. tls 23 -> 25, TIMEOUT 10 -> 7.
Adopts the caller's socket: takes `inner._fd`, REPLACES the `_sockets` entry (one fd has
exactly one live owner — two owners is the 0a fd-reuse race), drops the connect-time WRITE
registration, then `_startTLS()` + READ. The caller's socket may not be connected yet
(on-empty-socket hands over a fresh `net.Socket()` and calls `socket.connect()` afterwards),
so adopt on 'connect' when `_connecting` or no fd yet; otherwise adopt on nextTick.
Fixed on-empty-socket + reuse-host-from-socket; wrap-econnreset-socket went TIMEOUT -> FAIL
(a hang became an honest failure). **test-tls-inception still hangs** — nested TLS-over-TLS,
a different problem; the duplicate connect path noted below is still NOT deleted.

## 5q-old. (original report)

After 5l killed the spins, `test-tls-inception`, `test-tls-on-empty-socket` and
`test-tls-reuse-host-from-socket` TIMEOUT instead of OOM. **They are not lifecycle bugs.**
Liveness dump shows them stalled mid-test, not at teardown — servers still open:
```
on-empty-socket:      io=true socks=[7,8,9]        srvs=[4]
inception:            io=true socks=[6,9,10,11,12] srvs=[4,5]
reuse-host-from-socket: io=true socks=[7,8,9]      srvs=[4]
```
Cause: **milo's `tls.connect()` never reads `options.socket`.** It unconditionally allocates
its own fd (`tlsSock._fd = tcp.socket(family)`, tls.js ~:209), so a caller-supplied socket is
silently ignored and the TLS socket connects nowhere -> nothing ever completes -> hang. All
three tests use `tls.connect({socket})`. This is a real node feature (HTTP CONNECT proxies,
STARTTLS, tls-over-anything) and the last thing keeping these three red.

**Work needed (a real implementation, not a patch):** adopt the caller's socket instead of
creating an fd — take `inner._fd`, transfer ownership in `net.Socket._sockets` (the fd-reuse
race in section 0a is the trap here: whoever holds the map entry must be the live owner),
re-register poll filters against the TLS socket, and handle the inner socket still being in
`_connecting` (defer `_startTLS()` until its 'connect'). Note tls.js ALSO has a duplicate
connect path that bypasses net.js (see 5l-old) — adopting `options.socket` is the natural
moment to delete it and route everything through net.js.

## 5r. SOLVED (2026-07-16, attempt 3): TLSSocket is a real stream now. pipe() over TLS works.

**pipe() over TLS received NOTHING before this** (40000 bytes -> 0). Now byte-identical to the
oracle. No test in the suite covers it, so the ladder shows ZERO change (tls 25/7, net 57/5,
probes 9/9) — the win is a real capability (`https.get(...).pipe(file)`), not a number.

**The bug was a 3-way interaction; two blind attempts failed before instrumenting.**
`push(null)` schedules 'end' on nextTick; stream.js gates that emit behind `!state._destroyed`
(:253); and BOTH tls.js's read loop AND net.js's EV_EOF path destroyed synchronously right
after. So 'end' was swallowed and every consumer waiting on it hung. Probe that cracked it:
```
DATA: "hello" flowing=true      <- data DID flow
@1s ended=true endEmitted=FALSE destroyed=true   <- 'end' swallowed by the destroy
```
Fix: read loop pushes (never emits 'data'/'end' by hand) and lets the stream own shutdown;
net.js's EV_EOF destroy is now skipped when `_readableState.ended` (autoDestroy finishes it).
NOTE the earlier red herring: `own "readable" prop? true` looked like accessor shadowing, but
milo's stream.js uses a plain `readable` property throughout (:173,:184,:212,:253) — that is
its idiom, not the bug. Chasing it cost an attempt.

**test-tls-inception STILL hangs** — it is a nested TLS-over-TLS proxy; separate problem.

## 5r-old. (history: the two failed attempts)

inception is a TLS proxy built on `pipe()` (`dest.pipe(socket); socket.pipe(dest)`, 40KB body),
so it needs TLSSocket to behave as a real stream. It does not: the post-handshake read loop
calls `this.emit('data', ...)` DIRECTLY, bypassing the stream machinery, so the socket never
enters flowing mode and `pipe()` never sees the data. net.Socket's read path already pushes.

**Tried the obvious one-liner (emit('data') -> push(), push(null) on EOF): REVERTED.** It
fixed nothing and BROKE test-tls-on-empty-socket (PASS -> hang). Reason: TLSSocket fights the
stream's own state — it assigns `this.readable = false` as a plain property (tls.js:128, 163)
alongside `super()` from net.Socket, so `_readableState` was never actually driving this
socket. Switching the producer to push() while the consumer side is still hand-rolled leaves
neither path working. **Do not retry the one-liner.**

**SECOND ATTEMPT ALSO FAILED (same day). Do not try a third variant of this.** Theory was
that attempt 1 broke because `this.readable = false` ran BEFORE `push(null)`, flipping
`_readableState.readable` so the push was swallowed. Removed the assignment, pushed cleanly.
Result: on-empty-socket STILL hangs, inception STILL hangs, and it additionally broke
test-tls-client-verify (PASS -> rc=1). Reverted. So the blocker is NOT the emit-vs-push site
and NOT the readable assignment ordering — something else in TLSSocket's inheritance is
preventing `_readableState` from ever driving it. **Instrument `_readableState`
(flowing/ended/length) on a TLSSocket before touching this code again** — two blind fixes
have now cost more than the finding is worth.

**What it actually needs:** make TLSSocket a real Readable — stop assigning `this.readable`,
let push()/push(null) drive `_readableState`, and delete the manual 'end' emit (push(null)
produces it). That is a real refactor of tls.js's read path, and per the adapter-over-refactor
rule it should WRAP net.Socket's existing push path rather than reinvent it. Verify against
BOTH on-empty-socket (hand-rolled `s.on('data')` consumer) and inception (pipe consumer) —
they exercise the two halves and the one-liner traded one for the other.

## 5m. NEXT UP — scoped, not started (2026-07-16 end of session)

Ranked by expected value. All verified against `./out/Release/node` unless noted.

**1. http2 setTimeout: 5 stubs, 3 real roots.** `Http2Stream:113`, `Http2Session:326`,
`Http2Server:523` are the playbook-5j shape (register the cb, arm nothing);
`Http2ServerRequest:413` and `Http2ServerResponse:492` correctly delegate to the stream, so
fixing the stream fixes them. **Do NOT just arm a timer** — copy net.js's `_armTimeout`
model: **unref'd** (or it pins the loop for the full duration), **rearmed on activity** (or
the ubiquitous `setTimeout(60000, mustNotCall)` guard fires spuriously), **cleared on
destroy**. Getting this wrong in net.js cost a passing test until it was made idle-based.
Auditor estimated ~10 of 35 http2 timeouts; net.js experience says expect fewer.

**2. dgram udp6 — 10 tests.** `createSocket('udp6')` silently returns an IPv4 socket (binds
0.0.0.0; sends fail). Node binds ::1. Real binding work: `udpSocket` hardcodes AF_INET
(tcp.milo ~:829) and bind/send/recv each build a 16-byte `sockaddr_in`; IPv6 needs
`sockaddr_in6` (28B) threaded through all four. Rebuild required.

**3. tls.js handshake redesign — the last 3 spins in 681 tests.** See §5l. My patch traded
3 OOMs for 1 pass and was reverted; the auditor's "~10-line JS fix" estimate is wrong.
`entry.c` now returns 2=WANT_READ / 3=WANT_WRITE (landed, unused) — the prerequisite.

**4. http client header flushing — blocks 100-continue.** See §5i-B. milo buffers the whole
request until end(); node flushes headers on socket assignment. Server half already done.

**5. Socket reconnect — 'close' never fires on the 2nd connection.** See §5k; groundwork
landed, trace recorded.

**6. active-handle model** (ROADMAP). Not required by any current failure — the auditor
measured ~0-5 loop-flippable tests across 681 — but it structurally kills the bug class that
produced 4 races today (incl. the fd-reuse race, which wore three different masks).

## 5n. write-early-hints — SOLVED: a missing EVENT FORWARD, not any of my four theories

**Cause:** `Http2Server` wraps a `net.Server` and forwarded only `'error'`. `'listening'`,
`'close'` and `'connection'` fired on the INNER server and never reached the http2 one. The
tests do all their work inside `server.on('listening')` -> zero bytes, all 3 blocks.

**Why it survived four attempts:** `listen(0, cb)` works (the cb registers on the inner
server), so every repro I wrote passed while the tests hung — I was comparing two different
code paths without noticing. The four theories (writeEarlyHints missing, `:status` a string,
IPv4-only listener, ENOTCONN) were each REAL bugs, all found and fixed, and none was this.

**RULE (this has now cost me twice — see also the missing 'ready' event):** when a test emits
NO output at all, suspect a missing EVENT before suspecting the subsystem under test. And
when a repro passes but the test hangs, check that the repro uses the SAME API shape —
callback form vs `.on(event)` are different code paths.
**Sweep worth doing:** any class that wraps another and re-emits selectively is suspect. Grep
for `_net.on(` / `this._server.on(` and compare the forwarded set against node's docs.

### (historical) original notes below

`test-http2-compat-write-early-hints{,-invalid-argument-type,-invalid-argument-value}`.
Every ingredient verified working standalone against `./out/Release/node`:
`res.writeEarlyHints({link})` returns true and sends a 103; the client emits 'headers' with
`:status === 103` (number) then 'response' with 200; `client.request()` with no args works;
`http2.connect('http://localhost:PORT')` connects.

**But the tests emit ZERO bytes** — they hang before any output, across all 3 blocks. NOT the
early-hints logic. One suspect (ENOTCONN, §5o) is now FIXED and did not unblock them. The
remaining one is confirmed and is the top open item:

**MILO IS IPv4-ONLY AND SILENTLY LIES ABOUT IT.** Verified:
`net.createServer().listen(0, '::1')` reports `{"address":"0.0.0.0","family":"IPv4"}` — it
ACCEPTS the IPv6 address and binds IPv4 anyway. Node reports `{"address":"::1","family":"IPv6"}`.
`net.connect(port, '::1')` then "succeeds" only BY ACCIDENT: `inet_pton(AF_INET, "::1")` fails,
leaving the sockaddr at 0.0.0.0, which happens to reach localhost. Two consequences:
- `listen(0)` (no host) binds 0.0.0.0 where node binds `::` (dual-stack). Tests that then
  connect to `localhost` — which now correctly resolves to **::1** since the dns-in-connect
  work — are an IPv6 client against an IPv4 listener held together by the inet_pton accident.
- Same root as dgram udp6 (§5m #2): `createSocket('udp6')` also silently returns IPv4.

**The fix is one project, not two:** real AF_INET6 support in tcp.milo — `sockaddr_in6` (28B)
threaded through socket/bind/connect/accept/getsockname/getpeername and the udp equivalents,
plus honest family reporting. Rebuild required. It unblocks the early-hints trio, ~10 dgram
udp6 tests, and every `listen(0)`+`localhost` test in the suite. **Also add errno 57
(ENOTCONN) to `_CONNECT_ERRNO` in net.js — it currently surfaces as `ERR UNKNOWN`, which is
what made §5o hard to see.**

## 5o. ENOTCONN ON WRITE-BEFORE-CONNECT — FIXED (2026-07-16). Kept as a worked example.

**Repro (30s):** 3 concurrent http2 servers on 127.0.0.1 →
`ERR code=UNKNOWN errno=-57 syscall=write`. -57 is **ENOTCONN**. One server usually works;
concurrency makes the window reliable.

**Cause — mine.** Fixing the variadic `fcntl` bug (commit 37c76878a8a) made sockets genuinely
non-blocking, which is correct. But **connect() is always async (EINPROGRESS)**, and http2
writes its connection preface immediately, before 'connect' fires. Blocking sockets made that
work BY ACCIDENT: `write()` on a connecting socket simply blocked until it connected. Now it
returns ENOTCONN. (`_preConnectWrites` only covers `_fd < 0`, i.e. the async-DNS case — I
reasoned about connect being async *because of DNS* and missed that it is always async.)
It surfaces as `ERR UNKNOWN` only because `_CONNECT_ERRNO` does not map 57 — worth adding.

**My fix, and why it was reverted.** Parking every write while `this._connecting` (not just
when `_fd < 0`) fixes it — verified: "all 3 OK". But it MEASURED **net 56->55, http 96->94,
http2 36->37 = net -2**, so it was reverted per the no-regression rule.
The break is `bytesWritten` accounting: node counts every byte handed to `write()` INCLUDING
data still buffered in the stream (its getter adds `_pendingData` to a dispatched counter),
whereas milo increments `_bytesWritten` inside `_sendFrom`, i.e. only when bytes reach the
kernel. Parking makes those bytes invisible. `test-net-socket-byteswritten` corks, writes
twice and asserts *while corked*: expects 7, milo reports 3. I tried counting at `_write`
entry and adding `_writableState.length` in the getter; neither matched — **do this properly
by porting node's dispatched+pending model, THEN re-apply the parking fix.**

**RESOLVED next iteration by following the note above.** Port node's model FIRST
(`_bytesDispatched` + sum of the chunks still in `_writableState.buffered` — NB
`_writableState.length` is NOT a byte count in milo, which is what both earlier guesses got
wrong), THEN the parking fix drops in: byteswritten 3/3 green AND 3 concurrent http2 servers
go from ERR UNKNOWN(-57) to "all 3 OK", with net 56 / http 96 / http2 36 all held.

**Why this section is worth keeping:** the fix WORKED the first time ("all 3 OK") and still
measured -2. Only the full ladder caught it. Reverting + writing down the exact cause cost one
iteration and produced a clean landing; shipping it would have cost 2 tests and hidden the
accounting bug. A reverted fix plus an accurate note beats a shipped regression.

## 5p. SECURITY: milo's TLS client verifies NOTHING (2026-07-16)

```
self-signed cert, rejectUnauthorized left at its default (TRUE):
  node:      REJECTED: UNABLE_TO_VERIFY_LEAF_SIGNATURE
  milo-node: CONNECTED, authorized = true, authorizationError = undefined
```
**Every `tls.connect()` is effectively `rejectUnauthorized: false`, while the API reports
`authorized = true`.** `checkServerIdentity` does not exist in tls.js (0 hits); nothing calls
`SSL_get_verify_result`; `authorized` is set unconditionally at the two handshake-success
sites. A MITM is undetectable, and code that checks `socket.authorized` is actively misled.
This is not a compat gap — do not run this TLS client against anything untrusted.

**FIXED 2026-07-16** (tls 22->23 PASS, 8->7 TIMEOUT, zero regressions). Landing it required
three fixes, inseparable — verification alone would have broken every `ca:` test:
1. `nm_ssl_verify_result` + per-connection `ca:` via `SSL_set1_verify_cert_store`. Key point:
   OpenSSL computes the chain result even under the default SSL_VERIFY_NONE (that mode only
   means "don't abort the handshake"), so verify mode is untouched and enforcement stays in JS
   under rejectUnauthorized, as in node.
2. `createSecureContext: () => ({})` was a stub that ATE the ca — tests pass it via
   `tls.connect({secureContext})`. The 5j stub trap again.
3. **The server never sent its intermediate chain.** `SSL_CTX_use_certificate` loads only the
   leaf; agent6-cert.pem is leaf + the ca3 intermediate. milo servers had ALWAYS sent
   incomplete chains — clients could not bridge to a root they trusted and reported
   UNABLE_TO_GET_ISSUER_CERT_LOCALLY. Verification is what made a long-standing bug visible.

`test-tls-connect-no-host` still passes and is now a REAL pass (its `ca: cert` path works),
so the 5l READ-only handshake no longer trades anything away — revisit it.

**Original fix shape (kept for reference):** `SSL_get_verify_result(ssl)` after the handshake completes (a small C wrapper
next to nm_ssl_connect_continue; X509_V_OK == 0). Set `authorized`/`authorizationError` from
it, and when `rejectUnauthorized !== false`, destroy with the mapped error instead of
emitting 'secureConnect'. Then port `checkServerIdentity` (hostname vs CN/altnames) — node's
lives in lib/tls.js. `ca:` handling needs SSL_CTX_load_verify_* on the client ctx.

**It also settles the 5l trade.** `test-tls-connect-no-host` asserts `socket.authorized` —
which milo hardcodes true, so it **passes vacuously**. With test-tls-client-abort now fixed
(the destroyed-guard), the READ-only handshake's real cost is ONE vacuous pass for THREE
OOM crashes. Re-run that trade once verification lands and the pass means something.

## 5b. a real bug found outside node-milo (worth reporting upstream)

`~/.local/bin/timeout` is a **milo-built** tool (`timeout (milo) 1.0.0`) and it does not
kill its child on expiry — it returns 124 and leaves the process running. Reproduce:
```
timeout 2 ./out/Release/milo-node -e "require('net').createServer().listen(0,()=>{})"
pgrep -f milo-node    # still there
```
Real GNU timeout kills. This is a milo stdlib/tool bug, not a node-milo bug — but it
silently corrupts any test methodology built on `timeout`.

## 6. after the core fixes land (in order of expected yield)

1. Re-run probes + net. Expect p01/p02/p04 green and several of these to flip:
   test-net-connect-options-port, test-net-server-max-connections(+close-makes-more),
   test-net-write-* (4 tests), test-net-socket-close-after-end / -local-address /
   -writable (the 3 OOMs), test-net-throttle, test-net-connect-abort-controller.
2. Server 'close' semantics: defer emit until all connections gone (real node behavior)
   — count live connections per server, emit on last socket close. Check
   test-net-server-close* tests.
3. `--module http` re-run: http timeout/abort tests were blocked on socket lifecycle.
4. Then `--module tls` and `--module cluster` (same underlying sockets).
