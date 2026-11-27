# 第 9 片真实验收（G6）2026-11-27

- 树：`31b9fe7a92f49be68a47752c69a00a34551af738`（有未提交改动）；运行号 `g6-2026-11-27-5f54852b`；2026-11-27T06:03:05.083Z → 2026-11-27T08:48:34.599Z。
- 授权原文（逐场景同样记在 result.json 的 `authorization`）：用户批准（2026-11-26 19:2x：“你可以现在开始补跑了，优先opencode，或者dsh”；窗口：“理论上来说，随时都可以，我现在这么规定持续到11.30日”；上限沿用决定 121-124、121-150）：G6 真实验收使用 DeepSeek-V4.1-Flash（provider 顺序：网关 smoke-flash 优先，不通时 smoke-deepseek，即 DSH 凭据里的 DeepSeek；A1/B1 用 smoke-deepseek）；每次补跑总量 4 亿 token、每个场景 5,000 万 token（输入含缓存命中 + 输出），超了就停；只在临时运行目录里建账本和工作区，不提交、不推送、不对外发东西。
- 令牌：wa#0: 已取得令牌；wb#0: 已取得令牌；w-accept#0: 已取得令牌；w-accept#1: 已取得令牌；compaction#0: 已取得令牌。

## 八个场景：total=8 / pass=0 / fail=4 / uncovered=4

| 场景 | 判定 | C 行 | 未覆盖 |
|---|---|---|---|
| E05 | uncovered | C-182, C-183, C-185, C-71, C-73, C-191, C-208, C-217, C-218 | overlap: 两个 Run 的 startedAt/endedAt 真实重叠，claim Session 不同 (not-run); gate: 同模块重叠门回 task/module 和在跑的 Run (not-run); paths: 实际改动能给出具体 path（含共享文件） (not-run); kept: 两个任务的独立成果都还在，两个任务都 satisfied (not-run); single-occupancy: 同一 Session 同时最多一个写入执行（没有同 Session 时间重叠的两个 Run） (not-run); convention: 接口约定只交给一个任务写，另一个任务引用它 (not-run); duplicates: project_source compare（duplicates:true）列出埋入的副本及两处位置 (not-run); reviewer: 审阅者独立判断它是同一条规则（审阅要求有结论） (not-run); name-different: 名字不同、规则相同：报 (not-run); name-same: 名字相同、规则不同：不报 (not-run); temporary: 工作记录里明确认出的临时件在做完之前已收回；只知道写过记未覆盖 (not-run); line-choice: 派工排除只读副本/等待/退役线并按六键排序 (not-run) |
| E06 | uncovered | C-75, C-135, C-106, C-194, C-149, C-151, C-68, C-181, C-209, C-219, C-223 | handoff: 模型 hand_off，人批准，出现接任线 (not-run); successor-input: 接任者实际输入（turn 输入）含目标词和前任 hand_off 的理由原文，不只同一 sessionId (not-run); successor-frontier: 接任者实际输入含前任的义务/前沿 (not-run); no-restatement: 换手后用户没有重述任务 (not-run); excluded-path: 接任者引用当前理解并避开已排除路径 (not-run); same-task-new-run: 同一 Task 新开 Attempt/Run 优先原 Session，带接续说明 (not-run); history-continuity: 后续输入真正含必要前文（不只同一 Session ID） (not-run); restart-running: Work Run 在跑时正常关闭重启：记被中断，继续在原 Session (not-run); restart-paused: 暂停中重启：不算失败，可继续，恢复后在原线接着做 (not-run); archive: 归档前任后源线历史可读（sessions/history、executions/history） (not-run); hand-or-drop: 归档有未完成任务的线：先选交给或放下，同时释放责任与席位 (not-run); wake: 答卡等提交叫醒目标驱动，后继 Run 真的启动 (not-run) |
| E08 | fail | C-47, C-62, C-63, C-133a, C-126, C-46, C-52, C-116, C-118, C-210 | hold-before-adopt: 从说“不要 sub”到采用之前：sub 有秘书放的暂缓（没过期），没有新 Run（只读，驱动不撤） (not-run); required-cancel: required 取消后不因空集合变绿（div 满足之前 Goal 不完成） (not-run); autonomy-later: 改自治级别只影响之后的动作，不停正在跑的工作 (not-run) |
| E09 | uncovered | C-185, C-89, C-65, C-98, C-93, C-95, C-99, C-55, C-62, C-211, C-212, C-218 | executor-reports: 冲突由执行者上报（发给参谋、要回复的消息或 ask_copy），不是只由平台门推断 (not-run); adviser-explains: 参谋解释具体对象和影响（最终答复，或 ask_person / notify_person 的正文） (not-run); person-decides: 人的决定有授权与版本（人提交的答卡，钉住 Goal 版本） (not-run); new-version: 新计划版本替换受影响任务，新定义进上下文 (not-run); report-after-dispatch: 同目标另有一次派活落实后，执行者的上报仍送到参谋（不因版本拒收） (not-run); diagnosis-reverify: （可选）对方的诊断（有答复的询问）实际成为重验的依据（verification/round 的 reverify.newInputRefs） (not-run); uncovered-round: 没有覆盖必需要求的检查时读作 INCONCLUSIVE，不以空集合 PASS (not-run) |
| E12 | fail | C-36, C-42, C-157, C-88, C-89, C-104, C-145, C-146, C-158, C-147, C-155, C-207, C-114, C-215, C-220 | graph-cards: graph/look、graph/find 从已存事实拼出节点卡（路径/版本可回指） (not-run); raw-history: 能读到实际保存的完整原历史 (not-run); completion-chain: 从 Goal 完成走到义务、证据、原检查和文件版本 (not-run); restart-state: 同 ledger 新 Host 读回原 Goal（仍 COMPLETED）、计划和执行 (not-run); reconcile: 持租约的 Host 启动先核对、写出报告 (not-run); redrive-sets: 已完成 Goal 不进被中断集（不写 GoalInterruption） (not-run); new-goal: 旧线的消息先确认成新 Goal，旧 Goal 完成不变，新 Goal 不继承完成事实 (not-run); history-reuse: 重启后的相关新工作实际查询了已完成工作，结果带来源（旧 Goal/Run 的引用） (not-run); stale-premise: 保留适用范围，过期前提不升级 (not-run); replay: 同一次 driver-start 重放只读原来的执行 (not-run); wait-registry: 目标等待登记表启动时只读重建 (not-run) |
| iteration | fail | C-108, C-109, C-110, C-111, C-112, C-105, C-107, C-113, C-194, C-213, C-226 | - |
| intervention | fail | C-199, C-200, C-201, C-202, C-203, C-114, C-189, C-192, C-197, C-198 | claim-once: 空闲线上有未完成任务：直接干预领一次（送进因它新开的 Run，这条线上这个任务只新增 1 个 Run，不开规划） (not-run); four-endings: 四种收尾（反问/非法/没答/放弃）各落到通知、回复或撤回，不静默 (entry-missing); review-packet: 直接干预的原话进入这个目标的执行审阅包（execreview） (not-run); completed-goal: 已完成 Goal 上加工作，先确认成新 Goal，原完成不变 (not-run) |
| waiting | uncovered | C-170, C-171, C-187, C-188, C-190, C-172, C-184, C-189, C-192, C-195, C-196, C-207, C-224, C-225 | second-expiry: 同一追问链第二次实际到期，后继输入写“第 2 次到期” (not-run); late-reply: 迟回保存为下一个安全点的新输入，不重开旧等待 (env-unavailable); reply-first: 回复抢先：第二个问题到期前收到回复，由回复的接受消费等待（consumesWait:true），不记到期 (not-run); transfer: 转交保留问题和期限，未送达不自动换人 (not-run); disconnect: 等待的一侧归档后 decisions/queue 出这条等待的 disconnect 项，Host 给两侧各发 notify (not-run); supply-order: 供给按冻结顺序：人的消息、续作、agent 消息 (not-run) |

每行的逐条判据、证据和原因见 `checks/notes.md`；没跑到的判据记 `uncovered`，不因场景其余判据通过而通过。

## A/B 两格（不进 result.json）

### A1（1M → 131072）：pass

- reserved（C-214）：pass。reservedOutput 131072（requestId 62759470-3b46-4819-9466-865131029bab）
- usage（C-214）：pass。usageStatus reported，输入 32620，输出 91，缓存命中 30336
- accepted（C-214）：pass。请求被接受（用量已报）
- not-truncated（C-214）：pass。输出 91 < 预留 131072；close detail none
- driver-start: ready running
- 请求事实：[{"requestId":"62759470-3b46-4819-9466-865131029bab","reservedOutput":131072,"usageStatus":"reported","inputTokens":32620,"outputTokens":91,"cachedInputTokens":30336}]；Query running；close null；profile 累计输出上限 null = 不设上限
- queries/cancel after the first request: ready stopping
- 证据：{"startedAt":"2026-11-27T06:03:05.084Z","cliConfigPath":"wa/workbench-config.json","model":{"modelId":"smoke-deepseek","provider":"deepseek","model":"deepseek-flash","baseUrlHost":null,"credentialConfigured":true,"promptPack":null,"contextWindowTokens":1000000,"perResponseTokens":16384,"cumulativeTokenBudget":"null = 不设上限","settingsHash":"be86de17285dbd8a"},"requests":[{"requestId":"62759470-3b46-4819-9466-865131029bab","reservedOutput":131072,"usageStatus":"reported","inputTokens":32620,"outputTokens":91,"cachedInputTokens":30336}],"settled":true,"endedAt":"2026-11-27T06:04:13.949Z","project":{"name":"a1","root":"/home/han001/g6-run-1127c/wa/projects/a1","scope":{"projectId":"10c51c5c6a90190c8a10d1cf88d4df59","workspaceId":"f892e1e8728b80d4e6be78c71b39e3f2"},"initial":{"gitHead":"0afceb70f49bf9cf577815d4af75d9099db7b4b4","dirty":false,"snapshotHash":"166905d174d57ccb13a03349ba18c9080cb38db1e55f369b3a2ecdec5ee8a2a0"}}}

### B1（128k → 64000）：pass

- reserved（C-214）：pass。reservedOutput 64000（requestId 5483ea04-ae16-4ae1-b0cc-687abd1a4f0a）
- usage（C-214）：pass。usageStatus reported，输入 12854，输出 98，缓存命中 10752
- accepted（C-214）：pass。请求被接受（用量已报）
- not-truncated（C-214）：pass。输出 98 < 预留 64000；close detail none
- fits（C-214）：pass。请求发出（reservedInput 以内），reservedOutput 64000
- driver-start: ready running
- 请求事实：[{"requestId":"5483ea04-ae16-4ae1-b0cc-687abd1a4f0a","reservedOutput":64000,"usageStatus":"reported","inputTokens":12854,"outputTokens":98,"cachedInputTokens":10752},{"requestId":"6d7952a2-f440-476c-8cea-0f6a9e999046","reservedOutput":63902,"usageStatus":"reported","inputTokens":13891,"outputTokens":83,"cachedInputTokens":12928},{"requestId":"d536c062-1b14-4545-a0b7-932dac20f273","reservedOutput":63819,"usageStatus":"reported","inputTokens":14416,"outputTokens":91,"cachedInputTokens":13952},{"requestId":"217b7b19-4261-4a32-b7bf-33d88d5f5bc2","reservedOutput":63728,"usageStatus":"reported","inputTokens":15076,"outputTokens":100,"cachedInputTokens":14464},{"requestId":"fc7a6804-2ac3-4f23-a15b-86636ce76545","reservedOutput":63628,"usageStatus":"reserved","inputTokens":null,"outputTokens":null,"cachedInputTokens":null}]；Query running；close null；profile 累计输出上限 64000
- queries/cancel after the first request: ready stopping
- request fc7a6804-2ac3-4f23-a15b-86636ce76545: cut by the driver's cancel; usage not reported, at most one request (Query closed, close cancelled)
- 证据：{"startedAt":"2026-11-27T06:04:13.950Z","cliConfigPath":"wb/workbench-config.json","model":{"modelId":"smoke-deepseek","provider":"deepseek","model":"deepseek-flash","baseUrlHost":null,"credentialConfigured":true,"promptPack":null,"contextWindowTokens":128000,"perResponseTokens":64000,"cumulativeTokenBudget":64000,"settingsHash":"33c62ae32fe24a12"},"requests":[{"requestId":"5483ea04-ae16-4ae1-b0cc-687abd1a4f0a","reservedOutput":64000,"usageStatus":"reported","inputTokens":12854,"outputTokens":98,"cachedInputTokens":10752},{"requestId":"6d7952a2-f440-476c-8cea-0f6a9e999046","reservedOutput":63902,"usageStatus":"reported","inputTokens":13891,"outputTokens":83,"cachedInputTokens":12928},{"requestId":"d536c062-1b14-4545-a0b7-932dac20f273","reservedOutput":63819,"usageStatus":"reported","inputTokens":14416,"outputTokens":91,"cachedInputTokens":13952},{"requestId":"217b7b19-4261-4a32-b7bf-33d88d5f5bc2","reservedOutput":63728,"usageStatus":"reported","inputTokens":15076,"outputTokens":100,"cachedInputTokens":14464},{"requestId":"fc7a6804-2ac3-4f23-a15b-86636ce76545","reservedOutput":63628,"usageStatus":"reserved","inputTokens":null,"outputTokens":null,"cachedInputTokens":null}],"settled":true,"endedAt":"2026-11-27T06:05:30.487Z","project":{"name":"b1","root":"/home/han001/g6-run-1127c/wb/projects/b1","scope":{"projectId":"g6-wb","workspaceId":"g6-wb-ws"},"initial":{"gitHead":"f61e6727e3f993070a87a78af2ecbb7acfbdf111","dirty":false,"snapshotHash":"166905d174d57ccb13a03349ba18c9080cb38db1e55f369b3a2ecdec5ee8a2a0"}}}

## 压缩场景（单列，不算第 9 个场景）

### 压缩：pass

- compacted（K2-P2）：pass。context_compacted 3 条（kernhist1.eyJ2IjoxLCJwIjp7InByb2plY3RJZCI6ImIwZGI3OGQyMjhhYTBjZTE2ZDY5YmQwYWRhZWUwNjVkIiwic2Vzc2lvbklkIjoic2Vzc2lvbi0zZTY2YjVkYzNjZTgzYzg4MDc2OTUxZmY2YWE2ZGFlNGRhZjk3MTllYTkzNzA5YzlmMTM5ZWI3ZDIyNTk1OTMwIn0sImEiOiJob3N0LXNldHRpbmdzLWtlcm5lbC01MGM2MDdhZjg3ODFkOTdlMDQ5MGFiMTI2ZTNmNjAzNCIsImsiOiJzZXNzaW9uLTNlNjZiNWRjM2NlODNjODgwNzY5NTFmZjZhYTZkYWU0ZGFmOTcxOWVhOTM3MDljOWYxMzllYjdkMjI1OTU5MzAiLCJyIjoie1wiYWN0b3JcIjp7XCJpZFwiOlwiZzYtcGVyc29uXCIsXCJraW5kXCI6XCJodW1hblwifSxcImtpbmRcIjpcImhvc3RcIn0iLCJ1IjoxMjgsImwiOjEsImkiOjQ1fQ:summary, kernhist1.eyJ2IjoxLCJwIjp7InByb2plY3RJZCI6ImIwZGI3OGQyMjhhYTBjZTE2ZDY5YmQwYWRhZWUwNjVkIiwic2Vzc2lvbklkIjoic2Vzc2lvbi0zZTY2YjVkYzNjZTgzYzg4MDc2OTUxZmY2YWE2ZGFlNGRhZjk3MTllYTkzNzA5YzlmMTM5ZWI3ZDIyNTk1OTMwIn0sImEiOiJob3N0LXNldHRpbmdzLWtlcm5lbC01MGM2MDdhZjg3ODFkOTdlMDQ5MGFiMTI2ZTNmNjAzNCIsImsiOiJzZXNzaW9uLTNlNjZiNWRjM2NlODNjODgwNzY5NTFmZjZhYTZkYWU0ZGFmOTcxOWVhOTM3MDljOWYxMzllYjdkMjI1OTU5MzAiLCJyIjoie1wiYWN0b3JcIjp7XCJpZFwiOlwiZzYtcGVyc29uXCIsXCJraW5kXCI6XCJodW1hblwifSxcImtpbmRcIjpcImhvc3RcIn0iLCJ1IjoxMjgsImwiOjEsImkiOjc0fQ:summary, kernhist1.eyJ2IjoxLCJwIjp7InByb2plY3RJZCI6ImIwZGI3OGQyMjhhYTBjZTE2ZDY5YmQwYWRhZWUwNjVkIiwic2Vzc2lvbklkIjoic2Vzc2lvbi0zZTY2YjVkYzNjZTgzYzg4MDc2OTUxZmY2YWE2ZGFlNGRhZjk3MTllYTkzNzA5YzlmMTM5ZWI3ZDIyNTk1OTMwIn0sImEiOiJob3N0LXNldHRpbmdzLWtlcm5lbC01MGM2MDdhZjg3ODFkOTdlMDQ5MGFiMTI2ZTNmNjAzNCIsImsiOiJzZXNzaW9uLTNlNjZiNWRjM2NlODNjODgwNzY5NTFmZjZhYTZkYWU0ZGFmOTcxOWVhOTM3MDljOWYxMzllYjdkMjI1OTU5MzAiLCJyIjoie1wiYWN0b3JcIjp7XCJpZFwiOlwiZzYtcGVyc29uXCIsXCJraW5kXCI6XCJodW1hblwifSxcImtpbmRcIjpcImhvc3RcIn0iLCJ1IjoxMjgsImwiOjEsImkiOjkwfQ:summary）
- six-sections（K2-P2）：pass。摘要（kernhist1.eyJ2IjoxLCJwIjp7InByb2plY3RJZCI6ImIwZGI3OGQyMjhhYTBjZTE2ZDY5YmQwYWRhZWUwNjVkIiwic2Vzc2lvbklkIjoic2Vzc2lvbi0zZTY2YjVkYzNjZTgzYzg4MDc2OTUxZmY2YWE2ZGFlNGRhZjk3MTllYTkzNzA5YzlmMTM5ZWI3ZDIyNTk1OTMwIn0sImEiOiJob3N0LXNldHRpbmdzLWtlcm5lbC01MGM2MDdhZjg3ODFkOTdlMDQ5MGFiMTI2ZTNmNjAzNCIsImsiOiJzZXNzaW9uLTNlNjZiNWRjM2NlODNjODgwNzY5NTFmZjZhYTZkYWU0ZGFmOTcxOWVhOTM3MDljOWYxMzllYjdkMjI1OTU5MzAiLCJyIjoie1wiYWN0b3JcIjp7XCJpZFwiOlwiZzYtcGVyc29uXCIsXCJraW5kXCI6XCJodW1hblwifSxcImtpbmRcIjpcImhvc3RcIn0iLCJ1IjoxMjgsImwiOjEsImkiOjQ1fQ）1973 字；缺的段：无
- accepted（K2-P2）：pass。摘要后第一次请求 62adfddf-c124-4273-8481-e5489af3cdae：usage reported（那一轮之后 closed，close invalid_answer，另记）
- cache-after（K2-P2）：pass。摘要后第一次请求 62adfddf-c124-4273-8481-e5489af3cdae：输入 35650，缓存命中 27648（只量，不承诺）
- 秘书线 5 轮；压缩记录 compacted/summary, compacted/summary, compacted/summary；触发 0.02、目标 0.01
- 证据：{"startedAt":"2026-11-27T08:43:32.601Z","cliConfigPath":"compaction/workbench-config.json","model":{"modelId":"smoke-flash","provider":"deepseek","model":"deepseek-v4.1-flash","baseUrlHost":"172.17.160.1:8080","credentialConfigured":true,"promptPack":null,"contextWindowTokens":1000000,"perResponseTokens":16384,"cumulativeTokenBudget":"null = 不设上限","settingsHash":"cf90863834784739"},"settled":true,"endedAt":"2026-11-27T08:48:34.598Z","project":{"name":"compaction","root":"/home/han001/g6-run-1127c/compaction/projects/compaction","scope":{"projectId":"b0db78d228aa0ce16d69bd0adaee065d","workspaceId":"ac4844ff24cbd541788367ce37df01f1"},"initial":{"gitHead":"f9ef60c7ac712f20f79b866b4cf932d8346f2890","dirty":false,"snapshotHash":"9b653292ac80696b7e427d719f932760c65af0e7d4342e939d865d6a866db77b"}}}

## 附加格（八个场景之后的附加 Goal）

### C-216：pass

- observed-start（C-216）：pass。采用前观察 2026-11-27T08:14:59.374Z（{"aggregateType":"ObservedArchitecture","projectId":"cfeb63cceeb00242e691b174b51fcc1d","workspaceId":"650bc6f1a4578cb66e4e041649e4326f","captureId":"85e0feab-6252-4089-b180-db0f98f7baf1"}）；候选 3 个模块、路径 src/store.js, src/report.js, test/store.test.js（inventory-initial）；采用版 {"aggregateType":"ArchitectureBaselineRevision","projectId":"cfeb63cceeb00242e691b174b51fcc1d","baselineId":"inventory-initial","revision":1}：3 个模块、3 个路径：src/store.js, src/report.js, test/store.test.js；覆盖种子文件：src/store.js
- adopted-done（C-216）：pass。Goal COMPLETED
- cold start: round 1d4f6430-1815-4104-a0ef-0db4393d1965 asked the person questions (needs_decision) instead of a plan; the person answered on the request
- 证据：{"startedAt":"2026-11-27T08:14:58.005Z","cliConfigPath":"w-accept/workbench-config.json","model":{"modelId":"smoke-flash","provider":"deepseek","model":"deepseek-v4.1-flash","baseUrlHost":"172.17.160.1:8080","credentialConfigured":true,"promptPack":null,"contextWindowTokens":1000000,"perResponseTokens":16384,"cumulativeTokenBudget":"null = 不设上限","settingsHash":"d4cae4ccc63a93a6"},"userCommand":["接手这个已有项目：先看现状，再加一个 remove(sku, count)（不能减到负数），并加测试。验收：node --test 通过。","按你推荐的做法；没提到的按最简单的处理"],"draftAutonomy":"after_plan_confirmation","c216":{"candidate":{"modules":3,"paths":["src/store.js","src/report.js","test/store.test.js"],"version":"inventory-initial"},"adoptedPaths":["src/store.js","src/report.js","test/store.test.js"],"adoptedModules":3,"baselineRef":{"aggregateType":"ArchitectureBaselineRevision","projectId":"cfeb63cceeb00242e691b174b51fcc1d","baselineId":"inventory-initial","revision":1},"observationRead":"ready","observedAt":"2026-11-27T08:14:59.374Z","covered":"src/store.js"},"settled":true,"endedAt":"2026-11-27T08:18:55.267Z","project":{"name":"c216","root":"/home/han001/g6-run-1127c/w-accept/projects/c216","scope":{"projectId":"cfeb63cceeb00242e691b174b51fcc1d","workspaceId":"650bc6f1a4578cb66e4e041649e4326f"},"initial":{"gitHead":"ab62bce6e8f1ec5a3d689bbbcfa391d4c57e1134","dirty":false,"snapshotHash":"e6c2abc9b9dcc92cbfb86a7501993ee9129a31b49d72228017bd01b1b7b0f3df"}}}

### C-221：uncovered

- first-plan（C-221）：pass。首案采用 initial-plan-9b5cb287fe2cf3d01d9457b90c3e907a
- fail-rework（C-221）：uncovered (not-run)。没有同一 Task 上“检查轮 FAIL → 返工的新 Run → 检查轮 PASS”这条链（真实模型一次做对，不伪造失败）
- delivered（C-221）：pass。Goal COMPLETED
- 证据：{"startedAt":"2026-11-27T08:18:55.268Z","cliConfigPath":"w-accept/workbench-config.json","model":{"modelId":"smoke-flash","provider":"deepseek","model":"deepseek-v4.1-flash","baseUrlHost":"172.17.160.1:8080","credentialConfigured":true,"promptPack":null,"contextWindowTokens":1000000,"perResponseTokens":16384,"cumulativeTokenBudget":"null = 不设上限","settingsHash":"cf9a9cdddb841e4f"},"draftAutonomy":"after_plan_confirmation","settled":true,"endedAt":"2026-11-27T08:22:33.094Z","project":{"name":"c221","root":"/home/han001/g6-run-1127c/w-accept/projects/c221","scope":{"projectId":"0b454227e90a8f394218541a5c8ef614","workspaceId":"62d5f52dfe4d09ff56f9448150fecea2"},"initial":{"gitHead":"2c73122ee3881102ca9a0e0ed0c89258cac0ff72","dirty":false,"snapshotHash":"c8f388a8981813c942423aca14eec9bc455639abe417d638f380f0893af09512"}}}

### C-222：fail

- created（C-222）：fail。secretaryCreated 的线：无
- started（C-222）：fail。建出的线上 Run：无；Goal COMPLETED；null
- 证据：{"startedAt":"2026-11-27T08:22:33.094Z","cliConfigPath":"w-accept/workbench-config.json","model":{"modelId":"smoke-flash","provider":"deepseek","model":"deepseek-v4.1-flash","baseUrlHost":"172.17.160.1:8080","credentialConfigured":true,"promptPack":null,"contextWindowTokens":1000000,"perResponseTokens":16384,"cumulativeTokenBudget":"null = 不设上限","settingsHash":"0a81477f9a95742b"},"draftAutonomy":"after_plan_confirmation","settled":true,"endedAt":"2026-11-27T08:26:13.076Z","project":{"name":"c222","root":"/home/han001/g6-run-1127c/w-accept/projects/c222","scope":{"projectId":"b6233ba3052f3f256e490a5c6e46e233","workspaceId":"51b4765ca28d16d584906020e6400cf0"},"initial":{"gitHead":"741818b8be7b73ea127dff429d5c001e86d04c91","dirty":false,"snapshotHash":"5402ffdc7b0a787ac0981924849dccb29df17e242be8780408e6343af23c0bac"}}}

## B06

### B06 关闭格：pass

- W1a（B06-W1a）：pass。witness PASS/matched；Task satisfied；Goal PAUSED；报告 367 字
- W2（B06-W2）：pass。witness FAIL；Task running
- W3（B06-W3）：pass。witness FAIL；Task failed
- W5（B06-W5）：pass。非 Git：witness INCONCLUSIVE/matched；Task blocked
- W10（B06-W10）：pass。witness PASS，witness 要求由 platform:witness 覆盖：true；reviewer 要求 pass，覆盖它的检查 无（由独立审阅回答）；Task satisfied
- W12（B06-W12）：pass。四段：task 有 → round 有 → evidence 1 → material keys reportText,roundRef,subjectRunRef
- explore（B06-cond3）：pass。没写 witness 要求的 explore：计划被收下，轮 finalized，没有 platform:witness 检查
- cancel e4c58bcb-9e02-4b7e-a0a5-f7075a50e849: submit committed, deliver ready  
- cancel 14aa5f1d-de6d-4bd6-91ef-8a3b0a731d23: submit committed, deliver ready  
- B06-W1b、W4、W6、W8、W11、W13 和条件 1 引 B06 G2 的绿测（f580d77e，决定 121-122），G6 不重跑；第 9 片审阅的通过不写成 B06 通过。
- 证据：{"startedAt":"2026-11-27T08:26:13.078Z","cliConfigPath":"w-accept/workbench-config.json","model":{"modelId":"smoke-flash","provider":"deepseek","model":"deepseek-v4.1-flash","baseUrlHost":"172.17.160.1:8080","credentialConfigured":true,"promptPack":null,"contextWindowTokens":1000000,"perResponseTokens":16384,"cumulativeTokenBudget":"null = 不设上限","settingsHash":"bfa6c47b8864eb19"},"draftAutonomy":"after_plan_confirmation","settled":true,"endedAt":"2026-11-27T08:32:22.350Z","project":{"name":"b06","root":"/home/han001/g6-run-1127c/w-accept/projects/b06","scope":{"projectId":"61eaa75197420d7cf67acb5a5f9499ff","workspaceId":"49b440ed3baabd35fcc2d81ac05ffc29"},"initial":{"gitHead":"ddc3d8b53b6b34221d78d3ed989b9160764480ac","dirty":false,"snapshotHash":"0f17aae36aea5d621c9cf0af34c8c7321d927e5a086d41cb4415d26c9910d38c"}}}

## E08b（P6：方案确认后自动、sub 已在跑）

### E08b：uncovered

- sub-running（C-210）：pass。提交改需求时 sub（t-sub）的 Run 7bbaeebc-b3ff-4224-be31-bd6bef9a1573 正在跑（开始于 2026-11-27T08:34:20.389Z）
- stop-delivered（C-210）：uncovered (not-run)。没有读到可采用的候选。问题或探针不构成候选，没有发生采用，这一支没走到；任务卡 stop.steps：requested → hold_placed → sent → delivered → run_ended；叫停请求 released；sub 的 Run completed @ 2026-11-27T08:35:04.013Z
- safe-point-end（C-210）：uncovered (not-run)。没有读到可采用的候选。问题或探针不构成候选，没有发生采用，这一支没走到；任务卡 stop.steps：requested → hold_placed → sent → delivered → run_ended；叫停请求 released；sub 的 Run completed @ 2026-11-27T08:35:04.013Z
- adopt-after-end（C-210）：uncovered (not-run)。没有读到可采用的候选。问题或探针不构成候选，没有发生采用，这一支没走到；任务卡 stop.steps：requested → hold_placed → sent → delivered → run_ended；叫停请求 released；sub 的 Run completed @ 2026-11-27T08:35:04.013Z
- E08b 改需求的轮：?:request/ideas 0
- while the change candidate was written the person answered message card {"kind":"message","messageRef":{"aggregateType":"SessionMessage","messageId":"session-message-050182bb13bb887966cab138c2959809454962aac6a248935475305b6fa546e6","projectId":"3283298eb3f52259e53c1a3c3d878f06","workspaceId":"dbd3420413c03bcf6cc738b7f1b797f1"}}
- 改需求没有候选：the request's last round b49ac3c3-76d0-46ad-a43d-188b06c8474c ended without a candidate and no Query ran for 5 min
- goal-confirm:goal.confirmDraft:1a1bc29c1b2f0850753e727d155d2e0b17ce533557e3dc1694afca4f56159bbf (RUNNING): pause because E08b ended: committed
- 证据：{"startedAt":"2026-11-27T08:32:22.351Z","cliConfigPath":"w-accept/workbench-config.json","model":{"modelId":"smoke-flash","provider":"deepseek","model":"deepseek-v4.1-flash","baseUrlHost":"172.17.160.1:8080","credentialConfigured":true,"promptPack":null,"contextWindowTokens":1000000,"perResponseTokens":16384,"cumulativeTokenBudget":"null = 不设上限","settingsHash":"7a41b78cebf1d89c"},"userCommand":["分两个独立任务：一是在 calc.js 加 sub(a, b) 并加 test/sub.test.js；二是在 calc.js 加 mul(a, b) 并加 test/mul.test.js。验收：node --test 全部通过。","改目标和验收：不要 sub 了（取消那个任务和它的验收）；改为加 div(a, b)，b 为 0 时抛 RangeError，并加 test/div.test.js。mul 照旧。"],"draftAutonomy":"after_plan_confirmation","e08b":{"rounds":[{"roundRef":{"aggregateType":"QueryJob","projectId":"3283298eb3f52259e53c1a3c3d878f06","workspaceId":"dbd3420413c03bcf6cc738b7f1b797f1","queryJobId":"aed068f4-4111-4f4f-b649-69ac0df3c93a"},"kind":"request","status":"ended","ideas":0,"selectedIdea":null,"closeCode":"invalid_answer","kernel":{"adapterId":"host-settings-kernel-311ee1259bdf2add504c99512e89f1ba","kernelSessionId":"session-6b8dac9b7ac04501f7675ae21c0a375722981b98c9daab62894b78fc47970c6c","runId":"krun-7c3571111b5bbee770eab4f7a46c658fe7230687ced09e7d37c28839d9db5559","turnId":"kturn-3c6496465de03943a0fb63bb1829067043638938bbb59bfe9000e9093ce74d95"},"tools":["ask_copy","ask_person","check_links","code_index","cpp_index","create_member","dispatch_task","find_graph","hold_claim","list_files","look_graph","notify_person","project_source","python_index","query_ready_tasks","query_task_graph","read","read_requests","read_session_inbox","read_session_message","read_session_message_body","read_user_decision","record_note","release_hold","request_stop","respond_session_message","run_readonly_command","search","send_session_message","source_excerpt","submit_plan_round","submit_secretary_answer","symbols","web_fetch","web_search","withdraw_session_message"],"toolsGap":null,"read":{"queries":"ready","history":"ready"},"calls":[{"name":"query_ready_tasks","status":"tool.completed"},{"name":"request_stop","status":"tool.completed"},{"name":"run_readonly_command","status":"tool.completed"},{"name":"ask_person","status":"tool.completed"}],"refusals":[]}],"evidenceGaps":[],"selectIdea":null,"candidate":{"readable":true,"status":"closed","proposalRef":null,"task":null}},"settled":true,"endedAt":"2026-11-27T08:43:30.935Z","project":{"name":"e08b","root":"/home/han001/g6-run-1127c/w-accept/projects/e08b","scope":{"projectId":"3283298eb3f52259e53c1a3c3d878f06","workspaceId":"dbd3420413c03bcf6cc738b7f1b797f1"},"initial":{"gitHead":"4f8c01836497e7aac7a72ef44e1d58df981c4647","dirty":false,"snapshotHash":"a8c68975ea91eeffb929240b8e8cf424a62eac7f17cf98666979c836de80e98e"}}}

## 撞墙表

共 106 行（其中场景预期的拒绝 4 行），每次拒绝一行，原文见 `checks/notes.md`。
P6 要记的三类（按原句匹配，裁定 Q10）：派工版本拒绝 0 次，问答轮发不出 0 次，注记读口 0 次。

## 预算

- 上限：总量 400000000，每个场景/格 50000000（acceptance.config.json `tokenCaps`）。
- 口径：用量 = inputTokens + outputTokens（Kernel 的 inputTokens 已含缓存命中，cachedInputTokens 另记、不再相加）；每条按它所在项目的归属场景/格计，不按读到的时间。
- 合计：用量 20930690（输入 20635495，输出 295195；缓存命中 17743360）；Query 请求 307 次（含 Query 的压缩摘要请求，公开记录分不出）；结束的 Work Run 36 个，其中 0 个是公开证明的零（没进入 Kernel）；未知或不完整的用量不算零：已关闭 Query 里用量未知的请求按预留上限（输入预留 + 输出预留）计，只会多算；Work Run 的用量未知或不完整、或请求的预留读不到时，计量停下。
- 已知缺口：Work Run 的压缩摘要请求在另一个 Kernel Session 里跑，不在 `activity/runs` 里，计量少算了它们；驱动不读数据库补数（lead 裁定 11-14 #3）。400M/50M 上限远高于预期用量，这是记下的缺口，不是阻断。
- 最后一次完整读数时在途：Query 0，Work Run 0（Work Run 的用量要等 Run 结束才在 `activity/runs` 出现，所以超限后的停止点是第一次能看到超出的读数）。
- 实报输入（平台报了用量的部分，不含按预留上限计的和未计费 0）：20424732；估算部分 210763。
- 超预算退出：整轮 没有；按场景/格 没有。
- A1：用量 32711（输入 32620，输出 91，缓存命中 30336；Query 请求 1（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 0；实报输入 32620）
- B1：用量 56609（输入 56237，输出 372，缓存命中 52096；Query 请求 5（其中按未计费 0 计的 1：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 0；实报输入 56237）
- E05：用量 1129396（输入 1110148，输出 19248，缓存命中 906496；Query 请求 19（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 2；实报输入 1110148）
- E06：用量 0（输入 0，输出 0，缓存命中 0；Query 请求 0（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 0；实报输入 0）
- E08：用量 1269349（输入 1254998，输出 14351，缓存命中 1038976；Query 请求 22（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 2；实报输入 1254998）
- E09：用量 2143625（输入 2098628，输出 44997，缓存命中 1812224；Query 请求 27（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 2；实报输入 2098628）
- E12：用量 748271（输入 733689，输出 14582，缓存命中 601344；Query 请求 14（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 1；实报输入 733689）
- iteration：用量 1399787（输入 1378144，输出 21643，缓存命中 1163520；Query 请求 27（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 1；实报输入 1378144）
- intervention：用量 3507529（输入 3471268，输出 36261，缓存命中 2975744；Query 请求 44（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 5；实报输入 3471268）
- waiting：用量 1373533（输入 1346879，输出 26654，缓存命中 1073152；Query 请求 16（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 1：Query 已关闭、用量未知），结束的 Run 5；实报输入 1212566）
- C-216：用量 667552（输入 651858，输出 15694，缓存命中 515072；Query 请求 14（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 1；实报输入 651858）
- C-221：用量 814797（输入 800959，输出 13838，缓存命中 636032；Query 请求 12（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 1；实报输入 800959）
- C-222：用量 819069（输入 806229，输出 12840，缓存命中 683136；Query 请求 13（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 1；实报输入 806229）
- B06：用量 2042071（输入 2019536，输出 22535，缓存命中 1855360；Query 请求 28（其中按未计费 0 计的 2：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 11；实报输入 1943086）
- E08b：用量 3965043（输入 3936189，输出 28854，缓存命中 3564672；Query 请求 41（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 4；实报输入 3936189）
- compaction：用量 961348（输入 938113，输出 23235，缓存命中 835200；Query 请求 24（其中按未计费 0 计的 0：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 0：Query 已关闭、用量未知），结束的 Run 0；实报输入 938113）
- P6 记账：模型调用 525 次（公开原历史里 `model.request_started` 的条数，含 Work Run；压缩摘要的请求在另一个 Kernel Session 里，数不到，照旧记作缺口）；叫醒轮（intervention-planning）24 个，其中只回“收到”的 3 个（成功的工具调用只有读类和答复，且答复的都不是要回复的信，没交候选、没发信、没出卡；裁定 Q11、lead 11-25 #31，只计数不判；回复对象读不到的照旧计数，见其它记录）。
- A1：模型调用 1，叫醒轮 1，只回收到 1
- B1：模型调用 5，叫醒轮 1，只回收到 1
- E05：模型调用 28，叫醒轮 2，只回收到 0
- E08：模型调用 35，叫醒轮 1，只回收到 0
- E09：模型调用 50，叫醒轮 1，只回收到 0
- E12：模型调用 22，叫醒轮 1，只回收到 0
- iteration：模型调用 34，叫醒轮 1，只回收到 0
- intervention：模型调用 86，叫醒轮 4，只回收到 0
- waiting：模型调用 34，叫醒轮 4，只回收到 1
- C-216：模型调用 19，叫醒轮 1，只回收到 0
- C-221：模型调用 24，叫醒轮 1，只回收到 0
- C-222：模型调用 24，叫醒轮 1，只回收到 0
- B06：模型调用 62，叫醒轮 3，只回收到 0
- E08b：模型调用 80，叫醒轮 2，只回收到 0
- compaction：模型调用 21，叫醒轮 0，只回收到 0

## 延迟探针（只记录）

- wa#0：p50 20.89 ms，p95 21.81 ms，max 372.51 ms（3371 个样本）；关闭方式 SIGINT, exit 0 after 49 ms
- wb#0：p50 20.91 ms，p95 21.97 ms，max 259.39 ms（3832 个样本）；关闭方式 SIGINT, exit 0 after 35 ms
- w-accept#0：p50 20.69 ms，p95 21.97 ms，max 750.26 ms（282276 个样本）；关闭方式 SIGINT, exit 0 after 771 ms
- w-accept#1：p50 20.76 ms，p95 22.05 ms，max 1135.61 ms（187977 个样本）；关闭方式 SIGINT, exit 0 after 516 ms
- compaction#0：p50 20.33 ms，p95 21.84 ms，max 509.61 ms（15466 个样本）；关闭方式 SIGINT, exit 0 after 67 ms

## 证据

- `result.json`：八行，字段照 `slice-9-SPEC.md:729-745`。
- `checks/http.jsonl`：每次 HTTP（只有成功的同一读口连续同样答复合成一行带 `repeat`；每次拒绝单独一行）；预算计量的成功读不逐条记，只计数。
- `checks/model-calls.jsonl`：从公开读口取的每次 Query 请求用量和每个结束的 Work Run 合计，带归属的场景/格（`unit`，按项目归属，不按读到的时间）。
- `checks/commands.txt`：驱动起的命令（Host 起停、git、provider 探测）和退出码。
- `checks/notes.md`：逐条判据、撞墙表、A/B、压缩、B06、预算、延迟探针。
