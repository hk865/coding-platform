# 第 9 片真实验收（G6）2026-11-16

- 树：`158b765a65ed73a17a51595cb26316b97566a87c`（有未提交改动）；运行号 `g6-2026-11-16-f8645d87`；2026-11-16T13:08:30.223Z → 2026-11-16T14:54:58.602Z。
- 授权原文（逐场景同样记在 result.json 的 `authorization`）：用户批准（2026-11-14，决定 121-124）：G6 真实验收使用 DeepSeek-V4.1-Flash（provider 顺序照规格：网关 smoke-flash，不通时白天 smoke-ollama、晚上 smoke-deepseek；A1/B1 用 smoke-deepseek）；总量 4 亿 token、每个场景 5,000 万 token（输入含缓存命中 + 输出），超了就停；时间窗不限；不写钱数；只在临时运行目录里建账本和工作区，不提交、不推送、不对外发东西。
- 令牌：wa#0: 已取得令牌；wb#0: 已取得令牌；w-accept#0: 已取得令牌；w-accept#1: 已取得令牌。

## 八个场景：total=8 / pass=0 / fail=2 / uncovered=6

| 场景 | 判定 | C 行 | 未覆盖 |
|---|---|---|---|
| E05 | fail | C-182, C-183, C-185, C-71, C-73, C-191, C-208, C-217, C-218 | gate: 同模块重叠门回 task/module 和在跑的 Run (not-run); paths: 实际改动能给出具体 path（含共享文件） (not-run); kept: 两个任务的独立成果都还在，两个任务都 satisfied (not-run); single-occupancy: 同一 Session 同时最多一个写入执行（没有同 Session 时间重叠的两个 Run） (not-run); convention: 接口约定只交给一个任务写，另一个任务引用它 (not-run); duplicates: project_source compare（duplicates:true）列出埋入的副本及两处位置 (not-run); reviewer: 审阅者独立判断它是同一条规则（审阅要求有结论） (not-run); name-different: 名字不同、规则相同：报 (not-run); name-same: 名字相同、规则不同：不报 (not-run); temporary: 临时件在做完之前已收回（结束时没有计划外的未跟踪文件） (not-run); line-choice: 派工排除只读副本/等待/退役线并按六键排序 (not-run) |
| E06 | uncovered | C-75, C-135, C-106, C-194, C-149, C-151, C-68, C-181, C-209, C-219, C-223 | handoff: 模型 hand_off，人批准，出现接任线 (not-run); successor-input: 接任者实际输入（turn 输入）含目标词和前任 hand_off 的理由原文，不只同一 sessionId (not-run); successor-frontier: 接任者实际输入含前任的义务/前沿 (not-run); no-restatement: 换手后用户没有重述任务 (not-run); excluded-path: 接任者引用当前理解并避开已排除路径 (not-run); same-task-new-run: 同一 Task 新开 Attempt/Run 优先原 Session，带接续说明 (not-run); history-continuity: 后续输入真正含必要前文（不只同一 Session ID） (not-run); restart-running: Work Run 在跑时正常关闭重启：记被中断，继续在原 Session (not-run); restart-paused: 暂停中重启：不算失败，可继续，恢复后在原线接着做 (not-run); archive: 归档前任后源线历史可读（sessions/history、executions/history） (not-run); hand-or-drop: 归档有未完成任务的线：先选交给或放下，同时释放责任与席位 (not-run); wake: 答卡等提交叫醒目标驱动，后继 Run 真的启动 (not-run) |
| E08 | fail | C-47, C-62, C-63, C-133a, C-126, C-46, C-52, C-116, C-118, C-210 | switch: 受影响任务切到新定义（出现 div 任务，sub 被取消），无关任务继续（mul） (not-run); old-evidence: 旧证据不满足新义务：div 的义务要求只由改后计划下、div 自己改后 Run 的检查轮覆盖 (not-run); required-cancel: required 取消后不因空集合变绿（div 满足之前 Goal 不完成） (not-run); autonomy-later: 改自治级别只影响之后的动作，不停正在跑的工作 (not-run) |
| E09 | uncovered | C-185, C-89, C-65, C-98, C-93, C-95, C-99, C-55, C-62, C-211, C-212, C-218 | adviser-explains: 参谋解释具体对象和影响 (not-run); person-decides: 人的决定有授权与版本（答卡带钉住的版本） (not-run); new-version: 新计划版本替换受影响任务，新定义进上下文 (not-run) |
| E12 | uncovered | C-36, C-42, C-157, C-88, C-89, C-104, C-145, C-146, C-158, C-147, C-155, C-207, C-114, C-215, C-220 | history-reuse: 重启后的相关新工作实际查询了已完成工作，结果带来源（旧 Goal/Run 的引用） (not-run); stale-premise: 保留适用范围，过期前提不升级 (entry-missing); wait-registry: 目标等待登记表启动时只读重建 (entry-missing) |
| iteration | uncovered | C-108, C-109, C-110, C-111, C-112, C-105, C-107, C-113, C-194, C-213, C-226 | ideas: 有治理的项目上先给 2–3 个简短思路，不带目标卡草稿 (not-run); select: 选思路只认人，下一轮输入写明选了第几个 (not-run); candidate: 选思路后出完整计划，写成这个请求的候选 (not-run); what-changed: 每轮说明改了什么 (not-run); per-request: 候选按请求分开；采用一个后另一请求的旧候选读作过期 (not-run); why: 追问“为什么”用原方案和原理由回答，不重出计划 (not-run); continues: 带 continues 的追问在同一请求后加一轮，交给同一个秘书 (not-run); request-goal: 请求记下发出时选中的目标 (not-run); cards-ask: 带卡片引用的 ask 在同一请求后加一轮，输入在 ## Cards 下写明钉住的版本 (not-run); multi-round: 多轮之后后续轮接得上前面的内容（同一秘书 Session） (not-run) |
| intervention | uncovered | C-199, C-200, C-201, C-202, C-203, C-114, C-189, C-192, C-197, C-198 | ask-copy: “问一问”开只读副本，不打扰原线 (not-run); delivery-states: 消息在安全点送达，分别显示已排队/已送达（disposition） (not-run); continue-no-planning: 有任务接着做时不开 intervention_planning (not-run); planning-when-idle: 活跃目标、线上没有未完成任务时开 intervention_planning，答案交 plans/propose (not-run); four-endings: 四种收尾（反问/非法/没答/放弃）各落到通知、回复或撤回，不静默 (not-run); completed-goal: 已完成 Goal 上加工作，先确认成新 Goal，原完成不变 (not-run); paused-queues: 暂停时干预只排队，不冒充继续；恢复后才送达 (not-run) |
| waiting | uncovered | C-170, C-171, C-187, C-188, C-190, C-172, C-184, C-189, C-192, C-195, C-196, C-207, C-224, C-225 | wait-open: 成员 Work 经真实工具发出等待（waitAfterSend）：原问题、收信人、期限都在 (not-run); restart-kept: 正常关闭重启后仍核对原等待（同一 messageRef、收信人、期限） (not-run); expiry-once: 到期先记下（expiredAt），不算消费；由 expiry 接受消费 (not-run); second-expiry: 同一追问链第二次实际到期，后继输入写“第 2 次到期” (not-run); consumes: 真实接受才 consumesWait:true；迟到的普通回复写 false (not-run); late-reply: 迟回保存为下一个安全点的新输入，不重开旧等待 (not-run); transfer: 转交保留问题和期限，未送达不自动换人 (not-run); disconnect: 等待的一侧归档后 decisions/queue 出这条等待的 disconnect 项，Host 给两侧各发 notify (not-run); supply-order: 供给按冻结顺序：人的消息、续作、agent 消息 (not-run) |

每行的逐条判据、证据和原因见 `checks/notes.md`；没跑到的判据记 `uncovered`，不因场景其余判据通过而通过。

## A/B 两格（不进 result.json）

### A1（1M → 131072）：pass

- reserved（C-214）：pass。reservedOutput 131072（requestId 90793b25-6101-4f94-8965-31801d793744）
- usage（C-214）：pass。usageStatus reported，输入 29010，输出 94，缓存命中 3200
- accepted（C-214）：pass。请求被接受（用量已报）
- not-truncated（C-214）：pass。输出 94 < 预留 131072；close detail none
- driver-start: ready running
- 请求事实：[{"requestId":"90793b25-6101-4f94-8965-31801d793744","reservedOutput":131072,"usageStatus":"reported","inputTokens":29010,"outputTokens":94,"cachedInputTokens":3200},{"requestId":"18ec29b8-c6c3-484f-9057-7f2abd0c9e97","reservedOutput":131072,"usageStatus":"reported","inputTokens":30935,"outputTokens":170,"cachedInputTokens":29056},{"requestId":"6c074689-bf69-4529-ad15-873717609cd5","reservedOutput":131072,"usageStatus":"reported","inputTokens":31980,"outputTokens":232,"cachedInputTokens":31104},{"requestId":"930f9111-28b4-47ea-b4e5-7c11a77c0927","reservedOutput":131072,"usageStatus":"reported","inputTokens":32617,"outputTokens":189,"cachedInputTokens":32128},{"requestId":"b8460646-0c5b-4aea-983f-571fd2414790","reservedOutput":131072,"usageStatus":"reported","inputTokens":34161,"outputTokens":214,"cachedInputTokens":32768},{"requestId":"daf83e9a-bd4b-42ed-9cb5-541ddeb10e52","reservedOutput":131072,"usageStatus":"reserved","inputTokens":null,"outputTokens":null,"cachedInputTokens":null}]；Query running；close null；profile 累计输出上限 null = 不设上限
- queries/cancel after the first request: ready stopping
- request daf83e9a-bd4b-42ed-9cb5-541ddeb10e52: cut by the driver's cancel; usage not reported, at most one request (Query closed, close cancelled)

### B1（128k → 64000）：pass

- reserved（C-214）：pass。reservedOutput 64000（requestId d275f4f1-08ae-4357-b8b7-a32f1eee5d95）
- usage（C-214）：pass。usageStatus reported，输入 15616，输出 101，缓存命中 9472
- accepted（C-214）：pass。请求被接受（用量已报）
- not-truncated（C-214）：pass。输出 101 < 预留 64000；close detail none
- fits（C-214）：pass。请求发出（reservedInput 以内），reservedOutput 64000
- driver-start: ready running
- 请求事实：[{"requestId":"d275f4f1-08ae-4357-b8b7-a32f1eee5d95","reservedOutput":64000,"usageStatus":"reported","inputTokens":15616,"outputTokens":101,"cachedInputTokens":9472},{"requestId":"4cb59f06-8e74-42f4-a222-72b94b345c43","reservedOutput":63899,"usageStatus":"reported","inputTokens":16660,"outputTokens":151,"cachedInputTokens":15488},{"requestId":"2bcad0db-fed9-447c-9534-db6463ea6942","reservedOutput":63748,"usageStatus":"reported","inputTokens":17506,"outputTokens":114,"cachedInputTokens":16768},{"requestId":"42f34f03-7ecc-4319-9f1c-933adec158d7","reservedOutput":63634,"usageStatus":"reserved","inputTokens":null,"outputTokens":null,"cachedInputTokens":null}]；Query running；close null；profile 累计输出上限 64000
- queries/cancel after the first request: ready stopping
- request 42f34f03-7ecc-4319-9f1c-933adec158d7: cut by the driver's cancel; usage not reported, at most one request (Query closed, close cancelled)

## 压缩场景（单列，不算第 9 个场景）

### 压缩：uncovered

- compacted（K2-P2）：uncovered (not-run)。stopped before this check: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact
- six-sections（K2-P2）：uncovered (not-run)。stopped before this check: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact
- accepted（K2-P2）：uncovered (not-run)。stopped before this check: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact
- cache-after（K2-P2）：uncovered (not-run)。stopped before this check: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact
- stopped: not-run: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact

## 附加格（八个场景之后的附加 Goal）

### C-216：uncovered

- observed-start（C-216）：uncovered (not-run)。stopped before this check: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact
- adopted-done（C-216）：uncovered (not-run)。stopped before this check: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact
- stopped: not-run: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact

### C-221：uncovered

- first-plan（C-221）：uncovered (not-run)。stopped before this check: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact
- fail-rework（C-221）：uncovered (not-run)。stopped before this check: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact
- delivered（C-221）：uncovered (not-run)。stopped before this check: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact
- stopped: not-run: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact

### C-222：uncovered

- created（C-222）：uncovered (not-run)。stopped before this check: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact
- started（C-222）：uncovered (not-run)。stopped before this check: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact
- stopped: not-run: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact

## B06

### B06 关闭格：uncovered

- W1a（B06-W1a）：uncovered (not-run)。stopped before this check: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact
- W2（B06-W2）：uncovered (not-run)。stopped before this check: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact
- W3（B06-W3）：uncovered (not-run)。stopped before this check: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact
- W5（B06-W5）：uncovered (not-run)。stopped before this check: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact
- W10（B06-W10）：uncovered (not-run)。stopped before this check: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact
- W12（B06-W12）：uncovered (not-run)。stopped before this check: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact
- explore（B06-cond3）：uncovered (not-run)。stopped before this check: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact
- stopped: not-run: request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact

## 撞墙表

共 62 行（其中场景预期的拒绝 4 行），每次拒绝一行，原文见 `checks/notes.md`。

## 预算

- 上限：总量 400000000，每个场景/格 50000000（acceptance.config.json `tokenCaps`）。
- 口径：用量 = inputTokens + outputTokens（Kernel 的 inputTokens 已含缓存命中，cachedInputTokens 另记、不再相加）；每条按它所在项目的归属场景/格计，不按读到的时间。
- 合计：用量 16239066（输入 16091333，输出 147733；缓存命中 14527554）；Query 请求 146 次（含 Query 的压缩摘要请求，公开记录分不出）；结束的 Work Run 13 个，其中 0 个是公开证明的零（没进入 Kernel）；未知或不完整的用量不算零：已关闭 Query 里用量未知的请求按预留上限（输入预留 + 输出预留）计，只会多算；Work Run 的用量未知或不完整、或请求的预留读不到时，计量停下。
- 已知缺口：Work Run 的压缩摘要请求在另一个 Kernel Session 里跑，不在 `activity/runs` 里，计量少算了它们；驱动不读数据库补数（lead 裁定 11-14 #3）。400M/50M 上限远高于预期用量，这是记下的缺口，不是阻断。
- 最后一次完整读数时在途：Query 0，Work Run 0（Work Run 的用量要等 Run 结束才在 `activity/runs` 出现，所以超限后的停止点是第一次能看到超出的读数）。
- 计量不可用：request 75cbc26d-bdbe-45fc-ad0b-3e81ecf45f38 of intervention-planning-cb968e930eff48d2574794a8bf40f01d46383387f3273f931c62b88bb377da8c has usage unknown and its Query has not ended yet; new work waits for its terminal fact
- A1：用量 159602（输入 158703，输出 899，缓存命中 128256；Query 请求 6（其中按未计费 0 计的 1：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 0）
- B1：用量 50148（输入 49782，输出 366，缓存命中 41728；Query 请求 4（其中按未计费 0 计的 1：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 0）
- E05：用量 1197527（输入 1183673，输出 13854，缓存命中 1032576；Query 请求 16（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 2）
- E06：用量 0（输入 0，输出 0，缓存命中 0；Query 请求 0（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 0）
- E08：用量 3275510（输入 3234878，输出 40632，缓存命中 2943104；Query 请求 30（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 3）
- E09：用量 9747712（输入 9685256，输出 62456，缓存命中 8866882；Query 请求 56（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 5）
- E12：用量 1062716（输入 1049965，输出 12751，缓存命中 909440；Query 请求 15（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 2）
- iteration：用量 745851（输入 729076，输出 16775，缓存命中 605568；Query 请求 19（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 1）

## 延迟探针（只记录）

- wa#0：p50 20.19 ms，p95 20.41 ms，max 261.62 ms（3954 个样本）；关闭方式 SIGINT, exit 0 after 40 ms
- wb#0：p50 20.15 ms，p95 20.4 ms，max 219.15 ms（3972 个样本）；关闭方式 SIGINT, exit 0 after 23 ms
- w-accept#0：p50 20.15 ms，p95 20.46 ms，max 1213.2 ms（266572 个样本）；关闭方式 SIGINT, exit 0 after 214 ms
- w-accept#1：p50 20.28 ms，p95 20.77 ms，max 344.46 ms（37078 个样本）；关闭方式 SIGINT, exit 0 after 180 ms

## 证据

- `result.json`：八行，字段照 `slice-9-SPEC.md:729-745`。
- `checks/http.jsonl`：每次 HTTP（只有成功的同一读口连续同样答复合成一行带 `repeat`；每次拒绝单独一行）；预算计量的成功读不逐条记，只计数。
- `checks/model-calls.jsonl`：从公开读口取的每次 Query 请求用量和每个结束的 Work Run 合计，带归属的场景/格（`unit`，按项目归属，不按读到的时间）。
- `checks/commands.txt`：驱动起的命令（Host 起停、git、provider 探测）和退出码。
- `checks/notes.md`：逐条判据、撞墙表、A/B、压缩、B06、预算、延迟探针。
