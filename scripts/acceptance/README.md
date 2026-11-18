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
  两种结束都记成未覆盖，不算通过。
- **11-18 驱动修正（G6 第十一次）。** 平台停下等人时，场景记下停因，其余不依赖目标完成的判据照常判（`waitGoal` 的
  `returnOnDecide`，只有 E05、E09、int 传）。B06 等轮时替人批 `member_creation` 建线卡；轮定下后暂停，并像人一样取消
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
  例外（11-18）：E05、E09、int 传 `returnOnDecide`，(a) 时平台停下等人照常返回、记下停因，各判据照常判，不记成超时。
- **返工确认卡（lead 11-17，E08）。** “每步确认”下自动返工要人确认的卡（`automation_confirmation_required`）没有选项，`waitGoal` 照界面点一次“重新入队”（`tasks/requeue`，`requeueCard`）；每张卡只点一次，被拒记一行 note。
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

## Output (`docs/refactor/reviews/evidence/slice9-rerun-<date>/` unless `--out`)

- `result.json` — the eight scenario rows, the spec's fields (`slice-9-SPEC.md:729-745`).
- `README.md` — `total=8 / pass / fail / uncovered`, A/B, compaction, attached, B06, wall-hit count, budget, lag.
- `checks/http.jsonl`, `checks/model-calls.jsonl`, `checks/commands.txt`, `checks/notes.md` (every check with its
  note, the wall-hit table, the budget lines, the lag summaries).

## Files

| File | What |
|---|---|
| `run.mjs` | CLI: precheck, Hosts, the order (A1, B1, the eight, attached, B06, compaction), rows, report |
| `lib/http.mjs` | the two prefixes, the token header, `graph_write` envelopes, the call log |
| `lib/host.mjs` | start/close/restart a Host, the token read |
| `lib/flows.mjs` | the person's shared steps (open project, provider, cold start, new Goal in an initialized project, explicit plan, cards, waits) and the scenario record |
| `lib/budget.mjs` | the token meter and the caps |
| `lib/lag.mjs` | the event-loop lag probe |
| `lib/report.mjs` | result.json, README, checks/* and the seven reason codes |
| `scenarios/*.mjs` | one module per scenario |
| `cells/*.mjs` | A1, B1, compaction, the attached Goals, B06 |
