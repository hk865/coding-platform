# PC-2 audit 2, part T: rendering and F3 (rework 1)

Your part is `T`: `./.lead-ref/parts/T.diff` and `T-files.txt` (`continuation-brief.ts`, `prepared-execution.ts`,
`context-rendering.ts`, `PC2-T-render`, and the old tests of F3: `AG6-agent-assembly`, `C2-runtime-platform-tools`,
`K3-15-blocked-omission`, `K3-35-T-by-hand`, `K3-35-approved-methods-brief`, `A1-rework-same-session`, plus
`S3-context-assembler`, `S4C2-assembly`, `S3-role-profiles`). Rows T-01 … T-11 (T-08 deferred, T-09 same as J-11,
T-10 rejected) and **F3**. `context-types.ts` and the recipes are in part Q (F1); read them for T-03 and T-11.

**Look hardest at:** T-04 — the brief's capacity path now renders every candidate through the frozen template: with
the platform pack, is every brief byte-equal to `af84802`'s for every input (the K3-15/K3-35 tests are evidence; read
the candidate loop against `base/`)? T-01, T-02 (absent `toolNames`: every tool block named in the template present),
T-03 (the cast gone; the material's type `PromptTextsV1`), T-05, T-06, T-07, T-11. **F3:** redo DSH's sums in reply §2
by hand against the tests and the template bytes (57, 70, the paddings, 1447, 5752, 12619, 12707, 12114); the Skill
literals in AG6 and C2 — whole, hand-written, and right for each test's real tool list (rendered by hand from the v2
templates)? Was anything else in those old tests changed?
