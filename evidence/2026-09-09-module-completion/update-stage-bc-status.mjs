import {readFile,writeFile,appendFile} from 'node:fs/promises';
const root='D:/1.project/Software/agent_learn/agent_dev/agent_platform';
const file=root+'/human/module-status.md';let text=await readFile(file,'utf8');
const edits=[
['同工作区跨 Goal 精确历史读取、Python 语义服务与实际 Run 消费正在复验。阶段 A 未结束，B–G 及真实项目总验收未完成；','同工作区跨 Goal 精确历史读取与 Python 语义服务已通过局部复验；Context 选材/容量与检查中间日志、Evidence/对账入口已实现部分消费者，真实 TS/JS 架构 sourceBinding/delta 通过一次 SQLite 链路。阶段 A–C 仍有核心缺口，D–G 及真实项目总验收未完成；'],
['重大缺口：自动按角色选材<br/>关联代码／角色相关性／容量内取舍<br/>当前版本适用性与长期继承','部分实现：职责／主题选材与缺口清单<br/>显式规则已进入实际 Runtime 输入<br/>真实全角色／模型 tokenizer／长期继承未接'],
['部分实现：验证计划／检查草稿／证据接纳<br/>真实沙箱命令检查／报告持久化已接<br/>默认不配置检查器，不以替身通过','部分实现：真实命令与原报告 Evidence<br/>日志／租约对账入口已接，需完整进程验收<br/>Reviewer／返工驱动仍未接通'],
['ArchitectureReconciler · 重大缺口<br/>仍丢弃实际 delta／生成固定 Finding<br/>比较基准 revision 0 硬编码','ArchitectureReconciler · 部分实现<br/>精确 sourceBinding／真实差分与来源问题<br/>基线演进 UI／真实角色消费未闭环'],
['Reconciler 的回执修复不修正固定业务结论。','Reconciler 已去掉固定业务结论，真实差分与来源绑定已有一次 SQLite 证据；基线演进和角色消费仍未闭环。'],
['部分实现：沙箱读写与 shell<br/>探索／开发可查限定 TS/JS 语义引用<br/>Python 语法 AST；无完整调用图','部分实现：沙箱读写与 shell<br/>TS/JS 项目语义与 Python Jedi 查询<br/>C++ 未接；没有完整运行时调用图'],
['ArchitectureReconciler<br/>重大缺口：固定结论；回执已修','ArchitectureReconciler<br/>部分：真实差分；演进消费未闭环'],
['ContextCompiler<br/>部分：基础组装','ContextCompiler<br/>部分：选材与容量；角色未全接'],
['Share -.->|尚未按角色自动选材| Select','Share -->|显式规则权限复核；其余角色待接| Select'],
['已有文件读取、文本搜索、TS/JS 与 Python 语法 AST。新增 Data SourceIndex 已接执行侧，支持显式 TS/JS 文件集的跨文件定义／引用与版本绑定片段；仍无全仓多语言语义覆盖或完整调用图。','已有文件读取、文本搜索、TS/JS 与 Python 语法 AST。Data ProjectSourceIndex 已接项目配置/依赖/增量语义，Python Jedi 提供隔离跨文件查询；TS/JS source-workspace-reader 提供显式映射的真实图。尚无 C++、全仓多语言语义覆盖或完整调用图。'],
['| ArchitectureReconciler → Control / Vault / Context | 实际还读 Ledger、WorkspaceReader；真实差异未用于最终 Finding，不能把设计边视为完成证据 |','| ArchitectureReconciler → Control / Vault / Context | 实际还读 Ledger、WorkspaceReader；真实差分保存 Vault 并生成 Finding，角色审阅与基线演进消费者仍未完整接通 |'],
['| VerificationEngine（验证编排） | 分层框架已有，闭环未接 | 读取验证计划，核对版本；真实命令经沙箱执行，报告与来源持久化并可重开读取；审阅材料另行编译 | 机械检查与独立 Reviewer 未统一实际运行 | 实际 Adapter＋异步工作接线 |','| VerificationEngine（验证编排） | 检查与证据部分接通，闭环未接 | 真实沙箱/报告/check-evidence 接纳；检查 checkpoint 与租约对账/原报告重建入口 | 独立 Reviewer/返工、完整进程中断和统一生命周期未验收 | 实际 Adapter＋异步工作接线 |'],
['| ArchitectureReconciler（架构对账） | 关键实现有错误，拒绝回执已修复 | 已有图 diff 与登记命令，已修边修改／节点移动漏检与拒绝停止；主路径仍丢弃真实 delta | 固定 Finding、忽略真实 delta | 内部重写为主 |','| ArchitectureReconciler（架构对账） | sourceBinding/实际差分部分接通 | 不可变基线绑定源码 manifest/commit/映射；真实 TS/JS 差分、未知关系与来源问题持久登记，回执拒绝停止 | 初始基线准备/演进 UI、全角色/修复决定消费仍缺 | 继续正式消费者与恢复接线 |'],
['| ArtifactVault（产物正文） | 持久 Adapter 已接入，跨主体读授权已接 | SQLite 保存正文、引用、来源与首次 owner；重开、强杀恢复和完整性检查通过；P1-18 新增按读者／材料／基线／签发者放行的授权读取，基线变化返回 stale | 授权撤销、批量授权与跨主体消息未接；长期记忆继承仍未接 | 证据见 [P1-18 记录](../dev_docs/verification/2026-09-08-p1-18-material-access.md) |','| ArtifactVault（产物正文） | 持久/精确授权/撤销已接 | 原 owner/provenance 不变；≤64 精确材料；读取核对 canonical grant 撤销与 Plan/Workspace；同 Workspace 跨 Goal 历史授权 | 通用源码适用性、跨 Workspace 决定、全部继承消费者与记忆未完成 | 证据见 [本轮记录](../dev_docs/verification/2026-09-09-module-completion.md) |'],
['| ContextCompiler（上下文选材） | 基础接通，核心选材需补 | TypeScript 校验并生成任务 JSON 包；运行入口加入明确规则／前驱报告后拼接文本 | 已修历史版本比较、理由保留和清单；角色选材与实际继承仍缺 | 内部算法＋角色材料契约 |','| ContextCompiler（上下文选材） | 选材算法/显式规则消费者部分接通 | 职责/主题排序，必需项/历史/冲突/缺口与容量清单；最终请求含工具/历史的容量拒绝 | 模型对应 tokenizer、全部真实角色与相关历史自动继承尚缺 | 内部算法＋角色材料契约 |'],
['| WorkspaceReader（源码与索引） | 限定语义查询已接，正式架构图未接 | Data SourceIndex 复用 TypeScript Language Service；探索／开发消费跨文件定义／引用及摘要绑定片段，重开保留工具材料 | 真实应用图读取明确 unsupported，示例 Harness 仍为 Fake Adapter；多语言语义、全仓增量索引、基线来源映射未完成 | 已有真实源码查询；补图契约与 Adapter |','| WorkspaceReader（源码与索引） | 项目 TS/JS、Python、显式映射图部分接通 | TS Language Service 配置/依赖/增量；Jedi 隔离跨文件语义；source-workspace-reader 按真实 Plan/Run/Workspace 读取 TS/JS 图 | C++、Python 完整配置/依赖/增量、真实模型项目验收未完成；旧无来源绑定基线仍明确拒绝 | 继续语言覆盖与真实角色消费者 |'],
['仍未接通：Reviewer／接续运行消费、授权撤销、按角色自动选材与长期记忆继承。','仍未接通：Reviewer／接续运行消费、全部角色自动选材与长期记忆继承。撤销及同 Workspace 历史授权已新增，源码适用性仍有限。'],
['通用版本作废／授权撤销／长期记忆继承仍待补','已接撤销与账本版本复核；通用源码作废／长期记忆继承仍待补'],
['明确基线与代码快照绑定、关系到违规的规则后，消费真实 delta，去掉固定 Finding；拒绝回执不得继续提交。上述两项策略待明确','已补 sourceBinding 与真实 delta/Finding；显式 dependencyRules 正在复验，拒绝回执停止；仍需基线演进 UI、真实角色与恢复闭环']
];for(const [old,next]of edits){if(!text.includes(old))throw Error('missing status text: '+old.slice(0,70));text=text.replace(old,next);}await writeFile(file,text);
await appendFile(root+'/dev_docs/verification/2026-09-09-module-completion.md',`
\n### C 后续证据
\nsource-check-recovery-tests-6.log：类型 types-10.log 通过；3 文件 18 通过/1 测试设置失败。检查 9/9 已包含 reconcile-check 从原报告重建结果、核对租约、重复对账无重跑；架构 unit 9/9。真实源码测试先误用 ApplyPlanRevision 替换已安装计划，被合法拒绝，未改产品守卫。改为初始治理安装时显式附 sourceBinding 后，source-architecture-tests-7.log 1/1 通过（1.19 秒实际测试；含两种源码变化、无变化、SQLite 重开正文、旧请求/过期/错误基线拒绝）。没有真实模型参与。
\n新增 dependencyRules 的唯一机械规则类型 forbid_dependency，作用于显式映射的 fromModule/toModule，规则属于不可变基线内容；违规高风险且 material，自由文字 constraints 不被解析为规则。该增量尚待 architecture-rules-tests-8.log。
\n检查工作台新增原报告证据登记与中断对账按钮，显示持久进度、恢复原因和证据接纳状态，API 复用原 requestId/reportDigest；切换作用域丢弃迟到响应。UI 类型/浏览器新入口仍在验证。
`);
await appendFile(root+'/dev_docs/modules/control/architecture-reconciler.md','\n可选 dependencyRules 只支持 forbid_dependency，规则 ID 唯一且两端必须是 sourceBinding 显式 Module。新增违规依赖的 Finding 为高风险/material，保留具体规则、机械变化和 delta 来源；自由文字 constraints 仍不构成可执行规则。规则正文与 sourceBinding 在候选物化时完整继承，不改变激活协议。\n');
console.log('Synchronized module-status nodes, table, arrows and current evidence.');
