# 平台内置 Coding Agent

用户于 2026-09-07 决定将 coding-agent 直接复制纳入平台目录。本目录保存执行内核源码，与平台一起由外层 Git 仓库管理。平台继续负责跨 Run 的规划、调度与事实归约；内核通过既有公共 API/CLI 处理单次 Run。

## 来源与更新

导入来源、commit、源工作区未提交改动、逐文件 SHA-256 和本地适配记录见 [UPSTREAM.json](UPSTREAM.json)。本次使用源工作区实际内容，包含三份未提交的开发文档；该清单描述导入时快照，后续修改通过平台 Git diff 追踪。

更新内核时先比较来源版本、当前平台内修改和待导入版本，再合并所需差异并更新来源记录。原 coding-agent 目录是来源仓库，平台内核源码和依赖均从本目录加载。

纳入范围包括源码、测试、场景和基准任务、资源、配置、依赖锁文件和工程文档。Git 历史、node_modules、dist、.tooling、日志及历史运行结果没有复制；已跟踪的 recovery-exactly-once 测试用 .env 夹具随任务保留，用户 API 密钥未读取或复制。

## 安装与构建

使用 package.json 指定范围内的 Node.js，并安装 npm 和 pnpm。在平台根目录执行：

```sh
pnpm kernel:install
pnpm kernel:build
```

这两个入口分别在本目录按 package-lock.json 安装依赖和构建 dist/app/cli/main.js。平台保留 pnpm 锁文件，内核保留自己的 npm 锁文件；本次未合并两套依赖或改动内核业务代码。平台原有 build 仍只构建平台。

Node/npm、bubblewrap 等是运行环境工具，不作为源码副本复制。需要 Shell 隔离的实测须在环境阶段核对可用性并显式配置 CODING_AGENT_BWRAP_PATH（如未正常安装）；源码纳入和本地模型夹具通过不代表隔离或真实模型验收完成。

## 当前接入边界

平台 tests/integration/real-kernel/replay-server.ts 默认按自身位置解析本目录，AGENT_PLATFORM_KERNEL_ROOT 仅用于显式覆盖。P1-15/P1-16 的既有集成测试使用这个副本的真实 CLI 和本地模型响应夹具。

GUI 的真实运行与查询接线仍属于 RAT-02 后续工作；本次复制不改变 GUI 的测试适配器模式。逐阶段执行依用户要求，在当前阶段汇报后等待下一阶段确认。

后续实现或调试按 [AGENTS.md](AGENTS.md) 查阅本副本的当前工程文档；平台权威位置见 [项目位置说明](/mnt/d/1.project/Software/agent_learn/agent_dev/agent_platform/dev_docs/agent/project-location.md)。

## RAT-02 宿主接入增量（2026-09-07）

本次只修改平台副本的 `src/app/composition/composition-root.ts` 与 `src/sandbox/process/process-sandbox.ts`，原来源仓库未改动；`UPSTREAM.json` 的导入摘要保留为历史来源，不改写成当前已修改源码的摘要。

`RunAppInput` 新增可选 `limits`、`workspaceOptions`、`processSandboxOptions`，由宿主显式传入；默认 CLI 行为保持不变。ProcessSandbox 新增可选 `readOnlyPaths`（工作区根下的真实目录名，拒绝路径穿越及符号链接）和 `executablePath`。平台仅用 `.platform-runtime` 预置受信 Node 并只读挂载；原默认凭据保护继续优先，无宿主路径自由挂载能力。

平台 `runtime.tokenBudget` 继续表示上下文容量；累计用量由独立 RuntimeBudget/ModelBudget 及内核 RunLimits 控制。原始导入核对与当前接入源码摘要需分别阅读；证据为平台 `evidence/rat-02/` 和权威 `dev_docs/verification/rat-02-evidence.md`。

## Context 与只读分析工具接入增量（2026-09-08）

当前平台 GUI 已使用真实内核；上方最初纳入边界是导入时历史，不代表当前接线状态。原来源仓库和 UPSTREAM.json 的导入指纹保留不动，本次平台副本差异由外层工作树及本轮证据指纹追踪。

公共组合入口和恢复组合入口新增可选 additionalTools 工厂，在注册表冻结前注册宿主工具；重复名称仍被拒绝，未显式启用的工具不进入当前请求。public-api 导出 toolSchema，供宿主使用相同 Zod schema 构造工具定义。DefaultPermissionPolicy 仅允许宿主已注册且同时满足 read_only、仅 workspace_read 能力的扩展；凭据、隐藏路径和未知操作限制继续优先，不能通过自报只读为未知写入或进程能力授权。

WorkspaceSandbox 新增 listFiles(maxEntries, {prefix, signal})，逐层通过目录句柄读取实际可见文件，拒绝符号链接、路径穿越和拒绝目录，限制条目/深度并报告截断；它不依赖只包含未提交变化的 Git 快照。单个目录的 readdir/sort 尚不是硬内存限制。平台在此能力上实现 list_files/search/symbols；普通 coding 模式维持 read/edit/shell。Python 符号分析只将源码通过 stdin 交给固定标准库 AST 程序，不执行被分析项目代码。

新 Run 的 ContextBundle 核验和选材在平台 runtime-context 中完成，内核继续只负责一次 Run 的实际消息和工具循环。不能据此声称完整跨 Run 记忆或自动审阅已接通。验证与文件指纹见 [本轮修复总记录](/mnt/d/1.project/software/agent_learn/agent_dev/agent_platform/dev_docs/verification/2026-09-08-product-wiring-repair/README.md)。

## 语义反馈Context容量适配（2026-09-11）

平台普通Run的完整角色材料和反馈协议可超过16 KiB。组合入口之前把完整模型输入直接作为EmptyMemoryProvider的辅助查询，触发memoryRecallRequestSchema字节上限，使合法模型Context在首次模型调用前失败。当前仅对辅助召回query按UTF-8完整字符限于既有MAX_MEMORY_QUERY_BYTES；传入模型的input.input保留完整，原模型容量及累计预算、权限守卫均不改变，也未启用长期记忆提供者。原来源仓库和UPSTREAM.json保持原导入身份。

真实HTTP/SQLite/内核的角色规格运行测试同时核对Context超过16 KiB且完整用户消息实际到达本地模型替身。该适配与失败诊断证据位于平台evidence/2026-09-11-semantic-loop，不将空记忆提供者计为长期记忆功能完成。
