# milo-node compat roadmap

Goal: 100% Node.js runtime compatibility.
Test only the module you're fixing: `./out/Release/milo-node -e "..."`.
Full build: `bash src/milo/build.sh`

Only outstanding work is listed. A module/feature not here is assumed passing.

## bun compat scoreboard

Bun targets 2,185 of Node's 3,979 `test/parallel/` tests (55%). They skip entire subsystems:
repl, inspector, debugger, diagnostics_channel, domain, permission, trace, snapshot, test runner.
We use their curated subset as our primary compat benchmark.

Run safely: `bash test_safe_runner.sh --compat --module <mod>` (root runner — ulimit -v + ulimit -u + RSS watchdog + forkbomb kill).
The per-module `zsh src/milo/test-compat.sh` only caps V8 heap + wall-time — NOT off-heap mem or proc count, so it can OOM/forkbomb on child_process/cluster/large-file tests.
List: `src/milo/bun-curated-tests.txt` (2,143 tests present in our repo)

### current pass rates (snapshot 2026-05-30; fs+stream re-tallied 2026-07-15 — fs jumped 99→174, so overall is meaningfully above 36% but full suite not re-run)

Overall: **milo 36%** (full run: 782/2143 pass, 1159 fail, 197 timeout, 5 OOM).
36% is test-weighted across all 30+ modules: the big low-scoring modules (http 210, http2 165, stream 156, crypto 94, child 85, tls 82) dominate the total, so 100% on small modules (buffer 63, process 57) barely moves it.

| module     | pass/total | rate | priority | top blockers |
|------------|-----------|------|----------|--------------|
| event      | 27/28     | 96%  | low      | capture-rejections avoidLoop: when ee[captureRejectionSymbol] async handler itself throws, _err2 must surface as unhandledRejection; works in isolation, fails only in the 8-fn nextTick chain (rejection-tracking during nested tick drain). bootstrap event-loop issue, not events.js |
| require    | 17/19     | 89%  | low      | preserve-symlinks flag, delete-array-iterator |
| module     | 21/26     | 80%  | high     | .node dlopen, circular-dep warning, main-fail stderr |
| worker     | 40/53     | 75%  | low      | heap-snapshot, wasm transfer, type-check/workerdata validation, message-port receive/transfer |
| console    | 9/14      | 64%  | med      | write-error propagation, tty colors, revoked proxy |
| readable   | 3/5       | 60%  | med      | from-web (web streams getReader); Readable.from async-iter error timing |
| v8         | 3/5       | 60%  | —        | mostly passing |
| diagnostics| 10/17     | 58%  | low      | tracingChannel+ALS async propagation, udp |
| util       | 10/19     | 53%  | med      | inspect getters/showHidden, callbackify, deprecate |
| fs         | 174/201   | 86%  | high     | re-tallied 2026-07-15 (was 99 in May snapshot); 25 fail + 2 timeout left: errno fidelity (access EACCES→ENOENT mislabel, readfile-error EIO), readdir withFileTypes .map, watchfile/patch-open timeouts |
| timers     | 45/55     | 82%  | low      | **MEASURED 2026-07-16.** the old "51" was stale drift, not a regression (verified identical with and without the lifecycle fixes) |
| whatwg     | 19/41     | 46%  | med      | URL↔searchParams live-sync, TextDecoder, webstreams |
| stream     | 75/156    | 48%  | high     | re-tallied 2026-07-15; async-fn map/flatMap, web streams, pipe edge cases |
| http       | 97/210    | 46%  | high     | **MEASURED 2026-07-16, HONEST COUNT.** pre-session 79 (oom 11, timeout 40). now **96, oom 0, timeout 15** — honest, unlike the mid-session 87 which included ~5 false passes from swallowed handler exceptions. next: 100-continue (checkContinue/writeContinue absent), keepAliveTimeout/maxRequestsPerSocket advertised but not ENFORCED (playbook 5f), header-parse clientError |
| net        | 58/106    | 55%  | high     | **MEASURED 2026-07-16.** pre-session 44 (oom 3, timeout 12). session: **44->56, oom 3->0, timeout 12->4**. Socket DOES extend Duplex already — that blocker is stale. dns-lookup lever DONE. remaining 4 timeouts: write-slow, listen-fd0, local-address, connect-options-port |
| zlib       | 18/56     | 32%  | high     | ZstdDecompress, flush/params |
| vm         | 18/71     | 25%  | low      | real contexts landed; marshaling fidelity (descriptors/globals) next |
| cluster    | 20/54     | 37%  | low      | **MEASURED 2026-07-16 with `--compat --module cluster all 8 400`** (the default `ulimit -u 30` makes every fork fail EAGAIN — see playbook trap 5b). worker-side cluster.worker is now a real Worker (was a bare {id}): 17->20. 18 timeouts left |
| tls        | 18/82     | 21%  | med      | connection lifecycle, error codes |
| child      | 24/85     | 28%  | med      | **CORRECTED 2026-07-16: 24/85.** my earlier "really 2/85!" was MY OWN ARTIFACT: test_safe_runner.sh sets `ulimit -u 30` but RLIMIT_NPROC is PER-USER and this box has ~283 ambient procs, so every fork/spawn inside every test failed EAGAIN. child is 85/85 fork-dependent. **Measure fork-dependent modules with `--compat --module child all 8 400`.** The recorded 17 was closer to truth than my measurement, and reality is BETTER than recorded — the opposite of the "baselines rot optimistically" story. child.send, spawn edge cases |
| crypto     | 19/94     | 20%  | med      | ECDH, sign/verify gaps |
| dgram      | 12/64     | 19%  | low      | **MEASURED 2026-07-16.** binary corruption FIXED (udp was utf8 in both directions — every non-utf8 byte became U+FFFD on the wire; no test caught it). remaining: **udp6 is silently IPv4** — createSocket('udp6') binds 0.0.0.0 and sends fail (node binds ::1); 10 dgram tests need it. Real binding work: udpSocket takes AF_INET only (tcp.milo ~:829), and bind/send/recv all build a 16-byte sockaddr_in — IPv6 needs sockaddr_in6 (28B) through all four. Also: no-op ref/unref, multicast |
| http2      | 44/165    | 27%  | low      | **MEASURED 2026-07-16.** frame codec + HPACK exist and the round-trip matches the oracle byte-for-byte — the gap is missing surface, not a broken protocol. :method/:authority/:scheme defaults FIXED. setTimeout stubs FIXED (Http2Stream + Http2Session roots; Request/Response delegate). next: writeEarlyHints, and 33 timeouts to triage — each is one live handle + one missing js event (auditor's live sampling) |
| readline   | 2/17      | 11%  | low      | interface, cursor |
| async      | 1/18      | 5%   | med      | async_hooks createHook tracking (ALS propagation DONE) |
| dns        | 1/22      | 4%   | low      | Resolver class |
| webcrypto  | 0/11      | 0%   | low      | subtle crypto gaps |

## quick wins (biggest compat % gain per effort)

### error codes (cross-module) — see `## real-world tool/framework compat (verified vs oracle, 2026-07-16)

Running actual tools is the truest compat signal — it found 8 app bugs the 2143-test suite
missed. Verified working under milo (output identical to ./out/Release/node):
  SERVERS/HTTP: express, fastify, koa, socket.io (real-time), ws, http/https/http2
  CLIENTS:      axios, undici, ioredis, node-fetch, native fetch
  TOOLS:        eslint, rollup, mocha
  DATA/CRYPTO:  pg (postgres client), jsonwebtoken, handlebars, sharp, @node-rs/argon2,
                @napi-rs/uuid, sqlite3 (napi), prisma
  LOGGING:      pino
  APP:          a full express+prisma+sqlite3+trpc backend serves real traffic
NOT working (all one root cause — no real ESM loader, regex _esmToCjs can't handle complex
ESM; see below): tsc, prettier, marked, got (got is ESM-only so node can't require it either).
Minor: a type:module package required from CJS gives a confusing SyntaxError where node gives
ERR_REQUIRE_ESM — milo tries to transform it instead of refusing. Low value.

## critical

### [x] http.Server.listen({port,host}, cb) fired no callback — fastify hung (FIXED)
The options-object listen form was parsed as a positional port, so the object landed in
`port`, got passed to net.listen as a bogus arg, and the callback was lost. fastify (and most
frameworks) call listen({port,host}) and await that callback — so fastify.listen() hung
forever after boot. Now the object form is parsed. fastify fully works (boots, listens,
serves {"ok":true}). No compat-number change (no suite test covers it); the -1 seen was a
flaky test-http-byteswritten timeout, unrelated (A/B confirmed it times out without the change
too).

### prettier fails: dynamic import()'s referrer is ALWAYS bootstrap.js (root cause found)
`import('../internal/legacy-cli.mjs')` fails because milo cannot resolve a RELATIVE dynamic
import against the importing module. ROOT CAUSE (confirmed): V8's DynamicImportCallback
resource_name (deps/v8capi/src/v8capi.cc DynamicImportCallback) is ALWAYS the bootstrap eval
context, not the importing module — because milo loads every module via (0,eval)(wrapper) and
does not give each module its own host-defined-options/resource_name. Even a MAIN-module
`import('./x.mjs')` resolves to src/milo/runtime/x.mjs. Plumbing resource_name through to the
handler (tried, reverted) does NOT help — the value itself is wrong. Two real fixes, both
non-trivial: (a) rewrite `import(` in each loaded module's source to `__dynamicImportHandler(
spec, __filename)` so the referrer is the correct module path (fragile: import( in strings);
(b) give each eval'd module correct host-defined-options carrying its resource_name (proper).
import.meta.url/.dirname/.filename and the ESM createRequire pattern now work (marked still fails on an export form the regex misses — complex ESM, needs the real loader). eslint now FULLY WORKS (lints real code, output identical to node) after the ?query strip below; tsc needs a real ESM loader (below). Found running real CLI tools.

### milo has no real ESM loader — only a regex CJS transform
`_esmToCjs` (bootstrap.js) line-by-line regexes import/export into require/exports. It now
also runs as a fallback when a .js file fails as CJS with a SyntaxError and contains
import/export (node-27-style syntax auto-detect) — so SIMPLE ESM-syntax .js files load. But
COMPLEX ESM (typescript's lib: dynamic import, import.meta, deep re-exports, TLA) exceeds the
regex and still fails — `tsc` does not run. A real ESM loader (V8 SourceTextModule / proper
module linking) is the fix; large. Found running the TypeScript compiler under milo.

### [x] chainControl/roadConditions route hang — FIXED (0ae226c8c61)
A PassThrough whose input finished before a consumer attached self-destroyed on writable
'finish' while data was still buffered, so 'end' never fired. stream.js autoDestroy was gated
on rState.ended (push(null) seen) instead of rState.endEmitted ('end' delivered). The app's
node-fetch v2 pipes the response through res.pipe(new PassThrough()) and attaches
data/end listeners LATER (on response.text()) — by then the body had arrived and the stream
was destroyed with data stranded, so all 6 caltrans awaits hung and the resolver wrote 0
bytes. One-line fix (stream.js:1007 endEmitted not ended). MY LOCALIZATION HAD A GAP: I traced
GLOBAL fetch and proved "all fetches resolve", but this route uses node-fetch v2 (https.request
+ PassThrough), a path my instrument never saw. Live route now 200/236440 valid; probes 9/9;
net 57. Same stream-lifecycle family as 5531a4f4107 but a distinct condition.


### large gzipped trpc/express responses truncate at ~57KB gzip (~899KB decoded) — NOT YET FIXED
A real app (express + compression + trpc): a single large procedure's gzipped response is cut
to ~57KB gzip / ~899KB decoded (node: 65KB / 1014KB, valid); the gzip stream is truncated so
it won't fully decompress and the block renders blank. NOT the batch and NOT the failing
driveTime procedure — `webcams` alone truncates identically. Uncompressed is byte-perfect.
RULED OUT (all deliver fully, verified vs oracle): raw net.Socket many-writes; http keep-alive
many-writes; createGzip .pipe(res); createGzip write+Z_SYNC_FLUSH; bare express+compression
res.json (494KB gzip delivered whole). The 3 truncation bugs fixed 2026-07-16 (zlib 16KB
output cap x2, http Connection:close destroy-before-drain) did NOT fix this one.
**KEY LEAD for next session:** instrumenting milo's ServerResponse chunked write path
(MILO_RES_DEBUG) produced ZERO hits on the app's response — so express+compression+trpc writes
the body through a DIFFERENT path than ServerResponse._chunked. Find that path first (likely a
res.end(buffer) or a Content-Length branch, or express overriding res.write); the drop is
there, not in the chunked framing every synthetic test exercised.

### [~] https server: POST bodies now buffer to Content-Length (PARTIAL fix 2026-07-16)
Was the single worst lie: the hand-rolled parser fired 'request' + push(null) on the FIRST
data chunk containing the header terminator, dropping any body in a later TLS record and
answering 200 on an empty body; `buf += chunk.toString()` also mangled binary. Now
accumulates a Buffer until Content-Length is satisfied. VERIFIED: 1000-byte POST 0->1000,
3000-byte binary intact, GET unaffected. STILL a duplicate parser (https.js) separate from
http.js's real one — so no chunked request bodies, one request per connection (buf not reset),
duplicate headers collapsed. The right fix is to delete this parser and drive http.Server's
connection listener over tls sockets; that is a session. The https CLIENT (https.js:91-156) is
a THIRD parser that collapses set-cookie and pins IPv4 — also unfixed.

### [x] zero-length Buffer crashed crypto/zlib input paths (FIXED 2026-07-16)
An empty Buffer has a null data pointer, but crypto.milo:66 and zlib.milo:27 treated null as
failure and bailed, so sha256(Buffer.alloc(0)) and gzip(Buffer.alloc(0)) crashed where node
returns e3b0c442... and 20 bytes — everyday ops (etag of empty body, compression of empty
response, hash of empty file). Fixed: bail only when len>0 && ptr==0. Monotonic by
construction — only empty-buffer inputs change path. Output/handle sites (outBuf/sigBuf/handle)
were deliberately NOT touched: there a null is a real malloc/init failure. ~16 other sites
share the `as i64 == 0` grep but are output sites — do not sweep them blindly.

### [x] http2 trailers — FIXED 2026-07-16 (gRPC status now works)
Three defects: _onHeaders treated a trailing HEADERS block as a second response (so trailers
vanished with no event and no error); sendTrailers/waitForTrailers/'wantTrailers' did not
exist, so a server could not send them either; and get trailers() returned {} unconditionally,
which is indistinguishable from a legitimate response with no trailers. Verified identical to
the oracle in both directions. Ladder-neutral (http2 43 PASS both sides of an A/B, zero
per-test diffs — no test in the suite covers trailers).
TRAP: with waitForTrailers, END_STREAM must ride the TRAILERS frame, NOT the final DATA frame
— set it on DATA and the stream closes before trailers can be sent, so the fix looks
implemented and does nothing.

### (original report) http2 silently drops trailers — breaks gRPC
A server calling `stream.sendTrailers({'grpc-status':'0'})` produces NO 'trailers' event on
the client and no error: node fires it with the values. **gRPC carries its status in
trailers**, so every gRPC call would complete with no status. `get trailers() { return {} }`
and `get rawTrailers() { return [] }` (http2.js:483-484) are the visible half — they report an
empty object rather than admitting nothing was parsed. VERIFIED against the oracle
2026-07-16.

### stub sweep: other fns that return a plausible constant instead of failing
Found by grepping lib/*.js for bodies that are just `return <constant>` (the pattern behind
most of 2026-07-16's bugs: a stub that CLAIMS success rather than failing loudly). UNVERIFIED
— confirm against the oracle before acting:
- `async_hooks.js:143 executionAsyncResource() { return {}; }`
- `worker_threads.js:129-130 get stdout()/get stderr() { return null; }` (node exposes real
  streams when stdout:true/stderr:true is passed)
Most other hits in that grep are legitimate (proxy traps, loop predicates) — do not "fix" them.

### [x] tls client swallows a fatal alert — FIXED 2026-07-16
Root cause was NOT the handshake branch (that diagnosis is preserved below because the
obvious fix there is dead code). It was sslRead's binding: nm_ssl_read already returned -1
FATAL / 0 clean-EOF / -2 WANT_READ correctly, but tcp.milo collapsed -1 and -2 into the same
empty Uint8Array — "nothing to read yet". So a fatal alert read as "try again", the caller
waited, and the socket closed with NO error. Now null = fatal (distinct from undefined =
clean EOF and empty array = retry), which needed retNull added to v8.milo — v8c_fci_return_null
existed in v8capi but was never exposed, which is likely WHY the branch was collapsed.
Verified: node ERR_SSL_TLSV13_ALERT_CERTIFICATE_REQUIRED / milo ERR_SSL_HANDSHAKE_FAILURE
(was silence). Original diagnosis:

### (original) tls client swallows a fatal alert entirely — no error, just a silent close
A client rejected by the server reports NOTHING: node gives
`ERR_SSL_TLSV13_ALERT_CERTIFICATE_REQUIRED`, milo emits no error at all and just closes.
Root cause: in TLS1.3 the client's handshake COMPLETES (sslConnectContinue returns 1,
secureConnect fires) and the server's alert only arrives on the next READ — so the
`result === -1` branch is never taken, and sslRead cannot distinguish a fatal alert from a
clean EOF: it returns undefined for both, so tls.js pushes null and destroys silently.
DO NOT "fix" this by adding a reason to the result===-1 branch — that branch is dead for this
case (verified: adding it changed nothing). The fix is in sslRead's CONTRACT: SSL_read
failing with SSL_ERROR_SSL must be distinguishable from SSL_ERROR_ZERO_RETURN, e.g. a
distinct return code carrying ERR_get_error, so the read path can destroy WITH an error.
This is the client-side twin of the tlsClientError gap just fixed on the server.

### [x] tls client sends its certificate — mutual TLS works (FIXED 2026-07-16)
Was: tls.connect({cert,key}) dropped both, so an mTLS client presented NO certificate and
silently connected unauthenticated. Now SSL_use_certificate + SSL_use_PrivateKey PER-SSL
(the client ctx is shared process-wide — SSL_CTX_use_* would attach one caller's private key
to every other connection), draining the whole PEM via SSL_add1_chain_cert so a bundled
intermediate is sent too. Verified against node's requestCert server: `client cert: "agent1"`
(was NONE), and a certless client still shows NONE — no identity leak.

### [x] tls server honours requestCert / rejectUnauthorized (FIXED 2026-07-16)
SSL_CTX_set_verify(PEER | FAIL_IF_NO_PEER_CERT) + the `ca` bundle as both the client trust
store AND the advertised client_CA_list (without the list a client often cannot tell which
cert to offer and sends none). Verified server-side: certless client never reaches the
handler; a valid client is accepted as peer=agent1. Mutual TLS now works end to end.

### [x] tls server emits 'tlsClientError' (FIXED 2026-07-16, tls 26 -> 27)
Was: a rejected client handshake was dropped silently, so an operator could not see WHY a
client was refused. Now carries OpenSSL's own reason (ERR_error_string of the real failure —
e.g. error:0A0000C7 "peer did not return a certificate", the same code node reports) instead
of a generic 'TLS handshake failed'. Emitted after destroy and only when someone is
listening, per node's contract that an unhandled tlsClientError must not kill the server.

### [x] tls server honours minVersion/maxVersion/ciphers/ciphersuites (FIXED 2026-07-16)
Was: nm_ssl_server_ctx_new took only cert+key, so a server built with {maxVersion:'TLSv1.2',
ciphers:'...'} still negotiated TLSv1.3 with the default list — a caller could not restrict
its OWN server. Note TLS1.3 suites are a SEPARATE knob (SSL_CTX_set_ciphersuites); the
<=1.2 cipher_list does not filter them, so both are plumbed. tls 26 pass, timeout 6->5.

### [x] tls CLIENT honours minVersion/maxVersion/ciphers/ciphersuites (FIXED 2026-07-16)
The suspicion was correct and now verified+fixed: a client asking maxVersion:'TLSv1.2' against
a 1.3-capable server negotiated TLSv1.3. Set PER-SSL (SSL_set_min/max_proto_version,
SSL_set_cipher_list/ciphersuites) — NOT per-CTX: g_ssl_client_ctx is shared by every
connection in the process, so SSL_CTX_set_* would leak one caller's restriction onto all
other sockets. Regression-checked both directions: restricted client -> TLSv1.2, unrestricted
client -> still TLSv1.3.

### [x] fetch() corrupted bodies — FIXED 2026-07-16 (http 97 -> 102)
ClientRequest.end() was not idempotent, so every fetch GET opened TWO connections whose
responses interleaved into one shared _chunkBuf. See lifecycle-probes/PLAYBOOK.md 5u.
### (original report)
RACE. Same URL 3x: 146247 / 98304 / 162631. https.get on the same URL is 3/3 correct, so it
is fetch-specific, not the tls read path. Only reproduces over the real network. Breaks any
app using fetch against a remote https API. See lifecycle-probes/PLAYBOOK.md 5u for what is
already ruled out.

### fs.watch rescans the whole directory on every event
FSWatcher does readdirSync + statSync-per-entry per vnode event, so watching a large dir
costs O(entries) per change (/tmp with 22k entries: 0.63s cpu vs node's 0.02s). node uses
FSEvents and does not rescan. Not a loop bug — correctness is fine, cost is not.

### [x] every timer-only program burned 100% CPU (FIXED 2026-07-16)
net._pollOnce returned 0 instantly when no kqueue existed (created lazily by the first
socket) instead of waiting its timeout, so `setTimeout` with no sockets spun at 1.58M
iterations in 2s: milo 2.52s cpu vs node 0.04s. now 0.03s. no test covers idle cpu — found
by cpu-sampling a plain idle script. See lifecycle-probes/PLAYBOOK.md 5t.

### tls is fd-based (SSL_set_fd); node is BIO-pair based
Blocks TLS-over-TLS (test-tls-inception), TLS over any non-fd duplex, and STARTTLS upgrades.
All 4 SSL sites in entry.c use SSL_set_fd. Real fix is SSL_set_bio + memory BIO pair, pumping
ciphertext from the underlying stream. Guarded for now (fails fast, was silent corruption).
See lifecycle-probes/PLAYBOOK.md 5s.

### [x] tls.connect({socket}) — IMPLEMENTED 2026-07-16 (tls 23 -> 25, timeout 10 -> 7). Remaining: test-tls-inception (nested tls-over-tls), and tls.js still carries a duplicate connect path that bypasses net.js.
### (original) tls.connect({socket}) is ignored
tls.connect always allocates its own fd and never reads options.socket, so a caller-supplied
socket is silently dropped and the connection hangs. Blocks test-tls-inception,
test-tls-on-empty-socket, test-tls-reuse-host-from-socket. Real node feature (HTTP CONNECT
proxies, STARTTLS). See lifecycle-probes/PLAYBOOK.md 5q for the fd-ownership traps.

### [x] tls busy-spin OOMs (FIXED 2026-07-16)
Last 3 spins in the suite are gone: net.js drained TLS sockets with raw recvBinary on EV_EOF,
bypassing SSL and deregistering reads, so the socket was never destroyed and pinned the loop;
the WRITE spin was masking it by re-driving _onReadable. TLS EOF now drains via SSL + destroys,
which unblocked the READ-only handshake. tls OOM 3 -> 0, 23 PASS held, spin CPU 9.2s -> 0.05s.

### [x] SECURITY: the TLS client verified no certificates (found + FIXED 2026-07-16)
Fixed: SSL_get_verify_result + per-connection `ca:` store + rejectUnauthorized enforcement;
createSecureContext no longer eats `ca`; server now sends its full intermediate chain
(SSL_CTX_use_certificate loads only the leaf — milo servers had always sent partial chains).
tls 22->23 PASS, 8->7 TIMEOUT, zero regressions. [x] hostname verification landed 2026-07-16 too: chain verification ALONE accepted any
CA-signed cert for any host (a valid evil.com cert passed for api.weather.gov, authorized=true).
X509_VERIFY_PARAM_set1_host (set1_ip_asc for IP literals — an IP must match iPAddress SANs,
not dNSName) folds the check into the same SSL_get_verify_result, reported as
ERR_TLS_CERT_ALTNAME_INVALID exactly like node. Skipped when the caller supplies its own
checkServerIdentity (node lets that override) or rejectUnauthorized:false. Original report:

### SECURITY: the TLS client verifies no certificates (found 2026-07-16)
`tls.connect()` accepts a self-signed cert with rejectUnauthorized at its default (true) and
reports `authorized = true` (node: UNABLE_TO_VERIFY_LEAF_SIGNATURE). No SSL_get_verify_result
call, no checkServerIdentity (0 hits in tls.js), `authorized` hardcoded at both handshake
success sites. **MITM is undetectable and the API lies about it.** See lifecycle-probes/
PLAYBOOK.md 5p for the fix shape. Also makes test-tls-connect-no-host a vacuous pass.` for ground truth (2026-07-15)
- [x] ~~just adding `.code` to thrown errors~~ — STALE: `.code` now attached on most validation paths (ERR_OUT_OF_RANGE, ERR_UNKNOWN_ENCODING, ERR_ASSERTION all verified live). Remaining work is error *fidelity*, itemized in critical section.

### process (small remaining gaps)
- [ ] `process.seteuid()`, `process.setegid()`, `process.getegid()` — trivial syscall bindings (3 tests)
- [ ] `process.umask(mask)` — return old mask, not current (2 tests)
- [ ] `process.kill(pid)` validation + return value (2 tests)
- [ ] error code validation on cpuUsage, hrtime, nextTick, chdir (4 tests)

### module 80% → ~50%+ remaining
- [ ] `Module._stat` — fs.statSync wrapper, used by require resolution (1 test)
- [ ] `Module._nodeModulePaths` / `Module._resolveLookupPaths` — expose internals (2 tests)
- [ ] `Module._extensions` — setter for custom extensions like `.bar` (1 test)
- [ ] circular dependency detection + warning (1 test)

### zlib 32% → ~50%
- [ ] `zlib.zstdCompress` / `zlib.ZstdDecompress` — Zstandard support
- [ ] `zlib.params()` — dynamic compression level change
- [ ] flush mode edge cases

## critical

### error fidelity (fact-checked 2026-07-15 — old "~435 tests need .code" framing was stale)
`.code` is now present on most throw paths (fs ENOENT, ERR_OUT_OF_RANGE, ERR_UNKNOWN_ENCODING, ERR_ASSERTION verified live). Real remaining gaps:
- [ ] **bindings drop/mangle errno** — no uniform convention: `nm_fs_open` (binding_registry.c:65) returns bare `open()` -1 and never captures errno; fsAccess/nm_fs_utimes return +errno; fsFdRead/fsFdWrite return -errno. Standardize on negative errno (libuv-style) everywhere.
- [ ] **fs.js hardcodes 'ENOENT'** at 8 sites (fs.js:198,227,304,375,397,454,504,1213) because open/stat bindings give it no errno — EACCES/EISDIR mislabeled ENOENT. Route through a `uvException`-style factory once bindings surface errno.
- [ ] **no real `internalBinding('uv')` errno constants/errmap** — THE reason the prior errno-on-fsError attempt was reverted (commit 3a6553a444: copyfile tests assert on missing UV_* map). Port from vendored `lib/internal/errors.js` (`uvErrmapGet` at errors.js:629, `uvException` ~:646).
- [ ] **4 duplicate errno tables with clashing sign conventions** — bootstrap.js:56 (uv map, mixes darwin/win32 numbers), util.js:691 `_errnoMap`, util.js:718 `_sysErrors`, fs.js:801 `_ERRNO_CODES` (macOS-positive). Consolidate to one libuv-negative-keyed table; normalize macOS errno → libuv at the seam.
- [ ] `.errno` numeric property missing on all fs errors (code/syscall/path present, errno undefined)
- [ ] missing arg-type validation throws wrong code: `fs.readFileSync(123)` → EBADF (uses 123 as fd) instead of ERR_INVALID_ARG_TYPE
- [ ] dns lookup failure constructs bare Error (dns.js:17) with no `.code`, crashes process as uncaught — should be ENOTFOUND w/ code
- [ ] `new URL('::::')` doesn't throw — parser too lenient, should be ERR_INVALID_URL

## high

### event loop drain / timeout fixes (~414 tests)
2026-07-16 session: EIGHT real bugs found+fixed (see lifecycle-probes/PLAYBOOK.md).
**net 44->49 (oom 3->0, timeout 12->9); http 79->85 (oom 11->0, timeout 40->24).**
Biggest: (1) fcntl declared as fixed-arity for a VARIADIC libc fn -> O_NONBLOCK never landed ->
every socket blocking -> large writes deadlocked the loop; fixed via C wrapper + EAGAIN
backpressure. (2) fd-reuse race: deferred _sockets.delete(fd) evicted the NEW owner of a
recycled fd, orphaning live sockets (one root cause behind spin-OOMs, the p04 flake, AND
"keep-alive is broken"). (3) __hasIO counted map membership as liveness where libuv counts only
ACTIVE handles. (4) http answered 500 on a throwing handler, hiding every failed assert.
- [x] ~~net: socket 'end' event not firing~~ — STALE: verified firing (probe p09). Real bugs were
      the liveness model (map membership vs libuv active-handle) + fd-reuse orphaning.
- [ ] **http keep-alive socket reuse: request 2 is never sent** (playbook 5a) — likely gates a
      large share of http's 40 timeouts; every multi-request test through the default agent stalls
- [ ] http: server/client timeout and abort handling (6 timeout tests)
- [ ] tls: connection lifecycle (4 timeout tests)
- [ ] cluster: worker wait/disconnect (4 timeout tests)
- [ ] `unref()` not working on some handle types

### net
- [ ] net.Socket should extend Duplex (currently extends EventEmitter with ad-hoc methods)

### vm marshaling fidelity (real V8 contexts landed; marshaling lossy)
- [ ] shallow value-copy marshaling loses property descriptors/getters and Symbol.toStringTag
      (test-vm-basic wants '[object process]'); new contexts lack Node globals (console etc) the old eval/with(proxy) fake exposed
- [ ] marshal with full descriptors (getOwnPropertyDescriptors) + seed standard globals -> should exceed 20

### missing APIs (scattered but cumulative)
- [ ] `dns.Resolver` class (~30 tests)
- [ ] `crypto.createDiffieHellman/ECDH/getDiffieHellman` (~40 tests)
- [ ] `Utf8Stream` in `node:fs` (~30 tests)
- [ ] `Duplex.fromWeb` (~15 tests)
- [ ] `Console` constructor (~10 tests)
- [ ] `zlib.ZstdDecompress` (~10 tests)
- [ ] `process.execve` (~5 tests)

### fastify compat
- [ ] investigate async plugin loading hang (listen promise never resolves)

## low

- [ ] native addons / N-API: only ~4 of 2143 curated tests touch dlopen/.node (2 test dlopen *error* paths, passable without addons) — ≈0% compat leverage. Defer until goal shifts to ecosystem reach (better-sqlite3/sharp); then port Bun's split: engine-seam C++ (bun src/jsc/bindings/napi*.cpp → our v8capi.cc) + safe body (napi_body.rs → napi.milo). Reference checkout: ~/git/bun (full Rust rewrite, 2026).
- [ ] `stream.Writable.toWeb()` / `Readable.toWeb()` — needs ReadableStream/WritableStream globals in V8
- [ ] `cluster` module
- [ ] `worker_threads` — `Worker` class (needs V8 isolate threading)
- [ ] `vm.SourceTextModule` — ESM module evaluation in V8 contexts
- [ ] `vm` — proper sandbox isolation via V8 contexts
- [ ] `perf_hooks` — `monitorEventLoopDelay` real histogram
- [ ] Buffer pooling optimization
- [ ] `domain` module (deprecated but some packages use it)
- [ ] `--expose-internals` flag (319 tests need it)
- [ ] `--permission` security model (39 tests need it)

## THE POINT (strategy, decided 2026-07-16)

**Spend milo's budget where milo is differentiated: memory-safe Buffer ops and parsers with
proved contracts.** Not on reimplementing OS plumbing.

Evidence for this framing, from the 2026-07-16 lifecycle session (10 bugs found+fixed):
- **9 of 10 were plain JS logic bugs in `lib/*.js`** — a layer that is identical in node and
  node-milo. Milo's type system, memory safety and `unsafe` discipline were irrelevant to
  every one of them. Compat % is won almost entirely in this layer, so **compat % does not
  measure milo's thesis at all**.
- **The 10th was CAUSED by the milo seam**: `fcntl` is variadic, milo let it be declared as a
  fixed-arity extern with no diagnostic, so O_NONBLOCK never landed and every socket in the
  runtime was blocking. C++ gets this right for free via `#include <fcntl.h>`. That is a bug
  class milo *introduced*, not one it prevented.
- **ZERO memory-safety bugs were found.** The hand-written event loop, meanwhile, produced 4
  races that libuv/usockets simply do not have (map-membership liveness, fd-reuse eviction,
  EOF storms, orphaned registrations). Reimplementing battle-tested plumbing subtracts
  correctness; it does not add it.

Where milo can actually win: node's real CVE history is **Buffer arithmetic, HTTP request
smuggling, zlib/protocol framing** — exactly the code where memory safety plus statically
verified contracts (requires/ensures/invariant discharged to Z3, zero runtime cost — the SPARK
model with Dafny syntax) beat C++. That claim is defensible to a safety-critical audience.
"we rewrote the event loop" is not.

Cheapest experiment that tests the thesis (~1 day, far more informative than any compat point):
prove the four buffer contracts listed below, then fuzz the http parser. See `## formal
verification`.

Event-loop plumbing: adopt libuv's **active-handle model** (handle owns its fd; liveness =
has-pending-operation + refcount) instead of the fd-keyed maps — kills the whole 2026-07-16
bug class and is a prerequisite for any libuv migration. NOT usockets: bun uses it (POSIX;
libuv on Windows only) but bun reimplements node's API surface itself, whereas node-milo runs
node's real `lib/*.js`, which is written against libuv's model (`internalBinding('uv')`,
`_handle`, ref/unref — the uv errmap is already ported here). usockets also omits the fs/dns
threadpools, child_process, signals and TTY that node-milo needs.

## formal verification

Milo has built-in `requires`/`ensures`/`invariant` contracts → SMT-LIB2 → Z3. Zero runtime cost.
Worth adding to pure algorithmic code where off-by-one and bounds bugs bite hardest.

### buffer ops (best candidates)
- [ ] `compareImpl` — ensures result in {-1, 0, 1}, requires lengths >= 0
- [ ] `copyImpl` — ensures bytes copied <= min(srcLen, dstLen - offset), bounds on offset
- [ ] `indexOfImpl` — ensures result == -1 || (result >= 0 && result < haystackLen)
- [ ] `fillImpl` — requires offset >= 0 && offset <= bufLen, end >= offset

### encoding/decoding
- [ ] hex encode/decode — ensures output length == input length * 2 (encode) or / 2 (decode)
- [ ] base64 length calculations — ensures correct padding math
- [ ] utf8 validation — loop invariants on byte position advancement

### stream internals
- [ ] HWM logic — invariant hwm > 0, buffer length tracking
- [ ] backpressure state transitions — ensures consistent needDrain/flowing state
