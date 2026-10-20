# Task: rework 1 of the fix round after T (lead, 2026-10-21 night)

You are working in the same copy as the fix round (the current directory), at `d4140be` (`TF5 unused names`), on top
of `tf-base`. This is a NEW session. Read this book first, in full, then `./.dsh-ref/tf-findings.md` (the frozen
finding table) and the book of the fix round `./.dsh-ref/tf-book.md` (its §3 rules, §7 memory rules and
"never get green by weakening" still bind). Report anything you cannot understand before you start (decision 56).
**Finish within 330 minutes** (the run stops at 360). **This run is headless: when your turn ends, the whole run
ends. Do not end your turn while a subagent has not reported back** (wait with `sleep 300`, then `list_agents`).

Work in coordinator mode (`./.dsh-ref/coordinator-mode.md`): subagents change the code; you split, brief, check the
reports, run the final checks and write the reply.

## 1. What to do

Apply `tf-findings.md` §1, rows `TFR-01` … `TFR-12`, **one row all or nothing**, exactly as written, nothing else.
§0 holds the lead's rulings and §3 the findings the lead did not adopt: do not act on them. The Codex answers the
table came from are in `./.dsh-ref/audit/P1.out.md` … `P8.out.md` (for detail; the table decides).

Split, disjoint files (one subagent each; at most three run tests at the same time):

| subagent | rows | files |
|---|---|---|
| A | TFR-01, TFR-04, the `work-line-reader.ts:283` comment of TFR-12 | `src/core/work-graph/views/work-line-reader.ts`, `src/core/work-graph/state/line-status.ts`, `src/core/work-graph/sessions/session-record-codecs.ts` |
| B | TFR-02, TFR-03, the `plan-readers.ts`, `owner-record-read.ts`, `run-reconcile-service.ts` comments of TFR-12 | `src/core/work-graph/persistence/plan-record-codecs.ts`, `src/core/work-graph/tasks/plan-readers.ts`, `src/core/work-graph/views/decision-read-model.ts`, `tests/helpers/S5-decision-fixture.ts`, `src/core/work-graph/tasks/unknown-call-review-service.ts`, `src/core/work-graph/tasks/owner-record-read.ts`, `src/core/work-graph/tasks/run-reconcile-service.ts` |
| C | TFR-05, TFR-06, TFR-07 | `tests/work-graph/A2-step1-codecs.test.ts`, `src/core/work-graph/state/verification-machine.ts` (and its codec), `src/core/work-graph/state/session-availability.ts`, `src/core/work-graph/evidence/evidence-service.ts` |
| D | TFR-08, TFR-09, TFR-10 | `src/core/agent-runtime/runtime.ts`, `src/business/workflow/session-maintenance.ts`, `src/core/agent-runtime/execution-control.ts`, `tests/runtime/S2B-36-observer-cancel-reread.test.ts`, `tests/runtime/S2B-38-run08-unknown-activity.test.ts`, `tests/helpers/K3-35-runtime.ts`, `tests/helpers/K3-blocked-command-fixture.ts` |
| E | TFR-11, the rest of TFR-12 | `scripts/verify-isolated.mjs`, `src/core/work-graph/views/activity-read-model.ts`, `src/core/work-graph/views/undelivered-reply-notices.ts`, `src/core/work-graph/materials/applicability.ts`, `tests/scenarios/S2C-K-retired.test.ts`, `src/app/attention-observer.ts` |

A file a row's change forces you to touch outside this list (an import, a type a narrowed codec changes, a test that
no longer compiles) is allowed only as far as compiling needs, and is listed in the reply. When two subagents need
the same file, you serialize.

**A row that turns a test red:** if the test reaches the state only through hand-written records (a T leftover), stop
that row, undo it, and report it `BLOCKED` with the test line and why (do not convert tests the row does not name).
TFR-05 and TFR-10 name the tests they convert; their own "if that cannot be done" sentence applies.

**This environment.** No `rg` (use `grep -rn`); `python3 -I` for scripts. There is no bubblewrap in your sandbox: a
test failing only with `ENOENT … bwrap` or "sandbox unavailable" is an environment failure; list it, the lead runs
it. The list of files that fail here for that reason is in `./.dsh-ref/env-failures.txt` (from the fix round).

## 2. Memory (binding)

The typecheck only as `flock ./.typecheck.lock npm run typecheck`, only by you, never while a subagent runs tests.
Subagents run only their own test files: **`npx vitest run --maxWorkers=2 <files>`, never more workers**, batches of
at most 10 files, each under `timeout 900`. Put this line in every subagent's brief. At most three subagents run tests
at once. Never run `npm test`, `npm run verify:isolated` or a bare `npx vitest run`.

## 3. Close-out (one subagent, nobody else running tests)

1. `flock ./.typecheck.lock npm run typecheck`, `npm run check:architecture`, `npm run build`: all 0;
   `npx tsc --noEmit -p tsconfig.json --noUnusedLocals 2>&1 | grep "TS6133\|TS6196\|TS6192\|TS6198"`: empty.
2. The tests of every changed file's importers (`grep -rln`), in batches.
3. `python3 -I ./.dsh-ref/d1-ledger.py . d4140be HEAD > ./.dsh-ref/out/ledger-r1.txt`: every REMOVED or LOOSENED
   test line maps to a `TFR-nn` row.

**Commit** in this copy, one commit: stage only the files you changed, by path (`git add -A -- <files>`), check
`git diff --cached --stat`, then `git -c user.name=dsh -c user.email=dsh@localhost commit -qm "TF rework 1"`. Never
stage `.dsh-ref/`, `.dsh-scratch/` or `.typecheck.lock`. Then `git diff --shortstat d4140be HEAD`.

**Reply** (plain Chinese) in `./.dsh-ref/out/tf-r1-reply.md`:
1. per row `TFR-nn`: done / BLOCKED (with the test, the line and the error), the files, what changed in one or two
   lines; for TFR-05 and TFR-10 the converted tests and how each reaches its state;
2. the files touched outside the table's lists, each with why;
3. checks: commands and pass/fail counts; environment failures (only those not in `env-failures.txt` need a line
   each); the ledger mapping;
4. suspected errors in the table; HANDOFF if you stop early (done, half done, not started).

Before you end, delete `./.dsh-scratch/` (the directory too).
