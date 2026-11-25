# 第 9 片真实验收（G6）2026-11-25

- 树：`06a7bd11afa6327f3606a7f962b301d0c5b5c8c1`（有未提交改动）；运行号 `g6-2026-11-25-d6642f43`；2026-11-25T01:40:19.934Z → 2026-11-25T03:51:57.367Z。
- 授权原文（逐场景同样记在 result.json 的 `authorization`）：用户批准（2026-11-25：G6 第十二次补跑即通信拆分的 P6，“尽快，现在就行”；上限沿用决定 121-124、121-150）：G6 真实验收使用 DeepSeek-V4.1-Flash（provider 顺序照规格：网关 smoke-flash，不通时白天 smoke-ollama、晚上 smoke-deepseek；A1/B1 用 smoke-deepseek）；总量 4 亿 token、每个场景 5,000 万 token（输入含缓存命中 + 输出），超了就停；只在临时运行目录里建账本和工作区，不提交、不推送、不对外发东西。
- 令牌：w-accept#0: 已取得令牌；w-accept#1: 已取得令牌；w-accept#2: 已取得令牌；w-accept#3: 已取得令牌。

## 八个场景：total=8 / pass=1 / fail=4 / uncovered=3

| 场景 | 判定 | C 行 | 未覆盖 |
|---|---|---|---|
| E05 | fail | C-182, C-183, C-185, C-71, C-73, C-191, C-208, C-217, C-218 | reviewer: 审阅者独立判断它是同一条规则（审阅要求有结论） (entry-missing); name-different: 名字不同、规则相同：报 (entry-missing); name-same: 名字相同、规则不同：不报 (entry-missing); line-choice: 派工排除只读副本/等待/退役线并按六键排序 (entry-missing) |
| E06 | fail | C-75, C-135, C-106, C-194, C-149, C-151, C-68, C-181, C-209, C-219, C-223 | successor-input: 接任者实际输入（turn 输入）含目标词和前任 hand_off 的理由原文，不只同一 sessionId (not-run); successor-frontier: 接任者实际输入含前任的义务/前沿 (not-run); no-restatement: 换手后用户没有重述任务 (not-run); excluded-path: 接任者引用当前理解并避开已排除路径 (not-run); same-task-new-run: 同一 Task 新开 Attempt/Run 优先原 Session，带接续说明 (not-run); history-continuity: 后续输入真正含必要前文（不只同一 Session ID） (not-run); restart-paused: 暂停中重启：不算失败，可继续，恢复后在原线接着做 (not-run); archive: 归档前任后源线历史可读（sessions/history、executions/history） (not-run); hand-or-drop: 归档有未完成任务的线：先选交给或放下，同时释放责任与席位 (not-run); wake: 答卡等提交叫醒目标驱动，后继 Run 真的启动 (not-run) |
| E08 | fail | C-47, C-62, C-63, C-133a, C-126, C-46, C-52, C-116, C-118, C-210 | hold-before-adopt: 从说“不要 sub”到采用之前：sub 有秘书放的暂缓（没过期），没有新 Run（只读，驱动不撤） (not-run); switch: 受影响任务切到新定义（出现 div 任务，sub 被取消），无关任务继续（mul）；采用版本的取消记录写明 sub→cancelled、采用版本和人 (not-run); old-evidence: 旧证据不满足新义务：div 的义务要求只由改后计划下、div 自己改后 Run 的检查轮覆盖 (not-run); required-cancel: required 取消后不因空集合变绿（div 满足之前 Goal 不完成） (not-run); autonomy-later: 改自治级别只影响之后的动作，不停正在跑的工作 (not-run) |
| E09 | uncovered | C-185, C-89, C-65, C-98, C-93, C-95, C-99, C-55, C-62, C-211, C-212, C-218 | person-decides: 人的决定有授权与版本（人提交的答卡，钉住 Goal 版本） (not-run); new-version: 新计划版本替换受影响任务，新定义进上下文 (not-run); report-after-dispatch: 同目标另有一次派活落实后，执行者的上报仍送到参谋（不因版本拒收） (not-run); diagnosis-reverify: （可选）对方的诊断（有答复的询问）实际成为重验的依据（verification/round 的 reverify.newInputRefs） (not-run); uncovered-round: 没有覆盖必需要求的检查时读作 INCONCLUSIVE，不以空集合 PASS (not-run) |
| E12 | uncovered | C-36, C-42, C-157, C-88, C-89, C-104, C-145, C-146, C-158, C-147, C-155, C-207, C-114, C-215, C-220 | history-reuse: 重启后的相关新工作实际查询了已完成工作，结果带来源（旧 Goal/Run 的引用） (not-run); stale-premise: 保留适用范围，过期前提不升级 (entry-missing); wait-registry: 目标等待登记表启动时只读重建 (entry-missing) |
| iteration | pass | C-108, C-109, C-110, C-111, C-112, C-105, C-107, C-113, C-194, C-213, C-226 | - |
| intervention | uncovered | C-199, C-200, C-201, C-202, C-203, C-114, C-189, C-192, C-197, C-198 | planning-when-idle: 活跃目标、线上没有未完成任务时在原线开 intervention_planning，答案交 plans/propose (not-run); claim-once: 空闲线上有未完成任务：直接干预领一次（送进因它新开的 Run，这条线上这个任务只新增 1 个 Run，不开规划） (not-run); four-endings: 四种收尾（反问/非法/没答/放弃）各落到通知、回复或撤回，不静默 (entry-missing); review-packet: 直接干预的原话进入这个目标的执行审阅包（execreview） (not-run); completed-goal: 已完成 Goal 上加工作，先确认成新 Goal，原完成不变 (not-run) |
| waiting | fail | C-170, C-171, C-187, C-188, C-190, C-172, C-184, C-189, C-192, C-195, C-196, C-207, C-224, C-225 | restart-kept: 正常关闭重启后仍核对原等待（同一 messageRef、收信人、期限），接续的 Run 消费这条等待（expiry/wait_reply，originalRun 是原 Run，在成员线上） (not-run); second-expiry: 同一追问链第二次实际到期，后继输入写“第 2 次到期” (not-run); consumes: 真实接受才 consumesWait:true；迟到的普通回复写 false (not-run); late-reply: 迟回保存为下一个安全点的新输入，不重开旧等待 (not-run); reply-first: 回复抢先：第二个问题到期前收到回复，由回复的接受消费等待（consumesWait:true），不记到期 (not-run); transfer: 转交保留问题和期限，未送达不自动换人 (not-run); disconnect: 等待的一侧归档后 decisions/queue 出这条等待的 disconnect 项，Host 给两侧各发 notify (not-run); supply-order: 供给按冻结顺序：人的消息、续作、agent 消息 (not-run) |

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

### E08b：pass

- sub-running（C-210）：pass。提交改需求时 sub（t1）的 Run 8ea78738-2549-4b67-ab65-71f2e11cba31 正在跑（开始于 2026-11-25T03:50:39.834Z）
- stop-delivered（C-210）：pass。任务卡 stop.steps：requested → hold_placed → sent → delivered → run_ended；请求 released（secretary 线 session-0689697b1c39d88cc8560d96678d35d4c33cc12e43ff3c5956155950ae79ca73，停 Run 8ea78738-2549-4b67-ab65-71f2e11cba31）
- safe-point-end（C-210）：pass。叫停送到后 sub 的 Run 8ea78738-2549-4b67-ab65-71f2e11cba31 结束（completed @ 2026-11-25T03:51:30.501Z），采用时没有 busy 硬停；任务卡 stop.steps：requested → hold_placed → sent → delivered → run_ended；请求 released（secretary 线 session-0689697b1c39d88cc8560d96678d35d4c33cc12e43ff3c5956155950ae79ca73，停 Run 8ea78738-2549-4b67-ab65-71f2e11cba31）
- adopt-after-end（C-210）：pass。sub 的 Run 结束 2026-11-25T03:51:30.501Z；采用 initial-plan-8fdac60a0578a53342fe540428a4f69a @ 2026-11-25T03:51:55.842Z（人 plans/apply，busy 0 次）；记录 active→cancelled，setIn initial-plan-8fdac60a0578a53342fe540428a4f69a@-（采用 initial-plan-8fdac60a0578a53342fe540428a4f69a），actor human/g6-person；候选 adoptedBy human/g6-person
- 采用前：叫停请求 action_request.stop:a1444dd9934047ad0821ee64e44f33a59641f8caa19a549dae646121a2bc5494 released；任务卡上的步骤 requested → hold_placed → sent → delivered → run_ended；sub 的 Run 已结束 2026-11-25T03:51:30.501Z（completed）
- goal-confirm:goal.confirmDraft:a3560dc548d7c8c4a8cf7cc3fdd1cb895beefa82147f823ff093487537539197 (RUNNING): pause because E08b ended: committed

## 撞墙表

共 81 行（其中场景预期的拒绝 2 行），每次拒绝一行，原文见 `checks/notes.md`。
P6 要记的三类（按原句匹配，裁定 Q10）：派工版本拒绝 0 次，问答轮发不出 0 次，注记读口 0 次。

## 预算

- 上限：总量 380000000，每个场景/格 50000000（acceptance.config.json `tokenCaps`）。
- 口径：用量 = inputTokens + outputTokens（Kernel 的 inputTokens 已含缓存命中，cachedInputTokens 另记、不再相加）；每条按它所在项目的归属场景/格计，不按读到的时间。
- 合计：用量 22447631（输入 22230764，输出 216867；缓存命中 19379968）；Query 请求 272 次（含 Query 的压缩摘要请求，公开记录分不出）；结束的 Work Run 28 个，其中 0 个是公开证明的零（没进入 Kernel）；未知或不完整的用量不算零：已关闭 Query 里用量未知的请求按预留上限（输入预留 + 输出预留）计，只会多算；Work Run 的用量未知或不完整、或请求的预留读不到时，计量停下。
- 已知缺口：Work Run 的压缩摘要请求在另一个 Kernel Session 里跑，不在 `activity/runs` 里，计量少算了它们；驱动不读数据库补数（lead 裁定 11-14 #3）。400M/50M 上限远高于预期用量，这是记下的缺口，不是阻断。
- 最后一次完整读数时在途：Query 0，Work Run 0（Work Run 的用量要等 Run 结束才在 `activity/runs` 出现，所以超限后的停止点是第一次能看到超出的读数）。
- 实报输入（平台报了用量的部分，不含按预留上限计的和未计费 0）：22230764；估算部分 0。
- 超预算退出：整轮 没有；按场景/格 没有。
- E05：用量 4112294（输入 4085528，输出 26766，缓存命中 3460352；Query 请求 56（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 3；实报输入 4085528）
- E06：用量 5870243（输入 5820973，输出 49270，缓存命中 5256960；Query 请求 55（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 6；实报输入 5820973）
- E08：用量 848528（输入 838491，输出 10037，缓存命中 672896；Query 请求 13（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 1；实报输入 838491）
- E09：用量 2538810（输入 2510181，输出 28629，缓存命中 2188672；Query 请求 17（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 3；实报输入 2510181）
- E12：用量 1206004（输入 1193374，输出 12630，缓存命中 1007872；Query 请求 17（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 2；实报输入 1193374）
- iteration：用量 1678601（输入 1651711，输出 26890，缓存命中 1416064；Query 请求 29（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 1；实报输入 1651711）
- intervention：用量 2861227（输入 2828688，输出 32539，缓存命中 2501376；Query 请求 33（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 4；实报输入 2828688）
- waiting：用量 1336060（输入 1323456，输出 12604，缓存命中 1140480；Query 请求 22（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 6；实报输入 1323456）
- E08b：用量 1995864（输入 1978362，输出 17502，缓存命中 1735296；Query 请求 30（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 2；实报输入 1978362）
- P6 记账：模型调用 558 次（公开原历史里 `model.request_started` 的条数，含 Work Run；压缩摘要的请求在另一个 Kernel Session 里，数不到，照旧记作缺口）；叫醒轮（intervention-planning）31 个，其中只回“收到”的 1 个（成功的工具调用只有读类和 respond_session_message，没交候选、没发信、没出卡；裁定 Q11，只计数不判）。
- E05：模型调用 79，叫醒轮 6，只回收到 0
- E06：模型调用 177，叫醒轮 12，只回收到 0
- E08：模型调用 24，叫醒轮 1，只回收到 0
- E09：模型调用 56，叫醒轮 1，只回收到 0
- E12：模型调用 34，叫醒轮 1，只回收到 0
- iteration：模型调用 35，叫醒轮 1，只回收到 0
- intervention：模型调用 66，叫醒轮 3，只回收到 0
- waiting：模型调用 37，叫醒轮 4，只回收到 1
- E08b：模型调用 50，叫醒轮 2，只回收到 0

## 延迟探针（只记录）

- w-accept#0：p50 20.28 ms，p95 21.36 ms，max 1104.15 ms（26013 个样本）；关闭方式 SIGINT, exit 0 after 651 ms
- w-accept#1：p50 20.35 ms，p95 21.5 ms，max 2554.33 ms（241450 个样本）；关闭方式 SIGINT, exit 0 after 114 ms
- w-accept#2：p50 21.3 ms，p95 21.84 ms，max 632.29 ms（49958 个样本）；关闭方式 SIGINT, exit 0 after 3595 ms
- w-accept#3：p50 20.35 ms，p95 21.61 ms，max 525.07 ms（70681 个样本）；关闭方式 SIGINT, exit 0 after 120 ms

## 证据

- `result.json`：八行，字段照 `slice-9-SPEC.md:729-745`。
- `checks/http.jsonl`：每次 HTTP（只有成功的同一读口连续同样答复合成一行带 `repeat`；每次拒绝单独一行）；预算计量的成功读不逐条记，只计数。
- `checks/model-calls.jsonl`：从公开读口取的每次 Query 请求用量和每个结束的 Work Run 合计，带归属的场景/格（`unit`，按项目归属，不按读到的时间）。
- `checks/commands.txt`：驱动起的命令（Host 起停、git、provider 探测）和退出码。
- `checks/notes.md`：逐条判据、撞墙表、A/B、压缩、B06、预算、延迟探针。
