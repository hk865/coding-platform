# 本次收口的规范同步清单与有效剩余义务

审查者 audit_control；只读规范/当前源码，未改规范。核对时主 Agent 正集成，源码以最终 snapshot 再确认；本文件用于指出精确条款，不充当第二份当前状态。文档路径均相对权威文档根 `D:/1.project/Software/agent_learn/agent_dev/agent_platform`。

## 人类主入口应如何同步

1. **PRODUCT 不需要改产品承诺或验收语义**。保留「状态真实性」「连续执行」「证据驱动完成」「架构治理」要求；在决定/修订状态处指向 2026-09-11 已确认决定与本次偏差摘要。说明取消的是角色规格 requiredOutputs 的独立门禁，Plan 的 AcceptanceObligation/VerificationRequirement 仍须证明，不是取消证据驱动完成。
2. **ARCHITECTURE 保持 12 Module 和现有允许依赖图**。ModuleDependencyDAG 已正确要求 VE→Control/Context/Vault、Dispatch→Control/Context/Runtime/Vault/Ledger/Plan；不增加 VE→Ledger 或 Dispatch→VE。可在「投影、校验与语义判断」/「角色、记忆与 Context 的责任归属」附近补本次具体责任：Verification 提供验证问题材料，host 传递材料，Control 解释当前义务承担者与正式证据资格；Context提供运行产出材料；ReadModel 组织治理查询。该描述是既有边界落实，不是新模块选型。
3. **用户来源必须有当前原话链**。ADR0003 已新增「2026-09-11 用户确认与现行解释」：来源 `human/user-replies-2026-09-11.md` + 当前任务中“如果合理则我接受”；第18行已说明 RW-18 替代 D4-1/D4-3、Plan义务不变、无第13模块。保留第60-64行旧D4原文并明确它是被替代历史，不能删掉旧原文。用户本次已选“保持依赖图，传递问题材料”的决定由主 Agent 追加当前来源，不凭 Agent 自称接受。

## 12 Module 与直接 Interface 对照

| Module | 精确当前条款/位置 | 应同步内容与源码证据 |
| --- | --- | --- |
| HumanCollaboration | `modules/interaction/human-collaboration.md` 当前源码边界；`interfaces/module-boundaries.md` Human行 | 治理查询不再app扫账本，交ReadModel GovernanceViewPort；app保持人类命令入口/回执适配。不要据治理设置已接通宣称自然语言秘书/决定回流全完成。 |
| PlanCompiler | `modules/control/plan-compiler.md` 当前源码边界；`interfaces/module-boundaries.md:130` | 影响报告只消费权威既存工作身份；`planning-work-materials.ts` 通过Control resolver取材，`plan-compiler.ts`/`rework-plan-compiler.ts` 不再推导 work-taskId。resolved/absent/unavailable区分；缺材料明确影响清单不完整。Plan/Dispatch共享原起源链纯函数，历史绑定不改名。 |
| ControlEngine | `modules/control/control-engine.md` Invariants、当前源码边界；`interfaces/runtime-collaboration.md:45` | 新 `ReworkDispositionPort.projectIssues` 属无写入政策解释：当前Plan承担者与有效已接纳Evidence决定失败是否处置；与acceptReworkProposal受理写路径区分。工作唯一性不只是调用方先查，Control守卫+Ledger原子槽；旧库回填结果须写准确。 |
| DispatchEngine | `modules/control/dispatch-engine.md:Dependencies`、当前源码边界；`interfaces/module-boundaries.md:127-134`；`contracts/rework-drive.ts` 对应说明 | Dependencies漏写已允许的StateLedger/PlanCompiler，宜与ARCH一致。驱动输入是host捕获的issueMaterials；缺失明确unavailable；无Verification回调。每组受理后经Control重新解释处置，不因plan换版丢后续失败。事实来源仍VE，处置权威是Control，不能都写为VE权威。 |
| VerificationEngine | `modules/control/verification-engine.md:Dependencies`、当前源码边界、独立审阅末句“授权返工仍延期” | Dependencies本身正确，补实际无Ledger取材：VerificationContextPort extends RunOutputMaterialPort，`runOutputWitness`的load/events在Context；VE保留产出见证类别/轮次记录和journal读取。openIssues经Control ReworkDispositionPort解释当前性/处置，journal PASS或本地Reviewer decision不代替正式Evidence。末句改限定“返工最新版本自动重验与最终归约尚缺”，不能说返工触发/派发全未接。 |
| ArchitectureReconciler | `modules/control/architecture-reconciler.md` 2026-09-08段、2026-09-09兼容扩展、当前源码边界 | 旧段“revision0/固定Finding仍待修”应显式历史，而非现行待办。此轮若只整理可读性，报告领域步骤且不改变sourceBinding/规则判定。D2/D3产品能力仍未闭环，不能因源图/代码可读性改善标完成。 |
| StateLedger | `modules/data/state-ledger.md` 原子提交不变量；`interfaces/state-ledger.md` P1-16/工作身份相应补充（目前末尾主要到P1-07） | 记录task工作唯一性槽与事件/快照同事务，内存/SQLite同规则；旧库已存在binding的槽恢复、并发连接、重开不丢、旧重复身份如何保留不可变历史。不要把派发重试当存储原子保证；以data最终修复与实际测试为准。 |
| ArtifactVault | `modules/data/artifact-vault.md:20-22` Dependencies；`:59`“Vault不依赖Ledger/Control，检查由注入解析器完成”；`:70` 当前边界 | **明确冲突**：22行“无其他产品Module依赖”及59行不依赖Ledger均错误。按ARCH长期边改为StateLedger/ReadModelIndex/WorkspaceReader，material-access-policy实际消费；Control不作为新增依赖。59行需标历史或更新，不可仅尾部再加相反一句。70行旧`vault/`路径更正`src/data/artifact-vault/`。 |
| ReadModelIndex | `modules/data/read-model-index.md:44-51` Dependencies、`:139`当前源码边界；`interfaces/module-boundaries.md:89-111`治理Host例外 | 新GovernanceView读canonical治理快照与事件后组织view，**无需引入第二份持久active状态**，app仅委托；GovernanceViewPort/查询范围/缺口标记需入现行接口说明。旧Host显式例外已退出，保留为历史并注明本次替代；“以后第二消费者才搬”不再是规则。只读Control政策解释依赖已获ARCH允许，旧“完全不依赖Control Implementation”不能掩盖现有政策解释调用。 |
| ContextCompiler | `modules/data/context-compiler.md:50-58` 当前源码边界；`interfaces/module-boundaries.md:144`角色必读材料 | 补 RunOutputMaterialPort读取及归因材料由Context提供；Control仍决定Evidence/处置。WorkRunMaterialCompiler组织为领域取材步骤，code低层读取在WorkspaceReader role-source-reader；历史授权仍经Vault。现有manifest字节、权限、选择原因与缺口要求不变。 |
| WorkspaceReader | `modules/data/workspace-reader.md` 当前源码边界/来源版本段；`interfaces/module-boundaries.md` WorkspaceReader行 | `role-source-reader.ts`、`denied-prefixes.ts`统一源码列举/读取/路径边界；Context只请求有界材料，不自行开原生源。不能据适配归位声明完整多语言增量/外部依赖/原子快照已完成。 |
| WorkerRuntime | `modules/execution/worker-runtime.md` 能力声明/Context生命周期 | 本次无须改内核责任或能力选择；仍消费既有TaskEnvelope材料。保留supportsSnapshot=false、unsupported continuation、取消与未知副作用实际边界；读取适配归位不意味着运行期二次取材/完整恢复实现。 |

上述 Module 路径前缀均为 `dev_docs/`；Interface同理。行号为核对时点，编辑后用标题与引用定位。

## 必须更新的共享条款

- `dev_docs/interfaces/module-boundaries.md:89-113`：将治理Host例外整体标历史/移出默认规则，再写现行ReadModel读取；保留旧理由作为历史证据，但明确“投影必然第二真相源”的推论不作为现行限制。当前实现是按需读取，并不另存active authority。
- 同文件`:129-134`：失败分类与原始报告来自VE；当前义务处置来自Control；Dispatch接收材料而非查询VE。同步真实生产调用链，不只改import图。
- 同文件`:144`：requiredOutputs声明性与Plan正式义务并存；“记忆模块接上后由它承担”改为“既有12 Module内记忆能力的后续工作”，具体职责未决定前不能新增Module或擅自搬家。`runOutputWitness`供材与Verification解释分开。
- `dev_docs/interfaces/context-lifecycle.md`：当前工作身份建立/接续部分明确唯一性权威与实际起源，影响报告引用不得另造ID；若无本次条款则短增量指向contracts，不复制wire schema。
- `dev_docs/interfaces/runtime-collaboration.md:39-52`：可补Control当前义务处置读端口、VE问题材料、host显式传递；原“Context不归约、不启动模型”不变。
- `dev_docs/interfaces/state-ledger.md`：新增原子工作身份提交及旧库恢复兼容，不凭Control先查断言并发安全。
- 对应源码README也需与现行责任一致：尤其harness README仍描述注入`reworkIssues`可保留为host取材，但不能写Dispatch调用该函数；VE/Dispatch注释中“VE权威处置”“只给scope”“原样issues”现已有部分过时，主集成时一起清理。

## 唯一当前状态必须消除的旧缺口

`human/module-status.md` 及 `dev_docs/verification/2026-09-10-core-obligations-map.md` 不能只追加新日期然后保留当前总表相反结论。以下旧结论已不适合作为当前待办：

| 当前文档位置 | 应更正的旧说法 | 应保留的准确边界 |
| --- | --- | --- |
| core-map总表#2（第30行） | applyPlanChange零产品调用、无派发；impact完全硬编码 | 人工/语义amend反馈源仍缺；机械自动返工已经消费正式change链并派发，真实work身份影响报告本次修复。不要用返工证明全部语义反馈规划。 |
| core-map总表#7（第35行）、第二节第2项、D1链注 | FAIL没有任何返工任务生产者、需先决定承载形态 | 新PlanRevision承载、已接受自动受理、真实任务派发均已有；仍缺最新版本自动重验/再次独立审阅/最终归约完整链。 |
| core-map D4行（第四节实施进展） | RoleSpec无产品入口、矩阵恒不存在、requiredOutputs无消费者、只堵派发身份 | 五类治理与RoleSpec/矩阵已接；声明性产出已有见证，必读供材已有；canonical唯一性本次再补旧库。保留真实角色持续协作、全部继承消费者不足。 |
| core-map#4/#5 | 指向D4三项过时缺口；历史消费者只有探索前驱 | WorkRunMaterialCompiler派发中已消费工作与历史，不能再称只有探索。长期记忆CRUD/检索质量/更多角色仍缺。 |
| module-status当前摘要约第39-45行 | 同一任务仍可公开造第二身份；investigator等缺requiredOutputs会扣留归约 | RC-03/旧库修复及RW-18已替代，历史验收原文留在历史段；本次状态写准确。 |
| module-status允许边说明/消费者表约第365行及12模块表 | VE返工未接通/待用户决定、角色设置完全未接 | 已接受决定不再反复列待决；仅剩完整重验/角色反馈等实际未完能力。ReadModel治理、VE Context+Control、Dispatch材料传递更新真实链。 |
| module-status历史覆盖清单约第449-457行 | 编号易被误读下一实施顺序 | 保留其“历史覆盖、非授权”标注；未完义务进入当前清单，禁止因移出默认分工丢义务。 |

core-map第四节“以下四项已在2026-09-10由用户决定”须与ADR新增说明一致：本次可证明的是2026-09-11确认，不倒推旧日期所有细节均批准。决定前A/B/C/D方案、真实失败、1671/1672等旧验证原文继续保留，标其原始身份。

## 收口后仍有效的未完成产品义务

这是从两份当前表去除已修旧缺口后的承接清单；它不授权下一阶段实施，也不声称每项完全没有代码。

1. **角色持续协作与反馈规划**（core-map#1/#2）：秘书/参谋/书记/规划/集成的实际有界运行、跨工作包收敛责任、真实反馈生成提案与改版；现有初始/人工计划/机械返工不能代替全部角色闭环。
2. **补料与人的决定回流**（#3）：needs_material→正式问题/调查→按角色路由→带来源响应→重编译→实际消费回执；越界返工的具体选项/人的决定产品入口；所有受影响Context刷新。已有QueryJob不能冒充向源Worker实时索取材料。
3. **最新版本返工重验**（#7、D1）：在实际返工Run后自动启动当前版本工具检查、独立重审、正式Evidence接纳与Control再次归约，保留原FAIL和新来源关联；不能因本次处置资格修复就宣布该闭环完成。
4. **运行生命周期与接续恢复**（#6）：pause/resume/steer产品入口与能力一致；公开快照/材料能力；跨Run/换手/强杀后义务和未知副作用对账。已支持取消/部分重启恢复单独保留。
5. **长期记忆与历史适用性**（#4/#5）：查看/更新/作废/检索、相关性排序、面向更多工作与角色的继承、访问授权与当前来源判定；产出历史核对在现有12 Module内设计。已接WorkContext/部分历史材料不再列缺失。
6. **真实架构基线与治理闭环**（#8、D2/D3）：版本化映射/规则source、现场sourceBinding、产品inspect、语义只读架构审阅、allow_only/no_cycle/interface_surface及MigrationGate机械+行为双证据、演进决定/激活/反馈。当前forbid_dependency和局部差分保留为已有。
7. **来源与通用Evidence失效**（#9）：完整配置/外部依赖、多语言持久增量、全部角色版本化片段、通用来源失效消费。探索/Reviewer pin及本次返工资格不能代表全局自动失效完成。
8. **真实历史Git差异能力**（#10）：历史树/版本差异与可追溯界面呈现。现有HEAD对工作树清单已有，不重写成“完全无Git读取”。
9. **统一交互与实际设置消费**（#11）：自然语言协商、分工/等待/失败原因、必要选择、规则/记忆设置影响真实运行、决定消费结果；治理/角色设置已存在的入口必须保留评价，不能一概列“未接”。
10. **完整真实任务及效率证据**（#11、PRODUCT成功标准）：真实任务贯穿提问、分工、取材、审阅返工、重启与决定回流；成功率、重复探索、用量/耗时、不必要人类介入，随后再由用户决定benchmark范围。框架测试/模型stub/浏览器和真实模型质量分别陈述。

本次文档同步完成后，上述清单应由module-status作为唯一当前状态承载，core-map按义务引用同一结论，交接只写当下事实及后续入口。无需把历史Ticket全部归档才能完成本次核对。
