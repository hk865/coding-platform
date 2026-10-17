# Task: slice 8A rework 3 — two findings from the quick check; coordinator mode; test-driven

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. The books and the
lead's rulings are binding; do not make design decisions; report anything undetermined under UNSPECIFIED.

**This run is headless. When your turn ends, the whole run ends.** Work in coordinator mode
(`./.dsh-ref/coordinator-mode.md`), at most 3 subagents at once, every vitest command `--maxWorkers=2`. **Finish within
60 minutes** (the run stops at 70).

## 1. What this copy is

Tag `s8a-c` (HEAD) = 8A after rework 2 (book `./.dsh-ref/s8a-rework-2.md`, your reply `./.dsh-ref/s8a-rework2-final.md`).
Codex's quick check (`./.dsh-ref/s8a-review3.out.md`, Chinese): items 2, 3, 4, 6 done; 1 and 5 partly; two must-fix
below. Your two UNSPECIFIED items are accepted (`projectConfiguration: null`; the helper callback's type).

## 2. Items (binding)

1. **One analysis outcome per observation** (`workspace/capture.ts` ~553–567, `workspace/architecture-language-provider.ts`
   ~80/103, `architecture/architecture-service.ts` ~745): when the observation's TS analysis fails (here: the result
   cap `maxQueryResults`), the file-layer provider must not re-analyse with a higher cap and succeed while the module
   layer got empty sources (that turns the whole observation `invalid`). Keep the first analysis's outcome (failed +
   reason) with the frozen material and let both layers consume it: the TS coverage is failed with that reason, the
   module layer is the empty one, the file layer keeps the files and line counts. Test (Codex's): two source files, three
   imports, `maxQueryResults = 2`, a root mapping → the observation is `ready`, TS coverage failed, module layer empty;
   it fails today.
2. **A refusal never names a path the grant no longer covers** (`architecture-service.ts` ~602, ~94, ~648, and the node
   check just before it): use one generic reason for both the node and the issue checks (e.g. `the current Host grant
   does not cover every frozen path of this observation`). Test: the narrowed-grant case asserts on each of the three
   pages that the whole response (serialized) does not contain `private/bad.ts`.

## 3. Checks

The checks of `s8a-rework.md` section 3 with `--maxWorkers=2`; then `npm run typecheck`, `npm run check:architecture`,
`npm run build`. No real model calls, no git writes, never ports 3080/3099/44797; probes under `./.dsh-scratch/`, deleted.

## 4. Reply

Under 300 words: files changed (production net), each item RED → GREEN, checks with numbers, UNSPECIFIED.
