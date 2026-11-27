# 第 9 片真实验收（G6）2026-11-27

- 树：`25ee79c78eeadc89b067d89411e4428b5597df21`（有未提交改动）；运行号 `g6-2026-11-27-a48b8779`；2026-11-27T01:56:38.133Z → 2026-11-27T05:59:31.483Z。
- 授权原文（逐场景同样记在 result.json 的 `authorization`）：用户批准（2026-11-26 19:2x：“你可以现在开始补跑了，优先opencode，或者dsh”；窗口：“理论上来说，随时都可以，我现在这么规定持续到11.30日”；上限沿用决定 121-124、121-150）：G6 真实验收使用 DeepSeek-V4.1-Flash（provider 顺序：网关 smoke-flash 优先，不通时 smoke-deepseek，即 DSH 凭据里的 DeepSeek；A1/B1 用 smoke-deepseek）；每次补跑总量 4 亿 token、每个场景 5,000 万 token（输入含缓存命中 + 输出），超了就停；只在临时运行目录里建账本和工作区，不提交、不推送、不对外发东西。
- 令牌：wa#0: 已取得令牌；wb#0: 已取得令牌；w-accept#0: 已取得令牌；w-accept#1: 已取得令牌；w-accept#2: 已取得令牌；w-accept#3: 已取得令牌；w-accept#4: 已取得令牌；compaction#0: 已取得令牌。

## 八个场景：total=8 / pass=0 / fail=7 / uncovered=1

| 场景 | 判定 | C 行 | 未覆盖 |
|---|---|---|---|
| E05 | fail | C-182, C-183, C-185, C-71, C-73, C-191, C-208, C-217, C-218 | overlap: 两个 Run 的 startedAt/endedAt 真实重叠，claim Session 不同 (entry-missing); temporary: 临时件在做完之前已收回（结束时没有计划外的未跟踪文件） (not-run); line-choice: 派工排除只读副本/等待/退役线并按六键排序 (not-run) |
| E06 | fail | C-75, C-135, C-106, C-194, C-149, C-151, C-68, C-181, C-209, C-219, C-223 | successor-frontier: 接任者实际输入含前任的义务/前沿 (entry-missing); archive: 归档前任后源线历史可读（sessions/history、executions/history） (not-run); hand-or-drop: 归档有未完成任务的线：先选交给或放下，同时释放责任与席位 (not-run) |
| E08 | fail | C-47, C-62, C-63, C-133a, C-126, C-46, C-52, C-116, C-118, C-210 | hold-before-adopt: 从说“不要 sub”到采用之前：sub 有秘书放的暂缓（没过期），没有新 Run（只读，驱动不撤） (not-run); required-cancel: required 取消后不因空集合变绿（div 满足之前 Goal 不完成） (not-run); autonomy-later: 改自治级别只影响之后的动作，不停正在跑的工作 (not-run) |
| E09 | uncovered | C-185, C-89, C-65, C-98, C-93, C-95, C-99, C-55, C-62, C-211, C-212, C-218 | new-version: 新计划版本替换受影响任务，新定义进上下文 (not-run); report-after-dispatch: 同目标另有一次派活落实后，执行者的上报仍送到参谋（不因版本拒收） (not-run); diagnosis-reverify: （可选）对方的诊断（有答复的询问）实际成为重验的依据（verification/round 的 reverify.newInputRefs） (not-run); uncovered-round: 没有覆盖必需要求的检查时读作 INCONCLUSIVE，不以空集合 PASS (not-run) |
| E12 | fail | C-36, C-42, C-157, C-88, C-89, C-104, C-145, C-146, C-158, C-147, C-155, C-207, C-114, C-215, C-220 | history-reuse: 重启后的相关新工作实际查询了已完成工作，结果带来源（旧 Goal/Run 的引用） (not-run); stale-premise: 保留适用范围，过期前提不升级 (entry-missing); wait-registry: 目标等待登记表启动时只读重建 (entry-missing) |
| iteration | fail | C-108, C-109, C-110, C-111, C-112, C-105, C-107, C-113, C-194, C-213, C-226 | - |
| intervention | fail | C-199, C-200, C-201, C-202, C-203, C-114, C-189, C-192, C-197, C-198 | four-endings: 四种收尾（反问/非法/没答/放弃）各落到通知、回复或撤回，不静默 (entry-missing); review-packet: 直接干预的原话进入这个目标的执行审阅包（execreview） (not-run); completed-goal: 已完成 Goal 上加工作，先确认成新 Goal，原完成不变 (not-run) |
| waiting | fail | C-170, C-171, C-187, C-188, C-190, C-172, C-184, C-189, C-192, C-195, C-196, C-207, C-224, C-225 | restart-kept: 正常关闭重启后仍核对原等待（同一 messageRef、收信人、期限），接续的 Run 消费这条等待（expiry/wait_reply，originalRun 是原 Run，在成员线上） (not-run); second-expiry: 同一追问链第二次实际到期，后继输入写“第 2 次到期” (env-unavailable); consumes: 真实接受才 consumesWait:true；迟到的普通回复写 false (not-run); late-reply: 迟回保存为下一个安全点的新输入，不重开旧等待 (env-unavailable); reply-first: 回复抢先：第二个问题到期前收到回复，由回复的接受消费等待（consumesWait:true），不记到期 (not-run); transfer: 转交保留问题和期限，未送达不自动换人 (not-run); disconnect: 等待的一侧归档后 decisions/queue 出这条等待的 disconnect 项，Host 给两侧各发 notify (not-run); supply-order: 供给按冻结顺序：人的消息、续作、agent 消息 (not-run) |

每行的逐条判据、证据和原因见 `checks/notes.md`；没跑到的判据记 `uncovered`，不因场景其余判据通过而通过。

## A/B 两格（不进 result.json）

### A1（1M → 131072）：pass

- reserved（C-214）：pass。reservedOutput 131072（requestId 61895469-ac5e-434e-b473-b11840d5f05d）
- usage（C-214）：pass。usageStatus reported，输入 32615，输出 94，缓存命中 384
- accepted（C-214）：pass。请求被接受（用量已报）
- not-truncated（C-214）：pass。输出 94 < 预留 131072；close detail none
- driver-start: ready running
- 请求事实：[{"requestId":"61895469-ac5e-434e-b473-b11840d5f05d","reservedOutput":131072,"usageStatus":"reported","inputTokens":32615,"outputTokens":94,"cachedInputTokens":384},{"requestId":"4567e294-9673-454a-a5c6-c14fe1226b93","reservedOutput":131072,"usageStatus":"reserved","inputTokens":null,"outputTokens":null,"cachedInputTokens":null}]；Query running；close null；profile 累计输出上限 null = 不设上限
- queries/cancel after the first request: ready stopping
- request 4567e294-9673-454a-a5c6-c14fe1226b93: cut by the driver's cancel; usage not reported, at most one request (Query closed, close cancelled)

### B1（128k → 64000）：pass

- reserved（C-214）：pass。reservedOutput 64000（requestId 56bd4285-5bad-4352-ba75-48315077ce45）
- usage（C-214）：pass。usageStatus reported，输入 12865，输出 130，缓存命中 10752
- accepted（C-214）：pass。请求被接受（用量已报）
- not-truncated（C-214）：pass。输出 130 < 预留 64000；close detail none
- fits（C-214）：pass。请求发出（reservedInput 以内），reservedOutput 64000
- driver-start: ready running
- 请求事实：[{"requestId":"56bd4285-5bad-4352-ba75-48315077ce45","reservedOutput":64000,"usageStatus":"reported","inputTokens":12865,"outputTokens":130,"cachedInputTokens":10752},{"requestId":"1635ab21-e9fc-4c7f-88cd-ea6637c163b2","reservedOutput":63870,"usageStatus":"reported","inputTokens":13903,"outputTokens":93,"cachedInputTokens":12928},{"requestId":"90cb02b8-28a4-4777-879f-784e8e63d2bf","reservedOutput":63777,"usageStatus":"reported","inputTokens":14370,"outputTokens":125,"cachedInputTokens":13952},{"requestId":"0f4f68f8-68d6-492f-8e82-e1d39391e163","reservedOutput":63652,"usageStatus":"reported","inputTokens":15004,"outputTokens":159,"cachedInputTokens":14464},{"requestId":"0c03a560-acd8-425d-b632-6da9e5043bf2","reservedOutput":63493,"usageStatus":"reported","inputTokens":15608,"outputTokens":124,"cachedInputTokens":15104},{"requestId":"5aa96f46-b821-476d-8d5f-d18934470ba2","reservedOutput":63369,"usageStatus":"reported","inputTokens":15859,"outputTokens":41,"cachedInputTokens":15616},{"requestId":"e8545db7-9438-46ce-915e-08f45f286564","reservedOutput":63328,"usageStatus":"reserved","inputTokens":null,"outputTokens":null,"cachedInputTokens":null}]；Query running；close null；profile 累计输出上限 64000
- queries/cancel after the first request: ready stopping
- request e8545db7-9438-46ce-915e-08f45f286564: cut by the driver's cancel; usage not reported, at most one request (Query closed, close cancelled)

## 压缩场景（单列，不算第 9 个场景）

### 压缩：pass

- compacted（K2-P2）：pass。context_compacted 3 条（kernhist1.eyJ2IjoxLCJwIjp7InByb2plY3RJZCI6IjA4ODVlMzhlNmM5NTA0YTQ4ZTBhYWFhMzZjM2UzOWY0Iiwic2Vzc2lvbklkIjoic2Vzc2lvbi1hNzk2MTc4NDAzYjc3OWUyZjU5NDA3YWI1YTkyY2MwOTFkODE3MDk1YjVkMjk4ZGQxZDIxZDRkZjA5YjkzZDExIn0sImEiOiJob3N0LXNldHRpbmdzLWtlcm5lbC1kZWU5ZWNjMmI5YzBjMWE4ZmFkNjA1MjI0OTdkMWVlYSIsImsiOiJzZXNzaW9uLWE3OTYxNzg0MDNiNzc5ZTJmNTk0MDdhYjVhOTJjYzA5MWQ4MTcwOTViNWQyOThkZDFkMjFkNGRmMDliOTNkMTEiLCJyIjoie1wiYWN0b3JcIjp7XCJpZFwiOlwiZzYtcGVyc29uXCIsXCJraW5kXCI6XCJodW1hblwifSxcImtpbmRcIjpcImhvc3RcIn0iLCJ1IjoxMTksImwiOjEsImkiOjUyfQ:summary, kernhist1.eyJ2IjoxLCJwIjp7InByb2plY3RJZCI6IjA4ODVlMzhlNmM5NTA0YTQ4ZTBhYWFhMzZjM2UzOWY0Iiwic2Vzc2lvbklkIjoic2Vzc2lvbi1hNzk2MTc4NDAzYjc3OWUyZjU5NDA3YWI1YTkyY2MwOTFkODE3MDk1YjVkMjk4ZGQxZDIxZDRkZjA5YjkzZDExIn0sImEiOiJob3N0LXNldHRpbmdzLWtlcm5lbC1kZWU5ZWNjMmI5YzBjMWE4ZmFkNjA1MjI0OTdkMWVlYSIsImsiOiJzZXNzaW9uLWE3OTYxNzg0MDNiNzc5ZTJmNTk0MDdhYjVhOTJjYzA5MWQ4MTcwOTViNWQyOThkZDFkMjFkNGRmMDliOTNkMTEiLCJyIjoie1wiYWN0b3JcIjp7XCJpZFwiOlwiZzYtcGVyc29uXCIsXCJraW5kXCI6XCJodW1hblwifSxcImtpbmRcIjpcImhvc3RcIn0iLCJ1IjoxMTksImwiOjEsImkiOjgwfQ:summary, kernhist1.eyJ2IjoxLCJwIjp7InByb2plY3RJZCI6IjA4ODVlMzhlNmM5NTA0YTQ4ZTBhYWFhMzZjM2UzOWY0Iiwic2Vzc2lvbklkIjoic2Vzc2lvbi1hNzk2MTc4NDAzYjc3OWUyZjU5NDA3YWI1YTkyY2MwOTFkODE3MDk1YjVkMjk4ZGQxZDIxZDRkZjA5YjkzZDExIn0sImEiOiJob3N0LXNldHRpbmdzLWtlcm5lbC1kZWU5ZWNjMmI5YzBjMWE4ZmFkNjA1MjI0OTdkMWVlYSIsImsiOiJzZXNzaW9uLWE3OTYxNzg0MDNiNzc5ZTJmNTk0MDdhYjVhOTJjYzA5MWQ4MTcwOTViNWQyOThkZDFkMjFkNGRmMDliOTNkMTEiLCJyIjoie1wiYWN0b3JcIjp7XCJpZFwiOlwiZzYtcGVyc29uXCIsXCJraW5kXCI6XCJodW1hblwifSxcImtpbmRcIjpcImhvc3RcIn0iLCJ1IjoxMTksImwiOjEsImkiOjk5fQ:summary）
- six-sections（K2-P2）：pass。摘要（kernhist1.eyJ2IjoxLCJwIjp7InByb2plY3RJZCI6IjA4ODVlMzhlNmM5NTA0YTQ4ZTBhYWFhMzZjM2UzOWY0Iiwic2Vzc2lvbklkIjoic2Vzc2lvbi1hNzk2MTc4NDAzYjc3OWUyZjU5NDA3YWI1YTkyY2MwOTFkODE3MDk1YjVkMjk4ZGQxZDIxZDRkZjA5YjkzZDExIn0sImEiOiJob3N0LXNldHRpbmdzLWtlcm5lbC1kZWU5ZWNjMmI5YzBjMWE4ZmFkNjA1MjI0OTdkMWVlYSIsImsiOiJzZXNzaW9uLWE3OTYxNzg0MDNiNzc5ZTJmNTk0MDdhYjVhOTJjYzA5MWQ4MTcwOTViNWQyOThkZDFkMjFkNGRmMDliOTNkMTEiLCJyIjoie1wiYWN0b3JcIjp7XCJpZFwiOlwiZzYtcGVyc29uXCIsXCJraW5kXCI6XCJodW1hblwifSxcImtpbmRcIjpcImhvc3RcIn0iLCJ1IjoxMTksImwiOjEsImkiOjUyfQ）2221 字；缺的段：无
- accepted（K2-P2）：pass。摘要后第一次请求 59f16d28-30b7-4c71-bdad-c63c57de1288：usage reported（那一轮之后 closed，close invalid_answer，另记）
- cache-after（K2-P2）：pass。摘要后第一次请求 59f16d28-30b7-4c71-bdad-c63c57de1288：输入 33831，缓存命中 0（只量，不承诺）
- 秘书线 5 轮；压缩记录 compacted/summary, compacted/summary, compacted/summary；触发 0.02、目标 0.01

## 附加格（八个场景之后的附加 Goal）

### C-216：pass

- observed-start（C-216）：pass。采用前观察 2026-11-27T05:09:18.209Z（{"aggregateType":"ObservedArchitecture","projectId":"2174afe649a4d1043ae7a9a99ba00c7a","workspaceId":"4b54dbc0a9db230d8a4dc7f28b68cb14","captureId":"d212418d-c259-462a-8526-3e35a997eae1"}）；候选 3 个模块、路径 src/store.js, src/report.js, test/store.test.js；采用版 3 个路径：src/report.js, src/store.js, test/store.test.js；覆盖种子文件：src/store.js
- adopted-done（C-216）：pass。Goal COMPLETED
- cold start: round ab77d377-1c95-4d02-b186-0da60f106fb9 asked the person questions (needs_decision) instead of a plan; the person answered on the request

### C-221：uncovered

- first-plan（C-221）：pass。首案采用 initial-plan-309aec57749a9c067fe2f1417b441e81
- fail-rework（C-221）：uncovered (not-run)。没有同一 Task 上“检查轮 FAIL → 返工的新 Run → 检查轮 PASS”这条链（真实模型一次做对，不伪造失败）
- delivered（C-221）：pass。Goal COMPLETED

### C-222：pass

- created（C-222）：pass。secretaryCreated 的线：session-55d7642b9237907dd0c07c936a3b40f6919f23b1cc0830716b98e85afd68f823
- started（C-222）：pass。建出的线上 Run：b3f05a39-f192-4a04-ba40-f6af30802997/completed；Goal COMPLETED；null

## B06

### B06 关闭格：pass

- W1a（B06-W1a）：pass。witness PASS/matched；Task satisfied；Goal PAUSED；报告 429 字
- W2（B06-W2）：pass。witness FAIL；Task running
- W3（B06-W3）：pass。witness FAIL；Task failed
- W5（B06-W5）：pass。非 Git：witness INCONCLUSIVE/matched；Task blocked
- W10（B06-W10）：pass。witness PASS，witness 要求由 platform:witness 覆盖：true；reviewer 要求 pass，覆盖它的检查 无（由独立审阅回答）；Task satisfied
- W12（B06-W12）：pass。四段：task 有 → round 有 → evidence 2 → material keys reportText,roundRef,subjectRunRef
- explore（B06-cond3）：pass。没写 witness 要求的 explore：计划被收下，轮 finalized，没有 platform:witness 检查
- cancel ceca1726-cd75-4274-87c1-3f1658fb95c1: submit committed, deliver ready  
- B06-W1b、W4、W6、W8、W11、W13 和条件 1 引 B06 G2 的绿测（f580d77e，决定 121-122），G6 不重跑；第 9 片审阅的通过不写成 B06 通过。

## E08b（P6：方案确认后自动、sub 已在跑）

### E08b：fail

- sub-running（C-210）：pass。提交改需求时 sub（t1）的 Run 60b46efd-e61a-4976-8783-fad110d93d0a 正在跑（开始于 2026-11-27T05:24:43.614Z）
- stop-delivered（C-210）：pass。任务卡 stop.steps：requested → hold_placed → sent → delivered → run_ended；请求 released（secretary 线 session-008d535213b960b9be1b96fad3da1558f780d501df869f827761c50b09d67a70，停 Run 60b46efd-e61a-4976-8783-fad110d93d0a）
- safe-point-end（C-210）：pass。叫停送到后 sub 的 Run 60b46efd-e61a-4976-8783-fad110d93d0a 结束（completed @ 2026-11-27T05:25:02.563Z），采用时没有 busy 硬停；任务卡 stop.steps：requested → hold_placed → sent → delivered → run_ended；请求 released（secretary 线 session-008d535213b960b9be1b96fad3da1558f780d501df869f827761c50b09d67a70，停 Run 60b46efd-e61a-4976-8783-fad110d93d0a）
- adopt-after-end（C-210）：fail。sub 的 Run 结束 2026-11-27T05:25:02.563Z；采用 initial-plan-d9a6f2654f29edcad131ed48c5a937e4 @ 2026-11-27T05:26:04.899Z（人 plans/apply，busy 0 次）；采用版本的 dispositionRecord 里没有 sub 的记录
- E08b 改需求的轮：?:request/ideas 2
- the person selected idea 1 of 2 on the change: 方案 A：同阶段用 div 任务替换 sub 任务，验收同步替换
- 采用前：叫停请求 action_request.stop:b7eace6627106730c81ee071a6ff48f7abbe2cbc654a8ab2b6c2f547b686e117 released；任务卡上的步骤 requested → hold_placed → sent → delivered → run_ended；sub 的 Run 已结束 2026-11-27T05:25:02.563Z（completed）
- E08b 采用 initial-plan-d9a6f2654f29edcad131ed48c5a937e4：任务 t1:active, t2:active, g-s1:active, g-goal:superseded, g-goal-2:active, t3:active；处置记录 1 条
- goal-confirm:goal.confirmDraft:e96f4ec44887ff45b8e7bf89a1b91379b81c0549c1d11987b0f28020664c7c19 (RUNNING): pause because E08b ended: committed
- E08b ended: after 30 min still Query 0, Work Run 1, Goals not paused none; cancelling what is left
- E08b ended: cancel c712fd70-8e81-41a0-a5f2-498677527a89: submit committed, deliver ready  

## 撞墙表

共 119 行（其中场景预期的拒绝 4 行），每次拒绝一行，原文见 `checks/notes.md`。
P6 要记的三类（按原句匹配，裁定 Q10）：派工版本拒绝 0 次，问答轮发不出 0 次，注记读口 0 次。

## 预算

- 上限：总量 400000000，每个场景/格 50000000（acceptance.config.json `tokenCaps`）。
- 口径：用量 = inputTokens + outputTokens（Kernel 的 inputTokens 已含缓存命中，cachedInputTokens 另记、不再相加）；每条按它所在项目的归属场景/格计，不按读到的时间。
- 合计：用量 31551379（输入 31211576，输出 339803；缓存命中 26859392）；Query 请求 402 次（含 Query 的压缩摘要请求，公开记录分不出）；结束的 Work Run 43 个，其中 0 个是公开证明的零（没进入 Kernel）；未知或不完整的用量不算零：已关闭 Query 里用量未知的请求按预留上限（输入预留 + 输出预留）计，只会多算；Work Run 的用量未知或不完整、或请求的预留读不到时，计量停下。
- 已知缺口：Work Run 的压缩摘要请求在另一个 Kernel Session 里跑，不在 `activity/runs` 里，计量少算了它们；驱动不读数据库补数（lead 裁定 11-14 #3）。400M/50M 上限远高于预期用量，这是记下的缺口，不是阻断。
- 最后一次完整读数时在途：Query 0，Work Run 0（Work Run 的用量要等 Run 结束才在 `activity/runs` 出现，所以超限后的停止点是第一次能看到超出的读数）。
- 实报输入（平台报了用量的部分，不含按预留上限计的和未计费 0）：31164771；估算部分 46805。
- 超预算退出：整轮 没有；按场景/格 没有。
- A1：用量 32709（输入 32615，输出 94，缓存命中 384；Query 请求 2（其中按未计费 0 计的 1：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 0；实报输入 32615）
- B1：用量 88281（输入 87609，输出 672，缓存命中 82816；Query 请求 7（其中按未计费 0 计的 1：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 0；实报输入 87609）
- E05：用量 5415540（输入 5383149，输出 32391，缓存命中 4749056；Query 请求 72（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 3；实报输入 5383149）
- E06：用量 903743（输入 894609，输出 9134，缓存命中 768256；Query 请求 4（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 2；实报输入 894609）
- E08：用量 5660752（输入 5609193，输出 51559，缓存命中 4912640；Query 请求 46（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 6；实报输入 5609193）
- E09：用量 2788563（输入 2762006，输出 26557，缓存命中 2481152；Query 请求 17（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 2；实报输入 2762006）
- E12：用量 1808566（输入 1787707，输出 20859，缓存命中 1516416；Query 请求 27（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 2；实报输入 1787707）
- iteration：用量 1066676（输入 1051450，输出 15226，缓存命中 853120；Query 请求 21（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 1；实报输入 1051450）
- intervention：用量 4279907（输入 4242852，输出 37055，缓存命中 3750016；Query 请求 44（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 6；实报输入 4242852）
- waiting：用量 983204（输入 955170，输出 28034，缓存命中 676736；Query 请求 17（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 1：Query 已关闭、用量未知），结束的 Run 3；实报输入 908365）
- C-216：用量 1410668（输入 1380760，输出 29908，缓存命中 1145856；Query 请求 22（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 2；实报输入 1380760）
- C-221：用量 615383（输入 604759，输出 10624，缓存命中 488832；Query 请求 9（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 1；实报输入 604759）
- C-222：用量 1021760（输入 1009024，输出 12736，缓存命中 811648；Query 请求 22（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 1；实报输入 1009024）
- B06：用量 2381565（输入 2355407，输出 26158，缓存命中 2059904；Query 请求 40（其中按未计费 0 计的 1：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 10；实报输入 2355407）
- E08b：用量 2318395（输入 2293993，输出 24402，缓存命中 1962368；Query 请求 31（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 4；实报输入 2293993）
- compaction：用量 775667（输入 761273，输出 14394，缓存命中 600192；Query 请求 21（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 0；实报输入 761273）
- P6 记账：模型调用 697 次（公开原历史里 `model.request_started` 的条数，含 Work Run；压缩摘要的请求在另一个 Kernel Session 里，数不到，照旧记作缺口）；叫醒轮（intervention-planning）30 个，其中只回“收到”的 3 个（成功的工具调用只有读类和答复，且答复的都不是要回复的信，没交候选、没发信、没出卡；裁定 Q11、lead 11-25 #31，只计数不判；回复对象读不到的照旧计数，见其它记录）。
- A1：模型调用 2，叫醒轮 1，只回收到 1
- B1：模型调用 7，叫醒轮 1，只回收到 1
- E05：模型调用 97，叫醒轮 6，只回收到 0
- E06：模型调用 14，叫醒轮 0，只回收到 0
- E08：模型调用 102，叫醒轮 4，只回收到 0
- E09：模型调用 61，叫醒轮 2，只回收到 0
- E12：模型调用 45，叫醒轮 1，只回收到 0
- iteration：模型调用 26，叫醒轮 1，只回收到 0
- intervention：模型调用 88，叫醒轮 4，只回收到 0
- waiting：模型调用 28，叫醒轮 2，只回收到 1
- C-216：模型调用 37，叫醒轮 1，只回收到 0
- C-221：模型调用 19，叫醒轮 1，只回收到 0
- C-222：模型调用 31，叫醒轮 1，只回收到 0
- B06：模型调用 68，叫醒轮 3，只回收到 0
- E08b：模型调用 54，叫醒轮 2，只回收到 0
- compaction：模型调用 18，叫醒轮 0，只回收到 0

## 延迟探针（只记录）

- wa#0：p50 21.3 ms，p95 21.59 ms，max 327.16 ms（3330 个样本）；关闭方式 SIGINT, exit 0 after 46 ms
- wb#0：p50 21.36 ms，p95 21.68 ms，max 241.04 ms（3770 个样本）；关闭方式 SIGINT, exit 0 after 25 ms
- w-accept#0：p50 21.23 ms，p95 21.69 ms，max 805.83 ms（27391 个样本）；关闭方式 SIGINT, exit 0 after 4642 ms
- w-accept#1：p50 21.27 ms，p95 21.66 ms，max 313.52 ms（2804 个样本）；关闭方式 SIGINT, exit 0 after 37 ms
- w-accept#2：p50 21.27 ms，p95 21.66 ms，max 1258.29 ms（240545 个样本）；关闭方式 SIGINT, exit 0 after 261 ms
- w-accept#3：p50 20.97 ms，p95 21.73 ms，max 1134.56 ms（109092 个样本）；关闭方式 SIGINT, exit 0 after 269 ms
- w-accept#4：p50 21.43 ms，p95 21.91 ms，max 645.4 ms（321272 个样本）；关闭方式 SIGINT, exit 0 after 270 ms
- compaction#0：p50 21 ms，p95 21.92 ms，max 499.65 ms（9455 个样本）；关闭方式 SIGINT, exit 0 after 58 ms

## 证据

- `result.json`：八行，字段照 `slice-9-SPEC.md:729-745`。
- `checks/http.jsonl`：每次 HTTP（只有成功的同一读口连续同样答复合成一行带 `repeat`；每次拒绝单独一行）；预算计量的成功读不逐条记，只计数。
- `checks/model-calls.jsonl`：从公开读口取的每次 Query 请求用量和每个结束的 Work Run 合计，带归属的场景/格（`unit`，按项目归属，不按读到的时间）。
- `checks/commands.txt`：驱动起的命令（Host 起停、git、provider 探测）和退出码。
- `checks/notes.md`：逐条判据、撞墙表、A/B、压缩、B06、预算、延迟探针。
