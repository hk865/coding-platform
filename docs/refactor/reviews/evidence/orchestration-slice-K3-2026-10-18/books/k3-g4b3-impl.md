# Task: K3 group 4 session B3 — L19a: blocking the original commands and asking for a rerun (`blockedCommands` at ②, the `shell` hook, `request_command_rerun`, the CRR owner, the `command_rerun_request` card and its application, the blocked lines in the continuation; B2-01..B2-18, K3-15 (二)'s sentence, K3-35 (二)(三) extended); coordinator mode; test-driven

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. The spec, this
book and the lead's rulings are binding; do not make design decisions. Where they do not determine something, choose
nothing: list it under UNSPECIFIED with the smallest options, and go on.

**This run is headless. When your turn ends, the whole run ends.** **Work in coordinator mode:** read
`./.dsh-ref/coordinator-mode.md` first and follow it. No fixed limit on how many subagents run at once (decision 76),
but files of running subagents must be disjoint and every vitest command uses `--maxWorkers=2`. **Do not end your turn
while a subagent has not reported back.** Subagents write all code and tests; you split, brief, check and reply.
**Finish within 280 minutes** (the run stops at 290, with a handoff if needed). Finish whole items; an unfinished item
is reported, not half-done.

## 1. What this copy is

- HEAD = tag `k3-g4b2-r1`: K3 group 4 session B2 (the proposal round, the approval card and its application, the
  approved methods in the continuation) after one rework; its production code is accepted, two test items are left
  for this session (section 2 item 0). Sessions B1, A and groups 1–3 underneath, on the lead branch at f15f25a4. B2's
  book `./.dsh-ref/k3-g4b2-impl.md` (section 8 = the lead's 11 answers), reply `./.dsh-ref/k3-g4b2-final.md`, rework
  book `./.dsh-ref/k3-g4b2-rework-1.md` (its item 2 amends answer 3), rework reply
  `./.dsh-ref/k3-g4b2-rework1-final.md`, and Codex's quick check of the rework `./.dsh-ref/k3g4b2-review2.out.md`
  (Chinese; its items 5 and 6 are this session's item 0); B1's book, reworks and replies as listed in B2's book
  section 1. **Their rulings are
  binding here too**, in particular: B1 rework 2 item 1 and rework 3 item 1 (a failing ② skips that card and the
  ordinary advance goes on), rework 4 (the failed-card set is never public advance input), B2 answer 9 (`approve`
  writes `blockedCommands: []` today; **this session computes the real list in the same write**).
- **What group 1 already built (use it, do not rebuild):** `src/contracts/command-rerun-request.ts` (the record, its
  states, the three index names), `src/core/work-graph/model/command-rerun-request-contracts.ts` (the read port and the
  owner port), `src/core/work-graph/state/command-rerun-request.ts` (the CRR table: `newCommandRerunRequest`,
  `transitionCommandRerunRequest`, `openRequestForAlias`, at most 8 forms),
  `src/core/work-graph/state/command-normalization.ts` (`normalizeCommandText`, `commandSha256`, `parseShellActions`;
  its unit tests `tests/state/command-normalization.test.ts` = B2-10), the source kind and identity in
  `src/contracts/goal-decisions.ts`, `UnknownCallBlockedCommandV1` in `src/contracts/unknown-call-review.ts`, the
  three-field binding `blockedCommands?` in `src/contracts/core/prepared-execution.ts` (~214), the
  `request_command_rerun` kind in `state/unknown-call-kinds.ts`, and the UCR state already writing
  `ctx.blockedCommands` on `skip_as_done`/`approve` (`state/unknown-call-review.ts` ~518–564; `applyDisposition`
  passes `[]` today). Check each against the spec before you use it; a difference goes under UNSPECIFIED, not into a
  silent change. **Not built yet (the read-through found it; this session builds it):** the CRR codec, its owner
  service, the index registration and the composition wiring (the three index names exist only as constants); the
  binding is never set by `execution-preparation.ts`'s `buildManifest`.
- The spec: `docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md` (frozen). Read: **L19a (~457–545,
  whole)**; L19 (~440, the three steps ①②③); L20 (~547–589, the required part and the budget table); §1 H (code facts,
  ~776); §2: `blockedCommands` (~892–897), the decision source kinds (~1024–1026), the CRR contracts and ports
  (~1109–1139), the request tool (~1210–1221), the indexes (~955–958); §3.2 UCR-09, UCR-12 (~1263–1266); §3.2b CRR
  (~1276–1290); §3.4 KR12 (~1344); §4 rules 14 and 19 (~1361, ~1366); §5.2 B2-01..B2-18 (~1479–1500), K3-15 (二),
  K3-35 (二)(三).
- **The rulings of group 4 session B: `./.dsh-ref/k3-g4b-rulings.md` items 2–6 are binding for this session, with
  item 6 replaced by section 2 item 7 below.**
- The TDD skill: `./.dsh-ref/tdd/`.

## 2. Scope (binding)

0. **B2's two test items left (Codex's quick check `./.dsh-ref/k3g4b2-review2.out.md` items 5 and 6).** Do them
   first; they touch the same files this session extends.
   - **Literal approval expectations.** `tests/work-graph/K3-16-approval-application.test.ts` still computes its
     expected approval text from the actual `record.proposals` with a local sort/map/replace formatter (~46, ~66,
     ~228). Fix the full expected text, commands and directories as literals; only the dynamic Run identifiers are
     inserted. Remove the formatter.
   - **K3-35 on one consistent, reachable fact (lead ruling).** The B2 fixture reuses 8 run refs three times to make
     "8 rendered + 10 omitted" anchors and feeds `prepare` a basis assembled from another task through a stand-in
     reader (`tests/helpers/K3-35-continuation-fixture.ts` ~130–216, `tests/helpers/K3-35-prepare.ts` ~168–186).
     Rebuild it: the anchors, the approved record and the continuation basis all belong to **one task** and come from
     public steps, with unique run refs (8 anchors rendered; omitted anchors only if public steps produce them); the
     task IDs at T = 512 and T = 600 as L20. With this session's 62-byte sentence and the blocked section, (二) fits
     and (三) at T = 600 is strictly over → `capacity` — compute both by hand from L20's table and item 7 (answers 6
     and 8) and give the derivation. Counters public steps cannot reach (16-digit omitted counts, 10 omitted anchors)
     stay only in the pure-renderer boundary test `tests/runtime/K3-35-renderer-boundary.test.ts`, extended with this
     session's sentence and section. If a reachable worst case cannot be built through public steps, stop that part
     and report it under UNSPECIFIED with the smallest options; do not fall back to the stand-in reader.
   - Codex's suggestion: the reply of B2's rework called a direct tool-handler call a "scripted model"; name things as
     they are in your reply.

1. **`blockedCommands` at ② (L19a "拦哪些命令", UCR-09, UCR-12).** In the same owner write that applies the
   disposition (`skip_as_done`) or the approval (`approve`), compute and write the record's `blockedCommands`:
   `skip_as_done` → every `dispositionTargets` item of kind `process`; `approve` → every `proposalTargets` item's
   original command (never the proposed commands); `rerun_as_is`, `handle_myself`, platform items → none. The command
   text is read from the original Run's Kernel record by the item's `KernelCallRefV1` (the continuation's read window,
   K L9), never from the 512-character summary; a read failure → ② `unavailable`, nothing written (UR7 retries).
   Each entry: `reviewRunId`, `alias`, `commandSha256`, `kernelCallRef`, `actions`, `expansions`, `truncated` as §2
   and L19a; unparsed or all-irrelevant → the one whole-normalized-text action (B2-01's second assertion). Script
   expansion as L19a (the eight runner forms, two levels, no `pre`/`post`, no bare `pnpm X`/`yarn X`), per-expansion
   `basis`, the directory rule through **ruling 5** (one parser; per action `dirs` = the static `cd` paths before it,
   or `null`; the public `{ words, text }` projection unchanged so B2-10 stays as it is), at most 4 distinct
   `package.json` per blocked command (one per directory), `WorkspaceToolsPort.readWorkspace` with
   `maxBytes = 262144` injected by the composition root (port type in the model contracts, L19a K8-6 last bullet).
   Caps and the drop order (last expansion first, then actions after the 16th; `truncated: true`; the 16 KiB total
   for the new fields of one record; comparison keys from the untruncated text). The static expansion never blocks
   the disposition.
2. **The `shell` hook (L19a "在哪拦", K8-6).** Preparation carries the three-field binding for every Work Run of a task
   whose records have blocked commands (later continuations, reworks, rounds; other tasks never; review and proposal
   rounds are read-only and untouched). At each `shell` call, before the sandbox, through the `before_tool` control
   hook (no Kernel patch; spec §9.5): read the records' current state and the task's CRRs, then (i) a one-time
   allowance whose `commandSha256` equals the call's → `consumeAllowance` (CRR-03, **ruling 2**: the consuming
   `{ runId, callId }` stored as `usedBy` next to `usedAt`), run only after the commit succeeds; a failed commit → this
   call is blocked with "暂时确认不了允许，稍后再试", the allowance stays; (ii) the call's `commandSha256` equals an
   approved method of a record with blocked commands → run, no request; (iii) (A) exact, (B) any action key or any
   action of an `npm run Y`-like expansion of the **current** `package.json` (at most 2 reads per call, unreadable → no
   expansion), and any `declaredForms` digest of the task's CRRs → block. Several hits → the first by (record creation
   time, alias). A block is a normal tool result `hook_blocked` with L19a's fixed text (the "其中的……" clause only for an
   action hit), no sandbox, no scope, no failure, no rework count; replay reads the original result (no re-parse, no
   re-read). Reads per call exactly as B2-16; zero extra reads for a task without blocked commands.
3. **`request_command_rerun` (L19a "请求工具", §2 ~1210, rulings 2 and 3).** New
   `src/core/agent-runtime/command-rerun-tools.ts`, registered only in a Work Run of a task with blocked commands;
   input exactly `{ command; reason; rewriteOf? }` (command 1–4,000 UTF-8 bytes, reason 1–2,000 code points);
   recognition by the same (A)/(B) as the hook (the request tool's directory is `"."`); `rewriteOf` by full `runId`
   or its unique 8-character prefix (not unique → `invalid` listing the full runIds; not this task's record or not a
   blocked alias → `invalid`; given but the command hits another entry → `invalid` `rewrite_of_mismatch`); the result
   union exactly `requested | pending | allowed` (each with `requestId`), `refused` (`denied_final` |
   `denied_in_this_run`), `not_blocked`; the declared-form append (CRR-07 `forms_added` on `denied`/`denied_final`,
   append to a `pending` one, a new record starts with the form; at most 8, display text cut to 512 bytes, the 9th →
   `capacity`, nothing written); one request per alias per record at a time; every tool text as L19a. Identity and
   replay as L14 for the writing branches; the no-write branches replay through the Kernel's recorded result
   (**ruling 3**, no receipt record); after a crash mid-call the platform lookup answers `not_committed` when no CRR
   write carries the request id. Kind `platform` in L3's table.
4. **The CRR owner (§3.2b, rulings 2 and 4).** Implement the owner port group 1 declared: the request write
   (CRR-01, CRR-07), the answer application (CRR-02, CRR-04, CRR-05: answer to this card, request@revision still
   `pending`, task active), `consumeAllowance` (CRR-03), identity, replay, `idempotency_conflict`,
   `revision_conflict`; the three indexes; state changes only through `src/core/work-graph/state/` (AGENTS rule 9).
   **Closed is derived on read (ruling 4):** when the task is no longer active, every read (the CRR read, the card
   source, the hook) treats `pending` and unused `allowed` as `closed`; the persisted CRR-06 transition is written by
   the next owner operation that touches the request; no task-ending owner is edited.
5. **The card source `command_rerun_request` and its application (L19a "卡的来源", "落实", rulings 2 and 4).** A derived
   source through U7's collection card source (as B1's `unknown_call_review`), reading `pending` requests through
   `k3-crr-by-goal-state`; source identity, pins (request@revision, its record@revision, goal@revision, `goalBases`);
   the card text as L19a (`#<alias>@<runId 前 8 位>`, the blocked command's full text from the Kernel, this request's
   form, the stored `match` — never re-expanded —, the `declaredForms`, the reason, the alias's earlier requests and
   answers, at most 5, newest first, the fixed sentence); three options `allow_rerun` "允许重跑", `deny` "不允许",
   `deny_final` "不允许，也别再问", all `effect: 'apply'`; autonomy never skips it. The application through U6's one
   advance function (a `command_rerun_request` adapter beside B1's), identity from the answer message, the proof on the
   CRR changed event (`proof: DecisionChangeProofV1 | null`) and a U3 decoder row `CommandRerunRequestChanged`
   (**ruling 2**). **Ruling 4:** UR7 generalised — one Workflow step applies answered, unapplied cards of the goal's
   tasks for both kinds through the same advance function; start-up 6b (c) kind 4 lists both kinds by goal through the
   same index (`listUnappliedAnswers`); a repeated `decisions/answer` replays.
6. **K3-15 (二)'s sentence.** The K3 required part's last fixed line "- 平台拦下原命令；要再跑先请求并得到允许。" (62
   bytes, L20's template) appears exactly when the record's `blockedCommands` is non-empty.
7. **The blocked lines in the continuation (replaces ruling 6; lead, 2026-10-17 evening).** Reason: L20's budget table
   leaves about 600 bytes after the required parts at T = 512 and C = 5,120; ruling 6 made the per-command lines a
   required part, which can exceed that (16 lines with request states and declared forms run to several KiB) and would
   turn a later continuation into `capacity`. The 62-byte sentence above is the required signal; the per-command lines
   are **not required**:
   - After the K3 required part and before the fixed ending: a heading `### 被拦的命令`, then one line per blocked
     command of the task's records in (record creation time, alias) order:
     `- #<别名>@<runId 前 8 位>：被拦[；<请求状态>][；注明过的写法：<写法>、<写法>、<写法>[，等 N 种写法]]`.
     The request state is the alias's newest request in that record: `pending` "请求等答复", unused `allowed` "允许一次
     （未用）", `denied` "不允许", `denied_final` "不允许，也别再问"; `used`, `closed` or no request → nothing. The forms
     are that alias's `declaredForms` across its requests in that record, in declaration order, without repeats,
     each cut to 160 bytes, at most 3 shown.
   - At most 16 lines, then `- 另有 N 条被拦的命令；跑之前先用 request_command_rerun 请求。` when there are more.
   - These lines are ordinary optional lines: when the brief is over budget they are omitted first, from the last
     line of this section backwards (the heading goes with the last line), and counted in today's omission note; only
     then today's rules shorten the other optional lines. No blocked commands → no section, the brief byte-identical.
   - Reads at `prepare`: the task's records (as today) and the task's CRRs through `k3-crr-by-task`, ⌈R/200⌉ pages.
8. **K3-35 extended.** (二): the B2 worst case plus the 62-byte sentence, `prepare` succeeds, ≤ 16,384 bytes, the
   required part verbatim (the blocked lines may be partly omitted; assert the omission count you compute by hand);
   (三): T = 600 → `capacity` (strictly over; see answer 8 for the size of the overflow). On the consistent fixture of
   item 0. Expected bytes hand-computed from L20's table and item 7's template, never by calling the renderer.

## 3. Rows (§5.2) for this session

- **B2-01..B2-09, B2-11..B2-18** (B2-10 exists from group 1: keep it green; extend it only for ruling 5's `dirs` on the
  internal parse result, not on the public projection), **K3-15 (二)** (the blocked sentence and the real block),
  **K3-35 (二)(三)** extended as item 8, K3-16's approve case now ending with the real `blockedCommands`, the
  two-crash mixed-card fixture B2 left (B2 UNSPECIFIED 6) where B2-01 or B2-02 needs it, and the start-up 6b (c) kind 4
  case for a `command_rerun_request` answer (ruling 4; one row-named test beside K3-44).
- The L19a example table (B2-01) row by row, as written; B2-09's two crash cases with L29's crash fixture; B2-16 (三)
  with R = 401 exactly.
- Memory and SQLite where the row says so; restart rows on the Host with SQLite only (B1 rework ruling 8).

## 4. Rules

- **TDD:** one test first (it must fail for the right reason), then the smallest change. Test names start with the row
  id. Expected values literal, from the rows or hand-computed.
- **Tests through public owners and routes** (`decisions/answer`, the card reads, the Workflow, the Host start-up, a
  scripted model calling `shell` and `request_command_rerun`, the stand-in `shell` of §5.1). Fault injection yes (a
  counting wrapper on the public store read port for B2-16..B2-18, a failing commit for CRR-03); fact injection no (no
  hand-encoded records, requests, `blockedCommands` or events). States only tampering can make are not tested (AGENTS
  rule 4).
- State transitions only through `src/core/work-graph/state/`. Production-reach allowlist: remove the entries your
  wiring reaches; add none.
- **Reuse:** the parser and normalization of group 1 (one parser, ruling 5); B1's card projection pattern, the
  option-required table, U6's advance function, U7's collection source, the identity helper; the workspace read port
  (no new read permission); the hook seam `before_tool`. No second copy of any of them.
- **Old tests:** the K3-16 approve assertion `blockedCommands: []` flips to the real list (report before/after); the
  brief tests without blocked commands stay byte-identical. Any other failing assertion: do not edit it; report it.
- No real model calls, no git writes in the repository, never ports 3080/3099/44797; probes under `./.dsh-scratch/`,
  deleted at the end.
- **Line budget (decision 69):** about 1,400 new production lines (soft). Report the count per item.

## 5. Order (suggested; you decide the briefs, files disjoint)

1. The CRR owner and its indexes (item 4), and ② writing `blockedCommands` with the expansion (item 1, ruling 5).
2. Then in parallel: (A) the hook (item 2; B2-01, 02, 04, 11, 13, 15, 16); (B) the request tool (item 3; B2-03, 05, 06,
   12, 14, 18); (C) the card source and application, UR7 generalised, start-up (item 5; B2-07, 08, 09); (D) the
   continuation (items 6–8; K3-15 (二), K3-35).
3. Close-out (one subagent): the checks below.

## 6. Checks (close-out subagent)

- `--maxWorkers=2`: every `tests/**/K3-*.test.ts`, `tests/**/B2-*.test.ts` if you name files so,
  `tests/**/K-*.test.ts`, `tests/**/S5*.test.ts`, `tests/**/S4C2-*.test.ts`, `tests/business/`,
  `tests/scenarios/WP1-*`, `tests/scenarios/A8-host-restart*.test.ts`, `tests/state/`, `tests/composition/`,
  `tests/app/S4C*.test.ts`, `tests/architecture/`, `tests/**/*brief*.test.ts`, `tests/runtime/`, the new test files.
- Then `npm run typecheck`, `npm run check:architecture`, `npm run build`.
- Failures listed in `DSH-BASELINE.md` are expected in your sandbox (no bwrap). Name any other failure. Do not run the
  full suite.

## 7. Reply

Under 900 words: FILES CHANGED (production / tests, production line count per item); each scope item and row: done or
not, RED → GREEN; CHECKS with numbers; UNSPECIFIED (short, with options); subagents (task, time, most at once);
anything surprising.

## 8. Answers to the read-through (lead; filled after the read-through)

The read-through (`./.dsh-ref/k3-g4b3-preread-final.md`) is accepted with these answers (binding). HEAD is now B2
after its rework (section 1's tag); B2's rework changed the K3-35 fixture, the proposal input and some tests, so
re-read them before you build on them.

1. **`dirs` (ruling 5): your option (a).** One internal detailed parse carries, per action, `dirs`; the exported
   `parseShellActions` maps it to today's `{ words, text }` (B2-10 unchanged). Which `cd`s count, following the shell:
   a static `cd <path>` changes the directory of the actions after it when it is joined by `&&`, `||`, `;` or a newline
   at the same level, or sits inside `{ …; }` before them; a `cd` inside `( … )`, inside a pipeline element (`|`,
   `|&`) or backgrounded with a single `&` changes nothing outside that part. Inside a `bash -c` string the outer `dirs`
   carry in and the inner `cd`s add to them. `dirs = null` for every later action at that level after `cd -`, a bare
   `cd`, a `cd` whose argument is not a static string (`$`, backticks, `~`), `pushd` or `popd`.
2. **`usedBy`: extend the contract, the state and the port** (ruling 2): `usedBy: { runId; callId } | null` next to
   `usedAt` on the record, the `used` event carries it, `consumeAllowance` takes the consuming call. No production
   record exists yet, so no old-shape branch.
3. **Seams.** The Runtime gets the CRR read port, `Pick<WorkspaceToolsPort, 'readWorkspace'>` and the Kernel-call read
   it needs; ② and the card source get the Kernel-call read too. **Reuse the reader that already reads the original
   Turn's calls** (the review input's `commandFacts` and the continuation's K L9 window); add a narrow port only if no
   existing reader can be passed, and say which. The composition root always wires them. A read failure in the hook
   (records, CRRs) for a task with a non-empty binding fails closed: the call is a `hook_blocked` result with the fixed
   text `平台暂时确认不了这条命令有没有被拦，这次先不跑；稍后再试。`; a missing seam is a wiring error caught by the
   composition tests, not a runtime branch.
4. **The task's records: your option (a).** `listReviews` gains `{ goalRef, taskId }`, filtered over the goal index
   and paged to the end; no new index (the spec's indexes stay). The hook itself reads the records named by the
   binding (`reviewRunId` → the record), as B2-16 counts; `prepare` uses the task form to build the binding and the
   blocked lines.
5. **The continuation fields.** An optional `blockedCommands` field, present only when non-empty, so every brief
   without blocked commands keeps its bytes and digest. The 62-byte sentence is part of the record's K3 required part,
   present exactly when that record's `blockedCommands` is non-empty. **A later continuation whose afterRun has no
   record** still gets the blocked lines of the task's earlier records as the standalone optional section (the blocks
   hold for every later Work Run of the task).
6. **Section layout and omission (section 2 item 7 made exact).** The section is: an empty line, `### 被拦的命令`,
   the lines (16 at most), then the count line when more exist — joined by `\n` like the other sections. Over budget:
   take section entries away from its end one at a time (the count line first, then the lines from the last; the empty
   line and the heading go with the last line) until the brief fits with every other optional part at full length;
   each removed command line is counted in today's omission note. Only when the brief does not fit with the section
   gone do today's caps and omissions apply to the other optional parts. The count line counts the commands beyond the
   16-line cap only.
7. **Smaller ones.** The CRR answer identity's phase label is `rerun_request`. The card's blocked command comes from the
   Kernel (L19a), through the seam of answer 3. `RedriveAnswerV1`, `WorkflowAdvanceInput.answers` and the internal
   failed-card set become a union keyed by the decision source (`{ kind: 'unknown_call_review'; reviewRef }` |
   `{ kind: 'command_rerun_request'; requestRef }`); the set stays internal (B1 rework 4). `workflow.ts`'s
   `unknown_call_review` filter (~2675) and `startup-reconcile.ts` (~146) take both kinds.
8. **K3-35.** Recompute on the consistent fixture of section 2 item 0 (one process item, so **one** blocked command,
   plus the 62-byte sentence and the section of answer 6); (二) fits, (三) at T = 600 is `capacity` with the whole
   section removed. The spec's "93 bytes over" is the table's upper bound with 16-digit counters; on the reachable
   fact the overflow is smaller (B2 rework measured 1 byte over with 18 anchors and exactly 16,384 with 8, before
   this session's 63 bytes). Expected bytes by hand; report the derivation and the overflow you get.
9. **Tests that will break:** your list is right. Both K3-16 files flip to the real list; remove the group-1 allowlist
   entries your wiring reaches; keep the CRR port out of the public platform keys (`platform.test.ts:56` unchanged);
   the K3-15 and K3-review-workflow rows may gain the sentence (report before/after); A2's round trip stays unchanged
   (the field is absent when empty).
10. **Plan:** accepted (A–G, four at once in the middle phase). Production about 1,400 lines; the time limit stays.
