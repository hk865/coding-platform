# Task: slice 4A round 2 — fix the review findings; test-driven

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session: you have not seen
this copy before. Everything you need is in this message and in files of this copy. The spec is frozen; do not make
design decisions. Where the spec, the round-1 book and this message do not determine something, do not invent
behaviour: list it under UNSPECIFIED in your reply.

**This run is headless. When your turn ends, the whole run ends, and every subagent that is still running is killed.**
- After starting subagents, stay in your turn until every one of them has finished and reported.
- Wait with a blocking shell command (`sleep 300`), then check with `list_agents`; repeat.
- End your turn only after the checks of section 8 and the reply of section 9.

**Work with subagents; keep your own context small.** Do not read the spec, the code or the tests yourself beyond what
you need to coordinate; use `grep -n` and `sed -n a,bp`, never whole large files. **One building subagent at a time**
(the groups below all touch `notes/note-service.ts`); a read-only reviewer of the previous group may run alongside, so at
most 2 subagents at once. Each building subagent's message contains sections 1–5 of this message verbatim, its own group
block of section 7 verbatim, the full text of every item its group names (section 6), and: read
`./.dsh-ref/tdd/SKILL.md`, `tests.md`, `mocking.md`; read the spec sections its items cite, always including §0.3 L1–L8,
L2a, L18 and §8; work test-first (each new or changed assertion must be seen RED for the right reason before the fix);
run `npm run typecheck` and the S4A test files only; reply with FILES, per item the test name(s), the implementation
file:symbol, the RED/GREEN log, and UNSPECIFIED items (short).

## 1. What this copy is

- **HEAD** is the local commit "lead: 4A round 1 (DSH s4a-impl), kept as the round-2 base". It holds round 1's 20
  files on top of `slice-base` (`DSH-BASELINE.md`) and `slice-setup` (the lead's commit e8b3edae). Slice 2C is not in
  this copy; 4A does not need it (the lead merges the shared registration file `src/composition/create-platform.ts`).
  `git diff HEAD` shows your work of this round.
- **Round 1** built rows N-01–N-22 (report: `./.dsh-ref/final-1.md`). A full implementation review by a second model
  (`./.dsh-ref/s4a-implrev.out.md`) found 15 must-fix items, 3 should-fix items and answered four open points; each was
  then checked against the spec and the code (section 6 carries the checked findings, the fixes and the tests). The
  verdict was "not ready".
- **The round-1 book** `./.dsh-ref/s4a-impl.md` still binds (its sections 3–5 and the answers P1–P14 of its section 6),
  except where section 4 or 5 of this message amends it.
- **The TDD skill** is in `./.dsh-ref/tdd/`. This sandbox has no bubblewrap; `DSH-BASELINE.md` lists what fails here
  only for that reason. 4A needs no real sandbox.
- **Environment:** `vendor/coding-agent/node_modules` now holds the right `zod` and `openai` (the lead copied them;
  round 1's symlinks in `node_modules/` were removed). `npm run typecheck` is clean at HEAD. Do not change
  `node_modules`.

## 2. Where the rules are

The frozen spec `docs/refactor/design/orchestration-2026-10/slices/slice-4-SPEC.md` (Chinese prose, English
identifiers): §0.2, §0.3 **L1–L8, L2a, L14 (the write side: basis and `symbolRequest`), L18** (binding), §0.4, §1.1 (4A),
§2 (names and signatures bind), §3 (S4-NOTE-*), §4, §5.1 NE1, §5.2 N-01–N-22, §5.3, §6 (the 4A line), §7, §8. L9–L13,
L15–L17, L19–L23 belong to 4B/4C: do not build them. Repository rules: `AGENTS.md` (state writes only through
`src/core/work-graph/state/`, rule 9).

## 3. Frozen files (never change them, not even temporarily)

`DSH-BASELINE.md`, the spec, and every test file that existed before round 1, except the A2 edit of round 1
(`tests/architecture/state-writes.test.ts`). Round 1's own `S4A-*` tests and `tests/helpers/S4A-*` fixtures **may**
change where an item below says so. Throw-away probes go under `./.dsh-scratch/` and are deleted at the end.

## 4. Amendments to the round-1 book (lead, binding)

- **L-scope** (adds to round 1): a new file `src/core/work-graph/notes/note-anchor-facts.ts` (item 7's narrow reader);
  new test files `tests/work-graph/S4A-note-symbol.test.ts` (item 14) and `S4A-note-failures.test.ts` (item 3);
  a new helper `tests/helpers/S4A-note-fault-fixture.ts` (the read-fault double below). Still no RecordStore file, no
  `vendor/`, no other `docs/` file.
- **L-reach** (amends round 1): `tests/architecture/production-reach-allowlist.json` may hold exactly ONE group of
  entries, `kept-for` "slice 4 of the orchestration design": `renderNoteHeader` with `NOTE_KIND_LABELS` and
  `noteAnchorDisplay` (N-16 tests the header; its readers are 4B `NoteSimilarV1.header` and 4C). Folding the two helpers
  into the function so that one entry remains is fine. Remove the `MEMORY_PAGE_DEFAULT` entry and the export itself
  (4B adds it with its first reader). `NOTE_SYMBOL_HITS_MAX` is reached by item 14's production code: remove its entry.
- **L-fixtures / spec §7 exceptions** (amends round 1; every fact still comes from real public services):
  1. the existing interleaved-commit gate (N-07, N-14) may also drive N-08's commit-time pointer conflict (item 1);
     the gate only orders commits — it never fabricates Run, duty, plan or Session facts (item 15d);
  2. a read-fault double (`S4A-note-fault-fixture.ts`) may make reads FAIL: at the storage boundary (`lookup`,
     `readMany`) and on the two scope-fact ports (`findSessions`, `readArchitectureRevision`). It only injects
     failures for item 3's tests; the caller is a host user, so no Run or duty fact is made up.
- **Scribe duty in tests** (round-1 UNSPECIFIED 4): no injected `sessionDutyResolver` anywhere. Scribes and executors
  are built so that the production resolver recognizes them (item 15c).

## 5. Lead rulings on the spec's silent points (binding; recorded later as post-notes in the spec)

- **R1 (item 2).** An id listed in both `replaces` and `coexistWith`: follow S4-NOTE-08 — it is not superseded.
- **R2 (item 3).** A file anchor whose read is `forbidden` (live or `deleted: true`): `{ code: 'invalid', reason:
  'anchor_forbidden', field }`, no candidates.
- **R3 (item 4).** No internal cap in 4A: gate counts and listings read an anchor key or a goal to the end. If any page
  fails, the answer is `unavailable`, never a smaller number or a shorter list.
- **R4 (item 5).** Replay identity = (operation, projectId, workspaceId, the trusted principal, commandId). Replay is
  resolved before any mutable read and returns the first result exactly. P9 amended: in a write commit the new note's
  `NoteWritten` is the LAST event and carries the success result (`overQuota`, `warnings`, `existingTopics` as first
  returned); in a disposition commit the subject's `NoteDispositionChanged` is already last. If the event cannot be read
  back, the replay answers `unavailable`, never a rebuilt receipt. Same `commandId` with a different request (store
  `idempotency_conflict`) → `{ code: 'invalid', reason: 'idempotency_conflict' }`.
- **R5 (item 6).** L14 literally: an agent's basis = the Run's bound plan (`RunSnapshot.planRef`) and that plan's
  architecture baseline revision (`catalogRevision` null when there is no catalog record at it); a user's basis = the
  goal's current accepted plan and the current active catalog revision. `basis.planRevision` is the plan of the note's
  goal; a stage anchor in a goal other than the agent's Run goal (scribes only) uses that goal's current accepted plan.
  An agent's stage must exist in both the bound plan and the current plan, else `anchor_not_found`.
- **R6 (item 8).** Each quota counts its own population (L7): the anchor quota gates and flags only general-kind items
  in `accepted`/`reviewed`; the goal quota gates and flags every kind in the four counted states. Replacement
  subtraction stays (L7, §4.10: "replaces 命中的现行项"), with the targets computed by item 2's rule. The write result's
  `overQuota` equals what `readNote` reports right after the commit.
- **R7 (items 9b, 9c).** The author of a note is its `source.sessionRef` (a later Run of the same Session may withdraw
  it; a handover successor is not the author — slice 7). Accepting or rejecting a PENDING note needs a non-empty
  `reason` (L6 "要原因"); `review` and `withdraw` keep it optional.
- **R8 (item 10).** P1's zero rule holds: the per-scope count is 0 when no Session holds exactly that scope; a failed
  Session, duty, catalog or lookup read gives `unavailable`, never 0. The root prefix `"."` is NOT changed in 4A
  (slice 8A, the lead adds a post-note there).
- **R9 (item 13).** The write and the codec check only a fact's SHAPE (known kind, field types). Semantic formats
  (SHA length or case, digest hex, path inside the workspace, note existence) are 4B's check; an empty SHA string is
  type-valid. P8's `uncheckedFacts` lists every supplied fact index; no 4A test asserts it.
- **R10 (item 14).** Write-side `symbolRequest` resolution is 4A (spec §0.1, §6). Its writer half is tested at NE1 in
  `S4A-note-symbol.test.ts`, test names starting `G-01(4A)`; 4C's G-01 re-runs it through `record_note`. Language must
  be `'typescript' | 'python' | 'cpp'`, anything else is unsupported → warning `symbol_unresolved`. If the symbol scan
  stops at `NOTE_SYMBOL_HITS_MAX` with more pages, never store a locator (0 or 1 match → `symbol_unresolved`, 2 or more →
  `symbol_ambiguous`). Capture or query failure (`unavailable`, `capacity`, `cancelled`, `capture_expired`,
  `source_stale`) → the write is rejected `unavailable` with the draft; `unsupported` → warning. Each warning code at
  most once.
- **R11 (d11).** The project-level slot of the review index is the stored `goalId: null`; readers query it with null
  (4C's pending count too). No new field.
- **R12 (item 3, flag).** The frozen wiring-1 duty resolver maps a failed RoleSpec read to `'unknown'`; 4A does not
  change it (P5: one resolver). Do not work around it; it is recorded as a 7D1 item.
- **R13 (the optional choices inside section 6, decided).**
  - The interleave gate IS extended to N-08 (section 4, exception 1): build item 1's test (2) and item 5's
    concurrent-replay case on it.
  - The read-fault double of section 4 MAY also make the workspace `captureSourceChanges` / `querySource` calls fail
    (failures only), for ONE item-14 test: a capture failure rejects the write `unavailable` with the draft.
  - No test that records `PreparedCommit.events` (item 11 (b), distinct eventIds): fix it in code only; the next review
    checks it by reading the code. Skip the "optional, if the lead allows" PreparedCommit case.
  - Where an item says "test them only if the lead accepts that cost", do not add those tests.
  - Item 1's side note (L8 prose vs §2 `pointer` type): §2 binds — the returned pointer is `{ noteId, revision }`.

## 6. The items (checked findings; the fix and the tests are binding unless section 5 says otherwise)

Each item: what is wrong (with the code and spec facts found when it was checked), the ruling, the fix, and the tests. Line numbers are round 1's; find the symbol if a line moved. Where an item mentions "the lead may" or "if the lead wants", section 4 or 5 has decided it; where it offers two ways, take the first unless section 5 says otherwise.

### Item 15c — No injected duty resolver: real scribes and executors

**Found (confirmed).** tests/helpers/S4A-note-fixture.ts:90 and :111-118 inject `sessionDutyResolver`: a test double keyed by Run id that answers 'scribe' for marked Runs and 'executor' for everything else (markScribe :228). All W1 Sessions use legacy template builder@1 (:193) with binding templateId 'builder' (:84). The production createSessionDutyResolver (src/composition/session-duty.ts:76-84) resolves builder@1 to 'unknown'. So every W1 agent write and scribe review runs on a fabricated trusted fact, and the real Session-role to duty path (P5's shared instance) is never exercised in N-01..N-13. Governing text: book P4 (scribe = real Session of duty scribe + claim + real Run), P5 (one shared production resolver), L-fixtures (the only double is the N-07/N-14 commit interleave, spec §7).

**Ruling.** Remove the duty double. W1 must build scribes and executors the way the G scope fixture already does: a legacy platform template that the production resolver recognizes (session-duty.ts:35-42), or a RoleSpec with platformDuty.

**Fix.** S4A-note-fixture.ts: delete the `sessionDutyResolver` option, `scribeRuns` and `markScribe`. createSession(requestId, role) uses role {kind:'legacy_template',templateId:'platform-<executor|scribe>',templateRevision:'s3.1'}. claimRun(suffix, taskId, role) uses a binding with that templateId/'s3.1'. Claims require assignment role == binding templateId == Session templateId (claim-service.ts:671, :1072). So the plan has t1 and t2 assigned 'platform-executor' and a new t3 in s1 assigned 'platform-scribe'. Every `claimRun(x,'t2')` followed by `markScribe` becomes `claimRun(x,'t3','scribe')`: write.test.ts:261/354/378/397 and history.test.ts:47/68. Executor claims of t2 (n08-b, n09-other) stay. workCtx uses the claim's binding.

**Tests.** No new rows. Every existing N-01..N-13 test must pass unchanged on both backends with the production resolver. Conflict: once Codex #9 (a reason is required for pending accept/reject) lands, S4A-note-write.test.ts:380-381 and the user accept at :421-422 must pass a non-null reason; N-10 quota/structural expectations stay the same.

### Item 15d — The interleave fixture keeps only its commit gate

**Found (confirmed).** tests/helpers/S4A-note-interleave-fixture.ts:47 builds a raw backend holding only NOTE_RECORD_SCHEMAS. :66-72 fabricates runFacts (goal, sessionRef, role) for Runs that do not exist, plus duty 'executor'. :73-89 wires plans/workspace as throwing stubs and builds the note service directly, bypassing createTargetPlatform. S4A-note-concurrency.test.ts uses memory only and a project anchor. Governing text: spec §7 ('例外只有：N-07/N-14 的存储边界交错提交替身'), book L-fixtures, NE1 ('两个后端'). A public-composition precedent exists: WP2-platform-support.ts:429-434 spies createInMemoryRecordBackend/createSqliteRecordBackend and wraps records.commit inside the real createTargetPlatform; R4-control-platform.test.ts:24-37 does the same with vi.mock.

**Ruling.** Keep only the commit gate. Everything else comes from the real platform and public setup, on both backends.

**Fix.** Rewrite S4A-note-interleave-fixture.ts. Install vi.spyOn on both backend factories (WP2 pattern) so they return the real backend with records.commit wrapped by the gate, call createS4ANoteFixture (after 15c) while the spy is active, then restore the spies. The gate holds only PreparedCommits whose events include eventType 'NoteWritten'. The first arrival waits for the second, and a write that settles without reaching commit must release the gate (no deadlock). Callers are two real executor Runs (claim t1, claim t2) in s4a-goal. Delete the fabricated runFacts/duties/plans stubs and the direct createNoteService/createNoteReadModel construction.

**Tests.** S4A-note-concurrency.test.ts with it.each(['memory','sqlite']). N-07: caller A writes 4 accepted general notes on {kind:'file',path:'src/a/x.ts'} (topics n07-1..4, default anchor quota 5). Interleave n07-5 (A) and n07-6 (B): both {status:'accepted'}, and readNote of each gives overQuota true. N-14: interleave two writes with topic 'same topic' on src/a/x.ts and no relations: both {status:'accepted'}, and readNote of each gives conflicting true. A sequential control in the same test: a third relation-free 'same topic' write gets {status:'rejected',code:'invalid',reason:'same_topic_unresolved'}, which proves the gate is what admitted both.

### Item 12a — Validate the whole input shape before dereferencing

**Found (confirmed).** `draftProblem` (note-service.ts:246-279) checks topic, conclusion and body/sections, and only `Array.isArray` for facts, basisFiles and extraAnchors. It never checks:
- that `kind` is one of the 8 kinds (an unknown kind passes as a general note);
- that `anchor` is present and well typed, or what the extraAnchors elements are;
- that `structural` is a boolean;
- the `replaces`, `contradicts` and `coexistWith` arrays;
- the input `goalId` or `expectedPointerRevision`.

Resulting crashes and gaps:
- :341 `draft.anchor.kind` throws when an understanding has no anchor;
- :367-368 `'goalId' in draftAnchor` throws on a missing or primitive anchor;
- :412 spreading a missing `replaces` throws;
- note-anchors.ts:271 and :353 `draft.kind` throw on undefined;
- note-anchors.ts:355-365 `moduleId.length` throws when the id is missing and lets a numeric id through.

Spec: L4.1 "字段类型严格；种类八种". L2a class 1 "种类不认识、缺字段 … 退回 invalid". L4 "不合格的一律退回，不写任何记录，回执里原样带回提交的草稿". L4 order "1 格式 → 2 锚点和来源". L2a "第 1–3 类 … 按表的先后核".

**Ruling.** Run one complete class-1 shape gate on the whole `WriteNoteInput` before anything is dereferenced or read, then the caller (source), then class 2, then class 3. Every failure is code `invalid` with the draft returned, never a throw. The spec is silent on unknown extra keys, so add no rule for them. Conflicts and dependencies:
- Moving the own-goal check (:363-372) after class 2 depends on Codex must-fix 7's narrowly authorized anchor-facts reader. Until that exists, keep the check where it is, but after the shape gate; otherwise N-20 would get the plan service's forbidden reason instead of `anchor_out_of_goal`.
- Fact element shape follows must-fix 13 (pointer shape only).
- The `symbolRequest` shape follows §2 `SymbolRequestV1` once must-fix 14 lands.

**Fix.** note-service.ts: replace `draftProblem` with `writeInputProblem(input)` and call it first in `writeNote`, before `resolveCaller`. It checks:
- `commandId`: non-empty string;
- `goalId`: non-empty string or null;
- `expectedPointerRevision`: null or a positive safe integer;
- `note`: an object;
- `kind`: one of the 8 kinds;
- topic, conclusion and body-or-sections as today;
- `structural`: boolean;
- `anchor` and each `extraAnchors` entry (array of at most 4): pass a draft-anchor validator;
- `facts`: array of at most 16;
- `basisFiles`: array of strings, at most 32;
- `replaces`, `contradicts`, `coexistWith`: arrays of non-empty strings.

note-anchors.ts:anchorFormatProblem: guard with `isRecord(draft)` and `typeof id === 'string' && id.length > 0` for each id field; for file anchors `isSafeRelativePath(path)` and `deleted` either absent or exactly `true`.

Order in `writeNote`: shape → resolveCaller → replay → class 2 → class 3 (understanding only on goal/stage, the 12b rule, own goal, scribe scope) → basis files → relations → same topic → quota.

**Tests.** N-01, both backends, "malformed shapes are refused invalid with the draft, never thrown". Executor ctx. Each case: `await expect(write(...)).resolves.toMatchObject({status:'rejected', code:'invalid'})`, and `.draft` toEqual the submitted input.
1. A pitfall with no `anchor`.
2. An understanding with no `anchor`.
3. `extraAnchors: ['module:A']`.
4. `replaces` missing.
5. `contradicts: 'n1'`.
6. Anchor `{kind:'module'}`.
7. Anchor `{kind:'module', moduleId: 5}`.
8. `kind: 'note'`.
9. `structural: 'yes'`.
10. A file anchor with `deleted: false`.
11. `expectedPointerRevision: '1'` on an understanding.

Cases 3, 4, 5, 8 and 9 use main anchor module A; afterwards `listByAnchor(module A)` → `items: []`. Ordering case: a query_run ctx sending case 8 → `invalid` (format before source, L4).

### Item 12b — Human goalId:null anchor restrictions and non-null goal references

**Found (confirmed).** note-service.ts:124-125 takes `input.goalId` for the user without any check. Nothing refuses goal, stage or task anchors when goalId is null. A non-null goalId is never checked to exist, yet it is stored as the note's goal and drives the goal quota (:484-495). Spec: L5 "你写的由请求带（可以为 null，表示项目级，只能挂项目、模块、接口、文件锚点）". L2a "自己的目标（第 3 类）": the secretary with a null goal "不能用目标/阶段/任务锚点", and "你能用项目里任何目标". §2 `forbidden`（…越出自己目标的锚点）.

**Ruling.** This is a class-3 check and runs after class 2. A user with goalId null and any goal, stage or task anchor (main or extra) → `forbidden`, `anchor_out_of_goal`, the same code as the secretary's null-goal rule. A non-null user goalId must name a goal in the project. If it is not found → `invalid` with a free-text reason; the spec names no reason code, so do not add one. A read failure → `unavailable`. With a non-null goalId the user may still use any goal's anchors (L2a).

**Fix.** note-service.ts:writeNote, after `resolveNoteAnchors`:
- `if (caller.isUser && input.goalId === null && resolved.anchors.some(a => a.kind==='goal' || a.kind==='stage' || a.kind==='task')) return rejectedInput(input,'forbidden','anchor_out_of_goal')`.
- `if (caller.isUser && input.goalId !== null)`, call `deps.plans.queryGoal(ctx, {aggregateType:'Goal', projectId: ctx.projectId, goalId: input.goalId})`. `not_found` → `rejectedInput(input,'invalid','the goalId names no goal in this project')`; any other non-ready result → `unavailable`.

**Tests.** N-20, both backends, host ctx.
- goalId null with task anchor `{kind:'task', goalId:'s4a-goal', taskId:'t1'}` → `{status:'rejected', code:'forbidden', reason:'anchor_out_of_goal'}`, and `listByAnchor(task anchor)` → `items: []`.
- The same refusal for `{kind:'goal', goalId:'s4a-goal'}` and for `{kind:'stage', goalId:'s4a-goal', stageId:'s1'}`.
- The same refusal for main anchor module A plus an extra task anchor, goalId null.
- The same refusal for an understanding on `{kind:'goal', goalId:'s4a-goal'}` with goalId null.
- goalId 's4a-goal' with the task anchor → `accepted`.
- goalId 'no-such-goal' with module A → `{status:'rejected', code:'invalid'}`, and `listByAnchor(module A)` → `items: []`.

### Item 3 — Read failures never become definite answers or authorize writes

**Found (confirmed).** Every site Codex cites behaves as described. I found more sites of the same kind.

Writer (note-service.ts):
- `headsByAnchorKey` at 213-224 does `if (page.status !== 'ready') continue;` at 217.
- `decodedHeads` at 180-187 silently drops heads it cannot decode.
- These empty or partial sets feed the same-topic gate (446-466), the anchor quota (477-483) and `existingTopicsOf` (309-328). `existingTopicsOf` is also re-read after the commit, at 616.
- `headsByGoalState` at 226-231 returns `[]` on a failed read, so the goal activity count at 484-495 comes out low.
- So a failed lookup admits a write that should be `same_topic_unresolved` or `pending_review`/`quota_full`.
- The old pointer target is read at 566-569 (write) and 682-683 (accept). If that read is `!ok` or `head===null`, the supersede is skipped but the pointer still moves (582-588, 696-701). The result is two current understandings. L8 requires the head, the supersede and the pointer move together: "新理解的头、版本、旧理解变 superseded、指针改指新项，全在一次提交里".

Read model (note-read-model.ts):
- `readHeadRecord`/`readVersionRecord` (42-60) turn a store failure or a damaged record into `null`, so `readNote` answers `not_found` (197, 201).
- `headsByAnchorKey`/`currentHeadsForGoal` (62-89) skip failed pages and undecodable records. As a result `listByAnchor` can say `complete:true` or `anchor_not_found`, and `conflictingOf`/`overQuotaOf` (98-137) return `false`.
- `pointerOf` (169-180) turns a failure or damage into `{noteId:null,revision:null}`. P9 reserves that value for a pointer that does not exist yet.
- `anchorExistsNow` (183-190) turns every non-ok result, including forbidden and unavailable, into `not_found`/`anchor_not_found`.

Anchors (note-anchors.ts):
- In `resolveOne` (module 383-387, interface 391-395), any non-ready `readCatalogModuleFacts` becomes `anchor_not_found`. That function returns `rejected` on a store failure (catalog-service.ts:799).
- `checkFileAnchor` at 457 treats `forbidden` as missing. A `deleted:true` anchor with any fact is then accepted (461-462), and a live anchor gets `anchor_not_found` with candidates.
- `readWorkspace` returns `forbidden` when the path is outside the read scope or the OS denies permission (workspace-read.ts:50,64; `.env` and `.git` are in WORKSPACE_DENIED_PREFIXES). It says nothing about whether the file exists.
- `checkFileAnchor` at 448 admits a file anchor when no workspace is wired.
- `missingFileCandidates` at 190 stops on a failed page and still reports `unavailable:false`.

Scope (scribe-scope.ts):
- `readCatalog` (144-152) turns a failure into `null`. Then `moduleOfAnchor` gives `null`, the managing scope becomes project (213-214) and `writeAdmission` refuses with `anchor_out_of_scope` (327-328).
- `deriveFacts` stops at 168/170 on a failed or thrown `findSessions`, leaving the scribe set partial.
- `goalIdsOf` (241) and `lookupHeads` (257) stop early, so `countCurrentNotes` returns `ready` with an undercount (309-318).
- `relationAnchorsOf` (287-291) skips heads it cannot read, which gives a narrower scope and can authorise a region scribe.
- `managingScopeOf`/`manages` (49-51) have no way to report a failure.

Governing rules:
- Spec §4 rule 2: "拒绝不写任何记录…“没有”和“没读全”分开报".
- Task book §5 rule 3: read failures and refusals are returned, never turned into success, zero or an empty result.
- L6/L8: the pointer move and the supersede happen in one commit.
- L2a class 2: the anchor must actually be absent. L11 sends a forbidden basis read to `invalid`, not to "missing".
- results.ts:12-15: an undecodable record maps to `unavailable` with its reason kept.

**Ruling.** Confirmed in full; the spec governs. Recommended lead rulings:

(1) Spec gap: the reason code for a file anchor whose read is `forbidden`. Recommend `{code:'invalid', reason:'anchor_forbidden', field}` for both live and `deleted:true` anchors, with no candidates. This mirrors L11's "禁止读 → invalid" for basis files. Lead adds the reason to the §2 reason list as a post-note.

(2) Test gap: §7's 4A exception list has no failure double. Amend it to allow one read-fault double for 4A. It may inject failures at the storage boundary (`lookup`/`readMany`) and at the two scope-fact ports (`findSessions`, `readArchitectureRevision`). It only injects failures; every fact still comes from real public services, and the caller is a host user, so no Run or duty facts are made up (this matches finding 15).

(3) Outside 4A's reach: the frozen wiring-1 resolver maps every read failure to `'unknown'` and never rejects (session-duty.ts:9-10). P5 forbids a second resolver. So a role_spec scribe whose RoleSpec cannot be read silently drops out of the scope facts. Record this as a 7D1 item, or amend wiring-1 I-1 if the lead wants it fixed now. P4's "'unknown' → forbidden" for the caller stays unchanged.

**Fix.** 1. Add one exported helper in an existing notes file (e.g. note-read-model.ts; do not create a new file): `readAllHeads(records, index, values) → {ok:true, heads} | {ok:false, code, reason}`.
   - Follow `next` to completion (finding 4).
   - A page that is not ready → map it with `mapStoreFailure`.
   - A record that cannot be decoded → `unavailable` ('damaged note head').
   Use it in note-service.ts `headsByAnchorKey`/`headsByGoalState`, in note-read-model.ts, and in scribe-scope.ts `lookupHeads`/`goalIdsOf` (an undecodable goal → unavailable).

2. `note-service.ts:writeNote`: any helper failure → `rejectedInput(input, code, reason)` before the commit.
   - Compute `existingTopics` from the pre-commit `currentByAnchor`, minus the heads this commit supersedes. Drop the read after the commit, so it can never come back partial.

3. Old pointer target, in `writeNote` (566) and `dispose` (682):
   - `!ok` → reject with its code.
   - `head===null` → `unavailable` ('pointer names a missing note').
   - Only a readable head that is not current (withdrawn/superseded/rejected, N-09) is skipped.

4. `resolveCaller`: a resolver result of `rejected`, or a throw → `unavailable`. A ready `'unknown'` → `forbidden`, as P4 says.

5. `note-read-model.ts`:
   - Head and version reads tell a miss apart from a failure. `readNote` returns `not_found` only on a real miss; a failure or a damaged record → `rejected unavailable`.
   - `listByAnchor` → `rejected` when the head set, the pointer read (`pointerOf`) or any `conflictingOf`/`overQuotaOf` read fails. Never hand back a partial boolean.
   - `anchorExistsNow`: only `invalid`+`anchor_not_found` maps to `not_found`; every other rejection passes through with its code.

6. `note-anchors.ts`:
   - `resolveOne` module/interface: `not_found` → `anchor_not_found` (with candidates); `rejected` → pass it through (`forbidden` stays `forbidden`, everything else is `unavailable`). If the candidate catalog read fails → `candidatesUnavailable:true`.
   - `checkFileAnchor`: `forbidden` → `invalid`/`anchor_forbidden`; only `not_found` means missing; no workspace wired → `unavailable`.
   - `missingFileCandidates`: any failed or thrown page → `{candidates:[], unavailable:true}`.

7. `scribe-scope.ts`:
   - `readCatalog` keeps `null` for "no catalog adopted", which is a real answer, and reports a read failure separately.
   - `deriveFacts` fails on a failed or thrown `findSessions`, on a catalog failure, and when `ctx.workspaceId` is undefined (→ invalid).
   - `relationAnchorsOf` fails on an unreadable or missing relation head.
   - Change `managingScopeOf` to return `Promise<ReadResult<NoteScopeV1>>` and `manages` to return `Promise<ReadResult<boolean>>`. `writeAdmission` returns its existing `'unavailable'` refusal. `countCurrentNotes` → `rejected unavailable` on any failure.
   - The callers in note-service.ts (386-389, 434-444, 642-648) return `unavailable` instead of `forbidden`: writes carry the draft, dispositions carry the noteId.

**Tests.** Fault fixture: extend the storage-boundary fixture, memory backend only.
- A real in-memory note store with an arm/disarm switch on `lookup`/`readMany`, matched by index name or by a refKey substring. When armed it returns `{status:'rejected',code:'unavailable',reason:'injected'}`.
- A real memory platform supplies `plans`, `workspace`, `sessions` and `architecture`; the last two are wrapped with the same switch.
- The caller is a host user only. Goal g1 and its plan are made through public services, with the switch off during setup.
- Use only project and goal anchors here. Module anchors cannot resolve in this fixture because the catalog is in the platform's store, not the note store.

(a) `N-04 a failed anchor lookup refuses the write`
- Write n1 {project anchor, topic 'auth'}.
- Arm `s4-note-by-anchor-0`, then write {project, topic 'auth', no relations} → `{status:'rejected',code:'unavailable'}`, and `draft` deep-equals the input.
- Disarm. `listByAnchor(project,100,null)` → item ids `[n1]`, `complete:true`. Today the second write is accepted.

(b) `N-07 a failed goal-state lookup refuses the write`
- Arm `s4-note-by-review-status`, then write {goalId g1, project anchor} → `rejected unavailable`.
- Disarm. `listByAnchor` → no new item.

(c) `N-08 an unreadable current understanding blocks the pointer move`
- Write understanding u1 on goal g1 (expectedPointerRevision null) → pointer revision 1.
- Arm readMany for refKeys containing u1. Write u2 on g1 with expectedPointerRevision 1 → `rejected unavailable`.
- Disarm. `listByAnchor(goal g1)`.pointer → `{noteId:u1,revision:1}`, and `readNote(u1).storedState` → 'accepted'. Today the pointer moves to u2 at revision 2 and u1 stays accepted.

(d) `N-08 an unreadable pointer is unavailable, not absent`
- Arm readMany for refKeys containing 'CurrentPointer'. `listByAnchor(goal g1)` → `rejected unavailable`. Today it returns ready with pointer `{null,null}`.

(e) `N-11 an unreadable head is unavailable, not not_found`
- Arm readMany for n1. `readNote({noteId:n1})` and `readNote({noteId:n1,version:1})` both → `rejected unavailable`. Today both return `not_found`.

(f) `N-02 a failed catalog read is not anchor_not_found`
- Arm all readMany. Write {anchor module 'A'} → `code 'unavailable'`. Today it returns `invalid`/`anchor_not_found`.

(g) `N-10 count unavailable` (same fixture, with sessions and catalog taken from the scope platform)
- Arm `readArchitectureRevision` → `countCurrentNotes({scope:{kind:'region',moduleId:'A1'}})` returns `rejected unavailable`. Today it returns ready with 0.
- Arm `findSessions` → the same result.

(h) `N-20 a forbidden path is never a missing file` — no double: the real scope fixture with its real workspace, memory and sqlite.
- Write a `.env` file into the workspace.
- User write {anchor project, extraAnchors [{kind:'file',path:'.env',deleted:true}], facts [{kind:'commit',sha:'a'×40}]} → `{status:'rejected',code:'invalid',reason:'anchor_forbidden'}`. Today it is accepted.
- User write {anchor {kind:'file',path:'.env'}} → the same result, with no `anchorCandidates` field. Today it gives `anchor_not_found` with candidates.
- `listByAnchor(project)` shows no new item.

The dispose old-target path, and scribe admission when scope facts fail, need a pending note from an agent or a scribe caller. Neither can be built in the fault fixture without made-up Run facts. Test them only if the lead accepts that cost; otherwise they are covered by the same fixed helper.

### Item 4 — No silent 200-record stop in lookups, counts and listings

**Found (confirmed).** - The store accepts `limit` 1..200 per page and continues through `after`/`next` (lookup-index.ts:155; lookup-ports.ts `RecordLookupRequest.after`, `RecordLookupPage.next`).
- note-service.ts reads one page of 200 and ignores `next` in `headsByAnchorKey` (216) and `headsByGoalState` (228-229). note-read-model.ts does the same in `headsByAnchorKey` (65) and `currentHeadsForGoal` (81).
- The anchor indexes are on `NoteHead` in every state (L3), so historical heads pile up. Once an anchor key has more than 200 heads in one slot, the rest are invisible to the same-topic gate (446-466), the anchor quota (478-483), `existingTopics`, `conflictingOf` and `overQuotaOf`.
- Goal quota, read side: `overQuotaOf` (134) checks `heads.length > goalQuota`. With 201 accepted notes it reads 200, so 200 > 200 is false.
- Goal quota, write side: when the quota is injected above 200, or when a projection subtracts a replaced note, the capped count gives the wrong answer at the boundary.
- `listByAnchor` (222-243) builds `all` from the capped sets and then reports `complete: next===null`. So it says `complete:true` while notes are left out.
- `after` not found → start = 0 (232-235): a cursor that names a note not on this anchor quietly restarts from the first page instead of failing.
- Governing rules: L7 counts must be exact (投影计数; 读的时候算出现行项数); L4.4 checks every current same-topic note on the anchor key; §4 rule 2 (没读全 must not be reported as complete); P9 (`complete`; cursor mismatch → `invalid`/`cursor_mismatch`). No spec text allows a cap for the write gate. L22's "只读锚点查找的第一页（有界）" applies only to 4B's similar-notes hint.

**Ruling.** Confirmed. Recommended lead rulings:
- No internal cap in 4A. Gate counts and listings read the anchor key or goal to the end.
- Performance is measured at the §7 scale benchmark (20,000 notes) at acceptance, recorded but not asserted.
- If the lead later wants a read bound, going over it must return `unavailable`. It must never return a partial answer.
- This fix shares the helper with finding 3; do both together.
- Finding 8 rewrites the same quota lines. Apply 3 and 4 first, then 8 on top; they do not conflict.

**Fix.** 1. Use finding 3's `readAllHeads` (paging until `next===null`, 200 per page; any failure → unavailable) for:
   - note-service.ts `headsByAnchorKey` and `headsByGoalState`;
   - note-read-model.ts `headsByAnchorKey` and `currentHeadsForGoal`.

2. `note-read-model.ts:listByAnchor`:
   - Sort the complete set by (`createdAt`, `noteId`).
   - An `after` noteId that is not in the set → `rejected('invalid','cursor_mismatch')`. No restart at 0.
   - `complete` is true only on the last page of the complete set.
   - Within one call, memoise the head sets by anchorKey and by goalId, so `conflictingOf`/`overQuotaOf` do not re-read the store for each item.

3. Keep scribe-scope's existing paging, but switch it to the helper so it gets the failure semantics of finding 3.

**Tests.** Use the real note fixture, both backends, no double. Platform option `noteLimits:{anchorQuota:1000, goalQuota:201}`.

Setup: the user writes 201 `convention` notes with goalId g1 (a real goal), anchor `{kind:'project'}`, topics 't001'…'t201'.
- Note #201 → `accepted`, `overQuota:false`.
- Note #202 (topic 't202') → `{status:'accepted', overQuota:true}`. Today it gives `false`.

(a) `N-07 202 accepted notes in one goal read overQuota`: `readNote(#1).overQuota` → `true`. Today it gives `false`.

(b) `N-07 listByAnchor returns every note past 200`: page `listByAnchor(project, 100)`.
- Pages hold 100, 100 and 2 items.
- `complete` is false, false, true; the last page has `next:null`.
- The union of ids equals the set of 202 written noteIds, with no duplicates.
- Today: 200 ids, with `complete:true` after page 2.

(c) `N-04 the same-topic gate sees every note past 200` (heavier; the lead may keep it memory-only):
- On a fresh fixture, write 201 notes {project, topics 't001'…'t201'}.
- Then for each topic write it again without relations → every one of the 201 returns `{status:'rejected',code:'invalid',reason:'same_topic_unresolved'}`.
- This is deterministic: today exactly one head is outside the 200 cap, so exactly one repeat is wrongly accepted.

### Item 9a — A human repair write is refused

**Found (confirmed).** state/note-machine.ts:46-51: `admitNoteWrite` returns `staged` for `kind:'repair'` before it reaches the `isUser` branch. note-service.ts:497-498 calls it with no earlier authority check, and resolveCaller (note-service.ts:120-125) admits any human host caller. So a human repair is stored as `staged` with `stagedRunKey:null`. Spec: the L5 table row for 你 says the user may write only "一般注记、当前理解". §3 S4-NOTE-03 says "（无）→ staged | agent、书记". L5 also says of the secretary: "不能写修补". §2: `forbidden`（身份…）.

**Ruling.** A human `repair` write is refused with `forbidden`: no record is written and the draft comes back. The check runs at L4 step 2 (source), after the format gate. A Session with duty `secretary` is refused the same way (L5); that case cannot be built in 4A, so list it as 第 6 片联动补验. The spec has no reason code for this, so use a free-text reason and do not invent a code.

**Fix.** state/note-machine.ts: add a pure `noteWriteAuthority(facts: { kind: NoteKind; isUser: boolean; duty: string | null })`. It returns `reject('guard_failed','forbidden','only an agent or a scribe stages a repair')` when `kind==='repair' && (isUser || duty==='secretary')`, else null. note-service.ts:writeNote: call it right after `resolveCaller`, which itself comes after the shape gate of 12a, and on refusal return `rejectedInput(input,'forbidden',detail)`. Leave `admitNoteWrite` as is; the user branch can no longer receive a repair.

**Tests.** N-13, both backends. Host ctx (human actor) calls `platform.notes.writeNote` with an otherwise valid `{kind:'repair', anchor:{kind:'module',moduleId:'A'}, …}` and goalId null → `{status:'rejected', code:'forbidden'}`, with `draft` toEqual the submitted input. `listByAnchor({anchor:{kind:'module',moduleId:'A'}, limit:100, cursor:null})` → `items: []`. The existing agent repair cases (S4A-note-history.test.ts:112, :145; S4A-note-write.test.ts:246) still give `staged`.

### Item 9b — Authorship for withdrawal is the Session

**Found (confirmed).** note-service.ts:633-638: the first gate compares `runRef.runId` (`sameAuthor`), so the author's later Run in the same Session gets `forbidden`. Meanwhile note-service.ts:641 (`authorWithdraw`), :438 and scribe-scope.ts:347-351 `sourceIsAuthorOf` decide authorship by Session (projectId + sessionId). The two rules disagree. Spec: L6 says "撤下（作者、书记、你）". L5 says "作者撤自己的注记…单列". The L14 table gives executor and adviser withdraw "有（自己的注记）". §2 `NoteSourceV1` agent = `{ sessionRef; runRef: RunRef | null }`. The spec does not define which identity makes someone the "author".

**Ruling.** The spec is silent, so this is a lead ruling, not a product question. The author is the same `source.sessionRef`. It is the only identity always present: `runRef` may be null (the secretary, per §2). A handover successor is a different Session and is not the author; the real handover belongs to slice 7 (7 片联动).

**Fix.** note-service.ts:dispose: replace the run-id comparison at lines 633-635 with `const sameAuthor = sourceIsAuthorOf(head.source, caller.source);`, and use the same boolean for `authorWithdraw` (:641). No other change.

**Tests.** N-09, both backends.
1. `createSession('n09-a')` gives Session S. Claim t1 with S → Run R1 (executor).
2. R1 writes a pitfall on module A → `accepted`, version 1.
3. Cancel R1 with `platform.controls.submitControl({input:{runRef:R1, kind:'cancel', reason:'n09'}, meta:{requestId, expected:[{ref:R1, revision}]}})`, following R4-control-platform.test.ts:73-84.
4. Claim t2 with the same S → Run R2.
5. `withdrawNote(workCtx(R2), {commandId, noteId, expectedVersion:1, reason:null})` → `{status:'done', version:2, state:'withdrawn'}`, and `readNote` gives `storedState:'withdrawn'`.

Keep the existing other-Session case → `forbidden`. If the second claim on S cannot be built through public calls, stop on this case and report why.

### Item 9c — A reason is required to accept or reject a pending note

**Found (confirmed).** note-service.ts:652-657 builds the accept/reject events without the reason, and :738-740 passes `input.reason` through unchecked. note-machine.ts:153-154: the events carry no reason, and `sharedProblem` (:192-201) never checks one. 4A's own tests depend on null reasons for accept:
- S4A-note-write.test.ts:313, :381, :422 expect success;
- :310 expects `revision_conflict`;
- S4A-note-history.test.ts:121.

Spec: L6 says "`pending_review → accepted` 或 `rejected`（要原因）"; §3 S4-NOTE-06 says "要原因".

**Ruling.** L6's "（要原因）" covers both verdicts. S4-NOTE-05's condition column lists only commit mechanics; it does not waive the reason. `review` (S4-NOTE-04) and `withdraw` (S4-NOTE-07 "—") keep `reason` optional. A null or whitespace-only reason → `invalid`, nothing written. Check it in the machine after the state check and the user-only check, so a scribe accepting a structural note still gets `forbidden`. 4C seam (note for the lead): the decision-card path must pass a reason, for example the answer text, into the same accept.

**Fix.** state/note-machine.ts: add `reason: string | null` to the `accept` and `reject` members of `NoteDispositionEventV1`. In `sharedProblem`, after the userOnly check: `if (event.reason === null || event.reason.trim().length === 0) return reject('guard_failed','invalid','accepting or rejecting a pending note requires a reason')`. note-service.ts:dispose: pass `reason` into the accept and reject events. Give the 4A tests listed in the evidence a literal reason where their point is something else; :310 must still expect `revision_conflict`.

**Tests.** N-10, both backends.
- A quota_full pending note (anchorQuota fixture), scribe `reviewNote` verdict 'accept' with reason null → `{status:'rejected', code:'invalid'}`. `readNote` still gives `storedState:'pending_review'`, version 1.
- Same with reason '   ' → `invalid`.
- Same with reason '合并后收下' → `{status:'done', state:'accepted', version:2}`.
- The user rejects a structural pending note with reason null → `invalid`; with reason '不对' → `{status:'done', state:'rejected'}`.
- A scribe `review` verdict on an accepted note with reason null still gives `done`/`reviewed` (existing case at :356).

### Item 10a — P1 zero rule and unavailable on failed scope reads

**Found (confirmed).** scribe-scope.ts:309-318: `countCurrentNotes` counts every current head whose computed scope equals the requested scope. `managingScopeOfAnchors` (:196-229) falls back to `{kind:'project'}` without checking `facts.project`, so the project count is non-zero even when no project scribe exists. Region and goal scopes with no scribe already read 0, because only `facts.regions` roots are candidates. `deriveFacts` (:160-191) and `readCatalog` (:144-152) swallow read failures. Spec: P1 says "A scope with no scribe manages nothing: its count is 0". L5 says "最后是项目范围的书记（每个项目至少一条，7D L38）".

**Ruling.** P1 binds: the count is 0 when no Session holds exactly `input.scope`. This must land together with Codex must-fix 3. Once 0 is a legal answer for "no scribe", a failed Session, duty, catalog or lookup read must return `unavailable`, never 0. Otherwise a read failure turns into a definite count.

**Fix.** scribe-scope.ts:countCurrentNotes: after `deriveFacts`, compute `const held = [...facts.scopesBySession.values()].some(list => list.some(s => sameScope(s, input.scope)))`. If `!held`, return `ready {scope, current: 0}`. Together with finding 3:
- `deriveFacts` returns a result type instead of partial facts;
- `countCurrentNotes` returns `{status:'rejected', code:'unavailable'}` when any of these fail: a `findSessions` page that is not ready or throws; the duty resolver for a listed Session; the catalog read; a goal or head lookup that is not ready;
- `writeAdmission` and `manages` refuse with `unavailable` in the same cases.

**Tests.** A new `N-10 count` case, both backends. Give the scope fixture an option that skips the project scribe S0; SA and SA1 are real Sessions with real links, as today. n1 is written by SA1; n2 by SA; n3 (FILE_A1 + FILE_B) and n4 (FILE_B) by the user (host ctx, goalId null). All four are `accepted`. Counts, all `status:'ready'`: region A1 → 1, region A → 1, project → 0, region B → 0. The existing case with S0 is unchanged (project → 2).

### Item 13 — Fact pointers: shape only at write; uncheckedFacts

**Found (confirmed).** note-record-codecs.ts:236-238: factProblem requires `/^[0-9a-f]{40}([0-9a-f]{24})?$/` for commit sha. The codec is the registered record and event `validate` (note-record-codecs.ts:574-602), applied at commit (record-codec.ts:638/737). So a write carrying a 3-character commit is refused by the store as `invalid` (mapStoreFailure, note-service.ts:83), and an uppercase 40-hex sha is refused too. The N-01 test sidesteps this with crafted lowercase hex (S4A-note-write.test.ts:50). note-read-model.ts:149 and :164 return `uncheckedFacts: []`. Governing spec: L22 '事实在核对里解析，不在写入时…commit 只看格式（40 或 64 位十六进制），永远 unchecked'; L22 '写 = 闸门、写、核对：提交前只跑格式和锚点闸门（L2a 第 1–3 类…）'; L4.1 '事实指针 ≤16（写入只存指针，解析在核对里，L22）'; M-14 '3 个字符的 commit → unresolvedFacts 有它、原因 invalid_commit_format' (this needs the write to succeed); P8 '`uncheckedFacts`: every fact index'.

**Ruling.** Must-fix. The write and codec check only the fact's shape (known kind, field types: commit.sha is a string, note.noteId a non-empty string, note.version a positive integer, file.path and digest strings). Semantic formats (sha hex length or case, digest hex, path inside the workspace, note existence or version ≤ head) belong to 4B's check. Spec silent on the empty-string sha: recommend accepting it as type-valid, and 4B reports invalid_commit_format. Per P8, no 4A test asserts uncheckedFacts.

**Fix.** note-record-codecs.ts factProblem `case 'commit'`: `typeof value['sha'] === 'string' && hasOnlyKeys(value, ['kind','sha'])`, with no regex. Export factProblem, and call it per index from note-service.ts draftProblem, so a malformed shape returns `invalid` with the draft before any store call; the gate and codec then can never disagree (ties into must-fix 12). note-read-model.ts itemOfHead/itemOfVersion: `uncheckedFacts: head.facts.map((_, index) => index)` (version.facts for the version).

**Tests.** S4A-note-write.test.ts, both backends. 'N-01 %s a commit fact is stored as a pointer without format checks': facts [{kind:'commit', sha:'abc'}] → status 'accepted'; then readNote({noteId}) → status 'ready', storedState 'accepted' (the record decodes on read). Same for sha 'A'.repeat(40). 'N-01 %s a commit fact whose sha is not a string is refused': sha 123 → {status:'rejected', code:'invalid'} with draft deep-equal to the input, and listByAnchor on its anchor → items []. No 4A assertion on uncheckedFacts (P8). M-14 in 4B proves `invalid_commit_format` and the indices.

### Item d8 — noteLimits stays; no truncation; per-population quotas

**Found (partly).** Builder UNSPECIFIED 8. `noteLimits` matches L7 ('可注入的常量'). Non-understanding expectedPointerRevision !== null → invalid follows L4.1 (strict field types). Equality lookups stop at limit 200 (note-service.ts:216, note-read-model.ts:62). overQuota is applied to every kind (note-read-model.ts:121-136). L7 restricts the anchor quota to general notes, and N-07 says a staged repair reports overQuota at '额度满时'.

**Ruling.** Accept noteLimits and the strict expectedPointerRevision. Reject the 200-row truncation: page to completion, or return 'unavailable' / complete:false, never a partial count (Codex #4). Reject universal quota application: each population per L7 (Codex #8). readNote({version}) confirmedByUser: see should-3.

**Fix.** As Codex #4 and #8. No extra work here.

**Tests.** Those of #4/#8, e.g. 201 accepted notes on one anchor read overQuota true with anchorQuota 200, through noteLimits.

### Item d9 — P1 count enumeration must be complete and failure-aware

**Found (partly).** Builder UNSPECIFIED 9. The count enumerates goals through the a2-goal-by-workspace index, plus s4-note-by-review-status per goal. Book P1 defines `current` but no enumeration mechanism. The current N-10 count test writes only agent notes, so the project-level slot (goalId null) is never exercised.

**Ruling.** The mechanism is acceptable if it is complete: it pages to the end, includes the project-level slot (goal null, or the 'project' value, see d11), and any failed page gives 'unavailable', never a smaller number. If a project can have notes of goals outside the caller's workspace, say in NOTES that the count is workspace goals plus the project-level slot. The spec is silent; this needs no product decision.

**Fix.** scribe-scope.ts countCurrentNotes: no `break` on a failed page (return unavailable), follow cursors, and query the project-level slot.

**Tests.** 'N-10 count %s' add: the user writes a note with goalId null on src/b/y.ts. countCurrentNotes(project) goes from 2 to 3.

### Item 1 — Accepting a general note must not touch the understanding pointer; a commit-time pointer conflict returns the pointer

**Found (confirmed).** src/core/work-graph/notes/note-service.ts:671-702 `dispose` enters the pointer branch on `eventKind==='accept' && (anchor.kind==='goal'||'stage')`; head.kind is never checked. When a pending general note (for example a structural pitfall on goal:g) is accepted: (a) the caller's expectedPointerRevision must match the understanding pointer (null vs 1 gives revision_conflict); (b) lines 681-695 supersede the current understanding; (c) lines 696-701 move the pointer to the pitfall, or with no pointer yet create {pitfall,1}. Commit-time CAS: writeNote 604-605 and dispose 727-731 return mapStoreFailure(revision_conflict) with no `pointer`; only the pre-checks at 509-511 and 677-679 attach it. Spec: L8 "CurrentPointer（…只有目标、阶段锚点）" is the current-understanding pointer; L6 "当前理解的取代：同一锚点上新的一版理解收下时，指针改指新项"; S4-NOTE-05 "是当前理解时同一次提交挪指针…对不上 → revision_conflict"; L8 "版本对不上 → revision_conflict，什么都不写，回执带回草稿和现在的指针"; L6/S4-NOTE-05 "卡上显示当前指针"; §2 `pointer?` on both WriteNoteResult and NoteDispositionResult.

**Ruling.** Both parts confirmed. Spec gap: what expectedPointerRevision means in reviewNote for anything other than accepting an understanding. Recommendation: it is not consulted. Do not invent a refusal; writeNote's own 'only for an understanding write' refusal at :513 stays as it is. Side note for the lead: L8's prose says the returned pointer carries 编号、版本、结论, but §2's `pointer` type is { noteId, revision }. §2 binds (L-interfaces), so no conclusion is returned; fix the L8 prose at merge.

**Fix.** note-service.ts `dispose`: change the condition to `eventKind === 'accept' && head.kind === 'understanding'` (pointerKey = anchorKeyOf(head.anchor)). Keep the anchor-kind test only if it is needed for typing; writeNote already enforces goal/stage, and AGENTS rule 4 says no checks that only tampering can reach. Add a helper `currentPointerPayload(projectId, key)` that returns {noteId, revision} from readPointer, with an absent pointer giving {null,null}. Use it in the pre-checks and also after a failed commit: in writeNote when isUnderstanding, and in dispose when accepting an understanding. If commit() returns revision_conflict, re-read and attach `pointer`. If that re-read fails, return revision_conflict WITHOUT `pointer`; never fabricate {null,null}.

**Tests.** (1) 'N-08 accepting a pending general note on a goal anchor leaves the pointer'. Case A, no understanding yet: an agent Run writes a pitfall {structural:true, anchor {kind:'goal',goalId:'s4a-goal'}} → {status:'pending_review', reasons:['structural']}. The user calls reviewNote accept (expectedVersion 1, expectedPointerRevision null) → {status:'done', state:'accepted'}. listByAnchor(goal, limit 100).pointer → {noteId:null, revision:null}; today it is {pitfallId,1}. Case B: an agent writes understanding U1 on the goal (expectedPointerRevision null) → accepted, pointer {U1,1}. The agent then writes a structural pitfall on the goal → pending. The user accepts it with expectedPointerRevision null → {status:'done', state:'accepted'}; today this is revision_conflict. readNote(U1) → storedState 'accepted', version 1; pointer {noteId:U1, revision:1}. (2) 'N-08 a commit-time pointer conflict returns the current pointer': two understanding writes on the same goal anchor, both with expectedPointerRevision null, interleaved at commit → one is {status:'accepted', noteId:X}; the other is {status:'rejected', code:'revision_conflict', pointer:{noteId:X, revision:1}, draft:<its input>}. Test (2) is only buildable if the lead extends §7's interleave exception (today N-07/N-14 only) to N-08. It also needs the gate on a store whose plan reads are real: goal anchors call queryGoal, and S4A-note-interleave-fixture.ts stubs plans with `unused`, which ties it to finding 15's fixture rework. If the lead does not extend §7, verify the commit-failure path by code review only.

### Item 2 — Replacement on acceptance, and one deduplicated set of superseded heads

**Found (confirmed).** Acceptance: note-service.ts `dispose` (623-734) never reads head.replaces. Accepting a pending note (structural, contradiction or quota_full) with replaces:[X] leaves X current. Direct write: when an accepted understanding has replaces:[U1] and U1 is the pointer target, the replacedCurrent loop (546-560) and the pointer block (563-589) each push U1's bumped head, its version, a guard and an event. The store refuses this: record-codec.ts:534 'duplicate guard' and :555 'duplicate record' make commit() fail with invalid, so writeNote returns rejected/invalid and the write cannot happen at all. This path is reached in ordinary use: the same-topic gate (note-service.ts:456) covers understandings too, so re-writing an understanding with the same topic must declare replaces:[current]. The pointer-target read failure is silently skipped (566-569, 682-683; overlaps finding 3). Spec: S4-NOTE-05 "收下的那次提交照 L6 取代 replaces 里的现行项"; L6 "新项进 pending_review 时不提前取代，等它被收下的那次提交才取代…旧项已是 rejected、withdrawn、superseded 的不动"; L8 last bullet "当前理解被新理解按普通 replaces 取代时，指针的挪法同这一条（和 L6 的取代同一次提交）"; S4-NOTE-08; P9 event order (in a disposition commit the subject's NoteDispositionChanged is last).

**Ruling.** Confirmed. The contradiction-card `supersede` half stays 4C (P7, N-06). Plain reviewNote accept is S4-NOTE-05 and belongs to 4A. One spec ambiguity to rule separately: an id listed in both replaces and coexistWith. L4.4's precedence says replacement; S4-NOTE-08 says 有 coexistWith 指向它的不取代. Until the lead rules, follow S4-NOTE-08 (skip that target).

**Fix.** note-service.ts: add one helper, e.g. `supersessionOf(ctx, subject, by, prereadHeads, pointerRead|null)`, and use it in both writeNote (when admission.state==='accepted') and dispose (verdict 'accept'). (1) Build the target set as the ordered, deduplicated union of subject.replaces and, when subject.kind==='understanding' and the pointer's noteId is neither null nor the subject's id, that noteId; exclude subject.noteId. (2) Per target: writeNote may reuse the head from its relations map; dispose must re-read at accept time. A failed read or a missing head aborts the whole command with `unavailable` and writes nothing (finding 3). A target in accepted/reviewed gets transitionNote supersede, its head and version records, a guard equal to the version that was read, and one NoteDispositionChanged event with its own eventId (finding 11). A target in any other state is skipped. (3) For an understanding, add the pointer move with the pointer-record guard and a CurrentPointerMoved event. (4) In dispose, push the subject's event last (P9). Delete the two separate loops in writeNote and the pointer-only block in dispose. Finding 8's projection must use the same target rule. Coordinate with finding 5: dispose's replay lookup has to move ahead of the version and pointer checks that this helper sits behind.

**Tests.** (a) 'N-10 accepting a pending note supersedes its current replaces targets'. The user writes pitfall G1 {topic 'r', FILE_A} → accepted. The user writes G0 {topic 'r0', FILE_A} and withdraws it (expectedVersion 1). An agent writes pitfall G2 {topic 'r', FILE_A, structural:true, replaces:[G1,G0]} → {status:'pending_review', reasons:['structural']}, and readNote(G1).storedState is 'accepted'. The user calls reviewNote accept G2 (expectedVersion 1, expectedPointerRevision null) → {status:'done', state:'accepted', version:2}. Then readNote(G1) → {storedState:'superseded', version:2}; readNote(G1,{version:2}).storedState → 'superseded'; readNote(G0) → {storedState:'withdrawn', version:2}, unchanged. Today G1 stays 'accepted'. (b) 'N-08 a new understanding that replaces the current one supersedes it once'. Run1 writes understanding U1 on {goal s4a-goal} (expectedPointerRevision null) → accepted. Run2 writes U2 {replaces:[U1]} with expectedPointerRevision 1 → status 'accepted'; today it is rejected/invalid. Then readNote(U1) → {storedState:'superseded', version:2}; readNote(U1,{version:3}) → {status:'not_found'}; listByAnchor(goal).pointer → {noteId:U2, revision:2}. (c) Same as (b), but U2 is structural → pending_review; the pointer is still {U1,1} and U1 is 'accepted'. The user accepts U2 (expectedVersion 1, expectedPointerRevision 1) → done/accepted; U1 → superseded, version 2; U1 version 3 → not_found; pointer {U2,2}.

### Item 8 — Quota populations and replacement subtraction

**Found (partly).** Population: note-service.ts:477-483 applies the anchor count to every draft kind. With 5 current general notes on goal:g, an agent's understanding gets quotaFull and goes to pending_review ['quota_full'] through note-machine.ts:55. For a repair, the write uses `count >= anchorQuota` (482), so admitNoteWrite returns overQuota true (note-machine.ts:47). The read side, note-read-model.ts:121-137 overQuotaOf, uses `count > anchorQuota` for ANY kind in ANY state. With exactly 5 general notes on the anchor, the repair's write says overQuota:true while readNote says false. Withdrawn, superseded and rejected items, and understandings, can also read overQuota. Subtraction: lines 469-476/481/491 subtract the replaces targets that are currently accepted/reviewed, whatever the admission outcome. Spec: L7 "每个锚点键上当前的一般注记（六个一般种类、状态 accepted、reviewed，不含当前理解，也不含修补）最多 5"; "目标活动计数算这四种状态"; "读到的当前计数减去这次写入会取代掉的条目（replaces 命中的现行项）"; §4 rule 10; "修补在额度满时保持 staged，读的时候报 overQuota"; N-07.

**Ruling.** Population part: confirmed. Subtraction part: refuted. L7 and §4.10 define the subtracted items as 'replaces 命中的现行项'. For a write that ends pending (structural or contradiction), S4-NOTE-05 supersedes those same targets on acceptance, so the projection equals the count after acceptance. Codex's 'only targets superseded in this commit' would add a spurious quota_full to every structural or contradicting replacement at a full anchor. Keep the subtraction, but compute the targets with finding 2's rule. Spec gap, for a lead ruling on L7 (lead-owned, not a user product decision): which quota a repair reports. Recommendation, the population rule: the anchor quota gates and flags only general-kind items in accepted/reviewed; the goal quota gates and flags every kind in the four counted states. So an agent's understanding at a full goal goes to pending ['quota_full'], and a repair is staged with overQuota true only when the goal is full. This also settles the exact-full boundary, because each item is judged against a population it belongs to. The write result's overQuota must equal what readNote reports right after the commit. Consequence: a pending general note at a full anchor reports overQuota:false with reasons ['quota_full'], which avoids double counting in L16 (pending count + overQuota anchors). Conflict: under this ruling the existing N-07 repair assertion (S4A-note-write.test.ts:245-251; anchor at 6, goal not full, expects overQuota true) is wrong and must move to a goal-full setup. The alternative (anchor flag on repairs, read with ≥ for non-members) keeps that test but contradicts '不含修补'.

**Fix.** note-service.ts writeNote: compute anchorFull only when isGeneral(draft.kind), using the existing loop and subtraction; compute goalFull for every kind when goalId is not null. note-machine.ts admitNoteWrite: replace `quotaFull` with `{ anchorFull, goalFull }`. The quota_full reason applies when either is true (agents only). overQuota = goalFull || (anchorFull && state==='accepted'); a user write is accepted, so its overQuota = anchorFull || goalFull; a repair is staged with overQuota = goalFull. note-read-model.ts overQuotaOf: the anchor part applies only when isGeneral(head.kind) and state is accepted/reviewed (count of current general notes > anchorQuota); the goal part applies only when goalId is not null and state is in {accepted, reviewed, pending_review, staged} (activity > goalQuota); otherwise false. The counts must be complete (finding 4), and a lookup failure must surface as readNote unavailable, never as overQuota:false (finding 3).

**Tests.** All under N-07. (a) 'N-07 an understanding is not held by the anchor quota': the user writes 5 general notes q-1..q-5 on {kind:'goal',goalId:'s4a-goal'} with goalId 's4a-goal' → all accepted. An agent understanding on the same anchor (expectedPointerRevision null) → {status:'accepted', reasons:[], overQuota:false}; readNote(U).overQuota → false; pointer {noteId:U, revision:1}. Today it is pending_review ['quota_full']. (b) 'N-07 an understanding counts toward the goal activity', with fixture {goalQuota:2}: the user writes 2 general notes with goalId 's4a-goal' on FILE_A. An agent understanding on the goal → {status:'pending_review', reasons:['quota_full'], overQuota:true}; readNote(U) → storedState 'pending_review', overQuota true; pointer {noteId:null, revision:null}. (c) 'N-07 a repair reports overQuota from the goal quota'. Case 1, default fixture: the user writes exactly 5 general notes on FILE_A with goalId null; an agent repair on FILE_A → {status:'staged', overQuota:false}, and readNote overQuota → false. Case 2, {goalQuota:2}: the user writes 2 general notes with goalId 's4a-goal' on FILE_B; an agent repair on FILE_A → {status:'staged', overQuota:true}, and readNote overQuota → true. Remove the repair lines from the first N-07 test. (d) Add to the existing sixth-note case: overQuota:false in both the write result and readNote. (e) Regression guard for the refuted part: with 5 general notes on FILE_A, an agent structural pitfall {replaces:[ids[0]]} → {status:'pending_review', reasons:['structural']}, with no 'quota_full'.

### Item should-1 — existingTopics: the new-topic condition and the latest spelling

**Found (confirmed).** note-service.ts:308-329 existingTopicsOf. (i) It lists other topics on every anchor key, without checking that the new topicKey is new on that key. (ii) It keeps the first-encountered head's spelling. (iii) It sorts with topic.localeCompare (the display spelling, locale-dependent) instead of topicKey. Governing text: L22 ('新注记的 topicKey 在某个锚点键上是新的…给出这些现行项的不同 topicKey（显示最近写入的写法）和条数，按锚点键、topicKey 排，总共最多 20').

**Ruling.** Follow L22 literally. Per anchor key, include entries only when no current general note on that key has the new topicKey. Group by (anchorKey, topicKey). The display topic is that of the latest-written head (createdAt desc, then noteId desc). Sort by anchorKey, then topicKey, with plain code-unit comparison. Cap at 20.

**Fix.** note-service.ts existingTopicsOf. It also inherits the lookup completeness of Codex #4.

**Tests.** 'N-18 %s existingTopics follows the new-topic condition and the latest spelling' (W1 fixture, user writes). On module A: 'Alpha' (n1), then 'alpha' with coexistWith [n1], then 'beta'. On module B: 'gamma' (n4), then 'delta'. A user write with topic 'gamma', anchor module A, extraAnchors [module B], coexistWith [n4] gives status 'accepted' and existingTopics toEqual [{anchorKey:'module:A',topic:'alpha',count:2},{anchorKey:'module:A',topic:'beta',count:1}].

### Item should-2 — The inferred same-topic conflict needs both notes current

**Found (confirmed).** note-read-model.ts:97-117 conflictingOf never checks the subject's own state. A withdrawn or superseded note reads conflicting:true when a current same-topic note now exists on its key. Governing text: L9 ('同一个锚点键上两条现行 accepted/reviewed、topicKey 相同的一般注记'), M-07.

**Ruling.** The same-topic branch requires both notes to be current. The contradicts branch stays as L9 words it (the other note is current); the spec is explicit there and needs no change.

**Fix.** note-read-model.ts conflictingOf: guard the same-topic branch with head.state ∈ {accepted, reviewed}.

**Tests.** 'N-14 %s a withdrawn note is not in a same-topic conflict' (W1 fixture). The user writes A (topic 't', src/a/x.ts) and withdraws A. The user writes B (topic 't', same anchor), which is accepted. readNote(A).value.conflicting is false, and readNote(B).value.conflicting is false.

### Item 15e — Discriminating assertions for items 1, 2 and 5

**Found (confirmed).** S4A-note-history.test.ts:40-58 (N-12) checks the replay only with toMatchObject({status,noteId,version}), on a write whose warnings and existingTopics are empty and whose overQuota is false. note-service.ts:352-359 rebuilds the replay with warnings:[], existingTopics:[] and overQuota from reviewReasons, so a user over-quota write replays overQuota:false. No test replays a disposition. No test accepts a pending note that has `replaces`, or a pending general note on a goal anchor (Codex #1/#2). Governing text: N-12 ('重放回原回执'), L6 (取代 at the accepting commit; the pointer moves only for understanding), L8.

**Ruling.** Add discriminating assertions. These back the production fixes of Codex #1, #2 and #5 and must be RED before those fixes.

**Fix.** Tests only. No fixture change beyond 15c.

**Tests.** (1) 'N-12 %s replays the full original write receipt'. The user writes k-1..k-5 on src/a/x.ts, then a user write with topic 'replay topic' (commandId C) gets first = {status:'accepted', overQuota:true, existingTopics:[{anchorKey:'file:src/a/x.ts',topic:'k-1',count:1},…'k-5'], warnings:[], confirmedByUser:true,…}. Withdraw k-1, replay C with the identical input: toEqual(first). readNote({noteId, version:2}) is not_found. (2) 'N-12 %s replays a disposition'. A scribe review with commandId R gives r; the identical request again: toEqual(r). readNote(version 3) is not_found. (3) 'N-08 %s accepting a pending general note on a goal anchor leaves the pointer'. u1 is an understanding (pointer rev 1). An agent writes a structural pitfall on goal:s4a-goal, which is pending_review. The user accepts it with a reason. listByAnchor(goal).pointer toEqual {noteId:u1,revision:1}, and u1 storedState is 'accepted'. (4) 'N-06 %s accepting a pending replacement supersedes its target in that commit'. The user writes x. An agent writes a structural decision with replaces [x], which is pending_review, and x is still 'accepted'. The user accepts it. readNote(x).storedState is 'superseded'.

### Item 5 — Replay: scoped identity, checked before mutable state, the original result exactly

**Found (confirmed).** All four parts hold.
(a) Identity scope. note-service.ts:298-300 `identityKeyOf(prefix, commandId)` hashes only {kind, commandId}. The fingerprint (:350-351, :713-714) has no projectId, workspaceId or principal. One ledger serves every project (create-platform.ts:535, ctx.projectId per call). Peer WorkGraph writes scope the identity to the trusted caller: mailbox-service.ts:752-756 `identityKeyOf(operation, projectId, workspaceId, sender, requestId)`, with sender = host actor or work_run runRef/sessionRef (:733-749); evidence-service.ts:152-155; command-event.ts:99-108, whose comment says the agent principal is folded in so two agents do not replay each other. The spec says the commit goes through the store's idempotent commit 同 WorkGraph 别的写 (§2 line 519, L15 line 211), so the peer rule governs. Result today: user u1 and an agent sending the same commandId with the same note get u1's receipt. With a different note they get `unavailable`, because :361 maps idempotency_conflict to unavailable.
(b) Disposition replay order. In `dispose`, the head-version check (:649) and `transitionNote` (:656-657) run before `lookupCommit` (:715). After the first commit head.version = expectedVersion+1, so even an immediate replay returns revision_conflict. If the lookup is ever reached (:719-723), it returns the current head's version and state, not the original ones. The builder admits this in final-1.md UNSPECIFIED 7. F8 (line 51) says 重放先回原回执: the store checks the identity before the guards (in-memory-record-store.ts:255-266).
(c) Lossy write replay. :356-359 and :609-611 return `warnings: []` and `existingTopics: []`, and set `overQuota = reviewReasons.includes('quota_full')`. The original values come from note-machine.ts:47,50: a user write or a staged repair with quotaFull has reviewReasons [] and overQuota true. existingTopics is computed after the commit (:616) from fresh reads, so it cannot be recomputed later. The spec requires 原样: §4 rule 7 重放原样回原回执; N-12 重放回原回执; L17 重试重放原回执. The existing N-12 test (S4A-note-history.test.ts:53) uses toMatchObject, which hides this.
(d) Concurrent-replay recovery. :606-613: if `receipt.replayed` and `recoverWrittenVersion` returns null, the code falls through to :614 and returns the freshly minted `noteId`, which was never committed. `recoverWrittenVersion` (:195-210) also turns read and decode failures into `continue`/null. `deps.records.commit` (:604, :727) is not wrapped, so a throw escapes. This breaks §4 rule 2 and the read-failure rule. The mailbox peer rechecks the receipt and otherwise rejects (mailbox-service.ts:289-303, 353-366).

**Ruling.** Confirmed; fix in 4A. The spec only says 同 WorkGraph 别的写 and gives no identity formula, so the lead adopts the peer rule: identity = (operation, projectId, workspaceId, trusted principal, commandId). Replay is resolved before any mutable read and returns the original result exactly.

Two technical rulings are needed (no product decision):
(R1) Amend P9. `NoteWritten` gains `result` (the success WriteNoteResult as first returned) and becomes the last event of a write commit (superseded heads and pointer move first, as P9 already orders disposition commits). This follows the store's own design: ports.ts:180-187, `eventAt` exists to restore the original result on replay. Without R1, 原样 cannot be met for warnings/existingTopics/overQuota.
(R2) Same commandId with a different request (store `idempotency_conflict`): NoteErrorCode has no such code. Map it to `invalid` with reason `idempotency_conflict`, not `unavailable`, because a retry cannot help. Record this in the §2 reason list as a post-note.

Interactions:
- #2: the dispose rework must keep the subject's NoteDispositionChanged last.
- #3: propagate read failures here too.
- Should-fix existingTopics (latest spelling, new-topic condition): same function, do both together.
- #15: build the concurrency case on the reworked interleave fixture with host contexts only.
- §7 fixture exception: see the Tests field.

**Fix.** note-service.ts:
1. Replace `identityKeyOf` with `noteCommandIdentity(op, ctx, commandId)`, where op is 'write' | 'review' | 'withdraw'. It returns `'s4-note-' + op + ':' + sha256Hex(canonicalJson({schemaVersion:1, op, projectId: ctx.projectId, workspaceId: ctx.workspaceId ?? null, principal, commandId}))`. principal is built from ctx.principal only:
   - host → {kind:'host', actor:{kind,id}}
   - work_run → {kind:'work_run', runRef:{projectId,goalId,runId}}
   - query_run → {kind:'query_run', queryRunRef}
   Add projectId and principal to both fingerprints too (harmless, matches mailbox).
2. `writeNote`: compute identity and fingerprint right after the commandId/shape check and call `lookupCommit` BEFORE `resolveCaller` and all other reads.
   - ready → `replayWrite(prior.value)`.
   - idempotency_conflict → rejected invalid 'idempotency_conflict' (R2).
   - not_found → continue.
   - any other failure → rejected unavailable with the draft.
3. `replayWrite(receipt)`: `eventAt(receipt.cursor)`, then require:
   - eventType NoteWritten
   - `event.eventId ∈ receipt.eventIds`
   - the event decodes (strict, incl. `result`)
   - `result.noteId/version` agree with the NoteVersion v1 refKey in receipt.versions
   Then return `decoded.result` verbatim. Any failure → `{status:'rejected', code:'unavailable', reason, draft: input}`, never a constructed success. Delete `recoverWrittenVersion`.
4. Compute `existingTopics` BEFORE the commit from the already-read `currentByAnchor`, minus the heads this commit supersedes (the projected post-commit state, as in L7). Put the full success result into the NoteWritten event body. Push NoteWritten last. Return that same object on success.
5. Wrap `commit` in try/catch. On a throw or a non-committed receipt, re-run `lookupCommit` (the mailbox pattern) → replay if ready, else the mapped rejection. On `receipt.replayed` → `replayWrite(receipt)`. Never fall through to the fresh noteId.
6. `dispose`: after input validation, compute identity and fingerprint and call `lookupCommit` before `resolveCaller`, `readHead`, the scope check, the version check and the transition.
   - ready → `replayDisposition`: `eventAt(cursor)`; the event must be NoteDispositionChanged, decode, `head.noteId === input noteId`, eventId ∈ eventIds. Return `{status:'done', noteId, version: head.version, state: head.state, receipt:{identityKey, fingerprint, cursor: receipt.cursor}}`.
   - Same commit wrapping as step 5.
7. note-record-codecs.ts: add `result` to `NoteWrittenEventV1`/`WriteV1` and to the strict decoder:
   - status ∈ accepted|pending_review|staged and equal to head.state
   - noteId and version equal to head
   - reasons equal to head.reviewReasons; confirmedByUser equal to head
   - overQuota is a boolean
   - warnings ⊆ {symbol_unresolved, anchor_ended}
   - existingTopics: ≤ NOTE_EXISTING_TOPICS_MAX entries of {anchorKey, topic, count≥1}

**Tests.** All tests are in S4A-note-history.test.ts under N-12, both backends unless marked.
(1) `N-12 %s a write replay returns the original result verbatim`:
   - Setup: noteLimits.anchorQuota=2. The user writes topics 'a' and 'b' on module A, then topic 'c' with commandId 'n12-c'.
   - The 'c' write must equal the literal {status:'accepted', noteId:<id>, version:1, reasons:[], overQuota:true, confirmedByUser:true, warnings:[], existingTopics:[{anchorKey:'module:A', topic:'a', count:1},{anchorKey:'module:A', topic:'b', count:1}]}.
   - The user then writes topic 'd'. Replay 'n12-c' with the identical input → `toEqual(first)`, so overQuota is still true and existingTopics has no 'd'.
   - readNote(id, version 2) → not_found.
   - Second case: an agent writes on a cancelled task of its goal (the N-20 setup) → warnings ['anchor_ended']; replay → toEqual(first).
   - Change line 53 from toMatchObject to toEqual.
(2) `N-12 %s the same commandId from another caller is a new command`:
   - User u1 writes 'n12-x' note X on module A → accepted n1.
   - User u2 (host human, another id) sends 'n12-x' with identical X → {status:'rejected', code:'invalid', reason:'same_topic_unresolved', conflicts:[{noteId:n1, version:1, conclusion:<X's literal>}]}. listByAnchor(module A) → exactly [n1] with source {kind:'user', principalId:'u1'}.
   - u2 sends 'n12-x' with a different topic → status 'accepted' and a noteId ≠ n1.
   - A cross-project case only if two projects can be bootstrapped publicly on one platform; otherwise rely on review.
(3) `N-12 %s a disposition replay returns its original receipt`:
   - User writes n1. reviewNote 'n12-r' (expectedVersion 1, verdict review) → R; assert R matches {status:'done', noteId:n1, version:2, state:'reviewed'}.
   - Immediate replay → toEqual(R).
   - withdrawNote 'n12-w' (expectedVersion 2) → W with version 3, state 'withdrawn'.
   - Replay 'n12-r' → toEqual(R). Replay 'n12-w' → toEqual(W).
   - readNote(n1, version 4) → not_found.
(4) Memory only, in the interleave fixture (the lead extends §7's storage-boundary exception to N-12; host contexts, no Run facts):
   - `N-12 memory two identical writes racing return one note`: interleave the same ctx, commandId and note → left toEqual right, status 'accepted', and listByAnchor shows exactly one item with that noteId.
   - `… a failed replay recovery is unavailable`: the double fails the next `eventAt` once → the replayed side is {status:'rejected', code:'unavailable', draft: <the input>} with no noteId field, and listByAnchor shows only the committed note.
   - If the lead does not extend §7, keep only the first case.
(5) R2 case, either backend: same caller, same commandId, different note → {status:'rejected', code:'invalid', reason:'idempotency_conflict'}.

### Item d7 — Replay keeps the original receipt (P9 amended, R4)

**Found (confirmed).** note-service.ts:352-359: the write replay returns warnings:[], existingTopics:[] and overQuota derived from reviewReasons, so a user over-quota write replays false. Codex #5: the disposition replay checks the already-changed head version before lookupCommit. Governing text: N-12 ('同一 commandId 的请求重放回原回执'). The repo's replay pattern is lookupCommit followed by eventAt(receipt.cursor) 'to restore the ORIGINAL created result' (record-store/ports.ts:181-197, used by decision-service.ts:363 and others). The spec does not say where the non-derivable receipt fields live.

**Ruling.** Reject both the lossy replay and the disposition exemption. Lead technical amendment to P9: in a write commit, the new note's NoteWritten is the last event and carries `receipt: { overQuota, warnings, existingTopics }`. In a disposition commit, NoteDispositionChanged is already last (P9). Replay = lookupCommit, then eventAt(cursor), then the original result, all before any mutable-state check. If the event read fails, return 'unavailable', never a rebuilt receipt. Do not store these on NoteVersion (that would change L1's version contents).

**Fix.** note-service.ts writeNote/dispose: do the replay lookup first and rebuild from the event. persistence/note-record-codecs.ts: NoteWritten codec gains the strict `receipt` field.

**Tests.** Test 15e (1) and (2).

### Item 11 — Record and event invariants (stagedRunKey, one eventId per event, truthful event decoders)

**Found (confirmed).** All three parts hold.
(a) stagedRunKey. In note-machine.ts:219-222, `bumped` spreads `...head` and keeps `stagedRunKey`, so a withdrawn repair keeps it. Spec L3 (line 97): 只有 `staged` 的头有这个字段，别的为 `null`. P9 defines it only for a staged repair. Result: the staged-run index (slice 8's reader, P7) would list withdrawn repairs. No 4A read exposes the field: NoteItemV1 has no stagedRunKey (note-contracts.ts:96-110). The codec (note-record-codecs.ts:334) accepts any state/key combination, so nothing catches this today.
(b) Shared eventId. note-service.ts:293-296 mints one eventId in `eventHeader()`. It is called once per commit (:543 and :663) and spread into every event: NoteWritten, each superseded NoteDispositionChanged and CurrentPointerMoved in a write; the old pointer note's event, CurrentPointerMoved and the subject event in an accept. P9 and §2 line 532 require one event per change (各一条). Peers mint per event (evidence-service.ts:1428 `eventId: deps.newId()`). The store does not enforce uniqueness: the sqlite `events` table has no eventId column (migrations.ts:18), and the receipt eventIds is a plain array. No consumer breaks today (decision-application.ts:111 uses `includes`), but the ledger invariant is violated.
(c) Event decoders. `NoteWrittenEventV1`/`NoteDispositionChangedEventV1` (note-record-codecs.ts:44-56) type `head`/`version` as committed `NoteHeadSnapshot`/`NoteVersionSnapshot` (since: CommitCursor). The decoders call `noteHeadBodyProblem(head, false, false)` (:504, :529), which accepts since:null. The service always writes since:null into event bodies (note-machine.ts:122, :221; note-service.ts:534), because `commitCursorBindings` fill record fields only, from the commit's last event (ports.ts:123-124). An event cannot carry the committed cursor truthfully: for any event that is not last, its own cursor ≠ the commit cursor. Today no production code uses these decoders except registration validation (state-writes.test.ts:204-205 allowlist), so this is a type lie waiting for 4C.

**Ruling.** Confirmed; fix in 4A.
(a) L3 governs: non-staged ⇒ stagedRunKey null.
(b) Mint one eventId per event. The spec does not state uniqueness explicitly, but 各一条 plus ledger practice does; this is a technical ruling.
(c) Make the contract truthful; do not supply a cursor. The P9 event body is the pre-bind snapshot, and the commit cursor is the receipt/event cursor and the records' bound `since`. Spec §2 fixes the record types, not the event types, so this changes no frozen interface.

Flags:
- Codex #9 (reject human repair writes): once it lands, the codec may also enforce staged ⇒ stagedRunKey non-null. Until then, enforce only the non-staged direction, or user repairs would fail as a damaged record instead of `forbidden`.
- Finding 5's replay reads these decoders, so do (c) together with finding 5.
- Part (b) has no 4A-observable public read. Recommendation: no dedicated test, verify in the Codex quick check, and cover it again when 4C's D-01 reads the proof event. Only if the lead wants a test: allow the interleave fixture to record PreparedCommit.events. That is a storage-boundary observation, which the lead has to permit explicitly.

**Fix.** 1. state/note-machine.ts `bumped`: set `stagedRunKey: state === 'staged' ? head.stagedRunKey : null`. Also drop the wire-only `revision` that the decoded head carries, so event snapshots have a stable shape:
   `const { revision: _r, ...rest } = head as NoteHeadSnapshot & { revision?: number }`
   (or strip `revision` in decodeNoteHeadSnapshot's returned value).
2. persistence/note-record-codecs.ts `noteHeadBodyProblem`: add `if (body['state'] !== 'staged' && body['stagedRunKey'] !== null) return 'NoteHead stagedRunKey is only for a staged note'`. Add the converse (staged ⇒ non-null) only together with Codex #9.
3. notes/note-service.ts: drop the shared header and mint per event. Use `const base = { schemaVersion: NOTE_EVENT_SCHEMA_VERSION, occurredAt: now, projectId, workspaceId }` once per commit, and build each event as `{ ...base, eventId: deps.eventId(), ... }`, in writeNote (:543-588) and dispose (:663-705).
4. note-record-codecs.ts:
   - Retype `NoteWrittenEventV1.head/version` and `NoteDispositionChangedEventV1.head/version` as `PendingNoteHeadSnapshot`/`PendingNoteVersionSnapshot` (since: null). Collapse the *WriteV1 twins into them.
   - The decoders require `since === null` in event snapshots (strict, matching what is written). Add a doc comment: an event snapshot is pre-bind; its commit cursor is the receipt cursor, which is also the bound `since` of the records.
   - Fix any type fallout; there are no production consumers today.

**Tests.** (a) N-13, both backends, existing test S4A-note-history.test.ts:124-126. After adding the codec invariant (step 2) and before step 1, it must go RED: the store refuses the withdraw commit, so the result is no longer done. After step 1 it is GREEN. Tighten the assertions to the literal `toMatchObject({status:'done', noteId, version:2, state:'withdrawn'})` and readNote(noteId) → storedState 'withdrawn', version 2. Record the RED/GREEN in the log.
(b) No new 4A test (see ruling). Check by reading the code: every encode*Event call gets its own `deps.eventId()`. Optional, if the lead allows: in the interleave fixture, a user write with replaces:[n0] (the N-04 replace case) → the captured PreparedCommit has 2 events with 2 distinct eventIds.
(c) `npm run typecheck` (the retyped decoders). The finding-5 N-12 replay tests decode real NoteWritten/NoteDispositionChanged events through these decoders, so a since or shape mismatch turns them RED. No separate test.

### Item should-3 — Historical confirmedByUser is derived, not blanket false

**Found (confirmed).** note-read-model.ts:156: itemOfVersion always returns confirmedByUser:false, a fabricated definite answer. Governing text: L1 (confirmedByUser 'only on the head; 你写的、你收下的、你审过的都为 true'), §4 rule 9 ('confirmedByUser 只在头上（版本用 change.by 保留是谁做的）'), §3 S4-NOTE-04.

**Ruling.** Derive it; do not store it. Storing it per version would conflict with L1 and §4 rule 9. For version v: true iff some version u ≤ v has change.by.kind === 'user' and change.kind ∈ {'write','accept','review'}. If any needed version read fails, return 'unavailable', never false.

**Fix.** note-read-model.ts readNote({version}): read versions 1..v (bounded by v) and derive the value. For v === head.version the head value may be used.

**Tests.** 'N-11 %s historical versions carry confirmedByUser derived from change.by'. An agent writes n (v1). The user reviews it (accepted → reviewed, v2). The user withdraws it (v3). readNote version 1 gives confirmedByUser false; version 2 gives true; version 3 gives true; the head read (no version) gives true.

### Item 6 — Stored basis versions (bound plan and catalog for agents)

**Found (partly).** Confirmed parts. note-service.ts:375 calls resolveNoteAnchors without stagePlanRevision, so note-anchors.ts:303/308 uses the goal's CURRENT accepted plan for an agent's stage key. basis.planRevision (note-service.ts:526) is that same current revision, and it is null for any agent note with no goal-class anchor (needsPlan false, note-anchors.ts:290). catalogRevision is hard-coded null (note-anchors.ts:327). For a stage in a second goal, note-anchors.ts:420 uses `plan.stageRevision ?? read...planRevision`, so it reuses the first goal's revision. The builder's report (final-1.md item 10, 'RunRef/claim carry none') is wrong: RunSnapshot.planRef exists (dispatch.ts:222), and the composition's noteRunFacts already decodes the Run (create-platform.ts staged hunk), so it can return planRef. The same plan snapshot pins effectiveArchitectureBaseline (plan.ts:254), and catalog revision = baseline ref revision (catalog-service.ts:132-136). Test gap: the N-20 stage test (S4A-note-scope.test.ts:92-105) keeps both plans at revision 1, so it cannot tell bound from current. Partly: NoteItemV1 (§2) has no `basis` field, so basis.planRevision/catalogRevision cannot be observed in 4A without a database read. Governing spec: L14 '计划版本、目录版本由平台从这次执行的绑定里填…阶段锚点的 planRevision…agent 用它这次执行的绑定（它目标）的计划版本；你用该目标当前采用的计划版本'; L11 'basis（计划版本、目录版本…）'; L2 '阶段带计划版本'.

**Ruling.** Must-fix; follow the L14 wording. Agents: plan = the Run's bound plan (run.planRef); catalog = that plan's effectiveArchitectureBaseline revision (null if no catalog record at that revision). Users: the current accepted plan of input.goalId, and the current active catalog revision (null if none). The spec is silent on two cases; recommended rulings, recorded as a post-note: (a) basis.planRevision is the plan of the note's goal (head.goalId), because basis holds a single number; (b) a stage anchor in a goal other than the agent's run goal (only scribes can write one) uses that goal's current accepted plan. Flag 1: if the stage named by the bound revision is absent from the bound plan, the key names nothing. Recommend: an agent's stage must exist in both the bound plan (what the key names) and the current plan (L2), else anchor_not_found. Flag 2 (for 4B): a catalog-pinned basis can mark a fresh module note module_definition_changed when the catalog was revised after the plan was accepted, because graph tools and the anchor gate read the current catalog (graph-context-reader.ts:748). The lead should confirm the literal L14 reading, or rule 'current at write' for the catalog only. Either is technical, not a product decision.

**Fix.** (1) note-service.ts NoteRunFactResolver: add `planRef: PlanRevisionRef` to the value; in create-platform.ts noteRunFacts return `planRef: run.planRef`. (2) note-anchors.ts resolveNoteAnchors: replace the single `needsPlan` read with a per-goal map {goalId → current plan facts}, plus for an agent the bound plan read once via tasks/plan-readers `readPlan(records, planRef)`. The stage revision for each goal is the bound revision when caller=agent and goal=run goal, else that goal's current revision. Delete the `plan.stageRevision ?? …` reuse at :420 and the unused `stagePlanRevision` input. (3) Return `basisPlanRevision`/`basisCatalogRevision` from the caller (bound for agents, current for users) instead of `planRevision`/`catalogRevision: null`. Read the catalog revision via readArchitectureRevision({selection:{kind:'revision', ref: plan.effectiveArchitectureBaseline.ref}}) for agents and {kind:'current'} for users. A failed read returns `unavailable` with the draft, never null (aligns with must-fix 3).

**Tests.** In S4A-note-scope.test.ts (rewrite the N-20 stage case), both backends. Setup: the executor claims a Run under s4a-goal plan rev 1; the Host then accepts plan rev 2 of s4a-goal through the public plan service, keeping stage s1 and the executor's task. (a) 'N-20 … an agent stage anchor keeps its bound plan revision': executor writes {stage s4a-goal s1} → readNote anchor toEqual {kind:'stage', goalId:'s4a-goal', planRevision:1, stageId:'s1'}; listByAnchor on planRevision 1 lists it. (b) The user writes the same stage → planRevision 2. (c) 'N-20 … each goal's stage gets its own revision': user (goalId s4a-goal) writes main {stage s4a-goal s1} + extra {stage s4a-goal-2 s2}, with s4a-goal at rev 2 and s4a-goal-2 at rev 1 → anchor.planRevision 2, extraAnchors[0].planRevision 1. If a plan revision cannot be accepted through public calls while the Run exists, stop and report. No 4A test for basis.planRevision/catalogRevision (no public field). List as '4B 联动补验' under M-02: an agent on bound rev 1 writes a goal understanding after rev 2 is adopted → plan_changed; the same write by the user → not.

### Item 7 — Project scribes writing against another goal (narrow anchor-facts reader)

**Found (confirmed).** Anchor facts go through the general Plan service with the caller's ctx: note-anchors.ts:299/301 (queryGoal/queryTaskGraph), :410, :416, :428. plan-service.ts:639-641 authorizeGoal returns forbidden('the work run is not scoped to this goal') for a work_run on another goal. note-service.ts:366 skips the own-goal gate for scribes, so a project scribe reaches that forbidden. Its scope admission (note-service.ts:386-389, scribe-scope.ts:320-333) runs only after resolution. The N-20 test hides this: S0 is claimed on s4a-goal-2 (S4A-note-scope-fixture.ts:273), and its 'other goal' anchor is s4a-goal-2/t9 (S4A-note-scope.test.ts:64), so it is the same goal. The builder admits it (final-1.md item 10). The read model's existence check (note-read-model.ts:183-190) goes through the same path, so a scribe's listByAnchor on another goal's anchor can read as not_found. Governing spec: L2a class 3 '书记在它管的范围里用'; L2a '项目范围的书记能用项目里所有锚点'; N-20 '执行者用别的目标的任务锚点 → forbidden、anchor_out_of_goal（项目范围的书记用同一个可以…）'; L12 not_found rule '不套“自己的目标”那一条'.

**Ruling.** Must-fix. Keep the Plan service restriction unchanged (plan-service.ts is outside L-scope anyway). Add a narrow records-level anchor-facts reader inside notes, mirroring readCatalogModuleFacts. The notes→tasks dependency is allowed (P3). The note service calls it only after its own L5/L2a class-3 caller gate has decided the caller may name that goal: user = any goal in the project; non-scribe agent = own goal only (the existing early gate stays); scribe = any goal, after which class 3 (writeAdmission) decides, keeping table order 2→3. A region scribe then gets anchor_out_of_scope instead of the Plan service's forbidden reason.

**Fix.** note-anchors.ts: add `readAnchorGoalFacts(records, ctx, goalId, boundPlanRef?)`. Build it on tasks/plan-readers `readGoalPlanWindow(records, goalRef)` and `readPlan(records, planRef)`, returning { exists, current: {planRevision, stageIds, tasks:{taskId, disposition}}, bound?: {...}, effectiveArchitectureBaseline }. Require goal.projectId = ctx.projectId and, when ctx.workspaceId is set, goal.workspaceRef.workspaceId = ctx.workspaceId (forbidden otherwise). Propagate not_found/unavailable distinctly, never as absence (must-fix 3). Replace every deps.plans.* call in resolveNoteAnchors/resolveOne with it; deps.plans can then leave NoteAnchorFactsDeps. Use the same reader in note-read-model.ts anchorExistsNow. note-service.ts: keep the early own-goal gate for non-scribe agents; scribes go to resolution, then writeAdmission. Share the per-goal reads with must-fix 6.

**Tests.** S4A-note-scope.test.ts plus the fixture (both backends). Fixture: claim S0 (no module link, so project scope) on a s4a-goal task, not s4a-goal-2. (a) 'N-20 … a project scribe uses another goal's task anchor': S0 writes {task s4a-goal-2 t9} → status 'accepted'; readNote anchor toEqual {kind:'task', goalId:'s4a-goal-2', taskId:'t9'}, goalId 's4a-goal'. (b) The executor (s4a-goal) writes the same → {status:'rejected', code:'forbidden', reason:'anchor_out_of_goal'}. (c) SA (region scribe, s4a-goal) writes the same → {code:'forbidden', reason:'anchor_out_of_scope'}; listByAnchor(task s4a-goal-2 t9) via the user then shows only S0's note. (d) S0 writes {task s4a-goal-2 t99} → {code:'invalid', reason:'anchor_not_found'}. (e) S0 writes {stage s4a-goal-2 s2} → accepted with that goal's current planRevision (literal; make it differ from S0's bound revision per must-fix 6). (f) S0 calls listByAnchor({task s4a-goal-2 t3}) on an existing task with no notes → {status:'ready', items:[], complete:true}.

### Item 14 — Write-side symbolRequest resolution

**Found (confirmed).** note-anchors.ts:402-408 builds the stored file anchor as {kind, path, deleted?} and drops `draft.symbolRequest`; anchorFormatProblem (:358-359) never validates it. No code calls captureSourceChanges/querySource for symbols, so `warnings` can never contain 'symbol_unresolved' (note-service.ts:390-391), and NOTE_SYMBOL_HITS_MAX has no consumer (allowlisted with a kept-for note in production-reach-allowlist.json). The builder declared it not built (final-1.md items 41 and 56). Governing spec: §0.1 item 1 (a) '4A：…写入时读依据文件的摘要和解析符号（L11 写时一段、L14 的符号规则）'; §6 4A line 'notes/note-service.ts（…建捕获解析 symbolRequest，注入 WorkspaceToolsPort）'; L11 '存下的 NoteBodyV1 不再有 symbolRequest'; L14 '符号' paragraph; §4 rule 14; §7 fixture exception 'G-01 的符号解析（真实工作区捕获和源码查询）'. No N-row exists; the acceptance case is G-01 (4C, NE4). Workspace facts: SourceHit symbol = {location:{path,digest,start{line,column},end{line,column}}, name, symbolKind}, with no container (workspace/ports.ts:73, F12 ✓). Providers are 'text'|'typescript'|'python'|'cpp' (ports.ts:16).

**Ruling.** Required in 4A (§0.1 and §6 assign it explicitly; Codex (b) agrees). Lead process ruling: test the writer half at NE1 in a new S4A file, named 'G-01(4A) …'. Record in STATUS that 4C's G-01 re-runs it through record_note. Algorithm per L14: one capture with the language's provider; page `querySource {kind:'symbols', path}` up to NOTE_SYMBOL_HITS_MAX; keep hits with name === request.name (and start.line/end.line === range when given). Exactly one → locator {language, qualifiedName: hit.name (hits carry no container today), range:{startLine:start.line, endLine:end.line}, fileDigest: hit.location.digest, signatureDigest: sha256 of the hit's range text from the capture content with every whitespace run folded to one space}. Two or more → invalid symbol_ambiguous with symbolCandidates. None, unsupported language, or file not in capture (including deleted:true) → plain file anchor plus the success warning 'symbol_unresolved'. Spec-silent points, recommended: (i) language must equal one of 'typescript'|'python'|'cpp', anything else is unsupported → warning; (ii) if the scan stops at the cap with nextCursor ≠ null, never store a locator: 0 or 1 match → symbol_unresolved, 2 or more → symbol_ambiguous; (iii) capture/query failure with unavailable, capacity, cancelled, capture_expired or source_stale → write rejected `unavailable` with the draft (same as L11 basis files, never silently 'unresolved'); `unsupported` → warning; (iv) each warning code at most once. Flag for 4B: the TS capture digestBasis is decoded_utf8, so L23's 'current digest = fileDigest' shortcut may simply re-resolve. That is safe; note it.

**Fix.** note-anchors.ts: validate symbolRequest in anchorFormatProblem: {language: non-empty string, name: non-empty string, range?: {startLine, endLine} positive safe integers, startLine ≤ endLine, no extra keys} → invalid, field `anchor.symbolRequest`. Add `resolveSymbol(ctx, path, request, workspace, hitsMax)`, called from resolveOne's file case after the existence check; store `symbol` only on a unique complete match; return `symbolUnresolved` in ResolvedNoteAnchors. Export one `signatureDigestOf(text)` helper for 4B to reuse. NoteAnchorWorkspace / create-platform noteWorkspace: the capture wrapper takes the provider, add `releaseCapture` (best-effort release after use), and use `readWorkspace({version:{kind:'capture', capture}})` for the range text. note-service.ts: push 'symbol_unresolved' into warnings and map symbol_ambiguous to {status:'rejected', code:'invalid', reason:'symbol_ambiguous', symbolCandidates, draft}. Add `symbolHitsMax` to the injectable noteLimits. Remove NOTE_SYMBOL_HITS_MAX from the allowlist (it is now reached). Coordinate with must-fix 5: a write replay must return the same warnings. symbol_unresolved can be rederived from the identical fingerprinted input (a file anchor with a symbolRequest whose stored anchor has no symbol); anchor_ended cannot, and must be stored or recomputed per 5's ruling.

**Tests.** New tests/work-graph/S4A-note-symbol.test.ts, both backends, real workspace tools on the temp workspace (§7). First probe the TypeScript provider under .dsh-scratch (needed tsconfig, line/column base, how methods are named), then hard-code literal expectations; hex digests are computed by hand from the literal file text, never via product code. Cases: (a) 'G-01(4A) %s a unique symbol is stored as a locator': src/sym.ts with one `alpha` function at lines 1–3; {language:'typescript', name:'alpha'} → accepted, warnings []; readNote anchor toEqual {kind:'file', path:'src/sym.ts', symbol:{language:'typescript', qualifiedName:'alpha', range:{startLine:1,endLine:3}, fileDigest:'<literal>', signatureDigest:'<literal>'}}. (b) Two symbols named `run` in one file → {status:'rejected', code:'invalid', reason:'symbol_ambiguous', symbolCandidates:[{name:'run',range:{…}},{name:'run',range:{…}}]} ordered by startLine, draft echoed, listByAnchor(file) → items []. (c) The same request with the second range → accepted with that range. (d) name 'nope' → accepted, warnings ['symbol_unresolved'], anchor toEqual {kind:'file', path:'src/sym.ts'}. (e) language 'cobol' → accepted, warnings ['symbol_unresolved']. (f) Paging: a generated file with 60 functions f01..f60 (function i at hand-computed lines); request f55 → accepted with its literal range, which proves cursor following. (g) With noteLimits.symbolHitsMax 2 and three functions, request the third → warnings ['symbol_unresolved']. (h) A bad symbolRequest shape (range.startLine 0) → invalid with draft. No capture-unavailable test in 4A unless the lead extends the §7 double exception.

### Item 15a — N-20: a real cross-goal scribe write

**Found (confirmed).** tests/helpers/S4A-note-scope-fixture.ts:273: s0 claims goal-2 task t10, so s0's Run is in s4a-goal-2. tests/work-graph/S4A-note-scope.test.ts:64: s0 then writes task:s4a-goal-2/t9, which is its own goal. The 'project scribe can use another goal's anchor' case therefore never crosses goals, and it hides Codex #7 (plan-service.ts:639-641 refuses a work_run reading another goal's plan). Governing text: spec §5.2 N-20 ('项目范围的书记用同一个可以', i.e. the same anchor), L2a class 3, book L-fixtures. Builder UNSPECIFIED 10 admits it.

**Ruling.** Reject the builder's choice. The scribe must write the SAME anchor from a Run in a different goal. This depends on the production fix of Codex #7 (a narrow anchor-facts reader after scope authorization).

**Fix.** S4A-note-scope-fixture.ts:273: make s0 claim goal-1 task t1 (already assigned platform-scribe), not goal-2 t10. No other test depends on s0's goal. S4A-note-scope.test.ts:64: write the literal same `anchor` (drop the no-op `{...anchor, goalId}` spread).

**Tests.** 'N-20 %s an executor cannot use another goal's task anchor but a project scribe can', both backends. (1) The executor's Run (s4a-goal) writes {kind:'task',goalId:'s4a-goal-2',taskId:'t9'} and gets {status:'rejected',code:'forbidden',reason:'anchor_out_of_goal'}. (2) s0 (Run on s4a-goal, no module link, so project scope) writes the same draft and gets status 'accepted'. readNote(...) gives value.anchor toEqual {kind:'task',goalId:'s4a-goal-2',taskId:'t9'} and value.goalId 's4a-goal'. It must be RED before #7 is fixed.

### Item 15b — Stage anchor test where the bound and the current plan differ

**Found (confirmed).** The fixture adopts only plan revision 1 (S4A-note-scope-fixture.ts:186-208). S4A-note-scope.test.ts:92-105 expects planRevision 1 for both the agent and the user, so it cannot tell the execution binding from the current plan. In production, note-anchors.ts:288-308 takes planRevision from queryTaskGraph (the current plan), and `stagePlanRevision` (declared :269, used :308) is never passed by note-service. RunSnapshot.planRef (dispatch.ts:222) already names the bound plan, and each plan revision has its own planId (A7-control.test.ts:637). Governing text: spec §5.2 N-20 last clause ('由平台从这次执行的绑定（你从当前采用的计划版本）填'), L2, book L-fixtures.

**Ruling.** Reject the current-plan substitution (UNSPECIFIED 10). The test must make the two sources differ. It depends on the production fix of Codex #6 (resolve the bound plan through the Run's planRef).

**Fix.** Inside this one test, not the shared fixture: after the fixture's claims, call plans.proposePlan with {goalRef, basedOn: f.planRef, draft: a planRevision 2 copy of f.plan with a new planId (e.g. 's4a-scope-plan-r2'), stage s1 kept, plus one new unclaimed task t7 in s1 assigned platform-executor and added to o1}, then plans.applyPlanChange. If the plan service refuses a revision while Runs are claimed, stop and report the exact rejection (code + reason). Do not seed.

**Tests.** 'N-20 %s a stage anchor takes its planRevision from the execution binding', both backends, after revision 2 is applied. (1) The executor's Run (claimed under rev 1) writes stage s1 of s4a-goal. readNote gives anchor toEqual {kind:'stage',goalId:'s4a-goal',planRevision:1,stageId:'s1'}. (2) The user (host ctx, goalId 's4a-goal') writes stage s1 of s4a-goal and gets planRevision 2. Case (1) must be RED on the current code, which stores 2.

### Item c — N-10 SA1 archive sub-case through public calls

**Found (confirmed).** R4-control-platform.test.ts:73-86: platform.controls.submitControl with cancel on a claimed-but-unentered Run is applied by the platform with no Runtime Host ('platform_not_entered'), and the Run is 'ended'/'cancelled'. create-platform.ts:1376-1392: archiveLine is admitted when no hostInstance is configured. WP2-wiring.test.ts:940-945 shows the public call shape. session-archive.ts:300-313: module links need no choice, and open non-terminal task links need {drop|transfer} (contracts/core/session-archive.ts:11-12). session-availability.ts:282-289: module links do not block archive. scribe-scope.ts:165-166 already excludes archived Sessions (includeArchived:false), so an unclosed module link does not matter. The builder's 'needs a Runtime/Kernel maintenance context' is not supported by the code (that describes maintainSessions, not archiveLine). Governing text: book P14 ('SA1 归档 … n1 then goes up to SA'; if not buildable, report why), N-10.

**Ruling.** Build it now through public calls. If a step still refuses, the reply must quote the exact rejection (code + reason) at that step, not a summary.

**Fix.** In the scope test: SA1 writes n1 on src/a/one/x.ts. Read SA1's Run revision (platform.executions.readExecution), then call platform.controls.submitControl(hostCtx, {input:{runRef: sa1.runRef, kind:'cancel', reason:'s4a archive'}, meta:{requestId, expected:[{ref: runRef, revision}]}}). Re-read the Session card (platform.sessions.readSession), then call platform.workflow.archiveLine(hostCtx, {input:{sessionRef, reason:'s4a archive', tasks: [{target, disposition:{kind:'drop'}}] for each open non-terminal task responsible link on the card}, meta:{requestId, expected:[current Session pin]}}).

**Tests.** 'N-10 %s SA1 archived (not a handover) sends n1 up to SA', both backends. archiveLine gives {status:'ready', value:{state:'archived'}}. f.review(sa, n1, 'review') gives {status:'done', state:'reviewed'}. countCurrentNotes gives region A1 → current 0 (no scribe, P1), region A → current 1, project → current 0. Also list '7 片联动补验' for the real handover, as now.

### Item d11 — The project-level review slot is goalId null (R11)

**Found (partly).** Index ids are not named by the spec, so `s4-note-by-*` is an implementation choice. Envelope revision (head = version, version = 1) is reasonable. The review index is registered on paths ['ref.projectId','goalId','state'] (note-record-codecs.ts:566-567), so the project level is stored as null. Spec L3 says '（项目、目标或 \'project\'、状态）'. Following the literal would need a new derived head field (not in L1's head list), and it would collide with a goal whose id is 'project'. null equality lookups are supported (lookup-ports.ts:15; L3 itself cites lookup-index.ts:380).

**Ruling.** Recommend a lead amendment (a post-note on L3): the project-level slot of the review index is the stored `goalId: null`, and readers query it with null. This avoids a new field and the collision. The 4C L16 pending count must use null. If the lead keeps the literal 'project', add a derived scalar `reviewGoalKey = goalId ?? 'project'` to the head and index it. Either way, write the choice down before 4B/4C. Staged keys and event contracts: as Codex #11.

**Fix.** Amendment path: no code change, only the book/spec post-note. Literal path: add the head field, codec and index path.

**Tests.** Covered through d9's goal-null count test, which reads the project-level slot.

## 7. Groups and order (one building subagent at a time, in this order)

Each group block lists the items of section 6 it owns. A group starts from the previous group's result; its subagent
re-runs all S4A test files (both backends) before replying, and they must pass.

- **G0 — fixtures first:** 15c, 15d. Real scribes/executors through the production resolver; the interleave fixture
  keeps only its commit gate. All existing S4A tests must pass unchanged afterwards (except the expectations items say
  change later).
- **GA — the input gate, read failures, no caps, authority, counts, fact shapes:** 12a, 12b, 3, 4, 9a, 9b, 9c, 10a, 13,
  d8, d9. Item 3's tests go in `S4A-note-failures.test.ts` with the read-fault double.
- **GB — supersession, the pointer, quotas, topics:** 1, 2, 8, should-1, should-2, and 15e's assertions for items 1 and 2.
- **GC — replay and events:** 5, d7, 11, should-3, and 15e's assertions for item 5.
- **GD — basis versions, cross-goal scribes, symbols:** 6, 7, 14, 15a, 15b. Item 14's tests go in
  `S4A-note-symbol.test.ts`.
- **GE — the archive case and wrap-up:** c, d11, and the L-reach amendment of section 4 (allowlist).

After each group, start a read-only reviewer subagent for that group (it gets sections 1–5, the group block, its items of section 6 and the
group's FILES list; it reads the diff with `git diff HEAD -- <files>` and checks each item's fix and tests against the
spec; it does not edit). Give its findings to the next building subagent as extra work, or fix them in a short last
pass. Do not skip a group because time runs short: finish whole items, and list the ones left.

## 8. Checks (at the end, by you)

`npm run typecheck`, `npm run check:architecture`, `npm run build`, `node scripts/build-kernel-patch.mjs --check`; all
`tests/work-graph/S4A-*.test.ts`, `tests/architecture/`, `tests/composition/platform.test.ts`; the full suite once
(`npx vitest run --maxWorkers=4`) compared with `DSH-BASELINE.md` §A — list every failure outside it. `git status
--short` must show only files of the L-scope (round 1's plus section 4's).

## 9. Reply

FILES CHANGED (this round, `git diff HEAD --stat`); per item of section 6 (by its id): fixed / partly / not done, the
test name(s), the implementation file:symbol, RED→GREEN in one line; the reviewers' findings and what was done with
them; CHECKS with numbers; UNSPECIFIED (short, each with the spec line); NOT BUILT (grouped "4B 联动补验", "4C 联动补验",
"7 片联动补验", "7D1 联动补验", "第 8 片联动补验" as in round 1).

## 10. Size and time

Finish within 200 minutes. If you run short, finish whole items rather than half of many, and say which are left.
