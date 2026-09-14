# 文档准备后的测试执行与新对话交接

2026-09-14。本次已编写 [功能矩阵/场景卡](functional-test-matrix.md)、[缺口台账](functional-test-gaps.md)。用户随后明确：架构缺陷查找、基础功能测试及 I01–I04 全部在新对话执行；当前仅准备交接。本文件是待执行方案，所有下列产品测试命令均未在本轮执行。S 的接纳身份见 [snap-07 报告](post-m-architecture/acceptance/snap-07/acceptance.md)，阶段状态见 [coverage](coverage.md)。

## I 前准备的有界完成条件

1. 核当前源码相对 snap-07 的差分；当前包含未提交用户/C/M/S 改动，不能 reset 或以 HEAD 代替工作树。
2. 逐张 F01–F13 场景卡核已有断言。完成 FP01/FP02：记录测试文件、用例、具体预期、替身和实际入口；补缺失的基础契约/模块集成测试，先定向执行再修复真实失败。
3. 对 FP04/FP06 固定故障边界及旧库样本，数据清单含 schema/来源/摘要/恢复步骤。必须能核副作用次数，而非只看最终一行状态。
4. 对 FP05 确认环境能启动。每项未决问题仅阻断对应场景，不要求提前执行完整 I01/I02。
5. 再细化正式 I Ticket；目前规划目录未发现独立 I01–I04 文件，范围取 PLAN §7.6/§10.1（以当前章节标题核对）。本方案不代替正式 Ticket，也不提前标其完成。

## 基础集执行顺序

先核 package.json：Node 要求 `>=24.15.0 <25`；有 native/SQLite/隔离依赖的测试优先复用已验证的 WSL 工具链。命令在产品根执行，构建与消费同一产物的测试串行。

```text
node scripts/source-snapshot.mjs --diff evidence/collaboration-memory/batch/post-m-architecture/final-source-snapshot-07.json
pnpm typecheck
pnpm ui:typecheck
pnpm check:architecture
pnpm exec vitest run tests/memory/maintenance.test.ts tests/memory/context.test.ts tests/memory/host.test.ts
pnpm exec vitest run tests/read-model/shared-detail-adapter-equivalence.test.ts tests/read-model/shared-projection.test.ts tests/read-model/completed-work-merge-visibility.test.ts
pnpm exec vitest run tests/coordination/material-isolation.test.ts tests/coordination/route-drive.test.ts tests/coordination/route-continuity.test.ts
pnpm exec vitest run tests/control/scoped-dispatch.test.ts tests/integration/query-result-recovery.test.ts tests/app/durable-wake.test.ts
```

上述为起始定向集，不是全部义务的覆盖承诺。F01 的 Evidence/归约、F05 运行类型、F10/F12 的具体反例先按 FP01 读断言，再追加精确文件；不可把整个 tests 目录当作一条覆盖记录。真实内核请求、process-recovery、浏览器先完成必要构建和隔离能力检查；不能关 sandbox 来得到通过。若实现没有改动且可信的同快照基础证据已足够，记录适用理由，无需重复运行同一集。

## I01：同一用户场景与分支

使用一个隔离的小型 Coding 项目 A，任务建议为“给现有待办产品增加筛选与统计，两个工作包共同使用一个数据接口”。题面只给目标和验收要求，由产品角色生成计划/工作与依赖，执行者不预写中间完成事实。项目 B 用于隔离验证。用户此前给的 to_do_list_show、herdr-master、1.Robotic、Claude-Code-main 和 WSL SLAM 仓库只作为候选，先核类型/依赖和工作树，再复制至隔离工作区；不直接在原项目注入故障。

| 段 | 操作与分支 | 同一轮必须串联的记录 |
| --- | --- | --- |
| N1 正常计划 | 从主 UI 提交需求，让协调角色拆分，两个调查 Work 共享本地规范 | Project/Goal/Plan/RoleBinding/Work/Run，正文版本、精确授权、Delivery |
| N2 偏好 | 同一 Task 保存“全部简洁”，纠正为“架构解释详细、进度简洁”，下一回应、临时例外、删除 | profile revision、purpose、selected/input/provider/回答；隔离原话并重启，必要时触发真实压缩 |
| N3 局部经验 | 公开记录有条件的项目习惯，下一次拆分/进度/交接使用，再改变前提 | WorkNote 来源、条件、采用说明、失效后排除 |
| N4 冲突决定 | 在测试失败前提出接口分歧，基于同一前态分别试接受/修改/拒绝/延后 | 报告/决定版本、全影响 Work 清单、投递/采用/失败、未影响工作继续；四分支不串改同一前态 |
| N5 执行完成 | 真实执行、工具验证、必要 Reviewer、正式 Evidence、Task/Goal 归约 | 工具输出、变更来源、当前适用 Evidence，Claim 不是完成 |
| N6 恢复/项目切换 | 正常轮次完成后独立故障轮次重启；切 B 验用户随行与项目隔离、显式复制 | 新进程身份、恢复持久路径、无重复调用；profile/project revision 与来源 |

确定性轮次使用真实 Host/Ledger/Vault/Context/Dispatch，模型响应可注入以稳定制造分支；不能注入最终状态。真实模型轮次使用产品配置与实际内核，不把脚本生成冲突报告称模型主动发现。若自然任务未出现故障或冲突，记 not_exercised，另跑协议分支。

真实模型开测前验证已配置服务商、Base URL、模型 ID 与可用能力，不从“支持 image”的用户描述推断接口已经兼容。凭据本地读取，不复制密钥到文档/日志；保留脱敏配置摘要。先写评分：架构解释是否说明边界、理由与影响；进度是否包含完成/剩余/阻塞；接话是否按当前问题与偏好回应。保留改前改后原始回答，输入标记命中不能替代行为评分。单长会话与关闭协调层对照使用相同模型/工具/任务/窗口及干净工作区；未做对照就不宣称效率或成功率提升。

## I02：跨入口与故障组合

按 F03/F04/F05/F10/F12 参数化 ordinary、并行、Query、Reviewer、Handoff、规划/Rework、取消。每种适用入口覆盖：提交后 wake 前；已领取未启动；授权后 provider 前；外部动作后回执前；结果已存/投影未进；取消落账后 caller 退出；决定落账后逐 Work 回流前。非适用格写原因，不填 PASS。

用 barrier/故障 hook 固定边界，以新进程重启并重开同一隔离数据。记录 invocation/action 序号、Run/round/generation、事件游标、来源与 grant 版本。组合增加撤权、RoleSpec 更新、WorkMemory/source pin 变化、旧 generation 迟到、双消费者竞争与相同本地 ID 的跨 Goal 干扰。未知外部结果必须保持 unknown/reconcile/quarantine 到证据足够。旧库记录来源版本与升级前后预期，不用新库 reopen 充数。

## I03：计划修改收口后集中回归

先完成所有修改，串行执行 `pnpm build`、必要的 `pnpm verify:ui-build`，因为后者也会重建，必须在最终冻结前结束。随后固定源码、配置脱敏摘要、上游版本与最终 dist 指纹，再执行 `pnpm test`、`pnpm typecheck`、`pnpm ui:typecheck`、`pnpm check:architecture`、`pnpm ui:test`；文档根执行 `node dev_docs/verification/validate-docs.mjs`。记录 browser webServer 实际启动的产物身份。测试结束复算源码/产物；若测试脚本重建，核来源与结果，不能悄悄换产物。

性能复用 S 数据与方法，明确当前运行环境、64/256/1024 等规模、相同查询负载、预热和重复次数，保存各次耗时与内存/prepare；阈值在运行前取产品要求或可解释历史基线，不临时放宽。prepare 计数不称物理页读取。UI 条件跳过如实报告。

全量失败先保留日志，集中修复、定向复验；是否再全量按影响裁决并记录。输出不得把多快照局部 PASS 拼成一次全集通过。

## I04 与结果格式

独立方只读精确输入，按本矩阵、PLAN 近期项与 A1–A8 核证据；审阅生产入口、唯一状态/授权/选材 owner，不能只数测试。交付含差分、迁移和恢复方法、失败与重验链、实模型效果边界及明确延期。每条场景填：用例 ID、需求章节、命令、退出码、通过/失败/跳过、环境、模型/替身、源码/配置/构建指纹、日志、关键断言、未覆盖、缺陷 ID。没有实际执行的格保持未执行。

公开基准的隐藏测试、gold patch 和预期答案与被测 Agent 隔离；已读答案的任务不计盲评。正常轮次和故障轮次单列，不能改官方任务后继续报告官方可比成绩。

## 可直接放进新对话

> 在本新对话执行架构缺陷查找、功能测试准备与测试，以及 I01–I04。从 `evidence/collaboration-memory/batch/functional-test-matrix.md`、`functional-test-gaps.md` 和 `functional-test-execution.md` 接续。S01–S05 已接纳 snap-07，但未证明当前整批功能通过。上一对话只做了文档准备与部分断言静态盘点，没有运行产品测试，也未启动 I01–I04；缺口表中的待核项不是已确认产品缺陷。先核工作树与 S 基线，逐场景核规范、架构责任和已有断言，补缺失基础契约/模块集成测试，处理发现的缺陷并准备环境、故障观察点和旧库。然后按 PLAN 细化并执行 I01–I04：同场景 E2E/实模型归 I01，跨入口/故障/旧库归 I02，固定版本集中回归归 I03，独立产品验收归 I04。以原始对话和正式规范判断行为，保留所有用户改动与历史证据；不得用结构 PASS、替身回答或测试数量替代功能证据。
