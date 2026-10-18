# K3 merge onto the lead branch: resolve 13 conflict hunks in 4 files (lead, 2026-10-18)

Do not end your turn until every subagent you start has reported back.

## 1. What this is

K3 (groups 1–4, last tag `k3-g4b3-r10` in the K3 copy) was built on lead `f15f25a4`. Since then the lead branch merged 8D (`4041c30`) and L8 (`de70ff4`). This copy (`~/dsh-work/slices/s9k3merge`, HEAD tag `k3-merge-raw`) is lead `c7f7cb0` with the whole K3 change (`f15f25a4..k3-g4b3-r10`, 359 files) applied 3-way. 355 files merged cleanly. Four files still hold conflict markers (13 hunks):

| file | hunks (lines at `k3-merge-raw`) |
|---|---|
| `src/composition/create-platform.ts` | 705–713, 1236–1245 |
| `src/core/agent-runtime/context-assembler.ts` | 21–31, 61–83, 124–135, 1045–1163, 1191–1324, 1338–1452, 1871–1876 |
| `src/core/agent-runtime/execution-preparation.ts` | 35–47, 58–77, 265–301 |
| `src/core/workspace/workspace-tools.ts` | 29–50 |

Your job: resolve the 13 hunks so that **both sides' behaviour is kept exactly**. Nothing else.

## 2. Inputs (`./.dsh-ref/`)

- `lead-side.diff`: what the lead branch changed in these four files since `f15f25a4` (8D and L8; `lead-side-commits.txt`).
- `k3-side.diff`: what K3 changed in these four files since `f15f25a4`.
- Specs in the copy: `docs/refactor/design/orchestration-2026-10/slices/slice-8-SPEC.md` §12 (8D and §10 segment) and §13 (L8: the architecture reminders in prepare, `architecture/observation-state`, the capture driver wiring); `slice-K3-SPEC.md` (the review inputs, the command rerun request, the cancel propagation of book 10: `context-assembler.ts` cancelled facts and one comparator shared with `command-rerun-request-card.ts`).

## 3. Rules

1. Keep every check, error code, error text, ordering, digest input and returned shape from **both** sides. If both sides add a section, a field or a step at the same place, keep both. Where the order of two added pieces is visible (the assembled context text, the order of reminders, the order of checks before a commit), take it from the spec; if no spec line decides it, keep the lead side first, then K3, and list it under UNSPECIFIED with file:line.
2. If one side renamed or moved something the other side uses, adapt the other side's use to the new name; do not restore the old one.
3. Do not edit any other file unless typecheck forces it; list each such edit with the reason. No refactoring, no comment cleanup, no test changes (C1 and T come later).
4. `vendor/coding-agent/dist` is frozen; do not touch it.

## 4. Checks

- `npm run typecheck`, `npm run check:architecture`, `npm run build`: all 0.
- `git grep -n '^<<<<<<<\|^>>>>>>>\|^=======$' -- src tests`: no hits.
- Run the tests that exercise these four files: `npx vitest run --maxWorkers=2` on `tests/runtime/S3-context-assembler*.test.ts`, `tests/**/*K3*.test.ts`, `tests/**/*S8*.test.ts`, `tests/**/*L8*.test.ts`, `tests/**/B2-*.test.ts`, `tests/scenarios/A8-*.test.ts`. This sandbox has no bubblewrap: failures that only say `ENOENT /usr/bin/bwrap` (or follow from a check that never ran) are expected; report every other failure with its first error line. The lead runs the full suite with bubblewrap afterwards.

## 5. Reply

1. Per hunk (13 lines): what the lead side added, what K3 added, how you resolved it, file:line after the resolution.
2. UNSPECIFIED (rule 1 order choices) and any edit outside the 13 hunks (rule 3).
3. The checks: numbers, and every non-bubblewrap failure.

Time: 120 minutes; stop at 135 and report what is left.
