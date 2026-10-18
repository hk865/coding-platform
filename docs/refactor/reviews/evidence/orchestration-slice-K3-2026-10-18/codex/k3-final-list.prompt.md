Read-only final full list for K3 group 4 session B3, after DSH rework 2 under decision 81 (book `k3-g4b3-rework-10.md`). This repository copy is tag `k3-g4b3-r10` (exported, no .git). Decision 81-3 applies: **this list has no length limit, it must list everything that still needs to change, and the lead freezes it as the final table.** After it there is at most one more DSH round, then Codex test patches and an Opus subagent; nothing found later reopens the review. So be complete now. Answer in Chinese. Do not write any file, do not run tests (the lead runs the bubblewrap full suite separately).

Inputs under `./.lead-ref/`:
- the frozen table: `k3-merge.out.md` (rows F-001..F-102, `M§4`); the decisions `decisions-80-81.md` (80-6: the product owner twice chose "only the business-relevant rows", the rest to T; 81: the rework cap and this full list);
- the classification record `k3-business-classification.md`; the test rule sheet `test-rule-sheet.md` (v3, unchanged);
- the books `k3-g4b3-rework-9.md`, `k3-g4b3-rework-9b.md`, `k3-g4b3-rework-10.md` (its §2 rulings 1–8 are final) and your checks of them `k3-book9.out.md`, `k3-book9b.out.md`, `k3-book10.out.md`;
- your last verify `k3-verify9.out.md` (67 rows: 45 done, 22 partly, 10 ledger weakenings, 6 fake-guard groups, F-098); the lead's mutation run `k3-mutation-r9b.txt` (all 6 groups confirmed fake on r9b);
- the replies `k3-g4b3-rework9a-final.md`, `k3-g4b3-rework9b-final.md`, `k3-g4b3-rework10-final.md` (claims, not evidence);
- diffs: `k3-g4b3-r10.diff` + `k3-g4b3-r10-stat.txt` (this round, r9b..r10), `k3-g4b3-r8-r10.diff` + stat (everything since the decision-80 freeze, 139 files);
- ledgers: `d1-round-10.txt` (r9b..r10), `d1-cumulative-r10.txt` (`k3-g4b3^`..r10), older `d1-round-9.txt`, `d1-round-9b.txt`;
- `k3-r9b-failing-files.txt` (20 files) and `k3-r9b-full-failing-files.txt` (29 files, 122 tests): the r9b full suite failed with "prepare rejected" because 9a made the Task review reader required; package R of book 10 wires the real owner into the shared fixtures;
- `k3-line-scope.txt`, `pre-k3-files.txt`.
- Specs and behavior in the copy: `docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md`, `docs/MVP-BEHAVIOR.md`, `docs/refactor/STATE-MACHINES-SPEC.md`.

**Scope (decision 81-3):** (a) every row of the frozen table that is not closed; (b) everything in the files changed since the freeze (`k3-g4b3-r8-r10.diff`) that has a business consequence: production defects, regressions, fake guards (a test that would still pass with its guarded production check removed), weakened assertions. Not a whole-slice re-review.
- Closed means: verified fixed in `k3-verify9.out.md` and not reopened by r10, or verified fixed now.
- Rows already sent to T by the product owner or by ruling (book 9b §1; book 10 ruling 2: F-014, F-027, F-046, F-055 and the tests of F-071, F-075, F-088; F-066 by ruling 6) are not must-fix. List one of them only if r10 broke it or if you find a real business consequence, and say which.

**Output.**

1. **The final list.** One table row per open item (frozen rows still open, plus new items from scope (b), each with a new id `N-01`, `N-02`, …). Columns:
   - id; file:line;
   - category, exactly one of: 会出错 (production misbehaves in normal use) / 缺保护 (production is right but no test would catch its removal) / 只是写法 (test form only, no protection lost) / 没有可见后果 (hygiene);
   - status after r10: partly / not / new;
   - root cause: why the last round did not finish it (缺夹具 / 走不到 / 规则含糊 / 被改弱 / 没做 / 新引入), one sentence;
   - one fix (not two options), concrete enough to execute;
   - who: DSH / Codex test patch / Opus (real Host restart, gate timing, numbers that must be run) / lead (≤ about 10 lines);
   - can Codex write it blind (yes/no and why: needs a run, needs a fixture that does not exist, timing);
   - the mutation patch: which production check (file:line, the exact line) to delete or change so this test must fail, and the assertion (file:line) that must fail. For 会出错 rows, also the failing test to write before the fix.
   Where you are unsure whether a path is reachable, say "需要实跑" instead of guessing.

2. **Closed in this round.** One line per frozen row r10 closed: the fix (file:line) and the proving test (file:line), and for protection rows whether removing the guarded check makes it fail (STATIC). Include the six fake-guard groups G1–G6 from `k3-mutation-r9b.txt` and F-098, F-076, F-101.

3. **Ledger.** Each line of `d1-round-10.txt`: required by row x / equivalent move (same check now at file:line, same literal, same subject) / weakening (what was lost; then it also goes into the final list).

4. **Package R.** Is the Task review owner wired as the real service over the same records in each shared fixture (`B2-runtime-fixture`, `S2B-runtime-store-fixture`, `S1-runtime-scenario-fixture`, `WP1-entry-fixture`, `S1-workflow-archive-fixture`, `S1-archive-flow`, `S3-context-assembler`)? Do the 29 files of `k3-r9b-full-failing-files.txt` reach prepare through these (file:line)? Any fixture left with a stub or a fake reader? Are the removed production-reach allowlist entries now really reached from production?

5. **The r10 reply's FOUND and UNSPECIFIED**: F-054's real review record has one item (literal `[1,2,3]` became `[1]`): options (a) accept, (b) build a real multi-item record; `K3-48-2:213–217` hand-encodes and commits an UnknownCallReview; `B2-blocked-runtime.ts:260–271` constructs a WorkspaceFile for its default recognizer. For each: what the code does (file:line), the category, and one proposed ruling.

End with one line: open items by category (会出错 / 缺保护 / 只是写法 / 没有可见后果) and by who (DSH / Codex / Opus / lead); whether any 会出错 or 缺保护 item remains (that decides whether rework 3 goes to DSH).
