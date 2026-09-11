# HumanCollaboration / WorkerRuntime 独立审查

审查范围：HumanCollaboration、WorkerRuntime，并抽查 app/harness/UI 的真实消费者与业务责任。只读阶段没有改动源码或规范。来源身份为同目录 baseline.json（2026-09-11T04:46:45.420Z）：产品 HEAD 65d270d75f3088d7baa4ef3a7c80fdaa62c3a38d，文档 HEAD 2f9a5df01175fb5686bb8bf02abc65216055a570；均包含已有未提交变更，不能只凭 HEAD 重现。

已读两根 AGENTS、PRODUCT、ARCHITECTURE、human/module-status、两 Module、runtime-collaboration、human-design-status、module-boundaries、ADR 0003。范围结论：两 Module 主责任大体归位；治理视图仍由宿主承担 ReadModelIndex 职责。真实 Run 的暂停/继续/换手和完整补料协作属于未完成能力，不能标为本轮发现的架构偏移。

| 原要求及出处 | 当前实现及位置 | 影响 | 类别 | 必要处置 | 验证证据/建议 |
| --- | --- | --- | --- | --- | --- |
| ARCHITECTURE:84、142-145、248：数据查询由 ReadModel 提供，交互不解析 canonical 状态裁决；module-boundaries 组合根段只允许组合适配 | src/app/governance.ts:555-733、971-1086 读取 canonical 与事件、组装治理/角色矩阵；公开类型也放 app，UI 从 app 导入 | 查询责任与宿主耦合，无法经正式 Module 查询接口复用；“投影会产生第二真相”混淆投影与权威状态 | A（主Agent已确认） | 公共类型移 contracts；读取/组装归 ReadModelIndex；保留 canonical active 对照、扫描缺口与 HTTP 字段，不新增持久权威；Control 角色判据注入 | 当前逐函数检查确认；后续治理 HTTP 回归、直接模块查询一致性、即时 active 更新与扫描缺口反例 |
| ARCHITECTURE:249-250：Runtime 承载内核、消费绑定输入与受限工具；观察保存交 Vault，不归约 Task | coding-agent-runtime.ts:75-170；read-only-query-runtime.ts:27-116；observed-model-run.ts；service.ts 真实运行/查询组合 | 正式运行、独立查询、Reviewer 复用内核；未知中断不重跑；未找到 Runtime 自行提交 Plan/Task 完成 | 一致（限定审查） | 保持，不机械合并不同运行语义 | 静态生产调用链：service → RuntimeDispatch/QueryDrive → Runtime；ArtifactVault RuntimeObservationJournal 保存公开记录 |
| HumanCollaboration Module Invariants、ARCHITECTURE:248：用户请求经 Control；报告资格交 Verification，材料交 Context | human-collaboration.ts:createGoal/goalView；exploration-session.ts:70-82、96-127、131-193；history-materials.ts:grant/view | createGoal 幂等身份贯穿；探索审阅保留 operator 来源，正式资格/归约委托现有模块；历史读取授权由 Control/Vault 保证 | 一致（限定审查） | 保留交互 journal 与领域步骤；头部 Lane/P1 施工措辞可在必要修改时清理，不扩大为全仓注释重写 | 已检查实际方法与注入端口，未把 view/report 当作正式 completed |
| PRODUCT 连续执行、runtime-collaboration 快照声明：不支持必须明确不可用 | unconfigured-capabilities.ts；coding-agent-runtime.ts:124；persistent-harness.ts:574；service 真实模式注入 unavailable 适配 | 真正暂停/继续/steer/换手、公开执行材料与反馈回流尚缺；诚实 unsupported 不算伪实现 | 尚未实现 | 保留下一阶段产品能力清单，本次不扩展 | 真实 capabilities supportsSnapshot=false；snapshot 默认 unsupported |
| 用户本次要求唯一当前状态，不用历史切片覆盖现实 | module-status:13 仍说写入型 Run 不可用历史，:39 仍说 requiredOutputs 扣留归约，与 :43 起 RW-18 摘要及 :144 module-boundaries 冲突；两Module尾部含旧路径/旧单任务限制 | 同一当前入口同时表达互斥状态，消费者误判断未实现/已完成 | 文档过时；具体后续语义来源确认前 C | 主Agent按实际接线和已核实决定更新唯一当前状态，保留旧段为具日期历史 | 逐段对照代码和上下层；不因旧测试 PASS 断言当前完整产品能力 |
| 用户要求后续决定必须有明确来源 | ADR 0003 原文只有 accepted/decided_by:user 自称，RW-18 原先只在 module-status 与 module-boundaries 转述，未找到独立用户原话记录 | 原审查时不足以把与 ADR 冲突实现判为 B | C 来源待核实（后续已由主Agent报告用户确认并登记 ADR 顶部） | 主统一记录本次确认来源与替代关系；保留 ADR 历史原文 | rg 检索权威根 ADR/RW-18 及产品 evidence；没有把 Agent 建议当用户决定 |

可读性：GovernanceEntry 原 1395 行把公共类型、命令入口、事件解析、只读视图、角色目录与解释混在一处，是本票必要收口。WorkerRuntime 的 preflight/prepare/start/execute 与独立 query 生命周期具有实际领域含义；不建议为编号清理拆转发框架。UI tasks/rework/governance 抽查为消费服务结果/提交明确操作，未见自行归约正式状态。app InitialPlanning 只协调 Compiler/Dispatch；triggerRework 属外部 Host 驱动已提交结果的允许接线，不把这一调用本身判成职责漂移。

验证尝试（原样保留失败）：`pnpm exec vitest run tests/interaction/human-collaboration.test.ts tests/context/query-execution-context.test.ts`，退出 1：`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`。当前 Windows pnpm fallback 试图先安装依赖；未设 CI、未删除/重装依赖。`Test-Path node_modules/vitest/vitest.mjs` 为 False。此轮没有行为测试 PASS，主Agent将统一使用已授权 WSL 工具链。静态审查命令包括 `rg --files src`、`rg -n` 定位上述方法/依赖/决定、`Get-Content` 读取精确文件；不是全仓测试或浏览器验收。
