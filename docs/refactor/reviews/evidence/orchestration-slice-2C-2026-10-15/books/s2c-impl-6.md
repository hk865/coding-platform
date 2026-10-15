# Task: slice 2C, round 6 — the last review items before merge; test-driven where a public path exists

You are working in the slice-2C copy (the current directory). The earlier rounds' work is **uncommitted in the working
tree — keep it**. This is a NEW session. No git write commands, no network, no real model calls. Throw-away files under
`./.dsh-scratch/` (delete at the end). Finish within 120 minutes. **Headless: when your turn ends the run ends.** At most
2 subagents at once; stay in your turn until every subagent has reported (wait with `sleep 300`, then check; repeat).
Memory: every vitest command `--maxWorkers=4`, one at a time per agent; the full suite once at the end, `--maxWorkers=8`.

Read first: the Codex quick check `./.dsh-ref/s2c-quick.md` (the last review; 7 must-fix items, 2 should-fix), your last
report `./.dsh-ref/final-5.md`, and the frozen spec `docs/refactor/design/orchestration-2026-10/slices/slice-2C-SPEC.md`
(§0.3 L1–L24, §3, §15). The line numbers below are the reviewer's, in a tree that also has slice 2B merged; find the
same code by symbol in this copy.

## The items (lead rulings; do all seven, then the two small ones)

1. **Cycles across pages (L2, N9).** `work-line-reader.ts` (~:1389) looks for a cycle only inside the collection it was
   given, so on the archived pages a two-Session cycle split across pages vanishes. Do what L2 says: from every line head
   and every Session N2 would drop, walk `from` backwards with batched `readMany` (at most 32 steps), **reading records
   outside the page**; a revisit is a cycle; the cycle's smallest refKey gives one row with problem `invalid`, the same
   choice in `lines/list`, `lines/archived`, detail and hover. **No test** (spec L2: today's services cannot build a
   cycle; AGENTS rule 4 forbids database-tampering tests). The lead reviews the code; say where the walk is.
2. **A failed paused-task read is lost (B4).** `problem` is taken (~:456) before `readPausedTaskFacts`; a failed requeue-
   window read then drops the task (~:926) and the row keeps `problem: null`, losing its paused state and continue
   control silently. Settle `problem` after every fact read and apply B4 to this failure. Test-first: a public-path test
   where that read fails (inject the failing read the same way your other B4 tests do) → the row reports the incomplete
   fact, does not offer continue, and keeps the task.
3. **Read horizons (L1, L12, L14).** (a) The executions consistency set (~:2470) must include the head cursor and the
   successor-resolution reads, not only predecessor watermarks; (b) build the returned `segments` inside the accepted
   attempt, not from the first resolution outside the retries; (c) node participant and risk pages (`node-detail-reader.ts`
   ~:1020, ~:1200) return the real source cursor, never a made-up zero. Test-first for (c) and for (b) (a write between two
   attempts changes the segments; the answer matches the accepted attempt).
4. **Unbounded copy scan and a missing fallback (L1).** (a) `work-line-reader.ts` (~:1254) pages through every historical
   copy before dropping archived ones: index the active copies already enumerated by their source Session instead; no
   history scan. (b) On the usual `lastExecutionRef === Run` path (~:1087) the claim read that supplies `claimedAt` is
   skipped; when the Run has neither start nor end time, read that claim. Test-first for (b); for (a) extend the bounded-
   read counting test so the copy branch is counted.
5. **Claimed participants page by offset over full history (L14).** `node-detail-reader.ts` (~:974) rebuilds every
   claiming Session, then slices by `claimedOffset`, and each page first loads the whole canonical Run history (~:1152).
   Page the claiming source through its underlying Run index (cursor, not offset) and read only that page's outboxes.
   Extend `tests/work-graph/S2C-node-detail-bounded.test.ts` to this branch (reads per page bounded, pages cover all, no
   repeats).
6. **Coverage (§5.2).** (a) 2C-26 through LE4's HostScenario route path, not a separately assembled maintenance service
   (`tests/scenarios/S2C-K-legacy-provenance.test.ts` ~:128). (b) 2C-28's archive states built through real services, not
   by substituting the archive-state owner (`tests/work-graph/S2C-node-detail-next-kinds.test.ts` ~:52), and add the
   `next: null` case ("等待推进"). (c) The model/history-call observations 2C requires in
   `tests/work-graph/S2C-lines-read-only.test.ts` (~:190): `lines/*` and `graph/*` reads start no model call and no Kernel
   history read beyond the counted ones — observe them through the same injected ports your other read-only checks use.
   If one of these cannot be built through public services, stop on that one and report why (that is allowed); do not fake it.
7. **Test rules.** (a) `tests/helpers/S2C-D-node-support.ts` (~:352) makes current Run snapshots by hand; create those Runs
   through public services. (b) `tests/work-graph/S2C-lines-conversation.test.ts` (~:103) reads storage to get the expected
   watermark; take it from the public setup receipt instead. Expected values stay literal.
8. (small) Use `history_budget` everywhere a budget stop is recorded in `partialParts` (anchors and replies now write prose,
   ~:1838, ~:1927).
9. (small) `NotYetV1` in `src/contracts/work-line.ts` (~:199) is unused: either use it for the DTO fields it was meant for
   (spec §2) or delete it; say which.

10. **A reused Session gets no responsibility for the Task it claims (found by the lead under bwrap; you reported it in an
   earlier round).** `src/business/workflow/workflow.ts` opens a `responsible` link only when it **creates** a Session
   (`initialLinks`, ~:1107, ~:1448); when `chooseSession` returns `reuse`, the claim goes ahead and the Session works the
   Task without a responsible link, so the line does not read as responsible for its running Task and an archive cannot
   drop it. **Lead ruling (scope expansion approved):** the claim commit of a reused Session opens a `responsible` link to
   the claimed Task when the Session does not already hold an open one to it (same commit as the claim, SES-15
   `work_linked(open)`; replay writes nothing new; a re-claim or a transfer that already left an open link opens nothing).
   Find where the claim commit is built (`buildClaimOperation` → the claim service) and add it there, not in the Workflow
   alone. Test-first through public routes: S finishes Y (keeps Y's terminal link), the Workflow reuses S for X →
   `sessions/read` of S shows an open responsible link to X whose cursor is the claim's; claiming again replays without a
   second link. List every existing test whose assertions change because of this (file, test, before → after) in your
   reply; do not change them silently.
11. **`tests/scenarios/S2C-K-archive-tags-checks.test.ts` (the lead ran it under real bwrap: 1 pass, 4 fail).**
   - 2C-05 (3) and (3'): fail with "X must hold its responsible link" — X reuses S; item 10 fixes this. Re-check that the
     cases still mean what their names say after item 10.
   - 2C-05 (4) and (5): hang at `await held.reached` (240 s timeout): they call `h.holdReply(1)`, but the first Run uses
     reply 0 (indexes start at 0; `tests/scenarios/A7-control.test.ts` ~:1085 uses `holdReply(0)`). Fix the index or the
     script so the held reply is the one the first Run asks for; keep the expected values.
   - You cannot run the registered check here (no bwrap), but everything **before** the check step runs in your sandbox:
     run this file, make every case reach its check step, and report where each case stops. The lead re-runs it under
     bwrap after your round.

Do not edit specs. Do not touch files outside spec §6 and the files earlier rounds already changed; if you must, say why.

## Checks and reply

`npm run typecheck`, `npm run check:architecture`, `npm run build`, `node scripts/build-kernel-patch.mjs --check`;
targeted vitest; the full suite (`--maxWorkers=8`) compared with `DSH-BASELINE.md` §A (list every failure outside it;
`tests/scenarios/S2C-K-archive-tags-checks.test.ts` only at its check step, see item 11).
Reply: FILES CHANGED; per item 1–11 what changed (file:line) and the tests (names, result); CHECKS; UNSPECIFIED (anything
you had to decide); NOTES.
