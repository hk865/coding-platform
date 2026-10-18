# Task: K3 group 2, part 2 — wire RUN-25 for the real Host, the streak and Session checks, the created event, the classifier rows (R3); test-driven

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. The spec, the
first book and the lead's rulings are binding; do not make design decisions. Where they do not determine something,
choose nothing: list it under UNSPECIFIED with the smallest options, and go on.

**This run is headless. When your turn ends, the whole run ends.** **Use subagents (at most 2 at a time, on separate
files) for writing tests; keep your own context for production code.** The first session of group 2 reached 339k
context in 43 minutes and stopped. Stay in your turn until every subagent has reported (wait with `sleep 300`, then
`list_agents`). **Keep your context small:**
- use `grep -n`, `sed -n a,bp`, `git diff --stat`;
- never print whole files or whole diffs;
- never re-read the spec end to end; read only the rows and rules named here.

**Finish within 150 minutes** (the run stops at 160). Finish whole items; an unfinished item is reported, not half-done.

## 1. What this copy is

- Tag `k3-g1` = group 1. Tag `k3-g2a` (HEAD) = group 2 part 1, the first session's work, committed by the lead.
  - Its reply is `./.dsh-ref/k3-g2a-reply.md`.
  - What it built: the record codec and read side, `unknown-call-reviews/read`, the draft function, the capture
    traversal, the baseline in `prepare`, the owner lookups, RUN-25 through the owner, the §5.3 input changes.
- Your book is `./.dsh-ref/k3-g2-impl.md` (sections 1–8 stay binding, **section 8's answers in particular**). This book
  adds the lead's findings on part 1 and the items left.

## 2. Lead findings on part 1 (binding; fix them first)

1. **Streak is hard-coded.**
   - Where: `run-reconcile-service.ts` writes `priorAutoCleanup: false, priorUnknownProcess: false, streakResetRunRef: null`
     (around lines 350 and 778).
   - Section 8 Q4 forbids this. Implement Q4 exactly, for RUN-25 and RUN-22:
     - walk the chain the way `task-failure.ts:chainRunIds` does;
     - read the chain Runs, and their records by key;
     - call `streakOf`;
     - put every Run and record read into the commit as version guards; an absent record key is guarded as absent;
     - a read failure → `unavailable`, no write.
2. **G7 is narrower than Q5.** `sessionClosableFor` checks only lifecycle, archive request and occupancy. Implement Q5:
   - read through `createSessionFactsService({ records }).readSessionFacts`;
   - `continuations` must be empty and `legacyPending` false;
   - `latestWork` must be this Run with the same claim generation;
   - a read failure → `unavailable`, no write.
3. **No `UnknownCallReviewChanged@1` event is written** (`encodeUnknownCallReviewChangedEvent` is unreached).
   - L7: every change writes one, `created` included.
   - It goes in the RUN-25 commit and in the RUN-22 commit, with identity key, fingerprint, actor, requestId,
     occurredAt and the whole record.
   - Remove its allowlist entry.
4. **The real Host cannot reach RUN-25.**
   - `startup-reconcile.ts` does not pass `takeover` to the classifier. §2 says: `StartupReconcileDependencies.takeover`
     goes to `reconcileRunAtStartup`, and step 2 copies `RunReconcileReport.autoCleanup` into `ReconcileLine.autoCleanup`.
   - `create-platform.ts` gives the classifier and the Host entry no `turnClosureSupport`, `captureWorkspace` or
     `lookupToolCommit` (the entry passes `{}`). Wire all three exactly as section 8 Q2/Q3 say:
     - `turnClosureSupport` is the Runtime's read-only check (K L4 item 5), returning the head as part 1 did; that is
       accepted;
     - `captureWorkspace` reads the manifest at `bundleRef`, uses its `workspaceBaseline` and the Host's root and
       `deniedPrefixes`, writes the capture Artifact, and returns `WorkspaceCaptureV1`;
     - `lookupToolCommit` is the dispatch by tool name over the owners' published lookups.
5. **Two draft paths.** `run-reconcile.ts:readReviewDraftAtEntry` and `unknown-call-draft.ts:readUnknownCallReviewDraft`
   both exist. Keep one draft builder (Q3). The entry may first read the Kernel facts and then call the builder; it must
   not repeat the builder's logic. Report what you kept.
6. **Allowlist notes.** `UnknownCallReviewReadPort.listReviews` and `.listUnappliedAnswers` are group 3 (fix the note).
   Remove every entry your wiring now reaches.

Accepted from part 1, no change: `turnClosureSupport` returning `headActiveRunId`; `tool-commit-arguments.ts` in
`model/`; the classifier overrides added to `restartedHost` in `A2-reconcile-runtime.test.ts`; new K3 cases appended
to that file; the review schemas registered in the A8/S1 test backends (they list schemas by hand).

## 3. Items left (in order, after section 2)

1. **K3-21, all remaining cases (R3).** Each is RUN-20(i), the Host report line is `W-13`, and `autoCleanup.blockedBy`
   is as the row writes:
   - `stop_pending`, four cases: queued pause, applied pause, queued cancel, queued steer;
   - `inputs_unconfirmed`;
   - `session_not_closable`: an archive request;
   - `second_auto_cleanup`: the previous Run on the chain ended by RUN-25. Then read the later record's `streak` through
     the route, `{ priorAutoCleanup: true, priorUnknownProcess: <as L23>, resetRunRef: <literal> }`;
   - `workspace_unstable`, `workspace_too_many_changes`;
   - `inventory_incomplete`: 33 calls; and one undecodable call;
   - several guards failing at once → the first in L25's order;
   - `review_round` **only if** a public path to a review-purpose Run exists in this copy. Otherwise report it; it moves
     to group 3.
2. **K3-22, K3-23, K3-24 (R3)** as their rows write. K3-23's assertions apply to every K3-21/K3-22 case: zero model
   calls, zero Kernel closes, no review round, no record, Session and Lease still held.
3. **K3-48 (一):** a RUN-22 (or RUN-25) Turn whose items, in Kernel order, just overflow B = 158,720 bytes (long commands
   and paths). Assert:
   - the record is created with `incomplete` / `too_large` and the right `itemsOmitted`;
   - it is `needs_decision` and its reasons contain `inventory_incomplete`;
   - G11 did not send it back to RUN-20(i);
   - the dropped calls appear nowhere in the record.
4. **The store-wrapper seam** (fail the next `lookupCommit` once; a `HostScenario.start` option in the `wrapRecords`
   style), with a tiny self-test. K3-03 needs it in the next session.

**Not in this session:** the R1 flows K3-01..K3-04, the git-workspace seam, the stand-in `shell` integration, L6. The
next session does them.

## 4. Rules

As the first book (section 4):
- R3 = the classifier fed through the hand-written dependencies; R4-owner = owners through the store boundary;
- no database reads to verify; literal, hand-computed expectations;
- state only through `state/`;
- no real model calls, no git writes, never ports 3080/3099/44797; probes under `./.dsh-scratch/`, deleted at the end.

**Line budget:** part 1 used about 2,440 new production lines, against the soft budget of about 2,000 for the whole
group. Add only what these items need, reuse what exists (the Session facts service, `chainRunIds`, `streakOf`, the
codec's encoder), and report the count.

## 5. Checks

- **While working:** only the files you touch, `--maxWorkers=2`.
- **At the end, once, with `--maxWorkers=3`:** `tests/state/`, `tests/runtime/`, `tests/scenarios/A8-*.test.ts`,
  `tests/app/A2-host-instance-lease.test.ts`, `tests/app/S2B-be2-late-evidence-activity.test.ts`,
  `tests/business/S1-archive-flow.test.ts`, `tests/composition/platform.test.ts`, `tests/architecture/`, your new test
  files.
- Then `npm run typecheck`, `npm run check:architecture`, `npm run build`.
- **Do not run the full suite.**

## 6. Reply

Under 800 words:
- FILES CHANGED, with the new production line count for this session and for group 2 so far;
- each finding 1–6 and each item 1–4: done or not, RED → GREEN;
- CHECKS with numbers;
- UNSPECIFIED (short, with options);
- anything that surprised you.
