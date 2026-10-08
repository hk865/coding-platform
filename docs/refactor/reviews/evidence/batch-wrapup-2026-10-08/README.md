# 收尾审查：拆完以后现有实现有没有意义（2026-10-08）

**是什么。** 可靠性批次收尾的独立审查（STATUS“剩余”第 1 项里“独立审查”和“保留 / 删除 / 合并 / 挪位置清单”两条，用户 2026-10-05 问到）。Codex 只读审了 a57edc1e，按决定 31 的目标（不重复、没有死代码、结构清楚、文档和代码一致、行数守住）列出 58 条发现；lead 逐条定去向，删除类全部核对后执行，其余抽查了 20 条。本页是这份清单、核对记录和决定 31 的行数核对。分支 `feat/reliability-and-structure`，没有推送；没有调用真实模型。

**提交：**

| 提交 | 内容 |
| --- | --- |
| 60d946ff | （收尾第 2 段）删除 DEAD-1 到 DEAD-5：STATUS 早已记下的 5 处小尾巴 |
| 820817c3 | （收尾第 2 段）检查器认子模块上的 `pure: true`，退役 `pureDirectories`（PLACE-2 里说的“还没做”） |
| a37cc0e6 | （收尾第 2 段）DOC-8：注释里已删的 VR-06 |
| 333e398e | （收尾第 3 段）DOC-9：CORE-DATA-OPERATIONS 补 GAP-45 的几行 |
| 7e0b7f56 | 本段：删除 DEAD-6、DEAD-7、DEAD-8 |
| 1896ec6c | 本段：DOC-1 到 DOC-7，以及因 DEAD-6 要改的文档 |
| 本页所在的提交 | 本页和审查原文、脚本、输出 |

## 结论

- **58 条的去向：** 删除 8 条，收尾全部删完；保留 7 条（3 组有原因的走不到代码、2 条结构、2 个不拆的大文件）；合并 13 条、挪位置 4 条、拆分 17 条，进下一阶段的结构设计，其中 2 条和编排设计第 3 片、1 条和第 2 片重合；文档 9 条，收尾全部改完。lead 没有驳回任何一条，有 4 处按 HEAD 更正或说明（见“驳回和更正”）。
- **按决定 31 的五个目标看：**
  - 不重复：**没做到。** 同一条规则判几处的有 13 条，最大的是 15 份“按规范 JSON 比较”和读图、装配上下文的多条路径，进下一阶段。
  - 没有死代码：**做到了。** 收尾又删了 8 处；生产走不到的节点从 142 个降到 120 个，全部在允许清单里写明原因（第 3 片 37 个、第 8 片 21 个、留给用户定的 62 个）。
  - 结构清楚：模块边界检查通过；WorkGraph 子模块之间无环，文件之间没有值引用的环，剩 2 个只靠类型的环（都在子模块内部，决定 40 接受）。**过大的文件没有缩小：** 现在 19 个文件超过 1,000 行（cbaed80 时服务和状态机里是 14 个），17 个进下一阶段拆分。
  - 文档和代码一致：9 条都改了。
  - 行数守住：**守住了。** 重构部分比 cbaed80 净少 3,394 行（规则是不超过）。服务文件现在 77,197 行，比 cbaed80 多 6,971 行，多出来的是第 5 步的新行为（+9,542）。

## 审查怎么做的

- **Codex**：codex-cli 0.159.0，只读沙箱（`-s read-only`），推理强度 xhigh，在新克隆 `D:/cxt/wrapup-review`（a57edc1e）里跑。2026-10-08 12:25:28 到 12:56:13（+08:00），**1,844 秒（约 31 分钟）**，退出码 0。**输入 12,729,518 token，其中 12,276,608 走缓存；输出 53,722 token，其中推理 26,473。** 克隆跑完仍是干净的，没提交、没推送。提示词原文 `codex-prompt.txt`，命令 `codex-run.sh`，用量 `codex-run.txt`，结果原文 `codex-review.md`（英文）。
- **Codex 的限制**（它自己写明）：这台机器没装 Node，跑不了 tsc、vitest 和 `production-reach.ts`；没有 `rg`，用 `git grep` 查引用；PowerShell 读中文文档时行尾有几个字乱码。所以它的“死代码”结论不等于跑过生产可达分析，类型上能不能合并也没验证。
- **lead 的核对**在 HEAD 上做（Codex 审完以后，收尾第 2、3 段又有 7 个提交），检查在 WSL 槽位 s2 里跑。

## 清单

位置按 Codex 审的 a57edc1e；标“HEAD”的是 lead 在当前代码上重新定位过的。`WG/` 是 `src/core/work-graph/`，`RT/` 是 `src/core/agent-runtime/`。“新/已知”按 Codex 的标法：已知的是 STATUS 早已记下的。

### 删除（8 条，收尾全部做完）

| 编号 | 位置 | 证据 | 做了什么 |
| --- | --- | --- | --- |
| DEAD-1 已知 | `WG/model/execution-entry-contracts.ts:150`；`src/composition/create-platform.ts:534` | `ExecutionEntryDependencies.materials` 组合根传了，执行入口从没读 | 60d946ff 删字段和 import；五个测试夹具不再传 |
| DEAD-2 已知 | `RT/execution-preparation.ts:32` | 依赖类型 Pick 了 `claims`、`sessions`、`materials`，文件里没有 `deps.claims/sessions/materials` | 60d946ff 从 Pick 里去掉 |
| DEAD-3 已知 | `src/core/workspace/candidate-workspace-reader.ts:24,42,52,67` | 唯一调用传 `true` | 60d946ff 删参数，照旧总是收集 git 条目 |
| DEAD-4 已知 | `src/ui/main.ts:27` | `renderProjectRead` 导入了没用 | 60d946ff 删这个 import |
| DEAD-5 已知 | `WG/evidence/evidence-service.ts:278,286,314` | `commitRoundWrite` 的五个调用方都不会收到 `guard_round_unchanged`，它只由重新入队（VR-09）发出，重新入队的 owner 自己翻译（`tasks/requeue-service.ts:686`） | 60d946ff 删掉这一支和 `roundGuard`；为了 switch 仍穷尽，留一个 `throw`（HEAD `:305-308`），和同一处只属于重新检查的几种效果一样 |
| DEAD-6 新 | `src/core/workspace/material-source-provider.ts`、`source-applicability.ts`；`src/contracts/material-access.ts:51,60` 的 `MaterialSourceCaptureResult`、`SourceApplicabilityPort`；允许清单 22 条 | 引用只在这两个文件之间、两个只给它们用的契约类型、测试和允许清单；允许清单的原因写着“第 3 片定下不需要就删”，设计书 §2.8（AMB-37，决定 42 所列）已定第 3 片按“历史说明 + 记下版本”读、删这两个文件 | 7e0b7f56 删两个文件（317 行）、两个类型、允许清单 22 条（142 → 120）、`tests/data/M1-material-source-provider.test.ts`（7 项）、R3b 里 source pin 那 1 项、`tools/dsh-refactor/check.py` 里它的检查名。保留 `MaterialSourcePinV1` 和校验（执行入口、查询反馈还在读） |
| DEAD-7 新 | `RT/execution-preparation.ts:391-399` | 上一句已经对每个非 contract 的必需材料返回 `unsupported`，所以走到 `if (!contractSatisfied)` 时它一定是 true，`incomplete` 那句拒绝永远到不了；`every` 和 `filter` 对同一个数组判断互补的条件 | 7e0b7f56 删这个布尔值和那句拒绝，`unsupported` 的拒绝不动；没有测试断言那句拒绝文字 |
| DEAD-8 新 | `src/contracts/runtime-budget.ts:29` | `_legacyContextOnlyTask` 只出现在声明里；三个生产调用（`app/runtime-configuration.ts:257,277`、`contracts/query-job.ts:269`）都只传一个参数，也没有把它当回调传（`.map(validateRuntimeBudget)` 会把下标传进第二个参数）；`model-budget.ts:4` 只是转出 | 7e0b7f56 删这个参数 |

### 保留（7 条）

| 编号 | 位置 | 证据 | 去向 |
| --- | --- | --- | --- |
| DEAD-9 已知 | 角色相关 37 个节点：`WG/model/configuration-contracts.ts` 的四个公开操作、`configuration/role-memory-service.ts`、`role-record-codecs.ts`、角色契约、`workspace/role-source-reader.ts` | 没有路由、Workflow、脚本用；允许清单 `kept-for` 第 3 片，设计书第 3 片有“职责角色配置” | 保留，第 3 片接上 |
| DEAD-10 已知 | 架构目录修订 11 个、比较与影响分析 10 个节点（`architecture/` 下 6 个文件） | 组合根发布了 `reviseArchitectureCatalog`、`compareArchitecture`、`queryImpact`，只有测试调 | 保留，第 8 片接上 |
| DEAD-11 已知 | `src/app/core-http-types.ts` 60 个请求/响应类型别名，`src/app/main.ts:18,30` 两个命令行配置类型 | 原因 `pre-batch`：做新界面时再定（决定 6），README 写明的配置格式 | 保留，新界面（E3）时由用户定 |
| PLACE-1 已知 | `docs/refactor/module-target.json`、`module-dag.md` | 静态 import 用到 41 条允许依赖里的 40 条（没用的是 `tasks → architecture`），没有值引用的环；只靠类型的环两个：`model/` 里三个执行/通信契约文件、`state/control-intent-machine.ts ↔ state/run-machine.ts` | 保留。lead 在 HEAD 上复核：check:architecture 报 40 条子模块边；`scripts/import-graph.mjs` 报组级环 0 个，文件级强连通分量 2 个、只含值引用的 0 个（`import-graph-head.md`） |
| PLACE-2 已知 | `module-target.json:6`、`scripts/check-boundaries.mjs` | Codex 审时 `pureDirectories` 还管着 state，`pure: true` 没做 | 保留；在 Codex 审完以后已由 820817c3 做完，现在 check:architecture 报 `pure submodules: WorkGraph/state` |
| SIZE-3 | `src/composition/create-platform.ts`，1,021 行 | 一个组装和生命周期工厂，管原始服务和跟踪服务、统一关闭；合并重复的小策略后自然变小，不必拆 | 不拆 |
| SIZE-16 | `WG/tasks/claim-service.ts`，1,002 行 | 一个公开的领取事务，首次、接续、重新入队三种领取按序读、准入、CAS；多 2 行不值得人为拆；真正的重复（DUP-9、DUP-13）靠合并解决 | 不拆 |

### 合并（13 条，进下一阶段的结构设计）

STATUS“下一步”第 1 项写了：编排后端的第一步是结构设计，然后再加功能。下表“去向”写“结构设计”的都在那里做；和编排设计某一片重合的另外写出。

| 编号 | 位置 | 重复的规则 | 合并成什么 | 去向 |
| --- | --- | --- | --- | --- |
| DUP-1 已知 | 15 处：`app/collaboration-driver.ts:157`、`business/workflow/consultation.ts:38`、`workflow.ts:77`、`composition/create-platform.ts:149`、`RT/execution-control.ts:137`、`execution-driver.ts:176`、`execution-observation.ts:146`、`query-execution.ts:55`、`run-reconcile.ts:73`、`WG/persistence/rework-codecs.ts:41`、`WG/queries/query-execution.ts:91`、`WG/tasks/claim-service.ts:123`、`execution-entry-service.ts:131`、`execution-history-service.ts:96`、`reconcile-intents.ts:86` | 按规范 JSON 比较，编不出 JSON 就算不等，和 `contracts/fingerprint.ts:51` 的 `sameJson` 等价；其中两份是导出的（STATUS 写“私有”不准） | 都改用 `sameJson` | 结构设计 |
| DUP-2 新 | `state/` 里 4 处：`plan-machine.ts:720`、`task-machine.ts:940`、`:758`、`goal-machine.ts:973`；另有几族语义不同的比较（`JSON.stringify`、空值哨兵等） | state 里这 4 处编码失败会抛错，不能直接换成吞错的 `sameJson`；其余几族只是清单，换掉会改行为 | 规范比较归 contracts，保留抛错语义 | 结构设计 |
| DUP-3 已知 | 读图和装配上下文的多条路径：`RT/whiteboard-tools.ts:262,276`→`plan-service.ts:1521,1613`；`RT/execution-preparation.ts:104,287`；`RT/query-preparation.ts:220,258`；接续说明 `RT/continuation-brief-assembly.ts:299`；Session 发现、邮箱工具、`RT/execution-inputs.ts:63`、咨询、`app/attention-observer.ts:466` | 不是每条都判同一规则；真正重复的是 Role/pin 上下文的渲染和适配层的状态处理。已经共用的（`readCanonicalTaskFacts`、`evaluateEligibility`、`projectTaskPhase` 等）保持共用 | 拼起来的图读取归 `views`，给 agent 的上下文归 Runtime 一个装配器，按读者保留适配；查询现在禁用白板和邮箱工具（`RT/query-preparation.ts:139`），合并时保持，给查询开图工具是第 3 片的功能 | **第 3 片**（装配器、看/找）+ 结构设计第一步 |
| DUP-4 新 | `RT/kernel-turn-facts.ts:27-87`、`RT/query-observation.ts:74-121`、`RT/execution-observation.ts:88-160` | Query 自己又解了一遍 Kernel 原始记录、位置和 turn；`tool_result` + `error` + `outcome_unknown` 的判断在三处 | 并进 `kernel-turn-facts`，Work 和 Query 各自的结果映射保留 | 结构设计 |
| DUP-5 新 | `RT/run-limits.ts:31`、`RT/model-budget.ts:29` | 同一个“离期限还剩多少毫秒”`Math.max(0, deadline − now)`；缺时钟和报错文字不同 | 合并纯计算，保留各自报错 | 结构设计 |
| DUP-6 新 | `RT/whiteboard-tools.ts:116,125`、`RT/session-discovery-tools.ts:70`、`RT/communication-tools.ts:108,114` | 各自把 ready/committed、not_found、not_ready、取消、拒绝映射成 Kernel 的工具结果 | 合并到 Runtime 适配层，保留邮箱读取成功时只回 `value` 的差别 | 结构设计；第 3 片加工具时一起 |
| DUP-7 新 | `src/core/workspace/capture.ts:278-280`、`workspace-read.ts:144-146`（HEAD 相同） | 两次 capture 能不能比较：同 provider、同索引版本、同范围，拒绝文字也一样 | 合并成一个纯判断，授权和容量检查留在原处 | 结构设计 |
| DUP-8 新 | `WG/tasks/plan-task-basis.ts:78`、`plan-validation.ts:290`（HEAD） | 验收义务去掉承载任务（`taskIds`）后的语义身份 | 并进 plan-basis 的助手 | 结构设计 |
| DUP-9 新 | `WG/tasks/eligibility.ts:34-78`、`state/task-machine.ts:826,855`、`state/run-machine.ts:519`、`tasks/claim-service.ts:859` | Goal 是否活动、任务种类、处置、可派发阶段、租约，候选资格和领取守卫各判一遍 | 底层分类收进 state；候选输出“全部诊断”和领取“按序第一条拒绝”的区别保留 | 结构设计（和 PLACE-6 一起） |
| DUP-10 新 | 9 个逐字相同的 `ownContext`：`RT/execution-driver.ts:216`、`execution-observation.ts:91`、`execution-preparation.ts:61`、`query-execution.ts:61`、`query-observation.ts:57`、`query-preparation.ts:155`、`graph-execution-history.ts:98`、`observation-recovery.ts:112`、`WG/queries/query-execution.ts:120` | 留项目和取消信号、克隆身份和材料读者、有工作区才带、克隆失败回 null | 合并成共用的调用上下文快照，各自的授权检查留在原处 | 结构设计 |
| DUP-11 新 | `RT/execution-driver.ts:203`、`execution-observation.ts:102`、`query-execution.ts:72`、`query-observation.ts:68`、`query-preparation.ts:166`、`execution-preparation.ts:72`、`WG/queries/query-execution.ts:108,114`、`tasks/claim-service.ts:158`、`execution-entry-service.ts:168`、`evidence/evidence-service.ts:183` | 读失败映射：缺 → not_found，水位不够 → incomplete，拒绝原样保留 | 合并等价的几族，保留调用方的文字；不推广到普通读取接口 | 结构设计 |
| DUP-12 新 | Store 失败映射：`WG/sessions/session-directory.ts:136`、`session-lifecycle.ts:99`、`communication/mailbox-service.ts:131` 一族，`tasks/execution-entry-service.ts:154`、`execution-history-service.ts:118` 另一族；当前 pin 解码 5 处 | 族内等价；pin 读取各自丢掉空版本和读不懂的 key 再解码 | 等价的族并进 persistence 助手，不同的策略（unique 冲突映射成 busy 还是 revision_conflict 等）保留 | 结构设计 |
| DUP-13 新 | `WG/tasks/claim-service.ts:116`、`execution-entry-service.ts:217`、`execution-history-service.ts:144` | 三份逐字相同的 `sameHostActor`（同 kind、同 id、只认 human/system） | 合并成 contracts 层的身份判断 | 结构设计 |

### 挪位置（4 条，进下一阶段的结构设计）

| 编号 | 位置 | 为什么不在对的地方 | 挪到哪 | 去向 |
| --- | --- | --- | --- | --- |
| PLACE-3 新 | `WG/tasks/plan-service.ts:596,788,1521,1613,1715`、`app/attention-observer.ts:497` | 拼起来的读模型（任务图、可做的任务、Goal 显示）在任务服务和 Host 里 | `views`（D-PLACEMENT L7、规则 R4）；正式事实和状态归约留在下面 | 结构设计；**第 2 片**（读模型）建 `views` 时一起 |
| PLACE-4 新 | `WG/sessions/message-record-codecs.ts:21,31`、`message-body-envelope.ts:12,39` | 管的是通信记录和正文格式，不是 Session 生命周期；queries、tasks、communication 都要 import | persistence，连同避免 `persistence → sessions` 所需的小校验 | 结构设计 |
| PLACE-5 新 | `WG/materials/record-readers.ts:190,284,370`、`run-snapshot-decoder.ts:17,36` | 通用的 Run/QueryRun 格式和解码放在材料目录，Sessions、Tasks、Queries、Communication 都在用；X1 去掉了重复解码，但归属还是材料 | persistence；材料授权读取留在 materials | 结构设计 |
| PLACE-6 新 | `WG/tasks/eligibility.ts:34`、`state/task-machine.ts:826,855` | 这个纯文件判的是和领取有关的业务分类，state 也在判 | 共用的判断进 state，候选结果的组装留在 tasks | 结构设计（和 DUP-9 一起） |

### 拆分（17 条，进下一阶段的结构设计）

行数是 HEAD 上 `wc -l`。拆法是 Codex 按文件里的自然分界提的，lead 没有逐个核对；状态机文件（SIZE-10 到 15）拆不拆、怎么拆，要和规格“一台状态机一张表”的写法一起定。

| 编号 | 文件 | 行数 | Codex 提的分界 |
| --- | --- | ---: | --- |
| SIZE-19 | `WG/tasks/plan-service.ts` | 2,702 | 方案和采用的准入与写入；图/可做/Goal 的拼读（适合 `views`，见 PLACE-3）；未来意图和版本编译；共用的范围和证据授权 |
| SIZE-12 | `WG/state/run-machine.ts` | 2,334 | 共用类型和守卫；进入和终止转移；控制转移；核对；分发 |
| SIZE-5 | `WG/communication/mailbox-service.ts` | 2,233 | 请求/引用/游标助手；可信身份和准入；正文/重放/提交；读取视图；命令 |
| SIZE-7 | `WG/evidence/evidence-service.ts` | 1,902 | 共用提交/读取/重放；开轮和定稿；检查操作；重新检查 |
| SIZE-17 | `WG/tasks/execution-entry-service.ts` | 1,821 | manifest 读取校验；准入和新鲜事实；效果到持久化；授权/开始/进入；结果记录 |
| SIZE-15 | `WG/state/verification-machine.ts` | 1,682 | 共用类型；轮次链和重新检查；折叠和判定准入；轮次/检查转移 |
| SIZE-8 | `WG/queries/query-execution.ts` | 1,676 | 记录/manifest/准入助手；领取/准备/进入；计量和观察；恢复 |
| SIZE-18 | `WG/tasks/plan-readers.ts` | 1,643 | 精确解码和加载；固定版本的读窗口；任务/Run/轮次折叠；未来意图适配 |
| SIZE-9 | `WG/sessions/session-directory.ts` | 1,606 | 引用/格式/游标助手；创建和登记；关联、卡片、目录查询 |
| SIZE-11 | `WG/state/plan-machine.ts` | 1,398 | 方案类型和基本投影；追溯和承载约束；准入和转移 |
| SIZE-2 | `src/business/workflow/workflow.ts` | 1,373 | 请求/操作构造；工作和返工挑选；执行分发；门面 |
| SIZE-14 | `WG/state/task-machine.ts` | 1,351 | 阶段投影；不可变归约和重新入队构造；转移守卫和效果 |
| SIZE-13 | `WG/state/task-failure.ts` | 1,276 | 失败和返工分类；自动化判定；失败读投影；拒绝记录 |
| SIZE-6 | `WG/configuration/project-bootstrap-service.ts` | 1,161 | 共用准入和重放；项目/工作区读写；完成策略安装、启用、读取 |
| SIZE-1 | `src/app/host.ts` | 1,155 | 设置投影；工作区登记和打开；输入和邮件投递；启动、接线和生命周期 |
| SIZE-10 | `WG/state/goal-machine.ts` | 1,150 | Goal 转移；扇出/恢复/停 Run 投影；显示事实 |
| SIZE-4 | `RT/session-operations.ts` | 1,022 | 有界历史和身份校验；真实 Session 创建；历史游标 |

对照：cbaed80 时 `src/` 里超过 1,000 行的是 16 个，其中 2 个是旧界面（`ui/main.ts` 7,633 行、`ui/views.ts` 2,529 行，任务 E 拆了），服务和状态机里 14 个；现在 19 个，全在服务和状态机里，共 29,508 行。变大的主要是第 5 步加的行为（例如 `plan-service.ts` 2,129 → 2,702，`run-machine.ts` 1,443 → 2,334）。

### 文档和代码（9 条，收尾全部改完）

| 编号 | 位置 | 不一致在哪 | 改在 |
| --- | --- | --- | --- |
| DOC-1 新 | `IMPLEMENTED-CAPABILITIES.md` WG9 | 标“已接通 / 内部已用”，但列的四个公开角色操作没有路由、Workflow 或脚本调用 | 1896ec6c：标题改为“内部已用；四个公开操作已实现、未接线”，加注写明在用的只有 `resolveRoleBindingFacts`（lead 查了它的 5 个调用方） |
| DOC-2 新 | 同上 WG10；`modules/core/work-graph.md` | `compareArchitecture/queryImpact` 和已接通的捕获、查询列在一起，其实只有测试调 | 1896ec6c：WG10 加注，和 WG14 的写法一致 |
| DOC-3 新 | 同上第 7、118 行、WG18、工作区表那一行；STATUS 第 161 行；source pin 两个文件的保留说明 | 还写着“第 3 片可能要用” | 删除后一起改（1896ec6c）：能力索引、`modules/core/workspace.md`、规格的简化同步注、设计书 §2.8、第 3 片那一行和简化表；STATUS 和 HANDOFF 留给收尾最后一段改写 |
| DOC-4 新 | 同上 RT9 | 写“返回完整领域 Read/WriteResult”，但邮箱读取工具成功时只回 `value`（`RT/communication-tools.ts:114`） | 1896ec6c：按代码写明各族的形状 |
| DOC-5 新 | `modules/core/workspace.md:5,368` | 把 `readWorkspace/compareWorkspace` 和 Git 历史写成以后的事，其实已接通文本子集（WS3、WS7；`src/core/workspace/workspace-tools.ts:53-54`） | 1896ec6c：两处加注，写明接通了什么、还缺什么 |
| DOC-6 新 | `modules/core/record-store.md:214,237` | 说 WG 材料入口保留 grant 和“当前来源”适用性，现在只有 Host 读历史说明和 Run 读自己的材料（`WG/materials/applicability.ts`） | 1896ec6c：两处加注 |
| DOC-7 新 | `modules/core/work-graph.md:151`（HEAD；Codex 写的 149 是改路径前的行号） | 按 AgentInstance、WorkParticipation、AgentPrincipal 写现行通信；代码里没有这条生产链，也没有 architecture_report 的 coordination grant，通信是 Host 或 work_run 发给 Session | 1896ec6c：加注标明是旧方案 |
| DOC-8 已知 | `state/verification-machine.ts:3,1598`、`RT/check-execution.ts:102` | 注释还写已删的 VR-06 | a37cc0e6 |
| DOC-9 已知 | `CORE-DATA-OPERATIONS.md:292,295` | 缺 GAP-45 的几行，`requeueTask` 没按 5.4 核对 | 333e398e |

## lead 核对了什么

删除类 8 条全部核对，其余抽查了 20 条，另外核对了全部 19 个大文件的行数。每条的结果都写进上面清单的“证据”一栏，这里只写方法。

- **生产可达**：`tests/architecture/production-reach.test.ts` 要求“走不到的节点”和允许清单完全相等（多一个、少一个都失败）。删 DEAD-6 之前它在 HEAD 上通过，说明那 22 个节点确实走不到；删完、去掉 22 条后它仍通过，说明没有别的节点因此变成走不到，允许清单正好 120 条。DEAD-9、10、11 的个数（37、21、62）从允许清单数出来，和 Codex 一致，而这个测试保证它们现在仍然走不到。
- **引用**：DEAD-6、DEAD-8 用 `git grep` 查了 `src`、`tests`、`scripts`、`tools`、文档；DEAD-1 到 DEAD-5 在 HEAD 上确认已删（DEAD-5 留下的是 switch 里的 `throw`）。
- **DEAD-7** 读代码推出来：两个条件互补，前一个返回了，后一个就不可能成立。
- **抽查的非删除类**：DUP-1（15 处位置都对，读了其中 5 处，和 `sameJson` 等价）、DUP-3（查询禁用白板和邮箱工具、`selectedTaskInputs` 是空的）、DUP-4、DUP-5、DUP-7、DUP-8、DUP-10（9 份逐字相同）、DUP-12（两族各自等价）、DUP-13、PLACE-1（check:architecture 的 40 条边、`scripts/import-graph.mjs` 的环）、PLACE-2、全部 19 个大文件的行数、DEAD-9/10/11 的个数、DOC-1、2、4、5、6、7（改文档前逐条对照了代码）。
- **检查**（WSL 槽位 s2，提交 7e0b7f56 的代码）：
  - `npm run typecheck` 通过；
  - `npm run check:architecture` 通过（40 条子模块边，`pure submodules: WorkGraph/state`）；
  - `npx vitest run` 跑 `tests/architecture` 和所有 import 了改动模块的测试文件，共 26 个文件、261 项全部通过，含生产可达和状态写入限制两项检查（日志 `w4-s2-tests-1`）；
  - `node scripts/import-graph.mjs`：WorkGraph 101 个文件，组级强连通分量 0、组级环 0；文件级强连通分量 2 个，都只靠类型引用，只含值引用的 0 个（`import-graph-head.md`）。
  - 全量测试和 `verify:isolated` 不在本段，留给收尾最后一段。预计比收尾第 2 段之后少 1 个测试文件、8 项（M1 那个文件 7 项，R3b 1 项）。

## 驳回和更正

没有驳回的发现。按当前代码更正或说明的有 4 处：

1. **PLACE-2 已过时。** Codex 审的是 a57edc1e，那时 `pure: true` 还没做；之后 820817c3 做完了。结论（保留）不变。
2. **DOC-3 的改法换了。** Codex 建议在文档里写明“已定、待删”；收尾直接删了 DEAD-6，所以文档写的是“已删”。
3. **DEAD-5 的删法不同。** Codex 建议先收窄效果的类型再删这一支；收尾第 2 段保留 switch 的穷尽检查，改成 `throw`，和同一处只属于重新检查的效果一样。效果相同：证据服务里不再有处理这种效果的代码。
4. **行号漂移。** Codex 审完以后又有 7 个提交，有几处行号变了：DUP-8 现在是 78、290；DOC-7 是 work-graph.md 第 151 行；`evidence-service.ts` 现在 1,902 行（Codex 数的 1,905，收尾第 2 段删了 3 行），`verification-machine.ts` 1,682 行。DUP-10 的“9 份”是对的：`app/collaboration-driver.ts` 的 `snapshotContext` 和三个工具里的 `snapshotContext` 形状不同，Codex 和 lead 都没算进去。

另外两点不是更正，是提醒：DUP-1 和 DUP-2 都说“等价”，但合并时类型能不能直接通过，Codex 没法跑 tsc，lead 也没试；状态机文件的拆法（SIZE-10 到 15）lead 没有评估，见上。

## 行数核对（决定 31）

**方法**和 STATUS“简化后的行数”相同：服务文件是 `src/` 下除状态机（`work-graph/state/`）和界面（`ui/`）以外的所有文件；每个文件按 `wc -l` 数（数换行符）；脚本 `linecount.py` 逐个提交读 git 里的文件内容，输出 `linecount.txt`。有一处不同：STATUS 的区域表用搬移前的目录，本页把各个旧提交里的文件按任务 D 的搬移表（0cd45508 的 18 个改名）换成新目录再归区域，所以 work-graph 各子目录的旧数和 STATUS 不一样，合计相同。复现了 STATUS 记的合计：cbaed80 70,226、31ea96d6 81,106、7f137117 77,495、2ba9b46b 77,502、0cd45508 77,532。

**按区域（服务文件）。** “现在”是 1896ec6c，源码和 7e0b7f56 相同。最后一列是收尾（0cd45508 之后：60d946ff、a37cc0e6、7e0b7f56）。

| 区域 | cbaed80 | 简化前 31ea96d6 | 简化后 7f137117 | 任务 D 后 0cd45508 | 现在 1896ec6c | 现在 − cbaed80 | 收尾 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| agent-runtime | 9,216 | 10,880 | 10,815 | 10,815 | 10,813 | +1,597 | −2 |
| app | 5,704 | 7,630 | 7,613 | 7,613 | 7,613 | +1,909 | 0 |
| business | 1,628 | 2,113 | 2,108 | 2,108 | 2,108 | +480 | 0 |
| composition | 712 | 1,137 | 1,101 | 1,101 | 1,101 | +389 | 0 |
| contracts | 6,616 | 6,640 | 5,929 | 5,929 | 5,918 | −698 | −11 |
| record-store | 3,275 | 3,275 | 3,275 | 3,275 | 3,275 | 0 | 0 |
| work-graph（根目录两个文件） | 313 | 313 | 313 | 313 | 313 | 0 | 0 |
| work-graph/architecture | 2,982 | 2,982 | 2,979 | 2,979 | 2,979 | −3 | 0 |
| work-graph/communication | 2,068 | 2,236 | 2,233 | 2,233 | 2,233 | +165 | 0 |
| work-graph/configuration | 3,076 | 3,076 | 3,076 | 3,076 | 3,076 | 0 | 0 |
| work-graph/evidence | 1,249 | 2,029 | 1,979 | 2,036 | 2,033 | +784 | −3 |
| work-graph/materials | 2,866 | 2,948 | 883 | 926 | 926 | −1,940 | 0 |
| work-graph/model | 1,302 | 1,503 | 1,464 | 1,410 | 1,408 | +106 | −2 |
| work-graph/persistence | 4,828 | 4,818 | 4,805 | 4,805 | 4,805 | −23 | 0 |
| work-graph/queries | 3,443 | 3,641 | 3,616 | 3,616 | 3,616 | +173 | 0 |
| work-graph/sessions | 4,238 | 4,550 | 4,547 | 4,547 | 4,547 | +309 | 0 |
| work-graph/tasks | 12,928 | 17,539 | 17,262 | 17,253 | 17,253 | +4,325 | 0 |
| workspace | 3,782 | 3,796 | 3,497 | 3,497 | 3,180 | −602 | −317 |
| **服务文件合计** | **70,226** | **81,106** | **77,495** | **77,532** | **77,197** | **+6,971** | **−335** |
| 状态机 `work-graph/state`（不计） | 10,936 | 13,837 | 13,729 | 13,729 | 13,730 | +2,794 | +1 |
| 界面 `src/ui`（不计） | 11,314 | 13,166 | 12,841 | 12,841 | 12,840 | +1,526 | −1 |
| `src/` 文件数 | 258 | 348 | 328 | 329 | 327 | | |

0cd45508 和 7f137117 之间：决定 29 加 7 行（tasks +6、model +1），任务 D 的 X2、X1 加 30 行（evidence、materials 增，model、tasks 减），搬移本身每个文件增删相等。

**按部分（cbaed80 → 现在）。** 前两列照抄 STATUS（cbaed80 → 7f137117）。收尾删掉的行用 `git blame` 查出最初是哪个提交写的，再记回那一部分（脚本 `blame-wrapup.sh`，逐行结果 `blame-wrapup.txt`）：

| 部分 | 当时提交的净行数 | 简化 | 第 7 步、任务 D | 收尾 | 现在 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 第 3、3b、4 步：写入改走状态机、删重复检查、删走不到的代码 | +399 | −19 | | | +380 |
| cbaed80 以前就有、生产走不到的旧代码 | | −3,584 | | −339 | −3,923 |
| 简化自己写下的行 | | +136 | | −11 | +125 |
| 收尾自己写下的行（改写的注释、`throw` 一支） | | | | +24 | +24 |
| **重构部分合计（规则：不超过 cbaed80）** | **+399** | **−3,467** | | **−326** | **−3,394，守住** |
| 任务 E 合入（前端拆分、SSE） | +547 | −1 | | | +546 |
| 第 5 步（5.1–5.10） | +9,694 | −143 | | −9 | +9,542 |
| 第 6 步的生产修正 | +240 | 0 | | | +240 |
| 决定 29（第 7 步） | | | +7 | | +7 |
| 任务 D 的 X2、X1 | | | +30 | | +30 |
| **合计** | **+10,880** | **−3,611** | **+37** | **−335** | **+6,971** |

收尾这一列的来历：

- 删掉的 359 行里，339 行是 5bd93abc（2026-09-27 抽出独立仓库时带过来的，早于 cbaed80）：source pin 两个文件 310 行，`material-access.ts` 里两个契约类型和注释 15 行，DEAD-7 的 3 行、DEAD-8 的 1 行，60d946ff 的 5 行（DEAD-1、DEAD-3），a37cc0e6 改写的 5 行注释；
- 11 行是简化自己写下的：77b517a2（G3）改写的 provider 注释等 8 行，d596ed18（G2）3 行（其中 1 行任务 D 搬移时改过 import 路径，blame 先落在 0cd45508，再往前追到 d596ed18）；
- 9 行是第 5 步写的：dc74d6f3（5.3）里 `guard_round_unchanged` 那一支和相关注释；
- 加的 24 行是收尾自己写的：60d946ff 11 行、a37cc0e6 7 行、7e0b7f56 6 行。

按提交：60d946ff −5，a37cc0e6 +1，7e0b7f56 −331，合计 −335。7e0b7f56 里 workspace −317、contracts −11、agent-runtime −3。

## 还没做（留给收尾最后一段）

- STATUS 和 HANDOFF：第 125、161 行等还写着 source pin 两个文件保留、允许清单 142 条；按本页改写。
- 全量测试和 `verify:isolated`。
- 最终报告：每个服务的净行数表就是上面的按区域表。

## 文件

| 文件 | 内容 |
| --- | --- |
| `codex-prompt.txt` | 给 Codex 的提示词（英文） |
| `codex-run.sh` | 运行命令 |
| `codex-run.txt` | 起止时间、退出码、token 用量、限制 |
| `codex-review.md` | Codex 的审查结果原文（英文），58 条发现 |
| `linecount.py`、`linecount.txt` | 行数脚本和它在 7 个提交上的输出（每个区域一行） |
| `blame-wrapup.sh`、`blame-wrapup.txt` | 收尾删掉的行按来源提交归属；`ADD` 行是每个文件加的行数，`DEL` 行是每一行删掉的来源 |
| `import-graph-head.md` | `node scripts/import-graph.mjs` 在当前代码上的输出（WorkGraph 的文件级和组级环） |

`linecount.py` 运行时生成的逐文件 JSON（约 116 KB）没有放进来。在任意含这些提交的克隆里运行 `python3 linecount.py cbaed80=cbaed80 pre=31ea96d6 simp=7f137117 d29=2ba9b46b moved=0cd45508 w2=9b75fda2 head=1896ec6c` 就能重新生成。
