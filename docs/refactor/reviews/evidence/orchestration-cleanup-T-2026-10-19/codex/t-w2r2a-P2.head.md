# T wave 2 rework 2 audit, part P2 (W2b-20)

Your part is `P2`: `./.lead-ref/parts/P2.diff` and `./.lead-ref/parts/P2-files.txt` (3 files, the change
`w2r1` → `w2r1b`): row **W2b-20** of `t-w2b-findings.md` (§2, with ruling R-22 in §0 and its §6 result), done after
your rework-1 audit, so you have not seen it. Base `./.lead-ref/base-P2/`; the test file before wave 2 is
`./.lead-ref/base-P2/w2-base-unknown-call-review-list.test.ts`. `tests/work-graph/unknown-call-review-list.test.ts`
changed again in rework 2 (W2c-14, part P1): judge P2 on `P2.diff`; the tree holds both changes.

The Claude audit of this change is in `./.lead-ref/checks/w2r1-claude-audit.md` (its first two blocks: three 建议,
one refuted). Do not repeat them; report what they missed.

**Look hardest at:**

- (a) the second Goal's records: really through the public chain (S5 adopt, claim with `goalRef`, real Session), and
  the Goal filter and cross-Goal assertions of `w2-base` back, on both backends;
- (b) the boundary cursor taken from a real wider page and passed on as returned;
- (c) the store-page test: R-22's timeout and measured times; the assertions kept;
- the shared helpers `tests/helpers/K3-35-runtime.ts` and `tests/helpers/B2-crr-world.ts` (R-15): default paths
  unchanged; name every importer whose behaviour could change;
- the hand ordering argument in the comments (refKey key order, byte order, runId order) against the code.

