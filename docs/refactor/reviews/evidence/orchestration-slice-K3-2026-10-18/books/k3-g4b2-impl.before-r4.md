# Task: K3 group 4 session B2 — the proposal round, the approval card and its application, the approved methods in the continuation (L20, UCR-05/08/08c/12/13, K3-16, K3-19 (二), K3-35 (二)(三), K3-46, K3-48 (二)); coordinator mode; test-driven

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. The spec, this
book and the lead's rulings are binding; do not make design decisions. Where they do not determine something, choose
nothing: list it under UNSPECIFIED with the smallest options, and go on.

**This run is headless. When your turn ends, the whole run ends.** **Work in coordinator mode:** read
`./.dsh-ref/coordinator-mode.md` first and follow it. No fixed limit on how many subagents run at once (decision 76),
but files of running subagents must be disjoint and every vitest command uses `--maxWorkers=2`. **Do not end your turn
while a subagent has not reported back.** Subagents write all code and tests; you split, brief, check and reply.
**Finish within 240 minutes** (the run stops at 250, with a handoff if needed). Finish whole items; an unfinished item
is reported, not half-done.

## 1. What this copy is

- HEAD = K3 group 4 session B1 after its rework(s) (tag `k3-g4b1-rN`, filled in by the lead); session A and groups 1–3
  underneath, on the lead branch at f15f25a4. Session B1's book `./.dsh-ref/k3-g4b1-impl.md` (section 8 = the lead's
  12 answers), its reply `./.dsh-ref/k3-g4b1-final.md`, its rework book `./.dsh-ref/k3-g4b1-rework-1.md` (**its
  rulings are binding here too**: items 2, 4, 5, 6) and reply `./.dsh-ref/k3-g4b1-rework1-final.md`.
- The spec: `docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md` (frozen). Read: L13 (~351, the round's
  input, tools, model, budget), L14 (~375, identity, replay, guards), L15–L16 (~384–410, the round's own end and
  settling), L17 (~411, reasons), L18 (~424, the card incl. `awaiting_approval`), L19 (~440), **L20 (~547–589, whole)**,
  §2 `propose_safer_method` (~1200), §3.2 UCR-03, 05, 06, 06b, 08, 08b, 08c, 12, 13, 15 (~1250–1270), §3.4 UR1, UR2,
  UR4, UR6, UR7 (~1305–1328), §5.2 K3-16, K3-19, K3-35, K3-46, K3-48 (~1430–1440).
- The rulings of group 4 session B: `./.dsh-ref/k3-g4b-rulings.md` (this session uses none directly; B3 uses 2–6).
- The TDD skill: `./.dsh-ref/tdd/`.

## 2. Scope (binding)

1. **The proposal round (L20 first bullet, L13, L15, L16; UR1/UR2/UR4 for `awaiting_proposal`).** The claim with
   `phase: 'proposal'` exists (`claim-service.ts` ~326, `workflow.ts` ~1356); admission refuses it today
   (`review-admission.ts` ~108–122, `proposal_phase_unsupported`). Make the proposal phase run: the same read-only
   tools and Session rules as the review round, with `propose_safer_method` in place of `record_unknown_call_review`;
   input channel `controlInputs` only (§2 note). The round's input names each `proposalTargets` item by alias with its
   original command, the record's conclusions, **the person's note text and annotations from the disposition** (L18
   "都带进后面的说明或方案"; B1 rework item 4 stored `disposition.annotations`), and for a mixed card the line that the
   unsettled platform items get no proposal (D7).
2. **`propose_safer_method` and `recordProposal` (UCR-05, §2).** The tool (in `unknown-call-review-tools.ts`, registered
   only in a proposal-phase review Run, name in `hostAuthorizedTools`, `effectClass 'workspace_write'`,
   `requiredCapabilities []`, L3's table already lists it) calls `UnknownCallReviewPort.recordProposal` (today
   `unsupported`). Identity, replay, changes and guards as L14 (same tool call replays to the original result). Item not
   in `proposalTargets` → `invalid_arguments`; command 1–4,000 UTF-8 bytes (taken as written), `cwd` ≤ 512 bytes,
   `rationale` 1–2,000; a new proposal for the same item replaces the old one. **Budget:** all current proposals
   rendered by `approvedMethodLinesZh` ≤ 5,120 UTF-8 bytes, else the owner answers `capacity`, writes nothing, and the
   tool result tells the model to shorten (L20). **One pure function:** move `approvedMethodLinesZh` to
   `src/contracts/continuation-brief.ts` (exported; L20 "写的时候量的和渲染时排的是同一个纯函数"), used by the state
   module's budget check (today its own copy, `state/unknown-call-review.ts` ~831–842) and by the renderer. The
   512 KiB serialized admission (M3) applies to the proposal write and its rationale (K3-48 (二)).
3. **Settling the proposal round (UCR-08, UCR-08c, UCR-06/06b for this phase).** Normal end → every
   `proposalTargets` item has a proposal → `awaiting_approval`; one missing → `needs_decision` with `proposal_missing`
   (and `review_incomplete` on the second unfinished round of this state entry, D2). Read-only commands unavailable
   with no round running → UCR-08c: `needs_decision`, `review_unavailable` + `proposal_missing`, zero model calls
   (K3-19 (二)). The round's own unfinished/stopped endings as UCR-06/06b.
4. **The approval card (L18, `awaiting_approval`).** The card source (B1) projects, for `awaiting_approval`, the two
   options `approve`, `decline` (fixed labels: ask in UNSPECIFIED if the spec has none — do not invent), each
   `proposalTargets` item's original command and the proposed command in full, and for a mixed card the sentence that
   the unsettled platform items are written in the continuation as "结果查不清，重做前先核实" (L20 第二个 bullet, D7).
   Answers: an option is required (B1's table gains nothing new: same kind); an answer to the first (disposition) card
   or an older revision → `revision_conflict`.
5. **The approval application (UCR-12, UCR-13) through B1's path.** `applyDisposition` handles the `approval` phase:
   identity = hash(record ref, `answerMessageRef`, `approval`) (L19); event `approval_applied` with
   `DecisionChangeProofV1`; the U3 decoder row already covers `UnknownCallReviewChanged`. `approve` → `resolved`,
   `disposition.approvedMethods` = each proposal's id, alias and full command (and cwd); `decline` → `needs_decision`
   with `proposal_declined`, `disposition.choice` stays `safer_method`, the approval recorded; the four-option card
   again (three when the round slots are used up, L18). UR7 and UR7b cover the approval answer like the disposition
   answer (the same advance function). **Not in B2:** UCR-12's `blockedCommands` (L19a, session B3).
6. **The continuation (L20 必需部分).** With an approved `safer_method`: the disposition line uses "换个稳妥的跑法：
   不要跑原命令，照下面的方案原样跑" and the source; the `approvedMethodLinesZh` block sits between the targets line
   and the platform line, required (never shortened or omitted); platform targets of a mixed card get the
   "结果查不清，重做前先核实" line. The required part stays within L20's budget table; above it, slice 1's
   `ContinuationBriefCapacityError` → `prepare` `capacity` (K3-35 (二)(三)).

## 3. Rows (§5.2) for this session

- **K3-16**, **K3-19 (二)**, **K3-35 (二)(三)**, **K3-46**, **K3-48 (二)** (the `propose_safer_method` half; the
  `record_unknown_call_review` half exists from group 3), and the `safer_method` branch of K3-15 that B1 left at the
  state entry. The start-up 6b variant (c) of B1 rework item 9 (stopped at `awaiting_proposal`): drive it now through the
  proposal round to the approval card (no new restart rows).
- K3-35 (二)(三) are built exactly as the row says (8 anchors with 512-byte task ids, then 600 bytes; 32 targets; a
  2,000-character note; 512-byte callIds; approved methods rendering exactly 5,120 bytes); the expected bytes are
  computed by hand from L20's table, not by calling the renderer.
- Memory and SQLite where the row says so; restart rows on the Host with SQLite only (B1 rework ruling 8).

## 4. Rules

- **TDD:** one test first (it must fail for the right reason), then the smallest change. Test names start with the row
  id. Expected values literal, from the rows or hand-computed.
- **Tests through public owners and routes** (`decisions/answer`, the card reads, the Workflow, the Host start-up, the
  scripted model calling `propose_safer_method`). Fault injection yes; fact injection no (no hand-encoded records,
  proposals or events). States only tampering can make are not tested (AGENTS rule 4).
- State transitions only through `src/core/work-graph/state/`. Production-reach allowlist: remove the entries your
  wiring reaches (`recordProposal`); add new ones only with "K3 group 4 session B3 wires it".
- **Reuse:** B1's card projection, the option-required table, `advanceReviewDisposition`, the identity helper, the U6
  adapter; the review round's tools, admission and claim; `approvedMethodLinesZh` as one function. No second copy.
- **Old tests:** the proposal-refusal assertions (`review-admission.test.ts`, `K3-19-review-admission.test.ts`) are
  expected to flip; report each with before/after (they are the frozen "proposal phase fails closed until group 4"
  assertions). Any other failing assertion: do not edit it; report it.
- No real model calls, no git writes in the repository, never ports 3080/3099/44797; probes under `./.dsh-scratch/`,
  deleted at the end.
- **Line budget (decision 69):** about 1,200 new production lines (soft). Report the count.

## 5. Order (suggested; you decide the briefs, files disjoint)

1. The pure function move and the proposal tool + `recordProposal` (items 2; K3-16's write half, K3-48 (二)).
2. Then in parallel: (A) the proposal round's admission, input and settling (items 1, 3; K3-19 (二), K3-16's round);
   (B) the approval card and application (items 4, 5; K3-16's card, K3-46); (C) the continuation (item 6; K3-35 (二)(三))
   — after the pure function lands.
3. Close-out (one subagent): the checks below.

## 6. Checks (close-out subagent)

- `--maxWorkers=2`: every `tests/**/K3-*.test.ts`, `tests/**/K-*.test.ts`, `tests/**/S5*.test.ts`,
  `tests/**/S4C2-*.test.ts`, `tests/business/`, `tests/scenarios/WP1-*`, `tests/scenarios/A8-host-restart*.test.ts`,
  `tests/state/`, `tests/composition/`, `tests/app/S4C*.test.ts`, `tests/architecture/`, `tests/**/*brief*.test.ts`,
  the new test files.
- Then `npm run typecheck`, `npm run check:architecture`, `npm run build`.
- Failures listed in `DSH-BASELINE.md` are expected in your sandbox (no bwrap). Name any other failure. Do not run the
  full suite.

## 7. Reply

Under 900 words: FILES CHANGED (production / tests, production line count); each scope item and row: done or not,
RED → GREEN; "B3 left"; CHECKS with numbers; UNSPECIFIED (short, with options); subagents (task, time, most at once);
anything surprising.

## 8. Answers to the read-through (lead; filled after the read-through)
