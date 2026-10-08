# Part 2 of 2: make the one-line change (slice 0)

The lead reviewed part 1 and froze the test. Now make the change. Everything in part 1 still holds: the write scope, the git rules and the checks.

## Frozen test (the lead fills this in before sending)

This file must not change in part 2. At the end, `sha256sum` of it must print the value listed here.

```
【lead 发送前填写：tests/app/S0-attention-edge-label.test.ts 的 sha256】
```

## Corrections to part 1 (the lead fills this in before sending; empty if none)

```
【lead 发送前填写：位置（file:line）、要重读的规格段、改的方向；不给代码】
```

## The change

`src/app/attention-observer.ts`, line 504, inside `createAttentionScanner` → `scan`:

```ts
for (const edge of plan.executionDag.dependsOn) edges.push('depends:' + edge.dependsOnId + '->' + edge.taskId + ':' + edge.requires);
```

Replace `edge.requires` in that expression by `edge.requires.kind + ':' + edge.requires.label`. Nothing else in the line changes.

Rules for this change, by case:
- (a) The `depends:` edge on line 504: change as above.
- (b) The four other edge strings in the same function (`parent:` line 505, `relation:` line 507, `arch-depends:` line 525, `arch-parent:` line 526): do not change them.
- (c) Everything else in `src/`: do not change it. Do not escape colons in labels. Do not touch `graphChangedElements`, the observer, the signal or notification formats, or `src/app/host.ts`.
- (d) Do not edit the frozen test. If it and this task disagree, leave both as they are and report it under UNSPECIFIED (test id, assertion, the sentence of this task, a minimal counter-example).

## Checks

Run the three commands of part 1 again.

Expected at the end of part 2:
- `npm run typecheck` and `npm run check:architecture` exit 0.
- `tests/app/orchestration-mechanism.test.ts` gives the same per-file result as in part 1 and in `DSH-BASELINE.md`.
- `tests/app/S0-attention-edge-label.test.ts`: 3 passed.

Do not run any other tests.

## Final checks before the report

```
git status --short    # exactly: " M src/app/attention-observer.ts" and "?? tests/app/S0-attention-edge-label.test.ts"
git diff --numstat    # src/app/attention-observer.ts: 1 added, 1 deleted
sha256sum tests/app/S0-attention-edge-label.test.ts    # equal to the value above
```

Then delete `./.dsh-scratch/`.

## Final report

Reply with these four sections and nothing else:

- FILES CHANGED: each file, created or modified, one per line.
- CHECKS: each command with its result next to the part-1 result (exit code; for vitest the `Test Files` and `Tests` lines, and the per-file result for each of the two files); the sha256 of the frozen test.
- UNSPECIFIED: each case this task does not describe that you met, one line each. Every claim that something was not found names the command that found nothing.
- NOTES: at most five lines, only if something blocked you or looked wrong in this task. List every sentence of this task that disagrees with the code you read, with file:line.
