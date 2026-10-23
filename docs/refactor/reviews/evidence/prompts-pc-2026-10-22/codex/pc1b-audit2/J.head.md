# PC-1b audit 2, part J: the joint step, PC-15, J-07, J-08 (rework 1)

Your part is `J`: `./.lead-ref/parts/J.diff` and `J-files.txt`: `continuation-brief.ts`, `context-assembler.ts`,
`context-rendering.ts` (J-07; `query-preparation.ts`'s J-07 hunk is in `parts/P.diff`), the allowlist, `PC-joint-*`
(including the new `PC-joint-budget-removal.test.ts`), and J-07's four old tests (`A2-rework-contract-helpers`,
`S3-context-assembler`, `A1-rework-same-session`, `R5b-initial-plan`). Rows: J-01 … J-09, S-10's and R-12/R-13's joint
parts, S-09's PC-10 part, R-14, and the "PC-15" section of the frozen table.

**Look hardest at:**

- **PC-15 (a) and (b)** against the table's PC-15 section and your `audit1/pc15.out.md`: every number recomputed by hand
  from the hand-written request in the test (show the arithmetic); the assertions the section lists, all present; the
  base mutation and (b)'s mutation as the section names them. DSH normalizes two platform-generated values in
  `EXPECTED_INPUT_2` (the brief digest and the round UUID; reply §7.3) with regex placeholders: is there a public read
  that gives either value without taking it from production code, or is the placeholder the right way? Does the
  placeholder let a wrong value pass?
- **J-01, J-02, J-04.** Hand-written whole system and input; the old Skill present; digests hand-computed; the
  mutations named in the rows.
- **J-07 partly done** (reply §7.1): `CONTEXT_SECTION_HEADERS` kept because `tests/runtime/S4C2-assembly.test.ts:29`
  and `tests/work-graph/S3-role-profiles.test.ts:39` import it (outside the whitelist). Confirm those imports and any
  other importer; say what the lead should rule (allow the two files to use literals, or keep the export with a
  `kept-for` note). Check the four old tests changed only to literal expectations of today's values, nothing else.
  `S3-context-assembler.test.ts` grew by 97 lines and `R5b-initial-plan.test.ts` by 88: is every added line a literal
  standing in for a deleted export, or did more change?
- **J-08.** Seven `kept-for` notes match the check's pattern and name a real consumer; the three `PromptRecord*` stay
  `wire-format` with corrected reader notes.
- **DSH §7.4:** the `.gitignore` and `git init/add` setup in `PC-joint-freeze-and-pin` (part S looks at the Kernel line
  that needs it; you check the test does nothing else with it).
