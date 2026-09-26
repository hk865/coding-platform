# 已完成能力补迁与 R 系列对账

日期：2026-09-24。状态：**本轮已完成组件补迁和独立隔离验收：36 个测试文件、250 项通过，0 失败、0 跳过。整套 R2/R3 的新产品消费者与平台运行链仍未完成。**

用户本轮要求是先把已经完成的成果完整迁入 `coding-platform/next`，再继续未完成任务。本轮因此暂停新增 R3c 功能，按原验收范围补齐遗漏实现、工具、资源与测试。[首批 N0 报告](next-clean-migration-2026-09-24.md)保留当时的子集与结果，其“接着做 R3c”顺序不覆盖本轮要求；其中 115 项及代码行数也不是本轮补迁后的统计。

目标运行入口为 [next/package.json](../../../coding-platform/next/package.json)，原 `coding-platform/src`、`tests` 继续作为只读行为参考。目标实现不应回接旧服务来凑齐链路；旧产品仍服务于原入口，最终新产品切换和旧代码退役另行验收。

## 1. 原验收范围与当前实现

**R1 原始范围是完整架构材料读取的一次分析优化，不是“基础 types 17 项”。** [R1 原始证据](core-design-implementation-evidence.md)记录的真实链路为 `ProjectArchitectureSourceReader → captureArchitectureSource → ProjectSourceIndex.architectureMaterials`，生产净改动 +4 行，相关 3 文件 / 22 项。401 条导入场景中，全量捕获由旧循环推导的 6 次降为实测 2 次，关系提取由 3 次降为 1 次；来源最终核验仍保留。R4a 的 17 项恢复测试属于另一批次，不能移作 R1 的定义或证据，也不能从局部去重推导端到端加速。

下表的“原验收”说明已有行为的来源；“迁入证据”说明本轮目标内可检查的实现与测试。以下迁入组件已纳入本轮隔离验收；“尚未闭合”列仍是明确的后续工作。

| 批次 | next 实现落点 | 原验收与迁入证据 | 尚未闭合的消费者 / 原本未做项 |
| --- | --- | --- | --- |
| R1 | `core/workspace/project-source-index.ts`、`source-workspace-reader.ts`、`architecture-source.ts` | [原 R1](core-design-implementation-evidence.md)；目标 `tests/data/project-source-index.test.ts`、`workspace-capture-architecture.test.ts` 保留完整材料与图兼容断言 | 局部算法和 reader 已迁；新平台正式架构业务消费者尚未因此建立，不把旧 `control/source-architecture` 链的历史 PASS 当作 next 产品接线 |
| R2a | `core/workspace` 的已完成 reader、来源与语言实现；Python/C++ helper 位于 `next/scripts` | [原 R2a](implementation-batches.md)；补迁九个用途 reader，以及 candidate、探索来源、路径、验证工作树、完整图等原回归 | 旧 Context/Reviewer/verification/Query 消费者仍待对应目标业务承接；FakeWorkspaceReaderAdapter 的生产 fixture 入口不迁入目标生产代码 |
| R2b | `project-source-snapshot.ts`、`typescript-source-query.ts` 与共同消费它们的 `project-source-index.ts` | [原 R2b](implementation-batches.md)；目标 snapshot、query、reuse 三份原测试及 project-source-index 回归 | 冻结材料分析本体已迁；不把分析器复用等同全部语言统一 capture 或全部调用方切换 |
| R2c | `access.ts`、`capture.ts`、`source-query.ts`、`workspace-tools.ts`、真实架构 reader；Host 绑定逻辑迁入 `core/agent-runtime/source-capture-access.ts` | [原 R2c](implementation-batches.md)；目标 capture/access/architecture 测试，及新增 source-binding 独立测试 | 新 Host 的 canonical 事实提供者、共享架构服务生命周期与正式业务装配仍待接线；核心授权夹具不能替代这些消费者 |
| R2d.1 | `core/agent-runtime/project-source-tool.ts`、`exploration-tools.ts`、`observed-model-run.ts`、`source-tool-ports.ts`；模型预算与 run limits helper | [原 R2d.1](implementation-batches.md)；目标 `tests/app/project-source-tool.test.ts`、`tests/runtime/source-tool-lifecycle.test.ts`、exploration/reviewer 工具回归 | 工具协议、冻结分页和资源释放组件已迁；公开平台 `prepareExecution/startRun` 工厂仍为窄骨架，不能据组件存在宣布正式运行入口完成 |
| R2d.2 | `source-capture-access.ts` 中 Work/Review 绑定、最小 `source-binding-types.ts`；WorkGraph `source-authority-ports.ts` | [原 R2d.2](implementation-batches.md)；目标 `tests/runtime/source-binding-migration.test.ts` 独立校验既有身份、范围、fresh 资格与 DTO 隔离 | 原 ordinary/explore/Reviewer 生产链已验收，但 next 的事实 provider 和真实 Run 消费者尚未接通；由 R4b/c、R5 等目标运行/业务批次承接，不搬旧 LeasedWorkerRuntime、ContextCompiler 或 harness 代替 |
| R2d.3 | 同一绑定桥的 Query factory、原始 actor 解析、当前 QueryRun/QueryJob 重核与关闭逻辑 | [原 R2d.3](implementation-batches.md)；目标 source-binding 独立测试使用窄事实夹具 | next 尚无该窄 port 的生产事件页/记录提供者及正式 Query 业务调用链；旧 Query/HTTP 集成通过不自动延伸至 next。原一次模型启动扫描历史解析 actor 的成本也未因迁移消失 |
| R2e.1 | `text-source-snapshot.ts`、`workspace-read.ts`、capture/query 与 `project_source` 已支持分支 | [R2e.1 最终验收](R2e-1-sol-dsh-acceptance.md)；目标 `workspace-text-operations.test.ts`、`R2e-text-boundaries.test.ts` 及 `tests/runtime/source-text-loop-migration.test.ts` 的真实九轮模型工具回归 | 文本 capture、working_tree/capture 读取、paths/text 与同范围比较已迁；模型循环→工具→WorkspaceTools→冻结 Kernel 的九轮组件集成已通过；原完整派发/运行记录链仍随新 Runtime 接线。通用 Git 版本读取/比较、Python/C++ 统一冻结适配、GUI 文件 Host 入口原本尚未完成 |
| R3a | `core/record-store` 两后端/codec/guard；`core/work-graph/persistence`、`tasks/task-service.ts` | [原独立验收](R3a-R4a-sol-dsh-acceptance.md)；N0 的真实 Goal→RecordStore 装配；Sol 补齐事务边界、Goal replay，并与 R3b 四组新增测试由主审在隔离副本复现（合计14项） | Goal 子集不等于所有工作图命令、计划受理、任务资格与完整 bootstrap；不得为迁移该子集重建尚未交付的派发状态机 |
| R3b | `core/record-store/body-*`、`sqlite-body-store.ts`；`core/work-graph/materials` | [原 R3b](R3b-sol-dsh-acceptance.md)；目标原 body/material admission/await 测试、公开装配测试及新增并发边界测试 | 原 Host History/真实 Run 等已验收消费者仍需目标 Host/运行链承接；Reviewer、verification、memory 等整体消费与旧入口退出继续按各自批次完成 |
| reader/index 子项 | `record-store/lookup-*` 与两后端；`work-graph/materials/record-readers.ts` | [N0 reader/index 验收](next-clean-migration-2026-09-24.md)；目标 `lookup.test.ts`、`material-readers.test.ts`、`composition/platform.test.ts` | 这是此前已完成并保留的材料事实/候选查询前置。本轮不继续新增 R3c；它也不是新的 SourceAuthorityReads 生产 provider，不涵盖 QueryJob/ReviewWork 与 Query 原始提交事件查询 |
| R4a | 目标自有冻结 Kernel 公共产物与资源；`tests/kernel/R4a-frozen-public.test.ts` | [原 R4a](R3a-R4a-sol-dsh-acceptance.md)；[目标测试来源说明](../../../coding-platform/next/tests/kernel/README.md)：保留原恢复验收 17 项，另迁公共版本/完整历史 2 项 | 19 项冻结公共 API 测试不代表平台 Session/唯一占用/连续执行已迁；R4b/c/e/p 等平台能力、控制恢复、同工作区范围并行及 UI 仍需相应实现和真实接线 |

表中源码路径除显式说明外均相对 `next/src`，测试路径相对 `next`。本轮九个补迁 reader 为 `candidate-workspace-reader.ts`、`exploration-source.ts`、`query-workspace-source-reader.ts`、`readonly-read-witness-reader.ts`、`reviewer-source-reader.ts`、`role-source-reader.ts`、`source-workspace-reader.ts`、`verification-source-applicability.ts`、`verification-workspace-reader.ts`。这些原已完成的底层能力不能因为上层业务尚未迁入而被省略。

Python/Jedi 与 C++/libclang provider 和脚本资源是原有能力的迁入，保持真实引擎、配置、来源、权限、容量和 unavailable 边界；它们仍与未来统一冻结 provider 适配有别。[原能力盘点](workspace-remaining-capabilities.md)写于 R2e.1 完成前，其中“文本读取/比较待做”已经由后续验收覆盖，不能继续列作原本未实现。

## 2. 源码绑定的公开边界

[SourceAuthorityReads](../../../coding-platform/next/src/core/work-graph/source-authority-ports.ts) 是目标 WorkGraph 的窄事实契约，读取已经受理的 Workspace、Run、ReviewWork、QueryRun、QueryJob 和事件页；它不执行派发、提交、Session 或状态推进。[迁入桥](../../../coding-platform/next/src/core/agent-runtime/source-capture-access.ts)保留 Work/Review/Query 的实际授权规则，使用 [SourceRunSpec](../../../coding-platform/next/src/core/agent-runtime/source-binding-types.ts) 中真正读取的准备属性，不依赖旧 StateLedger 服务。

**当前该 port 的生产 provider 尚未接入。** 独立测试通过事实夹具提供已受理记录及原始 Query 提交事件，只能证明桥在这些事实上的行为。它不能证明新平台已经能够产生合法 Run/Query、持续推进、恢复或通过正式 HTTP/GUI 运行。`createTargetPlatform` 当前公开的 AgentRuntime / Workflow 操作仍是明确 unsupported 的窄骨架；补迁的模型工具组件与这些正式工厂的状态必须分别报告。

下一步应由目标 RecordStore/WorkGraph 提供真实事实读取，并由目标 AgentRuntime/Workflow 消费；不把旧服务适配器重新注入 next，不把尚未接线解释为另一套替代产品方案。

## 3. 独立验收与代码量

主 Agent 在只有目标工程实体文件及已安装第三方依赖链接的临时副本中执行 `node --run verify:isolated`。未复制原平台源码、旧服务或原测试 harness；全部测试使用临时数据库和本地脚本模型，未调用付费模型供应商。

| 检查 | 结果 |
| --- | --- |
| 全部目标测试 | **36 个测试文件 / 250 项 PASS；0 失败、0 跳过** |
| 目标边界 | PASS；5 个模块，5 条实际源码/类型依赖均在允许的 8 边内 |
| 类型 / 独立构建 / 构建产物加载 | PASS；实际加载编译后的工厂并创建、关闭平台 |
| 本轮追加独立范围 | R3a/b 14 项；来源绑定 7 项；真实文本工具循环 2 项；冻结 Kernel 19 项；资源缺失/替换反例 1 项；其他迁入原回归与 N0 套件一同运行 |
| 运行资源 | Python/C++ helper、Jedi/Parso archive、Kernel skill 等 12 个目标资源均存在并匹配冻结哈希；本机语言测试未跳过 |
| 原工程保存 | 原源码、原测试、Kernel 源码 **1313 个文件，修改/缺失/新增均为 0** |

证据：[隔离日志](evidence/next-completed-migration-2026-09-24/isolated-verification.log)、[来源与目标哈希](evidence/next-completed-migration-2026-09-24/transfer.json)、[最终目标哈希](evidence/next-completed-migration-2026-09-24/final-target-hashes.json)、[原工程保存](evidence/next-completed-migration-2026-09-24/reference-preservation.json)、[统计](evidence/next-completed-migration-2026-09-24/metrics.json)。Kernel 测试来源逐组列于目标测试 README；新 Sol 测试是独立适配的验收，不声称与旧整套集成测试逐字等同。

按物理行统计（含注释和空行），并单列非空行：

| 范围 | 文件数 | 物理行 | 非空行 |
| --- | ---: | ---: | ---: |
| next 生产 TypeScript | 117 | 12,415 | 11,774 |
| 其中共享契约 | 51 | 2,447 | 2,428 |
| 测试与测试辅助代码 | 38 | 7,192 | 6,837 |
| 工程检查脚本 | 2 | 278 | 272 |
| Python/C++ helper | 2 | 617 | 569 |
| 冻结 Kernel JS/声明（另计） | 138 | 19,762 | 19,752 |

源码从 N0 的 9,639 行变为 12,415 行，增加来自这次补齐能力与必要数据格式，不代表已回迁整个旧平台。未复制旧 StateLedger/Control/ContextCompiler 服务；QueryExecutionRequest 直接引用相同的持久 request 结构，裁掉仅用于提取参数类型的旧 ReadOnlyQueryPort。各用途 reader 保留原分工，没有新增业务 Module。

R1 一次分析、冻结捕获多页读取等已有收益保持。Query 原始提交者仍使用原有“一次模型工厂初始化扫描历史”算法；此次不悄悄替换成无依据 actor。它的生产 provider 和后续精确索引须随新 Query 装配实现。旧完整产品与当前部分目标不等功能，不能由行数差宣称整个重构复杂度或端到端性能已经达标。

## 4. 协作与关闭条件

本轮对已验收代码做机械迁移、依赖裁剪及必要装配替换，没有要求 DSH 重新编写已经通过的实现。原测试优先保留断言；Kernel 测试只经冻结公共入口访问，历史数据夹具留在 `tests`，不进入生产 fixtures。Sol 新增的独立边界测试继续由主 Agent 审阅、冻结并验收。后续需要新增实现或修复生产逻辑时，仍遵循 **Sol 骨架/测试 → 主 Agent 审阅冻结 → DSH 在独立范围实现 → 主 Agent 独立验收**。

本轮组件补迁已有最终 manifest、隔离验证及遗漏对账，范围内关闭；完整 R 批次关闭仍需要上表列出的目标生产消费者。不会因为目录、类型或测试夹具已存在就预报完成，也不会为补迁单个能力提前扩张未完成的 dispatch/session/业务状态机。
