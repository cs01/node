# event-loop lifecycle playbook (self-contained — no human needed)

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

## 1. probe harness (acceptance tests — run first, run after every change)

```
bash src/milo/lifecycle-probes/run-probes.sh
```

Status at baseline:
| probe | status | meaning |
|---|---|---|
| p01 graceful end, server.close from client side | **FAIL (OOM busy-loop; server.close cb never fires)** | primary target |
| p02 socket/server unref | **FAIL (hang)** | unref broken for TCP |
| p03 graceful end, server.close from server side | PASS | graceful path CAN work |
| p04 destroy path | **FLAKY** (passed standalone, OOM under harness) | race in fd deregistration |
| p05 close idle server | PASS | |
| p06 timer unref | PASS | timers are fine — don't touch |
| p07 open server keeps process alive | PASS (exit 124 = correct) | don't break this while fixing exits |
| p08 http roundtrip + close exits | PASS | don't regress |
| p09 data/end/close event sequence | PASS | FIN→'end' wiring works — don't touch stream.js first |

p01 vs p03 differential is the sharpest clue: same graceful FIN/FIN traffic; only the
*context* of the `server.close()` call differs. p03 (called from server-side socket
'close' handler) exits clean; p01 (called from client-side 'close' handler) busy-loops
and the close callback NEVER fires — not even early. Something about that emit path
throws or never runs.

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

**H1 (primary): EOF'd fd left in kqueue → level-triggered EV_EOF storm.**
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

**H2: something THROWS inside the client-'close'-handler → server.close() context.**
In p01 the `server.close(cb)` cb never fires even though `net.js:399` does
`process.nextTick(emit('close'))` unconditionally — strong smell that `server.close()`
itself throws before reaching the nextTick (e.g. pollRemove/close on an fd in a weird
state), and the exception is swallowed by the 'close'-event emit machinery.
Confirm: wrap the p01 `server.close()` call in try/catch in the probe — if you catch
something, you've found it. Also add try/catch logging inside `Server.prototype.close`.

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
