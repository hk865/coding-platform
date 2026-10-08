# 第 3 片冻结规格：上下文与图工具

> **状态：** lead 冻结，2026-10-08。代码基线 9b94fc55（src 与 676a7a7b 相同；收尾的全量测试在 676a7a7b 上是 215 个测试文件、5234 项全部通过）。§0 是 lead 的冻结说明；§1–§9 是 Codex（推理强度 xhigh）按 585f1ac0 写的草稿正文，lead 按 §0 改过：改过的地方标【lead 改】，lead 定的技术选择标【lead 定】。**§0 与正文不一致时以 §0 为准。** 依据：[DESIGN §8.2](../DESIGN.md#82-分片表) 第 3 行、§2.8、§5.1–5.4、§7.2；HANDOFF 决定 42（AMB-37、AMB-38）、43；[分片总说明](README.md)。

## 0. 冻结说明（lead）

### 0.1 OPEN：要用户定

无。草稿 §7 末段的判断 lead 核对过：AMB-37、AMB-38 已定（决定 42 所列），装配器的分段、格式和版本规则按决定 43 由 lead 写定（就是本规格 §4.3），没有新的用户可见缺口。自由标签的产物对不上时“列出上游事实、由 agent 判断”是 DESIGN §2.8 原文，不是新决定。

### 0.2 lead 定的技术选择（一行一项，理由在括号里）

草稿 §7 的 8 项，全部选草稿推荐的 A：
- **T1** 消费的版本：准备时存进 manifest；“看”读到的版本留在 Kernel 原工具结果里，不另建消费记录。（原历史已经保存版本，第二本账没有读者。）
- **T2** 预算：四个可选段（足迹、注记索引、提醒、精确输入）按固定顺序取全局最长前缀，段头和标记都计费；预算太小时省略说明移到必需的任务卡末尾。（可复现；满足 AMB-38“必需段不裁、写明省略几条”。）
- **T3** 段头沿用现在的 `##` 风格，接续说明原样放最后。（已有文本断言和人工阅读习惯都不变。）
- **T4** 职责存在 `RoleSpecContentV1.platformDuty`（可选）和 Host 选的、带版本的 legacy 模板 ref 上；旧正文不填默认值，摘要不变。（第 5 片能从同一个 Role 事实核权限；职责建 Session 时定，不在运行中换。）
- **T5** 旧的四个只读工具保留原实现和导出，只在注释里标“已由 look_graph/find_graph 取代”；新授予清单用 look/find。（已绑定的 Run 和旧调用者不受影响。）
- **T6** 自由标签的产物：今天没有“按标签发布产物”的正式记录，所以读作 missing 并列出上游事实；不加内部候选来源。（不为本片新造写协议。）
- **T7** 新建 `views` 子模块放读模型。（DESIGN §7.2；读和 scope 规则收在 WorkGraph 里。）
- **T8** 图工具结果沿用 64 KiB 的工具定义，完整 JSON 超过 48 KiB 时明确返回 `capacity`，要求翻页或下钻。（不让 Kernel 截断一个 ready 的 JSON。）

lead 另定的 5 项：
- **C1 两个 source pin 文件已经删了。** 收尾提交 7e0b7f56 删了 `src/core/workspace/material-source-provider.ts`、`src/core/workspace/source-applicability.ts`、它们在 allowlist 里的条目，以及 `material-access.ts` 里的 `SourceApplicabilityPort`、`MaterialSourceCaptureResult`（HANDOFF 2026-10-08 一段；DESIGN §2.8）。本片不再删，`src/contracts/material-access.ts` 不在写范围里。
- **C2 `graphHistory` 已经是必填依赖。** `RuntimeExecutionDependencies.graphHistory: GraphExecutionHistoryReadPort` 已在 `src/core/agent-runtime/execution-contracts.ts:182`（RT8）。草稿说“新增可选 graphHistory”，不对；直接用已有字段。`RuntimeExecutionDependencies` 和 `ExecutionPreparationDependencies` 各只加 `graphContext?`、`taskInputs?` 两个可选字段。
- **C3 文档不在 DSH 写范围。** 草稿 §6 的第 45–50 行（`module-target.json`、`module-dag.md`、STATE-MACHINES-SPEC、能力索引、HANDOFF、STATUS）删出写范围：`views` 的声明由 lead 在 B0 写好（README），其余由 lead 在验收后同步。
- **C4 `PlatformDutyV1` 用共用文件。** 类型在 `src/contracts/platform-duty.ts`，取值 `'executor' | 'secretary' | 'adviser' | 'scribe' | 'reviewer'`。本片按 [README](README.md)“共用文件”的原文逐字节新建它（sha256 `6adfb57e8bcb7ec387257e19c3811abb61a5fd21d37a8889566bf34cc32a9e39`；第 1、5 片也建同一个文件，内容相同，合并时不冲突）；`graph-context.ts` 从那里 import 再导出，不另定义。
- **C5 `views` 的依赖由 B0 一次写好。** 第 3、5 片都在 `views` 里建文件，依赖取两片的并集：`model, state, persistence, configuration, materials, architecture, sessions, queries, tasks, evidence, communication`。本片的 `views` 文件仍不 import `evidence`、`communication`、`notes`（草稿 §2.3 的规则不变），不改 `module-target.json`。
- 另：草稿只写了“Host `localWorkbenchGrant`”，它在 `src/app/host.ts:499`（已在 §6 第 26 行）。

### 0.3 对草稿的改动清单

| # | 位置 | 改动 |
| --- | --- | --- |
| 1 | §1.1、§1.3、§2.4 第 7 条、§6 第 4/31/32/33 行、§8.2 | 去掉删 source pin 文件的工作（C1） |
| 2 | §4.4、§4.6 | `graphHistory` 用已有字段（C2） |
| 3 | §6 第 45–50 行、§6 末段 | 文档移出写范围（C3） |
| 4 | §2.2 | `PlatformDutyV1` 从 `./platform-duty.js` 来（C4） |
| 5 | §2.3 | `views` 已由 B0 声明（C5） |
| 6 | §4.6 | 注明 `localWorkbenchGrant` 在 `src/app/host.ts:499` |
| 7 | §7 | 每行标【lead 定】 |
| 8 | §9 | 数量按 §0.6 |

### 0.4 和第 1、5 片的接缝

三片从同一个基线（第 0 片合入、B0 提交之后）各开一个副本并行施工，按 1 → 3 → 5 的顺序合入（[README](README.md)）。本片要知道的：
- **第 0 片先合入。** 本片改 `src/app/attention-observer.ts`，要在第 0 片的写法（`depends:t1->t2:artifact:schema.json`）之上做（AT04 依赖它）。
- **和第 1 片同改的文件**（合入本片时由 lead 合并，两边的新增都保留）：`agent-runtime/` 下的 `execution-preparation.ts`、`ports.ts`、`runtime.ts`，`queries/query-execution.ts`，`tasks/execution-entry-service.ts`，`app/core-routes.ts`、`app/core-http-types.ts`，`composition/create-platform.ts`。第 1 片给 `ContinuationBriefV1` 加 `anomalies` 段；本片把接续说明原样放在最后（`renderContinuationBriefZh` 的输出），不改它，所以合并后自然带上锚点段。
- **和第 5 片同改的文件：** `app/core-routes.ts`、`app/core-http-types.ts`、`composition/create-platform.ts`、`agent-runtime/execution-contracts.ts`、`agent-runtime/execution-driver.ts`、`tasks/execution-entry-service.ts`、`tests/architecture/production-reach-allowlist.json`。
- **扩展接缝。** 本片的 `extensions`（notes、anomalies、footprint、goalSettings、decisions）在未装配时如实读作 `not_implemented`。合入后的接线由 README 的 I-1（第 1 片读本片的职责）、I-2（第 5 片的发信职责读本片的职责）、I-3（anomalies 接第 1 片的锚点）、I-4（goalSettings 接第 5 片的自治级别）、I-6（decisions 接第 5 片的决定队列，【审查改】原来没有这一项）做；本片不预先接，也不写假实现。

### 0.5 lead 抽查的代码出处

在 9b94fc55 上用 `grep` 核对了草稿引用的约 30 个 `file:symbol`，存在的例子：`agent-runtime/whiteboard-tools.ts:createWhiteboardTools`、`WHITEBOARD_TOOL_NAMES`，`agent-runtime/graph-execution-history.ts:createGraphExecutionHistoryReader`，`tasks/run-state-service.ts:createRunStateReader`、`ownCallContext`，`sessions/session-directory.ts:createSessionDirectory`，`app/core-http-types.ts:110 CoreRouteSuffix`，`configuration/role-record-codecs.ts:roleSpecRevisionSnapshotFromValue`，`configuration/role-memory-service.ts:installRoleSpec`，`contracts/validation/role.ts:validateRoleSpecContent`，`agent-runtime/query-preparation.ts:INITIAL_COORDINATION_RESPONSE_GUIDE`，`tasks/entry-plan-reader.ts:readEntryPlanVerdict`，`materials/applicability.ts:hostAdmission`，`tasks/plan-task-basis.ts:taskOriginVerdict`、`planTaskFacts`，`state/run-machine.ts:onEntryAuthorized`，`state/query-run-recovery.ts:advanceQueryExecutionRecord`。§5.12 和 §5.13 点名的 50 个已有测试文件全部存在。发现三处和当前代码不符：C1（两个文件已删）、C2（`graphHistory` 已有）、`localWorkbenchGrant` 的位置。

### 0.6 精确数量（冻结）

- 新正式记录 0、新 RecordStore schema 0、新索引 0、新事件类型 0；已有正文加 3 个可选字段（两个 manifest 的 `contextAssembly`、`RoleSpecContentV1.platformDuty`）；状态守卫补充 3 行（CTX-01…03，不是新状态机）；新路由 2 个（`graph/look`、`graph/find`）；新工具 2 个（`look_graph`、`find_graph`）。
- 文件 42 个：新建 21、修改 21。其中源码 30（新建 10、修改 20；新建里含共用文件 `src/contracts/platform-duty.ts`，§6 第 51 行），`tests/architecture/production-reach-allowlist.json` 1 个（修改），新测试文件 11。逐个文件见 §6（去掉第 4、31、32、45–50 行，加第 51 行之后的 42 行）。
- 用例 116 个：ST 15、IN 19、GR 19、CA 15、AD 8、RP 6、GT 14、AT 12、RT 6、SC 2。IN、GR、AD、RP 四个文件（52 个用例）在 memory 和 SQLite 各跑一次，共 168 次。
- 必须保持通过、断言不改的已有测试文件 50 个（§5.13 第二条命令；其中 `tests/state/invariants.test.ts`、`tests/state/invariants-fuzz.test.ts` 在 DSH 沙箱里因为没有 `/usr/bin/bwrap` 有已知的环境失败，按副本里 `DSH-BASELINE.md` 的数字比对）。
- 估计行数（不是验收数字）：生产代码新增或实质修改约 1,600–2,400 行，测试约 1,400–1,900 行。
- 任务书：[slice-3-book-part1.md](slice-3-book-part1.md)（骨架和测试，然后停）、[slice-3-book-part2.md](slice-3-book-part2.md)（实现）。

---

以下是草稿正文（Codex，基线 585f1ac0），已按 §0 改过。

权威顺序：HANDOFF 决定 42、43 与 AMB 的“已定”答案 → DESIGN 的已定条文及第 3 片 → 当前正式契约和状态机 → MODEL 的分析约定。MODEL 中的 `SelectedInput.kind='output'|'check'`、`Source`、`Assembly.id` 等不是可以直接复制进生产的类型。本文使用当前 `DependencyRequirement` 的五个取值，并给分析对象 O38–O42、R49–R52 规定生产位置。

## 1. 范围与结果

### 1.1 本片做什么

按 DESIGN §8.2 第 3 行，实现一个 AgentRuntime 上下文装配器，归拢三条读图路径：`execution-preparation.ts` 的执行准备、`attention-observer.ts:createAttentionScanner` 的图事实读取、`execution-preparation.ts:prepareContinuationBrief` 的接续图事实组装。查询准备也使用此装配器提供的图上下文；查询问题、咨询问题、浏览器规划协议继续由原调用方产生。不是把六处所有文字都迁移成新的编排协议。

固定八段、固定格式、固定来源与版本；“看、找”及子节点、邻居、执行、检查、历史、上游输入下钻；Work、普通 Query、规划 Query 和只读咨询 Query 注册只读图工具；五种职责的显式配置；注意力通知只携带变化；执行准备和“看”消费时检查声明的精确输入。【lead 改：C1】两个 source-pin 文件及其允许清单条目已在 7e0b7f56 删除，本片不再删。

用户可观察结果：旧主对话中的只读查询能沿真实图回答“进度如何”，无需凭聊天猜任务；首次执行的原记录中能看到目标、任务义务、验收要求、上游需求及可用状态；已固定输入能追到当时的版本；缺输入仍可开始；超预算明确告知省略数量和“看”的定位；大图变化不再因通知超过 16 KB 而永久投递失败。普通读图和分页不启动模型。

### 1.2 不在本片；后续增加什么

| 切片 | 本片消费的边界 | 留给它的行为 |
| --- | --- | --- |
| 0 | 已修正依赖边签名 `depends:t1->t2:artifact:schema.json` | 不重新做 `[object Object]` 修复 |
| 1 | Session 来历、异常锚点、`ContinuationBriefV1` 异常段；本文约定的只读投影 | 归档中止、异常锚点写入、重派、依赖软排序；本片不生成锚点 |
| 2 | 若已有则消费执行文件足迹；未接时明确 `not_implemented` | 工作线页面、时间竖条、活动计数、执行足迹持久化 |
| 4 | 预留注记/当前理解索引的只读接缝 | 注记状态机、指针、正文、失效计算、“记”；不能用空数组伪称注记核心已完成 |
| 5 | Goal 自治投影、待决对象摘要、消息落实投影；未接时明确能力边界 | Goal 设置、决定队列、自由答复、批注、自动返工计数/通知；本片不发消息或落实决定 |
| 6 | 五种职责配置与 Query 图读工具 | 秘书选择、主对话请求归属、方案/派工协议；不替换浏览器现有流程 |
| 7 | 配置/工具接缝与接续最后一段 | 按自治授写工具、建成员、换手、等待到期、通知改投参谋、`apply_future_plan` 去留 |
| 8 | 采用架构卡、已有观测图的只读下钻 | 语义修补、过时发现器、模块维护者、文件级新图 |
| 9、K、K2 | 现有按 Run 定位的历史读取 | 独立审阅证据准入、真实模型验收、只读命令、关闭悬空 Turn、压缩 |

四个旧读工具在**新配置的授予清单**中被 `look_graph`、`find_graph` 取代。已有保存 manifest、显式直接调用旧 adapter 的调用者继续能用旧名称；不能删 `WHITEBOARD_TOOL_NAMES` 的旧导出、改已有工具名测试，或让已绑定 Run 换工具。等后续迁移完旧授权，再删除 adapter。`propose_future_plan`、`apply_future_plan`、邮箱写工具的今日授予和拒绝不在本片改变。

### 1.3 依据与已经定的答案

| id | 本片实现的答案 |
| --- | --- |
| 决定 11；35 推出 9；DESIGN §2.8 | 不在领取时等上游；准备和实际读输入时检查；缺料提醒，仍启动 |
| 决定 20、22、34、40 | 正式图只有 WorkGraph 一个 owner；简单“看、找”；三条路径归拢；遵守任务 D 后子模块方向 |
| 决定 23；35 Q6、推出 3/4/5 | 先注记/理解索引，再历史，再咨询；找仅名字/路径/一句话语义；常驻约 4 KB 可配置；Query 也能看找 |
| 决定 37、38 | 秘书可以多个；职责建 Session 时定；不把秘书 Query 改成 Task 执行，不在运行中换职责 |
| 决定 42；AMB-37 | `historical_explanation` + 固定版本；两个 source-pin 文件已在 7e0b7f56 删除（【lead 改：C1】）；绝不声明“消费时仍当前” |
| 决定 42；AMB-38 | 角色、目标、任务义务/验收、接续不裁；仅四个可选段共享预算；省略写明数量 |
| 决定 42/43 | 异常锚点进入提醒和接续；实施交 DSH，两阶段；分段/格式/版本规则由 lead 冻结 |

阅读依据：DESIGN §2.8、2.9、3.5、4.5、4.10、5.1–5.4、7.1–7.2、8.2、9.2、附录 B/C；MODEL O38–O42、O50、R49–R52、装配段落表；AMB-37/38 先读置顶答案；REVIEW-SLICES-1-3-5 的“第 3 片”和末尾技术问题；E3-UI-ITEMS 的 5.7 接续说明、5.8 可读历史和固定措辞。E3 没有依赖已删除的精确输入读取路径，不在这里“恢复”旧材料授权。

## 2. 数据、格式、兼容与归属

### 2.1 新记录、索引、字段的总数

**新业务 aggregate 0，新 RecordStore schema 0，新 lookup index 0，新 eventType 0。** 装配是派生值；准备时依托已存的 `PreparedTaskManifestV1` / `PreparedQueryManifestV1` 固定，工具使用时依托 Kernel 原工具结果固定版本。本片不另建输入账本、装配表、图缓存、只读操作回执。

已有正文新增三个可选字段：两个 manifest 各加 `contextAssembly?: ContextAssemblyBindingV1`；`RoleSpecContentV1` 加 `platformDuty?: PlatformDutyV1`。`ResolvedRuntimeConfiguration` 和由它 Omit 派生的 Host grant 加两个可选配置项 `platformDuty?: PlatformDutyV1`、`contextResidentBytes?: number`。注意力 DTO 增加 `GraphAttentionStamp.details?:Record<string,GraphAttentionDetailV1>` 和 `graph_delta.changes?:GraphChangesV1`，仅内存派生、非持久记录。

准备时已存在的 `selectedTaskInputs: Array<{requirementId:string;ref:ArtifactRef}>` 保持原类型。新输入声明可能选的是 Round、Workspace、Message，所以完整选择存在 `contextAssembly.inputSelections`；只有 source.kind=artifact 的 selected 条目投影进旧数组。legacy 使用原 requirementId（去掉 declarationId 的 `legacy:`），边声明用完整 declarationId，按 requirementId 排序；不同声明指向同一 body 仍保留两条，不按 digest 合并。运行中“看”重新读取的选择写入它自己的工具结果，不改绑定 manifest、envelope 或 Run。这是技术取舍 T1（【审查改】lead 已定为 A，§0.2）。

### 2.2 公共纯 DTO：`src/contracts/graph-context.ts`

下列类型使用现有契约的 import：`AggregateRef`、`GoalRef`、`WorkspaceRef` 来自 `ledger.ts`；`TaskTriple`、`RunRef` 来自 `dispatch.ts`；`ArtifactRef`、`ArtifactOwnerRunRef` 来自 `artifact.ts`；`PlatformMaterialOrigin` 来自 `core/call-context.ts`；`ModuleRef`、`SessionRef` 来自 `core/identity.ts`；`PlanRevisionRef`、`DependencyRequirement` 来自 `plan.ts`；`VerificationRoundRef` 来自 `verification.ts`；`SessionMessageRef` 来自 `core/session-message.ts`；`CommitCursor` 来自 `command-event.ts`；`CoreError` 来自 `core/results.ts`。不得 import WorkGraph 或 AgentRuntime。

```ts
// 【lead 改：C4】PlatformDutyV1 在共用文件 src/contracts/platform-duty.ts（README“共用文件”），取值
// 'executor' | 'secretary' | 'adviser' | 'scribe' | 'reviewer'；这里只 import 再导出，不另定义。
import type { PlatformDutyV1 } from './platform-duty.js';
export type { PlatformDutyV1 };
export type ContextCallKindV1 = 'work' | 'continuation' | 'handoff' | 'review'
  | 'secretary' | 'copy' | 'planning' | 'attention';
export type ContextSectionNameV1 = 'role' | 'goal' | 'task' | 'footprint'
  | 'notes' | 'reminders' | 'inputs' | 'continuation';
export type GraphNodeRefV1 =
  | { kind: 'goal'; ref: GoalRef }
  | { kind: 'stage'; planRef: PlanRevisionRef; stageId: string }
  | { kind: 'task'; ref: TaskTriple; planRef: PlanRevisionRef }
  | { kind: 'module'; ref: ModuleRef }
  | { kind: 'session'; ref: SessionRef }
  | { kind: 'run'; ref: RunRef }
  | { kind: 'round'; ref: VerificationRoundRef };
export type ContextSourceV1 =
  | { kind: 'record'; ref: AggregateRef; revision: number; digest: string | null }
  | { kind: 'artifact'; ref: ArtifactRef; provenance: InputArtifactProvenanceV1 }
  | { kind: 'kernel_history'; runRef: RunRef; sessionRef: SessionRef;
      adapterId: string; kernelSessionId: string; kernelRunId: string; turnId: string;
      fromPosition: number; throughPosition: number }
  | { kind: 'note'; node: GraphNodeRefV1; noteId: string; revision: number; digest: string };
export type InputDeclarationV1 = {
  declarationId: string;
  consumer: TaskTriple;
  planRef: PlanRevisionRef;
  upstream: TaskTriple | null;
  requires: DependencyRequirement;
  legacyArtifactRef: ArtifactRef | null;
};
export type InputArtifactProvenanceV1 =
  | { kind: 'run'; owner: ArtifactOwnerRunRef }
  | PlatformMaterialOrigin;
export type SelectedInputSourceV1 =
  | { kind: 'artifact'; ref: ArtifactRef; provenance: InputArtifactProvenanceV1 }
  | { kind: 'check'; ref: VerificationRoundRef; revision: number; checkId: string;
      reportRef: ArtifactRef | null }
  | { kind: 'environment'; ref: WorkspaceRef; revision: number }
  | { kind: 'decision'; ref: SessionMessageRef; revision: number;
      application: { ref: AggregateRef; revision: number }[] };
export type InputSelectionV1 = {
  declaration: InputDeclarationV1;
  state: 'selected' | 'missing' | 'ambiguous' | 'unavailable';
  source: SelectedInputSourceV1 | null;
  candidates: SelectedInputSourceV1[];
  usage: 'historical_explanation';
  reason: string | null;
  errorCode: CoreError | null;
};
export type ContextAssemblyBindingV1 = {
  schemaVersion: 1;
  formatVersion: 's3-context-v1';
  callKind: ContextCallKindV1;
  duty: PlatformDutyV1;
  residentBudgetBytes: number;
  residentBytes: number;
  totalBytes: number;
  sections: { name: ContextSectionNameV1; startByte: number | null; endByte: number | null;
    omitted: number }[];
  sources: ContextSourceV1[];
  inputSelections: InputSelectionV1[];
  extensions: { notes: ExtensionAvailabilityV1; anomalies: ExtensionAvailabilityV1;
    footprint: ExtensionAvailabilityV1; goalSettings: ExtensionAvailabilityV1;
    decisions: ExtensionAvailabilityV1 };
};
export type ExtensionAvailabilityV1 = 'available' | 'not_implemented' | 'unavailable';
export type ContextIndexRowV1 = {
  key: string; node: GraphNodeRefV1; text: string; sources: ContextSourceV1[];
};
export type ContextExtensionsV1 = {
  notes: { availability: ExtensionAvailabilityV1; rows: ContextIndexRowV1[] };
  anomalies: { availability: ExtensionAvailabilityV1; rows: ContextIndexRowV1[] };
  footprint: { availability: ExtensionAvailabilityV1; rows: ContextIndexRowV1[] };
  goalSettings: { availability: ExtensionAvailabilityV1;
    autonomy: 'every_step' | 'after_plan_confirmation' | null }; // 【审查改】取值与第 5 片 GoalAutonomyV1 相同（I-4 原样转交）
  decisions: { availability: ExtensionAvailabilityV1; rows: ContextIndexRowV1[] };
};
```

每个 `record.revision` 是存储记录版，不是业务 `planRevision` 或 Role 的 `contentRevision`。ArtifactRef 固定 `contentType/digest/sizeBytes/source`；hash 全原文 UTF-8，不 hash 截断摘要。一个来源要读出正文，先检验既有 codec、作用域和摘要，再进入选择。`provenance` 从正文存储的 trusted origin 读取，不允许模型声明；legacy 有 canonical owner 的材料正规化为 `kind:'run'`，owner-less legacy 仍拒绝。正式检查报告使用 `platform_operation` origin（`evidence/evidence-service.ts` 的报告 storeArtifact 调用），不可编造一个 Run owner。`ContextAssemblyBindingV1` 不包含 clock、random id、observedAt；同样事实和配置须得同样字节。取证时刻由现有 manifest/body 元数据和 Kernel 事件时刻表达，避免重复 prepare 每次改字节。

`GraphNodeRefV1` 是读定位符，不是新增 AggregateRef。Stage 没有独立存储 revision，使用所属 PlanRevision；Module 使用其采用的 catalog/baseline 来源。TaskRef 本身不含 planId，所以显式 planRef 必须验证 task 属于该 Plan 的 Goal。

### 2.3 归属与 codec 样板

| 内容 | owner / 样板 |
| --- | --- |
| DTO、shape helpers | Contracts；现有 `contracts/continuation-brief.ts:continuationBriefShapeProblem`、`fingerprint.ts:canonicalJson/sha256Hex` |
| 精确声明、选择、授权检查、历史材料桥接 | WorkGraph `tasks`；`tasks/entry-plan-reader.ts:readEntryPlanVerdict`、`tasks/plan-readers.ts:readCanonicalTaskFacts`、`materials/applicability.ts:hostAdmission` |
| Context/卡片/找的读模型 | WorkGraph 新 `views`；从现有 owner 读，不写记录；复用 `tasks/run-state-service.ts:createRunStateReader` 的定向分页与水位 |
| Role 正文可选 duty | WorkGraph `configuration`；`configuration/role-record-codecs.ts:roleSpecRevisionSnapshotFromValue`、`configuration/role-memory-service.ts:installRoleSpec`；保留原 install/activate 命令和回执 |
| prepared manifest 的正文校验 | WorkGraph `tasks` / `queries`；`tasks/execution-entry-service.ts:readStoredManifest/manifestAgainstPrepared`、`queries/query-execution.ts:loadQueryManifest` |
| 分段、字节裁剪、brief Kernel/Workspace 取证 | AgentRuntime；`execution-preparation.ts:rehydratePreparedExecution`、`continuation-brief-assembly.ts:readPreviousTurn/assembleContinuationBrief` |
| 工具 schema、输出与取消 | AgentRuntime；`whiteboard-tools.ts:createWhiteboardTools` 的 `{names,create}` 和 `graph-execution-history.ts:createGraphExecutionHistoryReader` |

【lead 改：C5】`views` 已由 B0 在 `module-target.json` 声明，依赖是 `model, state, persistence, configuration, materials, architecture, sessions, queries, tasks, evidence, communication` 十一个（后两个给第 5 片用）；本片不改 `module-target.json`。materials 仅用于复用正式 Run codec，不能在 views 开材料正文。本片不 import `evidence`、`communication`、`notes`：Round 通过 tasks 的既有读取，Message 通过 sessions codec/已有定向读取；注记等以注入的只读函数接缝进入。WorkGraph 总模块仍只依赖 RecordStore/WorkspaceTools；state 仍只 import Contracts。`tasks` 不能 import views、evidence、communication 或 Runtime；views 不能成为写 owner。

### 2.4 老数据与编码规则

1. `contextAssembly` 缺省：视为 `legacy_unversioned` 输入；正常使用原 `input/inputDigest/bundleRef`，不重装、不补字段、不换摘要。新字段若存在却 malformed，拒 `invalid`；已存正文/外壳摘要不一致沿原错误口径，不静默降成 legacy。
2. `RoleSpecContentV1.platformDuty` 缺省：**派生** effective duty 默认 `executor`，不向旧 `content` 填字段再 hash。旧 `roleSpecContentDigest` 必须逐字节相同。codec 保留未知字段规则；只增加对该可选枚举的校验。新声明五个 Role profile 的正文显式带 duty，按新 contentRevision install；不修改已安装 revision 或已建 Session 的 role pin。
3. Host grant 缺省 `contextResidentBytes=4096`；有效值为非负 safe integer，NaN、负数、小数和超出 safe integer 拒配置。0 表示四个可选段正文全省略，省略提示移到必需任务卡末尾，详见 §4.3。不擅加 16 KB 常驻配置上限；16 KB 是注意力通知的独立上限。配置未变时不更新 Host configurationRevision。新 grant 若显式给 `platformDuty`，resolved Role 中显式 duty 不一致拒 `forbidden`；legacy 由 Host versioned template 显式 duty 或缺省 executor 决定，绝不从 skill 数组、label 或 instruction 猜职责。
4. `PlanRevisionDraft@1/@2` 与 `TaskInputRequirementV2` 不改存储形状。旧 `inputRequirements` 转成声明：`declarationId='legacy:'+requirementId`、consumer 原值、requires `{kind:'artifact',label:requirementId}`、legacyArtifactRef 原值；upstream 通过 Artifact 的 canonical owner Run 的 `task` 核实后填；QueryRun/platform_operation 来源没有 Task upstream，保留 null。不能要求老计划先预测一个新产物版本。
5. 边声明 id 为 `'edge:'+sha256Hex(canonicalJson({planRef,consumerTaskId,dependsOnId,requires}))`；consumer 是 `edge.taskId`，upstream 是 `edge.dependsOnId`。保持五个原 kind，不映射成 MODEL 的缩写。旧精确声明与边声明分别列出，不能因 label 相同猜成一条。
6. `SourceRefV1` 的闭集不扩。已有 sourceRefs 中沿用 plan/workspace/artifact/governance/memory；完整的 Run/Round/Message 版本在新 binding.sources 中。不把 Run 强塞进 `kind:'artifact'`。
7. 【lead 改：C1】`material-source-provider.ts`、`source-applicability.ts`、它们在 allowlist 里的条目，以及 `material-access.ts` 里的 `SourceApplicabilityPort`、`MaterialSourceCaptureResult`，都已在 7e0b7f56 删除；本片不改 `material-access.ts`。下面是草稿原文，只作说明：保留 `MaterialBasisV1`、`MaterialAccessGrantRef`、`MaterialSourceSetV1`、`MaterialSourceScope`、`MaterialSourcePinV1`、`validMaterialSourceSet`、`validMaterialSourcePin`：`MaterialBasisV1.sourcePin?`、`query-job.ts` 的 feedback 校验、`execution-entry-service.ts:materialBasisProblem` 仍读取存量 pin。保留的是存量形状/摘要校验，不是捕获或证明 current 的能力。`sameArtifactRef`、`sameArtifactOwnerRunRef` 继续保留。

### 2.5 五种职责配置

新增 `role-profiles.ts:platformRoleProfile(duty:PlatformDutyV1):PlatformRoleProfileV1`，其中 `PlatformRoleProfileV1={duty:PlatformDutyV1;label:string;purpose:string;responsibility:RoleResponsibilityV1[];behaviorSkillId:string;template:Extract<RoleConfigurationRef,{kind:'legacy_template'}>}`。RoleConfigurationRef 来自 Contracts core/identity.ts。它是纯配置表，实际由 assembler 的角色卡和 Host 配置验证调用；返回 clone，不开放可变全局数组。已解析的 RoleSpec 正文优先，表里的 purpose/responsibility 仅用于 legacy 显式 duty 的角色说明，不覆盖已安装正文。RoleSpec 的权限、材料、预算、退出仍由现有明确配置给出。

| duty | label | responsibility | 追加职责行为资源 |
| --- | --- | --- | --- |
| executor | `Executor` | `['execution']` | 共同 `platform-work` |
| secretary | `Secretary` | `['human_decision_support','planning']` | `platform-secretary` |
| adviser | `Adviser` | `['investigation','integration']` | `platform-adviser` |
| scribe | `Scribe` | `['fact_consolidation']` | `platform-scribe` |
| reviewer | `Reviewer` | `['verification']` | `platform-reviewer` |

purpose 分别固定为 `Execute the assigned task.`、`Handle the user's bounded request.`、`Investigate technical choices and coordinate work.`、`Check and consolidate project facts.`、`Review the assigned work independently.`。沿用现有 `resources/skills` 正文，不改 AG6/W2 的多 skill 装配语义；一名 Agent 可以装多段辅助行为，duty 仍只有一个。表不安装规格、不创建 Session、不启动默认成员。显式 RoleSpec 使用既有 `RoleConfigurationPort.installRoleSpec/readRoleSpec/activateRoleSpec`，不新增启动时自动安装或 HTTP 写接口；新正文带 duty 按原版本化治理路径安装。`contracts/validation/role.ts:validateRoleSpecContent` 校验可选枚举，既有 codec 原样保存/解码 content。Host 接受完整 RoleSpec pin，发给 Runtime 的 duty 来源就是该 pin 的正文；第 5 片通过已存在的 RoleBindingFactsPort 读同一字段。allowlist 只去掉本片真实接通的 symbol 和两个删除文件的条目，不能用一个 helper 清空仍未接通的 role 操作条目。

legacy 的显式 duty 必须同样被 Session 的不可变 role ref 固定：五个 templateId 依次为 `platform-executor/platform-secretary/platform-adviser/platform-scribe/platform-reviewer`，templateRevision 全为 `s3.1`，存进已有 SessionRecord.role，不加新字段。Host grant 若在 legacy role 上显式给 duty，只接受配置表中该 duty 的完整 template ref；不匹配是配置 invalid，模型调用前拒。旧自定义 legacy ref 和 local-workbench@1 未给 duty 时仍 executor；不能给同一个旧 ref 改 duty。改职责须新 RoleSpec pin 或新 templateRevision、创建新 Session，不能在旧 Session 的下一 Run 偷换。behaviorSkillId 是配置建议/说明，仍只装显式 enabledIds，不自动加技能、工具或成员。

## 3. 状态行、守卫与 owner 服务

### 3.1 不新增可写生命周期

本片不增加 Task、Run、QueryRun、Session 状态枚举，不写 `phase/status/outcome` 来表示缺输入、装配省略或读图。“selected/missing/ambiguous/unavailable”是一次读取的结果，绝不是 Task blocked/ready 的新条件。

需要改的是三条已有持久转换的准入守卫，稳定补充 id `CTX-01..03`；不是三套新状态机。所有现有 next 构造仍在 `state/run-machine.ts`、`state/query-run-recovery.ts`。新增纯 `state/context-input.ts` 仅校验 prepared 上下文和声明消费，不做 IO、取时、生成 id、创建新业务记录。

### 3.2 STATE-MACHINES-SPEC 表格

| # | from | event | guard | to | effects | 幂等/重复事件 | 原文编号 | 现状 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CTX-01（RUN-02 补充） | Run `Starting.Unbound` | P `entry_authorized` | 原 fence→Session/Lease→claim→envelope→Goal→entryPlan→brief 守卫顺序不动；freshAdmission 内增加 G-CTX 与 G-INPUT | 原 `Starting.Authorized` | 原一次提交绑定 envelope/inputBinding/authorization；context 仅在已 hash 的 manifest | 原回执同身份同内容重放；异内容 `idempotency_conflict` | DESIGN §2.8、5.1；AMB-37/38 | 改造 `tasks/execution-entry-service.ts:authorizeRuntimeEntry`、`state/run-machine.ts:onEntryAuthorized` |
| CTX-02（RUN-03 补充） | Run `Starting.Revoked` | P `entry_authorized` | 原 fixed binding 必须一致；验证已绑定 manifest，不重新选择输入/重装 context；原 Host/Role 准入仍检查 | 原 `Starting.Authorized` | 原 authorization 新 generation；inputBinding/envelope 原样 | 原回执重放；企图换 context/inputDigest 拒 `invalid` | §5.1 已绑定不重装；I-19 | 改造同上 |
| CTX-03（Query 原 prepared 步补充） | QueryRun `executionState.phase='claimed'` | P `prepared` | 原 shape/scope→receipt→当前 Query/Session/Goal/Host；增加 G-CTX；Query tools 只能新增 look/find 两个只读名称 | 原 `prepared` | `advanceQueryExecutionRecord` 原 revision+1，同提交写 QueryExecutionRecorded；保存原 prepared ArtifactRef | 原 bindPreparedQuery 回执重放；不是重复创建 Query | §5.2/5.3；推出 5 | 改造 `queries/query-execution.ts:bindPrepared`、`state/query-run-recovery.ts:advanceQueryExecutionRecord` |

G-CTX：有 binding 时严格检查 schema/version/callKind、段名合法且不重复、非 null 区间按 UTF-8 有序且不重叠/不越界、null 区间只允许 §4.3 的整段省略、totalBytes 等于全文 UTF-8、四预算段计数与省略标记一致、sources 排序/去重/版本合法、接续是最后一段、旧 selectedTaskInputs 与 binding 内 Artifact 选择完全相同。malformed / inputDigest不一致 / 后面再追加文字均 `invalid`；超过既有 256 KiB manifest 存储上限仍 `capacity`。**4 KB 不是全文容量拒绝线**。新 binding 的来源/调用范围与 canonical Run/Query事实不符是 `forbidden`，声明版本依据改变是 `revision_conflict`。

G-INPUT：每个选择都源自 manifest.claim 对应的 Plan 的声明；`selected` 恰好一个 source，missing 无 source/candidates，ambiguous 有两个以上 candidates，unavailable 无 source 且有 errorCode/reason；所有 usage 必须 `historical_explanation`。legacy Artifact 必须和所存旧声明完全同一 ref；边输入按下文 resolver 核对来源。缺输入的合法结果通过 RUN-02，effects 不包含 Task 阻塞；跨 scope、冒充历史/当前、任意 artifact 替换分别 `forbidden`、`invalid`、`forbidden`。

Query 没有用户可传的 materialReader 或 duty。它也不能因 Role profile 是 secretary 在本片拿到 send/ack/respond/note/shell。后续片的权限变更要使用其规格，不能绕过本片 Query ceiling。

### 3.3 新纯函数与 refusals

```ts
// src/core/work-graph/state/context-input.ts
export function contextAssemblyProblem(input: {
  binding: ContextAssemblyBindingV1 | undefined;
  text: string;
  selectedTaskInputs: { requirementId: string; ref: ArtifactRef }[];
  continuationSuffix: string | null;
}): CoreRejection | null;
export function declaredInputProblem(input: {
  declaration: InputDeclarationV1;
  selections: InputSelectionV1[];
  allowedDeclarations: InputDeclarationV1[];
  scope: { projectId: string; workspaceId: string; goalId: string };
}): CoreRejection | null;
export function effectivePlatformDuty(input: {
  roleDuty: PlatformDutyV1 | undefined;
  hostDuty: PlatformDutyV1 | undefined;
}): ReadResult<PlatformDutyV1>;
```

shape first：非法枚举/空 id/越界分页/重复声明/不规范 path/cursor `invalid`；scope 不符/未声明 artifact `forbidden`；记录缺失 `not_found`（正式绑定断链按旧 owner 的 `incomplete`）；codec/body 损坏 `unavailable`；水位未达保持 `not_ready`；信号中止 `cancelled`。不扩 CoreError，不把 Store 的 `corrupt` 传到 Core。pure 不返回假回执；读函数不调用 transitionTask。

### 3.4 精确输入 owner：`tasks/context-input-service.ts`

```ts
export interface TaskContextInputPort {
  readTaskInputs(ctx: CoreCallContext, request: {
    consumer: TaskTriple; planRef: PlanRevisionRef;
    declarationId?: string;
    candidateKey?: string;
  }): Promise<ReadResult<InputSelectionV1[]>>;
  readTaskInputPage(ctx: CoreCallContext, request: TaskInputPageRequestV1)
    : Promise<ReadResult<TaskInputPageV1>>;
}
export type TaskInputPageRequestV1 = {
  consumer: TaskTriple; planRef: PlanRevisionRef; declarationId: string;
  candidateKey?: string; afterCursor: string | null; maxBytes: number;
};
export type TaskInputPageV1 = {
  selection: InputSelectionV1; body: string | null; nextCursor: string | null;
  selectedTaskInputs: { requirementId: string; ref: ArtifactRef }[];
};
export type TaskContextInputDependencies = {
  records: GoalRecordTransactionPort & RecordLookupPort;
  materials: MaterialPort;
  bodies: Pick<RawArtifactStorePort, 'read'>;
  hostActor: Extract<ActorRef, { kind: 'human' | 'system' }>;
  decisionApplications?: (ctx: CoreCallContext, messageRef: SessionMessageRef)
    => Promise<ReadResult<{ ref: AggregateRef; revision: number }[] | null>>;
};
export function createTaskContextInputService(deps: TaskContextInputDependencies): TaskContextInputPort;
```

`TaskInputPageRequestV1/TaskInputPageV1` 是 Contracts 纯 DTO。正文分页也属于这个 owner，不能让 graph tool 或 assembler 绕过它调用 raw bodies。首次 page 核声明、固定 source；后续 cursor 带完整 source key/hash 与字节 offset，先重核同一声明允许该 source，再读其原历史版本。prepare 从 readTaskInputs 的 selected 候选 key 读取首个 bounded page；返回版本和刚读取的选择不同则 `revision_conflict`，不混合两版。缺失项 body=null、nextCursor=null；非 Artifact 选择返回版本摘要文本，不伪造 Artifact 正文。

检查顺序必须写成代码和测试：同步 clone ctx/request（原 AbortSignal 保留）→ shape/scope → 绑定 principal：work_run 的 canonical Run/task/claim/plan；query_run 的 canonical QueryJob/Run/Goal/workspace；Host 的固定 scope → 精确 Plan 与 Task，必要时 `readEntryPlanVerdict` 验证 carried_unchanged，但选择仍以 claim 的执行定义为准 → 读取声明 → 定向读取 upstream facts/rounds/message/workspace → pure 声明核对 → **仅此处**构造同 scope 的内部 Host historical material reader → `MaterialPort.openArtifact(...usage:'historical_explanation')` → 复核 canonical owner、digest、sizeBytes → 返回完整选择。

内部 Host reader 的 actor 由 composition 注入，原 signal、projectId、workspaceId 必须一致；不把“可以以 Host 读任意 artifact”的函数传给模型/HTTP。桥接之前查到声明是必要条件。材料层仍不读计划；`materials/applicability.ts` 的 Run own-material 规则、Host current→source_stale 原样保留。

准备和实际“看”都调用同一个函数。“看”的 candidateKey 只可选当前已返回的候选；key=`sha256Hex(canonicalJson(source))`，不得接模型给的完整 artifact/owner；未在这份声明的候选中 `forbidden`。prepare 不替 Agent 任意挑一个候选。合法缺失/歧义不拒准备；真正无法核对的读取错误显式记录 unavailable 项或整体拒绝：**权限/计划身份错误整体拒；单个已声明来源找不到或正文不可读返回该项 unavailable；候选读取集合本身不完整返回整体 `incomplete/unavailable`，不能当作唯一候选。**

这是只读 owner，无 GraphWrite、无新 receipt。准备结果在原 `authorizeRuntimeEntry` / `bindPreparedQuery` 的 commit 中固定；工具结果通过原 Kernel `tool.result` 保存版本。跨 Run 开材料的测试必须证明直接 `MaterialPort.openArtifact` 仍拒、只有这个核声明桥接通过。不要为了给读操作造回执把两次 look 都合成同一个请求。

### 3.5 输入解析表：只能根据已经存的事实

| requires.kind | 唯一选择的依据 | 无唯一依据的结果 |
| --- | --- | --- |
| legacy `artifact` | 原 exact ArtifactRef；canonical Run/QueryRun 或 platform_operation origin 必须同项目同工作区；若来源是 Run，固定它的 Task upstream；内容地址不变 | 缺正文 unavailable；不改选最新 body；owner-less legacy forbidden |
| `artifact` / `output-contract` | 本基线没有按标签发布产物的正式记录，保守方案不新增索引或适配。返回 upstream Run/history 和已知正式材料的 card 引用，不从文件名、envelope输入、工具任意文字猜产物 | missing，reason `no_labeled_output`；以后接入正式候选来源才可能返回 ambiguous，届时仍用本片纯守卫和候选 key；Agent可读原历史/当前文件或提供明确材料 |
| `gate-result` | upstream canonical Round 链：选择最近 finalized/PASS 的适用链头，label 精确匹配 `checks[].checkId`；同时验证 plan/taskBasis/workspace/policies 与该读取的 formal basis；不运行新检查 | 无匹配 missing；索引不完整整体 incomplete；旧 PASS 被后继 FAIL 覆盖不能回退冒充有效；reportRef 可为 null，但 Round/check 版本仍可选择 |
| `environment-revision` | 该 Goal 的 WorkspaceSnapshot revision；label 必须是 `workspaceId` 或 `workspace`，仅明确环境版本声明 | 别的环境来源 missing `unknown_environment_label`；revision不是源码内容摘要 |
| `decision` | upstream 相关正式 Message ref/messageId 与 label 精确匹配；有答复且有“已落实”投影，固定 Message revision 与应用对象版本 | 只有答复/无落实 missing `decision_not_applied`；第5片未接 application 时 unavailable `unsupported`，不伪称已落实 |

当前 `RunSnapshot.terminalPayload` 的 completed 仅有 exitCode；RawArtifactStorePort 只有 put/read，不能列输出。Round 的 checkId→reportRef 是检查报告关联，不冒充自由产物名关联。具体产物声明缺唯一绑定的分支是 DESIGN 已规定的“不猜，列上游事实给 agent”，不是新增 user-visible 产品决定；T6 若改为内部候选来源适配，必须先给出正式来源/确切 port 和服务 fixture，再调整本文，不让 DSH 自造 registry。缺输入不改变 claim eligibility。

### 3.6 原有写 owner 的顺序/回执/guard 样板

`execution-entry-service.ts:createExecutionEntryService().authorizeRuntimeEntry(ctx,GraphWrite<{prepared:PreparedTaskExecution;consumerId:string}>):Promise<WriteResult<TaskEntryPermit>>` 保留现有 `bindTrustedContext/isolateWrite/checkRunPin`。合法 shape、scope、pin 形状先于 lookup；`lookupCommit({identityKey,fingerprint})` 命中，从 immutable 原 event 重建结果，不再选输入。新验证放已有 manifest 读取与 freshAdmission 内，不能提前重排 fence/Goal/Session 等拒绝。依托 `executionReadGuards`、`mergeGuards` 把消费 Plan、Goal、Workspace、选择所依赖的可变来源 revision 加入同次提交，避免装配后依据变了仍绑定。不可变 Artifact 内容地址不用“当前来源 pin”。

`queries/query-execution.ts:createQueryExecution().bindPreparedQuery(ctx,GraphWrite<{prepared:PreparedQueryExecution}>):Promise<WriteResult<QueryExecutionRecord>>` 保留已有 Query/Session expected pins、QueryExecutionRecorded 重放和 `advanceQueryExecutionRecord`。G-CTX 不写 QueryJob状态。`beginQueryEntry` recheck Host tools/Role ceiling，不允许旧 manifest 被新 Host 放宽；原工具定义与动态文字分开固定。

准备两次在未绑定时允许因真实输入变化得到不同 manifest；事实没变必须同字节、同 body ref。已经绑定时 `rehydratePreparedExecution` 最先返回固定值；Query prepared 原状态也返回其原 ArtifactRef。consumer 重新查询上游时历史选择可以变，**它自己的这次工具结果**记录新版，原首轮输入仍固定。

## 4. 读模型、装配、工具、路由与 Workflow

### 4.1 WorkGraph 读接口与 exact DTO

```ts
// model/graph-context-contracts.ts：port 依赖允许的 owner types；纯 DTO 在 Contracts
export type ContextReadRequestV1 = {
  goalRef: GoalRef;
  planRef?: PlanRevisionRef;
  focusTaskIds: string[];
  includeInputs?: boolean;
};
export type GraphContextFactsV1 = {
  goal: GoalSnapshot;
  graph: TaskGraph | null;
  architecture: AdoptedArchitecture | null;
  executions: TaskExecutionRecord[];
  inputs: InputSelectionV1[];
  extensions: ContextExtensionsV1;
  sources: ContextSourceV1[];
  readThrough: CommitCursor | null;
};
export type NodeCardV1 = {
  node: GraphNodeRefV1; name: string; paths: string[]; summary: string;
  task: GraphTaskCardV1 | null;
  goal: GoalSnapshot | null; stage: PlanStage | null; module: ModuleDefinition | null;
  session: SessionRecord | null; run: RunSnapshot | null; round: RoundSnapshot | null;
  state: string | null; children: GraphNodeRefV1[]; neighbours: GraphNodeRefV1[];
  executions: RunRef[]; rounds: VerificationRoundRef[];
  inputDeclarations: InputDeclarationV1[];
  indexes: ContextExtensionsV1;
  sources: ContextSourceV1[];
};
export type GraphTaskCardV1 = {
  ref: TaskTriple; planRef: PlanRevisionRef; definitionPlanRef: PlanRevisionRef;
  definition: RuntimeTask; assignment: PlanTaskAssignment | null;
  obligations: Omit<AcceptanceObligation, 'taskIds'>[];
  effectivePhase: Phase; failure: TaskFailureFactsV1 | null;
  stage: PlanStage | null; module: ModuleDefinition | null;
  upstream: InputDeclarationV1[];
  downstream: { consumer: TaskTriple; requires: DependencyRequirement }[];
};
export type GraphLookRequestV1 = {
  goalRef: GoalRef;
  target: { kind: 'node'; node: GraphNodeRefV1 } | { kind: 'path'; path: string };
  relation: 'card' | 'children' | 'neighbours' | 'executions' | 'checks';
  page: { afterCursor: string | null; limit: number };
};
export type GraphFindRequestV1 = {
  goalRef: GoalRef;
  needle: string;
  page: { afterCursor: string | null; limit: number };
};
export type GraphReadPageV1<T> = {
  items: T[]; nextCursor: string | null; readThrough: CommitCursor | null;
};
export interface GraphContextReadPort {
  readContextFacts(ctx: CoreCallContext, request: ContextReadRequestV1): Promise<ReadResult<GraphContextFactsV1>>;
  lookGraph(ctx: CoreCallContext, request: GraphLookRequestV1): Promise<ReadResult<GraphReadPageV1<NodeCardV1>>>;
  findGraph(ctx: CoreCallContext, request: GraphFindRequestV1): Promise<ReadResult<GraphReadPageV1<NodeCardV1>>>;
  readAttentionFacts(ctx: CoreCallContext, request: AttentionGraphReadRequestV1): Promise<ReadResult<GraphAttentionFactsV1>>;
}
```

`AdoptedArchitecture` 从 `src/contracts/architecture-catalog.ts` import；catalog 缺省 null 是未提供，不能变成空数组。baseline 的 AggregateRef、存储 revision、contentDigest 在 sources；catalog 的同版 baseline pin 由 architecture owner 验证。`GoalSnapshot` 来自 Contracts；`TaskGraph`、`TaskExecutionRecord` 都在 model，可直接用。model 契约不反向 import architecture owner。card/request/page 等无 owner type 的纯 DTO 同样置于 Contracts 的 graph-context.ts，只有 facts 与 port 放 model。

GraphTaskCard 的 `RuntimeTask/PlanTaskAssignment/AcceptanceObligation/Phase/PlanStage` 来自 Contracts plan.ts，`ModuleDefinition` 来自 architecture-catalog.ts，`TaskFailureFactsV1` 来自 task-failure.ts。NodeCard 的 `SessionRecord/RunSnapshot/RoundSnapshot` 分别来自 Contracts core/session.ts、dispatch.ts、verification.ts；只有与 node.kind 同名的卡片 payload 非 null，其余 payload 为 null。round 卡保留正式 checks/outcome/report refs；run 卡保留真实 terminal/history locator/envelope 引用，不打开 bundle 正文。不是拿 title/summary 代替义务和验收。当前计划的 phase/disposition 与 execution definition 的来源分开：`planRef` 是读者选的版本，`definitionPlanRef` 经现有 `tasks/plan-task-basis.ts:taskOriginVerdict/planTaskFacts` 解析绝对 basis；从其正式 frozen definition 取 assignment/义务/精确输入。没有 failure 投影时 null 并标明未提供，不猜失败；没有模块 scope 时 module=null。

`views/graph-context-reader.ts:createGraphContextReader(deps)` 的 deps 为 `{records:GoalRecordTransactionPort & RecordLookupPort;goals:Pick<PlanTaskPort,'queryGoal'>;plans:Pick<PlanTaskPort,'queryTaskGraph'>;architecture:Pick<ArchitectureCatalogPort,'readArchitectureRevision'>;sessions:Pick<SessionDirectoryPort,'findSessions'|'readSession'>;executions:ExecutionReadPort;inputs:TaskContextInputPort;hostActor:Extract<ActorRef,{kind:'human'|'system'}>;extensions?: (ctx:CoreCallContext,request:ContextReadRequestV1)=>Promise<ReadResult<ContextExtensionsV1>>}`。hostActor 由 composition 注入现有 SYSTEM_ACTOR，仅用于下述 Work 只读执行桥接。extensions 未装配时五项 not_implemented；已装配抛错不能变成 available/空结果。model port 不 import Session service implementation，views 只依赖公开port及下面的codec。

Query 读取 Session 的接线必须单列：当前 `sessions/session-directory.ts:createSessionDirectory` 内部 `readContext` 仅接受 Host/work_run，不能把 query_run 原样传入后把 forbidden 当作“没有成员”。views 增加私有 `resolveGraphSessionReadContext(ctx:CoreCallContext,goalRef:GoalRef):Promise<ReadResult<CoreCallContext>>`，只给 `sessions.findSessions/readSession` 使用。同步复制 scope/principal/request，保留同一 signal；Host/work_run 沿原 context 不变。query_run 顺序为：完整 QueryRunRef 与 ctx scope 一致 → 按精确 key 读 QueryJob/QueryRun，复用 `queries/query-record-codecs.ts:decodeQueryJobSnapshot/decodeQueryRunSnapshotRecord` → canonical ref、Job.runRef、Job.goalId 与请求 Goal、Run 持久化 Session binding 一致；canonical Goal/Workspace/绑定 Session 的 project/workspace 一致 → 根据 Job.submission 的 identityKey/fingerprint 查原 commit，再 eventAt 定位原 QueryJobSubmitted（复用 `queries/query-execution.ts:readCore/readInitiator` 的读取/拒绝样式及相同 codecs）→ 核 locator/eventId/ref 与原 event，原 actor 恰等于 ctx.principal.initiator → 才构造同 scope 的内部 Host context，principal.actor 和 materialReader.actor 都是这个**原 initiator**。不得用固定 system actor替代，也不重新扫描事件猜发起人。其余 Goal/Plan/architecture 读取保持原 Query context；catalog 的 readArchitectureRevision 已支持 project 绑定读取，无需此桥接。工具输入、HTTP、Runtime 不获得该 Host context 或任意 Host reader；Session cursor 绑定原 QueryRun key，不能直接转送内部 Host cursor。

拒绝值固定：shape=invalid，scope/身份/绑定不符=forbidden，QueryJob不存在=not_found，Run/持久化binding缺失=incomplete，旧 Job 没有 submission=unsupported，codec/event损坏或Store读取失败=unavailable，取消=cancelled。任何拒绝之前不调 Session port、不读 Kernel/材料正文、不提交记录；Query 已有历史读取、原 SessionDirectory caller 和原写准入不改。此桥接是新 read model 的内部分工，不给 Query 写权限，不改 SessionDirectory 的既有授权协议。views 用原 findSessions 定向页收集本次 Session 候选并按下面的稳定次序分页，内层 Session cursor 只在本次调用内使用，不返回或持久保存；外层 cursor 绑定原 QueryRun identity。

`tasks/run-state-service.ts:ownCallContext` 同样只接受 Host，views 不得把 Work/Query 原 context 直接传给 `executions.readExecution/listExecutions`。增加私有 `resolveGraphExecutionReadContext(ctx:CoreCallContext,goalRef:GoalRef):Promise<ReadResult<CoreCallContext>>`：Host 沿原 context；Query 复用上述完整核验后获得的内部 context；Work 按精确 RunRef 读 canonical Run（复用 `materials/run-snapshot-decoder.ts:decodeRun`），核 Run.ref/Run.task.goalId/Run.workspaceSnapshot.workspaceId 和 canonical Goal.workspaceRef 与原 ctx、目标 Goal 一致，才构造同 scope、actor=deps.hostActor、相同 materialReader.actor 的内部 Host context。请求的执行 ref 必须属于已核 Goal；只查已有候选索引和原 final-window reader，不绕过其 incomplete/unavailable/busy/水位规则。未开始的候选为空仍 ready；绑定 Run 不存在 not_found、损坏 unavailable、跨scope forbidden。Session 的 Work 读取继续传原 work_run。这里不核运行许可/新 lease、不给写权限，不阻断 archived/busy Session 的历史事实读取。

`createGraphContextReader(deps):GraphContextReadPort` 的唯一实例也实现 readAttentionFacts；nullable Goal 时只读 adopted architecture，非 null 时读同一任务/架构事实及版本。`AttentionGraphReadRequestV1`、`GraphAttentionFactsV1` 和 detail/change DTO 是 Contracts 纯类型（§4.5 给出字段），禁止 Runtime/WorkGraph import app 的 GraphAttentionStamp。app 的 stamp 作为旧结构兼容 wrapper。readContextFacts.executions 只含 focus 任务的 canonical selected Run；接续祖先走原 readContinuationBasis，完整 Run 列表走 executions relation 分页。Round 解码复用 `persistence/evidence-record-codecs.ts:decodeVerificationRoundSnapshot`，Message 解码复用 `sessions/message-record-codecs.ts:decodeSessionMessageRecord`，不绕到上层 evidence/communication。

includeInputs 缺省false；只有 Work/continuation prepare 显式true才调用 inputs.readTaskInputs 并装载输入。普通 card/find/attention 只读声明和摘要，不打开材料；实际正文消费走 look input。Query 当前 copy/planning 两种装配不含inputs段，binding.inputSelections=[]，不能自动读完所有focus任务的材料；Query之后用look input得到的版本只记在那次工具结果。Query调用 G-CTX 时旧selectedTaskInputs参数传[]，与空inputSelections一致；不向Query manifest加一个不存在的旧数组。

查询只读真实记录，不按 UI 缓存或列表候选证明权限。卡片以精确 goal/plan/ModuleRef 定位，paths 用采用架构的 `ModuleDefinition.paths`，summary 是其 responsibility（不从源码猜一句话）。路径不能有盘符、反斜线、空段、`..`、NUL；项目根 `'.'` 只作为显式根定位允许。多个模块同一路径返回多个 card，不猜赢家。

分页 limit `1..100`；cursor 是 base64url JSON `{v:1,scopeKey:string,queryKey:string,basisKey:string,offset:number}`。三个 key 分别 hash 完整 project/workspace/goal/原 principal identity（Host actor、RunRef 或 QueryRunRef；不是内部桥接的Host actor）、正规化请求（不含 cursor）、实际 Plan+Architecture+所用来源版本，包括本次 Session 候选的 ref/revision。跨 scope/principal/query cursor `invalid`；basis 已换 `revision_conflict`，current 带新 Plan/Workspace pins；查不到起始节点 `not_found`。原历史单独使用 RT8 原 cursor，不能把这类 cursor 转送给 history。

找只 `String.includes`，大小写敏感，needle 不 trim/case-fold，长度 `1..256` Unicode code points。名字、paths、summary 三字段命中任一即一条；不查注记正文、不检索 Kernel 正文、不相关性排序。稳定顺序是 node kind 的固定顺序 `goal,stage,task,module,session,run,round`，kind 内 canonical node key 字符码序 `<` 比较；这是分页次序，不是检索排名。不用机器 locale 决定字节。默认域包含全部七类：Goal/Stage/Task取选定Goal，Module取采用catalog，Run/Round取该Goal的任务，Session用现有 findSessions 的同workspace定向分页（includeArchived=true）；不扫描整个RecordStore，不读Kernel/材料正文。Session.name=sessionId、summary=完整role ref的规范JSON；Run.name=runId、summary=`status/outcome`；Round.name=roundId、summary=`status/outcome`，未有outcome用`(none)`。不拿chat正文作一句话语义。旧 findSessions/RT8 的工作区读取边界不额外收紧；卡片里的链接源自正式worklinks或claim。

关系定义：Goal.children=Stage及无stage的Task，Stage.children=所属Task及该stage范围的Module，Task.children=taskHierarchy的直接子任务，Module.children=正式containment直接子模块；没有containment时不从paths猜父子。Task.neighbours=依赖上下游+正式relations+scope Module+正式worklinks关联Session；Module.neighbours=架构依赖端点+显式scope Task+worklinks Session；Session.neighbours=worklinks节点+当前lastExecutionRef，Run.neighbours=所属Task/claim Session/正式Round，Round.neighbours=subject Task/Run。使用真实ref去重；children与neighbours的分页规则相同，不能把软关系改成硬gate。

### 4.2 一个装配器

`src/core/agent-runtime/context-assembler.ts` owns `createContextAssembler(deps:ContextAssemblerDependencies):ContextAssembler`。`ContextAssemblerDependencies=Pick<RuntimeExecutionDependencies,'executions'|'roles'|'materials'|'bodies'> & Partial<Pick<RuntimeExecutionDependencies,'plans'|'sessions'|'kernelStores'|'workspaceHost'|'workspaceSource'>> & {graphContext?:GraphContextReadPort;taskInputs?:TaskContextInputPort}`。生产 composition 必须提供两个新 port；`ExecutionPreparationDependencies` 的两个新 port 同样可选，窄旧测试替身可缺省。缺接口时 task/role/brief 仍从原必需事实装配，缺 Goal/架构明确写 `目标上下文未加载`/能力 not_implemented；如果实际 grant 选择 look/find，缺接口在模型调用前拒 `unsupported`。不是默默交给空工具。graphContext 存在却读取失败必须传回原拒绝，不启用 legacy fallback。

工厂签名：`createExecutionPreparation(deps:ExecutionPreparationDependencies,contextAssembler?:ContextAssembler):ExecutionPreparationService`；`createQueryPreparation(deps:RuntimeExecutionDependencies,contextAssembler?:ContextAssembler):QueryPreparationPort`。旧单参调用者保持可用，第二参缺省由相同 factory 构造一次。真实 `createAgentRuntime` 只构造一个 assembler，同实例作为第二参传给两个 preparation，readAttentionGraph也直转它；不在每个 prepare/scan 临时另造 reader。不是由Host再独立构造一份文字装配器。

```ts
export type AssembledContextV1 = { input: string; binding: ContextAssemblyBindingV1;
  continuationBrief: ContinuationBriefV1 | null;
  sessionBasis: PreparedTaskManifestV1['sessionBasis'] | undefined;
  selectedTaskInputs: PreparedTaskManifestV1['selectedTaskInputs'] };
export interface ContextAssembler {
  assembleTask(ctx: CoreCallContext, input: {
    execution: TaskExecutionRecord; role: RoleSpecResolutionV1;
    configuration: ResolvedRuntimeConfiguration;
    permissions: TaskEnvelopeV1['permissions'];
  }): Promise<ReadResult<AssembledContextV1>>;
  assembleQuery(ctx: CoreCallContext, input: {
    facts: QueryPreparationFacts;
    role: Exclude<RoleSpecResolutionV1,{status:'inadmissible'}>;
    configuration: ResolvedRuntimeConfiguration;
    permissions: PreparedQueryManifestV1['permissions'];
    question: string;
  }): Promise<ReadResult<AssembledContextV1>>;
  readAttentionGraph(ctx: CoreCallContext, request: AttentionGraphReadRequestV1): Promise<ReadResult<GraphAttentionFactsV1>>;
}
export type AttentionGraphReadRequestV1 = {
  goalRef: GoalRef | null; planRef?: PlanRevisionRef; focusTaskIds: string[];
};
export function renderAttentionChanges(input: AttentionChangesV1): string;
```

迁移 `prepareContinuationBrief` 的**图 facts collection**到 assembler；`continuation-brief-assembly.ts:readPreviousTurn/assembleContinuationBrief` 仍负责 Kernel 解码、事实推导、历史限额，原合同与原 suffix renderer 保留。Kernel历史/工作区读取不能移进 WorkGraph。查询的 `INITIAL_COORDINATION_RESPONSE_GUIDE` 由原 query-preparation 作为 question 的后缀传进 assembler，原常量逐字不改；规划浏览器的提問不重写。Query question 原文逐字保留，放 goal 段末 `## Question\n` 后。普通 semantic Query 按 copy 模式的精简输入装配，focusTaskRefs 仍按原正式 QueryJob intent。

### 4.3 冻结的段落与字节规则

段头依次为 `## Runtime context`、`## Goal`、`## Accepted task`、`## Footprint`、`## Note index`、`## Reminders`、`## Selected inputs`；continuation 直接使用 `renderContinuationBriefZh(brief,digest)`，不加包头。

Work prelude 保留 `# Verified runtime task input\n\nThis is the current task context assembled from formal platform facts; it is not a transcript.`；Query prelude 保留原 `# Verified read-only Query input` 与 bounded Query说明。prelude 与第一段之间、段与段之间一律两个 LF，无尾 LF。role 段含原 `roleBinding/tools/writeScope`、原 Role specification内容；task 段保留 `task: title (id)`、`instruction:`、`plan:`、`workspace:`，新增 stage/module/obligations/verification/upstream/downstream/failure。instruction/question/义务/验收 description 原文不能删、改写或缩成标题。

新增结构的序列化不交给实现者临场选：role payload 依次为原 Runtime binding 块、原 Role specification 块、`duty: ${duty}`、`contextResidentBytes: ${B}`，块之间两个 LF；Goal 行依次 goal/objective/workspace/autonomy/current understanding（正式索引行完整 canonical JSON，未接写`(not_implemented)`）；task 先原四行，再依次 definitionPlan/stage/module/requirementLevel/disposition/phase/obligations/acceptance/upstream/downstream/failure。对象/数组字段用已有 canonicalJson，数组先按正式 id 排序；无义务/验收的字面值为`未定义`，其余合法缺省为null。义务原 title 和每条 requirement.description 全保留。card 的 summary 不是这些字段的替代。可选索引 row 用 canonicalJson({key,node,text,sources})；输入 row 用 canonicalJson({declarationId,source,usage,bodyExcerpt,more})，bodyExcerpt 是首个 bounded page 原文、more=nextCursor!==null。`selected` 证明定下材料版本，bodyExcerpt/more 明确正文未全装；不能称摘录为完整输入。

同文件导出纯 `renderContext(input:{prelude:string;required:{role:string;goal:string|null;task:string|null};optional:Partial<Record<'footprint'|'notes'|'reminders'|'inputs',{key:string;text:string}[]>>;continuationSuffix:string|null;residentBudgetBytes:number}):{input:string;sections:ContextAssemblyBindingV1['sections'];residentBytes:number;totalBytes:number}`，required 的值是不带本段顶层段头的完整 payload，optional.text 是上一步已渲染的一条完整 row；用于 assembler 和 CA 的纯格式/预算测试。continuationSuffix 沿原 renderer 产生，不再另编码。旧 requiredMaterials 的准入仍由原 prepare 先执行：仅原支持的 contract 分支可通过，不借新增图上下文假称未支持的 Role 必读 code/evidence/history/decision 已满足。

| callKind | 段，按从左到右 |
| --- | --- |
| work | role, goal, task, footprint, notes, reminders, inputs |
| continuation | 上一行 + continuation |
| handoff | 同 continuation，最后段内写“接手自…”；第7片生产 handoff事实 |
| review | role, task, reminders；审阅原历史是引用，未实现审阅执行时不启用新入口 |
| secretary | role, goal, task（关注任务）, notes, reminders；只预留第6片模式，不启用派工 |
| copy | role, goal（含 question）, task（focus一行）；无任务时 task段省略 |
| planning | role, goal（含 question/原响应 guide）, task（现有计划摘要）, footprint（顶层模块卡） |
| attention | 只变化行；不加上述卡片/prelude/brief |

plan-only 节点也保留，写 `acceptance: 未定义`；无义务写 `obligations: 未定义`，不能编一个“通过所有测试”。required/optional 与 scope/disposition/phase 分开写。同模块同文件风险是提醒，不是 hard eligibility gate。Task的所属模块优先 adopted scope 中 moduleRef；Goal/stage范围不猜模块，写 `(未声明)`。

budget B 默认4096仅四段共享，固定顺序 footprint→notes→reminders→inputs，各段 rows 按 key 字符码升序（reminders 按 `kind:key`，异常 anchor key 用 `anomaly:<refkey>`，不得插入时间排序）。role/goal/task/continuation全文不算 B。Goal 中的当前理解**索引行**属于必需目标卡，完整保留；notes 可选段是其它注记的索引。四段段头、标记和结构分隔符也算 B；没有行且无省略则不输出那个可选段。

推荐 T2 的精确算法：把四段的 rows 串成固定序列，共 N 项；对每个前缀长度 k=0..N，按原段分组渲染前 k 项。每个有行的段渲染为 `段头+'\n'+保留行.join('\n')`，该段有省略时末尾再加一行 `另有 n 条，用‘看’读`（没有保留行时段头下一行直接是标记）。可选段以 `\n\n` 相连，计费字符串还含接到前一必需段的前导 `\n\n`；不含接续段的分隔符。选择满足该**完整计费字符串** UTF-8 bytes≤B 的最大 k；不是首次失败就退出的近似算法，因为省略标记消失会改变长度。只能选全局前缀，不拿后面较短 row 抢位；保留完整 row，不截中间字节。

如果连 k=0 的标记结构也不够，四可选段全部不渲染，residentBytes=0；在必需 task 段末（该调用没有 task 段则 goal 段末）附 `## Context omissions`，按段顺序每行 `${section}: 另有 n 条，用‘看’读`。这几行是必要元数据，不是可选正文；相应 sections 的 startByte/endByte 均 null、omitted=该段全部行数。B=0 依此处理，不拒执行、不丢提醒/可读定位、不报告超过 B 的 residentBytes。正常分支 residentBytes 等于完整计费字串字节数。T2 两种选择都要遵守 AMB-38 的信息保留规则，lead 定其它计费办法须同时修改本文和边界测试。

足迹、注记、提醒行是索引，输入正文是一项 row；精确输入一项过长整项省略，不截一个 JSON/body还标 selected完整。binding.inputSelections 仍保留已核实版本；已核实 Artifact投影进 selectedTaskInputs。看正文使用分页，不一次把256KiB body塞进上下文。所有 omitted 行都能通过目标/任务卡的 source/link 和 look target 找回。注记没接时提醒 `注记索引尚未接入`，不声称“本节点无注记”；异常接缝未接则 `异常锚点投影尚未接入`。

sources 取规范 JSON key 排序/去重，空 digest用 null，不用 undefined混算；sections.startByte/endByte 为段头起点至段末的半开 UTF-8区间，不包含前后分隔符；只有极小预算整段省略的项允许两个 null。区间按渲染顺序排列，忽略 null 后严格有序、不重叠。inputDigest仍 sha256Hex(input)，manifest digest仍全 JSON body 的 artifactBodyDigest；formatVersion改变须明确升版，已绑旧输入不重装。section payload UTF-8采用当前 Node标准编码；不 `localeCompare`、不 CRLF平台化。外部原文字串保留原换行，只有平台新增结构用 LF。

**接续兼容硬规则**：workInput 后正好 `\n\n${renderContinuationBriefZh(brief,digest)}`；接续后不追加任何部分；C3标记/standing instructions/版本摘要/历史边界仍用现有 contract。异常锚点第1片写进已有 brief扩展，assembler 的 reminders 可引用同一锚点但不能再造第二份不同正文。没有 requeueRef 的新领取若有未接手锚点，提醒段完整索引，接续说明的生成条件沿第1片合同，不能随意合成 TaskRequeue。

### 4.4 看、找及下钻

```ts
export const GRAPH_TOOL_NAMES = ['look_graph','find_graph'] as const;
export type GraphToolsConfig = {
  context: CoreCallContext; goalRef: GoalRef;
  graph: GraphContextReadPort; inputs: TaskContextInputPort;
  history: GraphExecutionHistoryReadPort;
};
export function createGraphTools(config: GraphToolsConfig): {
  names: readonly string[];
  create(workspace: WorkspaceSandbox): ToolDefinition[];
};
```

两 tool 为 `effectClass:'read_only'`，ToolResult effects `{sideEffect:'none',changedPaths:[],workspaceRevision:null,artifactRefs:[]}`；保留完整 ReadResult，错误用现有 adapter 的 error结果包络，不把 rejected换成success。factory前 clone context/goal；每次 execute原 signal传下去。strict schema只接受下面参数，不让模型传 project/workspace/goal/principal/actor/duty/Host reader/requestId。

沿旧白板读工具的 definition：requiredCapabilities=['workspace_read']、defaultTimeoutMs=10000、independentReadOnly=true、outputLimitBytes=64*1024。adapter 在交给 Kernel 前计算**完整 ToolResult 的 UTF-8 JSON 字节数**；超过48*1024则返回一个小的 `rejected/capacity` domain结果（ToolResult status=error、error.code=execution_failed，保留该拒绝的JSON），提示缩小page/下钻，不能让 Kernel 截断 ready JSON 后仍当成完整事实。48KB为64KB外壳/Kernel摘要留余量。正文 input 用本片字节分页，history 也允许减小 limit，HTTP read model 不受这个 Kernel 输出上限影响。T8 可改明确的更大上限，但必须同时改检查与fixture，不把节点状态写成failed。

`find_graph` 参数 `{needle:string,page?:{afterCursor?:string|null,limit?:number}}`，默认 afterCursor=null/limit=20；`look_graph` 判别联合：

```ts
type LookArgs =
 | { mode:'node'; target:GraphNodeRefV1; relation?:GraphLookRequestV1['relation'];
     page?:{afterCursor?:string|null;limit?:number} }
 | { mode:'path'; path:string; relation?:GraphLookRequestV1['relation'];
     page?:{afterCursor?:string|null;limit?:number} }
 | { mode:'history'; runRef:RunRef; afterCursor?:string|null; limit?:number }
 | { mode:'input'; consumer:TaskTriple; planRef:PlanRevisionRef;
     declarationId:string; candidateKey?:string;
     afterCursor?:string|null; maxBytes?:number };
```

node/path默认 card,page20；history limit默认50、范围1..200，调用原 `readTaskExecutionHistory(ctx,{runRef,afterCursor,limit})`；不绕 busy/archived，也不 ack消息、不读整 Session 转录。每页同scope校验，保留原 scannedCount/basis。`GraphToolsConfig.history` 是 driver 内部的窄代理，**不是**把 tool 的 work_run/query_run 原 context 直接交给 Host-only 的 RT8/RT7。每次代理先用 `graph.lookGraph` 对原 tool context 和该 Run 的 card 校验；canonical scope/身份拒绝立即返回。然后以 driver 已持有的同scope可信 Host context 调用现有 RT8；Work 用原 startRun 的 Host context，Query 的 actor 用 `queryExecution.readPreparationFacts` 返回的原 initiator，principal/materialReader 两处必须相同；原 signal换成本次工具 signal。代理不对外暴露 Host context，不接受模型传 Host/Kernel identity；不能把 RT8 的 source_stale/cursor 检查转换成成功。【lead 改：C2】沿用已有的必填字段 `RuntimeExecutionDependencies.graphHistory`（`execution-contracts.ts:182`，RT8），不新增字段；不新建 Kernel Store 或改 RT8 文件。查询 canonical facts 在新工具 factory 选择前读取并核验，不能从 question/manifest文字猜 initiator。

input maxBytes默认2048、范围1..4096，转 `inputs.readTaskInputPage(ctx,request)`；返回 `TaskInputPageV1`。cursor绑定 scope/consumer/plan/declaration/candidate/digest/UTF8字节offset；跨声明 cursor 为 `invalid`，该声明不再容许原 source 为 `revision_conflict`；后续正文仍读 cursor 固定版本，不换成新选择；不截断UTF8字符。maxBytes 小于下一字符长度时 `capacity`，不返回无进度空页。结果中 source/usage每页都有，不给“当前有效”的标签。

node参数虽然带完整 ref，adapter仍必须验证与可信 ctx/goal；仅有字段不是授权。两个图 tools 并非 built-in read；使用原 `coordinationTools` names/create接缝注册，传给 runObservedModel 的 allowedTools仍只含 `BUILTIN_TOOL_NAMES`。`runObservedModel` 的 readOnly拒mutation检查不能改成“允许所有扩展”；query driver只注入这两个只读工具工厂，不注入邮箱/whiteboard写工厂。Query grant的最终结果是 Host grant ∩ Role ceiling ∩ Query read ceiling；只有显式授予的 look/find生效，不因工具名字出现在常量里自动授权。

### 4.5 注意力事实与变化类型

```ts
export type GraphAttentionDetailV1 = {
  node: GraphNodeRefV1; name: string; summary: string; state: string | null;
  version: string; contentDigest: string; sources: ContextSourceV1[];
};
export type GraphAttentionFactsV1 = {
  nodes: string[]; edges: string[]; statuses: Record<string,string>;
  revision: string | undefined;
  details: Record<string,GraphAttentionDetailV1>;
};
export type AttentionNodeChangeV1 = {
  key: string; change: 'added' | 'removed' | 'changed';
  beforeVersion: string | null; afterVersion: string | null;
  detail: GraphAttentionDetailV1;
};
export type AttentionChangesV1 = {
  scope: { projectId:string;workspaceId:string };
  goalRef: GoalRef | null;
  nodes: AttentionNodeChangeV1[];
  edges: { key:string;change:'added'|'removed' }[];
  revision: { before:string|null;after:string|null } | null;
  files: { path:string;version:string|null }[];
  heartbeat: {pendingInputs:number;messageCursor:string|null} | null;
  feedbackIds: string[];
};
export type GraphChangesV1 = Pick<AttentionChangesV1, 'nodes' | 'edges' | 'revision'>;
// app/attention-observer.ts 的新增纯函数；GraphAttentionStamp 是既有兼容结构。
export function graphChanges(previous: GraphAttentionStamp | null,
  current: GraphAttentionStamp | null): GraphChangesV1;
```

原 `graphChangedElements` 的既有数值和不带 details 的旧返回 shape不变；另导出 `graphChanges(previous,current)` 返回详细变化。真实新 snapshot总带details。按节点key比较存在、state、name、summary、contentDigest；边变更的两个端点作为changed节点提供定位；删除携带旧detail的 tombstone；只有 revision变、其它内容同，输出一行revision_change，不把全部节点当changed。依赖 label变沿切片0的签名识别移除旧边/新增新边；不得再 stringify requires 对象。

observer 的触发检查也要使用 details：保留旧计数 `graphChangedElements`；仅 name/summary/contentDigest 变化、且尚未被旧存在/state差异计数的 node key，每个给新 signal.changedElements 加1，其余旧 nodes/edges/statuses计数不改。旧无details调用者仍返回旧shape；新signal可附changes。不能只新建 graphChanges 然后仍用旧 changedElements>0 触发，否则 AT05 永远不通知。所有未变节点的 details 可以留内存用于diff，但不进入通知正文。

`createAttentionScanner` 图部分只调用 assembler.readAttentionGraph，不继续独立读取 plans/catalog；files/message/feedback的原采集与阈值/coalesce不改。`AttentionGraphReadRequestV1.goalRef=null` 时照旧可以读采用架构，不能编一个 Goal id；此时 assembler 调同一个 graph reader 的 readAttentionFacts。图读取失败仍 graphUnreadable=true，保留旧基线，绝不是删全部节点。

Host用 renderAttentionChanges 输出**变化行**和版本，仅发送 signal相关变化文件；不得输出 snapshot.graph或全部snapshot.files。格式首行 `[attention s3-v1]`，后续每行 `JSON.stringify`一个 `{kind,key,change,beforeVersion,afterVersion,...}`对象，键的插入顺序固定，所有值scope/refs来自可信snapshot。大集合按kind/key排序装完整行；完整文本上限 `16384` UTF-8 bytes，计入首行、LF和最后省略标记。最后行格式 `{"kind":"omitted","count":N,"hint":"另有 n 条，用‘看’读"}`，其中hint中的n为实际N十进制；预留该行后装入最长前缀，单项过大也整项省略。不能输出半个JSON/UTF8、不能超限后依靠 mailbox拒绝。

【审查改】每种行的精确写法（键按表里从左到右的顺序插入；值为 null 时写 null，不省略键）：

| kind | 行对象 | 什么时候有 |
| --- | --- | --- |
| `scope` | `{kind:'scope',projectId,workspaceId,goalId}`（没有 Goal 时 goalId 为 null） | 每条通知恰好一行，紧跟首行 |
| `revision` | `{kind:'revision',key:'graph',change:'revision_change',beforeVersion,afterVersion}` | `revision` 不为 null |
| `node` | `{kind:'node',key,change,beforeVersion,afterVersion,node,name,summary,state}`（后四个取自 detail；removed 用旧 detail） | 每个节点变化一行 |
| `edge` | `{kind:'edge',key,change}` | 每条边变化一行 |
| `file` | `{kind:'file',key,version}`（key 是路径；version 为 null 表示文件没了） | signal 相关的每个变化文件一行 |
| `feedback` | `{kind:'feedback',key}`（key 是 feedbackId） | 每个 feedbackId 一行 |
| `heartbeat` | `{kind:'heartbeat',key:'heartbeat',pendingInputs,messageCursor}` | `heartbeat` 不为 null |
| `omitted` | `{kind:'omitted',count,hint}`（见上段） | 有省略时，最后一行 |

行序：首行 `[attention s3-v1]`，然后 scope 行，然后按 kind 依次 revision、node、edge、file、feedback、heartbeat，同一 kind 内按 key 的 UTF-16 码元序（`<`），最后是 omitted 行。行与行之间一个 LF，末尾没有 LF。首行和 scope 行总保留、不计入省略；装不下时只保留上述顺序的最长前缀，其余计入 omitted.count。

requestId保持原 scope/target/paths/版本/signals 的可信hash身份，可以hash完整snapshot以防变化冲突，但通知正文只变化。sent committed后才markDelivered；原acceptedInputs确认后才markProcessed；省略的变化也属于这次通知已标记的snapshot（Agent通过look获得其详情），不把同一个大变化无限重发。重试同一snapshot→同requestId/同文本；新snapshot→新身份。初次prime不通知既有状态；targetSession/current消费者策略不改，第7片再改投参谋。

### 4.6 路由与 Runtime port

只加两个公开 read route，沿现有 POST CoreRoute plain envelope `{scope:{projectId,workspaceId},input:...}`，保留 token与ctx构造。路由suffix为 `graph/look`、`graph/find`，binding分别 `lookGraph`、`findGraph`，owner `graphContext.lookGraph`、`graphContext.findGraph`。`CoreRouteBindings` type引用上述签名；`CoreRoutePlatform` 加 `graphContext:GraphContextReadPort`。`createPlatformCoreRouteBindings`逐项直转，`CORE_ROUTE_SPECS`两行，CoreRouteSuffix联合显式扩展；`server.ts`若用既有表派发，不加平行switch或新API。

`CoreRouteSuffix` 的唯一声明在 `src/app/core-http-types.ts`，必须在这里加两个 literal，不能在 core-routes.ts 造第二个 union。`CoreRouteBindings.lookGraph:GraphContextReadPort['lookGraph']`、`findGraph:GraphContextReadPort['findGraph']`。工具的 `GraphToolsConfig` 由 Work driver 的 canonical Run 和 Query driver 的 canonical QueryJob Goal 构造；与 raw model arguments 分开。

history仍走原 `executions/history` 与 readTaskExecutionHistory；prepared brief仍走 `executions/brief`，不新增HTTP任意artifact读取、消费审计写端点。模型的input下钻仅通过可信GraphToolsConfig调用TaskContextInputPort；UI需要时第2/4/新界面引用读卡的声明和既有接口，不在本片建立写flow。

Runtime port增加可选 `readAttentionGraph?: ContextAssembler['readAttentionGraph']`（保持旧字面port兼容）；真实 createAgentRuntime总装配，无deps的skeleton返回unsupported。create-platform只新增 `graphContext`与 `taskInputs`内部owner，并把同一个实例交给Runtime、route和scanner；所有读调用沿现有trackedCall关闭保护。没有新Workflow方法、没有新循环、没有新dispatch/claim代码：`Workflow.advance/select_work/prepare/start`继续调用原 prepare入口，新context就在这一入口生效。测试要证明缺输入不改变 Workflow 下一步。

`execution-contracts.ts:RuntimeExecutionDependencies` 的新可选字段逐项为 `graphContext?:GraphContextReadPort`、`taskInputs?:TaskContextInputPort` 两个；`ExecutionPreparationDependencies` 也只加这两个。【lead 改：C2】`graphHistory` 已是必填字段，不再加。窄旧 caller/test doubles 没授新图工具时继续编译/运行；实际新 grant 必须全部装配，不能以返回空页替代缺接口。

Host `localWorkbenchGrant`（【lead 改】在 `src/app/host.ts:499`）的新动态授予为 `['read','look_graph','find_graph', ...原写/邮箱/命令授予]`，移除其中三个旧读名称；其它显式 runtime bindings 不自动重写 tools。新 query 的交集由同一 grant 和既有只读 ceiling 得到。`local-workbench` Role/template pin 和静态 guidance 摘要不变；新生成 Host configurationRevision 改为 `local-workbench:s3@${sha256Hex(canonicalJson({scope,duty,residentBytes,tools,writeScope,modelRevision})).slice(0,16)}`，字段取明确 resolved 值。不能继续只 hash scope，让权限/配置变了仍报同一版；已保存 manifest 保持旧 revision 和工具集合，不能重新写它。RoleSpec 上界未授 look/find 的显式配置仍不擅放宽，按新规格修订该 Role 正文后才能授予。

Host 真正配置更新后，旧 prepared 的重新入场可能依既有 current-Host 守卫拒 `forbidden`（`execution-entry-service.ts:admitManifest`、`execution-driver.ts` 的 Host revision 比较、Query 的 begin/bind 比较），这一行为保留。兼容承诺是旧正文/授权事实不被重写、旧名称 adapter 保留、旧显式配置仍按原集合工作，不是忽略当前 Host 授权。不得通过重装旧 Run 或绕开 revision 检查解决跨配置拒绝。

## 5. 测试规格

### 5.1 固定 fixture 与计数规则

case id就是test名称前缀，一行一个语义case；“M/S”表示该case分别在memory和SQLite执行，不合成一个只测假port的测试。正向服务fixture沿 `tests/work-graph/R4c-execution-history-index.test.ts` + `tests/helpers/task-claim-fixture.ts`、`tests/work-graph/R3g-role-spec.test.ts`的真实backend/style；读取场景不能只mock成功。新scenario沿 `tests/scenarios/harness.ts` 和 `support/brief.ts`，scripted provider，SQLite、既有正式claim/prepare/start；不调用真实模型。

统一基础：scope=`p/w`，Goal=`g`，objective=`Ship platform`，Plan=`p1`存储revision1；不存在独立数字 business planRevision 字段，版本 ref 的 planId 即 p1。stage s 的 title=`Main`、children=tA/tB；tA title=`A`，tB title=`B`、assignment.instruction=`Implement B`；required义务 `oB: Deliver B`，verification=`vB/static: node check-b.js`；上游runA completed不等于Task satisfied；tB 的唯一 Run=runB。legacy Artifact正文`old-A`，contentType=`text/plain`，digest=`sha256Hex('old-A')`、sizeBytes=5、canonical owner runA；Workspace@7。边require kind artifact,label=`A.out`。另一个workspace=`w2`。GR06专用模块：M1 name=`B`、responsibility=`Build B`、paths=['src/b'];M2 name=`Utility`、responsibility=`Utilities`、paths=['src/shared']，仅其noteBody含B；GR05专用fixture把两模块paths都改为['src/shared']。每个服务case从独立fixture开始。

装配pure小fixture raw段text依次 `R/G/T/F/N/M/I/C`，renderer按 §4.3 段头。`H(s)=sha256Hex(s)`、`B(s)=Buffer.byteLength(s,'utf8')` 是**精确期望表达式**，不是模糊“摘要有效”。省略预算case按实际完整字串B求边界，不用拍一个近似数。

### 5.2 `tests/state/context-input.test.ts`（15 cases）

| id | given / action | exact expected |
| --- | --- | --- |
| ST01 | 无binding，已有legacy input | contextAssemblyProblem=null |
| ST02 | 合法s3 work，全区间/字节正确 | null |
| ST03 | formatVersion=`s3-context-v2` | rejected/invalid |
| ST04 | 同一个task段出现两次 | rejected/invalid |
| ST05 | 未知段名`question` | rejected/invalid |
| ST06 | endByte比B(input)大1 | rejected/invalid |
| ST07 | totalBytes按JS.length算，input有“中” | rejected/invalid |
| ST08 | brief末尾又加一行`extra` | rejected/invalid |
| ST09 | 声明未在allowedDeclarations中 | rejected/forbidden |
| ST10 | selected有source=null | rejected/invalid |
| ST11 | ambiguous仅一个candidate | rejected/invalid |
| ST12 | source project=`other` | rejected/forbidden |
| ST13 | usage=`current` | rejected/invalid |
| ST14 | 合法missing，调用RUN-02 freshAdmission | transitionRun.ok=true，Run=Authorized，Task phase未改 |
| ST15 | ambiguous恰好两个不同canonical source，source=null | declaredInputProblem=null；候选版本都保留，不自动选第一项 |

### 5.3 `tests/work-graph/S3-context-inputs.test.ts`（19 cases × M/S =38）

| id | given / action | exact expected |
| --- | --- | --- |
| IN01 | legacy声明，正文可读 | selected；source.ref=原ArtifactRef；usage=historical_explanation；旧输入projection=一个legacy requirementId/ref |
| IN02 | legacy正文后来另存`new-A`，消费原声明 | 仍old-A/digest=H('old-A')；未选new-A |
| IN03 | 同scope但不是声明ref的candidateKey | rejected/forbidden；openArtifact calls=0 |
| IN04 | owner canonical Workspace=w2 | rejected/forbidden；正文不返回 |
| IN05 | source owner ref加载得到不同Run | rejected/forbidden |
| IN06 | 原Artifact正文缺失 | unavailable，errorCode=not_found，source=null；Task未blocked |
| IN07 | Raw body被改为bad-A、ref仍H('old-A') | unavailable/errorCode=unavailable；body=null |
| IN08 | artifact边只label A.out，无正式关联 | missing/reason=no_labeled_output；upstream还是runA事实，无猜测Artifact |
| IN09 | 两条legacy声明r1/r2指同一原ArtifactRef | 两项selected；projection恰为[{requirementId:'r1',ref:oldRef},{requirementId:'r2',ref:oldRef}]；未按digest合并 |
| IN10 | 声明r1固定old-A，拿声明r2的new-A source key读r1 | rejected/forbidden；openArtifact calls=0；不能借合法另一声明串料 |
| IN11 | gate-result label=checkId，链头适用PASS | selected check source=该链头ref/revision/checkId/reportRef |
| IN12 | 原PASS有后继finalized FAIL | missing；不选旧PASS |
| IN13 | environment label=workspace | selected environment p/w@7，无source pin/current断言 |
| IN14 | decision仅答复，未落实 | missing/reason=decision_not_applied；已有消息status不改 |
| IN15 | 先取消AbortSignal | rejected/cancelled；store/material IO=0 |
| IN16 | 直接以consumer Run材料reader读runA，然后按声明桥接读 | 直接forbidden；桥接ready/selected；整次读取ledger提交数增量0 |
| IN17 | legacy exact ref 的正文origin为同scope platform_operation | selected artifact；provenance等于所存origin；未编造ownerRunRef；usage历史 |
| IN18 | legacy exact ref 的正文origin为legacy/ownerRunRef=null | rejected/forbidden；body=null；未凭caller scope补owner |
| IN19 | canonical QueryRun归属g/p/w，以图工具读tB的legacy声明 | ready/selected old-A；记录版本齐全；Query权限不增加写工具；ledger提交增量0 |

IN09/10 全部使用真实存储的旧精确声明，不依赖不存在的产物索引。ambiguous DTO 的合法 shape/候选数在纯 state 测试验证；接正式 label 候选来源时再补对应服务 case，不预写永远走不到的正向 fake registry 测试。

### 5.4 `tests/work-graph/S3-graph-context.test.ts`（19 × M/S =38）

| id | given / action | exact expected |
| --- | --- | --- |
| GR01 | tB card | task.obligations[0].obligationId=oB、verificationRequirements[0].requirementId=vB、task.assignment.instruction=Implement B、source Plan=p1@1 |
| GR02 | stage s含tA/tB，children limit1 | 第一页items[0].node.ref.taskId=tA、nextCursor非null；第二页仅tB、nextCursor=null |
| GR03 | task neighbour | 恰含tA edge requires artifact:A.out；不把父子关系当dependency |
| GR04 | tB executions，fixture各任务一个Run | items仅runB，不含runA；model请求增量0 |
| GR05 | path同时属M1/M2 | items长度2，按module key排序，不猜一个 |
| GR06 | find needle=B（§5.1专用名字fixture；Session名sa/sb，Round名ra/rb） | node keys恰为task:tB、module:M1、run:runB，按该顺序；没有仅noteBody含B的M2 |
| GR07 | find needle=b、仅有B | items=[]，大小写敏感 |
| GR08 | find limit0 | rejected/invalid，记录读取次数0 |
| GR09 | cursor来自另一Goal | rejected/invalid |
| GR10 | 第一页后Plan换p2 | 第二页rejected/revision_conflict，不混两版 |
| GR11 | path=`../x` | rejected/invalid；文件/材料读取次数0 |
| GR12 | 节点outside p/w | rejected/forbidden |
| GR13 | 未装extensions | 五availability均not_implemented；不算available空注记 |
| GR14 | catalog codec损坏 | rejected/unavailable；model/commit增量0；不得ready空图 |
| GR15 | find limit101 | rejected/invalid，记录读取次数0 |
| GR16 | find needle空字符串 | rejected/invalid，记录读取次数0 |
| GR17 | 合法 QueryRun，原 submission actor=human/u；find针为sessionId=sb | ready；items恰含session:sb、payload.session.ref.sessionId=sb；Session port收到同p/w、actor=human/u的内部Host context；外层cursor.scopeKey=H(canonicalJson({projectId:p,workspaceId:w,goalId:g,principal:{kind:'query_run',queryRunRef:该ref}}))；Kernel/material/ledger提交增量均0 |
| GR18 | 合法Query记录与原submission actor=human/u，但ctx.initiator=human/other | rejected/forbidden；sessions.findSessions/readSession calls=0；Kernel/material/ledger提交增量均0 |
| GR19 | canonical Work runB p/g/w，look tB executions | ready且仅runB；执行reader收到p/w、deps.hostActor和相同materialReader.actor；Session reader仍收到原work_run；原Run/Session/lease revision不变；Kernel/material/ledger提交增量均0 |

### 5.5 `tests/runtime/S3-context-assembler.test.ts`（15）

| id | given / action | exact expected |
| --- | --- | --- |
| CA01 | renderContext：原Work prelude，required=R/G/T，四optional各一行F/N/M/I、B=4096 | input恰=prelude+'\n\n## Runtime context\nR\n\n## Goal\nG\n\n## Accepted task\nT\n\n## Footprint\nF\n\n## Note index\nN\n\n## Reminders\nM\n\n## Selected inputs\nI'；totalBytes=B(input)，inputDigest=H(input) |
| CA02 | source/row输入数组置乱 | input和binding与CA01逐字节相同 |
| CA03 | 同事实连续未绑定prepare两次 | inputDigest相等、ArtifactRef相等，不新增body |
| CA04 | bound后Goal/notes上游均变 | ready prepared深相等原值；graph/inputs/brief重读次数0 |
| CA05 | 义务/验收/brief合计大于4096 | 全文各原字串存在；无capacity；总bytes>4096允许 |
| CA06 | B=B('\n\n## Footprint\nF\n\n## Note index\nN\n\n## Reminders\nM\n\n## Selected inputs\nI') | 全行保留，四omitted=0，residentBytes=B |
| CA07 | 仅footprint三行F.repeat(100)、X.repeat(200)、Y；B=B('\n\n## Footprint\n'+F.repeat(100)+'\n另有 2 条，用‘看’读') | 仅保留首行；omitted=2；X整行和Y都不出现；residentBytes=B |
| CA08 | B=0，四段各1行 | residentBytes=0；四omitted=1、区间null；task末四行`${section}: 另有 1 条，用‘看’读`；没有四可选段头/正文；role/goal/task原文保留 |
| CA09 | optional输入是一项5000字节正文 | omitted inputs=1；selection/ref版本保留；不标成body完整 |
| CA10 | no obligations/plan_only未来task | 含`obligations: 未定义`；不写satisfied/编验收 |
| CA11 | missing上游 | reminder含输入declarationId与upstream tA当前事实；执行准备ready |
| CA12 | 合法已有C3 brief + 注入正式anomalies投影 | input.endsWith('\n\n'+原render)=true；提醒有投影anchor key；没有尾注；不要求未落地的slice1字段 |
| CA13 | Query question含CRLF/中文 | 原question字串完整，guide常量完整；动态事实只在user input不在systemPrompt |
| CA14 | 未装extensions | 五availability=not_implemented；含未接入说明，不伪造空理解 |
| CA15 | extensions抛错 | rejected/unavailable；无新manifest/body；不将错误转空数组 |

### 5.6 `tests/work-graph/S3-prepared-context-admission.test.ts`（8 × M/S =16）

| id | given / action | exact expected |
| --- | --- | --- |
| AD01 | 新work带selected + missing合法 | committed，replayed=false，原Run Authorized；missing不阻claim |
| AD02 | 同authorize requestId/内容，后来上游新材料 | committed/replayed=true；原cursor、原inputBinding，resolver calls=0 |
| AD03 | 同requestId换manifest | rejected/idempotency_conflict，commit增量0 |
| AD04 | 保存后篡改input正文/摘要 | rejected/invalid（沿原摘要不匹配口径），commit增量0 |
| AD05 | old无contextAssembly manifest | 按原authorize通过；未添加context字段，无存量迁移 |
| AD06 | revoked再授权改变inputBinding | rejected/invalid；RUN-03未改原binding |
| AD07 | 新Query图tools look/find+read | bind committed；prepared phase，Host/Role/Query三重交集相等 |
| AD08 | 装配后Workspace由@7更新@8，原写guard仍@7 | rejected/revision_conflict；Run/Query/Session binding未新增；已put无主body可保留 |

### 5.7 `tests/work-graph/S3-role-profiles.test.ts`（6 × M/S =12）

| id | given / action | exact expected |
| --- | --- | --- |
| RP01 | fixture按配置表生成五正文，显式install/read；生产assembler消费同配置表 | 5个duty、label、responsibility与§2.5逐项相同；Session新增数0；未自动install/activate |
| RP02 | 旧Role缺duty | 原contentDigest逐字相同；effectiveDuty=executor |
| RP03 | duty=`coordinator` | install拒invalid；commit增量0 |
| RP04 | 同install identity再试 | 原receipt/cursor/contentDigest重放；不重写旧revision |
| RP05 | resolved secretary与Host adviser | rejected/forbidden，不自动切职责 |
| RP06 | role pin不变、配置skill secretary+scribe | duty仍原一个；AG6多skill加载照旧，Session role不变 |

### 5.8 `tests/runtime/S3-graph-tools.test.ts`（14）

| id | given / action | exact expected |
| --- | --- | --- |
| GT01 | names/create | names恰['look_graph','find_graph']，两个effectClass=read_only |
| GT02 | 参数塞principal/workspace/goalId | ToolResult status=error，error.code=invalid_arguments；下层port calls=0 |
| GT03 | 创建后mutate caller config | port仍收到clone前goal/scope，保留原signal |
| GT04 | node/path/find省略page | limit20/afterCursor=null；relation=card |
| GT05 | canonical Query p/g/w，history指向archived/busy Session的原Run，原initiator human/u | RT8原页ready/scannedCount保持；RT8收到同p/w、actor=human/u的Host context及本次工具signal；不创建Query、不开model |
| GT06 | history Run canonical workspace=w2 | rejected/forbidden，正文不返回 |
| GT07 | input首次准备选old，后来正式新source再look | 结果显示这次fixed source；初始manifest仍old；usage历史 |
| GT08 | input正文A中B，maxBytes=3 | 第一页A、第二页中、第三页B，末cursor=null；连接body=A中B；每页digest=H('A中B') |
| GT09 | r1的body cursor改为r2声明继续 | rejected/invalid；body不返回，不能串正文 |
| GT10 | Query真实Kernel调find→look | 下一provider请求存在两个真实tool结果；workspace changedPaths=[]；query writabletools=[] |
| GT11 | Query grant携send/note/shell | 三者不在manifest.permissions或真实request.tools；look/find显式授权才在 |
| GT12 | look/read之后 | message ack/acceptedInputs写入0（图读本身）；store commit0；无Workflow调用 |
| GT13 | A中B第一页A后，用maxBytes=1继续 | rejected/capacity，不产生空body无限cursor；用原cursor/maxBytes=3可读中 |
| GT14 | 合法ready页的完整ToolResult JSON为80KiB | ToolResult error/execution_failed；output[0].value为rejected/capacity；小于48KiB；无被截断的ready对象；effects.sideEffect=none |

### 5.9 `tests/app/S3-attention-context.test.ts`（12）

| id | given / action | exact expected |
| --- | --- | --- |
| AT01 | prime snapshot，重复扫描 | delivery=null，发送数0 |
| AT02 | 只有tA state变化，另有1000未变节点 | 文本只含tA change；不含任一未变node/完整graph |
| AT03 | 删除tA | removed，beforeVersion=旧，afterVersion=null，旧detail定位仍在 |
| AT04 | 边label A.out→B.out | 旧边removed、新边added；两个端点可定位；无[object Object] |
| AT05 | contentDigest变化但status/name不变 | changed行1，不漏语义变化 |
| AT06 | 只revision变化 | 一条revision_change，无全图nodes |
| AT07 | 2000变化行 | B(text)<=16384；omitted.count=总行数-实际行数；JSON逐行均能parse |
| AT08 | 一行超16384（中文） | 不输出半行/替换字符；omitted=1；正文<=16384 |
| AT09 | send失败再试相同snapshot | requestId/text相同；markDelivered/Processed各0；成功后Delivered1、Processed0 |
| AT10 | 实际消费确认原message | Processed1；后续observe相同snapshot=null |
| AT11 | graph reader失败 | graphUnreadable=true，旧基线保留，无全图删除通知 |
| AT12 | file_delta只改a，b未变；与heartbeat并发 | source files仅a；heartbeat计数照原；未更换targetSession |

### 5.10 `tests/app/S3-graph-routes.test.ts`（6）

| id | given / action | exact expected |
| --- | --- | --- |
| RT01 | graph/look plain envelope | 对同一graphContext.lookGraph转发原输入/可信ctx；ready card |
| RT02 | graph/find plain envelope | 同实例findGraph，scope不来自input |
| RT03 | envelope加principal/actor | parse rejected/invalid，port调用0 |
| RT04 | 使用graph_write request包读route | rejected/invalid，不创建receipt |
| RT05 | 无token请求graph/look | HTTP403，rejected/forbidden，reason='the local platform token is missing or stale'；port/model调用0 |
| RT06 | 原tasks/query、executions/history/brief | suffix、解析、owner转发不变；model启动次数0 |

### 5.11 `tests/scenarios/S3-context-and-inputs.test.ts`（1）与 `S3-query-graph.test.ts`（1）

| id | scenario | exact expected |
| --- | --- | --- |
| SC01 | 正式tB claim→prepare（A.out尚无）→scripted model先find/看tA/history→读已声明legacy old-A→结束；随后同Run重复prepare | 首轮input含oB/vB/输入missing；claim/start成功；tool source digest=H('old-A')；query/history读不另建Session；recordedRun原inputBinding保持；第二prepare返回原manifest；不凭上游completed让tB satisfied |
| SC02 | 旧主对话Query问“进度如何”，scripted provider调find B→look tB→history runA后回答；大图变化后Host通知一次 | 保存真实Answer，工具有tB状态/义务/历史版本；Query无写工作区工具；图展开/历史分页新增model请求0；大通知<=16384并消费一次，第二扫描发送0 |

新测试文件11个：state1 + work-graph4 + runtime2 + app2 + scenarios2。新语义case116：15+19+19+15+8+6+14+12+6+2；M/S四文件52个语义case各多跑一次，展开后168项：15+38+38+15+16+12+14+12+6+2。表内每行一个case，不在某一行隐藏参数化分支改变计数。

### 5.12 已有 prompt/context 文本断言：逐文件保留

本清单按真实assertion列，不把fixture中出现systemInstruction当成assertion。行号为585f1ac0；同一表行包含该文件中所有相关case的assertion范围。无需修改这些旧测试。既有完整text equality、history suffix、固定指南、schema helpers等均保持原义；本片允许新增首次上下文段，不允许拿“设计变了”删除原assignment/question/history/Skill断言。

| 已有文件（相对tests/） | assertion位置/内容 |
| --- | --- |
| runtime/B1-kernel-assembly.test.ts | 189–203：显式Skill marker/coding-safety排除与启用；336–344/436–440：真实project_source结果/失败交给下一model轮 |
| runtime/B2-runtime-execution.test.ts | 77、85–91：inputDigest、静态指令、Skill、Implement A；245–246：原history user条数；323：工具结果；442/462/548–550：拒绝的源码/工具不泄露；518–519：第二任务原历史marker/user数 |
| runtime/C2-runtime-platform-tools.test.ts | 171–173、208：静态Skill与safety；230–231：被拒文件内容不进入模型 |
| runtime/W2-role-skills.test.ts | 145–156、199：多Skill正文选择；203–211：受信图工具结果交给模型 |
| app/AG6-agent-assembly.test.ts | 195–202：platform-work/secretary/scribe在systemPrompt，adviser/reviewer和未授旧工具不在 |
| kernel/R4a-frozen-public.test.ts | 241/281/415：私有sentinel不进入模型；807–880：恢复的用户/工具历史和coding-safety正文；不改Kernel冻结输入 |
| work-graph/R5b-initial-plan.test.ts | 267–274、445–455：INITIAL_COORDINATION_RESPONSE_GUIDE及JSON例子真实进入model输入，并按原协议解析 |
| runtime/R5b-query-session-loop.test.ts | 242–243：静态Query指令/Skill；388附近：拒绝的工具结果按原Query loop呈现 |
| app/AG2-consultation.test.ts | 341–346：原咨询问题和真实源码read结果进入Answer轮 |
| app/AG2b-collaboration.test.ts | 209、219、226–227：两轮答复进入原发信模型上下文，未丢前一轮 |
| app/orchestration-mechanism.test.ts | 254–258：正式assignment的provider内assertion；476：原派生副本固定上下文文字；1–104：attention计数/去重断言也保持 |
| runtime/orchestration-boundaries.test.ts | 180：EXPLICIT_STEER_USE_EXISTING_CONTRACT仍在模型上下文 |
| runtime/R4c-session-continuity.test.ts | 76、99–106、143：completed原history文本、assistant答复、user内容数组逐项相等 |
| runtime/R4-control-runtime.test.ts | 554–566：原cancel前已执行工具留在接续上下文，未执行group2不在 |
| runtime/R2e-git-source-loop.test.ts | delivered helper及205–221后：真实Kernel工具结果与原始源码/字节身份进入后续request |
| runtime/source-text-loop-migration.test.ts | delivered helper59–71、expectFile helper74起及调用处：模型收到真实源码正文，原内容/新内容、UTF8字节和digest精确匹配 |
| contracts/A2-rework-contract-helpers.test.ts | 384–483：rendered brief全串、标记、standing instructions、截断/时间/中断文本；JSON clone同串；不得换renderer |
| runtime/C3-brief-timeline.test.ts | render helper121及使用case：上次执行结束和workspace时间轴中文行 |
| scenarios/A1-rework-same-session.test.ts | 171–192：首轮补充材料、input最终brief、操作者/次数/文件变化中文；214附近新turn内容 |
| scenarios/C3-brief-idempotency.test.ts | 80、117–156、198–199、245–246：brief最后一段、固定输入/manifest/ref/digest、旧marker不再混入新绑定 |
| scenarios/C3-not-entered-chain.test.ts | 98–101：最近实际进入祖先的brief正文和最后一段 |
| scenarios/C3-workspace-changed.test.ts | 77–84：工作区改变中文说明仍在brief与首request末尾 |
| scenarios/C3-paused-continue-brief.test.ts | 130–132：未消费steer全文进入新首轮输入 |
| scenarios/C3-reply-other-session.test.ts | 142–144：REPLY_HEAD/TAIL每轮仅一次且全文；171、211–215：跨Session历史body与OTHER_TEXT不混淆 |
| scenarios/A7-control.test.ts | 302–303及STEER_TEXT断言：暂停无额外model、恢复后实际steer输入；取消后不再输入 |
| scenarios/A7-control-goal29.test.ts | 88：A7-G4 with history首请求保留RUN0_TEXT，排除被中断Turn |
| scenarios/A4-duplicate-receipts.test.ts | 377–378：A4（控制、发信、核对）首请求STEER/MESSAGE各一次，lost answer/replay不重复输入 |
| composition/A2-requeue-platform.test.ts | 324–325/540：首领取无brief、requeue后原marker进入model；556/592：原operator mail进入首轮/接续；prepare/rebind固定原brief |
| scenarios/C5-gate-fix.test.ts | 118：新fix task首model输入不带原gate的continuation marker |
| scenarios/A8-host-restart-entry.test.ts | 134、402、444：新Run首轮携固定brief marker |
| scenarios/A8-host-restart-paused.test.ts | 214–216、238–263、357–363、675–678：原completed历史、brief/中断文字、seed边界；未完成工具不带入 |
| scenarios/A8-host-restart.test.ts | 304：Kernel接受的A8 steer文本 |
| state/invariants.ts（由invariants.test.ts/invariants-fuzz.test.ts执行） | 1814–1815：I-19原brief suffix/marker恒真；不修改invariants收窄规则 |

上表32个测试文件含纯context/guide/工具交回模型文本；最后一行是由两个测试文件执行的共享assertion，必须两者通过。`A11-no-progress`、state/no-progress/run-machine/query-run-recovery等对inputDigest/newInputs的断言是**版本/状态**测试，另作为兼容回归保持，不冒充提示词文本断言。UI草稿/Markdown/消息正文断言不属于模型上下文，保持原测试也不在本片重写。

### 5.13 检查范围与两阶段

阶段一：仅本文新11个测试文件及新增纯接口/骨架；按表断言正式结果，STOP交lead中审，冻结tests内容/hash和case数字。阶段二不改冻结测试。根package.json已核对：test=vitest run --maxWorkers=1；以下是完整点名清单（新11文件、旧文本34文件含两个invariants入口、额外回归16文件，无重复）。架构/类型先跑，新增检查通过后只跑这些有关的旧文件，再构建，不扫描整个tests目录。当前216文件/5245项是历史全量基线，本次没有运行。

```bash
npm run typecheck
npm run check:architecture
npm test -- tests/state/context-input.test.ts tests/work-graph/S3-context-inputs.test.ts tests/work-graph/S3-graph-context.test.ts tests/work-graph/S3-prepared-context-admission.test.ts tests/work-graph/S3-role-profiles.test.ts tests/runtime/S3-context-assembler.test.ts tests/runtime/S3-graph-tools.test.ts tests/app/S3-attention-context.test.ts tests/app/S3-graph-routes.test.ts tests/scenarios/S3-context-and-inputs.test.ts tests/scenarios/S3-query-graph.test.ts
npm test -- tests/runtime/B1-kernel-assembly.test.ts tests/runtime/B2-runtime-execution.test.ts tests/runtime/C2-runtime-platform-tools.test.ts tests/runtime/W2-role-skills.test.ts tests/app/AG6-agent-assembly.test.ts tests/kernel/R4a-frozen-public.test.ts tests/work-graph/R5b-initial-plan.test.ts tests/runtime/R5b-query-session-loop.test.ts tests/app/AG2-consultation.test.ts tests/app/AG2b-collaboration.test.ts tests/app/orchestration-mechanism.test.ts tests/runtime/orchestration-boundaries.test.ts tests/runtime/R4c-session-continuity.test.ts tests/runtime/R4-control-runtime.test.ts tests/runtime/R2e-git-source-loop.test.ts tests/runtime/source-text-loop-migration.test.ts tests/contracts/A2-rework-contract-helpers.test.ts tests/runtime/C3-brief-timeline.test.ts tests/scenarios/A1-rework-same-session.test.ts tests/scenarios/C3-brief-idempotency.test.ts tests/scenarios/C3-not-entered-chain.test.ts tests/scenarios/C3-workspace-changed.test.ts tests/scenarios/C3-paused-continue-brief.test.ts tests/scenarios/C3-reply-other-session.test.ts tests/scenarios/A7-control.test.ts tests/scenarios/A7-control-goal29.test.ts tests/scenarios/A4-duplicate-receipts.test.ts tests/composition/A2-requeue-platform.test.ts tests/scenarios/C5-gate-fix.test.ts tests/scenarios/A8-host-restart-entry.test.ts tests/scenarios/A8-host-restart-paused.test.ts tests/scenarios/A8-host-restart.test.ts tests/state/invariants.test.ts tests/state/invariants-fuzz.test.ts tests/architecture/boundaries.test.ts tests/architecture/state-writes.test.ts tests/architecture/production-reach.test.ts tests/work-graph/R3g-role-spec.test.ts tests/work-graph/B2-execution-entry.test.ts tests/work-graph/C2-mailbox-admission.test.ts tests/work-graph/R5b-query-execution.test.ts tests/runtime/R4c-graph-history.test.ts tests/runtime/R4c-execution-history.test.ts tests/runtime/source-tool-lifecycle.test.ts tests/runtime/W2-whiteboard-tools.test.ts tests/composition/AG1-session-discovery.test.ts tests/state/run-machine.test.ts tests/state/query-run-recovery.test.ts tests/state/no-progress.test.ts tests/scenarios/A11-no-progress.test.ts
npm run build
```

本规格写作阶段没有可用PATH中的node/python/rg，没有运行产品测试；阅读使用PowerShell Select-String/Get-Content，源码未改。本片未来施工在标准Node24/Linux或WSL环境执行冻结清单。T选项、文件清单和数字冻结后才生成DSH任务书。

## 6. 将来施工文件清单与跨片碰撞

下表是完整建议改动集；`+`新建、`~`修改、`-`删除。跨片栏指1/5最可能共同编辑（本片为3）。无授权扩大任何其它文件；本次只新建本文。

| # | 动作 / file | 模块 / 子模块 | 跨片 |
| --- | --- | --- | --- |
| 1 | + src/contracts/graph-context.ts | Contracts | 1、5须共同冻结DTO接缝 |
| 2 | ~ src/contracts/core/prepared-execution.ts | Contracts | 1的brief字段同文件 |
| 3 | ~ src/contracts/role-spec.ts | Contracts | 5读duty |
| 5 | + src/core/work-graph/model/graph-context-contracts.ts | WorkGraph/model | 1、5注入只读facts |
| 6 | + src/core/work-graph/model/context-input-contracts.ts | WorkGraph/model | — |
| 7 | + src/core/work-graph/state/context-input.ts | WorkGraph/state，纯 | 5 duty权限要同定义 |
| 8 | + src/core/work-graph/tasks/context-input-service.ts | WorkGraph/tasks | 5 decision application接缝 |
| 9 | + src/core/work-graph/views/graph-context-reader.ts | WorkGraph/views，新声明 | 1 anomaly、5设置投影 |
| 10 | ~ src/core/work-graph/tasks/execution-entry-service.ts | WorkGraph/tasks | 1新brief准入 |
| 11 | ~ src/core/work-graph/queries/query-execution.ts | WorkGraph/queries | 1归档停止Query |
| 12 | ~ src/contracts/validation/role.ts | Contracts/validation；沿既有configuration codec调用 | 5读取duty，不另复制 |
| 13 | + src/core/agent-runtime/role-profiles.ts | AgentRuntime | 5只消费同配置 |
| 14 | + src/core/agent-runtime/context-assembler.ts | AgentRuntime | 1异常brief字段 |
| 15 | + src/core/agent-runtime/graph-tools.ts | AgentRuntime | — |
| 16 | ~ src/core/agent-runtime/execution-contracts.ts | AgentRuntime | 1归档依赖 |
| 17 | ~ src/core/agent-runtime/ports.ts | AgentRuntime | 1新增Runtime操作 |
| 18 | ~ src/core/agent-runtime/runtime.ts | AgentRuntime | 1装配操作 |
| 19 | ~ src/core/agent-runtime/execution-preparation.ts | AgentRuntime | 1 prepare异常brief |
| 20 | ~ src/core/agent-runtime/query-preparation.ts | AgentRuntime | 5之后query协议消费 |
| 21 | ~ src/core/agent-runtime/execution-driver.ts | AgentRuntime | 1归档interrupt |
| 22 | ~ src/core/agent-runtime/query-execution.ts | AgentRuntime | 1Query取消/退出 |
| 23 | ~ src/core/agent-runtime/session-discovery-tools.ts | AgentRuntime，旧读adapter保留 | — |
| 24 | ~ src/core/agent-runtime/whiteboard-tools.ts | AgentRuntime，旧读adapter保留 | — |
| 25 | ~ src/app/runtime-configuration.ts | Host composition/config | 1、5 profile配置 |
| 26 | ~ src/app/host.ts | Host | 1自动归档、5投影装配 |
| 27 | ~ src/app/attention-observer.ts | Host | 0先完成；不再重复它 |
| 28 | ~ src/app/core-routes.ts | Host | 1、5新增route/shared union |
| 29 | ~ src/app/core-http-types.ts | Host/HTTP契约 | 1、5新增suffix |
| 30 | ~ src/composition/create-platform.ts | composition | 1、5同root和schemas装配 |
| 33 | ~ tests/architecture/production-reach-allowlist.json | 边界：只删本片真实接通的角色条目（`kept-for` slice 3），见任务书规则 | 5 |
| 34 | + tests/state/context-input.test.ts | state单测 | — |
| 35 | + tests/work-graph/S3-context-inputs.test.ts | tasks，M/S | — |
| 36 | + tests/work-graph/S3-graph-context.test.ts | views，M/S | — |
| 37 | + tests/work-graph/S3-prepared-context-admission.test.ts | tasks/queries，M/S | — |
| 38 | + tests/work-graph/S3-role-profiles.test.ts | configuration，M/S | — |
| 39 | + tests/runtime/S3-context-assembler.test.ts | Runtime | — |
| 40 | + tests/runtime/S3-graph-tools.test.ts | Runtime | — |
| 41 | + tests/app/S3-attention-context.test.ts | Host | — |
| 42 | + tests/app/S3-graph-routes.test.ts | Host | — |
| 43 | + tests/scenarios/S3-context-and-inputs.test.ts | 跨模块场景 | — |
| 44 | + tests/scenarios/S3-query-graph.test.ts | 跨模块场景 | — |

【lead 改】草稿的第 4、31、32 行已删（C1）；第 45–50 行（`module-target.json`、`module-dag.md`、STATE-MACHINES-SPEC、能力索引、HANDOFF、STATUS）移出 DSH 写范围（C3）：`views` 的声明在 B0，其余文档由 lead 验收后同步。行号不重排。冻结的写范围是上表剩下的 41 行，加下面第 51 行，共 42 行。

| # | 动作 / file | 模块 / 子模块 | 跨片 |
| --- | --- | --- | --- |
| 51 | + src/contracts/platform-duty.ts | Contracts | 【lead 改：C4】共用的 `PlatformDutyV1`，原文见 README“共用文件”，逐字节相同；1、5 |

`continuation-brief-assembly.ts`不在改动集：复用其纯推导，不为合并入口重写正确的Kernel解析/历史规则。`state/run-machine.ts`、`state/query-run-recovery.ts`也不需要改变next构造，原转换通过freshAdmission/原prepared校验接入新的pureguard；若lead要求在事件载荷新增guard fact，再更新这两文件和清单后冻结。`session-discovery-tools.ts/whiteboard-tools.ts`建议只加deprecation文档注释，导出/行为不改；T5选委托实现则先补写旧返回shape的精确映射，不让DSH凭感觉清理。

【lead 改】冻结的写范围是 42 个路径：源码 30（新建 10、修改 20），allowlist 修改 1，新测试 11（§0.6）。下面是草稿原文：将来实施建议集50个路径：源码32（其中新增9、修改21、删除2），测试新增11、已有allowlist修改1、文档6。数字以此50行分类复算，施工前可根据T1–T8一次收紧，不可在实现中增隐性文件。证据只追加到已有批次结构，不另造事实体系；如果lead指定新的本片证据目录，须先明确逐文件清单，再纳入任务书。

## 7. lead 必须冻结的技术选择

这些是实现取舍，不重新决定用户行为。上文按推荐写接口；选其它选项就先改本规格/清单/测试，再发DSH，不让它自行折中。

| id | A | B | 推荐及影响 |
| --- | --- | --- | --- |
| T1 消费版本保存 | 准备保存manifest；look保存原Kernel tool.result，没有新aggregate | 每次look新增immutable TaskInputConsumption +索引/event/receipt | 【lead 定：A】A。已有原历史保存版本足够，避免第二账本；必须scenario证明原工具结果可读、source未丢 |
| T2 极小预算/稳定前缀 | 四段全局最长可装前缀；结构全计费；过小B时提示移到必需卡 | 按段保留独立配额，过小B同样把提示移到必需卡 | 【lead 定：A】A。固定顺序容易复现；两者均保留AMB-38必要内容且可选residentBytes≤B，不用token估算 |
| T3 段头 | 沿本文现有`##`风格，原brief suffix原样 | MODEL的`[role]`等段名作为外层 | 【lead 定：A】A。原关键正文保留，少改变诊断/人工可读习惯；两者都不得把动态文字放system |
| T4 职责存在哪里 | RoleSpecContent可选platformDuty + Host选择匹配的版本化legacy profile ref | Host独立map<RoleConfigurationRef,duty>，WorkGraph通过注入读 | 【lead 定：A】A。第5片可从同一Role事实核权；旧正文不填默认，digest不变；不从skills猜；Host不能override已固定Role的duty |
| T5 旧adapter兼容 | 留原实现/export，只文档标deprecated，新grant用look/find | 留原名称/export，将旧只读实现转委托新的读模型并保持原返回shape | 【lead 定：A】A。较少改动；B也必须让已绑定Run和显式旧caller的输入/返回/拒绝不变，不能删旧tests |
| T6 自由label产物 | 当前无正式label关联就missing并列upstream facts；只支持已有明确来源 | 通过composition注入可信Kernel显式产物ref适配，仍核声明/owner/label，不读任意模型文字 | 【lead 定：A】A。当前没有产物注册契约，避免本片增新写协议；明确技术限制、不能宣告自由label全部可自动定版本 |
| T7 新views | 声明views，复用owners和窄extensions函数 | 全部读逻辑放Runtime，通过现有owner端口拼卡 | 【lead 定：A】A。符合DESIGN §7.2，重复读和scope规则收在WorkGraph；类型不能反向importowner上层 |
| T8 Kernel图结果上限 | 沿旧64KiB定义，adapter在完整JSON>48KiB时显式capacity，要求小页/下钻 | 工具定义256KiB、adapter阈值192KiB，其余分页/拒绝规则同A | 【lead 定：A】A。沿已存在的Kernel/adapter大小约定；B提高读取成本。两者都必须不输出截断ready JSON、不改变节点状态，HTTP card不跟着缩掉 |

needs the user：**没有新的阻挡性user-visible gap**。AMB-37/38已定，不再把预算或“历史/当前”选择退回用户。第1片异常锚点呈现文字和第5片自动返工通知是HANDOFF明确“lead做法，用户可改”；本片只按他们最终正式投影读，不在此重新批准。自由标签暂无唯一产物关联对应 DESIGN §2.8 原文“对不上或有几个候选，就把上游的状态和产出列给 agent，由它判断”，本片返回missing/ambiguous即可；如果lead想改成自动发布/标记产物的新用户流程，先列该设计原文和新增行为问用户，不能悄悄加入本片。

## 8. 实施顺序、规模与风险规则

### 8.1 按 §15 的实现顺序

1. 切片0已完成，锁基线；lead冻结T1–T8、shared DTO与1/5的接口，核对所有文件/测试数字。
2. DSH阶段一仅pure DTO/校验骨架、读port/工具接口、新11测试；实现缺口按UNSPECIFIED报告；停止。lead审定测试期望和跨片碰撞，冻结hash。
3. DSH阶段二按Contracts→state pure guards→tasks inputs→views reads→assembler→两个driver注册→Host/routes顺序实现；不改freeze测试。写owner最后接入manifest准入，保持原回执优先次序。
4. 用列举清单检查schema/allowlist/exports/路径方向、旧文本回归、新scenario；lead只读找问题，反馈file:line/违反哪条规则/思路，DSH一轮有界返工。
5.独审与必要验收；记DSH和lead各自调用/token/墙钟（等候单列）。真实模型需要额外授权；本片scripted通过不等于整个MVP完成。不提交/推送真实checkout，除非后续任务明确授权。

DSH任务书引用本规格时必须同时带§6逐文件写范围、§5逐case精确期望、下列规则、点名检查命令与报告四段`FILES CHANGED / CHECKS / UNSPECIFIED / NOTES`。禁止git add/rm/checkout/restore/stash/reset/commit/push；施工副本内指定草稿目录，用完删除；不可写用户本机服务/凭据/外部工作树。遵守DSH-WORKFLOW §6，不要只有“遵循惯例”或大约数量。行数估计不作为机械检查精确数字，文件数/case数冻结后才是精确授权。

### 8.2 规模估计

按推荐方案预计生产代码新增/实质修改1600–2400行（assembler/renderer约500–700，tasks resolver300–450，views400–600，tools200–300，其它type/接线200–300）。【lead 改：C1】两个 pin 文件已在 7e0b7f56 删除，不再计入；生产代码净增加约 1600–2400 行。新测试约1400–1900行；文档同步约100–200行。本文行数不计入未来生产代码规模。

建议改动50路径；新测试11文件；服务memory/SQLite双跑；两场景。不追加非阻塞的全产品E2E/真实模型/大规模性能测试；现有完整产品缺口仍保留。新case总数和展开数见§5，lead发任务书前须独立复算，发现差异更新本文，不让DSH猜。

### 8.3 DSH最容易错的地方：逐条可核对的规则

- 历史版本≠当前有效。所有上游材料读必须显式historical_explanation，不能接source pin或重新启材料授权。当前代码要靠读工作区，Workspace revision不是源码hash。
- 先验声明再内部Host读取。跨scope与未声明ref不得开正文；candidateKey不是任意ArtifactRef注入口；materials不得依赖tasks；tasks不得依赖communication/evidence/Runtime。
- source/body/hash与display分开。256KiB manifest硬上限保留；4KiB仅四段软装载预算。义务、验收、role、goal、brief不裁；可选行不够全项省略并提供可回读定位。
- exact Artifact 声明要比较完整 canonical ref，包括 source；`material-access.ts:sameArtifactRef` 只比contentType/digest/sizeBytes，不能单靠它核声明。legacy 的显式跨Goal输入只要是已采用声明且同project/workspace可读，不能额外要求owner.goalId=consumer.goalId；consumer/plan/边upstream仍必须归属其正式Goal。allowedDeclarations由owner重新推导；legacy的upstream是核canonical owner后派生，不与原Plan里不存在的字段机械比较。
- Same facts means same bytes。时间/random id/locale/机器换行不能进入装配；新inputDigest/bodyDigest不可混用；已绑Run/Query绝不重装；新tool读取记录其自己的source版本，不更改原binding。
- Query图工具要注册、要授予、要被Query owner再核对三步同时完成。只移除FORBIDDEN名字会留下空工具；只注册不会获得权限。readOnly built-in检查原样，扩展只注入两个read_only工具。
- Query读Session还有owner接缝：原SessionDirectory拒query_run。只在views核canonical Query绑定和原submission initiator后，为这两个只读Session方法构造同scope内部Host；不把Host context交给模型，不用system actor代替真实initiator，不放宽原Session写协议。
- 执行/历史读取也有Host-only接缝：views先核canonical Work/Query绑定才调用原执行reader；RT8由driver窄代理先核原tool身份的Run card再调原Host读路径。禁止通过放宽原owner为“任何principal都能读”完成接线；三个context的scope/signal/actor必须逐项测试。
- 行为与数据版本正交。缺输入/歧义/省略/扩展未实现都不是blocked/failed/satisfied；Run ended不等于输入可用/Task通过；上游PASS选择必须沿适用链头，不能捞历史PASS覆盖新FAIL。
- 原接续规则保留。C3只用原renderer，永远最后；不删acceptedInputs去重、same-session历史边界、未进入祖先规则、standings；异常锚点只能来自第1片正式投影。
- 注意力去重是两条水位。sent之后Delivered，真正消费之后Processed；图读取失败unknown，不是空图；省略计数代表可下钻详情，不能无限重投或换targetSession。
- Role旧digest兼容不能填默认后再hash。platformDuty独立于技能，多skill不是运行中换Role；profile生成/install不等于启动Agent；五Role不默认全启。
- 新纯函数只importContracts。DTO在Contracts、端口在model；views一出现就声明路径/依赖。private helper纯校验可以放state，但不能在owner自己写保护字段；原next仍state构造。
- 错误不能“绿色化”。not_ready、unavailable、缺索引、部分候选与真正empty分开；read结果保持原code，未实际通过检查不写PASS。目录/查询分页只运行点名范围，不靠扩大测试掩盖漏项。
- 旧测试不是可调整的产品文案。§5.12原文本断言保留，新format可以添加信息，但不能通过删question/assignment/Skill/brief/原history或改assertion来全绿。

## 9. 发任务书前的冻结核对

lead需确认：T选项；§2/4的Contracts DTO和nullable attention goal接缝；T2的极小预算计费算法；T6的正式label候选支持边界；Query读Session及Work/Query执行/历史桥接核验与原initiator；现存shape validators接受可选字段而旧bytes不变；共享旧测试清单与准入guard顺序；§5的116语义case/168展开项和§6的42文件精确清单（【lead 改】见 §0.6）。上述都是review可具体修改的项，不是要求用户再次批准已定行为。

本文交付只证明规格包已经写出。实施、DSH骨架/测试、中审、实现、独审、产品验收均尚未执行。
