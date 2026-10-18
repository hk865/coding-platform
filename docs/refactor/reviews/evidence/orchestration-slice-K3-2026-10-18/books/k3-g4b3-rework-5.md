# Task: K3 group 4 session B3, rework 5 — finish the move onto the real path; coordinator mode; test-driven

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. The spec, the
books and the lead's rulings are binding; do not make design decisions; report anything undetermined under
UNSPECIFIED with the smallest options.

**This run is headless. When your turn ends, the whole run ends.** Work in coordinator mode
(`./.dsh-ref/coordinator-mode.md`; **read "How tests reach their state: no hand-written facts" (with "A name does not
change what it is") and "Before you build: what the reworks were about" first; both bind every brief**; the close-out
runs one vitest command at a time). Files disjoint between subagents, every vitest command `--maxWorkers=2`. **Do not
end your turn while a subagent has not reported back.** **Finish within 180 minutes** (the run stops at 190). Finish
whole items; an unfinished item is reported, not half-done. Delete `./.dsh-scratch/` (the directory too) before you end.

## 1. What this copy is

Tag `k3-g4b3-r4` (HEAD) = rework 4 (book `./.dsh-ref/k3-g4b3-rework-4.md`, your reply
`./.dsh-ref/k3-g4b3-rework4-final.md`). Codex's quick check: `./.dsh-ref/k3g4b3-review5.out.md` (Chinese; items 1–8
with file:line and the fix approach, and a table of the 8 files for item 4). The rule of rework 4 §1 for the shared
fixture still binds. Production code is done; this round is the tests, plus item 3's assertion.

## 2. Items (binding; Codex's numbering in brackets)

1. **Recognition through the real Host path** [1]. The fixture no longer builds the unknown-call classification or
   calls RUN-20/22 itself (`K3-35-continuation-fixture.ts` ~588, ~601) and no longer opens its own store (~437): reuse
   the platform's Host assembly and the public `resolveUnknownRun` (`create-platform.ts` ~1980, ~2070), so the draft
   is read with the real `lookupToolCommit` and `captureWorkspace` (your UNSPECIFIED 8 is not accepted).
2. **No constructed scenario state left in the K3-35 chain** [2]. The 32 process items in `K3-large-review-input.ts`
   (~190, ~257, ~265) leave the scenario: real owner rows use reachable states; the 32-item extreme stays in the pure
   renderer/codec tests. `K3-35-owner-manifest-trim.test.ts` (~106) ends its round through the Runtime (model reply or
   `beforeReply` fault), no fixture terminal event, position or history.
3. **The closed branch (lead ruling).** The spec ties a closed Task to a closed CRR and lapsed allowances
   (`slice-K3-SPEC.md` ~537); it does not require prepare to refuse. Ruling: prepare's `ready` with no blocked binding
   and no blocked lines stands, and the test adds the consequence: the following public start of that prepared value
   for the cancelled Run is refused, so nothing runs. If the start is not refused, report it (do not change production).
4. **Move the 8 files of Codex's item 4 onto the real path and delete the builders** [4]. Follow the table in the
   review: `K3-16-approval-application` ~98, `K3-16-proposal-round-fixture` ~64/97/135/245/268,
   `K3-16-proposal-write` ~39/186, `K3-16-second-unfinished-proposal` ~58/110/128/150, `B2-01-task-read` ~30/71,
   `B2-09-crr-owner` ~53, `B2-12-recognition` ~184 (the owner row only), `B2-02-approved-method` ~41. Single-item real
   records for scenarios; multi-alias ordering and serialization extremes go to pure tests; delete scenarios that served
   only the old builders. Capacity stays on the real path with Codex's arithmetic (`28+4000+2×546=5120`,
   `28+3999+2×547=5121`, `continuation-brief.ts` ~879). Then delete `k3ProcessItem`/`k3PlatformItem`, the direct
   RUN-20/22 calls and the second start-up assembly (`K3-proposal-round.ts` ~111, ~390, ~607) and the ordinary-card
   state builders (`K3-review-card-fixture.ts` ~364, ~389). Report helper lines before (5,931) and after; they must fall.
5. **The crashed end in the 401 world (lead ruling)** [5]. A `beforeReply` fault the Runtime records as `run_crashed`
   is accepted for B2-16/B2-18's read-count proof (a completed ordinary Run leaves the Task `verifying`, and requeue is
   `busy`). Replace the `lead-approved` wording (`B2-401-world.ts` ~16) with a pointer to this book item.
6. **Cleanup on every path** [6]. In `B2-401-world.ts` (~291, ~318, ~345, ~381) register each Run in `live` right after
   start; `finally` releases the gate, awaits the Run, then closes the store; the 402nd start too.
7. **B2-07 two cards on one Task** [7]. Two Runs leave two real review records; dispose both; request the two commands;
   assert two cards and one closure read (`B2-07-crr-card-closed.test.ts` ~105, ~129; CRR dedups by reviewRunId+alias,
   `command-rerun-request-service.ts` ~750, ~818).

Codex's item 8 (A8-3n) is the lead's; leave it. Not this round (T list): K3-11, K3-14, K3-45, the non-proposal part of
K3-48-2, K-R-close-open-turn, B2-execution-entry.

## 3. Checks

As rework 4 §3 (exact file lists, one vitest command at a time, `--maxWorkers=2`; typecheck, check:architecture,
build). The close-out greps every K3/B2 test and helper for `recordRunResult`, store `append`/`commit`,
`SqliteStores.open`, `RUN-20`/`RUN-22` direct calls, and constructed drafts, items, events, positions, cursors or
prepared values, and lists each hit with why it is allowed. No real model calls, no git writes, never ports
3080/3099/44797.

## 4. Reply

Under 900 words: per item RED → GREEN or how it was checked, helper lines before and after and which were deleted, the
8 files with what each became, the 401 world's time, the grep list, checks with numbers, UNSPECIFIED.
