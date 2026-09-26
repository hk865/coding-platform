# coding-platform 独立目标工程

**当前状态（2026-09-27）：按用户要求冻结施工并保存 next 与文档，准备独立 main 提交和继续入口；不启动新批次。** A1 仅 prepare、未 run，已停止；Work-control 保持已预审草稿，R3g 未派发。R6 graph/history 已[精确导入](../../docs/refactor/reviews/evidence/next-b2-2026-09-26/r6-graph-history-consumer-implementation-import.json)，固定22项、Node/UI types及构建通过，[最终只读浏览器复验](../../docs/refactor/reviews/evidence/next-b2-2026-09-26/r6-graph-history-browser-final.json)通过；不宣告完整MVP完成。恢复施工须先按[交接入口](../../docs/refactor/HANDOFF.md)核对既定产品范围与现有证据。

2026-09-26。后续重构代码在本目录开发，原 `../src`、`../tests` 是只读参考。这里仍属于同一个 Git 仓，但拥有自己的源码、配置、装配与验收入口；实现不导入旧平台服务。

**最近完整隔离基线：124 文件 / 1,102 项通过（exit0）。** 该副本包含R4.3b与R6执行入口最终导入，以及[W2一行机械调用次数断言删除](../../docs/refactor/reviews/evidence/next-b2-2026-09-26/r4-r6-w2-fixture-amendment.json)；Node/UI types、构建、7/8边界、7源/28产物逐字再生、编译composition与真实token保护Host smoke均通过。见[结果](../../docs/refactor/reviews/evidence/next-b2-2026-09-26/r4-r6-isolated-result.json)、[通过日志](../../docs/refactor/reviews/evidence/next-b2-2026-09-26/r4-r6-isolated-recheck.log)及保留的[首次失败日志](../../docs/refactor/reviews/evidence/next-b2-2026-09-26/r4-r6-isolated-final.log)。快照不含其后的graph/history骨架与实现，不能据此证明当前全部源码整体通过；本轮未重做旧8,827文件全hash比较，不沿用旧快照结论。

R4.1持久queued控制与fresh屏障、Git固定commit读取/比较、R3e注册检查/Evidence五生产实现、Query pending受理两生产实现均已独审导入。R6本地工作台六生产实现也已[导入](../../docs/refactor/reviews/evidence/next-b2-2026-09-26/r6-host-workbench-implementation-import.json)：2文件15项、Node/UI types和构建通过。真实浏览器已跑初始化→Plan→采用/观察结构和任务图、文件分页/捕获版本读取、第二scope无策略Goal及原请求重放；最终三项UI修正已审，最终版本无review配置HTTP重开可读原Goal/TaskGraph。最终[真实浏览器复验](../../docs/refactor/reviews/evidence/next-b2-2026-09-26/r6-final-browser.json)及[截图](../../docs/refactor/reviews/evidence/next-b2-2026-09-26/r6-final-browser.png)已完成：现成Chromium Headless保留原sandbox、临时独立profile，经原生DevTools输入连接真实Host/SQLite；Goal ID输入后Tab保留下一框焦点，无review重开可读Goal/TaskGraph，capture响应延迟700ms时切B不受A响应污染，切回A已capture ready。 本轮main核心/Host集成[13文件47项串行通过](../../docs/refactor/reviews/evidence/next-b2-2026-09-26/cohort-core-host-integration-tests-serial.log)，[types](../../docs/refactor/reviews/evidence/next-b2-2026-09-26/cohort-core-host-integration-types.log)及[7/8允许边界](../../docs/refactor/reviews/evidence/next-b2-2026-09-26/cohort-core-host-integration-architecture.log)通过；[首轮并发超时日志](../../docs/refactor/reviews/evidence/next-b2-2026-09-26/cohort-core-host-integration-tests.log)保留。该专项是当时的局部结果；最近完整隔离范围见顶部124文件/1,102项快照；R6后续Session/mailbox与限定执行消费者的已导入状态见下。

Workflow `advanceWork`、Query执行/Answer、Answer→初始Plan/采用及正式Task/Goal完成已独审导入。R6 Session/mailbox、三栏/页签/完整原始历史与调查/规划执行入口也已导入；[最终真实CUA](../../docs/refactor/reviews/evidence/next-b2-2026-09-26/r6-execution-entry-browser-final.json)一键Query→Plan→两个Work→checks→正式Goal COMPLETED通过，完整回答默认收起可展开，任务图直接显示 `TaskGraph.completion`，optional未来意图保留。R4.3a控制投递/观察和[R4.3b取消历史消费](../../docs/refactor/reviews/evidence/next-b2-2026-09-26/r4-terminal-history-implementation-import.json)已导入，取消后同Session下一正式Task可消费投影前缀，原历史/推理/实际结果不变。该限定链使用受控模型回复及真实Host/Kernel/SQLite，不代表完整MVP/UI或全生命周期完成；Task→当前Run/原Session/原窗口与完整Session历史消费者已最终导入并完成真实浏览器验收，恢复及其余产品范围继续。见[HANDOFF](../../docs/refactor/HANDOFF.md)及[能力索引](../../docs/refactor/IMPLEMENTED-CAPABILITIES.md)。

**最近完整 B1/W1 隔离基线：** 78 个测试文件 / 726 项物理隔离通过。现有模型循环支持受信 Skill/Hook 及首次有效使用时打开源码工具；现有 Plan 接口支持 Host 对未来任务的修改、取消和拆分，并保持未变任务的状态来源和历史。当时正式 Role→执行、观察归约/释放及 Agent 白板工具/Workflow 自动推进仍待完成；后续进展以上方在途状态为准。见 [本批报告](../../docs/refactor/reviews/next-b1-w1-2026-09-25.md)；下文 A1 及迁入结果保留为前序能力。

本批迁入并验收：WorkspaceTools、Goal 创建领域操作、材料准入/正文、Memory/SQLite RecordStore，以及 R3c 的材料事实与候选索引读取子项。本轮另补齐 26 个 Workspace 实际文件、Python/C++ provider 与运行资源、模型源码工具循环，以及 Work/Review/Query 来源绑定；初始Plan/任务事实查询和Session创建/目录/历史/故障重试已接通；本批角色规格和持久源码观测/邻域/比较/影响也已接入组合根；现有模型循环已透传冻结Kernel连续历史和执行身份，新增Plan v2关系/精确输入，候选不再要求前驱整个Task完成，实际输入经readTaskInput复用材料当前授权；Task领取已接入platform.claims，同事务建立Lease/Attempt/Run/outbox和Session占用，原回执可查询；执行精确事实已接入platform.executions，Kernel定向原始历史已接入runtime.readExecutionHistory；图定位历史读写已接通，Kernel分页复用主键范围读取；Source精确事实组件已接真实Material reader，该迁入阶段正式AgentRuntime执行与Workflow仍unsupported，UI未迁；后续Runtime进展见上方。

最新 A1 另接通正式初始架构目录、Session 与 Module/Task 的关联开闭、目标索引发现、显式归档/重新启用；真实 SQLite/Kernel 重启保留关系与历史。Session 未关联模块时仍可在正式目录建立前创建。完整依据：[产品](../../docs/PRODUCT.md)、[架构](../../docs/refactor/ARCHITECTURE.md)、[用户纠偏](../../docs/refactor/intent/2026-09-24-TARGET-PROJECT.md)、[A1 验收与后续任务](../../docs/refactor/reviews/next-a1-graph-session-2026-09-25.md)。详细接口设计是目标；本 README 说明实际已交付范围。开始施工必读[已实现能力与复用入口](../../docs/refactor/IMPLEMENTED-CAPABILITIES.md)的相关条目，再沿源码与测试核对；不要重建已经存在的解析、归约、事务和模型循环。

## 目录与调用路径

```text
next/
├── src/
│   ├── business/workflow/     # R5c有限推进；已有Plan与初始Plan消费者已实现
│   ├── core/
│   │   ├── work-graph/        # Goal、Plan/领取、Session关联/归档、Catalog、材料、角色和源码观测
│   │   ├── record-store/      # 单连接事务、正文、注册索引
│   │   ├── workspace/         # capture/read/query/compare/verify + 用途 reader
│   │   └── agent-runtime/     # 模型工具/来源绑定；Session创建/历史；B2 prepare/start/observe
│   ├── contracts/            # 当前子集实际引用的结构与纯判据
│   ├── app/                  # loopback Host、显式核心HTTP路由和JSON启动入口
│   ├── ui/                   # 原生DOM工作台与图/文件展示
│   └── composition/          # createTargetPlatform
├── tests/                    # 独立检查与迁入行为回归
├── scripts/                  # 模块边界与隔离验证
└── vendor/coding-agent/      # 冻结的 Kernel 公共运行产物
```

```mermaid
flowchart TD
    UI[本地工作台] --> Host[可信 loopback Host]
    Host --> Composition[createTargetPlatform]
    Composition --> WG[WorkGraph: Goal / Plan / Task claim / Sessions / Catalog / Materials / Roles / Observed graph]
    Composition --> WS[WorkspaceTools]
    Composition --> RT[AgentRuntime: Session / prepare / start / observe / 原历史]
    RT --> WG
    RT --> KS[冻结 Kernel SessionStore]
    Composition --> WF[Workflow有限推进]
    WG --> RS[RecordStore]
    WG --> WS
    RS --> Memory[Memory]
    RS --> SQLite[SQLite]
    WS --> Kernel[冻结 Kernel 公共文件访问能力]
```

模块边界门禁使用完整目标的 5 模块/8 条允许边，Workflow骨架中审时实际 import 为 7 条（含窄事实读取类型）。图中的装配和物理后端不是新增业务模块。端口类型引用也计入静态依赖；不能用边数判断功能完成。

## 使用与验证

使用工作区现有 Node 24 和第三方依赖；没有要求重装依赖。运行：

```sh
source /home/hyh001/projects/coding-platform/.toolchain/env.sh
cd /home/hyh001/projects/coding-platform/coding-platform/next
node --run verify:isolated
```

验证器把本目录复制到临时目录，不复制旧平台源码，只连接已安装的第三方包；随后检查边界、类型、构建、当前完整测试集，并真正加载构建产物创建/关闭平台。静态门禁同时检查路径别名、动态加载、源码符号链接、依赖包、冻结 Kernel 的导入闭包及非代码资源哈希。它不是通用的恶意代码安全沙箱；DSH 的文件写权限另由工作区 runner 限制。

可单独运行 `node --run check:architecture`、`node --run typecheck`、`node --run build`、`node --run test`。本目录已有R6本地工作台；构建后使用 `node dist/app/main.js <workbench-config.json>` 启动。配置沿 [main.ts](src/app/main.ts) 的 `WorkbenchCliConfig`：指定SQLite目录、固定human/system actor、工作区根/版本/读前缀；可选review初始化资料和TypeScript架构来源。启动只打印无token的loopback地址，临时token由同源HTML交给UI。CLI JSON可提供受信 `runtime` 配置（纯JSON的bindings/queryProfiles），经原Host装配模型客户端；启动服务本身不执行模型，用户显式调查或规划执行才进入对应流程。未配置Runtime保留只读/初始化入口。

可运行[A1 图关联演示](scripts/graph-session-demo.mjs)：

```sh
node --run build
node scripts/graph-session-demo.mjs
```

它在自建临时目录中仅初始化 Project/Workspace，再通过真实平台入口创建 Kernel Session、采用目录、挂靠模块、发现两个待命 Session、归档、重开数据库和重新启用。默认清理自己的演示目录，传 `--keep` 可保留。演示不调用模型，不代替产品 bootstrap、Skill 装配或咨询功能。

## 装配边界

`src/composition/create-platform.ts` 的异步工厂接收 Memory/SQLite 存储选择和可信 `WorkspaceHostBindings`，返回 `projects/completionPolicies/goals/plans/claims/executions/controls/sessions/materials/messages/roles/architecture/queries/evidence/checks/workspace/runtime/workflow/close`。它自行创建目标 Store 和材料 reader，不接受旧 Ledger、ReadModelIndex 或 ArtifactVault 实例。Host 负责提供真实的工作区定位与访问授权。

SQLite 路径由调用者指定，本批只在临时测试/演示目录验证，未操作用户已有业务数据库。迁入现有文件格式不等于已完成整库升级：当前 schema 注册 Goal、Plan/任务事实、领取 Attempt/outbox、Session/关联、正式 catalog、材料、角色与源码观测所需记录；未迁操作仍不支持。Goal 创建需要已受理的 Project/Workspace，初始计划与初始架构采用已接通，R5a公开初始化writer及R6人用入口已接通；无Plan Query→Answer→初始Plan消费者已接通；人用限定调查/规划执行入口已接通，其余UI消费者继续；不以任意原始写接口替代业务。

`vendor/coding-agent/dist` 与 `resources` 是实体文件的冻结依赖，不是旧源码链接。Kernel 的原 package.json 保留来源元数据，其开发脚本不作为本产物的构建入口。对应哈希、来源和本批状态见验收记录。后续 Kernel 改动必须单独验收并重新冻结。本轮范围读取的受管补丁源与可再现构建入口见 [Kernel README](vendor/coding-agent/README.md)，最近完整隔离核验7源/28项受管产物。

## 后续施工

继续采用 **Astra 架构/接口 → DSH 4.1F 骨架与测试 → Astra 审核冻结 → DSH 实现 → Astra 审阅 → 隔离测试**。已迁范围在目标工程内部删除重复实现；旧参考源码在最终产品切换前保留，不继续新增旧装配适配层。

按[实施方案 §0](../../docs/refactor/IMPLEMENTATION-PLAN.md)保留完整 A/B/C/D 路径：A1 已交付上述图关联子集；B 接角色/Skill/材料装配、真实 Kernel 进入、观察归约与占用释放；C 接沿图咨询、Session 定址消息及秘书/参谋/书记 Skill；D 接控制恢复与重组。B 的具体复用与调用顺序见[Runtime §7.1](../../docs/refactor/modules/core/agent-runtime.md)，C 的协议/Skill 准备可并行。正式Runtime平台通信/白板/材料工具消费者已由C2接通；Workflow实际推进、Query执行/answer与初始Plan消费者已经独审导入，其受信Host/UI一键执行入口已导入并通过限定真实浏览器链。超出 W1 的 R3c 完整授权计划变更、后续正式架构演进、R3e/f、R4 余项、R5/R6 仍开放；R3g 记忆与知识库不作为当前交付前置；初始计划、Task 领取、图历史定位与本批 A1 不重做。角色解析不授予执行许可，observed 图不替代正式 baseline。

## 补迁组件的使用边界

`core/agent-runtime/observed-model-run.ts` 已能经冻结 Kernel 执行模型与工具循环；`source-capture-access.ts` 保留已受理 Work/Review/Query 的身份、范围和当前资格检查。后者的 Work 路径消费 WorkGraph 的 `SourceSnapshotReads`，已有 `createSourceAuthorityReader` 组件；Query 原发起者路径仍要求完整 `SourceAuthorityReads.events`，Query pending公开受理与原事件locator已有；真实Query执行/来源消费和answer链已接通，后续Host执行配置沿同一来源权威适配。B2 `startRun` 已有独立子路径证据；这些迁入组件本身不证明连续 Session、控制恢复或完整产品已完成。

Python provider 使用目标内冻结 Jedi/Parso archive 和 helper；C++ provider 另需宿主 Python 3/libclang，缺引擎明确报告不可用。`runtime-assets.json` 锁定 helper、分析依赖包与 Kernel skill 文件，避免新副本缺资源却通过类型检查。本机隔离验收实际执行了这些语言测试，未跳过。
