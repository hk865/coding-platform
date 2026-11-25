# G6 acceptance driver

The driver for slice 9's one final real-model acceptance run (G6): the eight scenarios (E05, E06, E08, E09, E12,
plan iteration, direct intervention, waiting), the two 131072 cells (A1, B1), the compaction scenario, the attached
Goals C-216/C-221/C-222 and the B06 closing cells. It goes only through the real CLI
(`node dist/app/main.js <workbench-config.json>`) and HTTP (`/api/real/core/`, `/api/real/settings/`, header
`x-platform-token`). It imports no `tests/` fixture, reads no SQLite and never uses `runtimeProvider`.
Spec: `slice-9-SPEC.md` §5; rulings: `9-start-rulings` G6 and the G6 start rulings (2026-11-14).

## Run

```sh
npm run build                                   # dist/ and the boards the token is read from
node scripts/acceptance/run.mjs scripts/acceptance/acceptance.config.json
node scripts/acceptance/run.mjs <config> --only A1,E12 --out /tmp/g6-dry   # a dry run; it does not count
```

Before the real run the lead fills in `acceptance.config.json`: `authorization.text` (the approved text, recorded
verbatim in every result row), `window.from`/`window.to` (ISO times with offset), `runRoot` (an empty directory
outside the tree for the Hosts' data and the project folders), `cells.A1.modelId` and `cells.B1.modelId`
(`smoke-deepseek`), optionally `cells.compaction.modelId`. Token caps are in tokens only (`inputTokens + outputTokens`);
nothing has a default: the precheck refuses to start a Host while any of these is missing or the time is outside
the window.

## What it does

- **Hosts.** W-accept (the eight scenarios, the attached Goals, B06), WA (A1), WB (B1), the compaction Host; each its
  own folder and ledger under `runRoot`. A Host is started through the existing smoke start script
  (`host.launcher`), copied per folder with its `cd` line pointed there (as `impl/smoke/srr/host-ctl.sh` does); that
  script reads the provider keys in place inside the Host's own process. Normal close is SIGINT; E06, E12 and waiting
  restart over the same ledger.
- **Token.** Read from `<meta name="platform-token">` of `/workbench/Main.dc.html` into the driver's memory only;
  never written, logged, put in argv or a URL. The report says "已取得令牌" or `uncovered (entry-missing)`.
- **Provider.** Chosen once at each scenario's start with the existing probe (`host.providerProbe`, which prints only
  the answering model id), or fixed for A1/B1; then `settings/models/save` (re-saving the seeded entry) and
  `settings/models/select`. Never switched inside a scenario.
- **Budget.** `lib/budget.mjs` sums `inputTokens + outputTokens` from public reads (`sessions/queries` request rows,
  `activity/runs` for ended Work Runs), records `cachedInputTokens` beside it, and stops after the request that
  crossed the window total or a 50M scenario/cell cap; the rest of that unit is `uncovered (not-run)`. Each item
  belongs to the unit that owns its project, not to whichever unit was running when it was read; E06 takes E05's
  project over only when E05's work was shown stopped, otherwise E06 is `not-run`. A stop once seen ends every later
  wait at once. A reading is used only when every read answered `ready` and every usage is counted: a request with
  `unknown` usage holds the meter until its Query closes; an ended Run whose usage is unknown or incomplete stops the
  meter (only the public proof of a zero, a Run that never entered the Kernel, counts as zero). A request whose Query
  reached its terminal failure from the model service (`provider_request_failed`) is a proven rejection: it counts as
  unbilled 0 (noted), A1/B1 judge it `fail` with that source, and the run goes on. Any other request of a closed Query
  with unknown usage (e.g. a Host close cut it) counts at its reservation, `reservedInput + reservedOutput` (noted;
  the platform's own rule, an upper bound); only an unreadable reservation stops the meter.
  **Known gap:** a Work Run's compaction summary request runs in its
  own Kernel Session and is not in `activity/runs`, so the meter undercounts those; the driver does not read the
  database to fill it in (the caps are far above the expected use).
- **Unit end and last close.** When a unit ends, and before a Host's last close, the driver asks the Goals not
  finished to pause, then waits up to 30 minutes until each reads PAUSED or finished and no Query (running or still
  pending) or Run is in flight. What is still there is cancelled the way the person would (`queries/cancel`; a
  `cancel` control on the Run through `controls/submit` + `controls/deliver`), each cancel noted, then up to 10 more
  minutes; then the full reading. A refused pause or cancel, an unreadable state, or work still there after that
  means new work was not shown stopped: no later unit runs, and the Hosts get their bounded last close. A restart
  (E06, E12, waiting) is the scenario's subject, so it only takes one reading; a close that does not end with exit 0
  fails that restart's check and no second Host is started on that ledger.
- **New Goal in an initialized project.** The cold start's `initialization/adopt` takes only the first Goal of a
  project. A later Goal (intervention's long Goal, E12's and intervention's work on a completed Goal's line) goes the
  product's request path on one request (`lib/flows.mjs` `newGoalInProject`; MVP-BEHAVIOR.md:343): the secretary's
  Goal card (a round without one gets follow-ups asking for it: up to three, one in E12) → `goals/confirm-draft` →
  `requests/select-idea` of the first idea → the plan round writes the new Goal's request candidate →
  `plans/apply` by the person → `workflow/driver-start`.
- **Node review.** Under `every_step` (E08) the person reviews each finished node from `goals/delivery` and commits
  it with `nodes/commit`, as the product requires before the next node. The objective change there is a secretary
  round that answers with ideas (no `submit_plan_round` under `every_step`); the person selects the first, and the
  plan round that follows writes the candidate the person applies.
- **Check rounds.** A work Task's rounds are read by each of its Runs (`subjectRunRef`); a gate's by the Task.
- **Waiting.** The wait lives where the product allows it: the member's Work Run asks the secretary line through
  `send_session_message` with `waitAfterSend` (a Query round is refused that combination). The chain is followed until
  each event came, the chain is over (its Task done, every wait settled), or the window ends.
  11-18 补：整条链最多等 60 分钟；任务做完以后再等 10 分钟，链还没了结就结束（第十次曾一直等到窗口结束）。
  两种结束都记成未覆盖，不算通过。`second-expiry` 认追问上消费等待的 expiry 接受：按这条接受记下的 Run 读它的历史
  （接续线可能还没进成员线列表；读失败记 `env-unavailable`），只看该次输入的首行，也就是平台的到期提示，
  原问题里引用的同样字样不算；没找到这样的接受时，追问链（成员线、线的历史、追问消息）有一处读失败就记
  `env-unavailable`，先于下面的回复分支。
  第二封等待的回复在它的到期被接受之前到达、此后也没有别的追问实际发生第二次到期时，
  按回复胜过到期（`STATE-MACHINES-SPEC.md:3650`）记 `not-run`，不记 `env-unavailable`；供给顺序只把 `run.input_accepted` 的接受顺序写进 notes，只有连这个顺序都读不到才记
  `entry-missing`；重启前仍在的 Run 按 `starting`（已领取、未进入，同一次领取续驱）和 `running`（记中断、普通重新入队）分开写。
- **11-18 驱动修正（G6 第十一次）。** 平台停下等人时，场景记下停因，其余不依赖目标完成的判据照常判（`waitGoal` 的
  `returnOnDecide`，E05、E09、int、E08 传）。B06 等轮时替人批 `member_creation` 建线卡；轮定下后暂停，并像人一样取消
  在途的 Run。waiting 成员的 Run 已结束、结局不是 yielded、又没开等待，这个任务没有别的在途 Run、第一个 Run 结束满
  2 分钟就收，写出它 `send_session_message` 的拒绝原文。
- **Lag probe.** `lib/lag.mjs` is preloaded into each Host (`NODE_OPTIONS=--import`), samples
  `perf_hooks.monitorEventLoopDelay` and writes p50/p95/p99/max; recorded only, no threshold.
- **Seed Goals.** A settings-opened workspace gets its trusted checks, policy and architecture only from a cold-start
  adoption (`src/app/host-settings-types.ts:182-194`), which is the real product path. So E05 and B06 (and B06-W5's
  non-Git project) first run one small cold-start Goal, then the explicit `goals/create` → `plans/propose/apply` Goal.
- **Planning rounds.** The Host's idle consume pass runs once a minute per workspace and takes an
  `intervention_planning` Query through its stages in one pass (G7 W2: submit, claim, prepare + start; the proposal
  once answered). So the first planning request comes within about a minute of the `refine:` round (A1/B1 wait up to
  30).
- **Plan-round questions.** When a plan round answers with questions (`needs_decision`) instead of a candidate, the
  person answers in the same request: one follow-up, "按你推荐的做法；没提到的按最简单的处理", at most twice, recorded
  in `userCommand`, then the candidate wait (`lib/flows.mjs` `answerPlanQuestions`; iteration, both requests).
- **Candidate waits end early (G8A A7a).** Every wait for a request's plan candidate (E08, iteration, a new Goal in an
  initialized project: E12, intervention) goes through `lib/flows.mjs` `waitCandidate`: when the request's last round
  has settled with a close code (closed without an answer), no candidate can come, so the wait ends at once and
  judges its check `fail` with that round's close code and message, instead of running out its 20–30 minutes.
- **Hand-written plans (G8A A7b).** `proposeAndApply` reads the active completion policy (`completion-policies/read`)
  and pads every required obligation to its minimum of required requirements (`padToPolicy`: the missing ones repeat
  the obligation's first requirement's kind and read paths), and sends the plan's own checks, installed when the
  person's `plans/apply` adopts it. E05 and waiting send `testCheck` (`node --test` over the plan's own Tasks, which
  write the tests it runs); B06, whose Tasks only read, sends `moduleCheck` (`node --test checks/module.test.mjs`, the
  fixture's assertions on `src/module.js`, `package.json` and `README.md`).
- **Goal waits end early.** `waitGoal` ends before its deadline, judged like a wait that ran out, when (a) the Goal's
  display headline is NEEDS_DECISION on a Task stop of the UI's 要决定 set (`src/ui/adapters/goals.ts:185`) and no card
  is left for the person (`the platform stopped: <code> on <taskId>`), or (b) nothing public changed for 32 minutes
  (above the waiting scenario's 30-minute wait plus a heartbeat) and the meter's last complete reading has nothing in
  flight in the project (`stalled: …`, with the last phase, cause and driver wait reason). "Public" is the Goal's
  display without its `sourceCursor` (the ledger-wide watermark that any commit in the project moves) and its cards.
  例外（11-18）：E05、E09、int、E08 传 `returnOnDecide`，(a) 时平台停下等人照常返回、记下停因，各判据照常判，不记成超时。
  E08 在改需求采用后把 `versions`、`switch` 当场判掉。
  E05 的停住在检查执行窗口时，先用驱动读快照自己的 `taskId`；其次是快照 `last.value.receipt` 的结果为检查轮时用它的 `taskId`；
  再没有就看 `siblings` 里唯一一条检查停因的任务；还定位不到就用现有检查轮读口（gate 用 `taskRef`，work 用 `subjectRunRef`）找唯一一个执行中的任务（有读失败就不定位），
  再用该 `taskId` 读一次 `workflow/driver-read`，把 `current`、`last.value.receipt`、`reason` 写进 notes（只给 E05 写）；判法仍是停住记 fail。
- **返工确认卡（lead 11-17，E08）。** “每步确认”下自动返工要人确认的卡（`automation_confirmation_required`）没有选项，`waitGoal` 照界面点一次“重新入队”（`tasks/requeue`，`requeueCard`）；每张卡只点一次，被拒记一行 note。
- **E08 改需求（P6HD）。** 提交改需求时 sub 已有 Run，立即把 `hold-before-adopt` 记 `not-run` 并写明 sub 早于提交多少秒被领；
  领取时刻取每个 Run 的 `outbox.claim.claimedAt`，提交前已观测到的 Run 直接计入基线，其余只有严格早于发送的领取才计入；
  同毫秒不判先后并写明原因，领取读失败记 `env-unavailable`。
  采用后先判 `versions`（列表读失败记 `env-unavailable`，读到了但不足两版才 fail），再用采用版本的 `tasks/query` 当场判 `switch`
  （div 出现、sub cancelled/superseded、mul 仍 active、采用版本的处置记录；superseded 的 `replacedByTaskId` 必须指向 div；
  采用版读失败记 `env-unavailable`，收尾再读一次，`required-cancel` 仍取证）；`old-evidence` 等 Goal 等待收尾后用采用时的 div 任务读它的检查轮
  （最新的 Run 按各自领取的 `outbox.claim.claimedAt` 定，同一毫秒按进入游标 `startedSince`；按 `roundRef` 核采用版本；
  Run 列表或最新一轮读失败记 `env-unavailable`，不选轮、不退到更早的轮；Goal 完成但没有轮记 fail，还没轮记 not-run；
  Goal 完成但必需要求仍 pending 记 fail）；合法的 `no_new_basis` 停止不再被记成某条判据的 fail。
- **等在途的查询（lead 11-17，G6 第六次之后）。** 查询还在跑、它的某个请求用量暂时未知时，计量只是暂停：场景的等待和收尾原地每 20 秒读一次，等查询结束、暂停解除；30 分钟还没结束，才成为整轮的停止（`budget.mjs` 的 `#waitHeld`）。
- **Verdicts.** Three words only: a failed check → `fail`; none failed but one not run → `uncovered` with one of the
  seven reason codes; all ran and passed → `pass`. An existing capability that ran and did the wrong thing, or did not
  happen in time (a refused route, no Goal card draft, a failed adoption, a wait that runs out), judges its check
  `fail` with the platform's words; a missing entry or an environment cause with evidence is `uncovered`; the checks
  after a stop are `uncovered (not-run)`.
- **What a check reads.** Histories are split by turn identity (Kernel `runId` + `turnId`): a turn's actual input,
  its successful tool results, its final answer (and an accepted submit's arguments, e.g. `submit_exec_review`). Each
  check reads only the part it is about; what the public reads cannot show is `uncovered`, never a pass.
- **Wall table.** Every refusal is its own row: each HTTP refusal when it happens (refusals the step expects too,
  flagged `expected`), and each tool refusal in the public histories (one row per call, at its own time, collected
  at each unit's end and before each last close). Only successful polled reads fold. Category only from a named
  basis: 协调 (busy, version, idempotency, stale source, capacity), 安全 (the reason names an irreversible, external or
  secret basis), 产品规则 (the reason names a rule), otherwise 无理由.

### After the communication split (P2–GL; P6, lead rulings 11-25)

- **Direct intervention.** The person's message to a line is the UI's own request (`flows.mjs` `interveneLine`):
  `messages/send` with `entry: 'person_intervention'` and `needsReply: true`, no `intent` (refused since P2), no
  `wake`; only a committed write with `sendStatus: 'sent'` counts, otherwise the step fails with the platform's words.
  Messages are read through `messages/view` / `messages/body` (an inbox item carries only a bodyRef); the task card
  through `graph/detail` (`taskCard`: holds, dispatch, stop steps). The driver never releases a claim hold for the
  person (ruling Q1).
- **Cold start questions (C-216).** An initial coordination round may answer with questions (`needs_decision`) plus a
  card draft; `coldStart` answers on the same request (`PLAN_QUESTIONS_ANSWER`) and confirms only a round that carries a
  plan.
- **Goal waits, P2 additions.** `waitGoal` also ends two quiet minutes after the driver read says the claim is held
  (`claim_hold_held` / `scribe_stop_held`, nothing in flight, no card in hand: `the platform stopped: <reason>`); a
  `message` card the person answered and the asking agent has not recorded as applied is not in the person's hand
  (the count is noted). `approve` picks an `action_release` card's `approve` option by id.
- **Candidate adoption (P6H).** `waitGoal`'s `adoptCandidates` (only `int` passes it) acts on a candidate card that
  offers `adopt` as the person would: `plans/apply` with the card's Goal and proposal pins; only a committed apply is
  noted, `revision_conflict`/`busy` wait for the next poll, any other refusal ends the preparation. `broken(..., null)`
  records a prerequisite stop as `not-run` without failing a check.
- **E08b.** E08 under `after_plan_confirmation` with `sub` already running (ruling Q4): after every scenario and B06,
  only when `E08b` is in the authorized `scenarios` list; reported in its own section, not a `result.json` row.
- **P6 accounting.** The wall table also marks the three P6 kinds, matched on the platform's own words (ruling Q10):
  派工版本拒绝 (`dispatch_task`, `revision_conflict`, "the dispatch basis moved"), 问答轮发不出 (`QUERY_WAIT_REFUSAL`),
  注记读口 (`look_graph`/`find_graph` refused naming notes). The budget lines add the reported input (without
  reservation bounds and unbilled zeros) and the over-budget stops; the report adds model calls (each
  `model.request_started` in the public histories) and wake rounds (`intervention-planning-` turns) that only
  acknowledged (ruling Q11: successful calls only read tools and the reply).

## Output (`docs/refactor/reviews/evidence/slice9-rerun-<date>/` unless `--out`)

- `result.json` — the eight scenario rows, the spec's fields (`slice-9-SPEC.md:729-745`).
- `README.md` — `total=8 / pass / fail / uncovered`, A/B, compaction, attached, B06, wall-hit count, budget, lag.
- `checks/http.jsonl`, `checks/model-calls.jsonl`, `checks/commands.txt`, `checks/notes.md` (every check with its
  note, the wall-hit table, the budget lines, the lag summaries).

## Files

| File | What |
|---|---|
| `run.mjs` | CLI: precheck, Hosts, the order (A1, B1, the eight, attached, B06, E08b, compaction), rows, report |
| `lib/http.mjs` | the two prefixes, the token header, `graph_write` envelopes, the call log |
| `lib/host.mjs` | start/close/restart a Host, the token read |
| `lib/flows.mjs` | the person's shared steps (open project, provider, cold start, new Goal in an initialized project, explicit plan, cards, waits) and the scenario record |
| `lib/budget.mjs` | the token meter and the caps |
| `lib/lag.mjs` | the event-loop lag probe |
| `lib/report.mjs` | result.json, README, checks/* and the seven reason codes |
| `scenarios/*.mjs` | one module per scenario (`e08b.mjs`: the P6 variant of E08) |
| `cells/*.mjs` | A1, B1, compaction, the attached Goals, B06 |
