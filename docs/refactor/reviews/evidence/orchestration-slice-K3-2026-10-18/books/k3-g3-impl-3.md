# Task: K3 group 3, session 3 — the remaining R2 rows, session 2's open points; coordinator mode; test-driven

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. The spec, the
books and the lead's rulings are binding; do not make design decisions. Where they do not determine something, choose
nothing: list it under UNSPECIFIED with the smallest options, and go on.

**This run is headless. When your turn ends, the whole run ends.** **Work in coordinator mode:** read
`./.dsh-ref/coordinator-mode.md` first and follow it, with **at most 3 subagents at once — strictly** (session 2
briefly ran 4; do not start a fourth while three are running, even if one reports early: wait for its final reply).
Files of running subagents disjoint; every vitest command `--maxWorkers=2`. Subagents write all code and tests; you
split, brief, check and reply. **Finish within 200 minutes** (the run stops at 210, with a handoff if needed). Finish
whole items in the order of section 3; an unfinished item is reported, not half-done.

## 1. What this copy is

- Tags: `k3-g3a` = session 1, `k3-g3b` (HEAD) = session 2, committed by the lead. Your session-2 reply is
  `./.dsh-ref/k3-g3b-final.md`.
- Binding books: `./.dsh-ref/k3-g3-impl.md` (sections 4 scope, 5 rulings U4/U5, 6 rules, 8 checks, 10 answers) and
  `./.dsh-ref/k3-g3-impl-2.md` (rulings R1–R5). This book adds section 3; where they differ, this book wins.
- The spec: `docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md`. The TDD skill: `./.dsh-ref/tdd/`.
- Lead check of session 2 with bubblewrap: 90 files (A8-host-restart*, every `K3-*.test.ts`, WP1, S1, S2B, A2, WP2, platform, `tests/state/`, `tests/architecture/`, every test file groups 2–3 added or changed): 4,344 passed, none failed.

## 2. Rulings on session 2's UNSPECIFIED (binding)

1. **The admission is keyed on the round's phase, not only its purpose kind:** the L13 tool set and empty write scope
   apply to `phase === 'review'`. Group 4 adds the proposal phase's own set; until then a proposal-phase Run is refused
   at admission (fail closed), never admitted with the review set or with the Role's ordinary tools.
2. **`reviewGate` with no binding for the role** (changed after Codex's review of session 2; it replaces the earlier
   "fail closed to `review_unavailable`"): a missing model binding does not prove that the read-only command is
   unusable, and settling `review_unavailable` sends the record to a person's decision that cannot be taken back. So the
   gate returns `skip` with a new explicit source (e.g. `review_binding_missing`); a named task turns it into `waiting`
   with that source (U4). The record stays `pending_review` until the binding is back. Never `pass`. Also look up the
   assignment/binding **once** (`workflow.ts` ~1242 and ~1269 look it up twice) and pass the selected binding to
   `planReviewRound`, so the capability check and the preparation use the same binding and only one branch handles
   "missing".
3. **`record_unknown_call_review` returns a bounded receipt, not the record** (L14 "回执"): `{ status, item (alias),
   revision, receiptRef or the commit identity }` plus, on refusal, the code and reason as text. The record is read
   through `unknown-call-reviews/read`. Test: a record near the M3 threshold, a successful conclusion → the tool result
   stays far under the 64 KiB output limit and the round ends `completed`, not `outcome_unknown`.
4. Item H's test-flow race fix (keeping B's read seam armed through `executions/resolve-unknown`) is accepted as a test
   fix; nothing to change in production.
5. The `runBaselineKnown` branch verified by code only, and K3-39's decision case covering a miss while the hit and
   conflict live in `S5R2`: accepted.

## 3. Items (in this order of priority)

**A. Session-2 review findings** (Codex reviewed session 2 read-only; the lead verified):
Codex: "先改完列出的几处" (5 must-fix; items A–H of session 2 confirmed done). The lead checked items 3 and 4 in the
code. Items 1 and 2 are section 2's rulings 3 and 2.
1. **Capability and admission agree** (Codex 3): `runtime-configuration.ts` `readonlyCommandAccess` checks only
   `run_readonly_command`, while `contracts/review-admission.ts` also needs `read` among the Host tools and
   `readonlyCommandAccess === 'all_except_denied'`. Export one Host-layer-1 predicate from `review-admission.ts` and use
   it in both places, so capability says `available` exactly when admission would pass layer 1. Test: Host grant with
   `shell` and `run_readonly_command` and full read access but no `read` → `unavailable`, and no round is claimed.
2. **`runBaselineKnown` from the capture, never hard-coded** (Codex 4): `create-platform.ts` ~1609 and ~1612 pass
   `true` when storing the capture fails; pass `captured.baselineKnown`, as the success branch does. Test the store
   failure through the existing store-wrapper seam with a missing baseline → `runBaselineKnown: false`.
3. **Capacity tests use the spec's number, not the production constant** (Codex 5): `K3-10-review-round-cells.test.ts`
   ~216/220 and `K3-48-2-unknown-call-review-model-text-budget.test.ts` ~27 fix the literal 158,720 bytes (spec L7);
   the K3-48 (二) R2 case then asserts the short write's bounded receipt, the round ending `completed`, and the
   settlement (it no longer allows `outcome_unknown`).


**B. Rulings 1–3 of section 2**, each with a failing test first.

**C. The remaining R2 rows** (spec lines in `k3-g3-impl.md` section 4): **K3-06, K3-11, K3-13, K3-19 (一),
K3-35 (一), K3-37, K3-42, K3-45 (一)**. Through R2 (a scripted-model review round driven by `workflow.advanceWork` from
a record that RUN-25 or the attestation entry created; the review round really starts, as K3-05 does now). Where a row
also asserts a card, the proposal phase or a disposition, assert the record through `unknown-call-reviews/read` and
leave that part for group 4; list which parts you left. K3-35 (一) is the 32-item, over-4-KiB, control-character,
512-byte-callId case of L13's size rules (spec L13, around 359–365).

## 4. Order (suggested; you decide the briefs, files disjoint, at most 3 at once)

1. A and B first, split by file.
2. Then the C rows, at most 3 subagents at once (the rows are mostly test files; production changes they need go to
   one subagent at a time per file).
3. Close-out: the checks of `k3-g3-impl.md` section 8 with `--maxWorkers=2`, one subagent.

## 5. Reply

Under 900 words: FILES CHANGED (production / tests, production line count); each item: done or not, RED → GREEN; the
row parts left for group 4; CHECKS with numbers; UNSPECIFIED (short, with options); subagents (task, time, most at
once); anything surprising.
