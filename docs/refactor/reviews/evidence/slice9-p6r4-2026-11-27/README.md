# 第 9 片真实验收（G6）2026-11-26

- 树：`979e7181e439bc0e975a83fea653ebca0ee1de0a`（有未提交改动）；运行号 `g6-2026-11-26-22be1e84`；2026-11-26T18:45:15.756Z → 2026-11-27T00:56:53.436Z。
- 授权原文（逐场景同样记在 result.json 的 `authorization`）：用户批准（2026-11-26 19:2x：“你可以现在开始补跑了，优先opencode，或者dsh”；窗口：“理论上来说，随时都可以，我现在这么规定持续到11.30日”；上限沿用决定 121-124、121-150）：G6 真实验收使用 DeepSeek-V4.1-Flash（provider 顺序：网关 smoke-flash 优先，不通时 smoke-deepseek，即 DSH 凭据里的 DeepSeek；A1/B1 用 smoke-deepseek）；每次补跑总量 4 亿 token、每个场景 5,000 万 token（输入含缓存命中 + 输出），超了就停；只在临时运行目录里建账本和工作区，不提交、不推送、不对外发东西。
- 令牌：wa#0: 已取得令牌；wb#0: 已取得令牌；w-accept#0: 已取得令牌；w-accept#1: 已取得令牌；w-accept#2: 已取得令牌；compaction#0: 已取得令牌。

## 八个场景：total=8 / pass=1 / fail=4 / uncovered=3

| 场景 | 判定 | C 行 | 未覆盖 |
|---|---|---|---|
| E05 | fail | C-182, C-183, C-185, C-71, C-73, C-191, C-208, C-217, C-218 | name-different: 名字不同、规则相同：报 (entry-missing); name-same: 名字相同、规则不同：不报 (entry-missing); temporary: 临时件在做完之前已收回（结束时没有计划外的未跟踪文件） (not-run); line-choice: 派工排除只读副本/等待/退役线并按六键排序 (not-run) |
| E06 | uncovered | C-75, C-135, C-106, C-194, C-149, C-151, C-68, C-181, C-209, C-219, C-223 | handoff: 模型 hand_off，人批准，出现接任线 (not-run); successor-input: 接任者实际输入（turn 输入）含目标词和前任 hand_off 的理由原文，不只同一 sessionId (not-run); successor-frontier: 接任者实际输入含前任的义务/前沿 (not-run); no-restatement: 换手后用户没有重述任务 (not-run); excluded-path: 接任者引用当前理解并避开已排除路径 (not-run); same-task-new-run: 同一 Task 新开 Attempt/Run 优先原 Session，带接续说明 (not-run); history-continuity: 后续输入真正含必要前文（不只同一 Session ID） (not-run); restart-running: Work Run 在跑时正常关闭重启：记被中断，继续在原 Session (not-run); restart-paused: 暂停中重启：不算失败，可继续，恢复后在原线接着做 (not-run); archive: 归档前任后源线历史可读（sessions/history、executions/history） (not-run); hand-or-drop: 归档有未完成任务的线：先选交给或放下，同时释放责任与席位 (not-run); wake: 答卡等提交叫醒目标驱动，后继 Run 真的启动 (not-run) |
| E08 | fail | C-47, C-62, C-63, C-133a, C-126, C-46, C-52, C-116, C-118, C-210 | hold-before-adopt: 从说“不要 sub”到采用之前：sub 有秘书放的暂缓（没过期），没有新 Run（只读，驱动不撤） (not-run); switch: 受影响任务切到新定义（出现 div 任务，sub 被取消），无关任务继续（mul）；采用版本的取消记录写明 sub→cancelled、采用版本和人 (not-run); old-evidence: 旧证据不满足新义务：div 的义务要求只由改后计划下、div 自己改后 Run 的检查轮覆盖 (not-run); required-cancel: required 取消后不因空集合变绿（div 满足之前 Goal 不完成） (not-run); autonomy-later: 改自治级别只影响之后的动作，不停正在跑的工作 (not-run) |
| E09 | uncovered | C-185, C-89, C-65, C-98, C-93, C-95, C-99, C-55, C-62, C-211, C-212, C-218 | adviser-explains: 参谋解释具体对象和影响（最终答复，或 ask_person / notify_person 的正文） (not-run); person-decides: 人的决定有授权与版本（人提交的答卡，钉住 Goal 版本） (not-run); new-version: 新计划版本替换受影响任务，新定义进上下文 (not-run); report-after-dispatch: 同目标另有一次派活落实后，执行者的上报仍送到参谋（不因版本拒收） (not-run); diagnosis-reverify: （可选）对方的诊断（有答复的询问）实际成为重验的依据（verification/round 的 reverify.newInputRefs） (not-run); uncovered-round: 没有覆盖必需要求的检查时读作 INCONCLUSIVE，不以空集合 PASS (not-run) |
| E12 | fail | C-36, C-42, C-157, C-88, C-89, C-104, C-145, C-146, C-158, C-147, C-155, C-207, C-114, C-215, C-220 | history-reuse: 重启后的相关新工作实际查询了已完成工作，结果带来源（旧 Goal/Run 的引用） (not-run); stale-premise: 保留适用范围，过期前提不升级 (not-run); wait-registry: 目标等待登记表启动时只读重建 (not-run) |
| iteration | pass | C-108, C-109, C-110, C-111, C-112, C-105, C-107, C-113, C-194, C-213, C-226 | - |
| intervention | fail | C-199, C-200, C-201, C-202, C-203, C-114, C-189, C-192, C-197, C-198 | claim-once: 空闲线上有未完成任务：直接干预领一次（送进因它新开的 Run，这条线上这个任务只新增 1 个 Run，不开规划） (not-run); four-endings: 四种收尾（反问/非法/没答/放弃）各落到通知、回复或撤回，不静默 (not-run); review-packet: 直接干预的原话进入这个目标的执行审阅包（execreview） (not-run); completed-goal: 已完成 Goal 上加工作，先确认成新 Goal，原完成不变 (not-run) |
| waiting | uncovered | C-170, C-171, C-187, C-188, C-190, C-172, C-184, C-189, C-192, C-195, C-196, C-207, C-224, C-225 | second-expiry: 同一追问链第二次实际到期，后继输入写“第 2 次到期” (not-run); late-reply: 迟回保存为下一个安全点的新输入，不重开旧等待 (not-run); transfer: 转交保留问题和期限，未送达不自动换人 (env-unavailable); disconnect: 等待的一侧归档后 decisions/queue 出这条等待的 disconnect 项，Host 给两侧各发 notify (env-unavailable); supply-order: 供给按冻结顺序：人的消息、续作、agent 消息 (not-run) |

每行的逐条判据、证据和原因见 `checks/notes.md`；没跑到的判据记 `uncovered`，不因场景其余判据通过而通过。

## A/B 两格（不进 result.json）

### A1（1M → 131072）：pass

- reserved（C-214）：pass。reservedOutput 131072（requestId 19833626-e5eb-4ae4-89c0-1b2fab2b54c2）
- usage（C-214）：pass。usageStatus reported，输入 34890，输出 106，缓存命中 32384
- accepted（C-214）：pass。请求被接受（用量已报）
- not-truncated（C-214）：pass。输出 106 < 预留 131072；close detail none
- driver-start: ready running
- 请求事实：[{"requestId":"19833626-e5eb-4ae4-89c0-1b2fab2b54c2","reservedOutput":131072,"usageStatus":"reported","inputTokens":34890,"outputTokens":106,"cachedInputTokens":32384},{"requestId":"83cc96c1-7c1c-47fe-9a60-c0a8aa303096","reservedOutput":131072,"usageStatus":"reserved","inputTokens":null,"outputTokens":null,"cachedInputTokens":null}]；Query running；close null；profile 累计输出上限 null = 不设上限
- queries/cancel after the first request: ready stopping
- request 83cc96c1-7c1c-47fe-9a60-c0a8aa303096: cut by the driver's cancel; usage not reported, at most one request (Query closed, close cancelled)

### B1（128k → 64000）：pass

- reserved（C-214）：pass。reservedOutput 64000（requestId 46cf552d-d002-4282-bf02-5c740af02889）
- usage（C-214）：pass。usageStatus reported，输入 12982，输出 182，缓存命中 10752
- accepted（C-214）：pass。请求被接受（用量已报）
- not-truncated（C-214）：pass。输出 182 < 预留 64000；close detail none
- fits（C-214）：pass。请求发出（reservedInput 以内），reservedOutput 64000
- driver-start: ready running
- 请求事实：[{"requestId":"46cf552d-d002-4282-bf02-5c740af02889","reservedOutput":64000,"usageStatus":"reported","inputTokens":12982,"outputTokens":182,"cachedInputTokens":10752},{"requestId":"c2b78cd5-dff3-4b10-944a-d45926e219d3","reservedOutput":63818,"usageStatus":"reserved","inputTokens":null,"outputTokens":null,"cachedInputTokens":null}]；Query running；close null；profile 累计输出上限 64000
- queries/cancel after the first request: ready stopping
- request c2b78cd5-dff3-4b10-944a-d45926e219d3: cut by the driver's cancel; usage not reported, at most one request (Query closed, close cancelled)

## 压缩场景（单列，不算第 9 个场景）

### 压缩：pass

- compacted（K2-P2）：pass。context_compacted 3 条（kernhist1.eyJ2IjoxLCJwIjp7InByb2plY3RJZCI6IjhkYjk1NDBmMTc4ODNmOTA1MDc0MTQ1MzA0MjNkYmUzIiwic2Vzc2lvbklkIjoic2Vzc2lvbi0xNzNmYjY4ZWI2ZjlhYzZlYmQ3YzQ0OTRhMDE0M2EzYmMyNzFkYWFhZGVkOTczMzM2Mjk3MDllODYxY2Y0ZmI0In0sImEiOiJob3N0LXNldHRpbmdzLWtlcm5lbC03NzJhNWYwODg2ZTg0Y2ZiYWQ1NDAxNDNlODA5MjkwYyIsImsiOiJzZXNzaW9uLTE3M2ZiNjhlYjZmOWFjNmViZDdjNDQ5NGEwMTQzYTNiYzI3MWRhYWFkZWQ5NzMzMzYyOTcwOWU4NjFjZjRmYjQiLCJyIjoie1wiYWN0b3JcIjp7XCJpZFwiOlwiZzYtcGVyc29uXCIsXCJraW5kXCI6XCJodW1hblwifSxcImtpbmRcIjpcImhvc3RcIn0iLCJ1Ijo5NywibCI6MSwiaSI6NTR9:summary, kernhist1.eyJ2IjoxLCJwIjp7InByb2plY3RJZCI6IjhkYjk1NDBmMTc4ODNmOTA1MDc0MTQ1MzA0MjNkYmUzIiwic2Vzc2lvbklkIjoic2Vzc2lvbi0xNzNmYjY4ZWI2ZjlhYzZlYmQ3YzQ0OTRhMDE0M2EzYmMyNzFkYWFhZGVkOTczMzM2Mjk3MDllODYxY2Y0ZmI0In0sImEiOiJob3N0LXNldHRpbmdzLWtlcm5lbC03NzJhNWYwODg2ZTg0Y2ZiYWQ1NDAxNDNlODA5MjkwYyIsImsiOiJzZXNzaW9uLTE3M2ZiNjhlYjZmOWFjNmViZDdjNDQ5NGEwMTQzYTNiYzI3MWRhYWFkZWQ5NzMzMzYyOTcwOWU4NjFjZjRmYjQiLCJyIjoie1wiYWN0b3JcIjp7XCJpZFwiOlwiZzYtcGVyc29uXCIsXCJraW5kXCI6XCJodW1hblwifSxcImtpbmRcIjpcImhvc3RcIn0iLCJ1Ijo5NywibCI6MSwiaSI6NzJ9:summary, kernhist1.eyJ2IjoxLCJwIjp7InByb2plY3RJZCI6IjhkYjk1NDBmMTc4ODNmOTA1MDc0MTQ1MzA0MjNkYmUzIiwic2Vzc2lvbklkIjoic2Vzc2lvbi0xNzNmYjY4ZWI2ZjlhYzZlYmQ3YzQ0OTRhMDE0M2EzYmMyNzFkYWFhZGVkOTczMzM2Mjk3MDllODYxY2Y0ZmI0In0sImEiOiJob3N0LXNldHRpbmdzLWtlcm5lbC03NzJhNWYwODg2ZTg0Y2ZiYWQ1NDAxNDNlODA5MjkwYyIsImsiOiJzZXNzaW9uLTE3M2ZiNjhlYjZmOWFjNmViZDdjNDQ5NGEwMTQzYTNiYzI3MWRhYWFkZWQ5NzMzMzYyOTcwOWU4NjFjZjRmYjQiLCJyIjoie1wiYWN0b3JcIjp7XCJpZFwiOlwiZzYtcGVyc29uXCIsXCJraW5kXCI6XCJodW1hblwifSxcImtpbmRcIjpcImhvc3RcIn0iLCJ1Ijo5NywibCI6MSwiaSI6ODR9:summary）
- six-sections（K2-P2）：pass。摘要（kernhist1.eyJ2IjoxLCJwIjp7InByb2plY3RJZCI6IjhkYjk1NDBmMTc4ODNmOTA1MDc0MTQ1MzA0MjNkYmUzIiwic2Vzc2lvbklkIjoic2Vzc2lvbi0xNzNmYjY4ZWI2ZjlhYzZlYmQ3YzQ0OTRhMDE0M2EzYmMyNzFkYWFhZGVkOTczMzM2Mjk3MDllODYxY2Y0ZmI0In0sImEiOiJob3N0LXNldHRpbmdzLWtlcm5lbC03NzJhNWYwODg2ZTg0Y2ZiYWQ1NDAxNDNlODA5MjkwYyIsImsiOiJzZXNzaW9uLTE3M2ZiNjhlYjZmOWFjNmViZDdjNDQ5NGEwMTQzYTNiYzI3MWRhYWFkZWQ5NzMzMzYyOTcwOWU4NjFjZjRmYjQiLCJyIjoie1wiYWN0b3JcIjp7XCJpZFwiOlwiZzYtcGVyc29uXCIsXCJraW5kXCI6XCJodW1hblwifSxcImtpbmRcIjpcImhvc3RcIn0iLCJ1Ijo5NywibCI6MSwiaSI6NTR9）2602 字；缺的段：无
- accepted（K2-P2）：pass。摘要后第一次请求 a2ed8227-9078-40e9-96d7-d47d34ea2e14：usage reported（那一轮之后 closed，close invalid_answer，另记）
- cache-after（K2-P2）：pass。摘要后第一次请求 a2ed8227-9078-40e9-96d7-d47d34ea2e14：输入 35025，缓存命中 0（只量，不承诺）
- 秘书线 5 轮；压缩记录 compacted/summary, compacted/summary, compacted/summary；触发 0.02、目标 0.01

## 附加格（八个场景之后的附加 Goal）

### C-216：fail

- observed-start（C-216）：fail。采用的架构模块路径：无
- adopted-done（C-216）：pass。Goal COMPLETED
- cold start: round c1ea8b37-a6c6-4a37-8801-53bc4ad8bf04 asked the person questions (needs_decision) instead of a plan; the person answered on the request

### C-221：uncovered

- first-plan（C-221）：pass。首案采用 initial-plan-82d23180f7228844c3420d26e7cb120e
- fail-rework（C-221）：uncovered (not-run)。没有同一 Task 上“检查轮 FAIL → 返工的新 Run → 检查轮 PASS”这条链（真实模型一次做对，不伪造失败）
- delivered（C-221）：pass。Goal COMPLETED

### C-222：pass

- created（C-222）：pass。secretaryCreated 的线：session-dc9bdd19c9961ddaab33f550d70b480f2257ea80ee7883768b90c61d5e961946
- started（C-222）：pass。建出的线上 Run：1496baf5-5b9c-4341-a103-f1455abe07f4/completed；Goal COMPLETED；null

## B06

### B06 关闭格：pass

- W1a（B06-W1a）：pass。witness PASS/matched；Task satisfied；Goal PAUSED；报告 633 字
- W2（B06-W2）：pass。witness FAIL；Task running
- W3（B06-W3）：pass。witness FAIL；Task failed
- W5（B06-W5）：pass。非 Git：witness INCONCLUSIVE/matched；Task blocked
- W10（B06-W10）：pass。witness PASS，witness 要求由 platform:witness 覆盖：true；reviewer 要求 pass，覆盖它的检查 无（由独立审阅回答）；Task satisfied
- W12（B06-W12）：pass。四段：task 有 → round 有 → evidence 2 → material keys reportText,roundRef,subjectRunRef
- explore（B06-cond3）：pass。没写 witness 要求的 explore：计划被收下，轮 finalized，没有 platform:witness 检查
- cancel 1f12e883-8156-47ab-b640-b1a4b67d27bf: submit committed, deliver ready  
- B06-W1b、W4、W6、W8、W11、W13 和条件 1 引 B06 G2 的绿测（f580d77e，决定 121-122），G6 不重跑；第 9 片审阅的通过不写成 B06 通过。

## E08b（P6：方案确认后自动、sub 已在跑）

### E08b：fail

- sub-running（C-210）：pass。提交改需求时 sub（t-sub）的 Run 2d517159-1a80-4834-964c-36e59ba26c44 正在跑（开始于 2026-11-27T00:52:37.064Z）
- stop-delivered（C-210）：uncovered (not-run)。秘书没有对 sub 发 request_stop（skill-platform-secretary.txt:32-33 的配方），叫停这一支没走到；任务卡 stop.steps：无；请求 无
- safe-point-end（C-210）：uncovered (not-run)。没有叫停请求，“安全点收尾”无从观察；sub 的 Run completed @ 2026-11-27T00:52:51.459Z；采用时 busy 0 次
- adopt-after-end（C-210）：fail。sub 的 Run 结束 2026-11-27T00:52:51.459Z；采用 initial-plan-6f577aad01998b9c335cffe1c5e92c7c @ 2026-11-27T00:54:15.227Z（人 plans/apply，busy 0 次）；采用版本的 dispositionRecord 里没有 sub 的记录
- the person selected idea 1 of 3 on the change: 按原话改：sub 取消，加 div + div.test.js（推荐）
- 采用前：叫停请求 无；任务卡上的步骤 无；sub 的 Run 已结束 2026-11-27T00:52:51.459Z（completed）
- goal-confirm:goal.confirmDraft:355b05b85d0c8c3866ddb4e8608272ed0175202596fb352a25e08a1d179da2d4 (RUNNING): pause because E08b ended: committed

## 撞墙表

共 132 行（其中场景预期的拒绝 4 行），每次拒绝一行，原文见 `checks/notes.md`。
P6 要记的三类（按原句匹配，裁定 Q10）：派工版本拒绝 0 次，问答轮发不出 0 次，注记读口 0 次。

## 预算

- 上限：总量 400000000，每个场景/格 50000000（acceptance.config.json `tokenCaps`）。
- 口径：用量 = inputTokens + outputTokens（Kernel 的 inputTokens 已含缓存命中，cachedInputTokens 另记、不再相加）；每条按它所在项目的归属场景/格计，不按读到的时间。
- 合计：用量 34302597（输入 33932710，输出 369887；缓存命中 29611392）；Query 请求 506 次（含 Query 的压缩摘要请求，公开记录分不出）；结束的 Work Run 39 个，其中 0 个是公开证明的零（没进入 Kernel）；未知或不完整的用量不算零：已关闭 Query 里用量未知的请求按预留上限（输入预留 + 输出预留）计，只会多算；Work Run 的用量未知或不完整、或请求的预留读不到时，计量停下。
- 已知缺口：Work Run 的压缩摘要请求在另一个 Kernel Session 里跑，不在 `activity/runs` 里，计量少算了它们；驱动不读数据库补数（lead 裁定 11-14 #3）。400M/50M 上限远高于预期用量，这是记下的缺口，不是阻断。
- 最后一次完整读数时在途：Query 0，Work Run 0（Work Run 的用量要等 Run 结束才在 `activity/runs` 出现，所以超限后的停止点是第一次能看到超出的读数）。
- 实报输入（平台报了用量的部分，不含按预留上限计的和未计费 0）：33803019；估算部分 129691。
- 超预算退出：整轮 没有；按场景/格 没有。
- A1：用量 34996（输入 34890，输出 106，缓存命中 32384；Query 请求 2（其中按未计费 0 计的 1：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 0；实报输入 34890）
- B1：用量 13164（输入 12982，输出 182，缓存命中 10752；Query 请求 2（其中按未计费 0 计的 1：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 0；实报输入 12982）
- E05：用量 9734208（输入 9667383，输出 66825，缓存命中 8408064；Query 请求 128（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 6；实报输入 9667383）
- E06：用量 0（输入 0，输出 0，缓存命中 0；Query 请求 0（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 0；实报输入 0）
- E08：用量 827821（输入 816849，输出 10972，缓存命中 650240；Query 请求 15（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 1；实报输入 816849）
- E09：用量 6865176（输入 6799660，输出 65516，缓存命中 6216576；Query 请求 104（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 2；实报输入 6799660）
- E12：用量 1567860（输入 1551385，输出 16475，缓存命中 1267072；Query 请求 20（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 2；实报输入 1551385）
- iteration：用量 1541122（输入 1517624，输出 23498，缓存命中 1263744；Query 请求 27（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 1；实报输入 1517624）
- intervention：用量 2781216（输入 2746702，输出 34514，缓存命中 2437248；Query 请求 44（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 4；实报输入 2746702）
- waiting：用量 2474681（输入 2437485，输出 37196，缓存命中 2116864；Query 请求 29（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 1：Query 已关闭、用量未知），结束的 Run 7；实报输入 2387035）
- C-216：用量 1674771（输入 1648742，输出 26029，缓存命中 1445504；Query 请求 33（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 1；实报输入 1648742）
- C-221：用量 1190047（输入 1173929，输出 16118，缓存命中 1036800；Query 请求 11（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 2；实报输入 1173929）
- C-222：用量 650565（输入 643958，输出 6607，缓存命中 529664；Query 请求 11（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 1；实报输入 643958）
- B06：用量 2294697（输入 2273822，输出 20875，缓存命中 1970688；Query 请求 36（其中按未计费 0 计的 1：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 10；实报输入 2194581）
- E08b：用量 2006959（输入 1976813，输出 30146，缓存命中 1757440；Query 请求 27（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 2；实报输入 1976813）
- compaction：用量 645314（输入 630486，输出 14828，缓存命中 468352；Query 请求 17（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 0；实报输入 630486）
- P6 记账：模型调用 678 次（公开原历史里 `model.request_started` 的条数，含 Work Run；压缩摘要的请求在另一个 Kernel Session 里，数不到，照旧记作缺口）；叫醒轮（intervention-planning）36 个，其中只回“收到”的 3 个（成功的工具调用只有读类和答复，且答复的都不是要回复的信，没交候选、没发信、没出卡；裁定 Q11、lead 11-25 #31，只计数不判；回复对象读不到的照旧计数，见其它记录）。
- A1：模型调用 2，叫醒轮 1，只回收到 1
- B1：模型调用 2，叫醒轮 1，只回收到 0
- E05：模型调用 167，叫醒轮 13，只回收到 1
- E08：模型调用 23，叫醒轮 1，只回收到 0
- E09：模型调用 80，叫醒轮 2，只回收到 0
- E12：模型调用 39，叫醒轮 1，只回收到 0
- iteration：模型调用 33，叫醒轮 1，只回收到 0
- intervention：模型调用 65，叫醒轮 4，只回收到 0
- waiting：模型调用 55，叫醒轮 5，只回收到 1
- C-216：模型调用 38，叫醒轮 1，只回收到 0
- C-221：模型调用 33，叫醒轮 1，只回收到 0
- C-222：模型调用 19，叫醒轮 1，只回收到 0
- B06：模型调用 64，叫醒轮 3，只回收到 0
- E08b：模型调用 44，叫醒轮 1，只回收到 0
- compaction：模型调用 14，叫醒轮 0，只回收到 0

## 延迟探针（只记录）

- wa#0：p50 20.22 ms，p95 21 ms，max 560.99 ms（3463 个样本）；关闭方式 SIGINT, exit 0 after 96 ms
- wb#0：p50 20.22 ms，p95 21.18 ms，max 446.69 ms（3462 个样本）；关闭方式 SIGINT, exit 0 after 48 ms
- w-accept#0：p50 20.23 ms，p95 21.09 ms，max 3191.87 ms（75422 个样本）；关闭方式 SIGINT, exit 0 after 356 ms
- w-accept#1：p50 20.35 ms，p95 21.27 ms，max 674.23 ms（768389 个样本）；关闭方式 SIGINT, exit 0 after 291 ms
- w-accept#2：p50 21.09 ms，p95 21.48 ms，max 719.32 ms（237854 个样本）；关闭方式 SIGINT, exit 0 after 262 ms
- compaction#0：p50 21.1 ms，p95 21.58 ms，max 469.76 ms（7578 个样本）；关闭方式 SIGINT, exit 0 after 54 ms

## 证据

- `result.json`：八行，字段照 `slice-9-SPEC.md:729-745`。
- `checks/http.jsonl`：每次 HTTP（只有成功的同一读口连续同样答复合成一行带 `repeat`；每次拒绝单独一行）；预算计量的成功读不逐条记，只计数。
- `checks/model-calls.jsonl`：从公开读口取的每次 Query 请求用量和每个结束的 Work Run 合计，带归属的场景/格（`unit`，按项目归属，不按读到的时间）。
- `checks/commands.txt`：驱动起的命令（Host 起停、git、provider 探测）和退出码。
- `checks/notes.md`：逐条判据、撞墙表、A/B、压缩、B06、预算、延迟探针。
