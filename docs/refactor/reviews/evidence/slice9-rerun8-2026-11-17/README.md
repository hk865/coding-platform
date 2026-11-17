# 第 9 片真实验收（G6）2026-11-17

- 树：`ee35d207cfb8dee75957f255fbcf4fce4b118bf2`（有未提交改动）；运行号 `g6-2026-11-17-1f29fa08`；2026-11-17T07:13:56.874Z → 2026-11-17T08:47:36.866Z。
- 授权原文（逐场景同样记在 result.json 的 `authorization`）：用户批准（2026-11-14，决定 121-124）：G6 真实验收使用 DeepSeek-V4.1-Flash（provider 顺序照规格：网关 smoke-flash，不通时白天 smoke-ollama、晚上 smoke-deepseek；A1/B1 用 smoke-deepseek）；总量 4 亿 token、每个场景 5,000 万 token（输入含缓存命中 + 输出），超了就停；时间窗不限；不写钱数；只在临时运行目录里建账本和工作区，不提交、不推送、不对外发东西。
- 令牌：wa#0: 已取得令牌；wb#0: 已取得令牌；w-accept#0: 已取得令牌。

## 八个场景：total=8 / pass=0 / fail=4 / uncovered=4

| 场景 | 判定 | C 行 | 未覆盖 |
|---|---|---|---|
| E05 | fail | C-182, C-183, C-185, C-71, C-73, C-191, C-208, C-217, C-218 | reviewer: 审阅者独立判断它是同一条规则（审阅要求有结论） (entry-missing); name-different: 名字不同、规则相同：报 (entry-missing); name-same: 名字相同、规则不同：不报 (entry-missing); line-choice: 派工排除只读副本/等待/退役线并按六键排序 (entry-missing) |
| E06 | fail | C-75, C-135, C-106, C-194, C-149, C-151, C-68, C-181, C-209, C-219, C-223 | successor-input: 接任者实际输入（turn 输入）含目标词和前任 hand_off 的理由原文，不只同一 sessionId (not-run); successor-frontier: 接任者实际输入含前任的义务/前沿 (not-run); no-restatement: 换手后用户没有重述任务 (not-run); excluded-path: 接任者引用当前理解并避开已排除路径 (not-run); same-task-new-run: 同一 Task 新开 Attempt/Run 优先原 Session，带接续说明 (not-run); history-continuity: 后续输入真正含必要前文（不只同一 Session ID） (not-run); restart-running: Work Run 在跑时正常关闭重启：记被中断，继续在原 Session (not-run); restart-paused: 暂停中重启：不算失败，可继续，恢复后在原线接着做 (not-run); archive: 归档前任后源线历史可读（sessions/history、executions/history） (not-run); hand-or-drop: 归档有未完成任务的线：先选交给或放下，同时释放责任与席位 (not-run); wake: 答卡等提交叫醒目标驱动，后继 Run 真的启动 (not-run) |
| E08 | fail | C-47, C-62, C-63, C-133a, C-126, C-46, C-52, C-116, C-118, C-210 | switch: 受影响任务切到新定义（出现 div 任务，sub 被取消），无关任务继续（mul） (not-run); old-evidence: 旧证据不满足新义务：div 的义务要求只由改后计划下、div 自己改后 Run 的检查轮覆盖 (not-run); required-cancel: required 取消后不因空集合变绿（div 满足之前 Goal 不完成） (not-run); autonomy-later: 改自治级别只影响之后的动作，不停正在跑的工作 (not-run) |
| E09 | fail | C-185, C-89, C-65, C-98, C-93, C-95, C-99, C-55, C-62, C-211, C-212, C-218 | adviser-explains: 参谋解释具体对象和影响 (not-run); person-decides: 人的决定有授权与版本（答卡带钉住的版本） (not-run); new-version: 新计划版本替换受影响任务，新定义进上下文 (not-run); formal-change: 正式架构变更走 architecture/revise，产生新目录版本 (not-run); drift: 漂移能定位版本/文件（compare-formal 的 finding 带 path） (not-run); observation-after-pass: 检查 PASS 定稿后自动抓一次观测 (not-run); rounds: 每个 Work Task 开轮、PASS 无缺口、证据写入 (not-run); uncovered-round: 没有覆盖必需要求的检查时读作 INCONCLUSIVE，不以空集合 PASS (not-run) |
| E12 | uncovered | C-36, C-42, C-157, C-88, C-89, C-104, C-145, C-146, C-158, C-147, C-155, C-207, C-114, C-215, C-220 | reads-quiet: 读、展开、分页前后：没有新 QueryRun、用量不增、changes 游标不动 (not-run); graph-cards: graph/look、graph/find 从已存事实拼出节点卡（路径/版本可回指） (not-run); raw-history: 能读到实际保存的完整原历史 (not-run); completion-chain: 从 Goal 完成走到义务、证据、原检查和文件版本 (not-run); restart-state: 同 ledger 新 Host 读回原 Goal（仍 COMPLETED）、计划和执行 (not-run); reconcile: 持租约的 Host 启动先核对、写出报告 (not-run); redrive-sets: 已完成 Goal 不进被中断集（不写 GoalInterruption） (not-run); new-goal: 旧线的消息先确认成新 Goal，旧 Goal 完成不变，新 Goal 不继承完成事实 (not-run); history-reuse: 重启后的相关新工作实际查询了已完成工作，结果带来源（旧 Goal/Run 的引用） (not-run); stale-premise: 保留适用范围，过期前提不升级 (not-run); replay: 同一次 driver-start 重放只读原来的执行 (not-run); wait-registry: 目标等待登记表启动时只读重建 (not-run) |
| iteration | uncovered | C-108, C-109, C-110, C-111, C-112, C-105, C-107, C-113, C-194, C-213, C-226 | ideas: 有治理的项目上先给 2–3 个简短思路，不带目标卡草稿 (not-run); select: 选思路只认人，下一轮输入写明选了第几个 (not-run); candidate: 选思路后出完整计划，写成这个请求的候选 (not-run); what-changed: 每轮说明改了什么 (not-run); per-request: 候选按请求分开；采用一个后另一请求的旧候选读作过期 (not-run); why: 追问“为什么”用原方案和原理由回答，不重出计划 (not-run); continues: 带 continues 的追问在同一请求后加一轮，交给同一个秘书 (not-run); request-goal: 请求记下发出时选中的目标 (not-run); cards-ask: 带卡片引用的 ask 在同一请求后加一轮，输入在 ## Cards 下写明钉住的版本 (not-run); multi-round: 多轮之后后续轮接得上前面的内容（同一秘书 Session） (not-run) |
| intervention | uncovered | C-199, C-200, C-201, C-202, C-203, C-114, C-189, C-192, C-197, C-198 | ask-copy: “问一问”开只读副本，不打扰原线 (not-run); delivery-states: 消息在安全点送达，分别显示已排队/已送达（disposition） (not-run); continue-no-planning: 有任务接着做时不开 intervention_planning (not-run); planning-when-idle: 活跃目标、线上没有未完成任务时开 intervention_planning，答案交 plans/propose (not-run); four-endings: 四种收尾（反问/非法/没答/放弃）各落到通知、回复或撤回，不静默 (not-run); completed-goal: 已完成 Goal 上加工作，先确认成新 Goal，原完成不变 (not-run); paused-queues: 暂停时干预只排队，不冒充继续；恢复后才送达 (not-run) |
| waiting | uncovered | C-170, C-171, C-187, C-188, C-190, C-172, C-184, C-189, C-192, C-195, C-196, C-207, C-224, C-225 | wait-open: 成员 Work 经真实工具发出等待（waitAfterSend）：原问题、收信人、期限都在 (not-run); restart-kept: 正常关闭重启后仍核对原等待（同一 messageRef、收信人、期限） (not-run); expiry-once: 到期先记下（expiredAt），不算消费；由 expiry 接受消费 (not-run); second-expiry: 同一追问链第二次实际到期，后继输入写“第 2 次到期” (not-run); consumes: 真实接受才 consumesWait:true；迟到的普通回复写 false (not-run); late-reply: 迟回保存为下一个安全点的新输入，不重开旧等待 (not-run); transfer: 转交保留问题和期限，未送达不自动换人 (not-run); disconnect: 等待的一侧归档后 decisions/queue 出这条等待的 disconnect 项，Host 给两侧各发 notify (not-run); supply-order: 供给按冻结顺序：人的消息、续作、agent 消息 (not-run) |

每行的逐条判据、证据和原因见 `checks/notes.md`；没跑到的判据记 `uncovered`，不因场景其余判据通过而通过。

## A/B 两格（不进 result.json）

### A1（1M → 131072）：pass

- reserved（C-214）：pass。reservedOutput 131072（requestId 4ccd6062-7abb-4482-ae84-7090a486aa86）
- usage（C-214）：pass。usageStatus reported，输入 29005，输出 118，缓存命中 25216
- accepted（C-214）：pass。请求被接受（用量已报）
- not-truncated（C-214）：pass。输出 118 < 预留 131072；close detail none
- driver-start: ready running
- 请求事实：[{"requestId":"4ccd6062-7abb-4482-ae84-7090a486aa86","reservedOutput":131072,"usageStatus":"reported","inputTokens":29005,"outputTokens":118,"cachedInputTokens":25216},{"requestId":"0e907637-5a6d-45a4-9db8-3528c9a69d60","reservedOutput":131072,"usageStatus":"reported","inputTokens":30546,"outputTokens":195,"cachedInputTokens":29056},{"requestId":"1920f60c-9c55-4fc9-9933-0977335b164a","reservedOutput":131072,"usageStatus":"reported","inputTokens":31744,"outputTokens":279,"cachedInputTokens":30720},{"requestId":"e85bda59-f3bf-45e9-a3ab-e77702f09bf7","reservedOutput":131072,"usageStatus":"reported","inputTokens":33521,"outputTokens":182,"cachedInputTokens":32000},{"requestId":"e1f4dc77-15c4-4dcd-b0d0-16ccb34bb1f6","reservedOutput":131072,"usageStatus":"reserved","inputTokens":null,"outputTokens":null,"cachedInputTokens":null}]；Query running；close null；profile 累计输出上限 null = 不设上限
- queries/cancel after the first request: ready stopping
- request e1f4dc77-15c4-4dcd-b0d0-16ccb34bb1f6: cut by the driver's cancel; usage not reported, at most one request (Query closed, close cancelled)

### B1（128k → 64000）：pass

- reserved（C-214）：pass。reservedOutput 64000（requestId 07babd00-2fb7-46a1-9a20-ec5ed57f1f31）
- usage（C-214）：pass。usageStatus reported，输入 15612，输出 79，缓存命中 12160
- accepted（C-214）：pass。请求被接受（用量已报）
- not-truncated（C-214）：pass。输出 79 < 预留 64000；close detail none
- fits（C-214）：pass。请求发出（reservedInput 以内），reservedOutput 64000
- driver-start: ready running
- 请求事实：[{"requestId":"07babd00-2fb7-46a1-9a20-ec5ed57f1f31","reservedOutput":64000,"usageStatus":"reported","inputTokens":15612,"outputTokens":79,"cachedInputTokens":12160},{"requestId":"246cd384-333f-462e-9880-a615d127e11c","reservedOutput":63921,"usageStatus":"reported","inputTokens":16450,"outputTokens":166,"cachedInputTokens":15616},{"requestId":"3b324af6-e2c1-4be6-a54b-b30d611926c6","reservedOutput":63755,"usageStatus":"reported","inputTokens":17495,"outputTokens":439,"cachedInputTokens":16512},{"requestId":"8990fd21-5ac5-4084-8bc9-b53c61879b81","reservedOutput":63316,"usageStatus":"reported","inputTokens":18118,"outputTokens":361,"cachedInputTokens":17920},{"requestId":"8063e93c-f1cc-47d0-ad97-ab4820000842","reservedOutput":62955,"usageStatus":"reserved","inputTokens":null,"outputTokens":null,"cachedInputTokens":null}]；Query running；close null；profile 累计输出上限 64000
- queries/cancel after the first request: ready stopping
- request 8063e93c-f1cc-47d0-ad97-ab4820000842: cut by the driver's cancel; usage not reported, at most one request (Query closed, close cancelled)

## 压缩场景（单列，不算第 9 个场景）

### 压缩：uncovered

- compacted（K2-P2）：uncovered (not-run)。stopped before this check: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min
- six-sections（K2-P2）：uncovered (not-run)。stopped before this check: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min
- accepted（K2-P2）：uncovered (not-run)。stopped before this check: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min
- cache-after（K2-P2）：uncovered (not-run)。stopped before this check: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min
- stopped: not-run: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min

## 附加格（八个场景之后的附加 Goal）

### C-216：uncovered

- observed-start（C-216）：uncovered (not-run)。stopped before this check: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min
- adopted-done（C-216）：uncovered (not-run)。stopped before this check: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min
- stopped: not-run: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min

### C-221：uncovered

- first-plan（C-221）：uncovered (not-run)。stopped before this check: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min
- fail-rework（C-221）：uncovered (not-run)。stopped before this check: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min
- delivered（C-221）：uncovered (not-run)。stopped before this check: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min
- stopped: not-run: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min

### C-222：uncovered

- created（C-222）：uncovered (not-run)。stopped before this check: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min
- started（C-222）：uncovered (not-run)。stopped before this check: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min
- stopped: not-run: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min

## B06

### B06 关闭格：uncovered

- W1a（B06-W1a）：uncovered (not-run)。stopped before this check: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min
- W2（B06-W2）：uncovered (not-run)。stopped before this check: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min
- W3（B06-W3）：uncovered (not-run)。stopped before this check: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min
- W5（B06-W5）：uncovered (not-run)。stopped before this check: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min
- W10（B06-W10）：uncovered (not-run)。stopped before this check: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min
- W12（B06-W12）：uncovered (not-run)。stopped before this check: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min
- explore（B06-cond3）：uncovered (not-run)。stopped before this check: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min
- stopped: not-run: request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min

## 撞墙表

共 109 行（其中场景预期的拒绝 4 行），每次拒绝一行，原文见 `checks/notes.md`。

## 预算

- 上限：总量 280000000，每个场景/格 50000000（acceptance.config.json `tokenCaps`）。
- 口径：用量 = inputTokens + outputTokens（Kernel 的 inputTokens 已含缓存命中，cachedInputTokens 另记、不再相加）；每条按它所在项目的归属场景/格计，不按读到的时间。
- 合计：用量 28040870（输入 27812960，输出 227910；缓存命中 25395840）；Query 请求 238 次（含 Query 的压缩摘要请求，公开记录分不出）；结束的 Work Run 18 个，其中 0 个是公开证明的零（没进入 Kernel）；未知或不完整的用量不算零：已关闭 Query 里用量未知的请求按预留上限（输入预留 + 输出预留）计，只会多算；Work Run 的用量未知或不完整、或请求的预留读不到时，计量停下。
- 已知缺口：Work Run 的压缩摘要请求在另一个 Kernel Session 里跑，不在 `activity/runs` 里，计量少算了它们；驱动不读数据库补数（lead 裁定 11-14 #3）。400M/50M 上限远高于预期用量，这是记下的缺口，不是阻断。
- 最后一次完整读数时在途：Query 0，Work Run 0（Work Run 的用量要等 Run 结束才在 `activity/runs` 出现，所以超限后的停止点是第一次能看到超出的读数）。
- 计量不可用：request 629d45d6-57cc-4fec-b796-0a6e3616098b of intervention-planning-23c325a175db926424cc1c5e82f4b7e689c858bfe69cc277892d8a4b7bb9cc36 has usage unknown and its Query has not ended yet; new work waits for its terminal fact; it did not end within 30 min
- A1：用量 125590（输入 124816，输出 774，缓存命中 116992；Query 请求 5（其中按未计费 0 计的 1：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 0）
- B1：用量 68720（输入 67675，输出 1045，缓存命中 62208；Query 请求 5（其中按未计费 0 计的 1：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 0）
- E05：用量 10878775（输入 10795621，输出 83154，缓存命中 9814912；Query 请求 91（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 4）
- E06：用量 263159（输入 260790，输出 2369，缓存命中 227456；Query 请求 5（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 0）
- E08：用量 2918234（输入 2880454，输出 37780，缓存命中 2634368；Query 请求 29（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 5）
- E09：用量 12783540（输入 12695126，输出 88414，缓存命中 11725568；Query 请求 83（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 8）
- E12：用量 1002852（输入 988478，输出 14374，缓存命中 814336；Query 请求 20（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 1）

## 延迟探针（只记录）

- wa#0：p50 21.58 ms，p95 21.91 ms，max 358.09 ms（3774 个样本）；关闭方式 SIGINT, exit 0 after 42 ms
- wb#0：p50 21.54 ms，p95 21.91 ms，max 215.74 ms（3776 个样本）；关闭方式 SIGINT, exit 0 after 26 ms
- w-accept#0：p50 20.48 ms，p95 21.84 ms，max 2003.83 ms（270258 个样本）；关闭方式 SIGINT, exit 0 after -1780 ms

## 证据

- `result.json`：八行，字段照 `slice-9-SPEC.md:729-745`。
- `checks/http.jsonl`：每次 HTTP（只有成功的同一读口连续同样答复合成一行带 `repeat`；每次拒绝单独一行）；预算计量的成功读不逐条记，只计数。
- `checks/model-calls.jsonl`：从公开读口取的每次 Query 请求用量和每个结束的 Work Run 合计，带归属的场景/格（`unit`，按项目归属，不按读到的时间）。
- `checks/commands.txt`：驱动起的命令（Host 起停、git、provider 探测）和退出码。
- `checks/notes.md`：逐条判据、撞墙表、A/B、压缩、B06、预算、延迟探针。
