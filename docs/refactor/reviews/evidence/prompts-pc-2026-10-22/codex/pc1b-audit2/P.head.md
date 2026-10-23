# PC-1b audit 2, part P: preparation and the entry (rework 1)

Your part is `P`: `./.lead-ref/parts/P.diff` and `P-files.txt`: `architecture-reminders.ts`, `context-work-recipe.ts`,
`execution-preparation.ts`, `prompt-set-texts.ts`, `query-preparation.ts` (its P-12 comment; its J-07 export deletion
belongs to part J), `tests/contracts/PC-prompt-texts*`, `tests/runtime/PC-prepare-*`, `W2-role-skills`,
`tests/work-graph/PC-entry-frozen-*`. Rows: P-01 … P-13 and L-03 of the frozen table.

**Look hardest at:**

- **P-01.** The render chain takes `PromptTextsV1`; preparation passes the resolved pack; only the no-argument pure call
  keeps the platform default. Is there any other caller that still reads `PLATFORM_PROMPT_PACK_V1` inside the chain
  (kind labels, times, omission, observation suffix)? Is the new optional parameter a test-only path?
- **P-03.** Trim, then unknown id → `invalid`. Does the trim apply where the old loader trimmed, and nowhere else?
- **P-05.** The base's real-request assertions restored (compare with `base/tests/runtime/W2-role-skills.test.ts` and
  with what audit 1 cited from `pc1b-base`); the limit 60,000 ms; only the wiring changed.
- **P-06, P-08.** Injected literals really differ from the generated pack (check the pack in the tree); the frozen
  content, metadata and `source` checked against hand-written values and hand-computed digests.
- **P-09.** The read fails only at the entry step, from a real public preparation. How does the test make only the
  entry's first read fail? Is that seam public or a private module?
- **P-10.** DSH checks Work's snapshot `selection` with the pure `snapshotRuntimeConfiguration` because preparation has
  no public snapshot read (reply §7.5). Does that prove what the row asks (the snapshot preparation stores keeps
  `selection`)? If not, name the public read that can, or say none exists.
- **P-11, P-12.** As the rows say.
- **L-03.** `options.kernel?.FileSkillLoader ?? FileSkillLoader` from the public API; the `unavailable` branch gone; no
  other change in that file.
