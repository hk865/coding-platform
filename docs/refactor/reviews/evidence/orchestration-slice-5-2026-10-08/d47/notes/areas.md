# Slice 5 — the four area rounds (stage S5-Areas, track A, slot s5)

2026-10-09 13:33 onward, lead (Claude). Decision 47 (1): the large review items of slice 5, split into four area
briefs (A–D, written in stage S5-Rebase, `areas/<K>-brief.md`), each to a NEW DSH Session, then scripted checks and
a Codex re-review per area. `S` = `scratchpad/impl/s5`, `A` = `S/areas`, `O` = `A/run`. The product model is never
called; DSH ports 3080/3099 and 44797 untouched; the real worktree is not changed in this stage.

## 0. Setup

- Four area copies `~/dsh-work/slices/s5a|s5b|s5c|s5d`, each `mk-slice-copy.sh s5<k> 216e0e2b` (tree c5f77bd7… =
  source tree) + tag `slice-base` on the baseline commit + `git apply --binary R/s5m-merged.patch` (sha 9d655f8d…).
  Script `O/mk-area-copies.sh`. Each: 93 status paths = the s5m list, frozen v3 sha list ok, platform-duty sha
  6adfb57e… = s5m, `diff -rq` vs s5m (without node_modules/.git/dist) empty.
- Books `~/dsh-work/slices/_books/s5-area<k>.md` = `A/<K>-brief.md` byte-identical (A 3ca1cf1f…, B c78e13ed…,
  C d03da5a2…, D 18f57b31…).
- Runner: `O/run-area.sh <k> [tag]` (NEW Session, `--max-context 360000 --max-minutes 120`; run record to
  `O/run-area<k><tag>/`, usage of every Session of the copy's private state via `dsh-usage.mjs` to `O/area<k><tag>.usage.jsonl`).
- Checks: `O/check-area.sh <k> <tag>` (outside the sandbox, real bwrap via `~/cc-work/env.sh` + `with-usr-bin-node.sh`,
  under the test lock): full patch vs slice-base and the round's delta vs the s5m state (temp index: slice-base +
  s5m patch = T0, copy = T1); delta paths ⊆ the area scope (`O/scope.txt`); frozen v3 sha; status list = s5m list;
  typecheck / check:architecture / build; vitest on the 131 named files (`R/named-files3.txt`, ⊇ every area's
  test list) — expected with bwrap: all pass.
- Codex: `O/codex-area.sh <k> <tag>` (new clone `D:/cxt/s5area-<k><tag>` of the real worktree at 216e0e2b + the
  copy's full patch; inputs brief / DSH reply / round delta in `D:/cxt/s5area-<k><tag>-inputs`; read-only, xhigh;
  prompt from `O/codex-prompt.tmpl`).

Order: B and D started together at 13:35 (the brief's suggested order; decision 36: 2–3 DSH at once); C and A next.

## Area C — ordering safe point (copy s5c)

- DSH run `slices-s5c-areac` (book d03da5a2…): NEW Session session-9244279d…, 13:36:32–14:07:56, wall 1,884 s,
  exit 0, not stopped; main 868,803 tokens (in 41,909 / cacheRead 791,040 / out 35,854), 26 tool calls, 22 steps,
  peakContext 64,349. Subagents 3 (1 implementer C-1 incl. one rework, 2 fresh reviewers): 10,514,033 tokens,
  144 calls, 104 steps (all Sessions: 11,382,836 tokens / 170 calls; `O/areac.usage.jsonl`). Reply `O/run-areac/final.md`:
  C1 done (in-memory per-scope rendezvous, one microtask batch, release in the returned order, wait only until the
  released advance's Workflow call; post-completion observation never joins), C2 done (one ordering call per batch,
  result used, `sessionHint: null` takes part, refused/throwing/absent seam = arrival order; the discarded `start()`
  call removed). Its sandbox numbers = the brief's expectation exactly (24 / 69 / 29 skipped, bwrap kind).
- Lead checks `O/check-area.sh c 1` (14:08–14:12): delta = `src/app/collaboration-driver.ts` only (+178/−54), in
  scope; frozen v3 ok; S1 helper b68edde8 unchanged; status 93 = s5m list; 1 commit; no `.dsh-scratch`; typecheck /
  check:architecture / build exit 0; **named 131 files with real bwrap: 131 passed, 3,819 tests passed, 0 failed**.
  Full patch `O/chk-c1-full.patch` sha256 37257b7e…, delta `O/chk-c1-delta.patch`.
- Codex re-review `O/codex-c1.md` (14:09–14:15, 6.4 min, read-only xhigh, clone `D:/cxt/s5area-c1`, prompt
  `O/codex-c1.prompt.txt`): C1 PARTLY, C2 PARTLY, 4 "must-fix". Lead verification at the cited lines:
  - **#2 confirmed (substance, small).** The exemption sat on the wrong transition: the Goal-scope `select_work`
    the driver builds after a pinned yielded Task completed was exempted although it can claim/create other work
    (`workflow.ts` selection loop after the pinned-Task check), while the pinned `select_work` the Workflow returns
    after `complete_task` (`workflow.ts` `case 'complete_task'` → `selectWorkStep(base)`, which only observes the
    satisfied Task, `:1221–1225`) still went through admission. **Lead fix LC1** (`O/fix-c.py`): no exemption for
    the Goal-scope re-selection; exemption only for `select_work` with `taskId` that follows a `complete_task`
    receipt.
  - **#1 partly confirmed.** A stopped handle waiting at the safe point kept waiting until the earlier advances'
    Workflow calls (bounded, but `stop()` should not wait for others). **Lead fix LC2**: a per-handle release in
    `admissionWaits`, called by `stopHandle` (close stops every handle), so the waiting entry leaves the pending
    set at once and the pass skips it. Not taken: a time bound on `orderGoalAdvances` itself — a never-settling
    owner read blocks any caller the same way (the old s5m code awaited the same seam in `start()`); recorded as
    residual risk, not a slice-5 rule.
  - **#3 nit, not taken.** With a defined seam the first `advanceWork` happens after `start()` resolves (the
    ordering read is async I/O by nature; the spec requires ordering at that point). No caller or spec rule relies
    on the call being made before `start()` returns (change-emitters, which does, uses no seam and keeps the
    synchronous path).
  - **#4 not a defect (brief C2).** A thrown ordering read falls back to the caller's order like a refused one
    (brief: "a refused/unsupported ordering keeps today's fallback"); ordering is advisory and the Workflow call
    that follows does its own reads and returns their failures.
- After LC1/LC2 `O/check-area.sh c 2` (14:16–14:20): delta still only the driver (+183/−54), frozen ok, status 93
  same, typecheck / architecture / build 0, **named 131 with real bwrap: 131 / 3,819 passed**. Full patch
  `O/chk-c2-full.patch` sha256 993adc2b…. No frozen test drives the driver safe point (DSH probed with a throw-away
  script; WF02 calls `orderGoalAdvances` directly), so C1/C2/LC1/LC2 are covered only by review + regression.
  **Area C accepted** (no follow-up brief needed).

## Area B — decision sources, saved answers, application recording (copy s5b)

- DSH run `slices-s5b-areab` (book c78e13ed…): NEW Session session-bd12fc0d…, 13:34:55–14:26:35, wall 3,100 s,
  exit 0, not stopped; main 2,531,966 tokens (in 68,006 / cacheRead 2,397,056 / out 66,904), 41 tool calls, 31
  steps, peakContext 124,833. Subagents 9 (3 implementers B-1..B-3, 3 fresh reviewers, 3 targeted fixers):
  76,365,488 tokens, 852 calls, 681 steps (all 10 Sessions 78,897,454 tokens / 893 calls; `O/areab.usage.jsonl`).
  Runner flag `contamination: attempted-outside` = the `/tmp` word of the brief inside subagent prompts plus one
  read-only `find /home/han001/dsh-work -name '*.log'` by the main Session; no write outside the copy (status 93).
- Reply `O/run-areab/final.md`: B2, B3, B5, B6, B7 done; B1 done for the formal-rework path, two paths reported
  (the Host-budget lift of `stopped/budget_exhausted` and the caller-supplied perform action are invisible to the
  reader); B4 done in area B, but the Agent adoption path `tasks/plan-service.ts:~3319` attaches no
  `decisionProof`, so a real Agent adoption still cannot be recorded (outside every area's scope); residuals: an
  `aggregate` object with a missing pin is dropped before verification; `queryTaskGraph` optional in the reader deps.
  Sandbox numbers = the brief's expectation exactly.
- Lead checks `O/check-area.sh b 1` (14:27–14:30): delta 7 files (+951/−295), all in scope; frozen ok; S1 helper
  unchanged; status 93 same; 1 commit; typecheck / architecture / build 0; **named 131 with real bwrap: 131 / 3,819
  passed**. Full patch `O/chk-b1-full.patch` sha256 6f35d865….

## Area D — settings replay and proofs (copy s5d)

- DSH run `slices-s5d-aread` (book 18f57b31…): NEW Session session-16aa75bb…, 13:34:56–14:28:45, wall 3,230 s,
  exit 0, not stopped; main 1,502,960 tokens (in 65,777 / cacheRead 1,386,240 / out 50,943), 30 tool calls, 26
  steps, peakContext 103,495. Subagents 5 (D-1, D-2, 2 reviewers, D-1 sent back once): 17,903,026 tokens, 256
  calls, 193 steps (all 6 Sessions 19,405,986 / 286 calls). Contamination flag: the brief's `/tmp` word only.
- Reply `O/run-aread/final.md`: D2, D3 done; **D1 not as directed**: a bounded in-process memory (256, FIFO) of the
  first execution's `{source, expected}` keyed by `{project, workspace, actor, requestId}`, re-sent on a retry; it
  says a durable lookup of `<requestId>:settings` has no seam in scope. Survives no restart.
- Lead checks `O/check-area.sh d 1` (14:30–14:35): delta 2 files (+116/−42), in scope; frozen ok; status 93 same;
  typecheck / architecture / build 0; **named 131 with real bwrap: 131 / 3,819 passed**. Full patch sha256 51a10455….
- Codex re-review `O/codex-d1.md` (14:30–14:37, 7 min): D1 PARTLY, D2 FIXED, D3 FIXED. Lead verification:
  - **#1 confirmed (substance).** The memory is lost on restart/eviction; a three-Goal `conflict_order` retry even
    changes `expected` without any other edit (the first commit itself bumps the uncaptured third Goal). Codex
    checked the implementer's seam claims: (i) owner replay by identity+fingerprint, (ii) `applicationReceipt`
    cursor-indexed, (iii) wait GoalPhase not in the event — correct; "extra order Goals absent from the event" —
    wrong (saved as `nextGoals`). Codex's proposed durable design (identity-only lookup + persisted `expected`) needs
    store/codec changes. **Lead fix LD1** (`O/fix-d.py`), from the spec text itself (§4.5 line 884: "settings命令
    meta.expected及指纹保留原captured source pins；仅records.guards按§2.8采用已核对当前Goal版本 … 不参与新的可变
    输入指纹；重试先恢复原settings receipt"): the owner's `resolveGoalConflict` fingerprint keeps only the expected
    pins of objects the answer captured (`input.source.pins` refs); the supplementary pins read current (wait's
    earlier GoalPhase, uncaptured order Goals) stay first-execution CAS guards only. A retry with moved
    supplementary objects meets the same identity+fingerprint and replays the durable receipt. The coordinator's
    in-process memory is removed (it is no longer needed, and Codex #2 showed it shared a mutable source with the
    returned answer). No stored receipts exist yet (slice 5 unreleased), so no compatibility concern.
  - **#3 confirmed (small). Lead fix LD2:** a failed supplementary/source read after the committed answer is
    returned in `action` (`ResolveDecisionReadV1.action` allows a `CoreRejection`; not_found/not_ready mapped to a
    rejection) instead of `null`, state stays `application_not_recorded`.
  - **#4 not taken (pre-existing, not this round):** Goal reads before the Workspace check in
    `goal-settings-service.ts` (`GoalRef` carries no Workspace, so the owner must read the Goal to know it; the
    same pattern as `readDecisionCard`). Recorded as an open point.
- After LD1/LD2 `O/check-area.sh d 2` (14:40–14:47): delta 2 files (+? see `O/chk-d2-delta.stat.txt`), frozen ok,
  status 93 same, typecheck / architecture / build 0, **named 131 with real bwrap: 131 / 3,819 passed** (no frozen
  test depends on the supplementary pins being fingerprinted). Full patch sha256 c6b62443…. No test drives a retry
  of `conflict_wait`/`conflict_order` (DSH and Codex both note the coverage gap).

## Area A — queue history and read model (copy s5a)

- DSH run `slices-s5a-areaa` (book 3ca1cf1f…): NEW Session session-3d58ab5a…, 14:08:19–14:38:36, wall 1,817 s, exit
  0, not stopped; main 1,957,910 tokens (in 56,091 / cacheRead 1,853,952 / out 47,867), 39 tool calls, 32 steps,
  peakContext 95,650. Subagents 4 (A-1, A-2, 2 reviewers; implementers re-used for fixes): 40,136,006 tokens, 365
  calls, 321 steps (all 5 Sessions 42,093,916 / 404 calls). Contamination none.
- Reply `O/run-areaa/final.md`: A1–A4 done (new `enumerateClosedGoalCandidates`; explicit-Goal scope like
  `readDecisionCard`; damaged/failed reads `unavailable`, card lookup follows `nextCursor`; fixed first-listing
  window with ≤4 whole-window retries then `unavailable`, per spec line 772 instead of the brief's `incomplete`).
  Reported: last head by refKey order; independent closed candidates not enumerated; missing adapter still
  `not_found`; overflow still `ready`+`truncated`.
- Lead checks `O/check-area.sh a 1` (14:38–14:42): delta 3 files (+353/−39), in scope; frozen ok; status 93 same;
  typecheck / architecture / build 0; **named 131 with real bwrap: 131 / 3,819 passed**. Full patch sha256 dad9b175….
- Codex re-review `O/codex-a1.md` (14:39–14:47, 8 min): A1 PARTLY, A2 FIXED, A3 PARTLY, A4 PARTLY. Lead verdicts:
  - **#1 confirmed, partly fixed. Lead fix LA1:** an `accepted` chain end wins over `not_adopted` in both entrances
    (`enumerateClosedGoalCandidates` and `findCandidateProposal`); only several `not_adopted` ends of one re-acquired
    request still fall back to the deterministic refKey order (no formal chronology exists on candidate_v2; the
    card state is `closed` either way, only the shown objects/pins can differ). Remaining gap, recorded.
  - **#2 confirmed. LA2:** a source kind without an adapter is `unavailable` (named), never an absent card.
  - **#3 partly. LA3:** the closed enumeration's exhausted window answers `unavailable` (line 772), not
    `revision_conflict`. Overflow mapping to `capacity` not changed (see #4).
  - **#4 not taken in this stage:** overflow still returns `ready` with `truncated`/`countsComplete:false` instead of a
    `capacity` rejection; the 200-Goal limit is not enforced. Pre-existing slice-5 behaviour, outside the A items;
    recorded as an open point for the integration review.
  - **#5 confirmed. LA5:** independent (null-request) `accepted`/`not_adopted` candidates are their own closed
    history cards (proposal key, §3.3 line 629).
  - **#6 confirmed. LA4:** closed candidate cards carry `candidateStatus: null`.
- After LA1–LA5 `O/check-area.sh a 2` (14:49–14:53): delta 3 files (+370/−41), frozen ok, status 93 same, typecheck /
  architecture / build 0, **named 131 with real bwrap: 131 / 3,819 passed**. Full patch sha256 c914ce32…. **Area A
  accepted** with the recorded gaps (several not_adopted ends of one re-acquired request; capacity mapping).

## Area B, continued — Codex round 1 and the one follow-up round (decision 47 extra round)

- Codex re-review `O/codex-b1.md` (14:28–14:37, 10 min): B2, B3, B5, B7 FIXED; B1, B4, B6 PARTLY; 8 findings. Lead
  verification at the cited lines: #1 (paused Goal → verdict `none` in `task-failure.ts` AV-0, so the reader drops
  the card; Host budget lift invisible to the reader) confirmed; #2 (Agent adoption branch of `plan-service.ts`
  drops `acknowledgementRef`/`decisionSource`, no `decisionProof` → `incomplete`) confirmed (a slice-5 defect
  outside every area scope); #3 shortcut before modifier admission confirmed, the Run-level actor comparison not
  taken (the formal actor is `kind`+`id`; a later Run of the same Session is the same Agent); #4 the runtime tool
  re-reads the current pin, so a retried call gets `idempotency_conflict` — confirmed; #5 ready-batch omission →
  `not_found` confirmed; #6 optional `queryTaskGraph` → empty rows confirmed (latent); #7 malformed aggregate pin
  skipped confirmed (late failure only; the store codec rejects it); #8 Run-revision read before the policy decides
  (default autonomy path gets a new read) confirmed.
- Judged "wrong in substance" (user-visible: unanswerable cards, no Agent application, retries failing) → the ONE
  follow-up brief `A/Bf-brief.md` (30.7 KB ≈ 8K tokens, sha256 acdb1605…; assembled by `A/assemble-f.py` from the
  common head/tail + `A/Bf-body.md`): items F1–F8 = Codex #1, #2, #4, #3, #5, #6, #7, #8, write scope = B's files +
  `plan-service.ts` Agent branch only. Lead decisions written into it: **LB-1** a `stopped/budget_exhausted` failure
  (class + Run pin) is an automation cause (`system_requeue`) in the reader always and in the Workflow when its lift
  applies — same key; **LB-2** `recordDecisionApplication`'s fingerprint = operation+scope+sender+payload
  `{messageRef, receipt}`; the expected pin stays the first-execution CAS only (fallback if a frozen test disagreed:
  report instead); F4 keeps the `kind`+`id` actor comparison.
- DSH run `slices-s5b-areabf` (NEW Session session-91eff0d7…, same copy s5b): 14:45:25–15:10:26, wall 1,501 s,
  exit 0, not stopped; main 2,018,769 tokens (in 45,368 / cacheRead 1,927,936 / out 45,465), 41 tool calls, 37
  steps, peakContext 87,511. Subagents 6 (3 group fixers, 3 reviewers; no rework needed): 39,720,651 tokens, 469
  calls, 379 steps (the round's 7 Sessions 41,739,420 tokens / 510 calls / 416 steps, from `O/areabf.usage.jsonl`
  rows created ≥ 06:45 UTC). Contamination none.
- Reply `O/run-areabf/final.md`: F1–F8 done (F1a `pausedAutomationAction` in `state/decision-policy.ts`, LB-1
  branch in the reader; F2 forwarded and fingerprinted only when present; F3 LB-2 applied, no frozen test
  disagreed; F4 shortcut after admission; F5 also `readEncoded`; F6; F7 at `verifyDecisionObjectWorkspaces`; F8
  policy probe before the Run read). Reported: the production Agent tool `agent-runtime/whiteboard-tools.ts`
  `apply_future_plan` sends neither field (F2 not reachable end-to-end from the runtime yet; outside scope); the
  paused re-derivation duplicates chain facts; pre-existing: the Host PlanApply fingerprint always serializes null
  attribution (not byte-identical to pre-slice), `gatePerform` turns a non-ready read into "no gate",
  `decision-service.ts` `loadMessage`/`readOne` map a ready-batch omission to absence. Sandbox numbers as expected.
- Lead checks `O/check-area.sh b 2` (15:13–): delta now 8 files (+1,138/−309) incl. `plan-service.ts` (scope
  extended for the follow-up), frozen ok, status 93 same. Follow-up-only diff `O/chk-b2-followup.patch` (7 files,
  +200/−27). Full patch sha256 827afa54….
- Lead checks after the follow-up `O/check-area.sh b 2` (15:13–15:17): typecheck / architecture / build 0, **named
  131 with real bwrap: 131 / 3,819 passed**.
- Codex re-review of the follow-up `O/codex-b2.md` (15:12–15:20, 8 min; inputs: follow-up brief, round-1 brief /
  reply / review, follow-up-only diff, both-rounds diff; the follow-up reply was not copied — script slip, run tag
  `bf` instead of `f`, so Codex judged from code only): F4–F8 FIXED, F1/F2/F3 PARTLY; LB-1 and LB-2 judged correct
  (keys match; no payload collision; the first write still CASes the supplied pin). Lead verdicts:
  - **#1 paused GATE cards still vanish** (`pausedAutomationAction` returns null for gates: the row lacks the GV-5
    fix-in-progress facts) — confirmed; **remaining large gap** (needs gate facts the Task row does not carry).
  - **#2 F2 not reachable from the runtime**: `agent-runtime/whiteboard-tools.ts` `apply_future_plan` (strict schema
    ~211, forwarding ~305) sends neither attribution field — confirmed; **remaining gap** (tool schema change,
    outside every area scope; the owner side is done).
  - **#3 the runtime tool still reads the message before the owner's receipt lookup** (a read failure on a retry
    blocks the replay) — confirmed; **remaining gap** (LB-2 removed the pin-change conflict, the read order stays).
  - **#4 Host PlanApply fingerprint drift** (pre-existing slice-5 regression: absent attribution serialized as null
    keys, HEAD has none) — confirmed. **Lead fix LB3** (`O/fix-b.py`): attribution enters `applyFingerprint` only
    when present → a Host apply without it is byte-identical to the pre-slice payload.
  - **#5 `loadMessage`/`readOne` omission → absence** — confirmed. **LB6**: only the store's `missing` report is
    `not_found`/null; an unaccounted omission is `unavailable`.
  - **#6 `gatePerform` non-ready read → no gate** — real but not taken: the requeue/reverify owners enforce autonomy
    themselves (Codex confirms), and the R2 lead rule (malformed request → existing step judges) sits there.
  - **#7 foreign-Workspace message ref → `invalid`** — confirmed. **LB4**: `forbidden` (§8.2 scope row).
  - **#8 other malformed object shapes reach body storage** — real, should-fix; not taken (the store codec rejects
    them; late failure only); recorded.
  - **#9 message@0 passes the shortcut** — confirmed. **LB5**: the application pin's revision must be ≥ 1.
- After LB3–LB6 `O/check-area.sh b 3` (15:24–15:28): delta 8 files, all in the (extended) B scope, frozen ok, status
  93 same, typecheck / architecture / build 0, **named 131 with real bwrap: 131 / 3,819 passed**. Full patch
  sha256 e557258f…. **Area B accepted** with the remaining gaps below.

## Combined state (copy s5n)

- `O/mk-combined.sh` + `O/combine-b-and-full.sh`: `~/dsh-work/slices/s5n` = `mk-slice-copy.sh s5n 216e0e2b` + tag
  `slice-base` + `R/s5m-merged.patch` + the final area deltas `O/chk-a2-delta.patch`, `chk-b3-delta.patch`,
  `chk-c2-delta.patch`, `chk-d2-delta.patch` (all applied cleanly; every area file byte-identical to its area copy;
  93 status paths = the s5m list; frozen v3 ok). Combined patch `O/s5n-combined.patch` (vs 216e0e2b, binary, incl.
  untracked) sha256 48d604e40aece5832f9b0b6b203ba6f25803ccd720ce7771be4085bb79d69ae2, 93 paths.

## Remaining gaps and items not taken (for the integration decision)

Remaining (recorded, not fixed in this stage):
1. B: a paused Goal's GATE automation card still vanishes (the Task row lacks the GV-5 fix-in-progress facts);
   work-Task cards of a paused Goal are fixed (F1a).
2. B: the runtime Agent tool `apply_future_plan` (`agent-runtime/whiteboard-tools.ts`) cannot pass
   `acknowledgementRef`/`decisionSource`, so the (fixed) owner-side Agent proof is not reachable from a real Agent
   yet → an Agent adoption after the user's answer still cannot be recorded end-to-end.
3. B: `record_decision_application` (runtime tool) reads the message before the owner's receipt lookup; a read
   failure on a retry blocks the replay (the pin-change conflict itself is fixed by LB-2).
4. A: several `not_adopted` ends of one re-acquired request are chosen by refKey order (no formal chronology on
   candidate_v2); `accepted` now wins (LA1).
5. A: window overflow returns `ready` + `truncated` instead of a `capacity` rejection; the 200-Goal limit is not
   enforced (pre-existing slice-5 behaviour).
6. D: `goal-settings-service.ts` reads a Goal before its Workspace check (GoalRef has no Workspace; pre-existing).
7. B: other malformed decision object shapes (extra pin keys, empty aggregate label) are rejected only by the store
   codec after body storage (late failure, nothing persisted).
8. No frozen test covers: the driver safe point (C), conflict_wait/conflict_order retries (D), closed request
   history in the queue (A), answering an emitted automation card / paused cards (B). Fixtures for these would be
   the next Codex-written test batch (decision 46).
Not taken (lead judgement, reasons above): C #3 (start() resolves before the first advanceWork when an ordering seam
exists), C #4 (thrown ordering read = refused → arrival order), C #1 time bound on the seam itself, B round-1 #3
Run-level actor comparison, B2 #6 `gatePerform` non-ready read → no gate (owners enforce autonomy), D #4 (= item 6).

## Whole suite on the combined state, and a final combined Codex review

- **Whole suite, real bwrap, combined s5n (before the final small fixes)** `O/combine-b-and-full.sh` (lock 15:27,
  tests done 15:53; 1,698 s): typecheck 0, check:architecture 0, build 0, **266 files / 5,850 tests, all passed**
  (`O/full-s5n.txt`, `O/full-s5n-vsum.md`). Same counts as the s5m baseline (no test added/removed in this round).
- Final Codex review on the combined state `O/codex-final.md` (15:27–15:37, 10 min, read-only xhigh, clone
  `D:/cxt/s5areas-final`, inputs: all five briefs, this notes file as of 15:27, the four lead fix scripts, the whole
  round delta; prompt `O/codex-final.prompt.txt`). Verdict "do not merge yet". Lead fixes: LA2–LA5, LB3–LB6, LC1,
  LC2, LD2 OK; LA1 and LD1 flagged. LD1: different valid decisions do not collide, first-execution CAS exact,
  coordinator keeps captured pins — OK in substance. Findings and lead verdicts:
  - D1 (LA1: P1 accepted → P2 for the same request → P2 abandoned shows P1): true if a request can be re-acquired
    after adoption (adoption releases the slot). Neither rule (status precedence, refKey order) is a formal
    chronology; **remaining gap** (item 4 above, widened): needs a formal head order (e.g. the request record's head
    history) — not small.
  - D2 (settings retry still reads GoalPhase / uncaptured Goals before the owner's replay; a READ FAILURE blocks
    the replay): true; revision drift is fixed by LD1, the read order is not. **Remaining gap** (same class as B
    item 3).
  - D3, D4, D5 = remaining items 1, 2, 3 (Codex: must-fix before merge).
  - D6 (NEW, lead-verified: spec §0 L1 line 24 / line 431 say an answered init card reads `closed`/`source_resolved` once the adoption made the cause disappear; `views/decision-read-model.ts` `finalizeCard` keeps every answered card without application `answered_pending_application`. Original wording: answered missing-architecture / completion-policy cards stay pending forever after the initialization
    is adopted; spec §0 L1 says they close `source_resolved`; the read model reconstructs the saved answer and keeps
    it pending): confirmed (medium: the read model must learn that the source resolved); **recorded as a new open item** for the
    integration decision.
  - D7 (NEW: a committed `perform(requeue_task)` retried after the autonomy was switched to `every_step` gets a
    confirmation card instead of the replay; the reader cannot see that card): edge case (autonomy changed between a
    commit and its retry); **recorded**.
  - D8 (GoalPhase read failure → "not completed" in `goalTerminal`): confirmed. **Lead fix LB7** (`O/fix-final.py`):
    only an absent GoalPhase means no completion; a failure is returned.
  - D9 = remaining item 5 (capacity), Codex: must-fix before merge.
  - D10 (LD1 lets a replay succeed with a removed/duplicated/malformed supplementary pin): confirmed. **Lead fix
    LD3**: supplementary pins keep their REFS in the fingerprint (only their revisions are left out), and a
    non-integer/negative revision is refused before the replay lookup.
  - D11 (A's `readOne` maps an unaccounted omission to absence): confirmed. **Lead fix LA6** (same rule as LB6).
    `listWorkspaceGoals` skipping undecodable Goals not changed (unreachable with the validating stores).
  - D12 = remaining item 7 (Codex adds: an orphan body artifact can remain). D13 = `gatePerform` (not taken).
  - Codex agrees with the lead on: C #3, C #4 not defects; C seam timeout can wait; Run-level actor not a defect;
    D #4 acceptable for valid bound calls.
- Final small fixes applied to the area copies (`fix-final.py s5a a`, `s5b b`, `s5d d`; typecheck 0 each) and
  exported without tests: `O/chk-a3-full.patch` 2bed62b9…, `O/chk-b4-full.patch` 9dd53294…, `O/chk-d3-full.patch`
  79d7ac5f… (scope ok, frozen ok, typecheck / architecture / build 0). The same script applied to s5n, then the
  whole suite again: `O/final-full2.sh` (results below).
- **Whole suite, real bwrap, FINAL combined s5n (after LA6, LB7, LD3)** `O/final-full2.sh` (15:53:54–16:24:50; lock
  15:54; 1,971 s): every area file byte-identical to its area copy; 93 status paths = the s5m list; frozen v3 ok;
  typecheck 0, check:architecture 0, build 0, **266 files / 5,850 tests, all passed** (`O/full2-s5n.txt`,
  `O/full2-s5n-vsum.md`).
- **Final artefacts.** Combined state `~/dsh-work/slices/s5n` (base 216e0e2b, uncommitted, 93 paths).
  `O/s5n-final.patch` (vs 216e0e2b = branch code tree, binary, incl. untracked) sha256
  abac44e7f2bdc1367abb22a02583874be0917b215033ae2ce14fb0251610da3f, 93 paths (`O/s5n-final.name-status.txt`);
  this round alone vs the s5m state: `O/s5n-final-round-delta.patch` (14 files, +1,803/−456,
  `O/s5n-final-round-delta.stat.txt`). Area copies s5a/s5b/s5c/s5d hold the same final files (A `chk-a3`,
  B `chk-b4`, C `chk-c2`, D `chk-d3`). Real worktree untouched (status clean, HEAD 67dfee7a); nothing committed.

## Final list of open items (for the integration decision; Codex's final review calls 1–5 and 9 must-fix)

1. B: paused GATE automation cards vanish (Task row lacks GV-5 fix-in-progress facts). Large.
2. B: runtime `apply_future_plan` cannot pass attribution → a real Agent adoption cannot be recorded end-to-end
   (owner side done). Tool-schema change in `agent-runtime/whiteboard-tools.ts`.
3. B/D: retries read current facts before the original receipt (runtime `record_decision_application` reads the
   message; `resolveDecision` reads GoalPhase / uncaptured Goals): pin drift is fixed (LB-2, LD1/LD3), but a READ
   FAILURE on a retry still blocks the replay.
4. A: the closed request history head has no formal chronology (refKey order; `accepted` preferred) — wrong after
   abandon/re-acquire sequences.
5. A: capacity overflow → `ready`+`truncated` instead of `capacity`; 200-Goal limit unenforced (pre-existing).
6. A (new, verified): answered missing-architecture / completion-policy cards stay `answered_pending_application`
   after the initialization is adopted; spec §0 L1 (lines 24, 431) says `closed`/`source_resolved`.
7. B (new, edge): a committed `perform(requeue_task)` retried after switching to `every_step` gets a card instead of
   its replay.
8. Should-fix, recorded: malformed decision object shapes fail after body storage (orphan body artifact);
   `gatePerform` non-ready read → no gate; Goal read before Workspace check in the settings owner.
9. No frozen test covers C's safe point, D's wait/order retries, A's closed history, B's answering of emitted /
   paused automation cards — fixtures needed (decision 46: Codex writes, lead freezes).

## Measurements (decisions 43, 46)

| run | wall | main tokens / calls / steps / peakContext | subagents (n, tokens, calls) |
| --- | --- | --- | --- |
| DSH A `slices-s5a-areaa` | 1,817 s | 1,957,910 / 39 / 32 / 95,650 | 4, 40,136,006, 365 |
| DSH B `slices-s5b-areab` | 3,100 s | 2,531,966 / 41 / 31 / 124,833 | 9, 76,365,488, 852 |
| DSH B follow-up `slices-s5b-areabf` | 1,501 s | 2,018,769 / 41 / 37 / 87,511 | 6, 39,720,651, 469 |
| DSH C `slices-s5c-areac` | 1,884 s | 868,803 / 26 / 22 / 64,349 | 3, 10,514,033, 144 |
| DSH D `slices-s5d-aread` | 3,230 s | 1,502,960 / 30 / 26 / 103,495 | 5, 17,903,026, 256 |
| DSH total | 11,532 s (B, C, D, A overlapped: 13:35–15:10) | 8,880,408 main | 27 subagents, 184,639,204 tokens; all Sessions 193,519,612 |

Codex (all read-only, xhigh, new clones under `D:/cxt/`): C review 6.4 min (14:09–14:15), B review 9.7 min
(14:28–14:37), D review 7 min (14:30–14:37), A review 8.2 min (14:39–14:47), B follow-up review 8.3 min
(15:12–15:20), final combined review 10 min (15:27–15:37) — 6 runs, ≈ 50 min, all re-reviews (no fixtures written).

Lead (this stage): 13:33 → 16:27 ≈ 174 min wall, ≈ 115 tool calls. Waiting (DSH / Codex / test runs, listed
separately; overlapped with work): area named runs 7 × ≈ 3–4 min, two whole-suite runs 26 + 31 min, DSH ≈ 95 min
(13:35–15:10) of which ≈ 40 min pure waiting; working ≈ 90–100 min (copies, scripts, 4 + 1 + 1 Codex prompts,
verifying ≈ 45 review findings at the cited lines, the follow-up brief, 16 lead fixes LA1–LA6, LB3–LB7, LC1–LC2,
LD1–LD3, notes).
