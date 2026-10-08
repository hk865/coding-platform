# Part 2 of 2: implement slice 1

The lead reviewed part 1 and froze the tests. Now write the implementation. Everything in part 1 still holds: the spec and its reading order, the write scope, the git rules, the rules 1–10 and the checks.

## Frozen tests (the lead fills this in before sending)

These files must not change in part 2. At the end, `sha256sum` of each must print the value listed here.

```
【lead 发送前填写：23 个新测试文件和 4 个改过的已有测试文件的 sha256】
```

## Corrections to part 1 (the lead fills this in before sending; empty if none)

```
【lead 发送前填写：位置（file:line）、要重读的规格段、改的方向；不给代码】
```

## What part 2 does

Replace every stub of part 1 with the behaviour the spec gives, in this order (spec §5.6, the STATE-MACHINES-SPEC §15 convention). After each step run `npm run typecheck` and the new test files of that layer.

1. **Contracts and codecs.** The new shapes, the shape checkers and digests (`continuationBriefShapeProblem`, `continuationBriefDigest`, `renderContinuationBriefZh` keep old bytes for old briefs; spec §2.7), the new codecs and the six lookups (spec §2.8), the new events (spec §2.9). Old records decode with the defaults of spec §2.9.
2. **State rows.** The 19 rows of spec §3.2 and the refusals of the table under it, in `state/` (spec §3.5 signatures). Each refusal returns its exact `CoreRejection` code and reason prefix.
3. **Owners.** In the check order of spec §3.4: `requestSessionArchive`, `readSessionArchiveRequestReceipt`, `finishSessionArchive`, `releaseSessionArchiveRequest`, `backfillSessionProvenance`, the responsibility service, `tasks/session-facts.ts`, `tasks/session-provenance-facts.ts`, the anomaly service, `disposeArchiveWait`, `readUndeliveredReplies`, `readRoutedReplies`, the requeue `archiveOrigin` branch, the claim guards in `tasks/claim-service.ts` and `queries/query-execution.ts`, the input-binding check in `tasks/execution-entry-service.ts` and `persistence/execution-entry-codecs.ts`.
4. **AgentRuntime.** `readArchiveChangedFiles` (Kernel record → current HEAD worktree capture → unknown; spec §2.6 last paragraph and §0.2 T1), the anomaly section of the continuation brief, the `archiveOrigin` branch of preparation (spec §4.1 “历史输入”), the routed-reply input supply.
5. **Workflow.** `archiveLine` and `continueArchiveLine` (spec §4.1, the eight steps in order), `maintainSessions` (spec §4.2), `orderTasksByDependency` (spec §4.3), the copy archive after the answer in `consultation.ts`, the exclusion of copies, archive requests and waiting Sessions in `chooseSession`.
6. **Composition, Host and routes.** Wire the real owners in `create-platform.ts` (the same `SessionFactsPort` instance into sessions, queries, tasks and Workflow; `SessionArchivePolicyV1` default; `SessionDutyResolver` built from `WorkflowHostConfiguration.bindings[].sessionRole` as spec §2.8 says), the startup maintenance call after reconciliation in `startup-reconcile.ts`, the bounded maintenance step in `collaboration-driver.ts`, and the 11 routes.

At the end `git grep -n "not implemented: " -- src` prints nothing.

## Rules added for part 2

11. **Do not edit a frozen test.** If a frozen test and the spec disagree, do not change either: report the test id, the assertion, the spec line and a minimal counter-example under UNSPECIFIED, and leave that test failing.
12. **Stop is not success.** A queued cancel does not release the Session (`archive_execution_pending:`); an `outcome_unknown` Run is not stopped until a human attests it through the existing `resolveUnknownRun` path (`src/composition/create-platform.ts:887`); a Query is never cancelled or paused by an archive (IT14); an archive never completes a Task, never starts a check and never reverts files.
13. **A composite failure is not zero writes.** When a later step of `archiveLine` fails after earlier steps committed, return `ready` with `state: 'partial'`, the committed receipts, the original rejection and the exact message `处置已完成，归档没成功` (IT13). Never undo a committed step.
14. **The rework cap exemption is narrow.** Only a stop caused by this archive request (its cancel, its wait cancel) or a real `interrupted` fact of that Run counts as `interrupted` and is not counted (UT32, UT33, SV35, SV57); a forged or unmatched archive origin is refused (UT34, SV36, SV48, SV49), and an ordinary failure that happened before the retirement keeps its class and its count (SV59). Earlier human pause and cancel fences keep their meaning (UT35, SV37).
15. **Maintenance starts nothing.** No timer, at most one page per call, no model call, no Kernel start, no check (IT06–IT11, IT31, IT33, IT34).
16. **Changed files are honest.** Kernel-confirmed paths go to `confirmed`, the rest to `possible`; the worktree fallback puts everything in `possible` with `runBaselineKnown: false`; when nothing can be read the status is `unavailable` with a reason, never an empty “no changes” (IT01, IT02, IT32, SV27).

## Checks

Run the commands of part 1, then `npm run build`. Do not run any other tests.

Expected at the end of part 2:
- `npm run typecheck`, `npm run check:architecture` and `npm run build` exit 0.
- New tests: 23 files, 212 tests, all pass.
- Regression command: every file equals the baseline of part 1, except `tests/state/session-availability.test.ts` and `tests/state/message-machine.test.ts`, whose test counts grow by the matrix rows you added in part 1 and which all pass, and `tests/architecture/state-writes.test.ts` and `tests/architecture/production-reach.test.ts`, which pass. A test that failed in the baseline only because `/usr/bin/bwrap` is missing may still fail for that reason; name it.
- If `tests/architecture/production-reach.test.ts` reports a new unreached declaration, wire it as the spec says or report it; do not add an allowlist entry.

## Final checks before the report

```
git status --short                     # exactly the 87 files of the write scope (38 new, 49 modified), nothing else
git grep -n "not implemented: " -- src  # prints nothing
sha256sum <the 27 frozen test files>   # equal to the list above
sha256sum src/contracts/platform-duty.ts  # 6adfb57e8bcb7ec387257e19c3811abb61a5fd21d37a8889566bf34cc32a9e39
```

Then delete `./.dsh-scratch/` and any other helper or log file you created. `git status --short` then shows only the 87 files.

## Final report

Reply with these four sections and nothing else:

- FILES CHANGED: each file, `N` or `C`, one per line (87 lines).
- CHECKS: each command and its result (exit code; for vitest the `Test Files` and `Tests` lines and the per-file numbers), next to the baseline and the part-1 result.
- UNSPECIFIED: each case the spec does not describe that you met, one line each; each frozen test you believe contradicts the spec (id, assertion, spec line, counter-example); every sentence of the spec that disagrees with the code, with file:line. Every claim that something was not found names the command that found nothing.
- NOTES: at most ten lines: the real call chain of `archiveLine` (file:function, in order), anything that blocked you, anything left undone.
