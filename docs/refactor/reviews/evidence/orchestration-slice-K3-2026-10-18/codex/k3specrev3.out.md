| Prior finding | Status | Fifth-draft lines |
|---|---|---|
| 1 | Resolved | 362–366, 560–582 |
| 2 | Resolved | 277–278, 374–385, 1042–1044 |
| 3 | Not resolved: M1 | 491–497, 1076 |
| 4 | Not resolved: M2 | 616–633, 1069–1087 |
| 5 | Resolved | 185–194, 792–796 |
| 6 | Resolved | 337, 384–395, 1195 |
| 7 | Resolved | 407–411, 443–449 |
| 8 | Not fully resolved: S1 | 338–344, 444–481 |
| 9 | Resolved | 428, 498, 1065, 1218 |
| 10 | Resolved | 1248–1249 |
| 11 | Resolved | 1148, 1217, 1221, 1231 |
| B1 | Resolved | 362–366, 560–582, 1402 |
| B2 | Not resolved: M4 | 110–113, 429–439, 1295 |

Lines refer to the [fifth draft](D:/cc-lead-notes/specs/k3/slice-K3-SPEC.md). Code checked at `a9de6822`; no edits, tests, or model calls.

**M1 — UR3h misses paused, unentered rounds.** Lines 491, 497, 1076 promise cancellation and settlement before releasing hold, but `isUnadmittedStarting` explicitly excludes paused Runs ([workflow.ts:898](D:/cxt/k3-spec/src/business/workflow/workflow.ts:898)). Reachable sequence: claim review → pause before entry → hold. UR3h cannot cancel it, RUN-02 cannot start it, and release remains busy. **Fix:** use a cancellation-specific predicate covering proven-unentered Claimed/Authorized/Revoked Runs, including paused ones; retain Run-revision guards.

**M2 — Discovery finds historical answers, but repair cannot reach them.** Lines 631–633 scan answers across the goal; UR7b remains inside the **selected Run’s record** table (1069–1081). If ② commits, ③ fails, and continuation is claimed before restart, the old review is no longer selected. Startup discovers the receipt but ordinary selection cannot repair it. **Fix:** schedule bookkeeping directly from each discovered answer’s `reviewRef`, independently of selected Run, task eligibility, and `open`.

**M3 — The 512 KiB guarantee is false.** Lines 236–243, 480, 680–774. There is **no finite field-derived maximum**: summary `cwd`, several identifiers, and sampled/not-visible path lengths lack limits.

Even bounded text at three UTF-8 bytes per character already contributes:

`32×3×(512 + 8×512 + 2000 + 1000 + 2000) + 7×32×512 + 2×2000×3 = 1,049,056 bytes`.

This counts summaries/paths, retained reviewer evidence/self-check, proposal rationales, seven call-ID occurrences, and origin/disposition text. D6’s fixed replacement evidence, both proposal-command representations, workspace data, eight rounds and their references, and JSON overhead add more. JSON escaping can further increase size. **It does not fit 524,288 bytes.**

**Smallest fix:** enforce actual serialized UTF-8 admission on every constructor/update, returning `capacity` without writing on overflow; reserve mandatory settlement/approval/hold growth before accepting optional text. Define a bounded incomplete draft for creation overflow so attestation remains possible.

**M4 — B2 remains an explicit freeze prerequisite.** Lines 110–113, 1295. The fallback is now specified, but neither option is selected. **Fix:** record the user’s choice and freeze that branch.

**S1 — Qualify the fitting guarantee.** Lines 445, 478–481: `6,562 + 8×512 + 5,120 = 15,778`, leaving **606 bytes**. That arithmetic fits, but T is a reservation, not an enforced identifier limit; line 481 explicitly permits `capacity`. **Fix:** qualify “always fits” with the stated T condition.

**Verdict: freeze after listed fixes.**