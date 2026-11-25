# 第 9 片真实验收（G6）2026-11-25

- 树：`7d6ac222f5ee9ff2656b33732a52d74e4fce3e15`（有未提交改动）；运行号 `g6-2026-11-25-791056bc`；2026-11-25T08:34:47.257Z → 2026-11-25T12:27:04.290Z。
- 授权原文（逐场景同样记在 result.json 的 `authorization`）：用户批准（2026-11-25：G6 第十二次补跑即通信拆分的 P6，“尽快，现在就行”；上限沿用决定 121-124、121-150）：G6 真实验收使用 DeepSeek-V4.1-Flash（provider 顺序照规格：网关 smoke-flash，不通时白天 smoke-ollama、晚上 smoke-deepseek；A1/B1 用 smoke-deepseek）；总量 4 亿 token、每个场景 5,000 万 token（输入含缓存命中 + 输出），超了就停；只在临时运行目录里建账本和工作区，不提交、不推送、不对外发东西。
- 令牌：w-accept#0: 已取得令牌；w-accept#1: 已取得令牌；w-accept#2: 已取得令牌。

## 八个场景：total=8 / pass=1 / fail=4 / uncovered=3

| 场景 | 判定 | C 行 | 未覆盖 |
|---|---|---|---|
| E05 | fail | C-182, C-183, C-185, C-71, C-73, C-191, C-208, C-217, C-218 | gate: 同模块重叠门回 task/module 和在跑的 Run (not-run); paths: 实际改动能给出具体 path（含共享文件） (not-run); kept: 两个任务的独立成果都还在，两个任务都 satisfied (not-run); single-occupancy: 同一 Session 同时最多一个写入执行（没有同 Session 时间重叠的两个 Run） (not-run); convention: 接口约定只交给一个任务写，另一个任务引用它 (not-run); duplicates: project_source compare（duplicates:true）列出埋入的副本及两处位置 (not-run); reviewer: 审阅者独立判断它是同一条规则（审阅要求有结论） (not-run); name-different: 名字不同、规则相同：报 (not-run); name-same: 名字相同、规则不同：不报 (not-run); temporary: 临时件在做完之前已收回（结束时没有计划外的未跟踪文件） (not-run); line-choice: 派工排除只读副本/等待/退役线并按六键排序 (not-run) |
| E06 | uncovered | C-75, C-135, C-106, C-194, C-149, C-151, C-68, C-181, C-209, C-219, C-223 | handoff: 模型 hand_off，人批准，出现接任线 (not-run); successor-input: 接任者实际输入（turn 输入）含目标词和前任 hand_off 的理由原文，不只同一 sessionId (not-run); successor-frontier: 接任者实际输入含前任的义务/前沿 (not-run); no-restatement: 换手后用户没有重述任务 (not-run); excluded-path: 接任者引用当前理解并避开已排除路径 (not-run); same-task-new-run: 同一 Task 新开 Attempt/Run 优先原 Session，带接续说明 (not-run); history-continuity: 后续输入真正含必要前文（不只同一 Session ID） (not-run); restart-running: Work Run 在跑时正常关闭重启：记被中断，继续在原 Session (not-run); restart-paused: 暂停中重启：不算失败，可继续，恢复后在原线接着做 (not-run); archive: 归档前任后源线历史可读（sessions/history、executions/history） (not-run); hand-or-drop: 归档有未完成任务的线：先选交给或放下，同时释放责任与席位 (not-run); wake: 答卡等提交叫醒目标驱动，后继 Run 真的启动 (not-run) |
| E08 | fail | C-47, C-62, C-63, C-133a, C-126, C-46, C-52, C-116, C-118, C-210 | hold-before-adopt: 从说“不要 sub”到采用之前：sub 有秘书放的暂缓（没过期），没有新 Run（只读，驱动不撤） (not-run); switch: 受影响任务切到新定义（出现 div 任务，sub 被取消），无关任务继续（mul）；采用版本的取消记录写明 sub→cancelled、采用版本和人 (not-run); old-evidence: 旧证据不满足新义务：div 的义务要求只由改后计划下、div 自己改后 Run 的检查轮覆盖 (not-run); required-cancel: required 取消后不因空集合变绿（div 满足之前 Goal 不完成） (not-run); autonomy-later: 改自治级别只影响之后的动作，不停正在跑的工作 (not-run) |
| E09 | uncovered | C-185, C-89, C-65, C-98, C-93, C-95, C-99, C-55, C-62, C-211, C-212, C-218 | adviser-explains: 参谋解释具体对象和影响（最终答复，或 ask_person / notify_person 的正文） (not-run); person-decides: 人的决定有授权与版本（人提交的答卡，钉住 Goal 版本） (not-run); new-version: 新计划版本替换受影响任务，新定义进上下文 (not-run); report-after-dispatch: 同目标另有一次派活落实后，执行者的上报仍送到参谋（不因版本拒收） (not-run); diagnosis-reverify: （可选）对方的诊断（有答复的询问）实际成为重验的依据（verification/round 的 reverify.newInputRefs） (not-run); uncovered-round: 没有覆盖必需要求的检查时读作 INCONCLUSIVE，不以空集合 PASS (not-run) |
| E12 | fail | C-36, C-42, C-157, C-88, C-89, C-104, C-145, C-146, C-158, C-147, C-155, C-207, C-114, C-215, C-220 | history-reuse: 重启后的相关新工作实际查询了已完成工作，结果带来源（旧 Goal/Run 的引用） (not-run); stale-premise: 保留适用范围，过期前提不升级 (not-run); wait-registry: 目标等待登记表启动时只读重建 (not-run) |
| iteration | pass | C-108, C-109, C-110, C-111, C-112, C-105, C-107, C-113, C-194, C-213, C-226 | - |
| intervention | fail | C-199, C-200, C-201, C-202, C-203, C-114, C-189, C-192, C-197, C-198 | ask-copy: “问一问”开只读副本，不占原线：问件 answeredBy 为 copy，没送进原线的 Run，原 Run 的输入里没有这个问题 (not-run); delivery-states: 消息在安全点送达，分别显示已排队/已送达（disposition） (not-run); busy-original-words: 忙线收到原话：送达的是发信时在跑的那个 Run，它的一轮输入含原话 (not-run); continue-no-planning: 有任务接着做时不开 intervention_planning (not-run); planning-when-idle: 活跃目标、线上没有未完成任务时在原线开 intervention_planning，答案交 plans/propose (not-run); claim-once: 空闲线上有未完成任务：直接干预领一次（送进因它新开的 Run，这条线上这个任务只新增 1 个 Run，不开规划） (not-run); four-endings: 四种收尾（反问/非法/没答/放弃）各落到通知、回复或撤回，不静默 (not-run); review-packet: 直接干预的原话进入这个目标的执行审阅包（execreview） (not-run); paused-queues: 暂停时干预只排队，不冒充继续；恢复后才送达 (not-run) |
| waiting | uncovered | C-170, C-171, C-187, C-188, C-190, C-172, C-184, C-189, C-192, C-195, C-196, C-207, C-224, C-225 | second-expiry: 同一追问链第二次实际到期，后继输入写“第 2 次到期” (env-unavailable); late-reply: 迟回保存为下一个安全点的新输入，不重开旧等待 (env-unavailable); reply-first: 回复抢先：第二个问题到期前收到回复，由回复的接受消费等待（consumesWait:true），不记到期 (not-run); transfer: 转交保留问题和期限，未送达不自动换人 (env-unavailable); disconnect: 等待的一侧归档后 decisions/queue 出这条等待的 disconnect 项，Host 给两侧各发 notify (env-unavailable); supply-order: 供给按冻结顺序：人的消息、续作、agent 消息 (entry-missing) |

每行的逐条判据、证据和原因见 `checks/notes.md`；没跑到的判据记 `uncovered`，不因场景其余判据通过而通过。

## A/B 两格（不进 result.json）

### A1（1M → 131072）

没跑：`uncovered (not-run)`。

### B1（128k → 64000）

没跑：`uncovered (not-run)`。

## 压缩场景（单列，不算第 9 个场景）

### 压缩

没跑：`uncovered (not-run)`。

## 附加格（八个场景之后的附加 Goal）

没跑：C-216、C-221、C-222 记 `uncovered (not-run)`。

## B06

### B06 关闭格

没跑：`uncovered (not-run)`。

## E08b（P6：方案确认后自动、sub 已在跑）

### E08b：uncovered

- sub-running（C-210）：pass。提交改需求时 sub（T1）的 Run 50369194-86de-4680-b2c3-539773b2810d 正在跑（开始于 2026-11-25T12:17:24.916Z）
- stop-delivered（C-210）：uncovered (not-run)。改需求没有写出候选（见 notes），没有发生采用，这一支没走到；任务卡 stop.steps：无；叫停请求 无；sub 的 Run completed @ 2026-11-25T12:17:56.512Z
- safe-point-end（C-210）：uncovered (not-run)。改需求没有写出候选（见 notes），没有发生采用，这一支没走到；任务卡 stop.steps：无；叫停请求 无；sub 的 Run completed @ 2026-11-25T12:17:56.512Z
- adopt-after-end（C-210）：uncovered (not-run)。改需求没有写出候选（见 notes），没有发生采用，这一支没走到；任务卡 stop.steps：无；叫停请求 无；sub 的 Run completed @ 2026-11-25T12:17:56.512Z
- the person selected idea 1 of 3 on the change: 按候选采用：sub 撤销，div 顶替，目标与验收同步改写
- 改需求没有候选：the request's last round 0ffa0460-37ad-459d-bc07-33f7a0a2d907 ended without a candidate and no Query ran for 5 min
- goal-confirm:goal.confirmDraft:19b1a50fe9ae897df1d0ad88ff844981d7013b6a634721e792d1ede460f2a7ff (NEEDS_DECISION): pause because E08b ended: committed

## 撞墙表

共 68 行（其中场景预期的拒绝 2 行），每次拒绝一行，原文见 `checks/notes.md`。
P6 要记的三类（按原句匹配，裁定 Q10）：派工版本拒绝 0 次，问答轮发不出 0 次，注记读口 0 次。

## 预算

- 上限：总量 360000000，每个场景/格 50000000（acceptance.config.json `tokenCaps`）。
- 口径：用量 = inputTokens + outputTokens（Kernel 的 inputTokens 已含缓存命中，cachedInputTokens 另记、不再相加）；每条按它所在项目的归属场景/格计，不按读到的时间。
- 合计：用量 16640453（输入 16364552，输出 275901；缓存命中 13441920）；Query 请求 231 次（含 Query 的压缩摘要请求，公开记录分不出）；结束的 Work Run 21 个，其中 0 个是公开证明的零（没进入 Kernel）；未知或不完整的用量不算零：已关闭 Query 里用量未知的请求按预留上限（输入预留 + 输出预留）计，只会多算；Work Run 的用量未知或不完整、或请求的预留读不到时，计量停下。
- 已知缺口：Work Run 的压缩摘要请求在另一个 Kernel Session 里跑，不在 `activity/runs` 里，计量少算了它们；驱动不读数据库补数（lead 裁定 11-14 #3）。400M/50M 上限远高于预期用量，这是记下的缺口，不是阻断。
- 最后一次完整读数时在途：Query 0，Work Run 0（Work Run 的用量要等 Run 结束才在 `activity/runs` 出现，所以超限后的停止点是第一次能看到超出的读数）。
- 实报输入（平台报了用量的部分，不含按预留上限计的和未计费 0）：16137090；估算部分 227462。
- 超预算退出：整轮 没有；按场景/格 没有。
- E05：用量 1033206（输入 1010858，输出 22348，缓存命中 849920；Query 请求 17（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 1；实报输入 1010858）
- E06：用量 0（输入 0，输出 0，缓存命中 0；Query 请求 0（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 0；实报输入 0）
- E08：用量 1948217（输入 1922073，输出 26144，缓存命中 1498496；Query 请求 22（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 4；实报输入 1922073）
- E09：用量 4313351（输入 4201360，输出 111991，缓存命中 3419136；Query 请求 79（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 4：Query 已关闭、用量未知），结束的 Run 2；实报输入 4016859）
- E12：用量 1013004（输入 1001667，输出 11337，缓存命中 793984；Query 请求 17（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 2；实报输入 1001667）
- iteration：用量 1370423（输入 1351471，输出 18952，缓存命中 1054464；Query 请求 26（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 1；实报输入 1351471）
- intervention：用量 795217（输入 783319，输出 11898，缓存命中 591744；Query 请求 14（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 1；实报输入 783319）
- waiting：用量 1978495（输入 1950905，输出 27590，缓存命中 1617280；Query 请求 18（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 1：Query 已关闭、用量未知），结束的 Run 5；实报输入 1907944）
- E08b：用量 4188540（输入 4142899，输出 45641，缓存命中 3616896；Query 请求 38（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 5；实报输入 4142899）
- P6 记账：模型调用 347 次（公开原历史里 `model.request_started` 的条数，含 Work Run；压缩摘要的请求在另一个 Kernel Session 里，数不到，照旧记作缺口）；叫醒轮（intervention-planning）13 个，其中只回“收到”的 1 个（成功的工具调用只有读类和答复，且答复的都不是要回复的信，没交候选、没发信、没出卡；裁定 Q11、lead 11-25 #31，只计数不判；回复对象读不到的照旧计数，见其它记录）。
- E05：模型调用 28，叫醒轮 1，只回收到 0
- E08：模型调用 49，叫醒轮 1，只回收到 0
- E09：模型调用 58，叫醒轮 1，只回收到 0
- E12：模型调用 29，叫醒轮 1，只回收到 0
- iteration：模型调用 32，叫醒轮 1，只回收到 0
- intervention：模型调用 21，叫醒轮 1，只回收到 0
- waiting：模型调用 45，叫醒轮 4，只回收到 1
- E08b：模型调用 85，叫醒轮 3，只回收到 0

## 延迟探针（只记录）

- w-accept#0：p50 21.71 ms，p95 22.18 ms，max 612.37 ms（310675 个样本）；关闭方式 SIGINT, exit 0 after 1195 ms
- w-accept#1：p50 20.2 ms，p95 21.58 ms，max 386.92 ms（234897 个样本）；关闭方式 SIGINT, exit 0 after 277 ms
- w-accept#2：p50 20.17 ms，p95 20.5 ms，max 471.6 ms（138104 个样本）；关闭方式 SIGINT, exit 0 after 98 ms

## 证据

- `result.json`：八行，字段照 `slice-9-SPEC.md:729-745`。
- `checks/http.jsonl`：每次 HTTP（只有成功的同一读口连续同样答复合成一行带 `repeat`；每次拒绝单独一行）；预算计量的成功读不逐条记，只计数。
- `checks/model-calls.jsonl`：从公开读口取的每次 Query 请求用量和每个结束的 Work Run 合计，带归属的场景/格（`unit`，按项目归属，不按读到的时间）。
- `checks/commands.txt`：驱动起的命令（Host 起停、git、provider 探测）和退出码。
- `checks/notes.md`：逐条判据、撞墙表、A/B、压缩、B06、预算、延迟探针。
