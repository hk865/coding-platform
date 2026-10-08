# Part 2 of 2: implement slice 3

The lead reviewed part 1 and froze the tests. Now write the implementation. Everything in part 1 still holds: the spec and its reading order, the write scope, the git rules, the rules 1–14 and the checks.

## Frozen tests (the lead fills this in before sending)

These files must not change in part 2. At the end, `sha256sum` of each must print the value listed here.

```
【lead 发送前填写：11 个新测试文件的 sha256】
```

## Corrections to part 1 (the lead fills this in before sending; empty if none)

```
【lead 发送前填写：位置（file:line）、要重读的规格段、改的方向；不给代码】
```

## What part 2 does

Replace every stub of part 1 with the behaviour the spec gives, in this order (spec §8.1 step 3). After each step run `npm run typecheck` and the new test files of that layer.

1. **Contracts.** The DTOs and shape checks of spec §2.2 and §2.4; `validateRoleSpecContent` accepts the optional `platformDuty` enum and nothing else new.
2. **State guards.** `contextAssemblyProblem`, `declaredInputProblem`, `effectivePlatformDuty` (spec §3.3), called from the existing admission paths as guards CTX-01..03 (spec §3.2) without changing the order of the existing checks or any `next` construction in `state/run-machine.ts` and `state/query-run-recovery.ts`.
3. **Input owner.** `createTaskContextInputService` with the exact check order of spec §3.4 and the resolution table of spec §3.5 (legacy artifact, `artifact`/`output-contract` → `missing` with `no_labeled_output`, `gate-result`, `environment-revision`, `decision`).
4. **Read model.** `createGraphContextReader` in `views/` (spec §4.1): cards, children and neighbours, find, cursors, the Query and Work read bridges, attention facts.
5. **Assembler.** `createContextAssembler` and `renderContext` (spec §4.2, §4.3): the exact headers, separators, payload order, budget algorithm and byte ranges; one assembler instance in `createAgentRuntime`, passed to both preparations and to the attention scanner.
6. **Tools and drivers.** `createGraphTools` (spec §4.4) registered for Work and Query through the coordination-tool seam; the history proxy; the 48 KiB capacity check of the whole ToolResult JSON.
7. **Host.** `graphChanges`, the details-based trigger count and `renderAttentionChanges` (spec §4.5); the new Host grant and configuration revision (spec §4.6); the two routes; the deprecation comments on the old read tools.
8. **Allowlist.** Remove the `kept-for` entries that `tests/architecture/production-reach.test.ts` reports as reached (rule 13).

At the end `git grep -n "not implemented: " -- src` prints nothing.

## Rules added for part 2

15. **Do not edit a frozen test.** If a frozen test and the spec disagree, do not change either: report the test id, the assertion, the spec line and a minimal counter-example under UNSPECIFIED, and leave that test failing.
16. **Do not change an existing text assertion to make it pass.** The assertions listed in spec §5.12 (32 test files plus the shared `tests/state/invariants.ts` lines) are product behaviour. New sections may add text; they may not remove or reword the assignment, the question, the Skill text, the history or the brief.
17. **Errors keep their code.** `not_ready`, `unavailable`, `incomplete`, `capacity`, a missing index and a partial candidate list are different results from an empty one; never turn a rejection into `ready` with empty items (GR13, GR14, CA15, AT11).
18. **No new writes for reads.** Reading a card, finding, paging history or reading an input page creates no record, no receipt and no model call (IN16, GR04, GT12, RT06).

## Checks

Run the commands of part 1, then `npm run build`. Do not run any other tests.

Expected at the end of part 2:
- `npm run typecheck`, `npm run check:architecture` and `npm run build` exit 0.
- New tests: 11 files, 168 tests, all pass.
- Regression command (50 files): every file equals the baseline of part 1, and `tests/architecture/production-reach.test.ts` passes. A test that failed in the baseline only because `/usr/bin/bwrap` is missing may still fail for that reason; name it.

## Final checks before the report

```
git status --short                     # exactly the 42 files of the write scope (21 new, 21 modified), nothing else
git grep -n "not implemented: " -- src  # prints nothing
sha256sum <the 11 frozen test files>   # equal to the list above
sha256sum src/contracts/platform-duty.ts  # 6adfb57e8bcb7ec387257e19c3811abb61a5fd21d37a8889566bf34cc32a9e39
git diff -- tests/architecture/production-reach-allowlist.json  # only removed entries
```

Then delete `./.dsh-scratch/` and any other helper or log file you created. `git status --short` then shows only the 42 files.

## Final report

Reply with these four sections and nothing else:

- FILES CHANGED: each file, `N` or `C`, one per line (42 lines); then the allowlist entries you removed (file#name).
- CHECKS: each command and its result (exit code; for vitest the `Test Files` and `Tests` lines and the per-file numbers), next to the baseline and the part-1 result.
- UNSPECIFIED: each case the spec does not describe that you met, one line each; each frozen test you believe contradicts the spec (id, assertion, spec line, counter-example); every sentence of the spec that disagrees with the code, with file:line. Every claim that something was not found names the command that found nothing.
- NOTES: at most ten lines: the real call chain from `Workflow.advance` to the first model request of a Work Run (file:function, in order), the same for a Query, anything that blocked you, anything left undone.
