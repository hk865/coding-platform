# PC-1b audit 2, part S: the send path (rework 1)

Your part is `S`: `./.lead-ref/parts/S.diff` and `S-files.txt`: `model-budget.ts`, `observed-model-run.ts`,
`execution-driver.ts`, `agent-runtime/query-execution.ts`, `tests/app/PC-host-prompt-selection.test.ts`, the helpers
`S1-workflow-archive-fixture.ts`, `S2B-runtime-steps-fixture.ts`, `task-claim-fixture.ts`, `B1-kernel-assembly`,
`PC-model-budget-preview`, `PC-send-*`. Rows: S-01 … S-13, L-01, L-02, L-04 of the frozen table. S-05 (PC-15) is
part J's.

**Look hardest at:**

- **S-01** as built (the 16 failing files are part X's; do not trace them). Is the new `PC-send-start-check` case what
  the row asks (a model without `selection`, prepared as `test/test`, started as another provider/model → `forbidden`,
  zero model calls)?
- **L-04.** DSH changed BOTH helpers (`task-claim-fixture.ts`: an optional `model` on `preparationHost`;
  `S2B-runtime-steps-fixture.ts`: passes the start configuration's model). The row says "or". Is each change needed for
  `S3-prepared-context-admission`, and is each default unchanged for every other caller?
- **S-03.** One measuring result carries cap, count and `fits`; the preview, the send check and the facts'
  `maxOutputTokens` all take it; no outer copy of the formula left anywhere (search). Is behaviour byte-equal for the
  platform pack (same caps, same counts, same rejection text)?
- **S-06.** Through public preparation and start, a real tool call, then a second request; the literals 256/200 and
  956/900 on the requests and in the records. Mutation: a new meter per request.
- **S-07, S-08, S-09, S-10.** As the rows say; for S-10 check the first run ends normally (no swallowed error) and the
  resume's system is compared byte for byte with the first.
- **S-11, S-12, S-13.** 60,000 ms restored; the external `onContextSelected` option and its forwarding gone (search all
  callers), the internal callback that records reports by `requestId` kept; the stale clause gone.
- **L-01, L-02.** Exactly as the rows say, nothing else in those files.
- **DSH §7.4:** `PC-joint-freeze-and-pin` writes a `.gitignore` in the fixture workspace and runs `git init/add` so the
  Kernel accepts the resume. That file is part J's, but the reason is the Kernel's workspace check: cite the Kernel or
  Host line that refuses the resume, and say whether this setup hides a real behaviour the test should see.
