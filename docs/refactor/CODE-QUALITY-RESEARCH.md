# 代码质量规范调研与模块文档融入方案

```yaml
status: research-with-document-integration
updated: 2026-09-22
scope: 外部规范调研、模块文档结构核对、本轮共同要求与落地记录
result: 已将质量规范与重构目标纳入模块文档；外部默认值未直接移植为自动门禁
```

## 1. 结论与当前缺口

**本项目需要代码质量审查。调研时的主要缺口是已有约束分散，尚未形成统一、可验证的实现质量规则。** 模块职责和接口写清楚是必要条件；还需检查模块内部怎样分工、共用实现是否真正替代旧副本、复杂度是否转移到别处，以及真实功能是否保留。

**同日落地更新**：用户随后确认将代码规范、重构目标、接口清晰和职责／功能清晰落实到文档。共同要求现集中在 [CODE-QUALITY-GUIDELINES.md](CODE-QUALITY-GUIDELINES.md)，13 篇模块增加 §9“重构目标与质量验收”，并核对 §1／§2。本文保留调研依据和采用过程；具体要求以共同规范及各模块最新正文为准，源码验收仍未完成。

本轮以作者已经表达的目标为准：去冗余、降低过重职责、分析大文件是否需要拆分、提高有实际消费者的代码复用，并让接口容易理解。可插入记忆／知识等只是扩展性的一个例子，不据此新增通用流程引擎或产品承诺。

| 当前已有内容 | 证据位置 | 仍不能单独回答的问题 |
| --- | --- | --- |
| 产品方向、连续 Session 复用和成本意图 | [PRODUCT](../history/before-2026-09-22/PRODUCT.md) §1、§7、§9；人类意图来源由该文文首登记 | 实现是否减少实际重建和 I/O，不能只看新增概念。 |
| 13 Module 的目标边界、状态权威、依赖方向 | [ARCHITECTURE](ARCHITECTURE.md)、[模块索引](modules/README.md) | 模块内部入口是否仍包办所有工作、接口是否包裹旧复杂度。目标是 13 模块／38 边，源码尚处 12 模块／34 边基线。 |
| 共用实现 owner、消费者与旧路径去向 | [ownership-map §13～§15](modules/ownership-map.md#13-共用实现与旧路径去向) | 尚需逐项用源码证明消费者收敛、旧副本退役、差异行为保留。 |
| 源码分析与人类意图审阅 | [历史 source-analysis](../history/before-2026-09-22/refactor/source-analysis.md)、[已有审阅](MODULE-REFACTOR-INTENT-REVIEW.md) | 这些是审查线索和特定快照结论，不是后续每次变更均可执行的统一规范。 |
| 已有可读性数值标准 | [R2 评估标准](../../my-coding-platform-docs/agent_platform/dev_docs/decision/01-evaluation-criteria.md) 维度 2 | 已规定文件／函数长度等口径；但它面向方案比较，未形成完整编码规范或自动门禁，需与本轮模块及实现验收衔接。 |
| TypeScript 严格检查和测试脚本 | [tsconfig](../../coding-platform/tsconfig.json)、[package.json](../../coding-platform/package.json) | 类型正确不能证明职责划分、可读性、行为等价与复用收益。 |
| 模块边界检查、Contracts 局部规则 | [边界检查器](../../coding-platform/scripts/check-module-boundaries.mjs)、[Contracts README](../../coding-platform/src/contracts/README.md) | 静态 import 检查有覆盖边界；宿主注入、间接调用和规则语义仍需人工核对。 |

当前产品包有 `typecheck`、`test`、`check:architecture`。`check` 只执行类型检查与测试，未组合架构检查；该包的 scripts 中未见统一 lint／format 入口。这不等于所有子包、第三方代码或 CI 都没有其他工具。已有类型严格项包括 `strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes` 等，本轮不降低它们。

本轮补入的规范包括：内部职责如何拆、公共面如何收窄、什么才能共用、错误与副作用如何保真、名称和注释如何表达意图、怎样用行为证据证明重构完成；另以 RG-01～RG-06 明确重构应达到的结果。见 [共同规范](CODE-QUALITY-GUIDELINES.md)。这些要求用于本轮文档与后续实现审查，尚未配置为 CI 自动门禁。

## 2. 查到的公司规范、工具文档和 skill

优先采用原作者文档与官方仓库，未以二手博客转述作为规则依据。四组可再分发资料已按固定提交保存，共 12 个原文件，含许可证；入口和校验清单见 [参考目录](references/code-quality/README.md)。

| 来源 | 实际覆盖范围 | 对本项目的用途与限制 |
| --- | --- | --- |
| Google [Code Review Standard](https://google.github.io/eng-practices/review/reviewer/standard.html) 与 [What to look for](https://google.github.io/eng-practices/review/reviewer/looking-for.html) | 代码健康、设计、行为、复杂度、测试、命名、注释与文档 | 适合作为质量审查框架；审查结论要有理由，不以个人风格追求完美。识别没有当前需求的过度泛化。 |
| Google [Small CLs](https://google.github.io/eng-practices/review/developer/small-cls.html) | 如何组织自包含、容易审查的变更 | 用来组织后续迁移批次；行数例子描述一次代码变更，不是源文件大小限制。 |
| Google [TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html) | TypeScript 编码习惯和类型／接口表达 | 可借鉴命名与必要导出；指南有 Google 环境前提，不能整套移植其工具和限制。 |
| Airbnb [JavaScript Style Guide](https://github.com/airbnb/javascript) | JavaScript 语法、风格、lint 约定 | 可帮助选择格式与语言规则；不足以审查本项目的状态权威、共享实现和重构效果，不直接装整套配置。 |
| Microsoft [TypeScript Coding Guidelines](https://github.com/microsoft/TypeScript/wiki/Coding-guidelines) | TypeScript 编译器仓库贡献规范 | 官方明确限定该仓库贡献者。可比较命名／可读性思路；不要把编译器特有的目录、文件组织规则当通用企业标准。 |
| Sentry [code-review skill](https://github.com/getsentry/skills/blob/main/skills/code-review/SKILL.md) | 面向 Sentry 项目实践的 PR／代码变更审查，检查运行错误、性能、兼容性、安全、设计与测试 | 已保存原文，可借鉴清单；它不是本项目规则，也不替代全库依赖、存量重复与模块设计审查。需补 owner、共同实现与旧路径退役检查；Django／React 示例不直接移植。 |
| ESLint [规则文档](https://eslint.org/docs/latest/rules/)；SonarSource [Quality gates](https://docs.sonarsource.com/sonarqube-server/quality-standards-administration/managing-quality-gates/introduction-to-quality-gates) | 可配置的静态指标与质量门槛 | 用于明确指标含义和将来自动化；工具默认值不是公司普遍共识，也不是本项目已启用的门禁。 |

**Skill 检索结论**：本轮检索的 OpenAI 精选列表有安全审查、CI 修复、PR 评论处理等专门技能，未发现通用代码质量审查项。Sentry 有真实 `SKILL.md`，可作为将来本项目审查 skill 的参考。本轮只下载阅读，没有全局安装或执行第三方 skill。

另核对了 Anthropic 的 [code-review 插件命令](https://github.com/anthropics/claude-code/blob/main/plugins/code-review/commands/code-review.md)。它着重 PR 改动中的高置信缺陷与仓库指令符合性，排除一般质量建议、风格问题和已有问题，**不适合单独承担当前这种跨模块、存量代码与去冗余审查**；它也不是一个 `SKILL.md`。其 [仓库许可说明](https://github.com/anthropics/claude-code/blob/main/LICENSE.md) 未提供可据以当作 MIT／Apache 开源资料镜像的许可，本轮仅保存链接与解读。

建议先稳定本项目规则和模块专项清单，再将“读上位意图 → 读模块与共同规则 → 核对真实调用 → 列证据 → 复核”的过程封装成项目 skill。Skill 用于执行检查，不成为另一份会漂移的规则来源，也不以一个 PR 查错技能替代设计质量审查。

## 3. 数字的含义与本项目的取舍

**项目已有数字，不能遗漏或擅自取消。** [2026-09-18 的 R2 评估标准](../../my-coding-platform-docs/agent_platform/dev_docs/decision/01-evaluation-criteria.md) 维度 2 写明：文件 **>1000 行不达标、>500 行警戒**；函数／方法 **≥120 行不达标、≥80 行警戒**；8 行规范化窗口的重复组 **>200** 记问题；仅本文件引用的导出占比 **>10%** 记疑似死代码。该维度用于方案比较中的排序，并非必要条件的一票否决项；其计数、启发式识别与抽样也有明确范围和局限。

这些具体数字来自本项目评估文件，本次外部调研没有证明它们是通用行业标准。应保留其原有评估用途和历史可比性；若今后校准阈值、区分代码类别或改成 CI 门禁，需在规则来源及工具配置中明确同步。本稿不静默把旧标准降成建议，也不把它扩成全仓自动阻断。

本次查到的外部资料没有支持“所有文件必须小于 500 行、依赖不超过若干层、复用率达到某个百分比”这样的通用结论。没有项目依据的新增数字只作候选例子。

| 资料中的数字／指标 | 正确解释 | 本项目建议 |
| --- | --- | --- |
| Google 的 100／1000 行例子 | [Small CLs](https://google.github.io/eng-practices/review/developer/small-cls.html) 讨论的是一次变更大小，且明确不存在统一硬规则。 | 按独立目的组织变更，不能推导出单文件上限。 |
| ESLint 文件长度默认 300 | [max-lines](https://eslint.org/docs/latest/rules/max-lines) 启用后的默认配置，可配置是否跳过空行和注释；不是自动启用的行业门槛。 | 先观测文件分布与职责，再决定告警及例外。 |
| ESLint 函数长度默认 50、圈复杂度默认 20、嵌套默认 4 | 分别是 [max-lines-per-function](https://eslint.org/docs/latest/rules/max-lines-per-function)、[complexity](https://eslint.org/docs/latest/rules/complexity)、[max-depth](https://eslint.org/docs/latest/rules/max-depth) 的配置；测量对象不同。 | 长函数、复杂分支、深层嵌套分别检查；嵌套层数不等于模块依赖深度。 |
| Sonar way 新代码覆盖率 ≥80%、重复率 ≤3% | [预置质量门槛](https://docs.sonarsource.com/sonarqube-server/quality-standards-administration/managing-quality-gates/introduction-to-quality-gates) 的部分条件。默认小变更例外：新代码行数不足 20 时忽略重复率条件，待覆盖新代码行数不足 20 时忽略覆盖率条件；项目可覆盖该设置。 | 可作为工具方案比较，不直接设成存量全仓目标。覆盖率不证明正确性，重复率也不是复用率。 |

建议度量“同一规则有几份实现、哪些消费者已经收敛、哪些旧路径已删除、同场景实际少做了什么”，比宣称一个代码复用百分比更符合本轮目的。指标要区分生产代码、测试、生成物和第三方代码；复杂事务、静态协议表等不能仅因长度被机械拆分。

## 4. 当前 13 篇模块文档的通用章节规划

实际核对了 `control/`、`data/`、`execution/`、`interaction/` 下的 13 篇。调研时均为 8 个一级编号章节；**此次落地后保留原 8 章并统一补入第 9 章**。文首另有日期、草案状态、Plane、Module、代码目录、契约状态与上位架构等元信息。

| 当前章节 | 在回答什么 | 应保留的边界 |
| --- | --- | --- |
| **1. 职责** | 本模块做什么、不做什么；当前部分模块也在这里说明内部共用能力。 | 对外责任和内部实现单元分开；不是把所有辅助函数列成 Module。 |
| **2. 对外接口** | 向谁提供什么能力，输入输出、约束与失败、本次变化；并区分公开 Port、当前公开实现和内部映射。 | 现状／目标分别写；消费其他模块的接口不能混作本模块提供面。精确字段协议后续冻结。 |
| **3. 依赖** | 本模块消费哪些模块的哪些接口、消费目的与方向。 | 宿主注入不会消除逻辑依赖。 |
| **4. 被依赖** | 哪些模块或宿主依靠本模块、使用哪个入口。 | 与 §2 及消费者的 §3 互相对得上；不能只列模块名。 |
| **5. 状态归属** | 拥有哪些对象和状态，哪些只是观察／投影／引用，谁写、怎样演进。 | 保留唯一权威与生命周期；只读消费 canonical 事实不代表该事实降为非权威。 |
| **6. 旧标识去向** | `agentId`、`workId` 等旧标识怎样保留、迁移或退出；不持有时说明原因。 | 不把 Run、Work、Session 等身份机械替换成同一个概念。 |
| **7. 本次接口变化方向** | 本次增加、保留、收敛、迁移什么，接口变更编号及旧调用去向。 | 给 Prompt 4 接口设计和后续迁移提供方向，不宣称目标已实现。 |
| **8. 信息缺口** | 哪些协议参数、共享归属、实现前提或验证还未确定。 | 缺口有来源和后续落点；不靠编造字段或默认成功来填空。 |
| **9. 重构目标与质量验收** | 本次解决哪些问题、目标与改动边界、共用实现和旧路径去向、验收证据。 | 引用共同 RG／CQ 与 S 编号，只写模块差异；要求已纳入不代表代码已达成。 |

[README](modules/README.md) 是目录索引、横向汇总和结构验证说明；[ownership-map](modules/ownership-map.md) 是跨模块事实、共享规则及 owner 的总表。它们不是第 14／15 个模块，也不使用这套 8 章模板。

与 [Prompt 3](../refactor-prompts.revised.md) 的关系：前五章对应职责、接口、依赖、被依赖、状态归属五要素，§6～§8 展开旧标识、变化方向与缺口。Prompt 3 强调局部设计与必要内容，**没有原文要求单列完整代码质量规范**；不能把此前“没有第 9 章”追溯判为违反 Prompt 3。第 9 章来自本轮用户确认的补充要求，通用规范仍不复制进模块正文。

## 5. 怎样融入，而不再制造重复文档

本轮采用“一份共同规则＋模块专属证据”，保留原 8 章并统一补入第 9 章：

1. [共同规范](CODE-QUALITY-GUIDELINES.md) 只维护一次 CQ-01～CQ-12，覆盖功能保真、内部职责、接口、复用、类型、状态与错误、易读性、测试、成本、指标、扩展、变更证据；RG-01～RG-06 单独说明应达到的重构结果。
2. 模块 **§1** 补确实缺少的内部分工；**§2** 继续承担契约表达。**§7 现有单行“本次接口变化方向”保留原格式和 Prompt 4 边表输入用途**；本轮专项质量内容统一放 §9，避免把接口交接行扩成质量清单。
3. **§8** 承接未确定参数和例外；已有缺口直接引用，不再复制一份相同的待办。
4. **§9 重构目标与质量验收**用统一四列表把当前问题、目标、共同实现／旧路径和证据串起来。13 篇各有真实专项内容；AgentLifecycle 按新增职责承接与接口验证写，不虚构自己的旧实现。这是对模板的有意扩展。
5. `ownership-map` 继续维护共享 owner 与跨模块复用关系；质量规范只引用它，不另建第二张 owner 权威表。Prompt 4 确定 DAG、边与传递内容，精确协议按架构 §9.2 的后续接口契约确定；Prompt 6 落实施步骤、切换和退役。

一个模块一般列 3～5 项高风险专项要求。公司指南、全部 CQ 条目、通用命令和格式规则只保留在共同文件。填写规则和实际示例入口见 [共同规范 §4](CODE-QUALITY-GUIDELINES.md#4-融入模块文档的最小写法)。

资料保存与融入方案之后，本轮已将要求写入 13 篇模块，统一为 9 章；没有据此冻结新的接口 schema、变更模块边或新增自动门禁。

## 6. 13 个模块分别应该补什么

下表记录**调研时提出的专项审查内容**，用于解释采用理由；各模块 §9 已承接并细化，后续修改以模块页为准，本表不另维护完成状态。实现前仍需定位当前符号与真实消费者，不能把旧分析的行号当永久证据。

| 模块／文档 | 质量重点与内部职责 | 应要求的证据 |
| --- | --- | --- |
| [HumanCollaboration](modules/interaction/human-collaboration.md) | CQ-01/03/07/08：入口转换、查询呈现与控制请求分开；复用现有查询和决定路径，避免 UI／宿主再实现业务受理。 | 用户入口到真实 provider 的接线；受理、执行中、最终结果分别可见；解释现有方案不误触发再次规划。 |
| [PlanCompiler](modules/control/plan-compiler.md) | CQ-02/03/04/08：材料获取、提案编译和提交协调各有责任；初始、人工计划、修订、返工保留自己的来源与约束。 | 提案保持来源／版本；拒绝与缺料保真；解释请求不等价于 `requestInitial`；共同步骤的消费者和旧路径清单。 |
| [ControlEngine](modules/control/control-engine.md) | CQ-02/04/06/08；S01/S02：机械提交步骤可共用，授权、守卫、归约仍有明确政策 owner；按命令族拆内部职责。 | 正式状态写入仍经过合法控制路径；权限、CAS、幂等和失败回执回归；共同纯函数不变成第二套受理权威。 |
| [DispatchEngine](modules/control/dispatch-engine.md) | CQ-02/04/06/09；S05：准入、准备、claim、启动、对账分清步骤；普通／Reviewer／Handoff 等入口有明确收敛关系。 | 各入口实际接线与顺序约束；恢复／重试不重复启动；Session 成功续用不强迫全量 Context 编译。 |
| [VerificationEngine](modules/control/verification-engine.md) | CQ-02/04/06/08；S04/S09：共用检查准备和执行；单项检查与轮次恢复、聚合等生命周期差异保留。 | 同一检查的行为一致；轮次恢复与 Reviewer 独立性；路径政策共享依赖待上位确定，不能用注入隐藏新边。 |
| [ArchitectureReconciler](modules/control/architecture-reconciler.md) | CQ-01/02/06/08：来源捕获消费、图差分、Finding／Brief、提案物化各自清楚；首次建立与后续演进分开。 | baseline／来源版本对应；stale、缺来源和漂移判据；inspect 真实入口；观察结果不直接激活 canonical 基线。 |
| [AgentLifecycle](modules/control/agent-lifecycle.md) | CQ-01/03/06/11：新模块只作生命周期决策与提案，结果集与调用方后续动作可追踪。 | 复用／新建／需材料等分支，`decide` 与 `propose` 的协议；提交仍由 Control 受理；当前设计新增，不能先填“测试通过”。 |
| [WorkerRuntime](modules/execution/worker-runtime.md) | CQ-02/04/06/08/09；S07/S08：能力探测、环境准备、受限调用、结果适配分工；平台观察与 Kernel 原始正文区分。 | unsupported 如实返回；真实连续任务／恢复接线；取消与预算；迁移 trace 前清点消费者，不以另一份正文副本冒充引用复用。 |
| [StateLedger](modules/data/state-ledger.md) | CQ-04/05/06/08；S11：共用结构校验，事务内 CAS／幂等／原子性留在正确提交边界。 | 内存／SQLite 的等价契约；冲突、重复请求、失败时 snapshot＋event 的一致性；不能仅验证事务外预检。 |
| [ArtifactVault](modules/data/artifact-vault.md) | CQ-04/05/06/08；S12：共同正文与完整性核心＋薄存储适配；不扩成通用 Repository。 | 不可变正文、授权与版本失效路径；内存／SQLite 差异明确；正文先持久化、引用后提交的既有语义保持。 |
| [ReadModelIndex](modules/data/read-model-index.md) | CQ-02/04/06/08/09；S03：领域投影共用，存储、事务与游标留在适配器；投影不变成正式状态写者。 | 同事件序列的领域结果等价；分页、重建和重复处理符合契约；全表扫描风险用固定规模测量验证。 |
| [ContextCompiler](modules/data/context-compiler.md) | CQ-02/03/04/06/09；S06：读取、引用／缺口、预算、增量组装共用；按消费者保留真实专用约束，不机械合成万能 Port。 | 缺料在模型调用前失败关闭；L1/L2/L3 不冒充；普通消息／成功恢复绕过全量编译；增量收益及每轮读取次数可测。 |
| [WorkspaceReader](modules/data/workspace-reader.md) | CQ-03/04/06/08；S09：捕获与分页、路径安全与索引忽略分清；能力差异显式表达。 | 多页属于同一次不可变捕获；来源变化显式 stale／重试；拒绝路径与实际文件访问一致，共享政策保留合法 owner。 |

对于模块之外的 Host／Composition、Contracts、Storage，继续使用 [ownership-map §15](modules/ownership-map.md#15-非-module-的承接范围) 的归属：装配不承接领域编译，协议不收纳业务政策，存储原语不复制各模块的状态机。它们同样接受实现质量审查，不为此新增 Module。

## 7. 审查与落地顺序

**当前可做的文档质量审查**：检查内部分工、提供与消费面、共享 owner、旧实现去向、失败语义和验收条件。即使暂时没有 CI，也能发现“换名称但旧逻辑仍各有一份”“新增门面却隐藏原复杂度”等问题。

**后续源码质量审查**：以当前源码而非目标文档为依据，优先核对 `source-analysis.md` 提示的热点，以及 S01～S12 共享项。先读真实消费者，再决定抽取；每个问题给当前文件／符号、触发场景或维护成本、影响、依据和验证方法。

**自动化规则落地**：先建立生产代码与测试等分类基线，再决定告警／阻断、例外和新代码范围。现有类型检查、相关测试和架构检查继续使用；增加 lint 或覆盖率门槛属于后续明确的工具配置工作，不能由参考指南的默认值自动产生。

**完成判据**：同义实现有共同 owner 和实际消费者；旧副本已退出或有明确兼容期限；关键功能、错误与并发语义得到验证；性能声明有同条件测量。拆出更多文件、删掉更多接口或通过文档结构核对，都不能单独证明重构质量。

## 8. 本轮交付与验证范围

- 外部参考原文：4 个来源仓库、12 个文件，保留许可证、提交与 SHA-256，见 [manifest](references/code-quality/manifest.json)。
- 本项目共同要求：12 项质量规则、6 项重构目标、指标口径、模块写法与审查证据格式，见 [共同规范](CODE-QUALITY-GUIDELINES.md)。
- 当前结构说明：本报告 §4；13 模块专项融入建议：§6。
- 调研阶段新增参考原文和规范草案；用户确认落实后，本轮已修改 13 篇模块及索引，补入专项目标与验收要求；生产源码、上位产品／架构和旧文档仓保持原样，未安装第三方 skill。

本次核对范围是规范来源、文档结构、当前工程配置、模块职责与接口表述以及质量要求落地；没有重新运行全部源码测试，也没有完成 13 模块的源码质量复审。源码测量和实际重构结果仍须按实现阶段留证。
