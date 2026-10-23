# PC-2 findings after rework 2, frozen for rework 3 (lead, 2026-10-23 night)

Source: Codex audit 3 on `9e984e1` (`./.dsh-ref/audit3/A.out.md`; each row's evidence, input and fix are there, by its
id, and its §3 gives the exact test change for J2-03 and the public steps for J-08's inputs). Audit 3 found no
production problem; every row below is a test row. The lead's full suite on `9e984e1` with bubblewrap is green
(`./.dsh-ref/checks/full-pc2-r2.txt`: 828 files, 10,081 tests passed, 3 skipped; build, typecheck, architecture and
both generators' checks 0), so nothing else is open. The lead froze Codex's J-06 fixture patch as commit `8f8a2f0` (tag
`pc2-r3-base`; the lead's check: typecheck green, a smoke test of `openPCK3ReviewFixture({ sourceHistory:
'completed_turn' })` opens a pending review with one item and prepares the review round, and eight
`openRealRunHarness` caller files pass, 117 tests, with bubblewrap).

**This is rework 3, the last one (decision 80).** Whatever is not done here goes to Codex patches checked by the lead.

Every row keeps the decision 80 bar: expected values are literals or hand-computed, never from production code (no
production function called to build an expected value), the generated pack, `preparedTexts()`, a manifest or a
captured request; values a public read returns at run time (a brief digest, a round id, a run id) may fill a
hand-written whole text, as PC-1b's J2-01 did; through public steps; whole texts compared whole; one **production**
mutation per row, applied once, RED, undone, GREEN, recorded with its file and line.

| Row | Ruling | Lead note |
| --- | --- | --- |
| A3-01 (J-06) | fix | with the frozen fixture: `openPCK3ReviewFixture({ sourceHistory: 'completed_turn' })`; a new case beside the empty-seed one, which stays; the history prefix compared whole against a hand-written literal; `takesSessionHistory === true`; reminder 1 |
| A3-02 (G2-02) | fix | through the existing real Query platform's public steps; no `commitRaw`, no hand-filled Kernel facts, no second owner |
| A3-03 (J2-03) | fix | exactly the change in `audit3/A.out.md` §3 (the digest from the public `readContinuationBrief` after start) |
| A3-04 (J-04) | fix | |
| A3-05 (J-08) | fix | the inputs section through the public steps in `audit3/A.out.md` §3; `footprint` stays out (it is a future section, `[]` in production); the current input compared whole against a hand-written text |

Also record, for J-09 and T2-03, the exact production file and line of the mutation you applied in rework 2 (audit 3
could not tell from the reply); if it was not in production code, apply a production one now and record it.
