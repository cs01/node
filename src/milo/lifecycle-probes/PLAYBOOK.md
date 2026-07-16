# event-loop lifecycle playbook (self-contained — no human needed)

## READ FIRST: four traps that will fool you (learned the hard way, 2026-07-16)

1. **Validate every probe against real node before believing it.** `node <probe>` is
   installed (v25.3.0) and is the ONLY ground truth. Two of the original nine probes
   asserted the wrong thing: p01 and p02 hang in REAL NODE too (p01's server never reads
   the buffered data, so 'end' correctly never fires; p02's accepted server-side socket is
   never unref'd). Milo matched node and I called it a bug. **A "hang" is often correct.**
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
