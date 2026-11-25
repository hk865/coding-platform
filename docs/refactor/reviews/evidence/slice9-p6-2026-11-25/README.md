# 第 9 片真实验收（G6）2026-11-24

- 树：`fa76fe998dc78ef5541272faf9f74e25873fdf5d`（有未提交改动）；运行号 `g6-2026-11-24-46014f5e`；2026-11-24T20:05:46.320Z → 2026-11-24T22:11:53.185Z。
- 授权原文（逐场景同样记在 result.json 的 `authorization`）：用户批准（2026-11-25：G6 第十二次补跑即通信拆分的 P6，“尽快，现在就行”；上限沿用决定 121-124、121-150）：G6 真实验收使用 DeepSeek-V4.1-Flash（provider 顺序照规格：网关 smoke-flash，不通时白天 smoke-ollama、晚上 smoke-deepseek；A1/B1 用 smoke-deepseek）；总量 4 亿 token、每个场景 5,000 万 token（输入含缓存命中 + 输出），超了就停；只在临时运行目录里建账本和工作区，不提交、不推送、不对外发东西。
- 令牌：w-accept#0: 已取得令牌；w-accept#1: 已取得令牌；w-accept#2: 已取得令牌。

## 八个场景：total=8 / pass=0 / fail=6 / uncovered=2

| 场景 | 判定 | C 行 | 未覆盖 |
|---|---|---|---|
| E05 | fail | C-182, C-183, C-185, C-71, C-73, C-191, C-208, C-217, C-218 | gate: 同模块重叠门回 task/module 和在跑的 Run (not-run); paths: 实际改动能给出具体 path（含共享文件） (not-run); kept: 两个任务的独立成果都还在，两个任务都 satisfied (not-run); single-occupancy: 同一 Session 同时最多一个写入执行（没有同 Session 时间重叠的两个 Run） (not-run); convention: 接口约定只交给一个任务写，另一个任务引用它 (not-run); duplicates: project_source compare（duplicates:true）列出埋入的副本及两处位置 (not-run); reviewer: 审阅者独立判断它是同一条规则（审阅要求有结论） (not-run); name-different: 名字不同、规则相同：报 (not-run); name-same: 名字相同、规则不同：不报 (not-run); temporary: 临时件在做完之前已收回（结束时没有计划外的未跟踪文件） (not-run); line-choice: 派工排除只读副本/等待/退役线并按六键排序 (not-run) |
| E06 | uncovered | C-75, C-135, C-106, C-194, C-149, C-151, C-68, C-181, C-209, C-219, C-223 | handoff: 模型 hand_off，人批准，出现接任线 (not-run); successor-input: 接任者实际输入（turn 输入）含目标词和前任 hand_off 的理由原文，不只同一 sessionId (not-run); successor-frontier: 接任者实际输入含前任的义务/前沿 (not-run); no-restatement: 换手后用户没有重述任务 (not-run); excluded-path: 接任者引用当前理解并避开已排除路径 (not-run); same-task-new-run: 同一 Task 新开 Attempt/Run 优先原 Session，带接续说明 (not-run); history-continuity: 后续输入真正含必要前文（不只同一 Session ID） (not-run); restart-running: Work Run 在跑时正常关闭重启：记被中断，继续在原 Session (not-run); restart-paused: 暂停中重启：不算失败，可继续，恢复后在原线接着做 (not-run); archive: 归档前任后源线历史可读（sessions/history、executions/history） (not-run); hand-or-drop: 归档有未完成任务的线：先选交给或放下，同时释放责任与席位 (not-run); wake: 答卡等提交叫醒目标驱动，后继 Run 真的启动 (not-run) |
| E08 | fail | C-47, C-62, C-63, C-133a, C-126, C-46, C-52, C-116, C-118, C-210 | hold-before-adopt: 从说“不要 sub”到采用之前：sub 有秘书放的暂缓（没过期），没有新 Run（只读，驱动不撤） (not-run); required-cancel: required 取消后不因空集合变绿（div 满足之前 Goal 不完成） (not-run); autonomy-later: 改自治级别只影响之后的动作，不停正在跑的工作 (not-run) |
| E09 | fail | C-185, C-89, C-65, C-98, C-93, C-95, C-99, C-55, C-62, C-211, C-212, C-218 | new-version: 新计划版本替换受影响任务，新定义进上下文 (not-run); report-after-dispatch: 同目标另有一次派活落实后，执行者的上报仍送到参谋（不因版本拒收） (not-run); diagnosis-reverify: （可选）对方的诊断（有答复的询问）实际成为重验的依据（verification/round 的 reverify.newInputRefs） (not-run); uncovered-round: 没有覆盖必需要求的检查时读作 INCONCLUSIVE，不以空集合 PASS (not-run) |
| E12 | uncovered | C-36, C-42, C-157, C-88, C-89, C-104, C-145, C-146, C-158, C-147, C-155, C-207, C-114, C-215, C-220 | history-reuse: 重启后的相关新工作实际查询了已完成工作，结果带来源（旧 Goal/Run 的引用） (not-run); stale-premise: 保留适用范围，过期前提不升级 (entry-missing); wait-registry: 目标等待登记表启动时只读重建 (entry-missing) |
| iteration | fail | C-108, C-109, C-110, C-111, C-112, C-105, C-107, C-113, C-194, C-213, C-226 | select: 选思路只认人，下一轮输入写明选了第几个 (not-run); candidate: 选思路后出完整计划，写成这个请求的候选 (not-run); what-changed: 每轮说明改了什么 (not-run); per-request: 候选按请求分开；采用一个后另一请求的旧候选读作过期 (not-run); why: 追问“为什么”用原方案和原理由回答，不重出计划 (not-run); continues: 带 continues 的追问在同一请求后加一轮，交给同一个秘书 (not-run); request-goal: 请求记下发出时选中的目标 (not-run); cards-ask: 带卡片引用的 ask 在同一请求后加一轮，输入在 ## Cards 下写明钉住的版本 (not-run); multi-round: 多轮之后后续轮接得上前面的内容（同一秘书 Session） (not-run) |
| intervention | fail | C-199, C-200, C-201, C-202, C-203, C-114, C-189, C-192, C-197, C-198 | delivery-states: 消息在安全点送达，分别显示已排队/已送达（disposition） (not-run); busy-original-words: 忙线收到原话：送达的是发信时在跑的那个 Run，它的一轮输入含原话 (not-run); planning-when-idle: 活跃目标、线上没有未完成任务时在原线开 intervention_planning，答案交 plans/propose (not-run); claim-once: 空闲线上有未完成任务：直接干预领一次（送进因它新开的 Run，这条线上这个任务只新增 1 个 Run，不开规划） (not-run); four-endings: 四种收尾（反问/非法/没答/放弃）各落到通知、回复或撤回，不静默 (entry-missing); review-packet: 直接干预的原话进入这个目标的执行审阅包（execreview） (not-run); completed-goal: 已完成 Goal 上加工作，先确认成新 Goal，原完成不变 (not-run) |
| waiting | fail | C-170, C-171, C-187, C-188, C-190, C-172, C-184, C-189, C-192, C-195, C-196, C-207, C-224, C-225 | late-reply: 迟回保存为下一个安全点的新输入，不重开旧等待 (env-unavailable); reply-first: 回复抢先：第二个问题到期前收到回复，由回复的接受消费等待（consumesWait:true），不记到期 (not-run); disconnect: 等待的一侧归档后 decisions/queue 出这条等待的 disconnect 项，Host 给两侧各发 notify (entry-missing); supply-order: 供给按冻结顺序：人的消息、续作、agent 消息 (entry-missing) |

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

### E08b：fail

- sub-running（C-210）：pass。提交改需求时 sub（T1）的 Run 74fdcfc8-69ee-41c6-8824-d34858e657de 正在跑（开始于 2026-11-24T21:41:26.359Z）
- stop-delivered（C-210）：uncovered (not-run)。stopped before this check: timed out after 30 min waiting for the changed plan candidate
- safe-point-end（C-210）：uncovered (not-run)。stopped before this check: timed out after 30 min waiting for the changed plan candidate
- adopt-after-end（C-210）：fail。the platform did not do it: timed out after 30 min waiting for the changed plan candidate
- stopped: not-run: timed out after 30 min waiting for the changed plan candidate
- goal-confirm:goal.confirmDraft:fa3feaf6fcecfa183f3a7a0b634c5237b680307fa4e99a350efdd63a12378d7b (RUNNING): pause because E08b ended: committed

## 撞墙表

共 60 行（其中场景预期的拒绝 2 行），每次拒绝一行，原文见 `checks/notes.md`。
P6 要记的三类（按原句匹配，裁定 Q10）：派工版本拒绝 0 次，问答轮发不出 0 次，注记读口 0 次。

## 预算

- 上限：总量 395000000，每个场景/格 50000000（acceptance.config.json `tokenCaps`）。
- 口径：用量 = inputTokens + outputTokens（Kernel 的 inputTokens 已含缓存命中，cachedInputTokens 另记、不再相加）；每条按它所在项目的归属场景/格计，不按读到的时间。
- 合计：用量 12554428（输入 12378292，输出 176136；缓存命中 10594816）；Query 请求 181 次（含 Query 的压缩摘要请求，公开记录分不出）；结束的 Work Run 21 个，其中 0 个是公开证明的零（没进入 Kernel）；未知或不完整的用量不算零：已关闭 Query 里用量未知的请求按预留上限（输入预留 + 输出预留）计，只会多算；Work Run 的用量未知或不完整、或请求的预留读不到时，计量停下。
- 已知缺口：Work Run 的压缩摘要请求在另一个 Kernel Session 里跑，不在 `activity/runs` 里，计量少算了它们；驱动不读数据库补数（lead 裁定 11-14 #3）。400M/50M 上限远高于预期用量，这是记下的缺口，不是阻断。
- 最后一次完整读数时在途：Query 0，Work Run 0（Work Run 的用量要等 Run 结束才在 `activity/runs` 出现，所以超限后的停止点是第一次能看到超出的读数）。
- 实报输入（平台报了用量的部分，不含按预留上限计的和未计费 0）：12320471；估算部分 57821。
- 超预算退出：整轮 没有；按场景/格 没有。
- E05：用量 474342（输入 466070，输出 8272，缓存命中 355200；Query 请求 15（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 0；实报输入 466070）
- E06：用量 0（输入 0，输出 0，缓存命中 0；Query 请求 0（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 0；实报输入 0）
- E08：用量 2114975（输入 2084121，输出 30854，缓存命中 1827328；Query 请求 29（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 4；实报输入 2084121）
- E09：用量 2534232（输入 2504335，输出 29897，缓存命中 2168064；Query 请求 21（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 3；实报输入 2504335）
- E12：用量 1029262（输入 1015946，输出 13316，缓存命中 870656；Query 请求 16（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 2；实报输入 1015946）
- iteration：用量 1377358（输入 1364829，输出 12529，缓存命中 1197696；Query 请求 18（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 2；实报输入 1364829）
- intervention：用量 2132896（输入 2100215，输出 32681，缓存命中 1870080；Query 请求 30（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 4；实报输入 2100215）
- waiting：用量 1585259（输入 1554082，输出 31177，缓存命中 1179904；Query 请求 26（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 1：Query 已关闭、用量未知），结束的 Run 5；实报输入 1496261）
- E08b：用量 1306104（输入 1288694，输出 17410，缓存命中 1125888；Query 请求 26（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 1；实报输入 1288694）
- P6 记账：模型调用 311 次（公开原历史里 `model.request_started` 的条数，含 Work Run；压缩摘要的请求在另一个 Kernel Session 里，数不到，照旧记作缺口）；叫醒轮（intervention-planning）0 个，其中只回“收到”的 0 个（成功的工具调用只有读类和 respond_session_message，没交候选、没发信、没出卡；裁定 Q11，只计数不判）。
- E05：模型调用 15，叫醒轮 0，只回收到 0
- E08：模型调用 48，叫醒轮 0，只回收到 0
- E09：模型调用 60，叫醒轮 0，只回收到 0
- E12：模型调用 29，叫醒轮 0，只回收到 0
- iteration：模型调用 36，叫醒轮 0，只回收到 0
- intervention：模型调用 52，叫醒轮 0，只回收到 0
- waiting：模型调用 39，叫醒轮 0，只回收到 0
- E08b：模型调用 32，叫醒轮 0，只回收到 0

## 延迟探针（只记录）

- w-accept#0：p50 20.25 ms，p95 20.99 ms，max 540.54 ms（129399 个样本）；关闭方式 SIGINT, exit 0 after 128 ms
- w-accept#1：p50 20.89 ms，p95 21.2 ms，max 410.78 ms（137705 个样本）；关闭方式 SIGINT, exit 0 after 245 ms
- w-accept#2：p50 20.96 ms，p95 21.27 ms，max 399.77 ms（102918 个样本）；关闭方式 SIGINT, exit 0 after 125 ms

## 证据

- `result.json`：八行，字段照 `slice-9-SPEC.md:729-745`。
- `checks/http.jsonl`：每次 HTTP（只有成功的同一读口连续同样答复合成一行带 `repeat`；每次拒绝单独一行）；预算计量的成功读不逐条记，只计数。
- `checks/model-calls.jsonl`：从公开读口取的每次 Query 请求用量和每个结束的 Work Run 合计，带归属的场景/格（`unit`，按项目归属，不按读到的时间）。
- `checks/commands.txt`：驱动起的命令（Host 起停、git、provider 探测）和退出码。
- `checks/notes.md`：逐条判据、撞墙表、A/B、压缩、B06、预算、延迟探针。
