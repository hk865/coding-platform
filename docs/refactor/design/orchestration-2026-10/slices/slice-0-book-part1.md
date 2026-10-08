# Task: write the dependency condition into the attention edge string (slice 0), part 1 of 2: the tests, then stop

You are working in a copy of a TypeScript repository (the current directory). This is a fully specified task. Follow it exactly. Do not make design decisions: if something is not specified here, do not invent behaviour; list it in your report instead.

The task has two parts in this same session (decision 43: tests first, lead review, then the change). This message is part 1: write the test file, run the checks, and stop. Part 2, a later message, makes the one-line change. Do not change any production code in part 1.

## What part 1 does

1. Write the new test file `tests/app/S0-attention-edge-label.test.ts` with exactly the 3 cases of the table below.
2. Run the checks (see "Checks"): the 3 new cases must fail, for the reason given in the table.
3. Stop.

### The code under test (do not change it in part 1)

`src/app/attention-observer.ts`, line 504, inside `createAttentionScanner` → `scan`:

```ts
for (const edge of plan.executionDag.dependsOn) edges.push('depends:' + edge.dependsOnId + '->' + edge.taskId + ':' + edge.requires);
```

`edge.requires` is an object of type `DependencyRequirement` (`src/contracts/plan.ts:172–175`: `{ kind: "output-contract" | "artifact" | "decision" | "environment-revision" | "gate-result"; label: string }`), so the concatenation writes `[object Object]`. Part 2 will replace `edge.requires` in that expression by `edge.requires.kind + ':' + edge.requires.label`; the tests below check that result.

### The test file

Model the imports on `tests/app/orchestration-mechanism.test.ts:11–25` (vitest `describe`/`expect`/`it`; `graphChangedElements` and `createAttentionScanner` from `../../src/app/attention-observer.js`; `attentionConfig` from `../helpers/orchestration-fixture.js`). Each case calls the real `createAttentionScanner(deps).scan(ctx, scope)` with these exact fakes:

- `scope`: `{ scope: { projectId: 'p', workspaceId: 'w' }, paths: [], maxBytes: 1024, goalRef: { aggregateType: 'Goal', projectId: 'p', goalId: 'g' }, targetSession: null, config: attentionConfig() }`.
- `deps.workspace.readWorkspace`: throws `new Error('unexpected readWorkspace')` if called.
- `deps.messages.readInbox`: throws `new Error('unexpected readInbox')` if called.
- `deps.architecture.readArchitectureRevision`: resolves `{ status: 'not_found' }` (the not-found branch of `ReadResult`, `src/contracts/core/results.ts:30`). Not a `rejected` value: `scan` treats any status other than `ready` and `not_found` as an unreadable graph (`src/app/attention-observer.ts:531`).
- `deps.plans.queryTaskGraph`: resolves `{ status: 'ready', value: G(req) }` where `G(req)` is
  `{ plan: { ref: { planId: 'p1' }, executionDag: { dependsOn: [{ taskId: 't2', dependsOnId: 't1', requires: req }] }, taskHierarchy: { parentOf: [] } }, tasks: [{ ref: { taskId: 't1' }, effectivePhase: 'satisfied', relations: [] }, { ref: { taskId: 't2' }, effectivePhase: 'ready', relations: [] }] }`.
  These are only the fields `scan` reads; pass the fakes with a type assertion (`as never`).
- `ctx`: an empty object with a type assertion; the fakes do not read it.

One `it` per row; the `it` title starts with the case id.

| id | given / action | exact expected |
| --- | --- | --- |
| S0-01 | `req = { kind: 'artifact', label: 'schema.json' }`, scan once | `snapshot.graph?.edges` equals `['depends:t1->t2:artifact:schema.json']`; `snapshot.graph?.revision` is `'plan:p1'`; `snapshot.graphUnreadable` is `false`; no edge contains `[object Object]`. Before the change it fails because the edge is `depends:t1->t2:[object Object]`. |
| S0-02 | scan with `{ kind: 'artifact', label: 'schema.json' }`, then scan with `{ kind: 'artifact', label: 'schema-v2.json' }` | `graphChangedElements(first.graph, second.graph)` equals `{ changedElements: 2, nodes: 0, edges: 2, statuses: 0 }`. Before the change it fails with `changedElements: 0`. |
| S0-03 | scan with `{ kind: 'artifact', label: 'schema.json' }`, then scan with `{ kind: 'decision', label: 'schema.json' }` | same expected value as S0-02. Before the change it fails with `changedElements: 0`. |

## Write scope (both parts)

- Part 1 creates exactly one file: `tests/app/S0-attention-edge-label.test.ts`.
- Part 2 edits exactly one file: `src/app/attention-observer.ts`, only the expression on line 504 described above.
- Do not create, edit, rename or delete any other file, also not in git-ignored places. Do not touch `package.json`, lock files, any config, `vendor/`, `node_modules/` or `docs/`.
- Helper files and logs go in `./.dsh-scratch/` (create it), never in `/tmp`. Part 2 deletes it.
- Stay inside the current directory. Do not install packages. Do not commit.
- Git commands allowed: `git status`, `git diff`, `git grep`. Not allowed: `git add`, `git rm`, `git mv`, `git checkout`, `git restore`, `git stash`, `git reset`, `git commit`, `git push`.

## Checks

Run exactly these commands after writing the test file:

```
npm run typecheck
npm run check:architecture
npx vitest run tests/app/S0-attention-edge-label.test.ts tests/app/orchestration-mechanism.test.ts
```

Expected at the end of part 1:
- The first two commands exit 0.
- `tests/app/orchestration-mechanism.test.ts` gives the per-file result of its line in `DSH-BASELINE.md` at the root of this copy (the lead ran it on the untouched copy; tests that fail there only because the check sandbox `/usr/bin/bwrap` is missing in this environment are listed by name in that file).
- `tests/app/S0-attention-edge-label.test.ts`: 3 failed, 0 passed, each for the reason in its row. A compile error, a fixture error or a timeout is a defect of part 1 that you fix before stopping.

Do not run any other tests.

```
git status --short    # exactly: "?? tests/app/S0-attention-edge-label.test.ts" (and "?? .dsh-scratch/" if you created it)
```

Stop here. Do not start part 2.

## Your reply to part 1

Reply with these four sections and nothing else:

- FILES CHANGED: the one file you created.
- CHECKS: each command with its result (exit code; for vitest the `Test Files` and `Tests` lines, the per-file result for each of the two files, and for each new test its id and the first line of its failure message).
- UNSPECIFIED: each case this task does not describe that you met, one line each. Every claim that something was not found names the command that found nothing.
- NOTES: at most five lines, only if something blocked you or looked wrong in this task. List every sentence of this task that disagrees with the code you read, with file:line.
