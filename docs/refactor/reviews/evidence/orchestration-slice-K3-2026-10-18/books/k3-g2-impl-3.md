# Task: K3 group 2, part 3 — seams, the restart business flows (R1), L6, the last K3-21 cases; coordinator mode; test-driven

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. The spec, the
books and the lead's rulings are binding; do not make design decisions. Where they do not determine something, choose
nothing: list it under UNSPECIFIED with the smallest options, and go on.

**This run is headless. When your turn ends, the whole run ends.** **Work in coordinator mode:** read
`./.dsh-ref/coordinator-mode.md` first and follow it. Subagents write all code and tests; you split, brief, check and
reply. **Finish within 200 minutes** (the run stops at 210, with a handoff if needed). Finish whole items; an
unfinished item is reported, not half-done.

## 1. What this copy is

- Tags: `k3-g1` = group 1; `k3-g2a` and `k3-g2b` (HEAD) = group 2 parts 1 and 2, committed by the lead.
- Replies: `./.dsh-ref/k3-g2a-reply.md`, `./.dsh-ref/k3-g2b-reply.md` (names and gaps).
- Books: `./.dsh-ref/k3-g2-impl.md` (sections 1–8 binding, section 8's answers in particular) and
  `./.dsh-ref/k3-g2-impl-2.md`.
- The spec: `docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md`. Read only the lines named below.

## 2. Lead checks on part 2 (with bubblewrap, outside your sandbox)

- **Pass:** A8-host-restart, A8-host-restart-entry, A8-host-restart-attestation, the store-wrapper seam,
  S1-archive-flow, S2B-be2-late-evidence-activity, A2-reconcile-runtime, WP2-wiring, WP2-undelivered-notices. That is
  122 passed and 2 skipped; the §5.3 assertions hold.
- **Fail:** `tests/business/WP1-continuation-handover.test.ts`, 9 of 17. `tests/helpers/WP1-handover-fixture.ts:376`
  (`attestedStop`) is rejected with `record … uses unregistered schemaId UnknownCallReview@1`: the fixture's backend
  does not register the review schemas.

## 3. Rulings (binding)

1. **WP1 fixture:** register `UNKNOWN_CALL_REVIEW_RECORD_SCHEMAS` in that fixture's backend, as part 2 did in
   `S2B-be2-reconcile-support.ts`. This is fixture input only; never change an assertion.
   - Then run `tests/business/WP1-continuation-handover.test.ts`.
   - An HO test that still fails because the continuation note now has a review section: do not edit it. List it with
     the assertion; the lead writes the after-assertion.
   - Any other hand-built test backend that fails for the same reason: same fix, and report it.
2. **K3-21's queued-steer case is replaced (lead ruling; spec post-note at merge).**
   - Why: a steer never moves the Run's control pointer. `run-machine.ts:184`: a standalone `steered` pointer "has no
     writer". So G4's `steered` cannot occur. L25's "写什么" settles queued steers in the RUN-25 commit (CTL-08(b)/(c)),
     and K3-30 asserts it.
   - Delete the skipped case. Instead: a queued steer, every guard holding → RUN-25 (`W-26`). The steer is Applied if
     the Kernel accepted it, otherwise Superseded, and its text is in the continuation note.
3. **R1 tests must run inside your sandbox.**
   - Drive `workflow.advanceWork` only until the continuation is claimed and prepared: the note is in the prepared
     manifest. No check may run; checks need bubblewrap.
   - A row assertion that needs a check: leave it and report it.
4. **K3-03 split** (as part 1's book section 8): assert the item `undetermined` (`lookup_failed`) and the record
   `needs_decision` with `undetermined`, read through `unknown-call-reviews/read`. No card and no continuation
   assertions; they are group 4.
5. **K3-21's `session_not_closable` and `second_auto_cleanup` move to R1** (part 2 found no R3 path):
   - `session_not_closable`: an archive request on the claim Session through the public archive route, then the crash.
   - `second_auto_cleanup`: Run A ends by RUN-25; its continuation B is in flight again; crash → RUN-20(i) with
     `second_auto_cleanup`. Then read B's record after `executions/resolve-unknown`, and assert its `streak` as literals
     per L23 example 1.
   - "Applied pause" with an unresolved call: build it only if a public path exists. Otherwise report why it cannot
     occur (file:line).

## 4. Work (suggested split; you decide the briefs, keeping files disjoint)

1. **Shared first: seams** (spec §5.1 "夹具的接缝", lines 1394–1401), under `tests/scenarios/support/` or
   `tests/helpers/`, each with a tiny self-test. They drive public paths only.
   - The stand-in `shell`: `vi.hoisted` + `vi.mock` of `createShellToolDefinition`; a switchable blocking handler,
     name `shell`, `effectClass` `process`, no `isolated_process`; off = the real one. Part 1 left a helper,
     `tests/helpers/K3-tool-seams.ts`; integrate it and self-test it.
   - The git workspace option on `HostScenario.open`: `git init`, commit the initial files, one file under the Host's
     denied prefix.
   - The crash points K3-01/K3-02 need:
     - K3-01: the message committed, the Kernel without a result (A8-3j's point);
     - K3-02: before the message commit.
   - Long commands and long ids, as far as K3-48 needs them.
   - The WP1 fixture fix (ruling 1).
2. **L6, production** (spec lines 213–222; contracts `src/contracts/continuation-brief.ts`, assembly
   `src/core/agent-runtime/continuation-brief-assembly.ts`). The record's continuation-note section:
   - per alias, the verdict;
   - for file edits: mode, path, bounded `oldText`/`newText` excerpts, the L5 change, and the diff with L6's caps
     (2,000 units per path, 8 KiB per section, `diffOmittedReason: 'section_limit'`);
   - the fixed sentence that not being listed does not prove "not done".

   Group 4 adds the approved methods and blocked-command lines; leave room, do not build them.
3. **R1 flows:** K3-01, K3-02, K3-03 (ruling 4), K3-04, K3-40 (all five cases through RUN-25 on the git workspace), as
   their rows write (spec lines 1408–1411 and 1417).
4. **K3-21 in R1** (ruling 5), **the queued-steer replacement** (ruling 2), and **K3-48 (一)'s missing half**: through
   the classifier path, a creation overflow still goes to RUN-25, not RUN-20(i) (G11 does not block `too_large`).
5. **Close-out:** the checks in section 6, one subagent.

## 5. Rules

As the first book (section 4):
- R1 = `HostScenario` with `restart({ crash: true })`, the real SQLite and the lease file, and `workflow.advanceWork`;
- no database reads to verify; literal, hand-computed expectations; test names start with the row id;
- state only through `state/`;
- no real model calls, no git writes in the repository (the git workspace inside a scenario's temporary directory is
  test data and allowed); never ports 3080/3099/44797; probes under `./.dsh-scratch/`, deleted at the end.

**Line budget:** group 2 is at about 2,820 new production lines (soft budget 2,000). This part adds only L6 and glue.
Report the count.

## 6. Checks (close-out subagent)

- `--maxWorkers=3`: `tests/state/`, `tests/runtime/`, `tests/scenarios/A8-*.test.ts`, `tests/scenarios/K3-*.test.ts`,
  `tests/business/WP1-continuation-handover.test.ts`, `tests/business/S1-archive-flow.test.ts`,
  `tests/composition/platform.test.ts`, `tests/composition/WP2-wiring.test.ts`, `tests/architecture/`, the new test
  files.
- Then `npm run typecheck`, `npm run check:architecture`, `npm run build`.
- Failures listed in `DSH-BASELINE.md` are expected in your sandbox. Name any other failure.
- **Do not run the full suite.**

## 7. Reply

Under 900 words:
- FILES CHANGED (production / tests / seams, with the production line count);
- each ruling 1–5 and work item 1–4: done or not, RED → GREEN;
- CHECKS with numbers;
- UNSPECIFIED (short, with options);
- for each subagent: its task and its context or time if you can see it;
- anything that surprised you.
