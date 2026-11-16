# 第 9 片真实验收（G6）2026-11-15

- 树：`b9444921f5e00d43b19763695d01a0a0596270bd`（有未提交改动）；运行号 `g6-2026-11-15-cdea2e8f`；2026-11-15T15:25:38.604Z → 2026-11-16T02:31:56.177Z。
- 授权原文（逐场景同样记在 result.json 的 `authorization`）：用户批准（2026-11-14，决定 121-124）：G6 真实验收使用 DeepSeek-V4.1-Flash（provider 顺序照规格：网关 smoke-flash，不通时白天 smoke-ollama、晚上 smoke-deepseek；A1/B1 用 smoke-deepseek）；总量 4 亿 token、每个场景 5,000 万 token（输入含缓存命中 + 输出），超了就停；时间窗不限；不写钱数；只在临时运行目录里建账本和工作区，不提交、不推送、不对外发东西。
- 令牌：wa#0: 已取得令牌；wb#0: 已取得令牌；w-accept#0: 已取得令牌；w-accept#1: 已取得令牌；compaction#0: 已取得令牌。

## 八个场景：total=8 / pass=0 / fail=7 / uncovered=1

| 场景 | 判定 | C 行 | 未覆盖 |
|---|---|---|---|
| E05 | fail | C-182, C-183, C-185, C-71, C-73, C-191, C-208, C-217, C-218 | gate: 同模块重叠门回 task/module 和在跑的 Run (not-run); paths: 实际改动能给出具体 path（含共享文件） (not-run); kept: 两个任务的独立成果都还在，两个任务都 satisfied (not-run); single-occupancy: 同一 Session 同时最多一个写入执行（没有同 Session 时间重叠的两个 Run） (not-run); convention: 接口约定只交给一个任务写，另一个任务引用它 (not-run); duplicates: project_source compare（duplicates:true）列出埋入的副本及两处位置 (not-run); reviewer: 审阅者独立判断它是同一条规则（审阅要求有结论） (not-run); name-different: 名字不同、规则相同：报 (not-run); name-same: 名字相同、规则不同：不报 (not-run); temporary: 临时件在做完之前已收回（结束时没有计划外的未跟踪文件） (not-run); line-choice: 派工排除只读副本/等待/退役线并按六键排序 (not-run) |
| E06 | uncovered | C-75, C-135, C-106, C-194, C-149, C-151, C-68, C-181, C-209, C-219, C-223 | handoff: 模型 hand_off，人批准，出现接任线 (not-run); successor-input: 接任者实际输入（turn 输入）含目标词和前任 hand_off 的理由原文，不只同一 sessionId (not-run); successor-frontier: 接任者实际输入含前任的义务/前沿 (not-run); no-restatement: 换手后用户没有重述任务 (not-run); excluded-path: 接任者引用当前理解并避开已排除路径 (not-run); same-task-new-run: 同一 Task 新开 Attempt/Run 优先原 Session，带接续说明 (not-run); history-continuity: 后续输入真正含必要前文（不只同一 Session ID） (not-run); restart-running: Work Run 在跑时正常关闭重启：记被中断，继续在原 Session (not-run); restart-paused: 暂停中重启：不算失败，可继续，恢复后在原线接着做 (not-run); archive: 归档前任后源线历史可读（sessions/history、executions/history） (not-run); hand-or-drop: 归档有未完成任务的线：先选交给或放下，同时释放责任与席位 (not-run); wake: 答卡等提交叫醒目标驱动，后继 Run 真的启动 (not-run) |
| E08 | fail | C-47, C-62, C-63, C-133a, C-126, C-46, C-52, C-116, C-118, C-210 | switch: 受影响任务切到新定义（出现 div 任务，sub 被取消），无关任务继续（mul） (not-run); old-evidence: 旧证据不满足新义务：div 的义务要求只由改后计划下、div 自己改后 Run 的检查轮覆盖 (not-run); required-cancel: required 取消后不因空集合变绿（div 满足之前 Goal 不完成） (not-run); autonomy-later: 改自治级别只影响之后的动作，不停正在跑的工作 (not-run) |
| E09 | fail | C-185, C-89, C-65, C-98, C-93, C-95, C-99, C-55, C-62, C-211, C-212, C-218 | adviser-explains: 参谋解释具体对象和影响 (not-run); person-decides: 人的决定有授权与版本（答卡带钉住的版本） (not-run); new-version: 新计划版本替换受影响任务，新定义进上下文 (not-run); uncovered-round: 没有覆盖必需要求的检查时读作 INCONCLUSIVE，不以空集合 PASS (not-run) |
| E12 | fail | C-36, C-42, C-157, C-88, C-89, C-104, C-145, C-146, C-158, C-147, C-155, C-207, C-114, C-215, C-220 | history-reuse: 重启后的相关新工作实际查询了已完成工作，结果带来源（旧 Goal/Run 的引用） (not-run); stale-premise: 保留适用范围，过期前提不升级 (not-run); replay: 同一次 driver-start 重放只读原来的执行 (not-run); wait-registry: 目标等待登记表启动时只读重建 (not-run) |
| iteration | fail | C-108, C-109, C-110, C-111, C-112, C-105, C-107, C-113, C-194, C-213, C-226 | - |
| intervention | fail | C-199, C-200, C-201, C-202, C-203, C-114, C-189, C-192, C-197, C-198 | ask-copy: “问一问”开只读副本，不打扰原线 (not-run); delivery-states: 消息在安全点送达，分别显示已排队/已送达（disposition） (not-run); continue-no-planning: 有任务接着做时不开 intervention_planning (not-run); planning-when-idle: 活跃目标、线上没有未完成任务时开 intervention_planning，答案交 plans/propose (not-run); four-endings: 四种收尾（反问/非法/没答/放弃）各落到通知、回复或撤回，不静默 (not-run); paused-queues: 暂停时干预只排队，不冒充继续；恢复后才送达 (not-run) |
| waiting | fail | C-170, C-171, C-187, C-188, C-190, C-172, C-184, C-189, C-192, C-195, C-196, C-207, C-224, C-225 | restart-kept: 正常关闭重启后仍核对原等待（同一 messageRef、收信人、期限） (not-run); expiry-once: 到期先记下（expiredAt），不算消费；由 expiry 接受消费 (not-run); second-expiry: 同一追问链第二次实际到期，后继输入写“第 2 次到期” (not-run); consumes: 真实接受才 consumesWait:true；迟到的普通回复写 false (not-run); late-reply: 迟回保存为下一个安全点的新输入，不重开旧等待 (not-run); transfer: 转交保留问题和期限，未送达不自动换人 (not-run); disconnect: 等待的一侧归档后 decisions/queue 出这条等待的 disconnect 项，Host 给两侧各发 notify (not-run); supply-order: 供给按冻结顺序：人的消息、续作、agent 消息 (not-run) |

每行的逐条判据、证据和原因见 `checks/notes.md`；没跑到的判据记 `uncovered`，不因场景其余判据通过而通过。

## A/B 两格（不进 result.json）

### A1（1M → 131072）：pass

- reserved（C-214）：pass。reservedOutput 131072（requestId b320e377-2f4c-4969-9e4c-4dc67efce558）
- usage（C-214）：pass。usageStatus reported，输入 29537，输出 140，缓存命中 25856
- accepted（C-214）：pass。请求被接受（用量已报）
- not-truncated（C-214）：pass。输出 140 < 预留 131072；close detail none
- driver-start: ready running
- 请求事实：[{"requestId":"b320e377-2f4c-4969-9e4c-4dc67efce558","reservedOutput":131072,"usageStatus":"reported","inputTokens":29537,"outputTokens":140,"cachedInputTokens":25856},{"requestId":"8e5a8013-1967-484d-9c85-6a276b0acdeb","reservedOutput":131072,"usageStatus":"reserved","inputTokens":null,"outputTokens":null,"cachedInputTokens":null}]；Query running；close null；profile 累计输出上限 null = 不设上限
- queries/cancel after the first request: ready stopping
- request 8e5a8013-1967-484d-9c85-6a276b0acdeb: cut by the driver's cancel; usage not reported, at most one request (Query closed, close cancelled)

### B1（128k → 64000）：pass

- reserved（C-214）：pass。reservedOutput 64000（requestId fa2aec8e-4cc1-48aa-bcdd-b1c1e3d0a303）
- usage（C-214）：pass。usageStatus reported，输入 16200，输出 102，缓存命中 12800
- accepted（C-214）：pass。请求被接受（用量已报）
- not-truncated（C-214）：pass。输出 102 < 预留 64000；close detail none
- fits（C-214）：pass。请求发出（reservedInput 以内），reservedOutput 64000
- driver-start: ready running
- 请求事实：[{"requestId":"fa2aec8e-4cc1-48aa-bcdd-b1c1e3d0a303","reservedOutput":64000,"usageStatus":"reported","inputTokens":16200,"outputTokens":102,"cachedInputTokens":12800},{"requestId":"480a5b7f-8037-4d5e-a673-39b433e25dbc","reservedOutput":63898,"usageStatus":"reserved","inputTokens":null,"outputTokens":null,"cachedInputTokens":null}]；Query running；close null；profile 累计输出上限 64000
- queries/cancel after the first request: ready stopping
- request 480a5b7f-8037-4d5e-a673-39b433e25dbc: cut by the driver's cancel; usage not reported, at most one request (Query closed, close cancelled)

## 压缩场景（单列，不算第 9 个场景）

### 压缩：pass

- compacted（K2-P2）：pass。context_compacted 3 条（kernhist1.eyJ2IjoxLCJwIjp7InByb2plY3RJZCI6ImFlODQ1MDI0Y2ZlYWU4YmFkNGQxNDE3NDllYmFhMzEwIiwic2Vzc2lvbklkIjoic2Vzc2lvbi0zYzcwOTA2NmI4MjFmZjEyNDVkMDY4MzY4MzQ5Y2Y4MWUyZWU4ZTNhNDEyNGY3N2EyZTA3ZDc5M2I2NzkzY2Y1In0sImEiOiJob3N0LXNldHRpbmdzLWtlcm5lbC03ZDZhYmJhNjMzMjRkY2U5MjkzOTVhMDA3YTY0MjkyYyIsImsiOiJzZXNzaW9uLTNjNzA5MDY2YjgyMWZmMTI0NWQwNjgzNjgzNDljZjgxZTJlZThlM2E0MTI0Zjc3YTJlMDdkNzkzYjY3OTNjZjUiLCJyIjoie1wiYWN0b3JcIjp7XCJpZFwiOlwiZzYtcGVyc29uXCIsXCJraW5kXCI6XCJodW1hblwifSxcImtpbmRcIjpcImhvc3RcIn0iLCJ1IjoxMDcsImwiOjEsImkiOjU4fQ:summary, kernhist1.eyJ2IjoxLCJwIjp7InByb2plY3RJZCI6ImFlODQ1MDI0Y2ZlYWU4YmFkNGQxNDE3NDllYmFhMzEwIiwic2Vzc2lvbklkIjoic2Vzc2lvbi0zYzcwOTA2NmI4MjFmZjEyNDVkMDY4MzY4MzQ5Y2Y4MWUyZWU4ZTNhNDEyNGY3N2EyZTA3ZDc5M2I2NzkzY2Y1In0sImEiOiJob3N0LXNldHRpbmdzLWtlcm5lbC03ZDZhYmJhNjMzMjRkY2U5MjkzOTVhMDA3YTY0MjkyYyIsImsiOiJzZXNzaW9uLTNjNzA5MDY2YjgyMWZmMTI0NWQwNjgzNjgzNDljZjgxZTJlZThlM2E0MTI0Zjc3YTJlMDdkNzkzYjY3OTNjZjUiLCJyIjoie1wiYWN0b3JcIjp7XCJpZFwiOlwiZzYtcGVyc29uXCIsXCJraW5kXCI6XCJodW1hblwifSxcImtpbmRcIjpcImhvc3RcIn0iLCJ1IjoxMDcsImwiOjEsImkiOjc5fQ:summary, kernhist1.eyJ2IjoxLCJwIjp7InByb2plY3RJZCI6ImFlODQ1MDI0Y2ZlYWU4YmFkNGQxNDE3NDllYmFhMzEwIiwic2Vzc2lvbklkIjoic2Vzc2lvbi0zYzcwOTA2NmI4MjFmZjEyNDVkMDY4MzY4MzQ5Y2Y4MWUyZWU4ZTNhNDEyNGY3N2EyZTA3ZDc5M2I2NzkzY2Y1In0sImEiOiJob3N0LXNldHRpbmdzLWtlcm5lbC03ZDZhYmJhNjMzMjRkY2U5MjkzOTVhMDA3YTY0MjkyYyIsImsiOiJzZXNzaW9uLTNjNzA5MDY2YjgyMWZmMTI0NWQwNjgzNjgzNDljZjgxZTJlZThlM2E0MTI0Zjc3YTJlMDdkNzkzYjY3OTNjZjUiLCJyIjoie1wiYWN0b3JcIjp7XCJpZFwiOlwiZzYtcGVyc29uXCIsXCJraW5kXCI6XCJodW1hblwifSxcImtpbmRcIjpcImhvc3RcIn0iLCJ1IjoxMDcsImwiOjEsImkiOjk2fQ:summary）
- six-sections（K2-P2）：pass。摘要（kernhist1.eyJ2IjoxLCJwIjp7InByb2plY3RJZCI6ImFlODQ1MDI0Y2ZlYWU4YmFkNGQxNDE3NDllYmFhMzEwIiwic2Vzc2lvbklkIjoic2Vzc2lvbi0zYzcwOTA2NmI4MjFmZjEyNDVkMDY4MzY4MzQ5Y2Y4MWUyZWU4ZTNhNDEyNGY3N2EyZTA3ZDc5M2I2NzkzY2Y1In0sImEiOiJob3N0LXNldHRpbmdzLWtlcm5lbC03ZDZhYmJhNjMzMjRkY2U5MjkzOTVhMDA3YTY0MjkyYyIsImsiOiJzZXNzaW9uLTNjNzA5MDY2YjgyMWZmMTI0NWQwNjgzNjgzNDljZjgxZTJlZThlM2E0MTI0Zjc3YTJlMDdkNzkzYjY3OTNjZjUiLCJyIjoie1wiYWN0b3JcIjp7XCJpZFwiOlwiZzYtcGVyc29uXCIsXCJraW5kXCI6XCJodW1hblwifSxcImtpbmRcIjpcImhvc3RcIn0iLCJ1IjoxMDcsImwiOjEsImkiOjU4fQ）2241 字；缺的段：无
- accepted（K2-P2）：pass。摘要后第一次请求 56510fd2-d77f-4cb1-a415-371050a2522d：usage reported（那一轮之后 closed，close invalid_answer，另记）
- cache-after（K2-P2）：pass。摘要后第一次请求 56510fd2-d77f-4cb1-a415-371050a2522d：输入 36131，缓存命中 27264（只量，不承诺）
- 秘书线 5 轮；压缩记录 compacted/summary, compacted/summary, compacted/summary；触发 0.02、目标 0.01

## 附加格（八个场景之后的附加 Goal）

### C-216：fail

- observed-start（C-216）：pass。采用的架构模块路径：src/report.js, src/store.js, test/store.test.js
- adopted-done（C-216）：fail。the platform did not do it: timed out after 90 min waiting for goal-confirm:goal.confirmDraft:c33039809d7355553144c050cb30cced6f1be46d23831476531bbcb62f3fc452 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL
- stopped: not-run: timed out after 90 min waiting for goal-confirm:goal.confirmDraft:c33039809d7355553144c050cb30cced6f1be46d23831476531bbcb62f3fc452 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL
- goal-confirm:goal.confirmDraft:c33039809d7355553144c050cb30cced6f1be46d23831476531bbcb62f3fc452 (NEEDS_DECISION): pause because C-216 ended: committed

### C-221：fail

- first-plan（C-221）：pass。首案采用 initial-plan-8bbd3d8633b0715e4f468a84b4c80180
- fail-rework（C-221）：fail。the platform did not do it: timed out after 90 min waiting for goal-confirm:goal.confirmDraft:afe093831c5ad78717e7be5a4c8ee9397a2353f6eb9ae7dc4faeee3a15dcbae4 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL
- delivered（C-221）：uncovered (not-run)。stopped before this check: timed out after 90 min waiting for goal-confirm:goal.confirmDraft:afe093831c5ad78717e7be5a4c8ee9397a2353f6eb9ae7dc4faeee3a15dcbae4 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL
- stopped: not-run: timed out after 90 min waiting for goal-confirm:goal.confirmDraft:afe093831c5ad78717e7be5a4c8ee9397a2353f6eb9ae7dc4faeee3a15dcbae4 to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL
- goal-confirm:goal.confirmDraft:afe093831c5ad78717e7be5a4c8ee9397a2353f6eb9ae7dc4faeee3a15dcbae4 (RUNNING): pause because C-221 ended: committed

### C-222：pass

- created（C-222）：pass。secretaryCreated 的线：session-0c9e94fbbd3a3994f5060af0e9b1ba0586af1152bad6ba4eb8fc44eda23ee84e
- started（C-222）：pass。建出的线上 Run：18a1de6a-4be6-4ccd-8d22-1f27084c6c1b/completed, c237f729-e1f4-4473-b8a0-d9da8ed9730f/completed, e9bf335b-35ce-43d7-a254-981e37f98f23/completed；Goal COMPLETED；null

## B06

### B06 关闭格：fail

- W1a（B06-W1a）：fail。the platform did not do it: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:ad1ffea8258ebdb3f0217608745fdeaecc4402d09f7f62b57a545bff5669d09b to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL
- W2（B06-W2）：uncovered (not-run)。stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:ad1ffea8258ebdb3f0217608745fdeaecc4402d09f7f62b57a545bff5669d09b to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL
- W3（B06-W3）：uncovered (not-run)。stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:ad1ffea8258ebdb3f0217608745fdeaecc4402d09f7f62b57a545bff5669d09b to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL
- W5（B06-W5）：uncovered (not-run)。stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:ad1ffea8258ebdb3f0217608745fdeaecc4402d09f7f62b57a545bff5669d09b to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL
- W10（B06-W10）：uncovered (not-run)。stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:ad1ffea8258ebdb3f0217608745fdeaecc4402d09f7f62b57a545bff5669d09b to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL
- W12（B06-W12）：uncovered (not-run)。stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:ad1ffea8258ebdb3f0217608745fdeaecc4402d09f7f62b57a545bff5669d09b to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL
- explore（B06-cond3）：uncovered (not-run)。stopped before this check: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:ad1ffea8258ebdb3f0217608745fdeaecc4402d09f7f62b57a545bff5669d09b to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL
- stopped: not-run: timed out after 60 min waiting for goal-confirm:goal.confirmDraft:ad1ffea8258ebdb3f0217608745fdeaecc4402d09f7f62b57a545bff5669d09b to reach COMPLETED/FAILED/CANCELLED/ACCEPTED_PARTIAL
- goal-confirm:goal.confirmDraft:ad1ffea8258ebdb3f0217608745fdeaecc4402d09f7f62b57a545bff5669d09b (RUNNING): pause because B06 ended: committed

## 撞墙表

共 144 行（其中场景预期的拒绝 4 行），每次拒绝一行，原文见 `checks/notes.md`。

## 预算

- 上限：总量 400000000，每个场景/格 50000000（acceptance.config.json `tokenCaps`）。
- 口径：用量 = inputTokens + outputTokens（Kernel 的 inputTokens 已含缓存命中，cachedInputTokens 另记、不再相加）；每条按它所在项目的归属场景/格计，不按读到的时间。
- 合计：用量 48958990（输入 48570304，输出 388686；缓存命中 43789824）；Query 请求 382 次（含 Query 的压缩摘要请求，公开记录分不出）；结束的 Work Run 27 个，其中 0 个是公开证明的零（没进入 Kernel）；未知或不完整的用量不算零：已关闭 Query 里用量未知的请求按预留上限（输入预留 + 输出预留）计，只会多算；Work Run 的用量未知或不完整、或请求的预留读不到时，计量停下。
- 已知缺口：Work Run 的压缩摘要请求在另一个 Kernel Session 里跑，不在 `activity/runs` 里，计量少算了它们；驱动不读数据库补数（lead 裁定 11-14 #3）。400M/50M 上限远高于预期用量，这是记下的缺口，不是阻断。
- 最后一次完整读数时在途：Query 0，Work Run 0（Work Run 的用量要等 Run 结束才在 `activity/runs` 出现，所以超限后的停止点是第一次能看到超出的读数）。
- A1：用量 29677（输入 29537，输出 140，缓存命中 25856；Query 请求 2（其中按未计费 0 计的 1：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 0）
- B1：用量 16302（输入 16200，输出 102，缓存命中 12800；Query 请求 2（其中按未计费 0 计的 1：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 0）
- E05：用量 3695010（输入 3654582，输出 40428，缓存命中 3307136；Query 请求 33（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 4）
- E06：用量 0（输入 0，输出 0，缓存命中 0；Query 请求 0（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 0）
- E08：用量 1168610（输入 1149257，输出 19353，缓存命中 962944；Query 请求 21（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 1）
- E09：用量 8527074（输入 8481308，输出 45766，缓存命中 8023040；Query 请求 27（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 9）
- E12：用量 5064248（输入 5015088，输出 49160，缓存命中 4382336；Query 请求 52（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 2）
- iteration：用量 1657645（输入 1640039，输出 17606，缓存命中 1459328；Query 请求 32（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 1）
- intervention：用量 454036（输入 448294，输出 5742，缓存命中 350976；Query 请求 8（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 1）
- waiting：用量 3119748（输入 3089476，输出 30272，缓存命中 2683776；Query 请求 42（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 2）
- C-216：用量 1147356（输入 1134066，输出 13290，缓存命中 1012608；Query 请求 12（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 2）
- C-221：用量 564113（输入 554628，输出 9485，缓存命中 447744；Query 请求 9（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 1）
- C-222：用量 22315897（输入 22178778，输出 137119，缓存命中 20147072；Query 请求 112（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 3）
- B06：用量 425152（输入 419610，输出 5542，缓存命中 320384；Query 请求 9（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 1）
- compaction：用量 774122（输入 759441，输出 14681，缓存命中 653824；Query 请求 21（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 0）

## 延迟探针（只记录）

- wa#0：p50 20.51 ms，p95 20.71 ms，max 286.26 ms（15178 个样本）；关闭方式 SIGINT, exit 0 after 36 ms
- wb#0：p50 20.53 ms，p95 20.69 ms，max 240.12 ms（18113 个样本）；关闭方式 SIGINT, exit 0 after 25 ms
- w-accept#0：p50 20.61 ms，p95 20.89 ms，max 693.11 ms（652618 个样本）；关闭方式 SIGINT, exit 0 after 168 ms
- w-accept#1：p50 20.99 ms，p95 21.48 ms，max 3554.67 ms（1289415 个样本）；关闭方式 SIGINT, exit 0 after 317 ms
- compaction#0：p50 21.23 ms，p95 21.66 ms，max 374.6 ms（10507 个样本）；关闭方式 SIGINT, exit 0 after 44 ms

## 证据

- `result.json`：八行，字段照 `slice-9-SPEC.md:729-745`。
- `checks/http.jsonl`：每次 HTTP（只有成功的同一读口连续同样答复合成一行带 `repeat`；每次拒绝单独一行）；预算计量的成功读不逐条记，只计数。
- `checks/model-calls.jsonl`：从公开读口取的每次 Query 请求用量和每个结束的 Work Run 合计，带归属的场景/格（`unit`，按项目归属，不按读到的时间）。
- `checks/commands.txt`：驱动起的命令（Host 起停、git、provider 探测）和退出码。
- `checks/notes.md`：逐条判据、撞墙表、A/B、压缩、B06、预算、延迟探针。
