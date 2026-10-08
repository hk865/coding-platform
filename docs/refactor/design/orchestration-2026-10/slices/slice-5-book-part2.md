# Part 2 of 2: implement slice 5

The lead reviewed part 1 and froze the tests. Now write the implementation. Everything in part 1 still holds: the spec and its reading order, the write scope, the git rules, the rules 1–14 and the checks.

## Frozen tests (the lead fills this in before sending)

These files must not change in part 2. At the end, `sha256sum` of each must print the value listed here.

```
【lead 发送前填写：15 个新测试文件、2 个支持文件和 tests/architecture/state-writes.test.ts 的 sha256】
```

## Corrections to part 1 (the lead fills this in before sending; empty if none)

```
【lead 发送前填写：位置（file:line）、要重读的规格段、改的方向；不给代码】
```

## What part 2 does

Replace every stub of part 1 with the behaviour the spec gives, in this order (spec §8.1, the STATE-MACHINES-SPEC §15 convention). After each step run `npm run typecheck` and the new test files of that layer.

1. **Contracts, codecs, indexes.** The shapes of spec §2.2–§2.5 and §2.8; Goal and Workspace codecs keep the old public shape and preserve new fields through encode, decode and old-event restore (`writtenGoalHasExactShape`, `nextGoalDesiredState`, spec §2.2 last paragraphs); the message codec, body envelope and the four new events; the five indexes; the `since` origin bindings on SessionMessage, TaskRequeue and Round records with `decodeNoticeOrigin` (spec §2.5).
2. **State rows.** The 23 rows of spec §3.1 with their refusal codes, `decisionActionPolicy` and `canSendUserMessage` exactly as the table of spec §3.2, `goalStartPolicy`, `goalConflictFacts`, `goalDecisionBasisMatches`.
3. **Owners.** In the check order of spec §3.3: `createGoalSettingsService` (tasks), `createDecisionSettingsService` (configuration), `sendUserMessage` and the shared `createMessageWriteOwner` (communication/mailbox), `createDecisionMessageService` and the application proof reader (communication; only `GoalSettingsChanged` and `PlanRevisionAccepted`, everything else `unsupported`), the request-candidate slot in `plan-service.ts` and `plan-commit-compiler.ts`, the waiting guards in `claim-service.ts` and `execution-entry-service.ts`, the autonomy check and notice origin in `requeue-service.ts` and `evidence-service.ts`, the readers in `tasks/` (goal causes, planning questions, request facts, executed-files stub), the duties adapter in `configuration/`.
4. **Read model.** The seven-source queue, the card, the conflicts and labels, the rework notices, the notice position comparator and the display token, all in `views/` (spec §4.1–§4.4).
5. **Workflow, Runtime, Host.** `resolveDecision` and `orderGoalAdvances` (spec §4.5), the autonomy check before automatic refine, requeue and reverify in `workflow.ts`, the user recipient guard in `consultation.ts` and the pump in `collaboration-driver.ts`, the three user tools and the response input formatter (spec §4.6), the composition wiring (one instance of each new service; the operator actor from the Host's real start actor; a 32-byte random token key generated once in the composition and never stored), and the 12 routes.
6. **Allowlist.** In `tests/architecture/production-reach-allowlist.json` add an entry only for a declaration that the spec names as a seam for a later slice and that nothing in production reaches yet: reason `kept-for`, with a note naming the slice (for example “slice 4: note review source”). Remove nothing that belongs to another slice. Edit the JSON as text; do not re-serialize the file.

At the end `git grep -n "not implemented: " -- src` prints nothing.

## Rules added for part 2

15. **Do not edit a frozen test.** If a frozen test and the spec disagree, do not change either: report the test id, the assertion, the spec line and a minimal counter-example under UNSPECIFIED, and leave that test failing.
16. **No cross-module shortcut.** `tasks/` and `evidence/` never import `communication/` or `views/`; `configuration/` never imports `views/` or a source owner (the token verifier and the position comparator are injected through the narrow ports of spec §2.8); no owner calls `views/`. If `npm run check:architecture` reports an edge, change the import, never `docs/refactor/module-target.json`.
17. **Partial results are reported, not hidden.** `resolveDecision` returns `ready` with the real receipts of the committed steps and `state` `awaiting_resume` or `application_not_recorded` when a later step cannot run; it never reports an answered card as never answered and never undoes a committed step (spec §4.5).
18. **Reading changes nothing.** Reading the queue, a card, the conflicts or a notice page writes no record, acknowledges no message and calls no model (DQ09, RT01).

## Checks

Run the commands of part 1, then `npm run build`. Do not run any other tests.

Expected at the end of part 2:
- `npm run typecheck`, `npm run check:architecture` and `npm run build` exit 0.
- New tests: 15 files, 210 tests, all pass.
- Regression command (25 files): every file equals the baseline of part 1, and `tests/architecture/state-writes.test.ts` and `tests/architecture/production-reach.test.ts` pass. A test that failed in the baseline only because `/usr/bin/bwrap` is missing may still fail for that reason; name it.

## Final checks before the report

```
git status --short                     # exactly the 81 files of the write scope (40 new, 41 modified), nothing else
git grep -n "not implemented: " -- src  # prints nothing
sha256sum <the 18 frozen files>        # equal to the list above
sha256sum src/contracts/platform-duty.ts  # 6adfb57e8bcb7ec387257e19c3811abb61a5fd21d37a8889566bf34cc32a9e39
git diff -- tests/architecture/production-reach-allowlist.json  # only added kept-for entries, each naming a later slice
```

Then delete `./.dsh-scratch/` and any other helper or log file you created. `git status --short` then shows only the 81 files.

## Final report

Reply with these four sections and nothing else:

- FILES CHANGED: each file, `N` or `C`, one per line (81 lines); then each allowlist entry you added (file#name and its note).
- CHECKS: each command and its result (exit code; for vitest the `Test Files` and `Tests` lines and the per-file numbers), next to the baseline and the part-1 result.
- UNSPECIFIED: each case the spec does not describe that you met, one line each; each frozen test you believe contradicts the spec (id, assertion, spec line, counter-example); every sentence of the spec that disagrees with the code, with file:line. Every claim that something was not found names the command that found nothing.
- NOTES: at most ten lines: the real call chain of `decisions/answer` from the route to the commits (file:function, in order), anything that blocked you, anything left undone.
