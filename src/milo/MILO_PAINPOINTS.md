# Milo Pain Points — Handoff for Tooling/Language Work

Compiled while porting Node.js fs to Milo (node-milo, branch `milo`). Ordered by how much
they slowed real work. Each has a concrete repro and a suggested fix. Author: fs-compat agent.

> **Status 2026-06-09:** #1 and #2 are RESOLVED in the milo compiler — parse errors now
> render Elm-style with source line + caret (src/main.ts:33, incl. imported files,
> commit 478460b), Parser.error emits `hint: expected 'IDENT' here` (src/parser.ts:46),
> and stray `;` gets a dedicated "Milo uses newlines" hint (src/parser.ts:49). The bare
> `error[parse]: N:M` form survives only in ParseError.message for callers logging
> e.message directly. Remaining big ones: #6 (JS stack attribution across async
> trampolines) and the 30-60s rebuild cycle (#4/#5 adjacent, but compile *time* itself).

---

## 1. ~~Parse errors have no useful location/context~~  [RESOLVED — see status note]

**Symptom.** Compiler emits e.g. `error[parse]: 378:36: unexpected token ';'` and nothing else —
no source line, no caret, no "expected X". A one-char mistake costs a full rebuild cycle to find.

**Repro.** In any `.milo`, put two statements on one line with `;`:
```milo
fn f(): void {
    let x = 1; let y = 2   // milo has no ';' statement separator
}
```
→ `error[parse]: N:M: unexpected token ';'`. Correct, but gives no hint that the fix is
"use a newline." A newcomer doesn't know `;` isn't a separator from this message.

**What Rust/clang do.** Print the offending source line + caret + "expected newline or `}`".

**Fix.** Render `file:line:col`, the source line, a caret under the column, and the expected
token set. This alone would cut my `.milo` iteration time noticeably — every syntax slip
currently means: run build.sh (~30-60s), read terse error, guess, repeat.

---

## 2. ~~No statement separator `;` — but the error doesn't say so~~  [RESOLVED — see status note]

**Symptom.** Came from C/JS habit of `a(); b()` or `if x { ... ; return }`. Milo rejects `;`.
I hit this twice this session (fsUtimes guard, others). Each cost a rebuild.

**Repro.** `if plen < 0 { ci.retI32(-1); return }` → parse error at the `;`.
Must be:
```milo
if plen < 0 {
    ci.retI32(-1)
    return
}
```

**Fix.** Either (a) accept `;` as an optional separator (most C-family devs expect it), or
(b) make the error explicitly say "Milo uses newlines, not `;`, to separate statements."
Option (a) removes a whole error class.

---

## 3. Redundant `unsafe` is required/inconsistent — rules unclear at call sites

**Symptom.** The CLAUDE.md rules say extern calls need `unsafe` only when returning a pointer
or taking a non-coerced `*T`. In practice I wrote `unsafe { ci.retI32(nm_fs_futimes(fd, a, m)) }`
then had to remove the `unsafe` because the function only takes scalars + returns i32 (no unsafe
needed). The compiler accepted both at times, rejected at others. The boundary isn't obvious
from the code — I had to guess-and-rebuild.

**Repro.** `nm_fs_futimes(fd: i32, atime: i64, mtime: i64): i32` — all scalar. Calling it does
NOT need `unsafe`. But `nm_fs_utimes(path: *u8, ...)` with a `pathBuf as *u8` arg is inside an
existing `unsafe` block already (for getStringArg), so it's ambiguous whether the call itself
needs it.

**Fix.** A compiler note when `unsafe` is redundant ("warning: unnecessary unsafe block") like
Rust's `unused_unsafe` lint. And/or document the exact rule with a decision table in errors.

---

## 4. Build is all-or-nothing per-file; no incremental feedback on what changed

**Symptom.** `build.sh` recompiles each `.milo` to `.o` (skips if `.o` newer), then links. A
parse error in ONE file (e.g. fs.milo) still printed `compiled version.milo -> ...o` for the
file that DID compile, then `BUILD_EXIT 1` — easy to miss which file failed. Took an extra
look to realize fs.milo (not version.milo) was the failure.

**Repro.** Break fs.milo syntax, run build.sh. Output interleaves success lines for other
files with the one error; exit code is the only clear failure signal.

**Fix.** Summarize at the end: "FAILED: fs.milo (1 parse error)". Group errors by file.

---

## 5. No way to know `.milo`/`.c` vs `.js` rebuild boundary without tribal knowledge

**Symptom.** lib/*.js + bootstrap.js are hot-loaded (no rebuild). *.milo, v8capi.cc,
binding_registry.c, entry.c need build.sh. This is critical to velocity (JS fix = instant test;
.milo fix = 30-60s rebuild) but isn't enforced or documented in-tree beyond memory notes.

**Fix.** Not a language bug — but a `make`/build target that watches and tells you "this change
needs a native rebuild" vs "hot-loadable" would help. Or a banner in build.sh output.

---

## 6. Stack traces from Milo-hosted JS point at the wrong line (imprecise attribution)

**Symptom.** Several test failures (test-fs-stat-bigint, chmod-mask, timestamp-parsing-error)
showed the error attributed to a callback or wrapper line, not the real throw site. I could
NOT reproduce the failures in isolation — every isolated sub-test passed — because the reported
line pointed somewhere misleading. Burned ~1hr each on stat-bigint and chmod-mask before
deferring.

**Repro.** `test-fs-stat-bigint.js` fails with `Object.keys(undefined)` attributed to the
callback test (line 157), but isolated repros of the callback path all pass. Real cause is
elsewhere in the flow; the trace doesn't lead there.

**Example trace that misled me:**
```
at eval (.../test-fs-read-stream-err.js:40:10)   <- points at `bufferSize: 64` literal,
                                                     not the actual fd-null assertion
```

**Fix.** This is the single biggest *correctness-debugging* blocker. Milo's JS error stack
attribution (source-mapping eval'd modules back to file:line) is close but off by enough to
send you down wrong paths. Tighten the sourceURL/line mapping for thrown errors, especially
across async (nextTick/event-loop) boundaries where the trampoline frames are involved.

---

## 7. (Minor) `Date.now()`/`Math.random()` unavailable in compile-time contexts is fine, but
the runtime has no obvious frsize-style "what does this native array index mean" doc

**Symptom.** Native bindings return positional arrays (e.g. `b.statvfs` → `[bsize, frsize,
blocks, ...]`). To add `frsize` to statfs I had to read the C wrapper (`nm_statvfs` in entry.c)
to learn `out[1]` = f_frsize. No type/struct on the JS side; just magic indices.

**Fix.** Not language-level — but returning a struct/object from native bindings (or a
documented index enum) instead of bare positional arrays would prevent off-by-one mapping bugs.

---

## Summary priority for the language/tooling agent

1. **Parse error quality** (#1, #2) — source line + caret + "expected" set. Biggest daily friction.
2. **JS error stack attribution** (#6) — biggest *correctness* blocker; causes hours lost on
   non-reproducible-in-isolation failures.
3. **`unsafe` redundancy lint** (#3) — removes guess-and-rebuild cycles.
4. Build failure summarization (#4), native-rebuild signaling (#5), struct returns (#7) — nice-to-haves.

None of these are blockers for *shipping* features (I've landed ~20 fs commits this session).
They're velocity + debuggability taxes. #1 and #6 are where an hour here and there keeps going.
