# 2C-26 full-suite failure on the 4C-2A merge tree — investigation (Claude subagent, 2026-10-17 ~09:30)

**Bottom line:** a clock-dependent flake in the test; 4C-2 session A did not cause it (reproduced on the 8A tree too). The WSL wall clock steps backwards ~1.5–1.9 s about every 30 s. Fix in the test, not production.

**Mechanism**
- The test stamps three times with the real wall clock: the requeue, through the requeue service's `now = () => new Date().toISOString()` (`tests/scenarios/S2C-K-legacy-provenance.test.ts:229`, called at `:392`); C's `SessionCreated` ~40 ms later (`recordSessionCreated` uses `new Date()` directly, `src/core/work-graph/sessions/session-directory.ts:1043`, no injectable clock; test `:399`); C's claim at `Date.now() + 60_000` (`:400`).
- The legacy derivation's ordering check `src/core/work-graph/tasks/session-provenance-facts.ts:341` (`if (childMs < requeueMs || childMs > claimMs) return … derivation: null`) needs requeue ≤ C's creation ≤ claim.
- A backward step between the requeue stamp and C's creation drops the requeue evidence; with no other evidence the derivation returns `{kind:'new'}` (`:597-600`); maintenance backfills it (`src/business/workflow/session-maintenance.ts:545`); C's line stays `[C]`; the executions section lists only C's claim (the error at `:496`).
- journald: "Clock change detected" every ~30.7 s, 77 times during the failing run (08:16–08:56); a 4-minute monitor saw 7 backward jumps of 1530–1926 ms. Not verified in the failing run itself (no logs); the signature matches. Estimated hit rate ~0.1–0.5% per affected test (tests 2 and 3).

**4C-2 session A's Host change:** not involved. The AG2b Host runs on a fixed clock (`tests/helpers/AG2b-collaboration-fixture.ts:266`), so the scribe check's period gate (`src/app/host.ts:1311`) passes once at start; that pass only reads (no scribe Session).

**Experiments** (single runs of the file, 2 GB scope, 2 workers): plain repeats on the merged tree 20/0 failures; simulated jump (requeue +1.7 s): tests 2 and 3 failed every run, test 3 with the identical message, merged 1/1 and 8A 1/1; real jump lined up in the window: merged 3/3 failures, 8A 3/3 failures (one run where the jump missed passed); with the fix: simulated jump all 3 pass, real jump 2/2 pass, plain 5/5 pass.

**Fix (test only):** in `requeueTask` replace `const now = () => new Date().toISOString();` with `const now = () => new Date(Date.now() - 60_000).toISOString();` and say in the comment that the requeue is stamped a minute before C's wall-clock creation stamp so a wall-clock step cannot reorder them (mirrors the claim's `+60_000`). Slice-1 SPEC ~600: tests use one fixed clock or `vi.setSystemTime` (`tests/work-graph/S1-provenance.test.ts:114`); `vi.setSystemTime` is bigger in a real-HTTP-Host scenario. No production rule broken (slice-1 SPEC ~194).

**Left for the lead:** the production ordering check compares wall-clock stamps of two writers; on a clock stepping backwards a real requeue followed by a create within ~1.7 s could be judged `new` — legacy Sessions only (historical stamps), left alone. The WSL clock behaviour is a general flake source (`systemd-timesyncd` active, maybe fighting Hyper-V time sync; unverified); no system settings changed.

Copies: `~/dsh-work/inv-2c26` (edits reverted; `.inv/` holds scripts and logs), `~/dsh-work/inv-2c26-8a` (untouched).
