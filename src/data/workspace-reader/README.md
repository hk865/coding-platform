# WorkspaceReader：源码材料

读取源码并提供带范围、位置、来源摘要的查询材料。

## 源码入口

- [source-index.ts](source-index.ts)
- [source-applicability.ts](source-applicability.ts)：按明确可读文件集复核来源 pin
- [exploration-source.ts](exploration-source.ts)：保留完整探索目录的摘要语义与宿主读取复核
- [workspace-reader-adapter.ts](workspace-reader-adapter.ts)

## 边界与接线

source-index 保留限定文件集查询；project-source-index 提供 TS/JS 项目配置与语义服务。source-workspace-reader 按显式基线映射读取真实源码图；workspace-reader-adapter 的夹具仅供原协议测试。

## 修改与验证入口

涉及职责或策略时读 [Module 规范](../../../../agent_learn/agent_dev/agent_platform/dev_docs/modules/data/workspace-reader.md)。 完成状态与实施顺序统一看 [module-status](../../../../agent_learn/agent_dev/agent_platform/human/module-status.md)，本页不维护第二份状态表。

相关测试：[tests/data](../../../tests/data)。构建与测试命令以 [package.json](../../../package.json) 为准；WSL 前置与独立 runner 见 [产品 README](../../../README.md)。测试结果须说明真实 Adapter、模型夹具或外部模型的边界。


新增 [project-source-index.ts](project-source-index.ts) 和 [python-source-index.ts](python-source-index.ts)，实际工具为 project_index/python_index；完整边界以 WorkspaceReader Module 为准。TS 项目服务复用 Language Service，Python 经隔离源码副本运行 Jedi；C++ 仍未实现；TS/JS 正式图由 source-workspace-reader 提供，完整上层架构消费者未闭环。

## 路径边界与「角色源码索引」（RC-02）

[denied-prefixes.ts](denied-prefixes.ts) 是本 Module、也是整个平台**唯一的拒绝前缀来源**：哪些路径连列目录都不能出现，只在这里定义一次（内核默认的 `.evaluator`／`.oracle`／`hidden-tests` + 平台追加的 `.git`／`.env`／`.env.local`／`.platform-runtime`）。本 Module 的三个读取器（[source-workspace-reader.ts](source-workspace-reader.ts)、[query-workspace-source-reader.ts](query-workspace-source-reader.ts)、[role-source-reader.ts](role-source-reader.ts)）都 import 它，不再各写一份字面量；[tests/contracts/module-ownership.test.ts](../../../tests/contracts/module-ownership.test.ts) 守住「声明处唯一 + 模块内只引用」。

仍逐字复制这组值的调用方还有三处：`execution/worker-runtime/coding-agent-runtime.ts`、`execution/worker-runtime/read-only-query-runtime.ts`、`control/verification-engine/command-check-provider.ts`。它们属于各自 Module 的写入范围；其中 WorkerRuntime → WorkspaceReader 已是声明的依赖边，而 VerificationEngine → WorkspaceReader **不是**（ModuleDependencyDAG 里没有这条边），所以那一处收敛需要先有架构决定，不能顺手加一条未声明依赖。注意与各语言索引里的 `ignored` 集合区分：后者决定"哪些文件进入索引"，与沙箱的拒绝前缀不是同一件事。

[role-source-reader.ts](role-source-reader.ts) 是「角色必读材料 code」通道的宿主侧**有界**读取（RC-02 从 `data/context-compiler/role-source-index.ts` 归位）：工作区的列举、读取与路径边界适配属于本 Module，ContextCompiler 侧只消费 `contracts/role-material-channels.ts` 的窄端口 [RoleSourceIndexPort](../../contracts/role-material-channels.ts)。权限（信封有没有 `read`）、版本（信封的 workspaceSnapshot.revision 与 canonical Workspace 是否一致）与上限造成的缺项由 ContextCompiler 判定并如实写进 gaps，这里只负责读，不授权、不放宽。

为什么「code」不走 `WorkspaceReadPort` 的图读取：那个端口把读取钉在**计划固定的架构基线 sourceBinding** 上，而产品安装的基线今天不含 `sourceBinding`（ADR 0003 D2 未开始），对普通运行恒返回 `unsupported`。用它做这条通道，会让「装了 executor 规格的普通运行起不来」原样存在，因此这里复用的是同一批既有实现里不依赖基线的那一份能力——内核的工作区读取。
