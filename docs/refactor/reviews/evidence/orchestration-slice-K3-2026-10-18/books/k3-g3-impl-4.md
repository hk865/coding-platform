# Task: K3 group 3, session 4 — the review's test findings; coordinator mode; test-driven

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. The spec, the
books and the lead's rulings are binding; do not make design decisions. Where they do not determine something, choose
nothing: list it under UNSPECIFIED with the smallest options, and go on.

**This run is headless. When your turn ends, the whole run ends.** **Work in coordinator mode:** read
`./.dsh-ref/coordinator-mode.md` first and follow it, **at most 3 subagents at once — strictly**, every vitest command
`--maxWorkers=2`. Subagents write all code and tests; you split, brief, check and reply. **Finish within 150 minutes**
(the run stops at 160, with a handoff if needed). Finish whole items in the order of section 3.

## 1. What this copy is

- Tags: `k3-g3a`, `k3-g3b`, `k3-g3c` (HEAD) = sessions 1–3, committed by the lead. Your session-3 reply is
  `./.dsh-ref/k3-g3c-final.md`.
- Codex reviewed session 3 read-only (`./.dsh-ref/k3g3c-review.out.md`): session 2's five production fixes and items
  A1–A3, B1–B3 are confirmed; **no new production defect**; five test findings are must-fix. Codex then checked the
  Kernel (`./.dsh-ref/k3-multicall-facts.out.md`): the Kernel writes the whole turn's tool calls, runs a batch that
  contains a `process` call one call at a time, and records `tool.outcome_unknown` only when the Run is cancelled while
  a call runs; RUN-25 counts only `running` / `outcome_unknown` calls (`kernel-turn-facts.ts` ~74, spec L25). **So with
  the real effect classes one Run has at most one call that needs review** (independent read-only calls may run in
  parallel but need no program review).
- Binding books: `./.dsh-ref/k3-g3-impl.md`, `./.dsh-ref/k3-g3-impl-2.md`, `./.dsh-ref/k3-g3-impl-3.md`. This book adds
  sections 2–3; where they differ, this book wins. The spec: `docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md`.

## 2. Lead rulings (binding)

1. **Never change a tool's effect class to make calls run in parallel** (the `read_only` + `independentReadOnly`
   stand-ins in `tests/helpers/K3-mixed-seams.ts` ~67/69 and `K3-13-two-commands.test.ts` ~88/90 go). The spec's
   stand-in `shell` keeps `effectClass: 'process'`. **No history injection** either (AGENTS rule 4: no tests for
   states only tampering can make).
2. **Rows whose multi-item record cannot occur with the real Kernel** — K3-06 (platform + file_edit + process in one
   record), K3-13 (two commands), K3-35 (一) (32 items):
   - the multi-item part is proven **at the owner level** (R4: the record owner's public create, write and settle
     entries, memory and SQLite), with inputs the codecs accept (real SHA-256 digests, summaries within their limits);
   - the R2 part proves the **reachable single-item** case through the real chain (scripted model → Kernel → crash →
     RUN-25 → `workflow.advanceWork` → the review round → the tool → the owner → settlement → public read): K3-06 one
     case per kind (`process`, `file_edit`, a platform tool), each its own Run; K3-13's "the other item has no
     conclusion" at the owner level only; K3-35 (一) one item with the > 4 KiB control-character command from the
     Kernel's call arguments, a 512-byte callId, and 200 long paths from the real workspace capture.
   - The lead post-notes the spec with this.
3. **K3-35 (一) assertions:** the trimmed record still holds all its items (state the count) with their aliases in the
   fixed order; the capacities are literals (262,144 and 65,536, and 158,720 where the spec uses it), never the
   production constants; the settlement is asserted.
4. **K3-11 and K3-45 (一) through R2** (Codex 1): two rounds, each with the model writing its conclusions through the
   tool, interrupted with no call in flight, then settled by the Workflow; `every_step` and `partial` combined on that
   chain; the three reasons asserted in their fixed order (`review_incomplete, partial, confirm_each_step`). The
   "second in a row" case built on the real continuation chain of the original Work Run. `inventory_incomplete` is
   proven through the real create / attestation entry (no forced review round).
5. **K3-42 (二) through the real chain** (Codex 3): the real prepare produces the `unexpanded` entry from the large
   input; the scripted model writes the conclusion through the tool; the Workflow settles; the result is read back
   through the public read.
6. **No database or artifact-store opens in tests** (Codex 5: `K3-35-review-input-size.test.ts` ~427,
   `K3-42-truncated-command.test.ts` ~183): what the model received is asserted from the scripted model's observed
   request; the whole manifest through a public material read. If no public read can open it, report the seam gap with
   file:line; do not add a production route.
7. **Two small additions** (Codex suggestions): B1 also through the existing Runtime admission case (a proposal-phase
   Run is refused, not entered, zero model calls); A1's missing-`read` case also asserts that no round is claimed.
8. **Not in this session:** the L11 gate gap you reported (a `needs_decision` record still lets an ordinary requeue and
   claim through) is group 4's (spec §7 item 4: "Workflow 的门和恢复"); do not fix it here. K3-37 (三)'s automatic
   Host resume is asserted in group 4.

## 3. Items (in this order)

A. Rulings 1–3 (K3-06, K3-13, K3-35 (一)) — the owner-level cases and the single-item R2 cases.
B. Ruling 4 (K3-11, K3-45 (一)).
C. Ruling 5 (K3-42 (二)).
D. Rulings 6–7.
E. Close-out: the checks of `k3-g3-impl.md` section 8 with `--maxWorkers=2`, one subagent.

Production code should not need to change. If a test shows a production defect, stop that item and report it
(test, assertion, rule, minimal counter-example); do not fix production in this session.

## 4. Reply

Under 800 words: FILES CHANGED (tests; production must be none — say so); each item RED → GREEN or why a case went
green at once; the rows' parts proven at owner level vs R2; CHECKS with numbers; UNSPECIFIED; subagents (task, time,
most at once).
