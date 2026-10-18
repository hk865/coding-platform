# Task: K3 group 4 session A, rework 1 — the review's verified items; coordinator mode; test-driven

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. The spec, the
books and the lead's rulings are binding; do not make design decisions. Where they do not determine something, choose
nothing: list it under UNSPECIFIED with the smallest options, and go on.

**This run is headless. When your turn ends, the whole run ends.** Work in coordinator mode
(`./.dsh-ref/coordinator-mode.md`), **at most 3 subagents at once**, files of running subagents disjoint, every vitest
command `--maxWorkers=2`. **Do not end your turn while a subagent has not reported back.** **Finish within 200
minutes** (the run stops at 210, with a handoff if needed). Finish whole items; an unfinished item is reported, not
half-done.

## 1. What this copy is

- HEAD (tag `k3-g4a`) = K3 group 4 session A as built (book `./.dsh-ref/k3-g4a-impl.md` incl. its §8 rulings; your
  reply `./.dsh-ref/k3-g4a-final.md`).
- Codex reviewed it (`./.dsh-ref/k3g4a-review.out.md`, Chinese, 8 must-fix items with the fix approach). A Claude
  subagent then checked every item in the code: `./.dsh-ref/verify-k3g4a.md` (English; verdicts, file:line, the
  smallest fixes, tests, and three things Codex missed). **The verification file is the working list; the rulings in
  section 2 settle what it left open.** Line numbers there are for this HEAD.
- The spec: `docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md` (frozen). Read what each item names.
- The TDD skill: `./.dsh-ref/tdd/`.

## 2. Items (binding)

Every item: a failing test first (for the right reason), then the smallest change. Test names start with the row id.
Expected values literal, from the rows or hand-computed.

1. **One reading of "no record" (L7 "读不出就当没定"; verify §1).** L7: only an authoritative `not_found` means no
   record; every other read result is unreadable. **Ruling: option A.**
   - In the three places (`plan-readers.ts` ~1739, `claim-service.ts` ~1210, `requeue-service.ts` ~472) every failure
     (`unsupported`, `invalid`, `corrupt`, `unavailable`, a thrown read) maps to `unreadable` through **one** shared
     mapping (no three copies); `not_found` alone is "absent".
   - Delete the claim's probe read (~1205–1211); on `not_found` the claim adds the `expectedRevision: null` guard
     directly. Delete `selectedReviewBlocker` and the requeue owner's second read; the requeue owner uses
     `window.canonical.unknownCallReview` from the window it already reads.
   - Test fixtures that list record schemas without `UnknownCallReview` register it (verify §1 lists the 9 helpers and
     about 13 files); `task-claim-fixture`'s merge de-duplicates schemas passed through `additionalSchemas`. A fixture is
     never a reason to relax the production rule.
   - Test: extend K3-47 (二) as verify §1 says (a wrapper fails any `readMany` that includes a review key), memory and
     SQLite.
2. **Every non-review claim takes the blocker (L11, D3; verify §2):** `task-machine.ts` ~896 → `claimBasis.kind !==
   'review'`; `run-machine.ts` ~666 checks the blocker first. Tests as verify §2 (state test + owner-level, both
   backends). Note: Codex's side remark about K3-43's naming is wrong; K3-43 stays as it is.
3. **release-hold never hides a read failure (ruling 4; verify §3):** a failed or thrown Run read or control-intent
   read gives `requeue: {status: 'rejected', code: <the read's code, or 'unavailable' when thrown>, reason}`; `null`
   only when the facts were fully read and the fence is not human. Tests as verify §3 (incl. the re-click).
4. **The derived requeue replays (L21 D9 "各自幂等", ruling 4; verify §4):** the owner read beside `readTaskRequeue`
   that finds TaskRequeue(task, R) and confirms through its `TaskRequeued` event that it was made by this request
   identity; the route calls it first (hit → the committed requeue, `replayed: true`, its cursor; miss → fresh pins as
   today). Reuse the existing identity helper (`identityOf`); no change to the CAS, no rotating ids. Test as verify §4,
   both backends.
5. **L27 bullets 2 and 3 (verify §5; nobody was given them; L29's rows need them).** Spec L27: a review-purpose Run with
   a known ending (RUN-19/22/23/24) that is no longer the record's `activeRound` needs no TaskRequeue to close; RUN-25
   needs none (as RUN-22); maintenance closes a retired line without a continuation whose latest Run is RUN-25 or such
   a review-purpose Run (`closableWorkRun`). Use the TaskRow the runtime already reads (`runtime.ts` ~153–161); no new
   read. Tests as verify §5 (row 4b driven to the continuation in the round's Session; the maintenance example).
6. **The recovery rows end where L29 says (verify §6 and "What Codex missed" 1).**
   - First a diagnostic (probe under `./.dsh-scratch/`, deleted): log the round-1 `close_open_turn` receipt in row 3's
     example; verify expects `mismatch` caused by the fixture releasing the shell right after the "crash". Report what
     you saw.
   - Then fix the fixtures (release the shell seam only after the flow, in `finally`, as K3-27 does), remove the
     "archived" branches and the "PRODUCTION GAP" comments, and drive rows 3 (both variants), 6, 8, 9, 11 and 13 to one
     continuation or the hold/card stop, then a final restart with zero writes (`expectQuietHarnessRestart`); row 13
     gains a Host restart between its two steps. Row 8's definite close failure is built the K3-27 "unsupported" way.
   - If, after the fixture fix, production does not do what the row says, do not weaken the row: report it (test id,
     assertion, rule, smallest counter-example).
7. **K3-48 (三) legitimately (verify §7 and "What Codex missed" 2).**
   - Codec: each path at most 512 characters (L7 ~243) in `unknown-call-review-codecs.ts` ~319; owner case: a draft
     with a 513-character path → `invalid`.
   - Rebuild K3-48 (三) on `createK3LargeReviewRecord` through the real RUN-22 owner, memory and SQLite, padded legally
     toward B as verify §7 says, with the sizes hand-computed in a comment (the hold text length from L21/L7's reserve
     table); assert the four sizes.
   - Delete the case that rewrites the read result; add the pure `admitUnknownCallReview` case (a required write of
     524,289 serialized bytes → `capacity`) in `tests/state/unknown-call-review.test.ts`.
8. **Start-up 2b and K3-47 on both backends (verify §8).**
   - K3-47's cases run on memory and SQLite.
   - The 2b test makes its records through the real owners (as verify §8 lists) and reads them through the production
     `listReviews` on the `open` index; the held record with no round is not listed. One fault case: a wrapper fails
     the first page read → one `problems` line, no review lines, no throw. **Ruling:** the faked 100×100 page-bound
     case is deleted, not kept as a seam test (step 1's identical bound has no test; the bound is two constants and a
     loop).

## 3. Order (suggested; you decide the briefs)

1. Item 1 first, one subagent (production + the fixture registrations touch many test files).
2. Then in parallel: (A) items 2, 3, 4; (B) items 5 and 6; (C) items 7 and 8.
3. Close-out: the checks below.

## 4. Rules

As in `./.dsh-ref/k3-g4a-impl.md` §4: tests through public owners and routes; fault injection yes, fact injection no;
no tests of states only tampering can make (AGENTS rule 4); state transitions only through
`src/core/work-graph/state/`; an old assertion that fails is reported, not edited, unless this book names it. No real
model calls, no git writes, never ports 3080/3099/44797; probes under `./.dsh-scratch/`, deleted. Report the production
net line change (expected small: the deletions in item 1 offset items 3–5).

## 5. Checks (close-out subagent)

Same list as `./.dsh-ref/k3-g4a-impl.md` §6, `--maxWorkers=2`, plus every changed test file; then `npm run typecheck`,
`npm run check:architecture`, `npm run build`. Failures listed in `DSH-BASELINE.md` are expected. Do not run the full
suite.

## 6. Reply

Under 700 words: FILES CHANGED (production net; tests); each item RED → GREEN (item 6: the diagnostic's result, and per
row where it now ends); CHECKS with numbers; UNSPECIFIED (short, with options); subagents (task, time, most at once).
