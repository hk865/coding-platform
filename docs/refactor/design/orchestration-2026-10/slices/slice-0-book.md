# Task: write the dependency condition into the attention edge string (slice 0, one part)

You are working in a copy of a TypeScript repository (the current directory). This is a fully specified task. Follow it exactly. Do not make design decisions: if something is not specified here, do not invent behaviour; list it in your report instead.

## What to do

1. Write the new test file `tests/app/S0-attention-edge-label.test.ts` with exactly the 3 cases of the table below.
2. Run the checks once (see "Checks"): the 3 new cases must fail, for the reason given in the table.
3. Change one line of production code (see "The change").
4. Run the checks again: everything passes.

### The change

`src/app/attention-observer.ts`, line 504, inside `createAttentionScanner` → `scan`:

```ts
for (const edge of plan.executionDag.dependsOn) edges.push('depends:' + edge.dependsOnId + '->' + edge.taskId + ':' + edge.requires);
```

`edge.requires` is an object of type `DependencyRequirement` (`src/contracts/plan.ts:172–175`: `{ kind: "output-contract" | "artifact" | "decision" | "environment-revision" | "gate-result"; label: string }`), so the concatenation writes `[object Object]`. Replace `edge.requires` in that expression by `edge.requires.kind + ':' + edge.requires.label`. Nothing else in the line changes.

Rules for this change, by case:
- (a) The `depends:` edge on line 504: change as above.
- (b) The four other edge strings in the same function (`parent:` line 505, `relation:` line 507, `arch-depends:` line 525, `arch-parent:` line 526): do not change them.
- (c) Everything else in `src/`: do not change it. Do not escape colons in labels. Do not touch `graphChangedElements`, the observer, the signal or notification formats, or `src/app/host.ts`.

### The test file

Model the imports on `tests/app/orchestration-mechanism.test.ts:11–25` (vitest `describe`/`expect`/`it`; `graphChangedElements` and `createAttentionScanner` from `../../src/app/attention-observer.js`; `attentionConfig` from `../helpers/orchestration-fixture.js`). Each case calls the real `createAttentionScanner(deps).scan(ctx, scope)` with these exact fakes:

- `scope`: `{ scope: { projectId: 'p', workspaceId: 'w' }, paths: [], maxBytes: 1024, goalRef: { aggregateType: 'Goal', projectId: 'p', goalId: 'g' }, targetSession: null, config: attentionConfig() }`.
- `deps.workspace.readWorkspace`: throws `new Error('unexpected readWorkspace')` if called.
- `deps.messages.readInbox`: throws `new Error('unexpected readInbox')` if called.
- `deps.architecture.readArchitectureRevision`: resolves `{ status: 'rejected', code: 'not_found', reason: 'no architecture' }`.
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

## Write scope

- Create exactly one file: `tests/app/S0-attention-edge-label.test.ts`.
- Edit exactly one file: `src/app/attention-observer.ts`, only the expression on line 504 described above.
- Do not create, edit, rename or delete any other file, also not in git-ignored places. Do not touch `package.json`, lock files, any config, `vendor/`, `node_modules/` or `docs/`.
- Helper files and logs go in `./.dsh-scratch/` (create it), never in `/tmp`. Delete `./.dsh-scratch/` at the end.
- Stay inside the current directory. Do not install packages. Do not commit.
- Git commands allowed: `git status`, `git diff`, `git grep`. Not allowed: `git add`, `git rm`, `git mv`, `git checkout`, `git restore`, `git stash`, `git reset`, `git commit`, `git push`.

## Checks

Run exactly these commands, first after writing the test file and before the change, then after the change:

```
npm run typecheck
npm run check:architecture
npx vitest run tests/app/S0-attention-edge-label.test.ts tests/app/orchestration-mechanism.test.ts
```

Expected:
- Both times, the first two commands exit 0.
- `tests/app/orchestration-mechanism.test.ts` gives the same per-file result both times, equal to the line for that file in `DSH-BASELINE.md` at the root of this copy (the lead ran it on the untouched copy; tests that fail there only because the check sandbox `/usr/bin/bwrap` is missing in this environment are listed by name in that file).
- `tests/app/S0-attention-edge-label.test.ts`: before the change 3 failed, 0 passed; after the change 3 passed.

Do not run any other tests.

## Final checks before the report

```
git status --short    # exactly: " M src/app/attention-observer.ts" and "?? tests/app/S0-attention-edge-label.test.ts"
git diff --numstat    # src/app/attention-observer.ts: 1 added, 1 deleted
```

## Report

Reply with these four sections and nothing else:

- FILES CHANGED: each file, created or modified, one per line.
- CHECKS: each command with its result before and after the change (exit code; for vitest the `Test Files` and `Tests` lines, and the per-file result for each of the two files).
- UNSPECIFIED: each case this task does not describe that you met, one line each. Every claim that something was not found names the command that found nothing.
- NOTES: at most five lines, only if something blocked you or looked wrong in this task. List every sentence of this task that disagrees with the code you read, with file:line.
