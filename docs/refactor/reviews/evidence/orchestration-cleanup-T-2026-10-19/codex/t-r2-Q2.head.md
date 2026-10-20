# T wave 1 rework 2 audit, group Q2 (decision 80)

**Your files:** `./.lead-ref/groups/Q2-files.txt` (16 files: the shared helpers and every other changed test). Your
diff is `./.lead-ref/groups/Q2.diff`. Group Q1 audits `S3-graph-context` and `S3-context-inputs` in parallel.

**Look hardest at:**

- **W2-20:** 103 real Runs; the A2 Kernel-store wrapper that fails one whole-history re-read; the real backfill;
  `seedLegacyActivity` deleted.
- **W2-21:** the S5 public seed chain (Workspace@3 by line pins; Goals to @6 by 5/4/4 settings calls; `pausedB`), the
  separate id counter, and the one R-4 change at `tests/app/S5-decision-routes.test.ts:246`.
- **W2-10:** AD06 on a real unentered failure (an A2 Kernel store unreadable once after begin, then Host
  `reconcileRun`). **W2-09:** AD03's public reads. **W2-15:** the upstream runA made for real.
- **W2-17 and W2-25** in `tests/runtime/R4c-graph-history.test.ts`.
  - The later-Turn zero-match sub-case was deleted under R-4
    (`vendor/coding-agent/patches/app/composition/composition-root.ts:287`, `run-machine.ts:1258`). Does any row
    allow it, and is the state really unreachable?
  - The A6 cursor row, and the tightened `source_stale`.
- **W2-08:** the Host probe step kept BLOCKED (`session-operations.ts:1029-1031`, `session-health.ts:121`). Could an
  A2 failure at a named point (the Kernel database missing or damaged) give the probe its `missing` or `damaged`
  result?
- **W2-11:** BLOCKED, with the base store assertions put back. **W2-12:** the allocation counts.
- The W2-01, W2-02, W2-07, W2-16 and W2-23 conversions, and the three new optional options of
  `S2B-runtime-steps-fixture.ts`.

