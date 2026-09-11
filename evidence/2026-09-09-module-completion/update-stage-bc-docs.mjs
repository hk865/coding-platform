import {readFile,writeFile,appendFile} from 'node:fs/promises';
const docs='D:/1.project/Software/agent_learn/agent_dev/agent_platform';
const code='D:/1.project/Software/agent_platform';
async function replace(file, pairs) {let value=await readFile(file,'utf8');for(const [old,next] of pairs){if(!value.includes(old))throw Error('missing expected text: '+file+' '+old.slice(0,50));value=value.replace(old,next);}await writeFile(file,value);}
await appendFile(docs+'/dev_docs/modules/data/context-compiler.md', `
\n## 2026-09-09 选材与容量扩展
\nmaterial-selection 仅接收已通过宿主权限/版本复核的候选，区分当前规则、历史解释、stale/forbidden/unknown。按明确消费者职责和主题排序，先纳入必需材料；同 ruleKey 的当前规则冲突、必需正文缺失或超容量返回 needs_material。清单逐项保存选择/排除理由、来源版本、权限依据、摘要/字节/Token 计量；历史内容不能满足当前必需义务，不静默裁剪。
\nRuntimeContext 的显式规则已消费该选择器并将清单放入实际输入。其他职责的排序定义存在，但秘书/规划/Reviewer 等真实角色尚未接通，不能称为全部消费者完成。最终 ModelRequest（含工具/历史）由 ModelBudget 再次计量并预留响应空间，调用前容量拒绝。可注入模型计量器；当前真实 provider 尚未配置对应 tokenizer，默认值明确为 conservative_utf8_estimate，与 provider 实际上报用量分开，不把字节估算称为准确 Token。
`);
await appendFile(docs+'/dev_docs/modules/control/verification-engine.md', `
\n## 2026-09-09 检查中间状态与证据入口
\n应用持久检查日志记录 intent_recorded、lease_acquired、executing、report_stored、result_recorded、lease_released 或 reconciliation_required。执行 checkpoint 落盘失败禁止启动命令；报告 body 落盘与 VerificationResult 登记分开。报告独立保存 effects=not_started/known/unknown，不能用 timeout/stale_source 等结果分类替代副作用状态。未知副作用保留独占租约，重复 requestId 不重跑。
\n重开后 running 与未确认释放的 finished 都需要对账，check-report 可读取结果登记前已落盘的原报告。reconcile-check 仅消费完整性校验后的报告和 Ledger 租约，known/not_started 方可补交释放；当前源码/计划仍一致才重建观察草稿，不调用 CheckPort。该恢复入口正在复验，独立进程强杀仍待覆盖。
\ncheck-evidence 要求精确 reportDigest，重核 Task/Run/Plan/Workspace 与当前内容摘要，先记 pending 再提交原子 Evidence；重试幂等，不直接归约任务或目标。检查中间日志目前属于应用持久文件，租约与 Evidence 属于 StateLedger；Reviewer/返工与全生命周期统一驱动未完成。
`);
await appendFile(docs+'/dev_docs/modules/control/architecture-reconciler.md', `
\n## 2026-09-09 精确来源绑定与分类（兼容扩展）
\nArchitectureBaselineContentV1 可保存 sourceBinding，内容本身纳入既有不可变治理摘要。绑定包含 Project/Workspace、真实数字版本、commitHash（可空）、完整许可源码/配置 manifest 摘要、indexVersion、configPath、显式 Module/Interface 路径映射、机械节点/边与未解析关系。它不反向引用自身 baseline pin，避免循环摘要。旧基线保持可读；缺少绑定时机械检查 fail_closed，不回退 revision 0。
\n真实 SourceWorkspaceReader 通过 Run 读权限、Plan pin 与 Workspace 账本版本核对后，调用 TypeScript 项目 Language Service 的完整 imports 材料，按显式映射折叠图。当前只声明 TS/JS，未映射源码、缺失依赖均保留 unresolved；不将目录名称猜作产品模块，不把静态 imports 称为运行时调用图。源码前后摘要核对与数字版本核对并行生效，仍非文件系统原子快照。
\nReconciler 核对实际 PlanRevision pin、治理内容摘要和真实 reader Run。基线/当前图、真实 delta、Brief 正文保存 Vault，保持 reader owner。每条机械变化产生来源可追溯的 Finding：普通结构差异低风险且不判正确性；接口/依赖变化为待审语义问题；新未解析关系为低置信问题。自由文字 constraints 没有被猜测成可执行规则。无变化不产生固定 Finding；超出完整差分/单 Brief 上限明确拒绝，不省略问题。
\n每步提交消费 committed 回执；部分提交保留，重试使用已存 inspection 时间和相同身份。Brief 选项要求调查或另行提出精确修订，不自动生成已选业务方案；候选物化完整保留 sourceBinding。模型/源码变化均不激活基线。初始基线准备/演进 UI、规则判定与真实角色消费、完整恢复仍待后续闭环。
`);
await appendFile(docs+'/dev_docs/interfaces/runtime-collaboration.md', `
\n## 2026-09-09 来源图与检查日志兼容扩展
\n架构基线内容可携 sourceBinding（src/contracts/architecture-source.ts），绑定精确许可源码 manifest/commit/indexVersion 与显式 Module/Interface 映射。CodeGraphSnapshot 可携 sourceSnapshot；真实读取要求 requesterRunRef，省略时不伪造正文 owner。旧无绑定基线不再用 revision 0 机械比较。ArchitectureInspection 的 maxTokens 可为 null，纯机械路径不生成累计模型预算。Finding/Brief 的来源从实际 delta 或 reportInput 生成，基线激活仍走正式决定。
\n命令检查应用日志保留执行前意图与报告落盘 checkpoint；effects 与结果分类独立。原报告经 check-evidence 进入 Ledger Evidence，精确正文摘要与当前源码/计划匹配是接纳条件；reconcile-check 只对账已证实结果与租约，不能重放命令。阶段证据与未覆盖项见 verification/2026-09-09-module-completion.md。
`);
await replace(code+'/src/control/README.md',[
['目录承载四个设计模块，见下表；固定架构 Finding 仍是缺陷，不能作为真实对账结论。','目录承载四个设计模块，见下表。ArchitectureReconciler 已替换固定 Finding 为绑定源码的机械差异与待审问题；当前真实产品闭环仍在验证和接线。'],
['未明确的架构源码基线绑定和 Finding 分类策略见 ArchitectureReconciler Module，不能用测试夹具补足。','架构 sourceBinding 与分类边界见 ArchitectureReconciler Module；无来源绑定、版本过期或登记拒绝时停止，不以测试夹具补足。']]);
await replace(code+'/src/data/README.md',[
['source-index 是限定 TS/JS 文件集的语义查询；workspace-reader-adapter 仍含图夹具。完整项目图与基线映射尚未实现。','source-index 保留限定文件集查询；project-source-index 提供 TS/JS 项目配置与语义服务。source-workspace-reader 按显式基线映射读取真实源码图；workspace-reader-adapter 的夹具仅供原协议测试。'],
['C++/正式架构图仍待接通。','C++ 仍未实现；TS/JS 正式图由 source-workspace-reader 提供，完整上层架构消费者未闭环。']]);
await appendFile(code+'/src/context/README.md','\n[material-selection.ts](material-selection.ts) 实现职责/主题排序、当前/历史区分、必需材料缺口、冲突与容量清单。RuntimeContext 已消费显式规则选择；其他角色完整接线仍待完成。最终模型输入计量由 runtime/model-budget 执行。\n');
await appendFile(code+'/src/app/README.md','\n检查持久日志区分执行、报告落盘、结果登记和租约状态；check-evidence 精确登记原报告证据，reconcile-check 仅对账报告与租约，不重跑命令。当前这些恢复/登记新入口的 UI 与独立进程验收尚待补齐。\n');
await appendFile(code+'/src/verification/README.md','\nCommandCheckProvider 的 progress checkpoint 在命令前与报告落盘后分别持久化；effects 与 PASS/FAIL/INCONCLUSIVE 分类独立。应用消费者负责租约对账与 Evidence 登记，Provider 不完成 Task。\n');
await appendFile(docs+'/dev_docs/verification/2026-09-09-module-completion.md', `
\n## 阶段 A/B/C 的后续切片（整体仍未完成）
\n- Python: python-tests-4.log，2/2 通过，实际测试 4.25 秒。Jedi/Parso 压缩依赖在每个隔离查询进程的本地私有临时目录展开，避免挂载盘大量小文件读取；测试超时未增加。源别名语义定义/引用、静态调用、脏源码失效、禁止执行源码与越权路径覆盖。python-history-tests-3.log 的 memory/sqlite 历史授权两项通过；其 Python 超时是修复前失败，保留。
- Context: context-selection-tests-2.log，3 文件 31 项通过，34.90 秒；选择/冲突/必需缺口与 ModelBudget 最终请求容量。实际 provider 尚无模型对应 tokenizer，真实非执行角色尚未消费，B 未完成。
- 检查日志: check-journal-tests-2.log，2 文件 14 项通过，45.62 秒，真实内核沙箱命令与 SQLite/Vault、应用重开。结果落盘前中断用持久检查文件恢复点模拟，不是独立进程强杀。
- Evidence 登记: source-check-evidence-tests-5.log 中 tests/app/verification-imports.test.ts 9/9 通过；精确报告摘要接纳与重开重试、无 Goal 自动完成。随后 reconcile-check 恢复草稿/租约入口新增，尚在复验。
- 架构: architecture-tests-1.log 初轮 16 通过/5 失败；类型发现 PlanRevisionRef 不含 goalId，修为从正式 PlanSnapshot.goalRef 解析。architecture-tests-2.log 7/9，旧图夹具用假 digest，已换真摘要。architecture-source-tests-3.log 分类/回执 9/9；真实源码 SQLite 测试先因测试目录未建而失败。source-check-evidence-tests-5.log 又发现测试治理激活 CAS 误用 active revision，改用项目 revision；没有放宽产品 CAS 守卫。实际来源链仍待下一日志结果。
- types-6.log、types-8.log 通过；types-7/9 的失败及修复保留。最新新增代码仍需再跑类型与相关回归。
\nA1/A2 已接撤销、canonical Workspace/Plan 复核与同 Workspace 跨 Goal 历史授权；通用源码 pin/跨 Workspace 决定/全部历史消费者仍缺。A3 TS/JS、Python 已有局部实际工具证据，C++ 未实现。C2 已替换固定主路径、加入 sourceBinding 与真实 TS/JS 图 Adapter，基线准备/演进 UI、规则判定、真实角色及完整恢复还未闭环。D–G 未声明通过。
`);
await replace(docs+'/dev_docs/verification/2026-09-09-module-completion.md',[
['尚未发现必须改变产品承诺的具体取舍。当前先实现已有不变量可以推导的可逆内部机制；后续需要决定时保存精确方案与影响，仅阻塞依赖项。','P-AUTH-WS（同 Project 跨 Workspace 精确授权）待用户决定，见下方具体方案；当前仅同 Workspace，其他工作继续。架构来源绑定按既有 pin/不可变/不自动激活不变量实施内部扩展。'],
['| A2 | Ledger / Vault / Context | 精确跨任务历史授权、来源和正式工作结束资格 | 待实现；','| A2 | Ledger / Vault / Context | 精确跨任务历史授权、来源和正式工作结束资格 | 部分实现；'],
['| A3 | WorkspaceReader | 项目发现、配置依赖、增量、TS/JS/Python/C++ 分项覆盖、脏源码快照 | 待实现；','| A3 | WorkspaceReader | 项目发现、配置依赖、增量、TS/JS/Python/C++ 分项覆盖、脏源码快照 | 部分实现；'],
['| B1 | ContextCompiler | 人类/协调/规划/执行/Reviewer 的权限版本、必需项、检索排序、模型容量与清单 | 待实现；','| B1 | ContextCompiler | 人类/协调/规划/执行/Reviewer 的权限版本、必需项、检索排序、模型容量与清单 | 部分实现；'],
['| C1 | VerificationEngine | 真实配置、异常分类、检查中间状态、正文/证据登记与重启对账 | 待实现；','| C1 | VerificationEngine | 真实配置、异常分类、检查中间状态、正文/证据登记与重启对账 | 正在复验；'],
['| C2 | ArchitectureReconciler / WorkspaceReader | 精确基线、源码映射、真实 delta 与问题分类、登记失败恢复 | 待实现；','| C2 | ArchitectureReconciler / WorkspaceReader | 精确基线、源码映射、真实 delta 与问题分类、登记失败恢复 | 正在实现与复验；']
]);
console.log('Updated B/C contracts, module boundaries, code READMEs and execution evidence.');
