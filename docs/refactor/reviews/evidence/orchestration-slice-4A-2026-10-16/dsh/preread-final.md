`git status --short` prints nothing. Report follows.

# Slice 4A task-book review

## 1. Unclear

1. **Book §4 L-tdd** — "assertions go through … the per-scope count of L7". §2's public `NoteReadPort` (spec:414–418) declares only `readNote` and `listByAnchor`; there is no count method or type anywhere in §2. I would invent a `NoteReadPort` method, but L-interfaces says names/signatures are binding "as spec §2 … give them", and §2 gives none.
2. **Book §2 A2** — "if the composition root gains a non-enumerable `notes` owner". Spec §2/§6 never name a `notes` composition owner, and `src/composition/create-platform.ts` has none (subagent D, 0 hits). I would assume 4A registers only the record group, so `platform.test.ts` is untouched.
3. **Book §6 W** — "basis files read from the worktree through the injected `WorkspaceToolsPort`". `readWorkspace` needs a version pin `{kind:'working_tree'}` and `maxBytes` (L11). The L-fixtures temp workspace's configuration isn't stated; I would assume the test's real workspace and an injectable `NOTE_BASIS_FILE_MAX_BYTES`.
4. **Book §6 G / N-10** — "书记范围夹具（N-21、N-22、G-01、D-03 共用）". G-01/D-03 are 4C. I would build the region subset now (S0/SA/SA1, n1–n4) and leave SG/n5/n6.
5. **Book A3** defers "N-22's last case" but N-22's first two cases need the project scribe `S0` ("today's start scribe"). Unclear whether the fixture must create `S0` as a real Session or reuse the existing opening scribe, and how the service knows which scribe a `CoreCallContext` is (principal has no duty — §4 below).
6. **Book §2** — "§0.2 (code facts, at 5c7a3258 — find the symbol if a line moved)". The base is `slice-base` (79cb2739), so nearly every §0.2 line citation has moved; I would re-find all of them.

## 2. Contradictions

1. **Book A3 vs spec L5:123 / §8:707.** A3 makes 4A enforce region-scribe write admission via `containment.parentOf`; L5 says containment判包含 is "8B 以后；containment 不知道时…" and §8:707 says 4A only writes facts/reads, "实际行为今天只有开局书记、范围整个项目，多书记的范围…在 7D/8B 跑通". A3 is binding but the spec says the opposite.
2. **Book L-scope "No `docs/`" vs spec §1.1:275, L18:227, §6:684, F17:60.** 4A must declare the `notes` submodule (deps model/state/persistence/architecture/sessions/tasks) and add `notes` to `evidence`/`views` in `docs/refactor/module-target.json`. That file has no `notes` submodule today (`module-target.json:26` + submodule list), and `scripts/check-boundaries.mjs:399-402` fails any file under `src/core/work-graph/notes/` with "source file has no … submodule owner in docs/refactor/module-target.json". **This is the hardest blocker: the first 4A file cannot pass `check:architecture` without a docs edit the book forbids.**
3. **N-19 (4A row) vs L10/4B.** N-19 ends "全文能查到渲染 body 里的词"; full text is `RecordTextSearchPort.searchText` (spec:482–489), placed in 4B (§1.1:277). NE1 has no search entry.
4. **N-06 (4A row) vs §1.1/L17.** N-06 asserts the contradiction card's `supersede` application; the card and `applyNoteDecision` are L17/4C (spec:220, 279), and book §2:39 says L9–L17 belong to 4B/4C.
5. **N-11 (4A row) vs §2 read face.** "按版本号读到三份不同的状态和经过" — `readNote` returns `NoteItemV1` (spec:415, 450–464), which has no `change`/`since`; "经过" is `NoteVersionSnapshot.change` (spec:350–354), a history read (L12/4B).
6. **N-13 (4A row) vs §2.** "按暂存执行索引能列出" — no `NoteReadPort` method lists by `stagedRunKey`; only `readNote`/`listByAnchor` exist.
7. **§0.2 F13 vs code.** F13 says `model/decision-contracts.ts:318` contains `note_review`; it does not. The literal is in `src/contracts/goal-decisions.ts:45,79,152,193`; `decision-contracts.ts:318` is inside `DecisionCardSourcePort`. The other half holds: `communication/decision-source-facts.ts:620-622` returns `unsupported`.
8. **§0.2 F3 path vs code.** Spec says `agent-runtime/context-assembler.ts` under WorkGraph; actual is `src/core/agent-runtime/context-assembler.ts:420-421,541`. (F4/F10/F14 line numbers also drifted; all other facts F1–F12, F14, F16–F18 held — F16's `s2b-plan-revision-by-goal` index exists at `plan-record-codecs.ts:1155`.)

## 3. Cannot build as written

1. **Per-scope count (L7), N-13 staged-run listing, N-11 history "经过".** No public entry exists (2.5, 2.6); building them means inventing a `NoteReadPort` member not in §2, breaking L-interfaces.
2. **`notes/` boundary + duty resolution.** Besides the docs blocker (2.2), `notes` may not import `configuration` (F17 deps), yet identifying a "Session of duty scribe" needs the role spec: `SessionCard` exposes only `record.role`, not duty (`src/core/work-graph/model/session-contracts.ts:46-51`). A3's region-scribe definition has no boundary-legal, reachable resolver unless the composition root injects a duty port declared in `model/note-contracts.ts`; §2 defines none.
3. **Containment IS reachable — so that fixture half is buildable.** `AdoptedArchitecture.containment` (`src/contracts/architecture-catalog.ts:32-44`), `adoptInitialArchitecture`/`reviseArchitectureCatalog` (`catalog-contracts.ts:93-121`), and `tests/composition/A1-graph-session-platform.test.ts:215-284` already revises with `containment.parentOf`.
4. **Region scribes ARE reachable.** `installRoleSpec` (`model/configuration-contracts.ts:15-17`), `createSession` (`agent-runtime/ports.ts:38`), `linkSessionWork` with `{kind:'module'}, relation:'responsible', active:true` (`identity.ts:44-47`, `lifecycle-contracts.ts:32-63`; `tests/work-graph/A1-independent-review.test.ts:99-113`). **Goal scribes are not** — there is no `goal` in `WorkLinkTarget` (`identity.ts:44-47`), so A3's deferral (N-10 n5/n6, N-22 `SG`) is correct.
5. **Effective (deepest) management scope is only composable, not directly readable.** It needs all open responsible module links plus each session's duty: public `findSessions` (`session-contracts.ts:57-60`) returns `SessionCard.links` (filter `relation==='responsible' && until===null`) but excludes archived unless `includeArchived:true`, and target-filtered results only emit sessions with ≥1 open link (`session-directory.ts:1469-1489`); there is no dedicated "responsible scribe for scope" port.
6. The book's note that 4A needs no sandbox/real model holds.

## 4. Missing

1. `NoteHeadRef`, `NoteVersionRef`, `CurrentPointerRef` (used spec:345,350,355) and `NotePageV1` (used spec:417) are never defined.
2. Shapes of ledger events `NoteWritten`, `NoteDispositionChanged`, `CurrentPointerMoved` (named spec:532) — needed by `persistence/note-record-codecs.ts`.
3. A per-scope count type/signature and any port member carrying it.
4. How `writeNote` derives `duty`, `sessionRef`, `runRef`, `goalId` from `CoreCallContext` (principal is host/work_run/query_run, no duty — `call-context.ts:13-56`). For a scribe without a Run, `NoteSourceV1.agent.runRef` is null but the path to `duty:'scribe'` is unstated.
5. `stagedRunKey` format (`NoteHeadSnapshot`, spec:346).
6. Where the "书记范围事实" (L5) are stored; §2 defines no record/type for them.
7. Which public workspace call bounded-enumerates paths for the 2,000-path missing-file candidates; L2a names `querySource {kind:'paths'}` but not a port method.

## 5. Size (book §6 groups)

- **R — large.** Two records + pointer + three events + three lookup-index groups + state machine + contracts + composition + A2; the codec is the largest single piece and everything depends on it.
- **W — large (largest).** 18 rows: format gates, anchors/relations/topic/quota, understanding pointer CAS, workspace digests + symbol capture, `existingTopics`, replay, plus the minimal read face.
- **G — medium→large.** N-20's deterministic candidates (NFC+ASCII, Levenshtein ≤2, 2,000-path scan, four pre-write classes) plus N-10/N-21/N-22 region scope (duty resolution, containment subtree, deepest-owner subtraction) plus counts.

## 6. Grouping

- **Unsound as-is.** Wave 1 runs W and G in parallel and both change `src/core/work-graph/notes/note-read-model.ts` (book §6: W "the minimal read face of `notes/note-read-model.ts`"; G "the per-scope current count of L7 (in `notes/note-read-model.ts`…)"). They will also both register in `src/composition/create-platform.ts`.
- **Cut I would use.** Give G a new `notes/scribe-scope.ts` (scope facts, per-scope counts, anchors/candidates), leaving `note-read-model.ts` wholly to W; R creates the shared `NoteReadPort` signature. Alternatively run W then G sequentially. Reason: removes the only certain same-wave same-file edit and matches the ownership split the book already intends.
- R→W/G ordering is otherwise right (codecs before services). Note R has no rows, so its test-first driver is W/G and its RED/GREEN log will be empty — worth stating in the reply.