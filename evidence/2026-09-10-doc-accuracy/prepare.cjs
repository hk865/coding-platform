const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = 'D:/1.project/Software/agent_learn/agent_dev/agent_platform';
const product = 'D:/1.project/Software/agent_platform';
const out = path.join(product, 'evidence/2026-09-10-doc-accuracy');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const changes = [];
function edit(target, fn) {
 const before = fs.readFileSync(target); const text = before.toString('utf8').replace(/\r\n/g, '\n');
 const after = fn(text); if (after === text) throw Error('No change: '+target);
 const n = changes.length; fs.writeFileSync(path.join(out, n+'.before.md'), before);
 fs.writeFileSync(path.join(out, n+'.after.md'), after);
 changes.push({target, beforeSha256:sha(before), staged:path.join(out,n+'.after.md')});
}
function rep(s,a,b) { if(!s.includes(a)) throw Error('Missing: '+a); return s.replace(a,b); }
edit(root+'/human/module-status.md', s => {
 const p=s.indexOf('**当前状态：'); const q=s.indexOf('VR-02已按限定范围验收');
 s=s.slice(0,p)+`**当前阶段：12 Module 职责归位及一 Module 一目录整理已完成；工具验证、独立 Reviewer 和 DEF-17 按各自范围验收。完整产品仍未完成。本次仅修正文档准确性，下一项实施范围由用户阅读缺口后决定。**

当前源码身份引用重组清单：**744 文件 / f36287a561fe4499043d370d1c73a7adbf012289db7d153974828760b3ec8d3a**。范围为清单所列源码、测试、脚本及根配置，排除生成的 workbench、dist、依赖和证据目录；不是整个工作区的摘要。[重组证据](../../../../agent_platform/evidence/2026-09-10-module-folder-reorg/reorg-report.md)记录全仓 257 文件 / 1672 项与浏览器 25 项通过。[进度审计](../dev_docs/verification/2026-09-10-progress-audit.md)另报告 WSL 全仓复跑通过，但浏览器因 npm 环境缺失未启动；本次文档修订不新增运行验收。

## 当前剩余产品义务（供选题，不表示实施顺序）

| 能力 / 主要负责 Module | 已有基础 | 仍缺什么 |
| --- | --- | --- |
| 工作上下文 / ContextCompiler | WorkContext、CompletedWork 编译端口及来源、权限校验 | 普通真实 Run 消费工作身份与历史材料；清单与实际输入一致；完整 token 容量处理 |
| 补料与决定回流 / HumanCollaboration、PlanCompiler | 独立只读 QueryJob、提案和决定记录 | 缺料请求、按角色路由、结果接纳、重新组装与消费回执；完整反馈重规划 |
| 接续与运行控制 / WorkerRuntime、DispatchEngine、ControlEngine | 持久运行事实、租约、取消、部分重启对账 | 暂停/继续/steer 产品入口、新 Run 内核恢复与换手；未知副作用处置和完整强杀恢复 |
| 长期记忆 / ContextCompiler、ArtifactVault、ReadModelIndex | 正文持久化、精确授权与撤销、历史取材端口 | 记忆查看/更新/作废、检索与真实消费者；显式跨 Workspace 授权已获允许，仍禁止自动共享 |
| 返工重验 / VerificationEngine、ControlEngine、PlanCompiler | 工具轮次、独立 Reviewer、正式 FAIL 与 Evidence | 问题关联返工任务、新版本验证与重审身份、最终归约；DEF-17 启动前恢复不能代替返工 |
| 架构对账与演进 / ArchitectureReconciler | 模块内 sourceBinding、限定 TS/JS 差分、登记回执处理 | inspect 产品入口、真实初始基线来源与绑定；演进决定及激活消费；MigrationGate 仅有守卫，真实迁移检查未实现 |
| 来源与证据时效 / WorkspaceReader、ArtifactVault、ControlEngine | 已有语言索引、探索/Reviewer 来源 pin、材料撤销 | 其他角色消费、完整配置/依赖/增量；通用 Evidence 来源失效闭环与真实 Git diff 接口 |
| 产品交互与整体效果 / HumanCollaboration、全模块 | 工作台、投影、报告和真实查询入口 | 完整角色协作、规则/记忆设置实际生效；全链真实任务及效率评测。浏览器复跑环境也需补可复现说明 |

详细模块边界见下方“12 个模块的结论”。技术选型若现行文档没有决定，实施前由主 Agent 汇总（含子 Agent 发现）向用户询问，等待期间推进其他独立工作。

## 已验收批次（以下数字属于各自历史身份）

[DEF-17 验收](../dev_docs/verification/2026-09-10-def17/acceptance.md)：747 文件 / c399…ac61、256 文件 / 1664 项、浏览器 25 项，均属重组前该批身份；其限定验收继续保留。

`+s.slice(q);
 s=s.replace('2026-09-10 原修复已实施，739文件5a9e…0364与实际源码逐文件一致，现有253/1641及浏览器23项日志已核实','2026-09-10 原修复批次当时已实施，739文件5a9e…0364在该批核对时逐文件一致；该批253/1641及浏览器23项日志已核实');
 s=s.replace('最新批次见本页开头及 DEF-17 验收入口','当前身份见本页开头，历史批次各按原验收入口');
 s=s.replace('WorkspaceReader · 重大缺口','WorkspaceReader · 部分接通');
 s=s.replaceAll('WorkspaceReader · 重大缺口','WorkspaceReader · 部分接通');
 s=s.replace('class Select,Workspace,Refill gap;', 'class Select,Refill gap;\n  class Workspace partial;');
 s=s.replaceAll('PlanCompiler · 重大缺口','PlanCompiler · 反馈重规划未闭环');
 s=s.replace('VerificationEngine · 重大缺口','VerificationEngine · 返工重验未闭环');
 s=s.replace('PlanCompiler／VerificationEngine · 重大缺口','PlanCompiler／VerificationEngine · 反馈规划与返工未闭环');
 s=s.replace('class Arch,Source gap;', 'class Arch gap;\n  class Source partial;');
 s=s.replace('class Roles,Rework missing;', 'class Roles partial;\n  class Rework missing;');
 s=s.replace('class Plan,Query gap;', 'class Plan gap;\n  class Query partial;');
 s=s.replace('class PlanCompiler,VerificationEngine,ArchitectureReconciler,WorkspaceReader gap;', 'class PlanCompiler,VerificationEngine,ArchitectureReconciler gap;\n  class WorkspaceReader partial;');
 s=s.replace('基线演进 UI／真实角色消费未闭环','inspect 无产品入口；真实初始基线与演进消费未接');
 s=s.replace('部分：真实差分；演进消费未闭环','核心缺口：inspect 无产品入口；真实基线未接');
 s=rep(s,'PlanCompiler 和 VerificationEngine 的局部实现存在，但缺少关键真实角色消费者，因此整体标红。','PlanCompiler 的红色指反馈重规划未闭环，VerificationEngine 的红色指返工重验未闭环；已验收的工具轮次与独立 Reviewer 单独标绿。部分实现与核心职责受阻可以同时成立。');
 s=rep(s,'真实模式中栏提问／发送目前禁用，独立语义查询仍注入固定回答 Adapter。','旧 /legacy 控制台禁用相应提问／发送；默认工作台已有独立只读模型查询入口。具备 execution 描述的 QueryJob 走真实查询内核，无该描述的样例路径使用固定回答 Adapter；内置服务器显式开启 fixtureExecution，界面分别标注两类查询。');
 s=s.replace('当前图与 ARCHITECTURE 的 34 条 Module 依赖一致','当前图与 ARCHITECTURE 的 34 条允许 Module 依赖一致');
 s=s.replace('下表保留的是当前接线及功能缺口，不能把旧漂移描述继续当作现状。','34 条是允许依赖集合，不是实际调用链数量；进度审计报告 9 条直接跨 Module import。其余允许边是否通过契约和宿主注入落实，须逐项检查消费者，不能由允许集推定。下表保留当前接线及功能缺口。');
 s=s.replace('返工待外部审查后动工','返工尚未接通，实施范围待用户决定');
 s=s.replace('创建目标、查投影、转交变更；','创建目标、查投影；变更转交模块端口存在，产品入口未接；');
 s=s.replace('授权/租约/恢复在Module内','Dispatch 负责派发与租约协调，Control 负责授权和租约受理，Runtime 负责执行适配');
 s=s.replace('不可变基线绑定源码 manifest/commit/映射；真实 TS/JS 差分、未知关系与来源问题持久登记，回执拒绝停止','模块内可按不可变基线绑定 manifest/commit/映射，执行限定 TS/JS 差分、登记问题并处理拒绝；src/app 尚无 inspect 调用者');
 s=s.replace('初始基线准备/演进 UI、全角色/修复决定消费仍缺','产品安装基线无 sourceBinding；真实初始基线、inspect 入口、演进与修复决定消费仍缺；MigrationGate 真实检查未实现');
 s=s.replace('保留最后已提交归约及原租约；投影重建一致，不提交业务命令','保留已提交归约和 producer 行租约；已有新实例重放一致性证据，尚无独立 rebuild/reset/replay API，不提交业务命令');
 s=s.replace('模型对应 tokenizer、全部真实角色与相关历史自动继承尚缺','普通真实 Run 尚未消费 WorkContext/CompletedWork/ExecutionMemory；模型对应 tokenizer、其他角色与历史继承消费者尚缺');
 s=s.replace('仍需补真实运行的暂停／继续／取消／换手适配与能力声明一致性','取消已有端到端路径；仍需暂停／继续／steer／换手适配与能力声明一致性');
 s=s.replace('## 接下来按什么顺序修','## 历史覆盖清单（不作为下一项实施顺序）');
 s=s.replace('下表是原覆盖清单，不覆盖本批优先级，也不表示已完成。','下表是历史覆盖清单，数字仅用于追溯；已完成项以当前摘要及12模块表为准。用户将在文档准确性修复后决定下一项，当前未授权按此编号推进实现。');
 s=s.replace('显式 dependencyRules 正在复验','显式 dependencyRules 的历史复验见对应验收');
 return s;
});
edit(product+'/IMPLEMENTATION-HANDOFF.md', s => {
 s=rep(s,'原修复状态核对与DEF-17均已按限定范围验收，当前委托完成并停止。','当前阶段：12 Module 架构归位与目录整理已完成，原修复及 DEF-17 按限定范围验收；完整产品仍未完成。本次仅修正文档准确性，下一项核心功能由用户据当前缺口决定。\n\n当前源码身份：重组清单 744 文件 / f36287a561fe4499043d370d1c73a7adbf012289db7d153974828760b3ec8d3a，范围与排除项见 [清单](evidence/2026-09-10-module-folder-reorg/final-source-sha256.json)。重组记录全仓257文件/1672项、浏览器25项通过；[进度审计](../agent_learn/agent_dev/agent_platform/dev_docs/verification/2026-09-10-progress-audit.md)报告另一次WSL全仓通过，浏览器因npm缺失未启动。此次文档修订未重跑产品测试。\n\n当前剩余义务与模块归属统一见[模块状态](../agent_learn/agent_dev/agent_platform/human/module-status.md)，本页下列747/739等身份与测试数仅属于历史批次。文档修订范围与实际检查见[修订记录](../agent_learn/agent_dev/agent_platform/dev_docs/verification/2026-09-10-doc-accuracy.md)。');
 s=s.replace('739文件5a9e9eb1f7030860f54d16a2dff87a90f8a17c77f710ca70f212b788ac210364已逐文件一致','739文件5a9e9eb1f7030860f54d16a2dff87a90f8a17c77f710ca70f212b788ac210364在该批核对时逐文件一致');
 return s;
});
edit(root+'/dev_docs/verification/2026-09-09-architecture-rebuild/core-continuation.md', s => s.replace('\n2026-09-09。','\n> 2026-09-10 状态勘误：以下保留 9 月 9 日的接续建议及代码时点，不是当前施工顺序。工具验证轮次和独立 Reviewer 此后已经限定验收；当前缺口及下一项选择以 [模块状态](../../../human/module-status.md) 为准。真实 service 的自定义 verification 覆盖了默认引擎，`checkPorts: []` 不参与该路径；缺少显式 round 才会由 VerificationService 返回 incomplete，不能按旧因果去补 checkPorts。\n\n2026-09-09。'));
edit(root+'/dev_docs/verification/2026-09-10-progress-audit.md', s => {
 s=s.replace(/其余靠 `src\/contracts` 契约 \+ 宿主注入/g,'其余允许边不等于已接通，契约与宿主注入的实际消费者需逐边取证');
 s=s.replace(/其余靠 `src\/contracts` \+ 宿主注入/g,'其余允许边的契约与宿主注入消费者仍需逐边取证');
 s=s.replace('| `MigrationGatePort` | `src/control/verification-engine/migration-gate-port.ts:120` 恒 `unsupported` | `createMigrationGatePort` 在 `src/` 无调用点（仅 `tests/verification/migration-gate-port.test.ts`） |','| `MigrationGatePort`（仅守卫，不能归为功能已实现） | 候选、基线和工作区版本守卫已实现；通过守卫后返回 `unsupported`，实际迁移检查和 Evidence provider 未实现 | `createMigrationGatePort` 在生产 src 无调用者；既缺真实检查能力，也缺产品接线 |');
 s=s.replace('| **副作用对账/处置** | `src/contracts/goal-phase.ts:172-174` 契约明确「NO disposal path，故永远 false」 |','| **未知副作用处置及完整恢复闭环** | `src/contracts/goal-phase.ts:172-174` 的 false 指处置资格；该文件另有 identify/block/record 的对账定义，不能据此声称所有副作用对账不存在 |');
 const a=s.indexOf('### 4.2 '), b=s.indexOf('### 4.3 ');
 if(a<0||b<a) throw Error('audit sections');
 s=s.slice(0,a)+`### 4.2 图示判定勘误（2026-09-10 文档准确性修订）

原审计把“部分实现”等同于“不得标红”，这一推论不成立。红色表示仍有阻断核心职责的缺口，可以与已实现子能力并存。原“5处”表实际列了6项，且 WorkspaceReader 的 Data 图和 DAG 当时均为红色，并非两种相反颜色。

- PlanCompiler、VerificationEngine 保留红色，并分别写明反馈重规划、返工重验未闭环；工具轮次和独立 Reviewer 子节点保留绿色。
- ArchitectureReconciler 红色明确指 inspect 无产品入口及真实初始基线未接，不否认模块内差分实现。
- WorkspaceReader 已有真实消费者，图示统一为部分接通并列出覆盖缺口；Query 节点按其独立只读查询范围标黄，完整角色反馈仍列为未接通。
- Roles 节点已有初始规划消费者，改为部分接通；不能与完全缺失的 Rework 一起标灰。

颜色只解释图中明确范围，不构成验收，不删除任何剩余产品义务。

`+s.slice(b);
 s=s.replace('代码确实做了不可变绑定','模块内已实现不可变绑定');
 a; const c=s.indexOf('## 七、');
 s=s.slice(0,c)+`## 七、后续选择（原排序撤回为建议，待用户决定）

本次用户要求先修正文档，再依据准确缺口选择下一项。当前缺口和模块归属统一见 [模块状态](../../human/module-status.md)，不以本文原序号安排实施。

ArchitectureReconciler 缺生产 inspect 入口与真实初始基线，但本次审计不足以证明“要件已齐、只缺入口、投入最小”；基线来源、绑定、生效及演进消费者仍需核对。返工、工作上下文、补料、接续与记忆均为剩余义务，其排序需结合选题和接口依赖确定。

文档已区分历史身份与当前身份，并修正查询、验证配置、图例和能力分类。浏览器环境复现仍是待办：确定仓库支持的工具链后补可重复入口，本轮不修改工具链或新增 shim。原审计报告的测试结果保持原运行者归属，本次文档修订未重跑全仓或浏览器。
`;
 s=s.replace('## 一、','> 本文已于同日按文档准确性委托修正分类和建议；修订前全文保留在产品 evidence/2026-09-10-doc-accuracy/3.before.md。原实跑结果不因本次文字修订成为新的运行证据。\n\n## 一、');
 return s;
});
fs.writeFileSync(path.join(out,'changes.json'),JSON.stringify(changes,null,2));
const manifest=JSON.parse(fs.readFileSync(product+'/evidence/2026-09-10-module-folder-reorg/final-source-sha256.json','utf8'));
const mismatch=manifest.files.filter(f=>!fs.existsSync(product+'/'+f.path)||sha(fs.readFileSync(product+'/'+f.path))!==f.sha256);
fs.writeFileSync(path.join(out,'source-check-before.json'),JSON.stringify({count:manifest.files.length,mismatch},null,2));
console.log(JSON.stringify({staged:changes.length,sourceCount:manifest.files.length,mismatch:mismatch.length}));
