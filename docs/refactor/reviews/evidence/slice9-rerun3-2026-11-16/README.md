# 第 9 片真实验收（G6）2026-11-15

- 树：`b01bc052dac613520347cc4cfb488ab1282f99b9`（有未提交改动）；运行号 `g6-2026-11-15-013c515b`；2026-11-15T10:27:14.936Z → 2026-11-15T13:44:52.542Z。
- 授权原文（逐场景同样记在 result.json 的 `authorization`）：用户批准（2026-11-14，决定 121-124）：G6 真实验收使用 DeepSeek-V4.1-Flash（provider 顺序照规格：网关 smoke-flash，不通时白天 smoke-ollama、晚上 smoke-deepseek；A1/B1 用 smoke-deepseek）；总量 4 亿 token、每个场景 5,000 万 token（输入含缓存命中 + 输出），超了就停；时间窗不限；不写钱数；只在临时运行目录里建账本和工作区，不提交、不推送、不对外发东西。
- 令牌：wa#0: 已取得令牌；wb#0: 已取得令牌；w-accept#0: 已取得令牌；w-accept#1: 已取得令牌；w-accept#2: 已取得令牌。

## 八个场景：total=8 / pass=0 / fail=5 / uncovered=3

| 场景 | 判定 | C 行 | 未覆盖 |
|---|---|---|---|
| E05 | fail | C-182, C-183, C-185, C-71, C-73, C-191, C-208, C-217, C-218 | gate: 同模块重叠门回 task/module 和在跑的 Run (not-run); paths: 实际改动能给出具体 path（含共享文件） (not-run); kept: 两个任务的独立成果都还在，两个任务都 satisfied (not-run); single-occupancy: 同一 Session 同时最多一个写入执行（没有同 Session 时间重叠的两个 Run） (not-run); convention: 接口约定只交给一个任务写，另一个任务引用它 (not-run); duplicates: project_source compare（duplicates:true）列出埋入的副本及两处位置 (not-run); reviewer: 审阅者独立判断它是同一条规则（审阅要求有结论） (not-run); name-different: 名字不同、规则相同：报 (not-run); name-same: 名字相同、规则不同：不报 (not-run); temporary: 临时件在做完之前已收回（结束时没有计划外的未跟踪文件） (not-run); line-choice: 派工排除只读副本/等待/退役线并按六键排序 (not-run) |
| E06 | uncovered | C-75, C-135, C-106, C-194, C-149, C-151, C-68, C-181, C-209, C-219, C-223 | handoff: 模型 hand_off，人批准，出现接任线 (not-run); successor-input: 接任者实际输入（turn 输入）含目标词和前任 hand_off 的理由原文，不只同一 sessionId (not-run); successor-frontier: 接任者实际输入含前任的义务/前沿 (not-run); no-restatement: 换手后用户没有重述任务 (not-run); excluded-path: 接任者引用当前理解并避开已排除路径 (not-run); same-task-new-run: 同一 Task 新开 Attempt/Run 优先原 Session，带接续说明 (not-run); history-continuity: 后续输入真正含必要前文（不只同一 Session ID） (not-run); restart-running: Work Run 在跑时正常关闭重启：记被中断，继续在原 Session (not-run); restart-paused: 暂停中重启：不算失败，可继续，恢复后在原线接着做 (not-run); archive: 归档前任后源线历史可读（sessions/history、executions/history） (not-run); hand-or-drop: 归档有未完成任务的线：先选交给或放下，同时释放责任与席位 (not-run); wake: 答卡等提交叫醒目标驱动，后继 Run 真的启动 (not-run) |
| E08 | fail | C-47, C-62, C-63, C-133a, C-126, C-46, C-52, C-116, C-118, C-210 | switch: 受影响任务切到新定义（出现 div 任务，sub 被取消），无关任务继续（mul） (not-run); old-evidence: 旧证据不满足新义务：div 的义务要求只由改后计划下、div 自己改后 Run 的检查轮覆盖 (not-run); required-cancel: required 取消后不因空集合变绿（div 满足之前 Goal 不完成） (not-run); autonomy-later: 改自治级别只影响之后的动作，不停正在跑的工作 (not-run) |
| E09 | uncovered | C-185, C-89, C-65, C-98, C-93, C-95, C-99, C-55, C-62, C-211, C-212, C-218 | adviser-explains: 参谋解释具体对象和影响 (entry-missing); person-decides: 人的决定有授权与版本（答卡带钉住的版本） (entry-missing); new-version: 新计划版本替换受影响任务，新定义进上下文 (entry-missing); uncovered-round: 没有覆盖必需要求的检查时读作 INCONCLUSIVE，不以空集合 PASS (not-run) |
| E12 | fail | C-36, C-42, C-157, C-88, C-89, C-104, C-145, C-146, C-158, C-147, C-155, C-207, C-114, C-215, C-220 | history-reuse: 重启后的相关新工作实际查询了已完成工作，结果带来源（旧 Goal/Run 的引用） (not-run); stale-premise: 保留适用范围，过期前提不升级 (not-run); replay: 同一次 driver-start 重放只读原来的执行 (not-run); wait-registry: 目标等待登记表启动时只读重建 (not-run) |
| iteration | fail | C-108, C-109, C-110, C-111, C-112, C-105, C-107, C-113, C-194, C-213, C-226 | select: 选思路只认人，下一轮输入写明选了第几个 (not-run); candidate: 选思路后出完整计划，写成这个请求的候选 (not-run); what-changed: 每轮说明改了什么 (not-run); per-request: 候选按请求分开；采用一个后另一请求的旧候选读作过期 (not-run); why: 追问“为什么”用原方案和原理由回答，不重出计划 (not-run); continues: 带 continues 的追问在同一请求后加一轮，交给同一个秘书 (not-run); request-goal: 请求记下发出时选中的目标 (not-run); cards-ask: 带卡片引用的 ask 在同一请求后加一轮，输入在 ## Cards 下写明钉住的版本 (not-run); multi-round: 多轮之后后续轮接得上前面的内容（同一秘书 Session） (not-run) |
| intervention | fail | C-199, C-200, C-201, C-202, C-203, C-114, C-189, C-192, C-197, C-198 | delivery-states: 消息在安全点送达，分别显示已排队/已送达（disposition） (not-run); continue-no-planning: 有任务接着做时不开 intervention_planning (not-run); planning-when-idle: 活跃目标、线上没有未完成任务时开 intervention_planning，答案交 plans/propose (not-run); four-endings: 四种收尾（反问/非法/没答/放弃）各落到通知、回复或撤回，不静默 (not-run); completed-goal: 已完成 Goal 上加工作，先确认成新 Goal，原完成不变 (not-run); paused-queues: 暂停时干预只排队，不冒充继续；恢复后才送达 (not-run) |
| waiting | uncovered | C-170, C-171, C-187, C-188, C-190, C-172, C-184, C-189, C-192, C-195, C-196, C-207, C-224, C-225 | expiry-once: 到期先记下（expiredAt），不算消费；由 expiry 接受消费 (not-run); second-expiry: 同一追问链第二次实际到期，后继输入写“第 2 次到期” (not-run); consumes: 真实接受才 consumesWait:true；迟到的普通回复写 false (not-run); late-reply: 迟回保存为下一个安全点的新输入，不重开旧等待 (not-run); transfer: 转交保留问题和期限，未送达不自动换人 (not-run); disconnect: 等待的一侧归档后 decisions/queue 出这条等待的 disconnect 项，Host 给两侧各发 notify (not-run); supply-order: 供给按冻结顺序：人的消息、续作、agent 消息 (not-run) |

每行的逐条判据、证据和原因见 `checks/notes.md`；没跑到的判据记 `uncovered`，不因场景其余判据通过而通过。

## A/B 两格（不进 result.json）

### A1（1M → 131072）：pass

- reserved（C-214）：pass。reservedOutput 131072（requestId f91fa089-8685-4328-88de-cc2f29937845）
- usage（C-214）：pass。usageStatus reported，输入 29534，输出 89，缓存命中 3200
- accepted（C-214）：pass。请求被接受（用量已报）
- not-truncated（C-214）：pass。输出 89 < 预留 131072；close detail none
- driver-start: ready running
- 请求事实：[{"requestId":"f91fa089-8685-4328-88de-cc2f29937845","reservedOutput":131072,"usageStatus":"reported","inputTokens":29534,"outputTokens":89,"cachedInputTokens":3200},{"requestId":"9580f589-fdd6-4484-9bf3-a14bdc00422e","reservedOutput":131072,"usageStatus":"reserved","inputTokens":null,"outputTokens":null,"cachedInputTokens":null}]；Query running；close null；profile 累计输出上限 null = 不设上限
- queries/cancel after the first request: ready stopping
- request 9580f589-fdd6-4484-9bf3-a14bdc00422e: cut by the driver's cancel; usage not reported, at most one request (Query closed, close cancelled)

### B1（128k → 64000）：pass

- reserved（C-214）：pass。reservedOutput 64000（requestId cffe95c5-f3f4-455a-aab2-e890b2c5fbb0）
- usage（C-214）：pass。usageStatus reported，输入 16204，输出 96，缓存命中 12800
- accepted（C-214）：pass。请求被接受（用量已报）
- not-truncated（C-214）：pass。输出 96 < 预留 64000；close detail none
- fits（C-214）：pass。请求发出（reservedInput 以内），reservedOutput 64000
- driver-start: ready running
- 请求事实：[{"requestId":"cffe95c5-f3f4-455a-aab2-e890b2c5fbb0","reservedOutput":64000,"usageStatus":"reported","inputTokens":16204,"outputTokens":96,"cachedInputTokens":12800},{"requestId":"9d5d56af-60e1-4d96-ae23-e559c6b3f62c","reservedOutput":63904,"usageStatus":"reserved","inputTokens":null,"outputTokens":null,"cachedInputTokens":null}]；Query running；close null；profile 累计输出上限 64000
- queries/cancel after the first request: ready stopping
- request 9d5d56af-60e1-4d96-ae23-e559c6b3f62c: cut by the driver's cancel; usage not reported, at most one request (Query closed, close cancelled)

## 压缩场景（单列，不算第 9 个场景）

### 压缩：uncovered

- compacted（K2-P2）：uncovered (not-run)。stopped before this check: request 8ad6747a-d378-429b-b8a3-59df16c135be of consultation-6a160197ed61962741012fed94a4d225bddf6e8b67c8137744a0fc29104ab9da has usage unknown and its Query ended with neither a provider failure nor the driver's own cancel; the meter cannot count it, so no new work starts
- six-sections（K2-P2）：uncovered (not-run)。stopped before this check: request 8ad6747a-d378-429b-b8a3-59df16c135be of consultation-6a160197ed61962741012fed94a4d225bddf6e8b67c8137744a0fc29104ab9da has usage unknown and its Query ended with neither a provider failure nor the driver's own cancel; the meter cannot count it, so no new work starts
- accepted（K2-P2）：uncovered (not-run)。stopped before this check: request 8ad6747a-d378-429b-b8a3-59df16c135be of consultation-6a160197ed61962741012fed94a4d225bddf6e8b67c8137744a0fc29104ab9da has usage unknown and its Query ended with neither a provider failure nor the driver's own cancel; the meter cannot count it, so no new work starts
- cache-after（K2-P2）：uncovered (not-run)。stopped before this check: request 8ad6747a-d378-429b-b8a3-59df16c135be of consultation-6a160197ed61962741012fed94a4d225bddf6e8b67c8137744a0fc29104ab9da has usage unknown and its Query ended with neither a provider failure nor the driver's own cancel; the meter cannot count it, so no new work starts
- stopped: not-run: request 8ad6747a-d378-429b-b8a3-59df16c135be of consultation-6a160197ed61962741012fed94a4d225bddf6e8b67c8137744a0fc29104ab9da has usage unknown and its Query ended with neither a provider failure nor the driver's own cancel; the meter cannot count it, so no new work starts

## 附加格（八个场景之后的附加 Goal）

### C-216：uncovered

- observed-start（C-216）：uncovered (not-run)。stopped before this check: request 8ad6747a-d378-429b-b8a3-59df16c135be of consultation-6a160197ed61962741012fed94a4d225bddf6e8b67c8137744a0fc29104ab9da has usage unknown and its Query ended with neither a provider failure nor the driver's own cancel; the meter cannot count it, so no new work starts
- adopted-done（C-216）：uncovered (not-run)。stopped before this check: request 8ad6747a-d378-429b-b8a3-59df16c135be of consultation-6a160197ed61962741012fed94a4d225bddf6e8b67c8137744a0fc29104ab9da has usage unknown and its Query ended with neither a provider failure nor the driver's own cancel; the meter cannot count it, so no new work starts
- stopped: not-run: request 8ad6747a-d378-429b-b8a3-59df16c135be of consultation-6a160197ed61962741012fed94a4d225bddf6e8b67c8137744a0fc29104ab9da has usage unknown and its Query ended with neither a provider failure nor the driver's own cancel; the meter cannot count it, so no new work starts

### C-221：uncovered

- first-plan（C-221）：uncovered (not-run)。stopped before this check: request 8ad6747a-d378-429b-b8a3-59df16c135be of consultation-6a160197ed61962741012fed94a4d225bddf6e8b67c8137744a0fc29104ab9da has usage unknown and its Query ended with neither a provider failure nor the driver's own cancel; the meter cannot count it, so no new work starts
- fail-rework（C-221）：uncovered (not-run)。stopped before this check: request 8ad6747a-d378-429b-b8a3-59df16c135be of consultation-6a160197ed61962741012fed94a4d225bddf6e8b67c8137744a0fc29104ab9da has usage unknown and its Query ended with neither a provider failure nor the driver's own cancel; the meter cannot count it, so no new work starts
- delivered（C-221）：uncovered (not-run)。stopped before this check: request 8ad6747a-d378-429b-b8a3-59df16c135be of consultation-6a160197ed61962741012fed94a4d225bddf6e8b67c8137744a0fc29104ab9da has usage unknown and its Query ended with neither a provider failure nor the driver's own cancel; the meter cannot count it, so no new work starts
- stopped: not-run: request 8ad6747a-d378-429b-b8a3-59df16c135be of consultation-6a160197ed61962741012fed94a4d225bddf6e8b67c8137744a0fc29104ab9da has usage unknown and its Query ended with neither a provider failure nor the driver's own cancel; the meter cannot count it, so no new work starts

### C-222：uncovered

- created（C-222）：uncovered (not-run)。stopped before this check: request 8ad6747a-d378-429b-b8a3-59df16c135be of consultation-6a160197ed61962741012fed94a4d225bddf6e8b67c8137744a0fc29104ab9da has usage unknown and its Query ended with neither a provider failure nor the driver's own cancel; the meter cannot count it, so no new work starts
- started（C-222）：uncovered (not-run)。stopped before this check: request 8ad6747a-d378-429b-b8a3-59df16c135be of consultation-6a160197ed61962741012fed94a4d225bddf6e8b67c8137744a0fc29104ab9da has usage unknown and its Query ended with neither a provider failure nor the driver's own cancel; the meter cannot count it, so no new work starts
- stopped: not-run: request 8ad6747a-d378-429b-b8a3-59df16c135be of consultation-6a160197ed61962741012fed94a4d225bddf6e8b67c8137744a0fc29104ab9da has usage unknown and its Query ended with neither a provider failure nor the driver's own cancel; the meter cannot count it, so no new work starts

## B06

### B06 关闭格：uncovered

- W1a（B06-W1a）：uncovered (not-run)。stopped before this check: request 8ad6747a-d378-429b-b8a3-59df16c135be of consultation-6a160197ed61962741012fed94a4d225bddf6e8b67c8137744a0fc29104ab9da has usage unknown and its Query ended with neither a provider failure nor the driver's own cancel; the meter cannot count it, so no new work starts
- W2（B06-W2）：uncovered (not-run)。stopped before this check: request 8ad6747a-d378-429b-b8a3-59df16c135be of consultation-6a160197ed61962741012fed94a4d225bddf6e8b67c8137744a0fc29104ab9da has usage unknown and its Query ended with neither a provider failure nor the driver's own cancel; the meter cannot count it, so no new work starts
- W3（B06-W3）：uncovered (not-run)。stopped before this check: request 8ad6747a-d378-429b-b8a3-59df16c135be of consultation-6a160197ed61962741012fed94a4d225bddf6e8b67c8137744a0fc29104ab9da has usage unknown and its Query ended with neither a provider failure nor the driver's own cancel; the meter cannot count it, so no new work starts
- W5（B06-W5）：uncovered (not-run)。stopped before this check: request 8ad6747a-d378-429b-b8a3-59df16c135be of consultation-6a160197ed61962741012fed94a4d225bddf6e8b67c8137744a0fc29104ab9da has usage unknown and its Query ended with neither a provider failure nor the driver's own cancel; the meter cannot count it, so no new work starts
- W10（B06-W10）：uncovered (not-run)。stopped before this check: request 8ad6747a-d378-429b-b8a3-59df16c135be of consultation-6a160197ed61962741012fed94a4d225bddf6e8b67c8137744a0fc29104ab9da has usage unknown and its Query ended with neither a provider failure nor the driver's own cancel; the meter cannot count it, so no new work starts
- W12（B06-W12）：uncovered (not-run)。stopped before this check: request 8ad6747a-d378-429b-b8a3-59df16c135be of consultation-6a160197ed61962741012fed94a4d225bddf6e8b67c8137744a0fc29104ab9da has usage unknown and its Query ended with neither a provider failure nor the driver's own cancel; the meter cannot count it, so no new work starts
- explore（B06-cond3）：uncovered (not-run)。stopped before this check: request 8ad6747a-d378-429b-b8a3-59df16c135be of consultation-6a160197ed61962741012fed94a4d225bddf6e8b67c8137744a0fc29104ab9da has usage unknown and its Query ended with neither a provider failure nor the driver's own cancel; the meter cannot count it, so no new work starts
- stopped: not-run: request 8ad6747a-d378-429b-b8a3-59df16c135be of consultation-6a160197ed61962741012fed94a4d225bddf6e8b67c8137744a0fc29104ab9da has usage unknown and its Query ended with neither a provider failure nor the driver's own cancel; the meter cannot count it, so no new work starts

## 撞墙表

共 52 行（其中场景预期的拒绝 4 行），每次拒绝一行，原文见 `checks/notes.md`。

## 预算

- 上限：总量 400000000，每个场景/格 50000000（acceptance.config.json `tokenCaps`）。
- 口径：用量 = inputTokens + outputTokens（Kernel 的 inputTokens 已含缓存命中，cachedInputTokens 另记、不再相加）；每条按它所在项目的归属场景/格计，不按读到的时间。
- 合计：用量 7517203（输入 7419753，输出 97450；缓存命中 6553984）；Query 请求 108 次（含 Query 的压缩摘要请求，公开记录分不出）；结束的 Work Run 11 个，其中 0 个是公开证明的零（没进入 Kernel）；未知或不完整的用量不算零，会让计量停下。
- 已知缺口：Work Run 的压缩摘要请求在另一个 Kernel Session 里跑，不在 `activity/runs` 里，计量少算了它们；驱动不读数据库补数（lead 裁定 11-14 #3）。400M/50M 上限远高于预期用量，这是记下的缺口，不是阻断。
- 最后一次完整读数时在途：Query 0，Work Run 0（Work Run 的用量要等 Run 结束才在 `activity/runs` 出现，所以超限后的停止点是第一次能看到超出的读数）。
- 计量不可用：request 8ad6747a-d378-429b-b8a3-59df16c135be of consultation-6a160197ed61962741012fed94a4d225bddf6e8b67c8137744a0fc29104ab9da has usage unknown and its Query ended with neither a provider failure nor the driver's own cancel; the meter cannot count it, so no new work starts
- A1：用量 29623（输入 29534，输出 89，缓存命中 3200；Query 请求 2（其中按未计费 0 计的 1：provider 拒收，或驱动自己取消截断的请求），结束的 Run 0）
- B1：用量 16300（输入 16204，输出 96，缓存命中 12800；Query 请求 2（其中按未计费 0 计的 1：provider 拒收，或驱动自己取消截断的请求），结束的 Run 0）
- E05：用量 579648（输入 572575，输出 7073，缓存命中 468608；Query 请求 11（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求），结束的 Run 1）
- E06：用量 0（输入 0，输出 0，缓存命中 0；Query 请求 0（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求），结束的 Run 0）
- E08：用量 1169960（输入 1150075，输出 19885，缓存命中 999680；Query 请求 20（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求），结束的 Run 2）
- E09：用量 2833388（输入 2799574，输出 33814，缓存命中 2592896；Query 请求 16（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求），结束的 Run 3）
- E12：用量 930839（输入 920936，输出 9903，缓存命中 801408；Query 请求 20（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求），结束的 Run 1）
- iteration：用量 525931（输入 518304，输出 7627，缓存命中 462208；Query 请求 13（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求），结束的 Run 1）
- intervention：用量 830322（输入 819261，输出 11061，缓存命中 704512；Query 请求 15（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求），结束的 Run 1）
- waiting：用量 601192（输入 593290，输出 7902，缓存命中 508672；Query 请求 9（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求），结束的 Run 2）

## 延迟探针（只记录）

- wa#0：p50 21.74 ms，p95 22.17 ms，max 305.92 ms（14497 个样本）；关闭方式 SIGINT, exit 0 after 40 ms
- wb#0：p50 20.68 ms，p95 21.73 ms，max 221.64 ms（17915 个样本）；关闭方式 SIGINT, exit 0 after 25 ms
- w-accept#0：p50 20.17 ms，p95 20.4 ms，max 1286.6 ms（326021 个样本）；关闭方式 SIGINT, exit 0 after 157 ms
- w-accept#1：p50 20.14 ms，p95 20.3 ms，max 375.13 ms（216454 个样本）；关闭方式 SIGINT, exit 0 after 221 ms
- w-accept#2：p50 20.19 ms，p95 35.52 ms，max 749.73 ms（321 个样本）；关闭方式 SIGINT, exit 0 after 3785 ms

## 证据

- `result.json`：八行，字段照 `slice-9-SPEC.md:729-745`。
- `checks/http.jsonl`：每次 HTTP（只有成功的同一读口连续同样答复合成一行带 `repeat`；每次拒绝单独一行）；预算计量的成功读不逐条记，只计数。
- `checks/model-calls.jsonl`：从公开读口取的每次 Query 请求用量和每个结束的 Work Run 合计，带归属的场景/格（`unit`，按项目归属，不按读到的时间）。
- `checks/commands.txt`：驱动起的命令（Host 起停、git、provider 探测）和退出码。
- `checks/notes.md`：逐条判据、撞墙表、A/B、压缩、B06、预算、延迟探针。
