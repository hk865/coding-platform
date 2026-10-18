# K3 group 4 session B3 — reply

## FILES CHANGED

**Production:** 26 modified, 8 new: **+4,155 / −139 lines** (1,704 added in modified files + 2,451 new-file lines). Over the ~1,400 soft budget; the CRR owner/codec alone is 1,634 lines. Per item (approx. added): CRR owner+codecs+indexes 1,693; ②+parser/expansion/recognition 878; hook/binding 362; request tool 198; card/application/UR7/start-up 746; continuation sentence/section 314; composition wiring 91.

**Tests:** 40 files (25 new), ~4,100 lines including the rebuilt K3-35 fixture and the shared K3/B2 helpers.

## SCOPE ITEMS AND ROWS

0. **B2 leftovers — done.** Literal approval text (removed the `record.proposals` formatter; 10/10 green, +16/−36). K3-35 rebuilt on one task/one public path with unique run refs; T=512 and T=600 are reachable through the real plan-adoption path (the earlier UNSPECIFIED is withdrawn).
1. **`blockedCommands` at ② — done** (B2-01 ②-side, B2-11, B2-17; B2-10 kept green, extended internally for `dirs`). Kernel text read through `readKernelCommandFacts`; parse + two-level expansion; per-expansion basis; 4 distinct `package.json`, `maxBytes=262144`; 16/8/16 KiB caps with the drop order; static expansion never blocks; read failure → `unavailable`.
2. **`shell` hook — done** (B2-01, 02, 04, 11-hook, 13, 15, 16). Binding in `buildManifest` for every Work Run of the task; `before_tool` order allowance → approved method → exact/action/declared; `consumeAllowance` stores `usedBy {runId,callId}`; failed commit blocks with “暂时确认不了允许，稍后再试”; fail-closed text; R=401 exactly 3 pages; zero extra reads without a binding.
3. **`request_command_rerun` — done** (B2-03, 05, 06, 12, 14, 18; B2-09a). Strict input; declared-form append/capacity; denied/denied_final; one open request per alias; no-write branches; alias-index reads.
4. **CRR owner — done** (B2-09). Codec/event/proof/three indexes; request, answer, consume, replay, `idempotency_conflict`, `revision_conflict`; closed derived on read and persisted by the next owner touch; `usedBy` on the record and event.
5. **Card source + application + UR7/start-up — done** (B2-07, 08, 09 answer replay, K3-44-crr-kind4). Derived `command_rerun_request` source; three options; pins; Kernel command text; stored `match`; ≤5 earlier requests; `applyAnswer` proof on `CommandRerunRequestChanged`; work-run UR7 union and start-up kind 4 for both kinds.
6. **K3-15 (二) — done.** The 62-byte sentence appears exactly when the record’s `blockedCommands` is non-empty; briefs without blocked commands keep their bytes/digest.
7. **Blocked lines — done.** `### 被拦的命令`, ≤16 lines, count line, request states, ≤3 forms at 160 bytes, omitted from the end first and counted in the note; records + CRRs read at `prepare`.
8. **K3-35 — done.** (二) T=512: 15,761 bytes ≤ 16,384 (mandatory 15,692; 0 body lines; omission note 25 = 24 body + 1 removed blocked line); required part verbatim. (三) T=600: mandatory minimum 16,396 = **12 bytes over** → `capacity`, whole blocked section removed, nothing mandatory dropped. Both hand-derived from L20’s table and item 7, never from the renderer.

**K3-16 flip:** `blockedCommands: []` → the real list, 2 entries in `K3-16-approval-application.test.ts` (`echo k3-fixture`, sha `13d617…`, action `979cd9…`), 1 entry in `K3-16-approval-round.test.ts` (`k3-16-approval-e2e runs a program`, sha `79dba9…`, action `f0e89c…`).

## CHECKS (`--maxWorkers=2` unless noted)

- K3 100 files / 505 pass; B2 26 / 158 pass; runtime 76 / 546 pass; S4C2 28 / 209 pass; app/S4C 3 / 28 pass; architecture 4 / 53 pass; K- 14 files / 97 pass + 15 baseline; S5 20 / 286 + 1 baseline; business 19 / 184 + 1 baseline (R5b); WP1 3 baseline; state 37 files / 3,844 pass, 29 skip + 1 baseline test/suite; composition 33 / 121 + 21 baseline; brief 4 / 14 + 5 baseline; A8 5 files / 20 pass + 21 fails (20 baseline + 1 unlisted, below).
- My own key-row run: B2 18 files / 71 pass; K3-35 3 files / 11 pass; K3-15/16 + production-reach + platform 10 files / 43 pass.
- `npm run typecheck` pass; `npm run check:architecture` pass (boundaries OK); `npm run build` pass.
- **Non-baseline:** `tests/scenarios/A8-host-restart-paused.test.ts > A8-3n (closing unsupported…)` times out with `auto_rework_pending`. The file is unchanged from HEAD; its title looks like a renamed baseline A8-3n entry, so most likely the same sandbox limitation, but I cannot prove it without bwrap.

## UNSPECIFIED

- **B2-09b** (consume commit succeeds, command never starts → `outcome_unknown` + review) is not built; smallest option: an L29-crash E2E with one allowed CRR and the shell seam killed after the hook consumes.
- **B2-15 Kernel-level** `hook_blocked` replay is not exposed by the fixture; tested the owner replay plus “no re-parse/re-read package.json” at the hook seam.
- `requestRerun` input is `{task, runRef, command, reason, rewriteOf?}` and returns `WriteResult<CommandRerunRequestWriteOutcomeV1>` (spec §2 said `WriteResult<CommandRerunRequestV1>`); the no-write outcome is carried as a committed result.
- `listRequests` does not derive `closed` per item (only `readRequest` does) so the hook’s B2-16 bound holds; the card source/hook derive with the Task status they already read.
- A blocked afterRun record with no CRR seam makes `prepare` `unavailable` (fail closed).
- Manifest binding caps at 32 entries per task if more exist (unreachable in the fixtures).
- Ambiguous 8-char `rewriteOf` prefix is unreachable with real `s5-id-N` run ids; foreign/not-found are covered.
- `expandShellScripts.truncated` means a `maxFiles` skip only; a single-quoted `cd` containing `$`/backtick/`~` is conservatively non-static.

## SUBAGENTS

11 tasks: seam, 0a literals, N parser/expansion/②, F CRR owner, R hook/tool, C card/application, D continuation, R2 remaining rows/fixture, W wiring+checks, K K3-35 T=512/600, plus K’s restore. Most at once: **5** (N, F, R, C, D). Wall clock ≈ 56 minutes, well under 280.

## SURPRISING

The B3 UNSPECIFIED on K3-35 was not a production limit: the shared proposal helpers pinned `PLAN_B2`, so a 512/600-byte Task could not be claimed. Adding an optional `planRef` and a real plan-adoption helper made both rows reachable and green. The close-out subagent deleted that test as “out-of-scope”; it was restored byte-for-byte from the owning subagent’s context and re-verified (4/4). Production is far over the soft line budget (≈4,155 added vs 1,400).