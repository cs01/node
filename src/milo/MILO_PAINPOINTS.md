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

## 8. `extern struct` layout is an unverified claim — wrong offsets fail SILENTLY

**Status 2026-07-16.** The one that bites every Milo user, not just this port.

**Symptom.** `extern struct` reads as though the compiler knows the C type's layout. It does not —
it's an assertion the compiler takes on faith. Get a field's order/type/size wrong and there is no
error and no crash: the read lands on a *neighbouring field* and returns plausible garbage. This is
the worst failure shape available — looks safe, fails silently, corrupts data quietly.

**Repro.** Declare a struct with one field's type wrong (`st_ino: u32` instead of `u64`). Everything
after it shifts by 4 bytes. `stat().size` returns some other field's bytes. Compiles clean, runs,
returns wrong numbers forever. Nothing on the Milo side can catch it — Milo never sees `<sys/stat.h>`.

**Why it's worse than it looks.** The workaround requires you to (a) already know the trap exists,
and (b) have a C compilation unit in your build to put `_Static_assert(offsetof(...))` in. A pure-Milo
program has neither. We only found it here because this port happens to have `entry.c`.

**What we did (node-milo, commits 5c28a8f5d93 + aea032fc35c).** Hand-wrote 23 `_Static_assert`s in
`entry.c` guarding `Stat`/`Timespec`/`Timeval`/`Rusage` — C sees the real headers, so a drifted layout
now breaks the build with a named error. Verified the guard bites by deliberately breaking an offset.
This works but it does NOT generalize: it's manual, opt-in, per-struct, per-field, and unavailable to
anyone without a C file. Nothing warns when a *new* `extern struct` ships with no guard.

**Fixes, cheapest first:**

1. **Docs** (~1hr) — the `extern struct` section must state plainly that layout is unchecked and a wrong
   field silently reads garbage. Right now nothing warns you. Even node-milo's own CLAUDE.md presents
   `extern struct` as the *safe* option vs manual offsets — true for readability, silent on verification.
2. **Compiler-emitted layout guards** (~1-2 days) — best cost/benefit. Let the user annotate:
   ```milo
   #[c_layout("struct stat", "sys/stat.h")]
   extern struct Stat { st_dev: i32, ... }
   ```
   Compiler computes each field's offset (it already does this for codegen), emits a throwaway C TU of
   `_Static_assert(offsetof(struct stat, st_dev) == 0, ...)`, and compiles it with the system cc as part
   of the build. Turns a faith-based claim into a compile-time-checked one, for every user, with no C
   file of their own. Field names already match in practice; annotation carries the header + C type name.
3. **`@cImport`-style header ingestion** (weeks) — derive the layout from the header, delete the
   hand-transcription entirely. What zig does. Correct endgame, big lift. #2 gets ~90% of the safety
   for ~5% of the work, and is a stepping stone (same offset-computing machinery).

**Adjacent.** Same faith-based hole applies to `extern fn` decls: node-milo has **341** hand-written
extern signatures, none checked against the real symbol. A wrong arity/type is UB that no `unsafe`
marker would flag — the mistake is in the *description* of the boundary, not the crossing of it.
`#[c_layout]`-style checking could extend to signatures (`_Static_assert(sizeof(&fn) ...)`-ish, or
just emitting a C TU that takes the function's address at the declared type — a mismatched decl then
fails to compile). Lower priority than structs; scalar ABI mismatches are usually loud-ish, struct
layout drift is always silent.

**Related.** `unsafe` correctly does NOT cover this (it tracks memory *provenance*, not layout claims
or side effects) — which is itself worth a docs note, since "no unsafe" reads as "verified" to newcomers.

---

## Summary priority for the language/tooling agent

1. **`extern struct` layout unverified** (#8) — **silent data corruption**, affects every user of the
   feature, and the workaround needs a C file most users don't have. Highest *severity* on this list;
   fix #2 (compiler-emitted guards) is ~1-2 days.
2. **Parse error quality** (#1, #2) — source line + caret + "expected" set. Biggest daily friction.
   [RESOLVED]
3. **JS error stack attribution** (#6) — biggest *correctness* blocker; causes hours lost on
   non-reproducible-in-isolation failures.
4. **`unsafe` redundancy lint** (#3) — removes guess-and-rebuild cycles. [RESOLVED — shipped; used it
   to strip 91 redundant `unsafe` from node-milo, commit 489fbd941dc. Worked exactly as asked.]
5. Build failure summarization (#4), native-rebuild signaling (#5), struct returns (#7) — nice-to-haves.

Most of these are velocity + debuggability taxes, not shipping blockers. **#8 is the exception** — it's
a correctness/silent-corruption issue in a feature the docs actively recommend.
