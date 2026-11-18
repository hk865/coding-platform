# 第 9 片真实验收（G6）2026-11-17

- 树：`fe5502ee3bff9966435e4aef0c791b96c7f02c37`（有未提交改动）；运行号 `g6-2026-11-17-a4edb755`；2026-11-17T18:08:44.788Z → 2026-11-17T22:26:04.193Z。
- 授权原文（逐场景同样记在 result.json 的 `authorization`）：用户批准（2026-11-14，决定 121-124）：G6 真实验收使用 DeepSeek-V4.1-Flash（provider 顺序照规格：网关 smoke-flash，不通时白天 smoke-ollama、晚上 smoke-deepseek；A1/B1 用 smoke-deepseek）；总量 4 亿 token、每个场景 5,000 万 token（输入含缓存命中 + 输出），超了就停；时间窗不限；不写钱数；只在临时运行目录里建账本和工作区，不提交、不推送、不对外发东西。
- 令牌：wa#0: 已取得令牌；wb#0: 已取得令牌；w-accept#0: 已取得令牌；w-accept#1: 已取得令牌；compaction#0: 已取得令牌。

## 八个场景：total=8 / pass=1 / fail=5 / uncovered=2

| 场景 | 判定 | C 行 | 未覆盖 |
|---|---|---|---|
| E05 | fail | C-182, C-183, C-185, C-71, C-73, C-191, C-208, C-217, C-218 | gate: 同模块重叠门回 task/module 和在跑的 Run (not-run); paths: 实际改动能给出具体 path（含共享文件） (not-run); kept: 两个任务的独立成果都还在，两个任务都 satisfied (not-run); single-occupancy: 同一 Session 同时最多一个写入执行（没有同 Session 时间重叠的两个 Run） (not-run); convention: 接口约定只交给一个任务写，另一个任务引用它 (not-run); duplicates: project_source compare（duplicates:true）列出埋入的副本及两处位置 (not-run); reviewer: 审阅者独立判断它是同一条规则（审阅要求有结论） (not-run); name-different: 名字不同、规则相同：报 (not-run); name-same: 名字相同、规则不同：不报 (not-run); temporary: 临时件在做完之前已收回（结束时没有计划外的未跟踪文件） (not-run); line-choice: 派工排除只读副本/等待/退役线并按六键排序 (not-run) |
| E06 | uncovered | C-75, C-135, C-106, C-194, C-149, C-151, C-68, C-181, C-209, C-219, C-223 | handoff: 模型 hand_off，人批准，出现接任线 (not-run); successor-input: 接任者实际输入（turn 输入）含目标词和前任 hand_off 的理由原文，不只同一 sessionId (not-run); successor-frontier: 接任者实际输入含前任的义务/前沿 (not-run); no-restatement: 换手后用户没有重述任务 (not-run); excluded-path: 接任者引用当前理解并避开已排除路径 (not-run); same-task-new-run: 同一 Task 新开 Attempt/Run 优先原 Session，带接续说明 (not-run); history-continuity: 后续输入真正含必要前文（不只同一 Session ID） (not-run); restart-running: Work Run 在跑时正常关闭重启：记被中断，继续在原 Session (not-run); restart-paused: 暂停中重启：不算失败，可继续，恢复后在原线接着做 (not-run); archive: 归档前任后源线历史可读（sessions/history、executions/history） (not-run); hand-or-drop: 归档有未完成任务的线：先选交给或放下，同时释放责任与席位 (not-run); wake: 答卡等提交叫醒目标驱动，后继 Run 真的启动 (not-run) |
| E08 | fail | C-47, C-62, C-63, C-133a, C-126, C-46, C-52, C-116, C-118, C-210 | autonomy-later: 改自治级别只影响之后的动作，不停正在跑的工作 (not-run) |
| E09 | fail | C-185, C-89, C-65, C-98, C-93, C-95, C-99, C-55, C-62, C-211, C-212, C-218 | adviser-explains: 参谋解释具体对象和影响 (not-run); person-decides: 人的决定有授权与版本（答卡带钉住的版本） (not-run); new-version: 新计划版本替换受影响任务，新定义进上下文 (not-run); formal-change: 正式架构变更走 architecture/revise，产生新目录版本 (not-run); drift: 漂移能定位版本/文件（compare-formal 的 finding 带 path） (not-run); observation-after-pass: 检查 PASS 定稿后自动抓一次观测 (not-run); rounds: 每个 Work Task 开轮、PASS 无缺口、证据写入 (not-run); uncovered-round: 没有覆盖必需要求的检查时读作 INCONCLUSIVE，不以空集合 PASS (not-run) |
| E12 | uncovered | C-36, C-42, C-157, C-88, C-89, C-104, C-145, C-146, C-158, C-147, C-155, C-207, C-114, C-215, C-220 | history-reuse: 重启后的相关新工作实际查询了已完成工作，结果带来源（旧 Goal/Run 的引用） (not-run); stale-premise: 保留适用范围，过期前提不升级 (entry-missing); wait-registry: 目标等待登记表启动时只读重建 (entry-missing) |
| iteration | pass | C-108, C-109, C-110, C-111, C-112, C-105, C-107, C-113, C-194, C-213, C-226 | - |
| intervention | fail | C-199, C-200, C-201, C-202, C-203, C-114, C-189, C-192, C-197, C-198 | four-endings: 四种收尾（反问/非法/没答/放弃）各落到通知、回复或撤回，不静默 (not-run); completed-goal: 已完成 Goal 上加工作，先确认成新 Goal，原完成不变 (not-run) |
| waiting | fail | C-170, C-171, C-187, C-188, C-190, C-172, C-184, C-189, C-192, C-195, C-196, C-207, C-224, C-225 | restart-kept: 正常关闭重启后仍核对原等待（同一 messageRef、收信人、期限） (not-run); expiry-once: 到期先记下（expiredAt），不算消费；由 expiry 接受消费 (not-run); second-expiry: 同一追问链第二次实际到期，后继输入写“第 2 次到期” (not-run); consumes: 真实接受才 consumesWait:true；迟到的普通回复写 false (not-run); late-reply: 迟回保存为下一个安全点的新输入，不重开旧等待 (not-run); transfer: 转交保留问题和期限，未送达不自动换人 (not-run); disconnect: 等待的一侧归档后 decisions/queue 出这条等待的 disconnect 项，Host 给两侧各发 notify (not-run); supply-order: 供给按冻结顺序：人的消息、续作、agent 消息 (not-run) |

每行的逐条判据、证据和原因见 `checks/notes.md`；没跑到的判据记 `uncovered`，不因场景其余判据通过而通过。

## A/B 两格（不进 result.json）

### A1（1M → 131072）：pass

- reserved（C-214）：pass。reservedOutput 131072（requestId aa6f9235-634b-4df0-9f28-a7af1bb870a9）
- usage（C-214）：pass。usageStatus reported，输入 29438，输出 101，缓存命中 384
- accepted（C-214）：pass。请求被接受（用量已报）
- not-truncated（C-214）：pass。输出 101 < 预留 131072；close detail none
- driver-start: ready running
- 请求事实：[{"requestId":"aa6f9235-634b-4df0-9f28-a7af1bb870a9","reservedOutput":131072,"usageStatus":"reported","inputTokens":29438,"outputTokens":101,"cachedInputTokens":384},{"requestId":"2eea60d1-d49b-4e57-99d6-116f535cadb4","reservedOutput":131072,"usageStatus":"reported","inputTokens":31377,"outputTokens":178,"cachedInputTokens":29440},{"requestId":"e1565753-beae-4f19-a189-faf34e19684c","reservedOutput":131072,"usageStatus":"reported","inputTokens":32431,"outputTokens":196,"cachedInputTokens":31488},{"requestId":"ee23485e-f5bb-4673-9bde-6505042989ee","reservedOutput":131072,"usageStatus":"reported","inputTokens":33602,"outputTokens":221,"cachedInputTokens":32512},{"requestId":"71b312c3-6ba4-47a7-ac3b-1d800cee70a1","reservedOutput":131072,"usageStatus":"reported","inputTokens":34949,"outputTokens":134,"cachedInputTokens":33792},{"requestId":"4eb944b2-1bad-4950-8183-9f65057f2fe2","reservedOutput":131072,"usageStatus":"reserved","inputTokens":null,"outputTokens":null,"cachedInputTokens":null}]；Query running；close null；profile 累计输出上限 null = 不设上限
- queries/cancel after the first request: ready stopping
- request 4eb944b2-1bad-4950-8183-9f65057f2fe2: cut by the driver's cancel; usage not reported, at most one request (Query closed, close cancelled)

### B1（128k → 64000）：pass

- reserved（C-214）：pass。reservedOutput 64000（requestId 2d185464-f9ba-4e31-a269-56787860b2ab）
- usage（C-214）：pass。usageStatus reported，输入 15900，输出 70，缓存命中 12160
- accepted（C-214）：pass。请求被接受（用量已报）
- not-truncated（C-214）：pass。输出 70 < 预留 64000；close detail none
- fits（C-214）：pass。请求发出（reservedInput 以内），reservedOutput 64000
- driver-start: ready running
- 请求事实：[{"requestId":"2d185464-f9ba-4e31-a269-56787860b2ab","reservedOutput":64000,"usageStatus":"reported","inputTokens":15900,"outputTokens":70,"cachedInputTokens":12160},{"requestId":"fbc9623f-1ec3-4fa9-b43c-d420aa3e8cf3","reservedOutput":63930,"usageStatus":"reported","inputTokens":16725,"outputTokens":170,"cachedInputTokens":15872},{"requestId":"5bcea2a7-115c-4c70-95ec-b242b31f2a60","reservedOutput":63760,"usageStatus":"reported","inputTokens":17776,"outputTokens":387,"cachedInputTokens":16768},{"requestId":"750f1421-431f-4387-8cb6-47f00e72b530","reservedOutput":63373,"usageStatus":"reported","inputTokens":18366,"outputTokens":337,"cachedInputTokens":18048},{"requestId":"ca5d3835-72e6-47f4-9d37-903495fff159","reservedOutput":63036,"usageStatus":"reported","inputTokens":18843,"outputTokens":343,"cachedInputTokens":18688},{"requestId":"e8ed5b97-50ae-4446-bb72-dccb746c1c0d","reservedOutput":62693,"usageStatus":"reserved","inputTokens":null,"outputTokens":null,"cachedInputTokens":null}]；Query running；close null；profile 累计输出上限 64000
- queries/cancel after the first request: ready stopping
- request e8ed5b97-50ae-4446-bb72-dccb746c1c0d: cut by the driver's cancel; usage not reported, at most one request (Query closed, close cancelled)

## 压缩场景（单列，不算第 9 个场景）

### 压缩：pass

- compacted（K2-P2）：pass。context_compacted 3 条（kernhist1.eyJ2IjoxLCJwIjp7InByb2plY3RJZCI6IjA0NmE2ZjQ2ZGQ1ZGQyZWJiNGY1ODAyYjJjMzZlODE1Iiwic2Vzc2lvbklkIjoic2Vzc2lvbi1jMWI5NjY3MjBjMzcxZjg2MjI3ZTMyMDE0Y2U0OWEyZmM3MjBhNWViM2RmZDQ3OTc3OWYxMWVjOGEwMjAyMmJhIn0sImEiOiJob3N0LXNldHRpbmdzLWtlcm5lbC05OTZiMjI1ZDk3NDE0NWVkNTg4OTkyZGExYTkyYzYwMSIsImsiOiJzZXNzaW9uLWMxYjk2NjcyMGMzNzFmODYyMjdlMzIwMTRjZTQ5YTJmYzcyMGE1ZWIzZGZkNDc5Nzc5ZjExZWM4YTAyMDIyYmEiLCJyIjoie1wiYWN0b3JcIjp7XCJpZFwiOlwiZzYtcGVyc29uXCIsXCJraW5kXCI6XCJodW1hblwifSxcImtpbmRcIjpcImhvc3RcIn0iLCJ1IjoxNTgsImwiOjEsImkiOjU5fQ:summary, kernhist1.eyJ2IjoxLCJwIjp7InByb2plY3RJZCI6IjA0NmE2ZjQ2ZGQ1ZGQyZWJiNGY1ODAyYjJjMzZlODE1Iiwic2Vzc2lvbklkIjoic2Vzc2lvbi1jMWI5NjY3MjBjMzcxZjg2MjI3ZTMyMDE0Y2U0OWEyZmM3MjBhNWViM2RmZDQ3OTc3OWYxMWVjOGEwMjAyMmJhIn0sImEiOiJob3N0LXNldHRpbmdzLWtlcm5lbC05OTZiMjI1ZDk3NDE0NWVkNTg4OTkyZGExYTkyYzYwMSIsImsiOiJzZXNzaW9uLWMxYjk2NjcyMGMzNzFmODYyMjdlMzIwMTRjZTQ5YTJmYzcyMGE1ZWIzZGZkNDc5Nzc5ZjExZWM4YTAyMDIyYmEiLCJyIjoie1wiYWN0b3JcIjp7XCJpZFwiOlwiZzYtcGVyc29uXCIsXCJraW5kXCI6XCJodW1hblwifSxcImtpbmRcIjpcImhvc3RcIn0iLCJ1IjoxNTgsImwiOjEsImkiOjg0fQ:summary, kernhist1.eyJ2IjoxLCJwIjp7InByb2plY3RJZCI6IjA0NmE2ZjQ2ZGQ1ZGQyZWJiNGY1ODAyYjJjMzZlODE1Iiwic2Vzc2lvbklkIjoic2Vzc2lvbi1jMWI5NjY3MjBjMzcxZjg2MjI3ZTMyMDE0Y2U0OWEyZmM3MjBhNWViM2RmZDQ3OTc3OWYxMWVjOGEwMjAyMmJhIn0sImEiOiJob3N0LXNldHRpbmdzLWtlcm5lbC05OTZiMjI1ZDk3NDE0NWVkNTg4OTkyZGExYTkyYzYwMSIsImsiOiJzZXNzaW9uLWMxYjk2NjcyMGMzNzFmODYyMjdlMzIwMTRjZTQ5YTJmYzcyMGE1ZWIzZGZkNDc5Nzc5ZjExZWM4YTAyMDIyYmEiLCJyIjoie1wiYWN0b3JcIjp7XCJpZFwiOlwiZzYtcGVyc29uXCIsXCJraW5kXCI6XCJodW1hblwifSxcImtpbmRcIjpcImhvc3RcIn0iLCJ1IjoxNTgsImwiOjEsImkiOjEzOH0:summary）
- six-sections（K2-P2）：pass。摘要（kernhist1.eyJ2IjoxLCJwIjp7InByb2plY3RJZCI6IjA0NmE2ZjQ2ZGQ1ZGQyZWJiNGY1ODAyYjJjMzZlODE1Iiwic2Vzc2lvbklkIjoic2Vzc2lvbi1jMWI5NjY3MjBjMzcxZjg2MjI3ZTMyMDE0Y2U0OWEyZmM3MjBhNWViM2RmZDQ3OTc3OWYxMWVjOGEwMjAyMmJhIn0sImEiOiJob3N0LXNldHRpbmdzLWtlcm5lbC05OTZiMjI1ZDk3NDE0NWVkNTg4OTkyZGExYTkyYzYwMSIsImsiOiJzZXNzaW9uLWMxYjk2NjcyMGMzNzFmODYyMjdlMzIwMTRjZTQ5YTJmYzcyMGE1ZWIzZGZkNDc5Nzc5ZjExZWM4YTAyMDIyYmEiLCJyIjoie1wiYWN0b3JcIjp7XCJpZFwiOlwiZzYtcGVyc29uXCIsXCJraW5kXCI6XCJodW1hblwifSxcImtpbmRcIjpcImhvc3RcIn0iLCJ1IjoxNTgsImwiOjEsImkiOjU5fQ）1780 字；缺的段：无
- accepted（K2-P2）：pass。摘要后第一次请求 692a5958-7354-4132-9a1f-24be3c3b78a0：usage reported（那一轮之后 closed，close invalid_answer，另记）
- cache-after（K2-P2）：pass。摘要后第一次请求 692a5958-7354-4132-9a1f-24be3c3b78a0：输入 34177，缓存命中 0（只量，不承诺）
- 秘书线 5 轮；压缩记录 compacted/summary, compacted/summary, compacted/summary；触发 0.02、目标 0.01

## 附加格（八个场景之后的附加 Goal）

### C-216：pass

- observed-start（C-216）：pass。采用的架构模块路径：src/store.js, src/report.js, test
- adopted-done（C-216）：pass。Goal COMPLETED

### C-221：uncovered

- first-plan（C-221）：pass。首案采用 initial-plan-546826a108e5e6cfde6ee0fb9cf26947
- fail-rework（C-221）：uncovered (not-run)。没有同一 Task 上“检查轮 FAIL → 返工的新 Run → 检查轮 PASS”这条链（真实模型一次做对，不伪造失败）
- delivered（C-221）：pass。Goal COMPLETED

### C-222：pass

- created（C-222）：pass。secretaryCreated 的线：session-5ac008e519b4acdc8b537ba4618aa1c97fec8587ea779d7e841da785bb9cadf5
- started（C-222）：pass。建出的线上 Run：a06ed720-4b67-42ee-a153-600434351aa6/completed；Goal COMPLETED；null

## B06

### B06 关闭格：fail

- W1a（B06-W1a）：pass。witness PASS/matched；Task satisfied；Goal PAUSED；报告 518 字
- W2（B06-W2）：pass。witness FAIL；Task running
- W3（B06-W3）：fail。the platform did not do it: timed out after 40 min waiting for the w3 round
- W5（B06-W5）：uncovered (not-run)。stopped before this check: timed out after 40 min waiting for the w3 round
- W10（B06-W10）：uncovered (not-run)。stopped before this check: timed out after 40 min waiting for the w3 round
- W12（B06-W12）：pass。四段：task 有 → round 有 → evidence 2 → material keys reportText,roundRef,subjectRunRef
- explore（B06-cond3）：uncovered (not-run)。stopped before this check: timed out after 40 min waiting for the w3 round
- stopped: not-run: timed out after 40 min waiting for the w3 round
- g6-b06-w3-mwl6mm4c-122 (RUNNING): pause because B06 ended: committed
- B06 ended: after 30 min still Query 0, Work Run 1, Goals not paused none; cancelling what is left
- B06 ended: cancel 78567df0-8574-4bac-ac56-7b0600c05ad7: submit committed, deliver ready  

## 撞墙表

共 224 行（其中场景预期的拒绝 4 行），每次拒绝一行，原文见 `checks/notes.md`。

## 预算

- 上限：总量 400000000，每个场景/格 50000000（acceptance.config.json `tokenCaps`）。
- 口径：用量 = inputTokens + outputTokens（Kernel 的 inputTokens 已含缓存命中，cachedInputTokens 另记、不再相加）；每条按它所在项目的归属场景/格计，不按读到的时间。
- 合计：用量 60714462（输入 59926449，输出 788013；缓存命中 54193152）；Query 请求 579 次（含 Query 的压缩摘要请求，公开记录分不出）；结束的 Work Run 34 个，其中 0 个是公开证明的零（没进入 Kernel）；未知或不完整的用量不算零：已关闭 Query 里用量未知的请求按预留上限（输入预留 + 输出预留）计，只会多算；Work Run 的用量未知或不完整、或请求的预留读不到时，计量停下。
- 已知缺口：Work Run 的压缩摘要请求在另一个 Kernel Session 里跑，不在 `activity/runs` 里，计量少算了它们；驱动不读数据库补数（lead 裁定 11-14 #3）。400M/50M 上限远高于预期用量，这是记下的缺口，不是阻断。
- 最后一次完整读数时在途：Query 0，Work Run 0（Work Run 的用量要等 Run 结束才在 `activity/runs` 出现，所以超限后的停止点是第一次能看到超出的读数）。
- A1：用量 162627（输入 161797，输出 830，缓存命中 127616；Query 请求 6（其中按未计费 0 计的 1：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 0）
- B1：用量 88917（输入 87610，输出 1307，缓存命中 81536；Query 请求 6（其中按未计费 0 计的 1：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 0）
- E05：用量 8397028（输入 8338257，输出 58771，缓存命中 7601792；Query 请求 81（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 6）
- E06：用量 0（输入 0，输出 0，缓存命中 0；Query 请求 0（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 0）
- E08：用量 2583854（输入 2562314，输出 21540，缓存命中 2379648；Query 请求 24（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 4）
- E09：用量 11422272（输入 11347842，输出 74430，缓存命中 10425088；Query 请求 84（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 4）
- E12：用量 16366986（输入 16281565，输出 85421，缓存命中 15188608；Query 请求 92（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 4）
- iteration：用量 2039003（输入 1880755，输出 158248，缓存命中 1631360；Query 请求 39（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 1：Query 已关闭、用量未知），结束的 Run 1）
- intervention：用量 5228014（输入 5165190，输出 62824，缓存命中 4646272；Query 请求 65（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 5）
- waiting：用量 3120766（输入 3089867，输出 30899，缓存命中 2621056；Query 请求 29（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 2）
- C-216：用量 2374689（输入 2209799，输出 164890，缓存命中 1872896；Query 请求 31（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 1：Query 已关闭、用量未知），结束的 Run 1）
- C-221：用量 4411896（输入 4370803，输出 41093，缓存命中 3838208；Query 请求 45（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 2）
- C-222：用量 1623714（输入 1604929，输出 18785，缓存命中 1384704；Query 请求 24（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 1）
- B06：用量 1595452（输入 1574364，输出 21088，缓存命中 1340544；Query 请求 25（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 4）
- compaction：用量 1299244（输入 1251357，输出 47887，缓存命中 1053824；Query 请求 28（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 0）

## 延迟探针（只记录）

- wa#0：p50 20.73 ms，p95 20.94 ms，max 339.48 ms（3866 个样本）；关闭方式 SIGINT, exit 0 after 40 ms
- wb#0：p50 20.74 ms，p95 20.96 ms，max 221.25 ms（3873 个样本）；关闭方式 SIGINT, exit 0 after 26 ms
- w-accept#0：p50 20.76 ms，p95 21.04 ms，max 1267.73 ms（188367 个样本）；关闭方式 SIGINT, exit 0 after 152 ms
- w-accept#1：p50 20.79 ms，p95 21.14 ms，max 2287.99 ms（535730 个样本）；关闭方式 SIGINT, exit 0 after 338 ms
- compaction#0：p50 20.23 ms，p95 21.05 ms，max 1051.72 ms（29203 个样本）；关闭方式 SIGINT, exit 0 after 63 ms

## 证据

- `result.json`：八行，字段照 `slice-9-SPEC.md:729-745`。
- `checks/http.jsonl`：每次 HTTP（只有成功的同一读口连续同样答复合成一行带 `repeat`；每次拒绝单独一行）；预算计量的成功读不逐条记，只计数。
- `checks/model-calls.jsonl`：从公开读口取的每次 Query 请求用量和每个结束的 Work Run 合计，带归属的场景/格（`unit`，按项目归属，不按读到的时间）。
- `checks/commands.txt`：驱动起的命令（Host 起停、git、provider 探测）和退出码。
- `checks/notes.md`：逐条判据、撞墙表、A/B、压缩、B06、预算、延迟探针。
