# P6 第二次补跑只读诊断（第三轮，P6DG4）

- **运行：** `g6-2026-11-25-791056bc`，2026-11-25T08:34:47Z–12:27:04Z；八个主场景 + E08b。
- **树：** 当前目录 `/home/han001/dsh-work/slices/s97dp6dg4`，HEAD `7d6ac222`（平台 `d5c975eb` + 驱动六个提交 `415e91dc…7d6ac222`）；分支 `7dp6dg4`，起点 `7dp6dg4-base`。
- **只读：** 本轮不改代码、不提交、不起 Host、不调模型；白名单 `^$NEVER$`；产物只写 `./.dsh-ref/out/`。
- **证据：** 运行目录快照的账本（`sqlite3` 只读 `mode=ro&immutable=1`）、`checks/http.jsonl` 行号、`checks/model-calls.jsonl`、`checks/notes.md`、Host 日志、代码与 `docs-now` 规格的 `文件:行`。各子任务的完整报告在 `./.dsh-ref/out/p6d4/{e05,e08e08b,e12,waiting,e09wake}/report.md`。
- **口径：**
  - **平台** = `src/` 的行为不符合 `docs-now` 的规格或决定；
  - **驱动** = `scripts/acceptance/` 判错、等错或发错；
  - **模型** = 平台和驱动都照规矩，模型该做没做（含提示词/skill 缺口）。
  - 没走到的支路记 `uncovered` / `not-run`，不当 fail；`entry-missing` 只在公开入口确实缺失时用。

## 结论先说

1. **平台违反规格：0 条（本轮查的 E05/E08/E12/E09/waiting）。** intervention 另有诊断，不在本轮结论内。本轮范围的 fail 没有一条是 `src/` 偏离 `docs-now`：
   - E05 的检查窗口是 **VD-10 明文接受的停窗**（`STATE-MACHINES-SPEC.md:2993`、LA-6 `:6614`），只在 Host 启动对账时清；本轮 Host 从 08:34 活到 10:18，没人重启，所以 100 分钟没有推进。这是**规格缺口**，不是 P6G 回归，也不是 `src` 违反现行规格。
   - E08 的 `no_new_basis` 判据、E12 的 `g2` waiting、waiting 的三次到期/消费、E09 的“已完成目标不开新轮”都**逐字符合规格**。
2. **驱动：10 条**（其中 3 条只影响注记/记账，不改 pass/fail）。最要紧的是：
   - E05 的 `overlap` fail 是把“seed 检查停住、E05 主场景从未开始”误记成第一个未判判据；按 `scripts/acceptance/README.md:111-115` 与 `flows.mjs:44-47`，stall 仍记 fail，所以 **E05 的 verdict 不改**，但 `overlap` 这个标签不是重叠证据；E05 的 fail 应归到“stall/平台停窗”，不是 `overlap`。
   - E08 把合法的 `no_new_basis` 记成 `versions` fail，而 `versions` 实际已满足（2 版、人已采用）；真正该 fail 的是 `switch`/`old-evidence`。
   - E08b 的 `stop-delivered`/`safe-point-end` 仍按 lead 11-25 记 `not-run`（`e08b.mjs:116-118`）；模型 0 次 `request_stop` 是留给 lead 的 finding，不要先改这条裁定。
3. **模型：5 条。**（E08 的候选缺陷在 `versions` 与 `switch`/`old-evidence` 两行都出现，按一条计；其余是 E08b 无候选、E08b 无 `request_stop`（按 lead 仍 not-run）、E12 空覆盖计划、E09 人裁决链。）
   - E08 的改需求候选 `#213` 仍把 `task-sub` 留成 `active`，没有任务删 `test/sub.test.js`，所以 `switch`/`old-evidence` 应 fail。
   - E08b 的 `0ffa0460` 轮 4 次 `submit_plan_round` 失败后改交 `questions` 探针，没有改需求候选，也没有 `request_stop`。
   - E12 的新计划让 stage gate `g2` 覆盖 `[]`（唯一 work `t2` 是 goal 级），计划结构性不可完成。
   - E09 的首版计划把“人裁决”写成一条可满足的记录，gate 只查 `report.js` 的 import；执行者上报后没有 `waitAfterSend`，Goal 在信后 34.9 秒完成。
4. **不是 P6G 回归。** 五份报告逐项核了 `git diff 63ff3a0f d5c975eb -- src`：E05 没碰 check/verification/role-lines/chooser/task-gate；E08 没碰 `plan-validation`/`requeue-service`/`task-failure`/`decision-policy`/`plan-machine`；E12 没碰 gate 覆盖/计划校验/提示词包；E09 没碰消费/唤醒。**waiting 的 G3 正是 P6G 的改动**（`workflow.ts` 的 `carryWait`、`mailbox-access.ts` 的 `continuationWaitRight`，`p6g-rulings.md:37-51`）；本轮 waiting 走的是 starting Run 的同一次领取续驱，不是 crash-requeue/continuation 路径，所以 G3 的改动**未被触发**，不能写成“waiting 没碰 G3”。

**Verdict 不动：** 八个主场景仍是 **pass 1（iteration）/ fail 4（E05、E08、E12、intervention；intervention 另有诊断）/ uncovered 3（E06、E09、waiting）**；E08b 仍是 **uncovered**。本诊断只改“哪条判据/哪个根因”，不改报告 verdict；E05 的 fail 是 stall（不是 `overlap` 证据），E08b 的 stop 两条按 lead 11-25 仍 `not-run`。要改 verdict 先有裁定，不能拿自写的共同口径改总数。

## 总表

> 一行一个根因；同一根因下的多条判据合在一行。`类别` 按上面的口径；“平台/规格”表示 `src` 符合现行规格，但规格本身接受了这个停窗，需 lead 改规格或驱动重启。

| # | 场景 | 判据（C 行） | 类别 | 一句话根因 | 关键证据 | 建议改法 | 谁改 |
|---|---|---|---|---|---|---|---|
| 1 | E05 | `overlap`（C-182/183/217） | **驱动（标签）/ 平台-规格（fail 根因）** | seed 的 `c-readme` 检查停住，E05 主场景从未开始；`broken()` 把“第一个未判判据”当 `overlap` 记 fail。按 `scripts/acceptance/README.md:111-115`、`flows.mjs:44-47`，stall 仍记 fail，**verdict 不改**；`overlap` 这个标签不是重叠证据 | `checks/notes.md:12`；`flows.mjs:44-47,49-53`；`e05.mjs:118`；E05 段 `goals/create`/`driver-start`/`advance` 各 0 行；账本只有 seed 的 Run `66bff0cd…` | 不要把 `overlap` 当重叠证据；若要让标签更准确，先给 `waitFor`/`broken` 一个显式“无判据”模式（`e05.mjs:118` 外面 catch 不清 fail，`Record.finish` 只补未判项），或在 seed 前置等待不落判据；改 `broken`/`waitFor` 会影响约 30 个调用点（`flows.mjs:167,730,799-800`、`scenarios/iter.mjs:56` 等），要整组核 | 驱动（下一组） |
| 2 | E05 | 其余 11 条 + 停住 | **平台/规格** | seed 的 `c-readme` 在 08:37:35.393 只写 `VerificationCheckBegun`，没有结果/证据/finalize；30 s timeout 未生效；VD-10 只允许 Host 启动对账清，本轮没重启；E05 的 fail 是这条 stall，不是 `overlap` | 账本 #171/#172/#174；round `759222b3…` `status=open`；`startup-reconcile.ts:516-538`；`check-execution.ts:151-153`；`STATE-MACHINES-SPEC.md:2993,6614` | 严格按现行规格**不改**；若 lead 要救停窗：① 改 VD-10，`check-execution.ts:155-173` 重试用尽后调 `interruptCheck`（复用 `startup-reconcile.ts:525-528`）；② 驱动在检查超过 `timeoutMs` 仍 executing 时重启 Host（无书面依据，标可选） | lead（规格）/平台 |
| 3 | E06 | 全部 12 条 | — | E05 没留下 handoff/continuation Session，`ctx.shared.e05` 未设置，E06 直接 not-run | `checks/http.jsonl` E06 0 行；`model-calls.jsonl` E06 0 行；E05 4 个 `SessionCreated` 全 `provenance.kind="new"` | 不改；E06 需要 E05 先走完 | — |
| 4 | E08 | `versions`（C-210） | **驱动 + 模型** | 两次 requeue 的 failure/source/plan/newInput 全同，平台 `no_new_basis` 正确；驱动把合法停止记到下一个未判的 `versions`，而 `versions` 已满足 | `checks/notes.md:75`；`STATE-MACHINES-SPEC.md:4690,4707`；账本 #279/#301（`basisDigest 9ec1…`、`source 62ea…`、`plan initial-plan-08e245…`、`newInputRefs []`）；`http.jsonl:135` | `e08.mjs:275-289` 在 `applyChange` 后先判 `versions`；`flows.mjs:239-242,52` 不把合法 `no_new_basis` 记成某条判据 fail | 驱动 |
| 5 | E08 | `switch`、`old-evidence`（C-210） | **模型 + 驱动** | 采用版 `#220` 里 `task-sub` 仍 `active`、`test/sub.test.js` 未删；div 的改后轮 `#278/#300` 已存在（`static-div-export PASS`、`node-test-all FAIL`），按现有数据应判 fail，不是 not-run | 账本 #213/#220；#278/#300；workspace `test/sub.test.js` 仍在；`e08.mjs:298,303-336` | 候选把 `task-sub` 改 `cancelled` 或 `superseded + replacedByTaskId`，并把 `test/sub.test.js` 纳入删除/替代任务；驱动在采用后立即判 `switch`/`old-evidence` | 模型 / 驱动 |
| 6 | E08 | `hold-before-adopt`（C-210） | **驱动** | sub 在改需求提交前 0.247 s 被领（09:28:11.337 claim，09:28:11.584 提交），驱动等待谓词“任一任务有 Run”立即返回，秘书已没有“未开工的 sub”可暂缓 | 账本 #133；`http.jsonl:62`；`e08.mjs:210-220,256-257` | 保留 sub-first 立即 `uncover`；或把改需求提交挪到采用后、把 mul 排前；**不要只改谓词**：`e08.mjs:219-220` 的 `waitFor` 超时走 `broken(...,'hold-before-adopt')`，sub-first 会 40 分钟后记 fail，和 not-run 相反 | 驱动 |
| 7 | E08 | `required-cancel`、`autonomy-later` | — | Goal 从未 COMPLETED；草稿本来就是 `every_step`，没有中途改档 | 账本 #302；`checks/notes.md:57,66` | not-run 正确，不改 | — |
| 8 | E08b | 改需求末轮无候选（C-210） | **模型 + 驱动（措辞）** | `0ffa0460` 轮 4 次 `submit_plan_round` 失败后改交 `questions` 探针；`requestRef=3f323670` 的 `PlanProposal` 0 条；平台没漏写候选 | `checks/notes.md:260-264,288-294`；账本 #188/#280/#316/#397/#400/#421；`e08b.mjs:114-125` | 模型按 `secretary-answer.txt:6` 重写（已跑任务只改 disposition/replacedByTaskId，新验收放新 obligation）；驱动只改措辞（`e08b.mjs:118` 记“交的是问题/探针”），不要改 lead 11-25 的 not-run 判法 | 模型 / 驱动（措辞） |
| 9 | E08b | `stop-delivered`、`safe-point-end`（C-210） | **模型（finding）/ 驱动（按 lead 仍 not-run）** | 0 次 `request_stop`；sub 的 Run 12:17:56.467 是自然 `completed`，不是叫停后的安全点收尾；但 `e08b.mjs:116-118` 的 lead 11-25 裁定明文“没候选 → stop/safe-point/adopt 都 not-run，never fail”，所以本轮 verdict 仍是 not-run | E08b kernel 全部 assistant 工具调用 `request_stop` 0 次；账本无 `TaskClaimHold`/`ActionRequest`；#207；`e08b.mjs:116-118,157-172`；`driver-build-reply.md:29`；`skill-platform-secretary.txt:33` | 保持 `e08b.mjs:116-118` 的 not-run；模型 0 次 `request_stop` 是 finding，若 lead 要改 fail，先改 lead 11-25 的裁定，再动 `e08b.mjs:121-123`；不要先改 verdict | 模型（finding）/ lead（裁定） |
| 10 | E08b | `adopt-after-end` | — | 没有改需求候选、没有采用；确实没走到 | 账本 #280；`requestRef=3f323670` 的 `PlanProposal` 0 条 | not-run 正确，不改 | — |
| 11 | E12 | `new-goal`（C-114/158） | **模型** | 新计划的 stage gate `g2` 覆盖 `[]`：唯一必需 work `t2` 是 goal 级，`g2` 是 stage `s2` gate；`advanceGate` 永远找不到 producer，计划结构性不可完成 | 计划 `initial-plan-73200e7c…`：`t2 scope={kind:goal}`、`g2 scope={kind:stage,stageId:s2}`、`gg2 scope={kind:goal}`；`decision-policy.ts:217-231,225` 复算 `g2=[]`、`gg2=[t2]`；`workflow.ts:1891-1896,3279`；`slice-PL-SPEC.md:256-264`；t2 Run `048f38b1…` 10:20:20–10:20:44、TaskCompleted #219 | 提示词补覆盖规则：`initial-planning-answer.txt:16`、`plan-review-input.txt:16`、`secretary-answer.txt:3` 写明“stage/module gate 只覆盖同 stageId 的 stage/module 级 work；有 stage gate 的段至少要有一条必需 work 用 stage/module scope”；不改平台调度 | 模型/提示词（lead） |
| 12 | E12 | `history-reuse`、`stale-premise`、`wait-registry` | — | 新 Goal 32 分钟停住，三项没执行；本轮 `waitAfterSend` 0 次；唯一重启早于新 Goal 的等待 | `checks/notes.md:117-120`；账本 `waitAfterSend` 0；`http.jsonl:306/331/349/364`；`e12.mjs:152-155` | 修提示词后重跑覆盖；不改平台/驱动 | — |
| 13 | waiting | `second-expiry`（C-171/190/224） | **驱动** | 第二封 `60e30e3c…` 到期后 99 ms 收到回复，`a23a44ce` 以 `part:response, consumesWait:true` 接受；按 §10.7 回复胜过到期，应 `not-run`，驱动写成 `env-unavailable` | `60e30e` expired 11:43:01.209 / response 11:43:01.308 / accepted 11:43:08.006；`STATE-MACHINES-SPEC.md:3650`；`wait.mjs:212-214,421-422` | `wait.mjs:212-214` 加 `secondAnswered`；`421-422` 当第二封的消费是 response 时记 `not-run` | 驱动 |
| 14 | waiting | `supply-order`（C-172/192/184） | **驱动** | `wait.mjs:545` 仍无条件 `entry-missing`；`535-544` 找的“已接受的输入”标题在 11 条 turn 输入里 0 次；`run.input_accepted` 已按顺序给出 sourceRef | `wait.mjs:535-545`；kernel `run 14c3c802` pos 61/62；`run a23a44ce` pos 95/96；`flows.mjs:939` | 改读 `run.input_accepted` 顺序写 note；只有连接受顺序都读不到才 `entry-missing`；不新增读口 | 驱动 |
| 15 | waiting | `restart-requeue`（C-170/207） | **驱动** | 关 Host 时 `35c436aa` 是 `starting`（11:37:38.828 领取，11:39:59.774 才 EntryAuthorized），不是 running；重启走 W-01..W-03 同一次领取续驱，无 `TaskRequeue`/新 Session；G3 未触发（合规），但驱动 note 写“仍在跑、记中断、按普通重新入队”不实 | 账本 #186；`startup-reconcile.ts:459-460,670-672`；`wait.mjs:352-354`；`commands.txt:68-69` | `wait.mjs:352-354` 输出 `run.status`，把 `starting` 与 `running` 分开，note 改成“claimed-not-entered，同一次领取续驱” | 驱动 |
| 16 | waiting | `late-reply`、`reply-first`、`transfer`、`disconnect` | — | 场景没走到：第一封 `0f0e` 到期消费后没有回复；第二问 `6afae` 的回复是 `questions` 卡，按 PL-SPEC 延后；转交前已到期；归档前所有等待都已消费 | 账本 #238/#239/#265/#266；`STATE-MACHINES-SPEC.md:3650,3727,3737`；`slice-PL-SPEC.md:546`；`wait.mjs:504-560` | not-run/env 正确；要覆盖需改场景顺序，不改平台 | — |
| 17 | waiting | 叫醒轮 ack-only | **驱动（现行口径）/ lead（定义）** | 唯一被计的是 `intervention-planning-45397f…`，Host 关闭时 `run.cancelled`（11:37:46.312）；按现行 Q11/`run.mjs:218-238`“成功调用只有读类/答复”的成文口径，它仍算 ack-only；要排除 cancelled 是改定义 | QueryJob 45397f `status=closed, closeReason=cancelled`；kernel run 11:37:39–11:37:46；`run.mjs:218-238`；`report.mjs:97` | 不改计数；要排除 cancelled 先让 lead 改 Q11/定义，再改 `run.mjs:238`。不要直接加 `status==='answered'` | lead（定义）/驱动 |
| 18 | E09 | `adviser-explains`（C-211/62/55） | **模型** | 首版计划把“执行者上报→参谋解释→人决定”落成“记录一条 open_question + 只查 `report.js` import 的 gate”；上报 10:13:27 发出时为 `queued`，参谋最后一轮 10:12:26 已结束，Goal 10:14:02 完成；60 s 消费心跳落在完成后，平台按文档不再开轮 | 账本 #249（`needsReply/wake true`、`delivery=queued`、`acceptedInputs=[]`）；参谋两轮 10:09:02–10:10:08、10:10:23–10:12:26；#291 GoalCompleted 10:14:02.795；note 912b8fa8 仍“待你裁决”；`host.ts:4156-4157,363,3449`；`consumable-sessions.ts:196-205`；`intervention.ts:243-248` | 提示词补“人点名的决定链必须让目标保持未完成，上报任务 `waitAfterSend`”；计划的目标卡完成标准包含“人已裁决/新版本已采用”，gate 要真查；不改平台 guard（无书面依据） | 模型/提示词（lead） |
| 19 | E09 | `person-decides`、`new-version` | — | 没有来源是上报的人答卡，没有第二版计划；上游“参谋没解释”未发生 | `committedAnswers` 空；E09 PlanRevision 快照 1 个；`e09.mjs:219-221` | 级联 not-run 正确，不改 | — |
| 20 | 记账 | 13 个叫醒轮 / T6 | — | 13 个 distinct `intervention-planning-` QueryJob；按叫醒轮建图没有 A←B 后 B←A 的交替，最长 1 轮；无 T6 | 13 = 1+1+1+1+1+1+4+3；`run.mjs:215-221`；README `:83,90-91`；`e09wake/report.md` | 不改；T6 的“全轮”口径见 UNSPECIFIED | — |

## 一、E05：seed 检查停窗，E05 主场景从未开始

### 时间线与事实

- 08:34:48 打开工作区；08:35:51 冷启动请求 `a8497033…`；08:36:36.688 归属轮、08:36:36.783 确认草稿、08:36:37.319 采用首版 `initial-plan-48118c96…`。
- 08:36:57.731 `TaskClaimed t1`（session `17e47c72…`）；08:36:58.133 `ExecutionEntryEntered`；Run `66bff0cd…` 在 08:37:34.761 `ExecutionRunResultRecorded`（completed，exit 0）。
- 08:37:35.081 `PlanProposalRecorded` 候选 `plan-proposal-a58eb6bd…`（基于首版；`status=candidate`）；08:37:35.323 `VerificationRoundOpened`（round `759222b3…`，subject Run `66bff0cd…`，t1）；08:37:35.393 `VerificationCheckBegun`（`c-readme`，static，`timeoutMs=30000`，invocation `c0325846…`）。
- 之后到 09:09:43 只有轮询：`goals/display` 210 次、`decisions/queue` 209 次、`workflow/driver-read` 196 次；E05 段 `workflow/advance` 0 行、`goals/create` 0 行、`workflow/driver-start` 0 行、`role-lines/open` 0 行。
- 09:09:43.813 `GoalDesiredStateChanged`（人/驱动 pause，reason “G6: E05 ended”）；stall 窗口 32 分 08 秒。
- 10:18:10.571 `VerificationCheckInterrupted`（actor `host-start-up-reconcile`，cause `host_restart`）；此前 100 分钟没有结果。E05 主场景（reviewer 线、`goals/create`、两次 `driver-start`）从未开始。

### “在跑的检查”是不是真的在跑

**不是。** 账本只有 `VerificationCheckBegun`，没有 `VerificationCheckResultRecorded`、`VerificationEvidenceRecorded`、`VerificationRoundFinalized`；round 快照 `status="open"`，`c-readme.phase` 最终 `interrupted`。检查定义 `timeoutMs=30000`，如果进程真的起来了，30 秒内必结束；不可能跑 100 分钟。`check-execution.ts:151-153` 的注释写明“重试用尽后窗口保持 executing，直到启动对账中断它”，`startup-reconcile.ts:516-538` 是唯一写者。

**按 VD-10/LA-6，这是规格接受的停窗。** `STATE-MACHINES-SPEC.md:2993`：“重试用尽，或执行中抛出未知错误 → 单项保持 executing，直到重启 reconcile（VR-04/VR-06）。这段停滞被接受，需列入 §12。” `:6614`（LA-6）：“不加定时调度：停在 waiting 的驱动只由推进、驱动启动、启动重驱或既有注意力触发唤醒。” 本轮 Host 从 08:34 一直活到 10:18，没人重启，所以没有代码会推进它。`workflow.ts:1685-1688` 读到链头 open 就返回 “the verification round chain head has an executing check; not advancing”，这是对的；即便驱动在这 32 分钟里发 `workflow/advance`，仍会读回同一状态。

### 候选为什么没有审阅线

`plan_candidate_waiting: no_review_line` 是 **真没有审阅线**，不是槽满：

- `RoleLineAllocation` 快照的 duty 只有 secretary/adviser/scribe/executor；`SessionCreated` 4 条 role 分别是 platform-secretary/platform-adviser/platform-scribe/local-workbench；reviewer 0 条；E05 段 `role-lines/open` 0 行、`review-line-open:*` 0 条、`RoleLineOpened` 0。
- 候选 `plan-proposal-a58eb6bd…` 的 review `status=not_sent`、`roundRef=null`；没有 `planreview:` 系统轮。
- 按 `slice-9-SPEC.md:217`（决定 121-130），自动开审阅线只用于**执行结果审阅**；最后一句明说“计划候选的审阅不变：没有审阅线时照旧出候选卡”。`slice-PL-SPEC.md:1438/1444` 同：“没有审阅线：不建审阅 Query、不挂工具、不发 `planreview:`；候选转卡 `no_review_line`。” `plan-candidate.ts:110-115` 的 `review.status === 'not_sent' && !hasReviewLine` → `{action:'card', reason:'no_review_line'}`。
- E05 自己的 reviewer 线在 `e05.mjs:136` 才开；驱动停在 `e05.mjs:118` 的 seed 等待，这一行从未执行。seed 的计划 obligation 只有 static/dynamic，没有 reviewer 要求；平台也不该给它强开审阅线。

### 谁该推进而没推进

- **Workflow：** `workflow.ts:1685-1688` 按规格只能 waiting；没有别的写者能推翻这个读。
- **Host/检查执行器：** 唯一清 executing 的是 `startup-reconcile.ts:516-538`，只在 Host 启动时跑；本轮没有重启。
- **驱动：** `flows.mjs:341-399` 的 `waitGoal` 只轮询 display/queue/driver-read，不主动 advance；`flows.mjs:413-445` 在 32 分钟无公开变化、无在途 Query/Run 时判 stall。这个等待与“谁该推进”无关；即便 advance 也不会重跑检查（VD-10）。
- **结论：** 该推进的是平台 Host/检查执行器；现行规格把这个窗口留给重启。可行动作只有两个：
  1. **改规格（平台）**：`check-execution.ts:155-173` 的 `recordResult` 用尽 3 次后调用 `evidence.interruptCheck`（复用 `startup-reconcile.ts:525-528`），让轮次能 finalize，而不是把没有 runner 的窗口留给重启。cause 只能取现行枚举（`verification.ts:137-148`），窗口未知时最接近的是 `process_abnormal`。需 lead 先改 VD-10。
  2. **驱动重启（可选，无书面依据）**：`e05.mjs:118` 的 seed 等待对 `c-readme`/`c-test` 的 `timeoutMs` 设上界，超过后重启 Host 触发 startup reconcile。现行 README 没有这条规则，只能标可选。

### 驱动为什么把 `overlap` 记成 fail

- `checks/notes.md:12` 的 fail 原句是 `stalled: no change for 32 min…`，不是“两个 Run 重叠”。
- `flows.mjs:49-53` 的 `broken()` 取“第一个还没判的判据”；E05 的第一条是 `overlap`（`e05.mjs:206-218`），于是写成 fail。
- 事实：E05 段 `goals/create` 0 行、`workflow/driver-start` 0 行、`workflow/advance` 0 行；账本只有 seed 的 1 个 Run；`t-users`/`t-orders` 各 0 个 Run，`pair` 必然 null。按 `scripts/acceptance/README.md:111-115` 与 `flows.mjs:44-47`，stall 仍记 fail，所以 **E05 的 verdict 保持 fail**；`overlap` 只是 `broken()` 的 first-unjudged 标签，不是重叠证据；停住后的 11 条才是 `not-run`。要改 verdict 先让 lead 写裁定，不能拿自写的 common-brief 改。

### 旧根因与 P6G

- **overlap 平台根因（claim→entered 772 ms 被当空闲）：** P6G 补充裁定已说明前提不成立：起点 `claim-service.ts:1552` 的 `occupancy_acquired` 早已在 claim 提交时占线；P6G G1 的实际改动是 `workflow.ts` 里 claim 被拒 `busy` 后同一步重挑（`p6g-rulings.md:52-62`），不是 `claim-service.ts:1608-1617` 的“claim 即占线”。本轮 **没走到** E05 自己的双任务，不能说“真实运行已修好”。本轮 `overlap` 的 fail 是 stall 标签，不是 772 ms 复发。
- **duplicates / temporary 模型根因：** 没走到（t-users/t-orders 未创建）。
- **reviewer/name-different/name-same/line-choice 驱动根因：** 代码已修（`e05.mjs:280-281` 按 Evidence 数组；`:144-147/:316-322` 读 `last.pick`），但没走到。
- **P6G：** `git diff 63ff3a0f d5c975eb -- src` 没改 `check-execution.ts`、`verification-machine.ts`、`role-lines.ts`、`session-availability.ts`、`session-chooser.ts`、`task-gate.ts`，也没有 `run_check`/`nextAfterRound`/`reviewLine` 的 hunk。**不是 P6G。**

### E06 为什么没跑（一句）

E05 的 `ctx.shared.e05` 只在 `e05.mjs:324` 的 `display.stoppedFor === null` 时设置；seed stall 使 E05 以 stopped 结束，`e06.mjs:58` 读到 `e05 === undefined` 就 not-run；E05 也没有 handoff/continuation Session，0 行 HTTP、0 行模型调用是对的。

## 二、E08 / E08b：`no_new_basis` 判对，驱动判错对象；E08b 是模型没交候选、也没叫停

### E08 时间线（关键）

| 时刻（Z） | 事实 |
|---|---|
| 09:20:35.737 | 首版 `initial-plan-2997…@1` 采用（sub + mul） |
| 09:28:11.337 | `TaskClaimed task-sub`，Run `88af8811…`——第一个 Run 是 sub，不是 mul |
| 09:28:11.584 | 改需求 `requests/submit`（sub 被领后 0.247 s） |
| 09:35:12.126 / 09:35:21.359 | 改需求候选 `initial-plan-08e245…@2` 采用；`task-sub` 仍 `active` |
| 09:44:12.267 | `TaskClaimed task-div`，Run `bd92ac91…` |
| 09:57:35.737 / 09:57:36.812 | `bd92` completed；轮 `0c6f0d33…` finalized FAIL（`node-test-all` FAIL、`static-div-export` PASS） |
| 09:57:40.776 | 第一次 `TaskRequeued task-div` after `bd92` |
| 09:57:41.568 | 第二次 Run `923a9e25…` 进入 |
| 10:00:47.691 / 10:00:48.496 | `923a` completed；轮 `a571455f…` finalized FAIL（同两检查、同结果） |
| 10:00:57.098 / .106 | 第二次 `tasks/requeue` committed（值是 refused）；`TaskReworkRefused no_new_basis` |
| 10:03:05.560 | 驱动 `goals/control` 暂停 |

### E08：`no_new_basis` 判得对

逐项比两次 requeue：

- **failure：** 第一次 `#279` `basis.failure={outcome:'completed', origin:'observed', checks:[node-test-all FAIL], gapCodes:[]}`，`failureClass='check_failed'`；第二次 `#301` 同 `failureClass`、同 `basisDigest 9ec1…`。`static-div-export PASS` 在 `#278` 的轮结果里，不在 `#279` 的 `failure.checks` 里；两次检查轮 `#278/#300` 的检查 id 和结果都相同（`node-test-all FAIL` + `static-div-export PASS`）。
- **source：** 第一次 `source={workspaceRevision:1, sourceDigest:'62ea…'}`；第二次拒绝 `#301` 同 `source`；第二次检查轮 `#297/#299` 的 `sourceDigest` 也是 `62ea…`。两次之间没有文件/测试变化；第二个 Run 只有 read/list_files/read_session_inbox/shell/record_note，0 次 edit，只重跑了一次 `node --test`。
- **plan：** 第一次 `#279 planRef=initial-plan-08e245…`（rev2，改需求后的版本）；第二次 `#297/#299 taskBasisRef/adoptedPlanRef` 同；`#301` 的 `basisDigest` 相同，`matchedRequeueRef.afterRunId='bd92…'` 正是第一次重排。改需求后的 `task-div` 没有再改定义。
- **newInput：** 第一次 `#279 newInputDigest=null`、`newInputRefs=[]`；第二次 `#301` 的 `basisDigest` 相同；09:57:40–10:00:57 之间 `SessionMessageInputAccepted/Sent/Responded` 事件 0 条。第二个 Run 只写了 `record_note`（`#291`，`0059c0a0…`），不是 `MaterialPort.storeArtifact` 的 Artifact，也不是已 `responded` 的 SessionMessage；`newBasisInputsProblem` 的两种合法输入都不成立。

按 `STATE-MACHINES-SPEC.md:4690`（键相同且没有新输入 → `task_rework_refused`，code `no_new_basis`，reason 原文）和 `:4707` 的例子 #2（Run2 没改文件、c1 同样 FAIL、再次 requeue → 拒绝），**平台的拒绝正确**。`:300` 把 `no_new_basis` 列为 GOAL-30 停止原因，出路是“修改文件、回复消息或附加材料”；`slice-PL-SPEC.md:1679` 写“平台（Task 已停）→ 参谋改计划（替代任务）或问人；人用现有重排/重查/加预算入口”。

**模型该走而没走的出路：** `e08.mjs:303-336` 的 `task-div` 旧授权只覆盖 `calc.js`/`test/div.test.js`，所以“加一条删 `test/sub.test.js` 的修复任务”或“把 `test/sub.test.js` 纳入 `task-div` 的 plannedFiles”都可走；驱动一个都没走，直接 `tasks/requeue`，被拒。平台的 `no_new_basis` 不是平台缺陷。

**驱动错在哪：** `e08.mjs:282` 的 `waitGoal` 在 `returnOnDecide` 之前就把 `no_new_basis` 当 `broken`；`flows.mjs:239-242` 把 `ended` 文本交给 `broken`，`flows.mjs:52` 选“下一个未判的 check”，于是落到 `versions`。`versions` 实际已满足（2 版、人已采用），应在 `e08.mjs:275-289` 的 `applyChange` 后立即判。

### E08：`switch` / `old-evidence` 应 fail，不是 not-run

- **`switch`：** 采用版 `#220` 的 `tasks` 里 `task-sub.disposition` 仍是 `active`，`replacedByTaskId=null`；`task-div` 是新增 active。`test/sub.test.js` 仍在（workspace tracked，`git status` 只有 `M calc.js` + `?? test/div.test.js`）。`e08.mjs:298` 的 `cancelled.ok` 不会成立，判的话是 **fail**。
- **候选为什么这样：** 09:34:37 的 `submit_plan_round` validation 原文（`call_00_jpknwgtzw0n7x03f14n1g18m`）四条问题是“ob-sub/ob-mul 已采用不能改验收；task task-sub already has a Run and is no longer a future task；ob-sub 少 required requirement；ob-div 需要 static 检查”；平台给的出路是“leave ob-sub/ob-mul as adopted + add new obligation”，没有 E08b 那样的“a traced task may change only its disposition or replacedByTaskId”句。模型 09:35:11 重写后把 `task-sub` 留成 active（`#213`），于是候选自相矛盾。
- **`old-evidence`：** div 的改后 Run `bd92`/`923a` 都有检查轮（`#278/#300`），轮里 `static-div-export PASS`、`node-test-all FAIL`；`e08.mjs:303-336` 对 `head.delivery.requirements` 的 `state!=='pass'` 直接 fail。数据已足够，不需要等 Goal COMPLETED。
- **`required-cancel`：** Goal 在 `#302` 仍是 NEEDS_DECISION，没有 COMPLETED；`e08.mjs:346` 要 `done.display.phase==='COMPLETED'`，确实没走到，not-run 正确。
- **`autonomy-later`：** 草稿本来就是 every_step，没有中途改档，not-run 正确。

### E08：`hold-before-adopt` 的 not-run 根因是驱动时机

- `#133` 09:28:11.337 sub 被领；`http.jsonl:62` 09:28:11.584 改需求提交；`#222` mul 到 09:35:21.589 才被领。E08 账本没有 `TaskClaimHold` 事件（0 条）。
- `e08.mjs:219` 的 `done` 是 `value.sub.length > 0 || value.mul.length > 0`，sub 一被领就返回；`subClaimedFirst=true` 后 `e08.mjs:256-257` 记 not-run。
- 这不是平台：sub 已有 Run，秘书不能再“暂缓未开工任务”。最小改法：`e08.mjs:219` 要求 `mul.length > 0 && sub.length === 0`；或冷启动采用后立即提交改需求；或把 mul 排在 sub 前。

### E08b：`0ffa0460` 为什么没有候选

- `0ffa0460` 12:17:46.718 提交，`roundKind='followup'`，问题是“选了第 1 个思路：按 candidate 采用…”。
- transcript（E08b kernel store，secretary `session-35ba…`）显示 5 次 `submit_plan_round`：
  1. 12:17:57.918 `call_00_9fou…` → `invalid_arguments`：`summary` 缺失、`plan.tasks[].phase` 不被接受、`plan` 里不接受 `checks`/`summary`。
  2. 12:18:10.592 `call_00_bf90…` → `the answer has problems`：`tests-static` 已安装且内容不同；`obligations[O-sub].taskIds` 无有效 active required carrier；`reason.affectedTaskIds` 必须列 traced T1。
  3. 12:18:26.644 `call_00_95yco…` → `task T1 already has a Run and is no longer a future task; a traced task may change only its disposition or replacedByTaskId: keep it in obligations[O-sub].taskIds and add the replacement task as another carrier`。
  4. 12:18:40.268 `call_00_bfcr…` → 同类：`task T1 already has a Run and is no longer a future task`。
  5. 12:18:44.818 `call_00_410l…` → `answerKind:"questions"`，`summary:"探测工具接受的取消写法，不期望被采用。"`，`status:'accepted'`；轮在 12:18:44.843 yielded，12:18:44.950 `QueryJobAnswered`，`ideas: []`，`planDraftIndex:null`。
- 平台没有丢候选：`PlanProposalRecorded` 在 12:17:44.649、12:20:18.141、12:21:33.102 各有一次，但 `requestRef` 分别指向 intervention-planning query（`6861…`/`fc55…`/`3223…`），**`requestRef=3f323670` 的 proposal 0 条**；`0ffa` 自己的答案是 `needs_decision`，不是 `plan`。
- 结论：**模型**。它已拿到逐条 validation 出路，仍把 `task-sub` 留 active；按 `secretary-answer.txt:6` 应只改 disposition 或 `superseded + replacedByTaskId`，并保留 `obligations[O-sub].taskIds`、把替代任务加进同一候选；新验收放新 obligation，检查 id 换新。
- 驱动措辞：`checks/notes.md:293` 写“last round … no Query ran for 5 min”，但 12:18:44–12:21:33 之间有 2 个 intervention-planning Query；驱动的 `inFlight.queries` 等到它们结束才归零，停止点是 12:26:33 之后，不是 12:18:44+5 分钟。阈值本身没有误判本例；但读法混用（`settledRound` 读 requestRoot 最后一轮，`quiet` 读全项目 in-flight）。改法：`e08.mjs:99-101` 改成“最近 5 分钟没有 in-flight Query”，`e08b.mjs:118` 读 `needs_decision`/`questions` 时记“模型交的是问题/探针”，不要写“没交候选”。

### E08b：`stop-delivered` / `safe-point-end` 按 lead 仍 not-run；模型 0 次 `request_stop` 是 finding

- `sub-running` pass 保留：`#119` 12:17:24.396 `TaskClaimed T1`，Run `50369194…` 12:17:24.916 开始；`http.jsonl:618` 12:17:26.294 改需求；Run 12:17:56.467 自然 `run.completed`。
- 叫停：E08b 全部 assistant 工具调用中 `request_stop` **0 次**；账本 `TaskClaimHold`/`ActionRequest` **0 条**；sub 的任务卡 `stop.steps` 无、`stop.request` 无；Run 是自然 completed，不是叫停后的安全点收尾。
- **Verdict：** `e08b.mjs:116-118` 的 lead 11-25 裁定明文“没候选 → `stop-delivered`/`safe-point-end`/`adopt-after-end` 都 `not-run`，never judged fail”（`driver-build-reply.md:29` 同），所以本轮**保持 not-run**。模型 0 次 `request_stop` 是 finding：改需求提交时 sub 在跑，停叫支路已到，模型该叫停没叫；如果 lead 认为这应改 fail，先改 lead 11-25 的裁定，再动 `e08b.mjs:121-123`，不要先改 verdict。
- 附带发现：E08b 初始计划的 `tests-static` 检查用 `node -e "…'export\\s+…'"`，双引号吃掉反斜杠后正则变成 `/exports+functions+adds*(/g`，检查自身 `SyntaxError`；这是三笔 auto-requeue、三笔 `no_new_basis` 的直接原因。属模型写的检查命令；平台是否安装时试运行规格未要求，记可选。

### E08 / E08b：P6G 与旧根因

- **不是 P6G：** `plan-validation.ts`、`requeue-service.ts`、`task-failure.ts`、`decision-policy.ts`、`task-machine.ts`、`plan-machine.ts` 在 `63ff3a0f..d5c975eb` 的 diff 都是 0 行；`src` 的 diff 里 `no_new_basis` 出现 0 次。E08 的拒绝逻辑起点已有；驱动问题在 `415e91dc` 之后的驱动改动。
- **旧 E08 模型根因（上一轮 `ideas:[]`、0 次 `submit_plan_round`）：** 本轮模型交了候选，但候选错了（`task-sub` active）；不是同一形态，但同属“改需求候选没写对”。
- **旧 E08b pass：** 上一轮模型 3 次 `submit_plan_round` 第 3 次 accepted，所以四条 pass；本轮 4 次失败后交 questions，候选/叫停都没发生。

## 三、E12：`g2` 是 stage gate、覆盖 `[]`，计划结构性不可完成

### 事实

- 新 Goal `7fc83cea…` 的计划 `initial-plan-73200e7c8749d8ce01ea357e571cfe5b`（rev1，10:20:19.988 采用）：
  - `t2`：work、required、active、`scope={"kind":"goal"}`、`stageId=s2`；
  - `g2`：gate、required、active、`scope={"kind":"stage","stageId":"s2"}`、`stageId=s2`，义务 `o3`/`r3`（`node --test`）；
  - `gg2`：gate、required、active、`scope={"kind":"goal"}`、`stageId=s2`，义务 `o4`/`r4`。
- 按 `gateCoveredTaskIds` 复算（`decision-policy.ts:217-231`，stage 分支 `:225`）：`g2=[]`，`gg2=['t2']`。这与读模型 `plan-service.ts:2354,2751-2754` 同一纯函数。
- `t2` 的派工/领取/Run/完成全成功：`TaskLease` 10:20:20.167（holder `048f38b1…`），`DispatchOutboxEntry.status=settled`，Run `048f38b1…` 10:20:20.728 开始、10:20:44.409 结束（`TaskAttempt.status=ended`、`endOutcome=completed`），`TaskCompleted` 10:20:45.458 把 `t2` 置 satisfied。账本 `TaskClaimHold/TaskClaimRejected/ClaimRefused/TaskReworkRefusal/TaskRequeued/MemberRequestCreated` 全 0；没有 `no_line`/`line_busy`/`host_pick`。
- `g2`/`gg2` 是 gate，按计划规则不跑 Run（`plan-validation.ts:400-425`）；gate 的 producer 只能是它覆盖的 work。`g2` 覆盖为空，所以没有生产者可开 Run。
- `workflow.ts:3250-3257` 先选 `coveredGate`（stage/module gate），`:3272-3275` 才是 goal gate；`t2` satisfied 后的一趟里 `g2` 是 required+active+未满足，覆盖为空 ⇒ 与 `unfinishedWork` 的交集为空 ⇒ 被选中；`advanceGate` 的 producer 在 `workflow.ts:1892-1894` 要求 `covered.includes(row.ref.taskId)`，`t2` 不在 `covered` ⇒ `producer===undefined` ⇒ `workflow.ts:1896` 的 waiting。
- 目标完成也要求 `g2` 满足：`workflow.ts:3279` 的 `required.every(task => !taskUnsatisfied(...))` 把 `g2`/`gg2` 都算在内；`g2` 没有 producer，就无法 `open_checks`，也就无法 satisfied。这个计划**结构性不可完成**。
- 32 分钟窗口（10:20:45–10:52:54）零写、零模型、零在途：E12 HTTP 只有 `goals/display`（repeat=196）、`decisions/queue`（195）、`workflow/driver-read`（182），committed 写 0；`model-calls.jsonl` 10:21:10 之后 0 行。
- 驱动 32 分钟零变化后判停（`flows.mjs:25,440-444`）是对的；`e12.mjs:139-141` 把“新 Goal 分支”与“新 Goal 必须 COMPLETED”合在一条，可选拆分，不是停因。

### 类别与改法

**模型/计划。** 不是平台 dispatch/claim/gate bug：t2 全部成功；g2 的等待是规格写的“找不到 producer 就 waiting”（`slice-PL-SPEC.md:256-264`）。不是驱动：32 分钟零变化、零在途后判停是设计好的 stall 判据。不是 P6G：`git diff --name-only 63ff3a0f d5c975eb -- src | grep -E 'task-gate|decision-policy|plan-service|plan-validation|platform-pack|prompt'` → 0；`resources/prompts` → 0。

**提示词缺口：** `initial-planning-answer.txt:16` 要求“Each stage and plan has exactly one gate”，但没有一句说 stage gate 的覆盖只算 stage/module 级 work，也没说“有 stage gate 的段必须有一条 stage/module 级必需 work”。`plan-review-input.txt:16` 的第 7 问同样只查“有没有阶段 gate”，不查覆盖；`secretary-answer.txt:3` 的“open a new stage with its own required stage gate”也一样。**最小改法：** 在这三处（以及 `skill-platform-adviser.txt:47`、`skill-platform-reviewer.txt:10`）加一句等义规则：

> 阶段/模块 gate 只覆盖同一 `stageId` 的 stage 级或 module 级 work；goal 级 work 不算。给一段加阶段 gate 时，这一段必须至少有一条必需的 `work` 使用 `{kind:'stage',stageId}` 或 `{kind:'module',stageId,moduleRef}`，否则这个 gate 永远没有 producer，Goal 会停在 `the goal gate <id> has no ended ordinary producer Run yet`；只有 goal 级工作的段不要加阶段 gate。

这是把 `slice-PL-SPEC.md:219-220` 已写的运行语义告诉规划者/审阅者，不是新机制。测试：`tests/contracts/PC-prompt-texts.test.ts` 加断言，渲染后的 `initial-planning-answer` 含该规则；`plan-review-input` 第 7 问含同一规则。

### 旧根因

- **history-reuse：** 上一轮根因（模型没查旧 Goal）没有被证明已修；本轮 `waitGoal` 在 10:52:54 抛 stall，`e12.mjs:146-152` 的 Run 工具结果扫描没执行。新证据：新 Run `048f38b1…` 复用了旧 executor Session；但 C-220 要看“新 Run 的成功工具结果是否点名旧 Goal/Run”，本轮没执行检查，也无法从快照读 t2 Run 的工具结果。仍 not-run，不判 fail。
- **stale-premise：** 仍是 entry-missing（公开读口没有逐项前提字段；`PlanProposal` 的 `stale/staleReason` 只判候选相对活动计划）。
- **wait-registry：** 本轮仍 not-run，而且这次有更硬证据：E12 账本 `waitAfterSend` 出现 0 次；唯一重启（10:18:07）发生在旧 Goal 已 COMPLETED、旧线没有等待的时候；新 Goal 的 g2 等待要到 10:19:44 之后才建立，之后没有第二次重启。没有对象可重建；不是平台缺行为，也不是这次 fail 的原因。

## 四、waiting：6 条未覆盖中 4 条是场景没走到，2 条是驱动判据/注记

### 时间线（关键）

| 时刻（UTC） | 事件 |
|---|---|
| 11:36:51.949 | 成员 Run `40195587` 经 `send_session_message` 发 `0f0e13ab…`（“num.js 现在有哪些导出函数？”），期限 11:38:51.949，`waitAfterSend:true`；Run yielded，continuation `wait_reply→0f0e` |
| 11:36:55.598 | 人插话 `610490d7…` 发到成员线 |
| 11:37:38.828 | `35c436aa` 的 `TaskClaimed`（intervention 领取，`previousRun=40195587`，session `5a82…`，generation 7）；**尚未进入** |
| 11:37:46.312 | 叫醒轮 `45397f` 的 kernel `run.cancelled`（`caller_requested`） |
| 11:37:46.567 | Host #1 SIGINT（exit 0，277 ms） |
| 11:39:59.379 | `0f0e` 记 `expiredAt`（Host 已停机跨过期限） |
| 11:39:59.520 | Host #2 启动 |
| 11:39:59.774 / 11:40:00.140 | `35c436aa` EntryAuthorized/Begun/Entered，kernel turn 开始 |
| 11:40:18.442 | `35c` 发 `60e30e3c…`（“num.js …（第 2 次询问：上一条同问题已于 11:39:59Z 到期未回答…）”），期限 11:42:18.442，`followupOf=0f0e` |
| 11:40:18.588 | `35c` ended/yielded，continuation `wait_reply→60e30e` |
| 11:43:01.209 | `60e30e` 记 `expiredAt` |
| 11:43:01.308 | `60e30e` 的 response 写入（`回答 line 的询问：num.js 只有 double(n)…`），`respondedAt` 11:43:01.308 |
| 11:43:01.643…11:43:02.090 | `a23a44ce` 领取/进入（`consumedWait.kind=expiry`，`messageRef=0f0e`，`originalRun=40195587`） |
| 11:43:07.922 | `a23` 发 `6afae00b…`（“README 的标题要不要改成中文？”），期限 12:13:07.922 |
| 11:43:07.988 / .006 | `a23` 接受 `0f0e` expiry（`consumesWait:true`）和 `60e30e` response（`part:response, consumesWait:true`） |
| 11:43:08.029 | `a23` ended/yielded，continuation `wait_reply→6afae` |
| 11:44:01.569 | `intervention-planning-cb3d56f4…` 提交（“README 的标题要不要改成中文？”） |
| 11:44:18.977 | `cb3d` 答 `needs_decision`（`submit_plan_round` 的 `answerKind:"questions"`）；没有 `respond_session_message`；按 PL-SPEC:546 M 保持 open |
| 12:14:03.338 | `6afae` 记 `expiredAt`（期限 12:13:07.922 之后约 55 s） |
| 12:14:03.457 | `6afae` 的 response 写入（与 `cb3d` 同一回答；`respondedAt` 12:14:03.457） |
| 12:14:03.615…12:14:04.307 | `e011e417` 领取/进入（`consumedWait.kind=wait_reply`，`messageRef=6afae`，`originalRun=a23`，`responseRef=2c74…`） |
| 12:14:53.931 | `e011` 接受 `6afae` response（`part:response, consumesWait:true`） |
| 12:14:53.972 / 12:14:54.393 / 12:14:54.877 | `e011` ended/completed；t-wait TaskCompleted；GoalCompleted |
| 12:14:59.981 | waiting 场景结束 |

### 逐条

**`second-expiry`（驱动）。** 第二封 `60e30e` 确实在 11:43:01.209 记了 `expiredAt`，但 response 11:43:01.308（99 ms 后）到达，`a23a44ce` 在 11:43:08.006 以 `part:'response', consumesWait:true` 接受。按 `STATE-MACHINES-SPEC.md:3650`，`expiredAt` 之后、消费之前的回复读作 `answered`，领取选 `wait_reply`；到期没有接受。所以正确读法是 **not-run**（“第二封的回复在到期接受之前到达，回复胜过到期”），不是 `env-unavailable`。驱动 `wait.mjs:413-417` 把 `chain.ended==='over'` 一律写 `env-unavailable`，`421-422` 又写“第二次到期的 expiry 接受和后继输入还没出现”；实际后继 Run 有（`a23`/`e011`），只是第二封的消费是 response。改法：`wait.mjs:212-214` 加 `secondAnswered`；`421-422` 当第二封的消费是 response 时记 not-run。`6afae` 是“第二个问题”，不在追问链（`followupOf:null`），由 reply-first/transfer 判。

**`late-reply`（—）。** 第一封 `0f0e` 的 `response` 始终 null；11:39:59.379 到期，11:43:07.988 由 `a23` 的 expiry 消费；之后没有对 `0f0e` 的回复。后两封的回复都是“到期后、消费前”，按 §10.7 读 `answered` 并以 `wait_reply` 消费，不是迟回。`wait.mjs:121-124` 的 `lateSaved` 已经以“expiry 消费”为界，旧的 `expiredAt` 边界假阳性已修；本行 env-unavailable 对。最多把 `wait.mjs:453` 的 reason 补一句“后两封已在到期后、消费前被 wait_reply 接受；本行只看第一封”。

**`reply-first`（—）。** `6afae` 11:43:07.922 发出，期限 12:13:07.922；`intervention-planning-cb3d56f4…` 11:44:01.569 提交、11:44:18.977 答 `kind=needs_decision`，工具是 `submit_plan_round`（`answerKind:"questions"`），不是 `respond_session_message`。按 `slice-PL-SPEC.md:546`，执行者 open wait 在“问人/候选”期间不回 M；平台按规格延后到到期后，模型没有发 terminal reply。所以到期前没有 response，not-run 正确。要覆盖 reply-first，秘书必须给 terminal answer（text/plan/declined/adopted）而不是问题卡；这是场景设计，不是驱动 fix。

**`transfer`（—）。** `6afae` 期限 12:13:07.922，12:14:03.338 到期；`transferredTo:null`、`replyHandler:null`。waiting 的 `http.jsonl` 没有 `sessions/archive-line` 或 `waits/dispose`（0 行）；账本没有 `SessionMessageWaitDisposed`/`SessionMessageForwarded`。驱动 `wait.mjs:504-533` 只在第二问还 `open` 时先归档发信线再 `waits/dispose`；进入分支时 `6afae.expiredAt != null`，直接记 env-unavailable。合理：转交要求等待还开着且发信线已归档/退役；第二问在任务完成前到期，没有可转交的 open wait。期限是 30 分钟（11:43→12:13），不是期限太短；是场景顺序没有留下 open 窗口。

**`disconnect`（—）。** 三封等待最终都已消费：`0f0e` expired + `expiry, consumesWait:true`；`60e30e` expired + `response, consumesWait:true`；`6afae` expired + `response, consumesWait:true`。`sessions/facts` 的 `waits` 不再列它们；waiting 没有 `sessions/archive-line`（0 行）；驱动 `wait.mjs:552-560` 找不到 open wait，记 env-unavailable。`disconnect` 需要一条未消费的等待（`STATE-MACHINES-SPEC.md:3737`），三条都已消费，确实造不出。不是驱动归档错线（它根本没归档）。

**`supply-order`（驱动）。** `wait.mjs:545` 仍无条件 `rec.uncover('supply-order','entry-missing',...)`。前一行 `wait.mjs:537-544` 遍历 `sessionTurns`，用 `turn.input.indexOf('已接受的输入')` 找一段；但 11 条 `turn.started` 的 user message 里“已接受的输入”出现 **0 次**，所以 `supplied` 永远为空，note 永远不写。公开读口 `sessions/history` 的 `run.input_accepted` 其实按接受顺序给出：run `14c3c802` 的 pos 61 是人插话（`用户插话（消息 610490d7…）`），pos 62 是 Host 中断通知；run `a23a44ce` 的 pos 95 是 `0f0e` expiry，pos 96 是 `60e30e` response。`flows.mjs:939` 的 `turnsOf` 已把这些文本按顺序拼进 `turn.input`。**改法：** `wait.mjs:537-545` 改成读 `run.input_accepted` 顺序（sourceRef + text）写 note；`entry-missing` 只在连接受顺序都读不到时使用。不要新增读口。若 lead 要判 pass/fail，需先定“接受顺序是否等于供给顺序”；没有书面依据前不要判 pass。

### 重启与 G3：这次不是 G3 路径

- 关 Host 时 `35c436aa` 是 **claimed-not-entered / starting**：`TaskClaimed` #186 11:37:38.828，此后没有 `ExecutionEntryAuthorized`，直到 Host #2 启动后的 11:39:59.774；`ExecutionEntryEntered` 11:40:00.140。它不是 running，也不是 yielded。
- 11:37:46.567 SIGINT；11:39:59.520 Host #2。账本没有 `RunInterrupted`、`TaskRequeued`、`SessionCreated`/continuation；`35c` 的 Run id 没变，重启后同一次领取被续驱。
- `startup-reconcile.ts:459-460` 对 `starting` 且 `startingEntryOf==='not_entered'` 的 Run `continue`（W-01..W-03：同一次领取由 Workflow 的 step 6b 重驱）；`:670-672` 收集 `notEntered`，`:698` 把 task 放进重驱的 `taskIds`。这不是 `claimContinuation` 的 `TaskRequeue` 路径。
- `35c` 的 `consumedWait` 是 `intervention`（插话 `610490d7…`），不是等待；它的 continuation 是 `wait_reply→60e30e`（它自己在 11:40:18 发的第二问）。`previousRun` 是 `40195587`，那个 Run 的 continuation 才是 `wait_reply→0f0e`。
- G3 要求的 `carryWait` 只在 `Workflow.claimContinuation` 且 `continuation.requeue` 存在时进入（`workflow.ts:1946`；`1978` 从 `afterRun` 沿 `previousRun` 取 `lastYieldedRunOf`；`1984` 用 `readContinuation(..., true)`）。本轮没有 `TaskRequeue`，所以没调用。若真的按 running Run 重排队，`lastYieldedRunOf(35c)` 会走到 `40195587`（yielded `0f0e`），`readContinuation(forRequeue=true)` 在 11:39:59 后看到 `0f0e` 的 `state='expired'`，按 `workflow.ts:1567-1571,1585-1588` 会带 `expiry`（Q3/T3 允许 expired；不是 withdrawn）。代码支持这条；本轮没走。
- `0f0e` 在关 Host 时是 **open**（deadline 11:38:51.949 > 11:37:46），且没有存下的回复（response 11:42:38 才写）。G3 补充裁定二第 4 条（`p6g-rulings.md:72`）说“本包不改，STATUS 记‘G3 只覆盖回复在重排队之前已经存下’。重排队时等待还开着怎么办……另议”。所以如果把它当 G3 重排队，这是**规格没覆盖**的那一支；但实际不是重排队。
- **结论：** 本次重启**合规**（starting Run 的同一次领取续驱）；G3 未触发。驱动 note 用 `wait.mjs:352` 的 `status !== 'ended'` 把 starting 叫成“仍在跑”，并在 `:354` 写成“重启后它记中断、按普通重新入队接着做”，这与 `TaskClaimed` 11:37:38 / Entry 11:39:59 / 同 Run id 不符。改法：输出 `run.status`，把 `starting` 与 `running` 分开，note 改成“claimed-not-entered，同一次领取续驱（W-01..W-03）”。

### 这次有没有走到“接续线读同任务接续链上的等待”

**没有。** 4 个 Session 的 `provenance.kind` 全是 `new`，0 个 continuation；`a23a44ce`/`e011e417` 的 claim Session 都是 `session-5a82…`；`restart-kept` 读的是成员线自己的 wait，不是 G3 的来源链读权。`mailbox-access.ts:97-110` 要求 reader `provenance.kind==='continuation'`；成员 `respond_session_message` 只有一条，答的是插话 `610490d7…`。所以不要把这次 `restart-kept` 当 G3 证据；要覆盖 G3 必须造 crash-requeue + continuation Session。

### 叫醒轮里只回“收到”的 1 个

- 唯一被计的是 `intervention-planning-45397f491c2d2a822056768c920e72175375a8a548b33b19f7375e9f495d529f`（wait，session `8886b6ab…` / platform-secretary，11:37:38.806 提交）。
- 它是 `cancelled`，不是模型答复；但按现行 Q11/`run.mjs:218-238` 的成文口径“成功调用只有读类/答复”，它仍算 ack-only。要排除 cancelled 是改定义，需 lead 先改 Q11，再动 `run.mjs:238`；本轮**不改计数**，waiting 的 ack-only 按现口径仍是 1，不是 0。

## 五、E09：上报在参谋最后一轮之后、Goal 完成之前 34.9 秒，平台按文档不开新轮

### 事实

- 执行者 B 的 Kernel turn `kturn-b37084bc800816a2e54ec2de7a73f0688003665337e4da53c2e28bc8fc6008d5`（session `91cbc373…`，Run `f689bf87…`）在 10:13:27.876 调用 `send_session_message`，工具结果 `{"status":"committed","sendStatus":"sent",...}`；账本 #249 `SessionMessageSent` @ 10:13:27.941，消息 `48cf4267…`。
- 收件人：`session-1a4eb7a43ad0c20e13e0b35c30da6ef336225fa68ca9c5eaeba2eecca8f1d47f`（参谋线）。
- 快照字段：`needsReply:true`、`wake:true`、`answeredBy:"line"`、`delivery:"queued"`、`deliveryEvidence:null`、`status:"pending"`、`readAt:null`、`response:null`、`acceptedInputs:[]`。
- 参谋线 1a4e 一共只有 2 个 QueryRun：
  1. `cold-start-query:…:coarse_split:root`：10:09:02.354–10:10:08.341；
  2. `intervention-planning-e8e7cc…`：10:10:23.418–10:12:26.716。
- 上报 10:13:27.941 在两者**之后**；上报之后该线的 QueryRun = 0，也没有新的 QueryJob。两轮的 turn 输入都没有 `48cf4267…`。
- Goal 10:14:02.795 COMPLETED，距上报 34.9 秒。

### 平台为什么没开下一轮

- `SessionMessage` 提交只叫醒两类队列：`goal_waits`（唤醒目标驱动）和请求轮队列（`STATE-MACHINES-SPEC.md:3659`；`host.ts:1519` 的 `REQUEST_ROUNDS_QUEUE` 订阅 `SessionMessage`）。上报的 `requestRoot:null`，不是请求轮；`goal_waits` 只让 Goal 驱动再看一次，不开参谋线。
- 空闲线的消费是 `consumeIdle`（`host.ts:3173`），挂在共享心跳上：`host.ts:4156-4157` 的 `period = min(attention heartbeat, inputConsumers heartbeat, scribeReminderPeriodMs)`；本运行没有 attention/inputConsumers（`w-accept/workbench-config.json` 没有这些字段），`scribeReminderPeriodMs` 默认 60_000（`host.ts:363,3449`），消费周期是 **60 s**。
- `wake-loop` 只按聚合类型唤醒订阅它的队列（`wake-loop.ts:175,380-396`）；没有“空闲线消费者”队列订阅 `SessionMessage`（`grep -n "aggregateTypes:.*SessionMessage" src/app/host.ts` 只有 1 行，就是 `:1519` 的请求轮队列）。
- 上报只活了 34.9 秒；下一次 60 秒消费心跳落在 Goal 完成之后；在“已完成目标”上，`agent_wake` 被 `newRoundHeld` 扣住（`consumable-sessions.ts:196-205,211-220`，调用点 `:639-645`），消息留在箱里。`intervention.ts:243-248` 也写明：Goal `COMPLETED` 时只有**人**的消息会走新目标请求，其他来源“留可读、不开轮”。这是**按文档的行为**（`IMPLEMENTED-CAPABILITIES.md:559`：“目标已完成时不开新轮，信留在箱里”；测试 `tests/app/P2-T1-T3-wake-entry.test.ts:255-277` T3e）。不是 P6G。

### 根因在模型/计划

1. 秘书首版规划（QueryJob `60e90448-809b-4b03-82e6-b537bb66c258`，session-7280，10:03:23–10:08:48）拿到人的 REQUEST（“执行时发现了先上报参谋，由参谋向我说明冲突的具体对象和影响，我来决定”），却把冲突写成：
   - 任务 B 的说明：“如果无法在不改 A 接口的前提下满足要求，就把冲突作为阻塞写进完成说明，交回参谋”——B 能局部适配，于是不认为“无法”，直接完成；
   - 目标 gate `conflict-gate` 的义务“冲突对象与影响已写明，待人裁决”，但 `setup.checks` 里的 `conflict-review` 只执行 `node -e "const fs=require('fs');const r=fs.readFileSync('src/report.js','utf8');const uses=/import[^;]*from\\s*'\\.\\/api\\.js'/.test(r);..."`，即**只断言 `report.js` 从 `./api.js` import**，既不读 open_question 笔记，也不检查“人已裁决/新版本已采用”；
   - 目标卡的完成标准也只写“冲突记录列出…状态为待你裁决”，没有“人已裁决”。
2. 执行者 B 在 10:13:27.876 发出 `needsReply:true` 的上报，但**没有 `waitAfterSend`**；它的 Run 在 10:13:39.251 `completed`、`continuation:null`，Task B 10:13:40.467 完成。
3. A、gate 随后完成；Goal 10:14:02.795 COMPLETED，此时 note `912b8fa8-937d-4130-9813-32ee8640921a` 仍是 `open_question`，正文写“状态：待你裁决”。
4. 上报在参谋最后一轮之后 34.9 秒、Goal 完成前一直存在，但 60 秒消费心跳落在完成之后；平台按“已完成目标不开新轮”把信留 box。参谋两轮输入因此没有它。

**类别：模型（秘书首版计划/目标卡；时间不够是触发）。** 不是平台偏差，不是驱动读错：`e09.mjs:121-141` 按 `messages/view` 认上报，本轮 pass；`e09.mjs:179-181` 用 `lines/list` + `sessions/history` 过滤参谋线的 turn，读的是参谋线 1a4e，不是秘书线；`e09.mjs:183-187` 只在“已收到的轮里还有 `final===null`”时再读最多 5 分钟，本轮 `received.length===0`，立即判 not-run，且读取发生在 10:14:08.683，晚于 GoalCompleted，读的是终态。即使等 5 分钟，Goal 已完成、平台按文档不会开轮，结论仍一样。

### 最小改法

- `resources/prompts/platform/templates/skill-platform-work.txt:41-45`（执行者上报）：在“仅做事轮下一步被回复卡住时填 `waitAfterSend:true`”后补一句——**如果人点名“由我决定/等参谋解释”，即使本地能适配，也按阻塞处理：上报后 `waitAfterSend:true` 让出，不在回复前结束 Run/完成 Task。**
- `resources/prompts/platform/tools/submit_initial_plan.json` 的 `plan.goalCardDrafts.completion` 和 `setup.checks` 说明（以及 `skill-platform-secretary.txt` 的“检查：…要真查要求，不用空过的命令”一行）补一句——**人要求一条决定链时，目标卡的完成标准必须包含“人已裁决/新版本已采用”；gate 检查必须真的查这个要求，不能只查文件存在/import；人的决定不能由静态检查代替，要写成等回复的阻塞。**
- 可选（驱动侧、非判据错）：`e09.mjs:22` 的 REQUEST 加“在我裁决之前不要让目标完成；上报后等参谋回复”，让模型没有“记录即完成”的歧义。这是把 E09 的产品要求说清，不是改判据。

**测试行：** 不需要新增单测。这是提示词/场景输入的行为，机器只能验证文字和格式，不能断言模型是否照做；改后重跑 `e09.mjs` 的 `adviser-explains` 看链是否在 Goal 完成前发生。平台行为已有 `tests/app/P2-T1-T3-wake-entry.test.ts:255-277`（T3e）固定，不需要再补。

### 旧根因

- `adviser-explains` 旧驱动 bug（快照早于 final）：**已修**（`e09.mjs:183-187` 的 5 分钟再读；本轮没有已收到的轮，未触发，也不是本轮原因）。
- `executor-reports` 旧驱动 bug（按 `args.intent` 认上报恒 undefined）：**已修**（`e09.mjs:121-141` 按 `messages/view` 认，本轮 pass）。
- 旧第 18 条“E09 gate-contract-conflict 检查太弱”（模型/计划）：**仍在**。上一轮是 `grep parseDate src/api.js && grep import… src/report.js`；本轮 `conflict-review` 甚至只剩 `report.js` 的 import 断言。新证据：gate 轮 10:14:02.684 PASS、10:14:02.738 gate 完成、10:14:02.795 Goal COMPLETED，而 note 912b8fa8 仍“待你裁决”。这是同一族的模型/计划根因，不是新的平台 bug。
- 平台“已完成目标不开新轮”：**不是 bug**，是文档行为（`IMPLEMENTED-CAPABILITIES.md:559`、`consumable-sessions.ts:196-205`、`intervention.ts:243-248`、T3e）。本轮没走“目标完成前开轮”的支路，是 34.9 秒与 60 秒心跳的时间差，不是 P6G 回归。

## 六、叫醒轮与 T6

- **13 个叫醒轮：** e05 1、e08 1、e08b 3、e09 1、e12 1、int 1、iter 1、wait 4 = 13。`run.mjs:215-221` 按 `snapshot.ref.queryJobId` 前缀 `intervention-planning-` 计数，key 是 `projectId#workspaceId#jobId` 去重；与账本 distinct 一致，没有重复/漏计。README `:83,90-91,314-322` 的逐 unit 数与此一致。
- **无 T6。** 按叫醒轮建图（一轮在 A 线，消费 B 线发的消息，同时/之后另发一条给 B 线），只有 e08b 第 2 轮（12:19:05）满足，一条 A←B；其余 12 轮 9 轮来源是平台消息，wait 的 3 个秘书轮只以 `respond_session_message` 回复、没有另发新消息（若把回复也算，3 条同向边）。13 个叫醒轮中没有任何一对线出现 A←B 后 B←A 的交替；**最长严格交替链 = 1 轮**。
- **如果把 Work Run 也算“轮”：** wait 的成员线 `5a82f220…` ↔ 秘书线 `8886b6ab…` 有一条 6 轮交替：成员 Run（Q1 `0f0e`）→ 秘书轮 `45397f`（未回复，到期）→ 成员 Run（Q2 `60e30e`）→ 秘书轮 `ef651ad6…`（回复 11:43:01）→ 成员 Run（Q3 `6afae`）→ 秘书轮 `cb3d56f4…`（11:44:18 答）。这是等待场景的设计链（第 2 次询问/到期/迟回），每轮都有新问题或答复，不是空转；T6 的书面口径只说“两条线之间来回超过 5 轮”，没有说含 Work Run。**没有书面依据加限制；可选（无书面依据），不建议加 guard。**
- **13 里含一个 cancelled 轮** `45397f`（wait）；计数按“有 intervention-planning QueryJob 的轮”而不是“答完的轮”，所以 13 的口径本身对；waiting 的 ack-only 子集应为 0（见 §四）。

## 七、P6G 回归与旧根因总表

| 旧根因（`p6-diagnosis-2.md`） | 本轮状态 | 新证据 |
|---|---|---|
| E05 overlap 772 ms 被当空闲（平台） | P6G 补充裁定说前提不成立：claim 占线起点已有；P6G G1 改的是 `workflow.ts` 的 busy 重挑；本轮**没走到**，不能说真实运行已修好；本轮 overlap 的 fail 是 stall 标签 | `claim-service.ts:1552`；`workflow.ts` busy 重挑（`p6g-rulings.md:52-62`）；E05 段 `goals/create`/`driver-start` 0 行 |
| E05 duplicates/temporary（模型） | 没走到（t-users/t-orders 未创建） | 账本只有 seed Run |
| E05 reviewer/name/line-choice（驱动） | 代码已修，没走到 | `e05.mjs:280-281,144-147,316-322` |
| E06 handoff、same-task-new-run、successor-input（平台/驱动） | E06 没跑；E05 没留线 | E06 0 HTTP/0 模型 |
| E08 versions（模型没交候选） | 本轮交了候选，但候选把 task-sub 留 active；**新形态** | 账本 #213/#220 |
| E08 hold-before-adopt（模型/驱动记法） | 本轮 not-run 根因是驱动等待谓词（sub 先被领）；只改谓词会让 sub-first 40 分钟后记 fail，保留 sub-first 立即 `uncover` 或把提交挪到采用后/mul 前 | `e08.mjs:219-220`；#133；`http.jsonl:62` |
| E08b 四条（模型/驱动） | 本轮模型没交改需求候选、没 request_stop；`sub-running` pass 保留 | `requestRef=3f323670` proposal 0；`request_stop` 0 |
| E09 adviser-explains（驱动快照早） | 已修；本轮 not-run 是上报落在最后一轮之后 + Goal 完成 | `e09.mjs:183-187`；#249/#291 |
| E09 executor-reports（驱动） | 已修，本轮 pass | `e09.mjs:121-141` |
| E09 gate 检查太弱（模型/计划） | **仍在** | `conflict-review` 只查 import；note 仍“待你裁决” |
| E12 history-reuse（模型）/stale-premise/wait-registry | 没走到；本轮 waitAfterSend 0、重启早于新 Goal | `e12.mjs:152-155`；账本 0 |
| waiting expiry-once / consumes / late-reply / restart-kept（驱动/平台） | 旧驱动假阳性已修；本轮 `expiry-once`/`consumes`/`restart-kept` pass；`second-expiry` reason 仍错、supply-order 仍无条件、restart note 仍错 | `wait.mjs:212-214,421-422,545,352-354` |
| waiting restart-kept 平台续作缺口（G3） | 本轮**不是 G3**：35c 是 starting，重启是同一次领取续驱；G3 未触发，合规 | `startup-reconcile.ts:459-460,670-672`；#186 |
| 叫醒轮 31→25 重复计数 | 本轮 13，逐 unit 与账本一致，无重复 | `run.mjs:215-221`；README `:83,90-91` |

**P6G 回归结论：** 五份报告逐项核了 `git diff 63ff3a0f d5c975eb -- src`，没有一条本轮的停点落在 P6G 改动的文件/行为上。G1 的 `workflow.ts` busy 重挑在本轮 E05 没走到（E05 没走到双任务）；G2 的交接在 E05 没留下线、E08/E09 没触发；G3 的 `carryWait`/`continuationWaitRight` 在 waiting 的 crash-requeue 路径，本轮 `35c` 是 starting 的同一次领取续驱，不是 G3。所以 **P6G 没有带进这四条 fail**。

## 八、说不清的 / UNSPECIFIED

1. **E05 `c-readme` 在 `VerificationCheckBegun` 之后到底停在哪一步。** 账本只有 begin，没有进程启动/结束、没有报告 artifact、没有 `recordCheckResult` 结果；按代码路径，最可能停在 `check-execution.ts:228-230` 的 `commandSlots.acquire`（Host 只有 4 个槽，seed 的 4 次 `run_readonly_command` 正好等于槽数，但账本没有槽位计数，无法证明槽是否泄漏），其次是 `:331-339` 的 root/permission 复核，也不能排除 `recordResult` 的 3 次重试都失败。能确定的是：检查没有真正在跑（30 s timeout 早该结束），平台也没有在运行中推进它。
2. **E05 的 `CHANGE_PENDING / change_pending`。** stall 时 display 的最后 phase/cause 是 `CHANGE_PENDING / change_pending`，随后 09:09:43 才有 pause；这是 pause 前的目标状态投影，不影响“检查窗口没有结果”的结论。
3. **E08b 的 `stop-delivered`/`safe-point-end`。** 按 lead 11-25 的裁定（`e08b.mjs:116-118`、`driver-build-reply.md:29`）本轮仍记 `not-run`；模型 0 次 `request_stop` 是 finding。若 lead 认为“改需求提交时 sub 在跑、停叫支路已到”应改 fail，要先改这条 lead 裁定，再改 `e08b.mjs:121-123`；本文不先改 verdict。
4. **T6 的“全轮”口径。** 13 个叫醒轮图最长 1 轮，无 T6；若把 Work Run 也算轮，wait 的成员线↔秘书线有 6 轮交替，但每轮都有新问题/答复或到期。README 的 T6 只说“两条线之间来回超过 5 轮”，没有说是否含 Work Run；没有书面依据加限制。**可选（无书面依据），不建议加 guard。**
5. **E12 空覆盖 stage gate 的处置。** 现规格只说“找不到 producer 就 waiting”，没有说空覆盖 gate 该跳过/视为 satisfied，也没有说 `plan-validation` 应拒绝。**没有书面依据；不改平台。** 若 lead 认为空覆盖 gate 是计划错误，应先写规格，再改提示词/校验。
6. **E09 的 60 s 心跳相位。** 账本不直接记“消费心跳”事件；本轮“上报后 34.9 s 内没有开轮”+ 周期 60 s，推断下一次心跳在 Goal 完成之后。若 lead 需要精确到毫秒，需要 Host 心跳日志，当前快照不提供。
7. **E08b `tests-static` 检查的转义错。** 初始计划答案写进 host settings 的 `tests-static` 用 `node -e "…'export\\s+…'"`，双引号吃掉反斜杠后正则变成 `/exports+functions+adds*(/g`，检查自身 `SyntaxError`；这是三笔 auto-requeue、三笔 `no_new_basis` 的直接原因。属模型写的检查命令；平台是否安装时试运行检查，规格未要求，记可选。
8. **E09 的 `disposition`。** 账本 `SessionMessage` 快照没有 `disposition` 字段（只有 `delivery`）；`messages/view` 的 disposition 未逐条落盘，本报告只用了 `delivery:"queued"` 和 `deliveredTo:null`。

## 九、建议优先级

1. **lead 先定 E05 的 VD-10 停窗**：是接受“Host 不重启就永远卡住”，还是改规格让 `check-execution` 重试用尽后 `interruptCheck`。这是唯一需要平台/规格动的地方；不先定，E05 下一轮还会以同一方式停住。
2. **驱动先修判据归属/顺序**（不改产品）：E05 先决定是否给 `waitFor`/`broken` 一个“无判据”模式（会影响约 30 个调用点），或让 seed 前置等待走单独路径；E08 `versions`/`switch`/`old-evidence` 在采用后立即判，`no_new_basis` 不落到下一个未判判据；waiting `second-expiry`/`supply-order`/restart note 按现有事实修；`ack-only` 是否排除 cancelled 由 lead 先改 Q11 定义。E08b 保持 lead 11-25 的 `not-run`。
3. **模型/提示词**：E12 的 stage gate 覆盖规则；E09 的“人裁决链必须保持 Goal 未完成 + 上报 `waitAfterSend` + gate 真查”；E08 的改需求候选按 `secretary-answer.txt:6` 只改 disposition/替代任务。
4. **重跑顺序**：E05 先定停窗/前置等待口径，才能带出 E06；E08 先修判序，才能看到模型的真实 fail；E12/E09 改提示词后重跑；waiting 的 4 条 env 需要场景造出 open wait 才有覆盖；E08b 若要改 fail 先改 lead 裁定。
