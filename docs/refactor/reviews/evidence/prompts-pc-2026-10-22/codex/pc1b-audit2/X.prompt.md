# PC-1b audit 2, part X: the S-01 regression in the full suite (read-only question; lead, 2026-10-22 night)

**Read only:** do not modify, create or delete any file; no tests, no builds, no git writes, no network. Answer in
plain Chinese, with `file:line` for every fact. Inputs are in `./.lead-ref/` (`books/pc1b-findings.md` for S-01, J-09,
L-04; `replies/pc1b-r1-reply.md` §2 S-01 and L-04 for what DSH did); the tree is the current directory.

Rework 1 did row S-01 of the frozen table: it deleted the `model.selection === undefined` early returns in
`samePromptBinding` (`src/core/agent-runtime/execution-driver.ts` ~117, `query-execution.ts` ~96; see
`parts/S.diff`), so a start always compares `promptSelectionOf(model)`'s three fields plus provider and model with the
frozen `promptSet`. The lead's full suite on `1b5183a` (`checks/full-pc1b-r1.txt`, log `checks/full-pc1b-r1-vitest.txt`)
has 16 files with 32 failing tests; most fail with `forbidden` "the Host model or prompt selection changed since
preparation" or, downstream, with locks never taken, "no read call entered the stand-in; model=0" or 180 s timeouts.
The probe (`checks/pc1b-r1-s01-probe.{sh,log}`) puts back only the two early returns: all 16 files pass (86 tests).
Before rework 1, at `c1c7af4`, these files passed (`checks/full-pc1b.txt`).

The lead's reading: every production Host fills `selection` (`src/app/runtime-configuration.ts` ~471–479), so the
early return only ever skipped the comparison for a `BoundModel` a test builds directly, and these old tests prepare
with one model binding and start with another. The lead must now rule between:

1. **Keep S-01 strict** and let rework 2 change old tests' wiring so preparation and start use one binding.
2. **Undo S-01** (restore the early return; drop S-01's new test case), accepting a branch that only tests reach.
3. Something smaller you can prove.

## Questions

1. **Production.** List every place in `src/` that builds the model of a `ResolvedRuntimeConfiguration` (or any value
   that reaches `samePromptBinding` as `model`), `file:line`, and whether it fills `selection`. Can any production path
   reach the start check without `selection`?
2. **Each of the 16 files** (each failing test): where the preparation's model binding comes from and where the start's
   comes from (`file:line` of each), and why they differ (e.g. `preparationHost`'s default `test/test` at
   `tests/helpers/task-claim-fixture.ts` ~522, a restart harness's own binding, a different revision). Say whether the
   test **means** a binding change (then `forbidden` is the right new outcome and the test's expectation is what must
   change) or the difference is wiring by accident.
3. **Group by cause:** which shared helpers (`tests/helpers/*`, `tests/scenarios/support/*`) produce the mismatch, and
   how many test files each covers. For option 1, the smallest change per helper as a unified diff in your answer (not a
   file), each change keeping every other caller's behaviour; the list of files rework 2 would need in its whitelist;
   whether any test body (not helper) must change.
4. **Other suites.** Are there callers outside the 16 that pass today only because their bindings happen to match, or
   tests in the scale batch (`npm run test:scale`, as `package.json` and the vitest configs define it) that would hit
   the same check? Search; list them.
5. **Option 2's cost:** what stays a test-only path, which audit-1 findings (S-01, J-09) it leaves open, and what PC-2
   would inherit.
6. **Recommendation** with the evidence, then one last line:
   `结论：改法 1（helper n 个，测试文件 m 个）` or `结论：改法 2` or `结论：改法 3（…）`.
