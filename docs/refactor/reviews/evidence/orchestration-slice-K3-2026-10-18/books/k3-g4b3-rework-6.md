# Task: K3 group 4 session B3, rework 6 — the last tests off hand-written facts; coordinator mode; test-driven

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

Tag `k3-g4b3-r5` (HEAD) = rework 5 (book `./.dsh-ref/k3-g4b3-rework-5.md`, its reply
`./.dsh-ref/k3-g4b3-rework5-final.md`, its grep ledger `./.dsh-ref/k3-g4b3-closeout-grep.txt`). Codex's quick check
of rework 5: `./.dsh-ref/k3g4b3-review6.out.md` (Chinese; book items 1–7, then "剩余必须改" 1–6 with file:line and the
fix approach). Items 3, 5, 6 and 7 of rework 5 are done; rework 5's UNSPECIFIED 3, 5 and 7 are accepted. Production
code is done: if an item seems to need a production change, stop that item and report it.

**What counts as a hand-written fact here (lead ruling, binds the ledger).** A value a test builds and then uses as the
*precondition* of what it asserts: a Run's end (`recordRunResult` with a built `terminalEvent`), a recognition
(`reconcileRun` + `resolveUnknownRun` with a built draft or classification), a stored record, a position or cursor.
Not a fact: (a) the input under test of a rejection or validation row (for example K3-26's malformed-request rows
~285–523, B2-execution-result's own `recordRunResult` rows), where the test asserts the owner refuses it and reads
nothing downstream; (b) pure tests (`*-pure.test.ts`, renderer/codec/state-machine tests with no store); (c) a store
wrapper that delegates to the real store to count or inject a fault; (d) the T-list files below.

## 2. Items (binding; Codex's numbering of "剩余必须改" in brackets)

1. **One recognition path** [1]. `K3-blocked-command-fixture.ts` (~355–395) assembles its own classifier, its own
   reconcile service without `lookupToolCommit`/`captureWorkspace`, and calls RUN-22 itself. Delete that assembly; the
   fixture recognizes through the same Host chain the K3-35 fixture uses (`K3-35-continuation-fixture.ts` ~548, ~555:
   `createTargetPlatform` + `reconcileRun` + the public `resolveUnknownRun`, `create-platform.ts` ~1980, ~2070). One
   platform per world, not per Run (the 401 world must stay within its time; report before/after).
2. **K3-48-3** [2, rework 5's UNSPECIFIED 4 not accepted]. The 32-item constructed record committed through RUN-20/22
   (`K3-48-3-required-writes.test.ts` ~101, ~109) and the constructed drafts (~161, ~248) leave the owner scenario: the
   32-item extreme is a pure codec test; the owner rows use reachable states through the shared public steps.
3. **Preconditions through public steps in the other group-4 files** [2]. Each of these reaches its precondition by a
   hand-written fact; move it onto the shared public steps (the Run ends through the Runtime: the model's final reply,
   a `beforeReply` fault, or cancel/stop; recognition through item 1's Host chain). Ended Runs:
   `K3-review-workflow-rows.test.ts` ~297–299, `K3-06-mixed-kinds-owner.test.ts` ~228–232,
   `K3-13-two-items-owner.test.ts` ~232–236, `K3-26-unknown-call-review-storage.test.ts` ~775–779,
   `K3-47-claim-gate.test.ts` ~69–71, `K3-47-reader-facts.test.ts` ~136–138. Constructed recognitions:
   `K3-15-review-routes.test.ts` ~129, `K3-15-ur3h.test.ts` ~156–169, `K3-15-hold-release.test.ts` ~108–120,
   `K3-18-autonomy-facts.test.ts` ~119–125, `K3-29-startup-reconcile-2b.test.ts` ~117–123,
   `K3-41-release-hold.test.ts` ~402–409, `K3-43-continuation-vs-hold.test.ts` ~104–111,
   `K3-43-review-claim-vs-hold.test.ts` ~89–96, and the precondition calls of `K3-06` (~101, ~166) and `K3-13` (~112,
   ~177). A combination the real path cannot reach goes to a pure test; say which and why.
4. **Both backends** [3, rework 5's UNSPECIFIED 1 not accepted]. The spec runs every service-layer example on memory
   and SQLite (`slice-K3-SPEC.md` ~1374) and names K3-20 for both (~1389, ~1434). The platform takes
   `storage: { kind: 'memory' }` (`TargetPlatformOptions`, `create-platform.ts` ~216), so the shared fixture opens either
   backend. Restore the memory rows rework 5 dropped (K3-16 three, K3-17-goal-guard one, `K3-20-review-card-paging`
   ~52) and make every scenario row the spec lists run on both.
5. **K3-18's decision row is reachable** [4, rework 5's UNSPECIFIED 2 not accepted]. Spec ~274
   (`kernel_unreadable_at_stop`): the Kernel is unreadable when the Run stops (RUN-20(ii)) and readable again before
   recognition, so the inventory is `incomplete`; the draft keeps the recovered `file_edit` (`unknown-call-draft.ts`
   ~140, ~187, ~207) and the state machine gives `needs_decision` (`unknown-call-review.ts` ~793). Reach it with a
   transient Kernel read failure injected through the fixture's dependencies, then restore the answer-rejection,
   re-read and passing assertions (`K3-18-review-card-queue.test.ts` ~358, ~364) and the file-annotation part of
   `K3-15-disposition-effects.test.ts` (~323, ~344) that rework 5 removed.
6. **B2-02's later Run** [5]. `B2-blocked-runtime.ts` (~140) starts a new harness whose default id counter restarts
   (`K3-35-continuation-fixture.ts` ~389), so the later claim collides. Use the world's one unique id source
   (`B2-crr-world.ts` ~44, ~110) and restore B2-02's requeue + claim of the later Run (`B2-02-approved-method.test.ts`
   ~76) instead of the record's own runRef.
7. **The manifest measure** [6, rework 5's UNSPECIFIED 8 not accepted]. `K3-35-manifest-trim-pure.test.ts` (~120)
   measures two fields; production measures the whole manifest (`execution-preparation.ts` ~555). Measure a complete
   legal manifest the same way; keep the assertions that the final step fits 256 KiB and the step before does not.
8. **K3-35 hook timeouts.** In the lead's bubblewrap check of rework 5 (full run, 5 workers) the `beforeAll` of
   `K3-35-T-by-hand.test.ts` (~99, ~152) and `K3-35-approved-methods-brief.test.ts` (~80) timed out at vitest's 10 s
   hook default while `openK3_35PublicRecord('sqlite')` built the world, and `afterAll` then read `close` of undefined
   (~100, ~153, ~81); the same three hooks failed in the checks of reworks 3 and 4. Measure the setup alone
   (`--maxWorkers=2`) and with the other K3-35 files beside it; give every `beforeAll` that builds a K3-35 world an
   explicit timeout as its last argument, sized from the measurement with margin and on the repository's usual steps
   (`60_000`, `120_000`, `180_000`); guard each `afterAll` so a failed setup reports the setup error only. Report the
   measured times. Do not raise the global `hookTimeout`.

Not this round (T list, unchanged): K3-11, K3-14, K3-45, the non-proposal part of K3-48-2, K-R-close-open-turn,
B2-execution-entry. Codex's A8-3n item stays the lead's.

## 3. Checks

As rework 4 §3 (exact file lists, one vitest command at a time, `--maxWorkers=2`; typecheck, check:architecture,
build). The close-out rewrites `./.dsh-ref/k3-g4b3-closeout-grep.txt` over every K3/B2 test and helper
(`recordRunResult`, `terminalEvent`, store `append`/`commit`, `SqliteStores.open`, `reconcileRun`,
`resolveUnknownRun`, RUN-20/22 direct calls, constructed drafts, items, events, positions, cursors, prepared values)
and gives **each hit one of the categories (a)–(d) of §1 with a short reason**; a hit that fits none is a defect to fix,
not to list. No real model calls, no git writes, never ports 3080/3099/44797.

## 4. Reply

Under 900 words: per item RED → GREEN or how it was checked; the files of item 3 with what each became; the memory rows
restored; helper lines before (5,193) and after; the 401 world's time; the ledger's counts per category; checks with
numbers; UNSPECIFIED.
