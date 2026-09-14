# ContextCompiler

按消费者组装材料，处理来源、权限、版本及容量，并生成可消费正文。

## 源码入口

- [context-compiler.ts](context-compiler.ts)
- [runtime-context.ts](runtime-context.ts)
- [exploration-context-compiler.ts](exploration-context-compiler.ts)：直接前驱、正式审阅与来源版本选择；授权后从 Vault 读取实际输入
- [planning-context-compiler.ts](planning-context-compiler.ts)
- [review-context-compiler.ts](review-context-compiler.ts)
- [query-context-compiler.ts](query-context-compiler.ts)
- [work-context-compiler.ts](work-context-compiler.ts)
- [completed-work-context-compiler.ts](completed-work-context-compiler.ts)
- [handoff-context-compiler.ts](handoff-context-compiler.ts)
- [work-run-materials.ts](work-run-materials.ts)：派发时把工作身份与历史材料编译进既有 ContextBundle（RW-12），并按角色规格对**必读材料 fail-closed**（RW-15）

## 边界与接线

编译器入口存在不表示角色消费已经接通；实际执行输入从 runtime-context 追踪到 runtime。规划材料的请求、结果、拒绝码与端口统一定义于 `contracts/planning.ts`，实现与测试直接消费该协议，不再重复声明字段。

## 修改与验证入口

涉及职责或策略时读 [Module 规范](../../../../agent_learn/agent_dev/agent_platform/dev_docs/modules/data/context-compiler.md)。 完成状态与实施顺序统一看 [module-status](../../../../agent_learn/agent_dev/agent_platform/human/module-status.md)，本页不维护第二份状态表。

相关测试：[tests/context](../../../tests/context)。构建与测试命令以 [package.json](../../../package.json) 为准；WSL 前置与独立 runner 见 [产品 README](../../../README.md)。测试结果须说明真实 Adapter、模型夹具或外部模型的边界。

[material-selection.ts](material-selection.ts) 实现职责/主题排序、当前/历史区分、必需材料缺口、冲突与容量清单。RuntimeContext 已消费显式规则选择；其他角色完整接线仍待完成。最终模型输入计量由 runtime/model-budget 执行。

## RW-15／RW-17 角色必读材料的 gate 与真实通道（B2）

[work-run-materials.ts](work-run-materials.ts) 的桥表 `ROLE_MATERIAL_CHANNEL_V1` 是 **`Record<RoleMaterialKindV1, ...>` 全键穷尽**的：它逐键声明「角色要求的类别」由本派发入口的哪条通道供应。`ROLE_MATERIAL_KINDS` 新增一类而桥表缺键时，`npx tsc --noEmit -p tsconfig.json` 直接失败。

| 类别 | 通道 | 事实来源 |
| --- | --- | --- |
| `contract` | `contract` → 既有 `RuntimeContextMaterials.rules` | 本 Run 所在 PlanRevision 快照：任务、义务与验收要求、直接依赖、指派指令，以及计划固定的 CompletionPolicy／ArchitectureBaseline 精确 pin |
| `code` | `code` → `roleMaterials` 的 code 条目 | [role-source-index.ts](role-source-index.ts) **只消费**宿主注入的窄端口 `RoleSourceIndexPort`：把本 Run 已解析的范围（信封权限、claim 时工作区版本、上限、任务作用域的模块前缀）交给端口，把端口返回的有界条目与正文变成材料条目。工作区的列举／读取／路径边界**实现不在本 Module**：归 WorkspaceReader 的 `data/workspace-reader/role-source-reader.ts`，拒绝前缀只有 `data/workspace-reader/denied-prefixes.ts` 一个来源 |
| `evidence` | `evidence` → 既有 `evidenceRefs` 语义 + `roleMaterials` 条目 | canonical `TaskEvidenceIndex` 与已接纳 `Evidence`（逐条复核 subject 归属）；只索引，不把正文当已核验事实 |
| `decision` | `decision` → `roleMaterials` 条目 | 本 Goal 已落账的 `UserDecision`／`GoalRevision`：事件只作索引，canonical 聚合逐字段复核 |
| `history` | `history` | 既有已完成工作选材（CompletedWorkContextPort） |

每一类都在 manifest 里带 `selectedBecause` 与 `sourceRefs`（含版本），并逐类写进角色规格条目（`requiredMaterials[].selection／materialIds／sourceRefs`）。

判据**没有放松**：通道缺失／宿主未接线／越权（信封没有 `read`）／工作区版本已前进／索引与聚合不一致 → `needs_material`，在模型调用之前终止这次运行；而"本次范围内确定为空"（例如该任务首次运行、还没有已接纳证据）是**读到的确定事实**，写成材料与 gaps 的说明 —— 既不当成"未核对"，也不当成"已满足"。材料只有"参考"资格（`qualification: 'reference'`）：不授予权限、不改变 `manifest.permissions`、不构成完成判据。

证据：[tests/context/work-run-materials.test.ts](../../../tests/context/work-run-materials.test.ts)（逐类取材与 fail-closed）、[tests/context/role-code-channel.test.ts](../../../tests/context/role-code-channel.test.ts)（code 通道只消费窄端口：权限／版本／缺失判据都在消费面）、[tests/data/workspace-path-boundary.test.ts](../../../tests/data/workspace-path-boundary.test.ts)（拒绝前缀的唯一来源与真实工作区上的边界）、[tests/control/work-material-gate.test.ts](../../../tests/control/work-material-gate.test.ts)（装规格+矩阵后普通运行真的开始）、[tests/control/role-material-completion.test.ts](../../../tests/control/role-material-completion.test.ts)（运行开始 → 实现结果 → 轮次 PASS → Task satisfied）、[tests/app/role-material-run.test.ts](../../../tests/app/role-material-run.test.ts)（真实 HTTP 产品链）。

### 为什么「code」不再自己读工作区（施工历史，RC-02 归位）

RW-15（独立验收阻断项 B2）把「规格必读材料」做成如实 fail-closed：桥表里值为 `null` 的类别表示本入口**没有**这条通道，于是解析到规格后立刻返回 `needs_material`，在模型调用之前终止该次运行。这暴露了一个跨票缺陷：规格里真正会被派发的角色（executor／integrator）要求的必读材料**全部**落在这四类上，装上 executor 规格之后每一次普通运行都起不来 —— ADR 0003 D4-3 的「按规格取材」实际上没有兑现。

RW-17 为 contract／code／evidence／decision 四类接上真实、带来源与版本的通道。其中 `code` 的实现当时落在本目录（`role-source-index.ts`），而它做的是工作区列举、读取与路径边界适配——按 module-boundaries，那是 WorkspaceReader 应隐藏的实现（「路径边界、完整来源 pin、索引/工具适配、语言能力差异、来源更新判断」）。**RC-02** 因此把实现归位到 `data/workspace-reader/role-source-reader.ts`，让拒绝前缀收敛到 `data/workspace-reader/denied-prefixes.ts` 一处，本 Module 只留窄端口消费（权限与工作区版本的判据仍在消费面，见上表）。`role-source-index.ts` 里保留的一行再导出只是给写入范围之外的两个既有调用方用的兼容路径，退出条件写在文件头。
