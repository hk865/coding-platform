# Report — reading `.dsh-ref/s2c-impl.md` and slice 2C spec against `dbf379d`

## 1. Unclear

1.1 **[Book §6, Group M]** M is assigned the 8 L4 index registrations, `line-pin-machine.ts`, `line-settings-codecs.ts`, `record-codecs.ts`, and the `state-writes` edits — but its rows are only 2C-01/02/38 (pure functions). No row in M exercises that production. Assume: M writes it speculatively for L's rows, which contradicts book §5.1 ("one row → one failing test → minimal code"). Needs an explicit decision.

1.2 **[Book §6, Group D]** "If it needs a line fact from group L's reader, it uses the exported type from M's `state/line-status.ts`." A type cannot assemble `LineFactsV1`. Spec §3.12/2C-30 require `TaskHoverV1.owners` to be byte-identical to `lines/list`. Assume D calls L's `WorkLineReadPort.listWorkLines` (re-reading all active lines per hover) or L must export an assembly seam. Neither is stated.

1.3 **[Book §6, Group C / spec 2C-08]** "用登记了新索引的定义重开". Which index? If it must be one of M's 8, C cannot run in Wave 1. Assume the test may register a local index via `RecordBackendSchemas`.

1.4 **[Book §2]** "§0.3 L1–L23" — the spec's §0.3 has binding **L24** (starting counts as working; unknown counts as standby). Assume L24 is included.

1.5 **[Spec 2C-37, Group L]** Spec says "夹具要选一个职责解析为执行者、又能跑 Query 的角色；造不出时停下报 lead." The book drops this instruction. Assume stop/report if no such role exists.

1.6 **[Spec §7, Group K2 2C-40]** No construction path is given for "门的产出执行在 Session P、负责关系在 Session G". Assume the KE3 harness can build it; flag if not.

## 2. Contradictions

2.1 **[Spec §0.2 line 81 vs code/book §1]** §0.2 says the "自动维护、接续" block is "K 片 A 合入以后的样子…**今天的代码还没有 KA1**". On this base KA1 **is merged**: `src/business/workflow/session-maintenance.ts:598-605` (KA1 call), `tryCloseDanglingTurn` `:436-468`; book §1/§2 says K part A is in. The "not yet" note is stale.

2.2 **[Spec §0.2 lines 65–66, internal]** `session.ts:58-64` is cited for `unavailableSince` and `session.ts:58` for `SessionWorkLink`. Actual: `unavailableSince` is `src/contracts/core/session.ts:64`; `SessionWorkLink` is `:66`. One line is claimed for two types.

2.3 **[Spec §0.2 maintenance cites vs code]** All ~90 lines low: spec `:505-540`/`:527-529`/`:110-111`/`:379-389`/`:533-537`/`:174-190`/`:434`/`:447-458`; actual today's logic `:594-624`, `openResponsibleLinks :117-119`, `platformCleanInterruption :395-405`, closure read `:583`, backfill `:526-537`.

2.4 **[Spec §2 line 582 vs §15]** The constant comment says read budget is measured "冻结前" by lead; §15 moves it to acceptance. Book A2 follows §15; §15 supersedes, but a literal reader of §2 will stop.

2.5 **[Spec §0.2 line refs vs code, symbol-level facts hold]** `session-record-codecs.ts` registrations `:947-963` (spec :926-941); `lookup-index.ts resolvePath :349-360` (spec :171-183); `encodeLookupValues :363-372` (spec :185-193); `sqlite-record-store.ts :86-130` (spec :81-116); `state/session-anomaly.ts deriveTaskArchiveState :75-90` (spec :54-90); `decision-read-model.ts` objects `:828/:845` (spec :859/:876); `query-execution.ts sessionGeneration :993` (spec :958); `create-platform.ts` stub `:671` (spec :660), context extensions `:788-789` (spec :773), owner table `:1476-1479` (spec :1450-1453).

2.6 **[Book §2 vs spec]** Book says "§0.3 L1–L23" (see 1.4).

## 3. Cannot build as written

3.1 **[Spec §0.2 line 81 — the requested no-longer-holds fact]** "今天的代码还没有 KA1" is false at `src/business/workflow/session-maintenance.ts:598-605`. The builder must read the merged code, not treat KA1 as future work.

3.2 **[Spec §2 `WorkLineReadPort`, entries LE3/LE6]** The port has no method returning `LineBriefV1`/`LineStatusV1` for a `SessionRef`. Spec §2/§3.12 + 2C-10/2C-30 require hover `owners` to equal `lines/list` field-for-field. D cannot reach that through the agreed interface without re-running `listWorkLines`; no seam is defined.

3.3 **[Book §6 Groups C+M, Wave 1]** If 2C-08 needs one of L4's ordered indexes, C cannot be built beside M in Wave 1 (see 2.1.3/1.3).

3.4 **[Spec 2C-37]** The executor-and-Query role is unverified; the spec itself says stop and report. The book gives no contingency.

3.5 **[Spec 2C-25]** It claims to cross `findSessions`' 1,000-candidate and 2,000-link limits, but the new reader never calls `findSessions`; as written it can only assert results ("只断言公开的结果"), so this is not a failure, but the two limits are not actually exercised by the code under test.

3.6 **[Spec 2C-08]** `9007199254740993` cannot be represented exactly in JS; the fixture must be written at the storage boundary. 2A QA-15 presumably solved it, but no reference is given.

## 4. Missing

4.1 **[Book §6 claim "section 6 names the owner of every shared file"]** It does not. Unnamed: `tests/helpers/S2C-*-fixture.ts` — the D1 set (2C-14) reused by W's 2C-31; storage wrappers (2C-12/14/18/29/36); executed-files injections (2C-27/30); injected clock/numbering (2C-18/33); gate scenario (2C-40); `not_entered` Query (2C-41); archive scenarios (2C-05/24/32). Two groups can collide on a helper name.

4.2 **[Book §6 Wave 3, K1/K2]** The KE3 framework is `tests/scenarios/harness.ts` (`openHostScenario :1026`, `restart() :930`) plus `tests/scenarios/support/common.ts`; K1 and K2 run together and both will likely extend it. No owner is named.

4.3 **[Book §4 L-fixtures]** Only `S2C_SCALE_TIMEOUT_MS` is named. LE4 Host-restart tests have no stated timeout.

4.4 **[Book §5.3 third row / `production-reach.test.ts`]** Reasons allowed are `step5|step6|pre-batch|wire-format|kept-for`; substeps 5.1–5.10 are **closed** (`:36`), so step5/6 cannot be used. Which reason the slice-5 `WORKSPACE_NOTICE_SEEN_CHANGED_SCHEMA_ID` entry uses is not given.

4.5 **[Spec §2, L1b]** `RecordCountPort` exists nowhere (grep = 0) and must be created. The distinct-count SQL (L3 line 263) has no worked example; the two backends must agree.

4.6 **[Spec §2 lines 590-591]** The counting wrapper's home, exported type, and the exact port it decorates (`readMany`/`lookup`/`lookupOrdered`/`eventAt`/`countLookup`) are unspecified.

## 5. Size (book §6)

- **C (LE2):** small–medium — one port, two stores, typed SQLite DISTINCT count.
- **M (LE1):** **large** — `contracts/work-line.ts` (30+ DTOs), `state/line-status.ts` (T0–T9, AT1–AT4, B1–B4, A1–A3, controls via `controlSubmissionProblem`/`taskRequeueStateProblem`, DE truth table, sort key, `cardLineKeys`), pin machine, codecs, record-codecs, 8 indexes; only 3 pure rows test it.
- **L (LE3):** **large** — reader with the 17-row L1 read table, budget wrapper + ordering, pins service, 16 rows + fixtures.
- **D (LE6):** medium–large — hover + detail readers, executed-files mapping, 4 rows.
- **W (LE7):** **large** — composition wiring (record/event, 4 owner groups), `work-line-conversation.ts`, 7 routes, HTTP types, labels; 1 row, big integration surface.
- **K1 (LE4):** **large** — 7 rows, Host restart / missing / damaged / maintenance / archive-interruption / RUN-24 / goal pause.
- **K2 (LE4):** **large** — 7 rows, conversation, controls/attest, overlaps, per-task continue, gate checks, `not_entered`.
- **X (LE5):** medium code, **large fixture/runtime** — 5,000 Sessions, 2,100-link and 2,500-message lines, 3,000-run task, 2 backends, 1,800 s.
- **Wave 4:** medium.

## 6. Grouping

The overall direction (interfaces → readers → routes → scenarios/scale) is sound, but two concrete defects.

- **Two groups of one wave sharing an interface:** Wave 2 L and D are not disjoint — D's `owners` must be L's output (3.2), and both need unnamed `tests/helpers/S2C-*` fixtures (4.1). Wave 3 K1 and K2 both need `tests/scenarios/harness.ts` / `support/common.ts` (4.2).
- **Needs another group's result before the book lets it start:** D needs L's assembly seam, yet both start in Wave 2; K2 needs the harness K1 will extend. W's 2C-31 does reuse L's D1 fixture — Wave 3 after Wave 2 handles that one.
- **Cut I would use:** keep C in Wave 1; label M an "interfaces-only" group (or move the pin machine/codecs/record-codecs rows 2C-07/2C-19 into the wave that owns M's files); have L export `readLineBriefs(...)`, or merge D into L; in Wave 3 give `harness.ts`+`support/common.ts` to K1 and let K2 only import, with X's scale fixture in its own `tests/helpers/S2C-scale-fixture.ts`.

**Word count: ~1,430.**

`git status --short` printed nothing (0 lines). No files were changed.