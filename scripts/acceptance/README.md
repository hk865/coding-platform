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
  adoption (`src/app/host-settings-types.ts:191-203`), which is the real product path. So E05 and B06 (and B06-W5's
  non-Git project) first run one small cold-start Goal, then the explicit `goals/create` → `plans/propose/apply` Goal.
- **Planning rounds.** The Host's idle consume pass runs once a minute per workspace and takes an
  `intervention_planning` Query through its stages in one pass (G7 W2: submit, claim, prepare + start; the proposal
  once answered). So the first planning request comes within about a minute of the `refine:` round (A1/B1 wait up to
  30).
- **Plan-round questions.** When a plan round answers with questions (`needs_decision`) instead of a candidate, the
  person answers in the same request: one follow-up, "按你推荐的做法；没提到的按最简单的处理", at most twice, recorded
  in `userCommand`, then the candidate wait (`lib/flows.mjs` `answerPlanQuestions`; iteration: the change round and
  the second request).
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
  display headline is NEEDS_DECISION on a Task stop of the UI's 要决定 set (`src/ui/adapters/goals.ts:195`) and no card
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
- **平台没把轮跑起来（P6I D1–D3，P6 第三次补跑之后；lead 11-26 返工）。** 计量每次完整读数记下每个在途 QueryRun 的 `(revision, phase)`、它没变的起点 `since`、
  这一页读数返回的时刻 `seenAt` 和 Run 所在的工作区 `runScope`（`budget.mjs` `#queryState`、`#pages`）。Session 卡的占用指向别的工作区里的 QueryRun 时，
  记下它的完整引用，此后每次读数都按完整引用到 Run 所在的工作区追读，占用释放了也照读，终态用量入账后才放下（`#elsewhere`、`#dropCounted`，r3）；
  Job 已换了新 attempt、旧的那个从这里读不到了，计量停下。QueryRun 的键按固定字段顺序生成（`queryRunKey`：领取保留调用方传的引用，字段顺序可能不同）。
  在途按 Session 的工作区或 Run 的工作区算，哪一个在范围里都算，同一个 Run 只收一次，在途数按收进来的条目算（`inFlight`，r3）。
  Host 重启（`watch` 换了 Host）时清空计时和旧的在途快照，新 Host 第一次完整读数之前不判停。
  一个 Query（Session 或 Run 在这个项目的工作区）停在 `claimed` 或 `prepared`、`seenAt − since` 到 5 分钟，再按完整 QueryRunRef 去 Run 所在的工作区
  `queries/read` 一次，版本和 phase 都没变，才判平台没把它跑起来：这一个公共判断 `flows.mjs` `stalledEntry`
  让 `waitGoal`（`endedEarly` 的 (c)）、`waitCandidate`、`waitRequest` 和 E08 的 `waitChangeCandidate` 当场结束，note 写 QueryRun、phase 和起点时间。
  等运行名额（`admissionWait`）超过 5 分钟的只在 note 里写一次“等运行名额…不算停滞”（按完整 QueryRunRef 加起点去重），不判停。
  E08 等改需求候选的等待结束、没拿到候选时，再读一次候选（`lastChangeCandidate`，r3）：E08 保留原硬截止，候选读回时已过 30 分钟的绝对截止就记超时、不采用（轮询和终读一样，P6LO E08）；
  E08b 传自己的终读判据（`isUsableHead`：`candidate`，或 `closed` 且 head 已 `accepted`），等待和终读共用这一个判据（P6L3 item 1/4）。
  读不到就写读不到，候选在、但不是可采用的 head（过时、没采用）就写它的状态；确实读到没有候选，才直接读改需求的最后一轮
  （不算路由轮和被吸收的轮）的 Job 和 Run、核对完整引用：Run 按 `not_entered` 结束归平台（平台没把轮跑起来）；有回答或实际进入的证据、却没出候选，才归模型；
  还在进入之前写“还没进入 Kernel”，别的结束（`unknown`、Kernel 读不了）写“无法确认是否进入”。收尾的 `cancelItem` 按回执的 `stop` 判：`stopping`、`stopped`
  走原来的排空；`not_running` 先重读这一轮：已换了 attempt、已关闭或已回答就继续收尾，还占着线或读不到才记“平台没停下进入之前的轮”。停止和重读都发到 Run 所在的工作区。
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

### P6J (after the fourth rerun, lead 11-27)

- **E05 overlap attribution.** Two Runs on different lines whose intervals overlap pass. Otherwise the judged reason is
  read from the module gate: a gate that was waiting for the later Task while the earlier Task's Run ran (`goals/overlap-gates`)
  used the parallel opportunity up, so the check is `uncovered` with the gate, its waiting/running Runs and the release
  time when a release committed; without a readable satisfaction time (a note may have satisfied it) the missing
  evidence is named, and the gate must name the later Run's own attempt (`waitingAttempt`). No blocking gate is judged
  against the actual claimable moment read once before the first Run (`graph/detail` `dispatch.claimableNow`): both
  claimable then and serial is `fail`; not both claimable is `uncovered (not-run)`; an unreadable moment is
  `uncovered (entry-missing)`. Only a `released`/`committed` release counts; a `rejected` one does not.
- **E05 duplicates, mechanical positive.** The fixture plants one same-name top-level definition in
  `src/legacy/contact-check.js` and `src/legacy/path-join.js`. The check passes only when a successful
  `project_source(duplicates:true)` candidate names exactly those two paths (`duplicate-candidates.ts:84-101`); "different
  name, same rule" and "same name, different rule" stay with the reviewer.
- **E05 temporary (SK L5).** Temporary files are read from the work record (the successful results' `changedPaths`), not
  from untracked files: a written path outside the plan and `.workbench/` that is gone at the end was taken back; one
  still there fails; no such path or an unreadable history is `uncovered`.
- **intervention.** The whole-Goal wait passes `check: null`: a timeout or the platform's own stall keeps its real
  reason (`WaitTimeout.message`) and the checks that can be read on their own are still judged. Every direct send
  carries the page's `goalRef` (the line name's Goal, else the selected Goal, `member.ts:449-450`, `boot.ts:2040-2052`);
  the completed-Goal branch only messages a line whose page shows that Goal. The paused
  message is read at three moments (before the pause, after the resume, before the unit drain) with `deliveredTo`,
  `acceptedInputs`, the line's consumable state, the Run's last event and its pointer control.
- **C-216 observed-start.** A module path covers a file when it is `"."`, the file itself or a directory above it; the
  old `startsWith('src')` is gone. A pass needs an observation of the existing repository read before adoption
  (`coldStart`'s `beforeAdopt`) and adopted module paths that cover a real seed file. An empty path list records the
  candidate's and the adopted version's module counts and paths and cannot pass; a missing read is `entry-missing`.
- **E06 prerequisites.** E05 shares a continuation object (a real project plus a line that ran work) even when its Goal
  stopped for a person. E06 takes the project over and moves the usage attribution only when that object exists and
  `E05.settled` is true; either missing item is named and the unit stays `not-run`.
- **waiting observation order.** `followChain` tracks the first question, its follow-ups and the independent README
  second question on every poll. `reply-first` and the transfer cell share one letter snapshot (`expiredAt`,
  `response.respondedAt`, `acceptedInputs`), so a reply after the expiry is never written as "reply first"; an open
  second question with a qualified receiver is re-read and transferred once; a reply that came
  first leaves the transfer `not-run`. Immediately before the disconnect archive the open waits are re-read and only a
  still-open wait with a recipient is a real object. `supply-order` stays `not-run`.
- **Evidence for the fifth run.** E05 keeps both Tasks' rounds with failing checks and Run `exitCode`, the rework
  records and the waiting card kinds. E08/E08b keep each round's `kind`/`ideas.length`, the round's calls and refusals,
  the selection receipt re-read after `select-idea`, the candidate's `draft.tasks[t-sub]` and `proposalRef`, and the
  adopted rows plus `dispositionRecord`; E12 keeps the adopted `planRef`, each `scope`, the gate coverage and the work
  rows' `execution`; E09 keeps one chain object; the paused intervention keeps its three moments. A failed evidence
  read is recorded as unreadable with its own words, never folded into an empty list or `none`. All use existing reads
  only.

### P6J2: the fifth run's corrections (lead 11-27)

- **E05 overlap.** A gate is matched by its waiting Task, plan and the Attempt it named; `waitingAttempt: 'none'` is the
  first claim before any Attempt, so the gate the platform opened then still counts. The gate's running Runs, the
  release time and every claimable sample taken while only one Task has a Run decide the attribution: a release while
  the earlier Run still ran (or a later Task claimable then) is a missed parallel chance, a gate released after that Run
  ended used the chance up, and a failed gate read is `entry-missing`, never an empty gate list. `temporary` reads only
  a file the work record explicitly names (written and later deleted); a path that was only written is `uncovered`.
- **C-216.** The raw `architecture/observation-state` answer is fixed before adoption; the adopted plan's
  `effectiveArchitectureBaseline.ref` fixes the catalog version read by `architecture/read` (`selection: revision`).
  Candidate and adopted module counts, paths and version are recorded separately; a failed observation or adopted-version
  read is `entry-missing`, an empty path list fails.
- **E06.** The continuation object keeps only Runs that started and the work lines they claimed. E06 checks that the
  line it hands off from is one of those lines before sending.
- **Waiting.** The first chain and its follow-ups keep their own read gaps; the independent README question is tracked in
  the same polls, re-read, and transferred once by the archive request's own `wait.transfer` when it is still open (a
  standalone `waits/dispose(transfer)` is refused for a live sender line). A reply first is judged on its acceptance and
  the transfer stays `not-run`; a second-question read failure never
  enters the first chain's evidence. Before the disconnect archive the same `messageRef` is re-read; consumed, withdrawn
  and cancelled waits are not open objects.
- **Evidence in the report.** `result.json` rows carry the scenario `facts`; attached cells and E08b carry theirs in
  their notes. The scenario facts drop the live Host/client (circular) and keep the project's public fields.

### P6J4: the third quick check's open rows (lead 11-27)

- **E05 overlap.** Running claimable samples are aligned with the conflict they are about (`claimableWhileRunning`):
  a matched gate's own running Runs and the Run it held back (a rework Run too), else the two Tasks' first Runs; the run
  also samples while a gate holds a Task back. The start-time "both claimable" decides only with a whole gate list and
  no gate on the later Task: a gate opened after the start may hold the second Task until the first Run ends.
- **E05 temporary.** Operations are read from the real tool replies in recorded order (`at`): the Kernel `edit` writes;
  `shell` deletes only the paths its command names for `rm`/`unlink`/`git rm`; any other change is unknown. A change a
  recognized delete follows is a temporary file; an unknown change gone at the end, or a delete with nothing before it,
  is a named gap. An older check round the Host refuses is a named gap in `result.json` (`recordE05Evidence`).
- **E06.** E05 publishes its continuation object even when stopped for a person (`publishContinuation`). The handoff
  goes to the live started Work on a line chained to an E05 Session (`handOffOnContinuation`), never to the line the
  restart happened to resume on; none such is `not-run` with what ran where.
- **E09.** Queries are read by their exact Job ref (`queries/read` takes only a `QueryJobRef`; `sessions/queries` lists
  QueryRun snapshots), plus the letter's own deterministic Jobs (`letterQueryJobRefs`, `query-job.ts:174-204`). Only a
  Query opened from this letter on the recipient line (or not yet claimed) is its wake, with its submit and entry; the
  chain keeps its own read gaps.
- **intervention.** The idle send and the whole-Goal wait are shared functions (`idleWatchStep`, `afterLongWait`); after
  a timeout the idle cell is still judged. Each of the three moments keeps the line's SessionCard (availability,
  occupancy) and every control intent the Run points at with its own state (`controls/read`).
- **waiting.** The receiver is chosen every round from the line's SessionCard (`receiverFor`: an eligible reply target,
  `mailbox-archive.ts:76-84`, so a line being archived or retired never). The last round after the chain always re-reads
  the same letter (`closeSecondQuestion`; an attempt only forbids a second transfer). A transfer is judged only on the
  close-out's final reads (P6LO B9); a failed final read is an evidence gap.
- **E12.** Adoption to close is one function (`adoptAndClose`) that writes `rec.facts.e12` and its `final` itself.

### P6J4b: the last quick check (lead 11-27)

- **E05.** Gate records are kept per `(ref, basisDigest)` (`observeGates`), each with its own release. A gate naming an
  old Attempt holds back that Attempt's successor (`previousRun`, `heldBackOf`); each gate and the first serial stretch
  are judged on their own windows (`judgeGate`). A sample counts only when its whole card-reading interval (`at`–`until`)
  lies inside a conflict Run and before the held-back Run started. `shell` deletes are read from top-level, unquoted
  `rm`/`unlink`/`git rm` only (`shellCommands`); a recognized delete of a file still there at the end, never written
  again, is a gap, not a fail.
- **E06.** A failed read while picking the handoff target is `uncovered (env-unavailable)` (`handoffStep`), never
  `broken()`; with no trusted predecessor line the archive records its own gap.
- **waiting.** A failed last read after a refused transfer is a gap (the refusal stays evidence); a reply whose
  acceptance cannot be read is `uncovered`, not a `reply-first` fail (`consumingAcceptance`, `check: null`); a line list
  or card that fails while choosing the receiver is a gap, not "no eligible line" (`receiverFor` answers `{row, gaps}`).
- **intervention.** Control evidence reads the Run's `controlState.intentRef` (pause/resume/cancel) and `controlInputs`
  (steer), deduplicated, plus the pause pointer noted just before the resume (`rememberControls`).
- **E09.** The letter's frozen read-only copy line counts for an `ask_copy` wake; the polls keep their last read gaps
  (`followReceived`) and `adviser-explains` is judged after them (`adviserExplainsVerdict`): a failed read is
  `env-unavailable`, only a complete read says "not handled yet".

### P6K/P6K2: the fifth run's driver fixes and their rework (lead 11-27)

- **E06.** `same-task-new-run` first finds the new Run of the interrupted Run's Task (`resumedRunOf`): the FIRST new
  Run after the restart boundary (the interrupted Run's `endedAt`, falling back to the driver close moment), including
  already-ended Runs, ordered by `startedAt` rather than storage index. Then it reads that Run's brief (`readBrief`,
  `judgeSameTaskNewRun`), never the last Run `executions/list` returns (storage index order,
  not time). `executions/brief` answers `{status:'ready', value:{brief, digest}}` (`runtime.ts:687`), so the brief is
  `value.brief`; `ready(null)` (no brief) and a failed read are different gaps. No resumed Run or no readable brief is
  `uncovered`; a Run whose brief was read but whose Task, line or continuation relation is contrary
  (`resume_after_interruption`, `previous.runRef`) is `fail`.
- **E12.** One full `core/bootstrap` read (`profilePin`) pins the workspace's profile ids before `plans/apply`
  adopts the first plan; a genuine empty list is sent as `[]`, while a failed read keeps its answer, is `uncovered`
  (`env-unavailable`) and sends no replay. The Host's own first start is `select_work` with `flowId`
  `plan-adopted:<goalId>:<planId>` (`host.ts:2989-3002`). `adoptAndClose` reads the driver, verifies that identity
  and replays that advance once with the pinned ids — no public field names the seed. `CollaborationSnapshot` has no
  "replayed" marker, so the replay passes only on that flowId and no *new* RunRef/QueryRunRef in a short (2 s)
  window, compared by ref identity rather than a workspace-wide count (archiving one line and opening another does
  not change the count). A Query is attributed only by its own
  `run.executionState.prepared.requestEffectiveGoalId` (never the line's display name); a ref that started before the
  send boundary is outside the window, while a new ref of this Goal, a ref whose attribution or start time is unclear,
  or an incomplete read is `uncovered`, never `fail`; a ref provably of another Goal is excluded. `busy`, `unavailable`, an empty body
  (`null`), `unparsed` and `ready(null)` are `uncovered` with the original answer kept; only a formal `rejected`
  whose code is neither busy nor unavailable is `fail`; a different flowId is `fail`; only an observed first start
  says "目标已自动运行".
- **intervention.** Both idle probes (`idleWatchStep`) read, together and immediately before the send, the line's
  `sessions/read` availability and occupancy and the complete `sessions/queries` list; a busy line or a failed read
  does not get the probe, the holder/gap is recorded in `watch.busy` and the existing 10 s watcher and long-wait poll
  retry. Each of the two letters gets one evidence point (Task state, line availability/occupancy, Query, Work Run) at
  its first observed association — delivery (`deliveredTo`/`acceptedInputs`), a planning Query, or a `consumedWait`
  naming the same `messageRef` — without waiting for delivery or a settled disposition, beside the send snapshot; a
  same-line Run that does not name the letter never locks it. The point's Goal is
  the one the letter names (`message.goalRef`/`taskRef`), else the Goal of the Run or planning Query it opened, else the
  send-time snapshot with the missing fields as a gap; it never invents a Goal. The point and the claim verdict share
  one `executions` read (`claimSnapshot`, `claimVerdict`): `runs: null` means that read failed, so the verdict is
  `env-unavailable` and never says the target loop claimed the Task.
- **iteration.** `what-changed` (`judgeWhatChanged`) checks that the second candidate exists, its ID changed and
  `previous` points back to the first; it then reads the saved plan round's `summary` (never the whole answer). A
  summary with `未改`, `没改`, `不变`, `原样` or the whole English words `unchanged`/`no change` does not pass; otherwise
  a Chinese topic word (`解析`, `依赖`, `库`), the whole English word `argv` or `changed`/`change`, or a Chinese change
  verb (`改`, `变更`) passes; neither is `uncovered (not-run)` with the original in notes, never a fail; an unreadable
  summary is an evidence gap. If the change round's candidate read answers without a `second.head` (or fails), the
  checks that need that candidate (`why`, `cards-ask`, `multi-round`, `per-request`) are `uncovered (not-run)` instead
  of throwing; the `what-changed` and `continues` verdicts already written stay.
- **waiting.** After the chain, one evidence note keeps the letter's `expiredAt`, the interjection Run's final answer
  and `endedAt`, the Task's satisfied moment (`reduction.reducedAt`; the satisfying Run's `endedAt` is recorded
  separately), the continuation Runs and the last successfully read letter's `acceptedInputs` with each
  `executionRef`; when the chain read nothing, that is a gap and the last previously known acceptance is kept instead
  of falling back to the older expiry-poll re-read. The existing expiry poll also keeps a window point with
  `expiredAt` and the observed `observedAt` separate and one reading each of the original Run, the Task's
  eligibility/phase and the line's occupancy. It never claims a claimable window exists: with every read present but
  the Task eligible, unsatisfied and the line free it still says "无法确认可领取", because `eligibility` is only the
  Task-state check while the platform also checks claim deferral/occupancy (`plan-service.ts:1032`,
  `workflow.ts:2936`); only a proven skip (satisfied/failed/ineligible) or a held line names its reason. The evidence
  and the `consumes` verdict are one exported entry (`finalizeWaiting`), so an empty `tasks/query` body is a gap and
  the real verdict after it still runs, never hand-written in a test.

### P6L: the sixth run's two driver fixes (lead 11-27; `p6r6-diagnosis.md` waiting/intervention rows and items 4-5; `run-7d2-p6l.md` items 5-6)

- **waiting.** Archiving the sending line is the one `sessions/archive-line` call with
  `wait: {kind: 'transfer', runRef, messageRef, to}` (`session-archive.ts:15-18`); the separate `waits/dispose` call is
  gone. A rejected archive keeps its first refusal raw and the same letter is re-read before it is judged; a reply that
  follows the refusal keeps that refusal in both cells. `reply-first` and the transfer cell come from one
  `replyFirstVerdict` on one letter snapshot (`expiredAt`, `respondedAt`, `acceptedInputs`): expiry first is
  `uncovered` in both cells, and a reply before the expiry that its response acceptance consumes passes. An archive
  first receipt is not the judge: at close-out the same letter is read again after the archive, and it passes when its
  handler is the intended receiver, its `archiveWaitDisposition.kind` is `transfer` and the sending line's
  `record.lifecycle` is `archived` (P6L3 B9). A failed final letter or sending-line read is named as a gap. The first receipt and any inner refusal stay in the note; a
  `pending` first receipt no longer fails a transfer the final letter shows moved. P6LO B9: every archive attempt, also
  one a reply followed, gets these final reads and nothing else judges it (no fallback to an earlier letter); the final
  deadline is compared with the one read before the archive; a proven transfer leaves `reply-first` `not-run`.
- **intervention.** Before the pause, the pause cell reads the line's `currentWork` and `lineBusy`; without a work line
  or a running Run it is `uncovered (not-run)` naming the missing item, and no pause, queued message or resume is sent.
  `lineBusy` keeps its failed `sessions/read`/`sessions/queries` reads as separate gaps (`readable`), so a read failure
  is `uncovered (env-unavailable)` naming the read, never proof that the line is busy. The running Run and the line's
  current work are the same Task only by the full `{projectId, goalId, taskId}` triple; a missing id never passes
  (P6L3 B11). Only a `committed` resume samples the after-resume point and enters the post-resume branch. After the
  resume each tick of `observeAfterResume` reads the same `messageRef`'s delivery and its planning Query, keeps the
  readings, and ends on either branch or at the deadline; a scenario-budget stop returns those readings, the cell is
  judged once, and only then the stop is thrown (P6L3 B10). A pause violation is judged before the resume receipt: a
  letter already delivered into Work while paused is `fail` (MVP-BEHAVIOR.md:378), whatever the resume answered
  (P6L3 B12); an unreadable paused disposition stays `uncovered`. A proven-busy line whose offerable letter still times out is
  `fail`; a missing premise is `uncovered` with the missing item named (`p6r6-diagnosis.md:22,64-76`;
  `run-7d2-p6l.md:49-52`). The idle line's claim evidence keeps the read gaps apart from a locked snapshot: an
  incomplete close-out read is `uncovered`, and only a complete read that really shows no same-letter association is
  `fail` (P6L3 A6).

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
- **E05 的种子目标（lead 11-26，E05-D1–D3）。** 种子目标的等待照 `int` 写成 `adoptCandidates: true, check: null`：人采用候选，种子停住记 `not-run`，不再把 E05 第一条没判的判据记成 fail。
  这次等待采用过候选、当前任务的停因是 `no_new_basis`、这张卡还没点过时，`waitGoal` 在停止卡上替人点“附上说明作为新依据”。P6L2 起这只是后备（RC R-5）：
  采用前用同一 Goal 的 `tasks/query` 把失败 work Task 的链头按 `runId` 记成一张表（`roundRef.roundId` 与 `revision`；`affectedTaskIds` 为空时取唯一失败的 work Task），同时记一次 `workflow/driver-read` 的 `last` 作基线（P6L3 D）；
  停止卡用自己的 `runRef.runId` 从表里取前值；采用后每拍读一次 `workflow/driver-read` 和 `verification/round`：链头变了留证、不点；只有 `last` 离开基线、是已结束的 `waiting` 选择、
  Goal 驱动不在 `running`（证明采用后的自动选择已结束、没有重检待执行；RC R-5，平台自己重检在先）才核对旧链头；每张卡只设一个 2 分钟期限，读回时已到期记未覆盖、不点，不再重开（P6LO D）；
  读到的 `roundId` 变了是后继（哪怕已 `finalized`）不点；没变、`finalized` 且有失败检查才点；`status === 'open'` 不点；
  `revision_conflict` 先复读一次，链头变了记 note 不点，没变记回执、不换 pin 重发。每张卡一次，按这一次的真实回执记成功或被拒；
  不点“重新入队”（任务定义没变，会再被 no_new_basis 拒）。
  (a) 支判停时，人手上还有驱动没采用的候选卡（沿 `nextCursor` 数完 `waiting_answer` 里带 `adopt` 的；有一页没读到或卡来源没读全，这一次不判，下一次重数），
  就写“平台停下等人：…；人手上还有 N 张可采用的候选卡（驱动没采用）”，
  不写成 `the platform stopped`。
- **Candidate adoption (P6H).** `waitGoal`'s `adoptCandidates` (`int` and E05's seed pass it) acts on a candidate card that
  offers `adopt` as the person would: `plans/apply` with the card's Goal and proposal pins; only a committed apply is
  noted, `revision_conflict`/`busy` wait for the next poll, any other refusal ends the preparation. `broken(..., null)`
  records a prerequisite stop as `not-run` without failing a check.
- **E08b.** E08 under `after_plan_confirmation` with `sub` already running (ruling Q4): after every scenario and B06,
  only when `E08b` is in the authorized `scenarios` list; reported in its own section, not a `result.json` row.
- **E08b 的末轮（P6L；`p6r6-diagnosis.md` E08b 行；`run-7d2-p6l.md` item 2）。** 在原候选等待的时限里，每次答卡后和收尾时都按同一
  `requestRoot` 重读 `requests/read`，按 `roundRef` 用 `roundEvidence` 追记新轮的回答、工具、调用和拒绝（不另写提取器）；最新一个
  有回答的轮给出 2–3 个思路且还没选时，只对这一轮调一次 `requests/select-idea`（已选、数量不在 2–3、只有更早的轮有思路都不选）；
  新轮是 `needs_decision` 时走已有的 `answerPlanQuestions`（每次调用只答一张卡，沿用总次数上限）；答卡提交后继续读同一请求，直到看到新轮或到绝对截止（P6L2 B5；P6LO B5：提交即记已答轮，不再先等各轮落定，只走这一层跟读，读失败和到截止都记 gap），
  观察性超时只记 gap、次数照加，不判格；按 `selectedIdea.round` 和本次回执去重，只选最新一个已回答、还没选过的轮。整个改需求等待共用一个绝对截止（P6L2 B4），
  终读用与等待相同的条件判“窗口内拿到可采用的 head”；没有则保留末轮和候选终读（`candidateRow`），三格照旧 `not-run`。同一个 `roundRef` 在收尾按最新状态重读并更新同一行
  （P6L2 B3），不在第一次见到时冻结。轮次日志读 `roundEvidence` 的 `roundRef`，不再显示 `?`。
  P6LO B4：每拍先读候选和请求，再最多做一个动作（答卡只写一次，不论成败；写之前按绝对截止核对，读信之后才核对）；收尾只刷新证据。
- **P6 accounting.** The wall table also marks the three P6 kinds, matched on the platform's own words (ruling Q10):
  派工版本拒绝 (`dispatch_task`, `revision_conflict`, "the dispatch basis moved"), 问答轮发不出 (`QUERY_WAIT_REFUSAL`),
  注记读口 (`look_graph`/`find_graph` refused naming notes). The budget lines add the reported input (without
  reservation bounds and unbilled zeros) and the over-budget stops; the report adds model calls (each
  `model.request_started` in the public histories) and wake rounds (`intervention-planning-` turns) that only
  acknowledged (ruling Q11: successful calls only read tools and the reply).

### P6L: the sixth run's driver fixes (lead 11-27)

- **E05's seed and the E06 handoff.** After the seed wait, `seedEvidence` reads the seed Goal's own check rounds;
  a failed re-verification keeps its `checkId`, exit code, the report's own `stdout`/`stderr` with their truncation
  flags, its raw `effects.changedPaths` (paths are never parsed from the output), its `chain.reverify`, and each read
  gap (`p6r6-diagnosis.md` E05 row; `run-7d2-p6l.md` item 1). A refused adoption (`adoptCandidateCard`) first reads
  `plans/proposal` and keeps the candidate author when the platform recorded one (a Host-written candidate omits
  `submittedBy`), its submission entry (`requestRef`/`sourceMessageRef`/`sourcePart`), its own check definitions and the
  raw receipt (status/code/reason and text) in `facts.refusedAdoptions`; the note says the candidate is model-written, so the
  driver does not rewrite it or invent a check id. The same wait runs in `seedRound`: a refusal still reads
  `seedEvidence` and keeps the failing seed round (check, exit code, stdout/stderr with truncation, raw paths) before the original stop goes on.
  The existing rule still stops the preparation (`check: null` in the seed is `not-run`). `publishContinuation` accepts
  only a started Work Run of the formal E05 Goal that a line claimed:
  a seed Goal's Run, a gate Run or a Run with no claimed line publishes nothing, while E06's takeover condition is
  unchanged (`p6r6-diagnosis.md` E06 row; `run-7d2-p6l.md` item 1).
- **E09's first case.** The first plan's two `parseDate` assignment texts are kept whole — each side's interface
  (`Date` and `{y, m, d}`) and the person's decision — with the plan ref/revision. The judge is unchanged; no
  "unified interface" or lost revision is inferred, and a first case that does not carry the conflict stays
  `uncovered (not-run)` with both texts kept (`p6r6-diagnosis.md` E09 row; `run-7d2-p6l.md` item 7).
- **C-222's member evidence (P6L).** From the adoption receipt's own plan, `tasks/query {goalRef, planRef}` fixes the
  real Task; the cell's two checks are unchanged. `committedAnswers` from `waitGoal` keeps an answered
  `member_creation` card (`cardKey`, Task, operation ref, its own `senderSessionRef`/`requestRef`/`state`, and
  `initiatedBy`: the sender's Session id, or `platform` when the card has no sender). `memberCreationEvidence` reads
  the secretary's `requests/read` rounds and each adviser line's `intervention_planning` rounds: `roundEvidence` keeps
  the frozen `create_member` grant (`toolNamesOf` over `requests[].prompt.toolSpecsRef` + `materials/open`), every call's
  `args`, its raw result (`created`/`reused`/`pending`/`needs_decision`/refused code+reason) and whether the call
  named the adopted Task; the suggestion letter's `taskRef` (`messages/view`) names the adviser round's Task. A
  `duty: 'unknown'` line (a role-config read failed, `work-line.ts:121`) is scanned too and the failed duty is a named
  gap. A `created` child line is read by `sessions/read` (`secretaryCreated`) and compared with the Work Runs'
  `claim.sessionRef`. Every failed segment is named in `gaps` and left null; the original check results are not
  rewritten, and a reuse path is never judged as a missing marker (`p6r6-diagnosis.md` C-222 row; `run-7d2-p6l.md`
  item 3).
- **E12's old Goal wait (P6L).** The old Goal's wait goes through `closeWithWait` with `check: 'completion-chain'`, so
  a timeout or stall is judged there, never on `reads-quiet` before the graph read starts; the scenario returns and
  leaves `reads-quiet` and the post-restart cells `not-run`. `waitOldGoalClosed` reads the adopted plan's task rows
  before the wait (`adoptionEvidence`: scopes, gate coverage, each row's `execution`) and again at the normal close or
  timeout (`closingEvidence`), storing `{atAdoption, final}` as `facts.e12OldGoal` without overwriting `facts.e12`. A
  failed row read keeps its own words and `planRef`, never an empty task list (`p6r6-diagnosis.md` E12 row;
  `run-7d2-p6l.md` item 4).

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
| `test/driver.test.mjs` | the driver's own checks against a fake Host (P6I r3); `node --test scripts/acceptance/test/driver.test.mjs`, outside the vitest suite |


### P6L2: the sixth run's rework (lead 11-27 21:2x)

- **E05's seed report.** A failed check keeps the report's own `stdout`/`stderr` with their truncation flags and
  `effects.changedPaths` verbatim; paths are never parsed from the output. An empty `changedPaths` writes
  “路径证据见输出”, never “路径无” (`checkReportOf`, `recordSeedEvidence`). A refused model-written candidate's note
  reads each check's `checkId` (a `checks[].id` would miss the real one); the fake Host uses the real shape, with no
  `submittedBy` and a request-root `requestRef`.
- **E06's restart cell.** `restart-running` is judged on the interrupted Run's own Session continuing after the
  restart (`continuedRunOnSession`), not on whichever live Work enters the handoff; a failed page in
  `executions/list` leaves `same-task-new-run` `uncovered (env-unavailable)` before any brief is read.
- **E12's replay window.** A Query is attributed by its own `run.executionState.prepared.requestEffectiveGoalId`, never
  by its line's display name; an added ref is ordered against the send boundary by its own `startedAt`, so a Run that
  started before the replay is not charged. A null attribution, a missing time or a failed list is `uncovered`.
- **waiting's window and acceptance.** The expiry window is reported as the observation it was (`observedAt`), never
  as the state at `expiredAt`; every successful read of the original letter updates the one last-known snapshot, and a
  failed chain read keeps that snapshot with its gap (`waitingEvidence`). The sending line's open `responsible` task
  links are read before the archive; a still active, unsatisfied Task gets its `drop` choice in the same
  `sessions/archive-line` request as `wait.transfer` (B8), or the Host refuses `archive_disposal_required`. The close-out
  re-reads the same letter and the sending line, and the transfer is judged on the actual `replyHandler`, the recorded
  `archiveWaitDisposition` and the original deadline; the first refusal stays in both cells (B9).
- **intervention's pause.** The premise needs an unfinished Task and a running Run of that same Task; a resume receipt
  that is not `committed` leaves the cell `uncovered` without a 30-minute wait. The post-resume wait only observes
  (`check: null`) and judges once at close-out. A letter already delivered into Work while paused is `fail`
  (`MVP-BEHAVIOR.md:378`), not the `uncovered` P6L wrote.
- **C-222's evidence.** A `create_member` call is for the adopted Task only on the full `{projectId, goalId, taskId}`;
  only matched operations feed the child-line evidence, and the Work claim is tied to that Task. The evidence (including
  `sessions/operation`'s caller, Task, progress and rejection, from the call result or the card's pin) is taken on a
  normal end and when the Goal wait times out.
- **E09's first case.** Only the first plan's two `parseDate` assignments and its `planRevision` are kept. “The two
  assignments were unified” and `conflictLostAtRevision` are inferences from keyword absence and are no longer written;
  the cell's own criterion is unchanged.
- **iteration on R2.** The request keeps `{goalId: 种子目标}` (the route under test). `request-goal` is
  `view.goalId === null && view.effectiveGoalId === null && view.source?.goalRef.goalId === 种子目标`; the idea count and
  empty `goalCardDrafts` are unchanged. After selecting an idea `goals/confirm-draft` gives `newGoalRef`, which every
  later `candidateOf`, `plans/request-candidate`, `plans/apply`, the second request and `waitCandidate` uses; every
  follow-up on a request root (`ITERATE`, the answers to plan-round questions on either request) sends
  `{continues: root, goalId: null}`, the same as the UI (INT2 C4 item 3; I-4 item 4 as corrected). `facts.seedGoal` and
  `facts.newGoal` keep both, and the note says the seed goal's completion opens a new goal through R2. After the
  confirm the driver sends nothing: the platform queues the planning round itself (INT2 C4 item 2) and the driver only
  waits for the `(newGoalRef, root)` candidate (20 minutes, `candidate`). When nothing was queued, the request's last
  round is the confirm's closed attribution round (`not_entered`), so the wait ends at once with `candidate` failed and
  the rest not run. When the queued planning round asks first (`needs_decision`), the person answers it inside the same
  20 minutes through `answerPlanQuestions` (the same cap) and the wait for the candidate goes on (lead 11-28, P6LO C4).
