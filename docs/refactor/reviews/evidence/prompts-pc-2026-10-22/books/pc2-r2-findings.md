# PC-2 findings after rework 1, frozen for rework 2 (lead, 2026-10-23 night)

Sources: Codex audit 2 in seven parts on `2dae25f` (`./.dsh-ref/audit2/{A,W,H,T,G,Q,J}.out.md`; each row's evidence,
input and fix are there, by its id; part W found nothing); the four rows rework 1 deferred (`./.dsh-ref/pc2-findings.md`
J-04, J-06, J-08, J-09/T-08), now carried by the fixture patches the lead froze in commit `197b4ad` (tag
`pc2-r2-base`; Codex's patch notes in `./.dsh-ref/audit2/FX.out.md`, which also say how each row is tested). The
lead's rulings are binding. **fix** = do exactly what the row's "唯一改法" in the audit file says, with the lead's note
if any; **rejected** = leave as is; **same as X** = done once under X.

Every test row keeps the decision 80 bar: expected values are literals or hand-computed, never from production code,
the generated pack, `preparedTexts()`, a manifest or a captured request; through public steps; whole texts compared
whole; for each row one **production** mutation, applied once, RED, undone, GREEN, recorded honestly.

## 1. Lead rulings

**F1, its scope (Q2-01 rejected).** F1 removed the completed-boundary read PC-2 had added to preparation. The reads
preparation already made in `pc1-final` (the continuation brief, the K3/LA-1 seed boundary, the review's command
facts) stay as they are; "preparation reads no Kernel history" in F1 means no new read. Q2-05's comment fix applies.

**F1's input-shape change in old tests (T2-04 rejected).** The four mechanical changes `completedBoundary` →
`hasCompletedCursor` in `S3-context-assembler`, `S4C2-assembly` and `S3-role-profiles` are approved as they are.

**F4 (Q-01's consequence in old tests).** The lead's full suite on `2dae25f` with bubblewrap: 825 files, 2 failed
(`./.dsh-ref/checks/full-pc2-r1.txt`), both from Q-01's extra preparation read. `tests/runtime/K-readonly-command.test.ts`
and `tests/runtime/RL-31-readonly-resource-caps.test.ts` are added to the whitelist for one change only:
`revisionFor: read => read === 1 ? '<x>-read-1' : '<x>-read-2'` becomes `read <= 2 ? … : …` at K-readonly-command
~734 (KB-08) and ~1069 (KB-10) and RL-31 ~163 (preparation and start read version 1; the change during execution is
still version 2; `audit2/Q.out.md` §3). Every other line of those files stays.

**The deferred rows now run** with the frozen fixtures (`197b4ad`): J-04, J-06, J-08 and J-09/T-08, each exactly as
`pc2-findings.md` and `audit1/J.out.md` say, with the fixture option `audit2/FX.out.md` names for it. The fixtures do
not change in this run; if one cannot carry its row, report it with the error.

## 2. Rows

| Row | Ruling | Lead note |
| --- | --- | --- |
| A2-01 | fix | |
| A2-02 | fix | |
| A2-03 | fix | |
| A2-04 | fix | |
| A2-05 | fix | |
| A2-06 | fix | |
| A2-07 | fix | |
| A2-08 | fix | |
| H2-01 | fix | |
| H2-02 | fix | |
| H2-03 | fix | |
| H2-04 | same as J2-01 | |
| H2-05 | fix | |
| T2-01 | fix | |
| T2-02 | fix | |
| T2-03 | fix | |
| T2-04 | rejected | approved (§1) |
| T2-05 | fix | |
| T2-06 | fix | |
| G2-01 | fix | |
| G2-02 | fix | |
| G2-03 | fix | |
| G2-04 | fix | the 29 lines leave `invariants.test.ts` (back to `af84802`'s text there) and the cases live in the new `PC2-` file of G2-03 |
| G2-05 | fix | |
| G2-06 | fix | |
| Q2-01 | rejected | §1 |
| Q2-02 | fix | |
| Q2-03 | same as J2-02 | |
| Q2-04 | same as J2-04 | |
| Q2-05 | fix | |
| J2-01 | fix | the public path in `audit2/J.out.md` (Host's own platform, no fixture change) |
| J2-02 | fix | |
| J2-03 | fix | |
| J2-04 | fix | |
| J-04 | fix | deferred row, now with the fixture |
| J-06 | fix | deferred row, now with the fixture |
| J-08 | fix | deferred row, now with the fixture |
| J-09 | fix | deferred row, now with the fixture; carries T-08 |
| F4 | fix | §1 |
