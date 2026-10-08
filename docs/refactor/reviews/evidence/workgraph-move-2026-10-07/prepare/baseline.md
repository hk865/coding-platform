# Baseline at H = 58ea2fdc (TASK-D-PLAN §2 step 4)

## Full suite (the checker's baseline)

`_tools/baseline-full.sh` on a copy of the new base (H + node_modules + vendor zod/openai), plain WSL (no
`/usr/bin/node`, no `/usr/bin/bwrap`), `npx vitest run --reporter=json --maxWorkers=4`, 19:43–19:49, 372 s.
`_tools/mk-baseline.sh` → `_common/baseline-full.json` (sha256 692cbae8…ee07), synced to
`~/dsh-work/ladder/_common/baseline-full.json`.

- **216 test files, 5245 tests: 5089 passed, 127 failed, 29 skipped.** Failing: 44 files with failed tests, plus
  `tests/state/invariants.test.ts`, which fails as a suite in its setup (`Error: requeue 1: … finalize_first …`) so its
  29 tests are skipped.
- All failures are the environment's: the check sandbox is missing (`ENOENT … '/usr/bin/bwrap'`), so checks never run
  and rounds never finalize. Under the CI-like `with-usr-bin-node.sh` the full suite passed in full at 2ba9b46b
  (STATUS: 216 files, 5245 tests, the same counts as here), and X1/X2's 140 affected files passed the same way
  (x12.md).
- Stable: the same 127 failures, the same test ids, 0 regressions and 0 "fixed" in each of the four checker runs that
  followed (oracle and fresh, twice; each runs the full suite in a clone): five full runs in all.

Compared with bfb6075 (`old-bfb6075/baseline-full.json`: 200 files, 5203 tests, 60 failed in 24 files, 0 skipped):
- 14 test files are gone: 5 deleted by the simplification (G1 060e7696 ×2, G2 d596ed18, G3 77b517a2, G5 8ea08c73)
  and 9 replaced by the step-6 scenario tests (fd935387, d3600797, eb73da2e, 67404d03, 49dc04e0, e9ea686c);
  30 are new (step-6 scenarios, `tests/state/invariants*`, …).
- 90 of the 127 failures are in the 30 new files (27 scenario files, `invariants-fuzz` 1, `invariants` as a suite);
  37 are in files that also existed at bfb6075 (60 there; the removed files and three changed files —
  `A2-automation-verdict` 3→2, `A2-reverify-platform` 3→1, `A2-verification-chain-platform` 7→6 — account for the rest).

## The book's visible checks

Measured twice on fresh LTd copies (before and after the setup started stripping the two evidence directories), each
time both in a throwaway clone (`visible-check.mjs`, outside the sandbox) and inside the DSH sandbox
(`run-dsh.mjs exec`, no model). All four vitest runs give the same two lines (`visible/`, `visible-stripped/`):

```
npm run typecheck                    exit 0
npm run check:architecture           exit 0   (… "next source boundaries: OK")
npx vitest run tests/architecture tests/state tests/work-graph   exit 1
 Test Files  3 failed | 68 passed (71)
      Tests  9 failed | 4202 passed | 29 skipped (4240)
```

Failures: 8 tests in `tests/work-graph/A2-verification-chain.test.ts` (as at bfb6075), 1 in
`tests/state/invariants-fuzz.test.ts` (`coverage: every kind of operation the row lists actually ran`), and
`tests/state/invariants.test.ts` as a failed suite with its 29 tests skipped. At bfb6075 the same command gave
`Test Files 1 failed | 72 passed (73)`, `Tests 8 failed | 4278 passed (4286)`: the two `tests/state/invariants*` files
are new since (step 6), and the simplification removed test files. Times: vitest 47–54 s in the sandbox, 96–103 s in
the clone; typecheck 16–19 s.

Machine state: the baseline started at load average 0.43 with no vitest, checker or DSH run on the machine (only the
user's idle DSH servers on 3080/3099, untouched). This stage ran its suites one after the other. During the second
visible measurement a Windows-side PowerShell JSON parse (one core) ran for about two minutes; its vitest lines were
identical to the first measurement.
