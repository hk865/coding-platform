# R3b 材料读消费者、真实前置与退役清单

> 最终更新：R3b 材料功能、History Host 与真实 Run / Query 已通过[功能验收](R3b-sol-dsh-acceptance.md)并导入；H1/H2已切Host，以下其余旧wire退出批次仍未完成。两条legacy reader临时依赖另在验收/模块图列示。正文清单保留集成前定位基线，不能当作所有消费者已退役。

日期：2026-09-24。初次核对点：Raw / WorkGraph 材料组件经主审返修后已导入，`r3b-integration-sol-01` 的 7 文件真实接线仍在实施，本文不预标 R3b 完成。依据：[R3b 原计划](../refactor-plan.md#r3b--材料正文与普通-host-读取贯通)、[集成任务](../tasks/R3b-integration-dsh-execution.md)、[7 文件范围](../tasks/R3b-integration-dsh-write-scope.json)、[Sol 骨架与冻结测试](../tasks/R3b-sol-skeleton.md)。后续最终验收应在本清单逐项登记通过范围。

本批至少闭合 **History 的普通 Host 读取**及**真实工作 Run 的 ContextBundle 读取**，并将所有既有 ArtifactPort 调用统一导向同一套 WG 权限规则和 Store 正文算法。其余普通读取仍有 Reviewer、verification、Query 回答复核和 memory 路径；不能写成“全部普通材料读已迁”。旧方法名仍被真实消费者使用，与旧规则副本仍在执行是两件事，验收须分别核对。

## 1. 查找范围与复核方法

代码根 C：`/home/hyh001/projects/coding-platform/coding-platform`。本清单覆盖 C/src 中正式 Artifact 正文读取，以及这些读取的普通 Host、领域流程、模型输入调用者。不把 Workspace 文件/capture 读取、Kernel Session 日志、Ledger 结构查询或纯展示已有内联字段误算为 ArtifactPort 消费者。

对整个 C/src 检索 `.open(`、`openArtifact`、ArtifactPort / MaterialPort，再用现有 TypeScript AST 排除注释中的调用文字，确认这次主树核对有 **24 个直接 legacy 正文读取调用点，分布于 16 个文件**；其中包括容易漏掉的 `this.deps.vault().open(...)`。随后追踪 `openReport`、`openHistoricalReport`、`current`、`readPublishedFacts`、`queryFacts` 等间接入口，检查实际 Host 路由。这个数是消费者定位清单，不是代码规模复测；集成导入后行号可能移动，应以符号为准。

```bash
rg -n '\.open\(|\.openArtifact\(' coding-platform/src -g '*.ts' -g '!**/node_modules/**' -g '!**/dist/**'
rg -n 'openReport|openHistoricalReport|readPublishedFacts|queryFacts|new HistoryMaterialsContext' coding-platform/src -g '*.ts' -g '!**/node_modules/**' -g '!**/dist/**'
```

“当前”指该核对点的主工作树；“本批目标”指正在执行的批准任务，不能代替导入后的代码与独立测试证据。以下退出批次是现有计划的消费者分配，不扩展本轮 7 文件可写范围，不提前删除尚有真实消费者的兼容入口。

## 2. 普通 Host / 人工读取，包括间接读取

| ID / 实际入口 | 实际调用链与正文读取位置（均相对 C/src） | 当前 legacy wire / 本批处理 | 退出批次与真实前置 |
| --- | --- | --- | --- |
| H1 历史材料列表、授权前可读性检查 | `app/service.ts` 的 `/api/real/history/view`、`/grant` → `HistoryMaterials.view/grant` → [HistoryMaterialsContext.available](../../../coding-platform/src/data/context-compiler/history-materials-context.ts)（核对时32行）；按候选 `item.owner` 调 `vault.open(includeOwner)` | 当前借已存在的 owner 身份核对正文；本批改为可信 Host MaterialPort，保留 canonical owner / 完整 ref / 项目与工作区检查。grant 动作仍独立受理正式授权 | **R3b 本批**；依赖已验收 Raw/WG、可信 scopeOf、固定 Host actor，以及首 owner 回传；R6c 删除无消费者旧兼容分支 |
| H2 历史材料正文 | `/api/real/history/read` → `HistoryMaterials.read` → [HistoryMaterialsContext.read](../../../coding-platform/src/data/context-compiler/history-materials-context.ts)（58行）；当前以 `grant.reader` 读正文 | 本批改 Host port；页面 grant 的 exact scope、revision=1、history、未撤销、currentBasis 与显式跨工作区人类授权仍保留，I/O 后再次检查。普通读不新建 Run，不采用 JSON actor | **R3b 本批**；真实 GUI 关闭重开与 Host spy 两项验收，拒绝/过期不能降级为成功；R6c 最终消除旧参数兼容 |
| H3 独立 Reviewer 原始报告显示 | [app/service.ts](../../../coding-platform/src/app/service.ts) `/api/real/verifications/reviews/report` → `verifications.review` → [ReviewerContext.openHistoricalReport](../../../coding-platform/src/data/context-compiler/reviewer-context.ts)（275行） | 仍以已记录 reviewerRunRef + historical usage 调 ArtifactPort。R3b 后底层可统一 WG，但该普通页面尚未改成 Host MaterialReader | **R3e / R5b**；正式 ReviewWork/output/原始报告关联、独立审查规则与当前/历史显示语义迁完；R6c 退役旧 Context 出口，历史真实 Run 仍作为来源关系保留 |
| H4 Reviewer 状态页的隐含正文读取 | `/api/real/verifications/reviews/read`，以及 `/report` 的前置 `review` → [ReviewerVerification.view](../../../coding-platform/src/control/verification-engine/reviewer-verification.ts) → `ReviewerContext.current/recovery` → `assertProducerCollaboration`（[reviewer-context.ts](../../../coding-platform/src/data/context-compiler/reviewer-context.ts):88） | 状态查询并非只读 Ledger：会按 producerRunRef 打开原工具报告，核对协作事实。与模型选材共用 currentness 逻辑，不能仅迁 `/report` 就漏报此消费者 | **R3e / R5b**；保留 canonical Work/Run、协作事实、来源当前性和恢复资格；迁到共同核心只读判据，再由业务决定显示/恢复；R6c 清旧出口 |
| H5 验证检查报告正文显示 | `/api/real/verifications/check-report` → `VerificationService.checkReports` → [CommandCheckLifecycle.checkReports](../../../coding-platform/src/control/verification-engine/command-check-lifecycle.ts)（295行间接）→ [VerificationContext.openReport](../../../coding-platform/src/data/context-compiler/verification-context.ts)（501行） | 用 scope 中既有 RunRef 读已记录结果/中断后已保存的报告；不是新执行。R3b 后保留该 legacy 参数入口，底层规则统一 | **R3e / R5b**；检查轮次/报告绑定与 journal 兼容迁移、requested/observed/结果分离；显示读取得到 Host 身份后仍核对准确报告来源；R6c 清旧出口 |
| H6 验证轮次显示、Reviewer 材料描述页 | `/api/real/verifications/rounds/read` → `VerificationRounds.view` → `originalReport` / 聚合报告读取；`/api/real/verifications/reviews/material` → `reviewMaterial` → `reviewDescriptor`。两者最终走 `VerificationContext.openReport`；见 [verification-rounds.ts](../../../coding-platform/src/control/verification-engine/verification-rounds.ts) 的177/412/547行附近 | 多处只是间接调同一个正文 reader，不能因没有 `vault.open` 字面量而漏记。完整工具集合与摘要检查属于领域校验，不应因新 MaterialPort 出现就复制一遍 | **R3e / R5b**；正式 Evidence/RoundSnapshot、覆盖与来源判据、历史 journal reader。R6a 接共同只读 DTO，R6c 删除旧重复组装 |
| H7 查询引用的普通复核“查看” | `/api/real/queries/review/view` → [query-answer-audit-entry.ts](../../../coding-platform/src/app/query-answer-audit-entry.ts) `prepare`（43行）→ `QueryExecutionContextCompiler.readPublishedFacts` → `compile(published=true)` → [query-execution-context.ts](../../../coding-platform/src/data/context-compiler/query-execution-context.ts)（73行） | 没有启动复核模型也会读已发布 Query bundle；沿真实已回答 QueryRunRef 读取，并重建/核对输入 digest 和引用 pointer。`/start` 复用这条取材链后才执行模型。不能把此普通入口遗漏或称已改 Host reader | **R5b** 负责回答复核流程；与 **R4c / R5a** 的 Query 真实执行/输入接线共用材料读能力。前置：正式 answered binding、引用版本、输入/偏好适用性，不复制第二套 compile；R6c 退役旧总门面 |
| H8 间接事实/可用性查询 | [VerificationService.queryFacts](../../../coding-platform/src/control/verification-engine/verification-service.ts) → `round` / `review`，复用 H4/H6。`app/service.ts` 的 `humanActionFacts`、`verificationFacts`、QuerySource currentness 及回答复核可用性会消费这些事实 | 事实查询可能间接读工具/Reviewer 正文。现有 h.query 查询链或 UI 展示消费时仍走相同 legacy reader；应合并到一个领域事实/适用性实现，不能为 Host 与模型各开一套规则 | **R3e / R5b** 迁核心证据与事实规则，**R5a / R6a** 接查询与展示；前置同 H4/H6，加范围/版本/水位与取消；R6c 清零 |
| H9 人工记忆导入/记录经验中的精确正文读 | `/api/real/memory/project/import-note`、`/record-experience` → [app/memory.ts](../../../coding-platform/src/app/memory.ts) `projectMemory.action`（132行），按 `note.runRef` 调 `notes.vault.open` | 这是人类操作中的材料读，仍使用原 ExecutionNote 的 Run 身份；`record-experience` 还先保存正文和正式 note。不能因它不是纯 GET 就排除普通 Host 消费者。当前本批不改此文件 | **R3g** 迁角色/有限记忆与普通读取规则；需要 ExecutionNote 完整关联、治理 witness、sourceDigest、正文一致性与请求幂等；业务装配接 R5a，R6c 退役旧出口 |

H3–H9 仍待按上述批次迁移。它们当前引用的是已存在的 Run/QueryRun；本清单不声称这些入口创建了假 Run，也不将保持历史来源关联误写为应删除 RunRef。要退出的是“用执行读取协议承担普通 Host 权限”的责任混合。

## 3. 模型输入与执行消费链

| ID / 真实路径 | 直接正文消费符号与核对位置 | 当前 wire 与 R3b 边界 | 退出批次 / 必须保留的前置 |
| --- | --- | --- | --- |
| M1 普通工作 Run 最终输入 | Runtime → [runtime-context.ts](../../../coding-platform/src/data/context-compiler/runtime-context.ts) `assembleRuntimeContext`（105行） | `access.vault.open(envelope.bundleRef,{requesterRunRef:envelope.runRef})`。**R3b 本批必须通过真实 Run bundle 回归确认它经薄 ArtifactPort 到 WG/Store**；不改 TaskEnvelope/来源断言、不假造 work_run RoleBinding | R4c 接统一 Runtime 与 Session，占用真实；R5a/c 迁材料需求/旧 Context 出口；保留 bundle ref/digest/size/sources/预算/角色/权限校验；R6c 最终退役 |
| M2 Query 最终输入、运行中事实工具 | `ReadOnlyQueryRuntime.startQuery` → [query-execution-context.ts](../../../coding-platform/src/data/context-compiler/query-execution-context.ts) `assemble/compile`（73行）；`readFact` 同源。发布后普通读取为 H7 | `this.deps.vault().open(bundleRef,{requesterRunRef:QueryRunRef})`。R3b 保留精确 Query 身份与授权，不能转造普通 Run；真实 Query 执行路径应定点回归，单纯 fake raw/grant 合约不等于此链验收 | R4c 统一 Query 执行/占用，R5a/b/c 按普通查询、复核、总门面用途退出；前置 canonical QueryJob/QueryRun running/answered、固定执行 binding、来源/输入 digest |
| M3 Query 输入中的执行反馈报告 | [query-context-compiler.ts](../../../coding-platform/src/data/context-compiler/query-context-compiler.ts) `assembleQueryContext`（70行） | 以真实 request.runRef + currentBasis + current usage 读取原反馈报告；材料仍通过同一 legacy wire | R5a/b（反馈与业务编排），R4c Query 驱动；前置当前 Goal/Plan/Workspace、正式反馈/decision 关联和精确 grant；R6c |
| M4 普通 Run 角色、工作留痕、历史选材 | [work-run-materials.ts](../../../coding-platform/src/data/context-compiler/work-run-materials.ts) `loadWorkIdentityAndNotes`（450行）、`selectHistory`（753、809行） | 读取 WorkContextBundle、已完成工作选择正文、ExecutionNote 正文；owner/currentBasis/history usage 仍用 ArtifactPort。相同历史可能供 Host H9 读取，但不可复制选择/授权算法 | R3g 角色/记忆规则，R5a/c 拆需求选择/材料读取/输入格式；前置角色准入、工作身份、限定选材、note 适用性；R4c 接真实执行；R6c |
| M5 普通任务直接前驱 | [ordinary-predecessor-materials.ts](../../../coding-platform/src/data/context-compiler/ordinary-predecessor-materials.ts) `assemble`（106行），由 WorkMaterialDrive 调用 | 真实 consumer Run + currentBasis 读 evidence/review/tool 正文；仍经薄 ArtifactPort | R3c 任务资格、R3e 正式证据；R5a/b/c 迁业务与 Context；保留直接前驱、完整要求、正式结果/来源匹配，R6c |
| M6 探索前驱与分块材料 | [exploration-context-drive.ts](../../../coding-platform/src/control/dispatch-engine/exploration-context-drive.ts) `assemble`（57行）读 manifest 后授予 chunk；[exploration-context-compiler.ts](../../../coding-platform/src/data/context-compiler/exploration-context-compiler.ts) `assemble` 内局部 read（119行）读 manifest/chunks/review | 都使用实际 exploration Run 与同一 currentBasis；grant 成功才暴露正文。Raw/WG 归并不能删除分块来源与摘要复核 | R5a/c 迁探索策略/总门面；R3c/e 前驱与证据，R4c 统一执行；R6c |
| M7 用户反馈与补充执行 | [feedback-materials.ts](../../../coding-platform/src/data/context-compiler/feedback-materials.ts) `assemble`（127行）；[execution-feedback-context.ts](../../../coding-platform/src/data/context-compiler/execution-feedback-context.ts) `prepareDecision`（85行） | 前者以当前执行 Run 读回答材料；后者按原反馈 f.runRef 读取，供已应用人工决定后的后续查询准备，属于业务输入准备而非纯显示 | R5a/b，随后 R5c 清 Context；前置正式 UserDecision、当前 Plan/Workspace/source pin、已回答 Query 与精确绑定；R6c |
| M8 消息投递正文与执行前重核 | [delivery-materials.ts](../../../coding-platform/src/data/context-compiler/delivery-materials.ts) `assemble`（142行）、`assertCurrent`（191行） | 相同 Run/currentBasis 调 ArtifactPort；后者在 provider 边界重核已固定材料，不是另一次自由选材 | R3f 通信、R4c 执行、R5c 等待/唤醒与 Context 退役；前置正文引用/投递/阅读语义、来源 pin 和撤权；R6c |
| M9 等待/替代完成报告 | [alternative-report-materials.ts](../../../coding-platform/src/data/context-compiler/alternative-report-materials.ts) `observe`（50行） | 用真实 wait predecessorRunRef/currentBasis 读取；保留等待记录所指原始报告 | R3f、R4c、R5c；前置原等待/唯一后继/正式报告关系，R6c |
| M10 Reviewer 当前原工具材料、输入 packet | [reviewer-context.ts](../../../coding-platform/src/data/context-compiler/reviewer-context.ts) `assertProducerCollaboration`（88行）、`openMaterial`（188行）、`packet`（236行） | 内部 producer 协作核对、实际 reviewerRunRef 的 exact grant 读取和原 packet 读取分别保留。`assemble` / `readMaterial` / `runtime` 共用这些方法；模型工具 `reviewer-material-tools.ts` 经注入 reader 到 `readMaterial`，不另开 raw store | R3e evidence、R4 公用执行、R5b 独立 Reviewer、R5c 总门面；前置完整冻结索引、readonly Profile、producer/reviewer 独立身份、packet/source/descriptor digest，R6c |
| M11 Reviewer 输出受理及核对 | [reviewer-dispatch.ts](../../../coding-platform/src/control/dispatch-engine/reviewer-dispatch.ts) `driveOne`（128行）存后读；[reviewer-context.ts](../../../coding-platform/src/data/context-compiler/reviewer-context.ts) `openReport`（266行）供 ReviewerVerification assessment | 实际 reviewerRunRef / includeOwner；R3b 只替换下面的共同存储/授权算法。H3 原始历史展示共享输出关联，不能另建一条报告业务链 | R3e 正式证据/完成、R4 driver、R5b 评审与返工；前置真实终态、独立 Session、输出绑定与正文一致，R6c |
| M12 真实检查/完成归约内部报告读取 | [verification-context.ts](../../../coding-platform/src/data/context-compiler/verification-context.ts) `openReport`（501行）被 `command-check-lifecycle.ts`、`readonly-report-check.ts`、`verification-rounds.ts` 消费 | 此共享入口既服务 H5/H6，也服务已存检查结果、聚合、对账、证据受理。按实际 owner 读，不能为每个新 Port 再拷贝一套报告解释与完成判断 | R3e 迁领域/关联，R4 迁执行，R5b 迁检查/返工流程；前置全部必需检查、真实来源/配置/命令/Run 身份、missing/stale/interrupted 处理，R6c |

同一直接调用点可以被普通查询和执行路径同时到达，例如 Query `compile`、Reviewer `current`、Verification `openReport`；H/M 表重复引用这些节点是调用关系说明，不应相加为新的消费者数量。

## 4. 不是正文读消费者的相关入口

- `VerificationService.checkReportMaterials` 只从 journal 生成候选目录，不自行读取正文；H1 的 `available` 才读取候选。不能拿目录里有 ref 当作正文已经可读。
- `planning-context-compiler.ts`、`coordination-context-compiler.ts`、`review-context-compiler.ts`、`handoff-context-compiler.ts`、`work-context-compiler.ts`、`completed-work-context-compiler.ts` 等虽然持有 ArtifactPort，但本次直接调用核对主要是组装/保存 bundle，后续读者在 M1/M2/M4 等。它们仍属于 R5c 的旧 Context 退出清单，不因没有 `.open` 就视为已退役。
- `ExplorationMaterialReader.read` 直接读取旧 plan/report/review JSON 日志，供 ExplorationContextDrive 选择，再由 M6 做精确 Artifact 正文读取。这是现存 journal 兼容来源，后续按 R3e/R5a/c 明确归属，不能把目录扫描/JSON日志复制到新模块再长期双写。
- `app/memory.ts` 的 `/memory/*/view` 与 copy 主要读正式 Memory 记录；正文精确核对点在 H9。Workspace 的 file/read/project_source 是 R2/R2e，Kernel 原 Session 历史属于 R4，均不借 ArtifactPort 名义扩大本批。

## 5. R3b 原计划覆盖与尚需独立验收的证据

| 原计划要求 | 当前批准任务 / 已有测试对应 | 主审关闭条件 |
| --- | --- | --- |
| digest、putIfAbsent、损坏检查只保留一套 | RawBodyStore / body-codec / SQLite rows；原3项raw合约、4项body boundaries | 在集成后复跑旧 Vault、跨进程首 owner/source 竞争与旧库重开；旧 SqliteArtifactVault 不再持有 SQL/schema/digest 算法 |
| exact grant/currentBasis/来源适用性归 WG | 已导入 WG applicability/material-service；旧 `material-access-policy.ts` 在7文件任务中改纯重导出 | 旧规则体删除、legacy 与 Core 共同私有读取/准入原语；不得留一份旧 Vault 条件树 |
| Host 无 Run 精确读取与真实 Run 束读取 | H1/H2 的 Host 与真实 GUI 重开测试；M1 的 `tests/app/runtime-context.test.ts` | 真实装配通过且普通读无新 Run / 模型；source/TaskEnvelope/owner 拒绝保持；不能以仅新增 materials 属性验收 |
| 真实 QueryRun 授权边界保持 | QueryRun 完整身份旧 Vault 测试、R3b fake raw/exact grant/basis/revocation 合约 | 还要定位并定点验证 M2/M3 的真实 Query 材料链；已建议现有 `tests/context/query-execution-context.test.ts`，主审选择实际覆盖需要的集合 |
| legacy 旧来源、首 owner 可读；新写拒绝伪造legacy | R3b raw旧SQLite行/reopen、legacy写拒绝/损坏；WG Host legacy/null-owner及跨作用域 | 适配不猜 owner，不扩大授权；正文损坏保留 unavailable/invalid 原理由；不清理未知引用历史正文 |
| body-first，正式提交失败不产生悬空成功引用 | 集成任务明确保持两步，MaterialService 成功仅回stored、不制造 Ledger cursor | 固定 R3b 集合尚未证明正式提交失败的整条链；主 Agent 已交 Sol 定位既有或补独立故障测试。应覆盖正文失败不登记成功引用，以及正文成功/正式提交失败只留下未引用正文；不宣称跨库原子 |
| 全部普通读消费者与模型准备读者分开盘点 | 本页 H/M 清单 | 本批只迁 H1/H2 并贯通 M1 等底层共享链；H3–H9 和各模型业务出口按计划登记，不写“全普通读取已迁” |

本页只读审阅，没有运行产品测试，没有取代主 Agent 的候选、导入后测试及边界裁决。

## 6. 体积和退役验收，不能只看接口增加

最终规模由主 Agent 对停止写入的同一版本测量，保留原 07:33 不可变快照。本页不复测总代码行数、不预测净减。比较应覆盖新增 core 正文/材料实现、contracts 和7个集成文件的完整生产改动，不能只报旧 Vault 减少多少行而遗漏新增层。

本批应能给出三项真实退役事实：

1. `SqliteArtifactVault` 的数据库连接/schema/摘要/权限实现退出，剩下 Raw Store 装配、兼容委托和 close；同一正文算法服务 Memory/SQLite。
2. `artifact-vault.ts` 的授权/完整性判据退出，只保留原构造/Map seam 和协议转换；共享 Map 必须实时可观察。`material-access-policy.ts` 只重导出 WG resolver，旧规则体为零。
3. Host History H1/H2 停止以 item.owner/grant.reader 承担调用者权限；Run/Query 的现存 ArtifactPort wire 可作为参数/结果兼容保留，但共同 WG 规则只有一份。它们最终在 R4/R5 迁移后由 R6c 核对生产消费者清零，再删除无用旧出口。

保留 raw body、领域准入和旧协议映射三种职责并不自动代表精简；应核对是否减少同义算法、真实主路径跳转和重复 I/O。比如新 put 不保留多余预读、正文摘要调用有独立边界断言；这些是局部工作量证据，不能推导端到端加速或全项目复杂度下降。

## 7. R 系列剩余及真实接线前置

| 范围 | 此核对点状态与剩余 | 真实前置 |
| --- | --- | --- |
| R2 | R2a–d、R2e.1已验收；Git版本读取、非TS统一语义、GUI Host文件入口等后续尚未完成 | 按实际能力冻结范围/来源/历史/容量/不支持契约；不要求先等整套R3 |
| R3b | Raw/WG组件已导入；7文件真实集成运行中，未标完成 | R3a物理工厂、R2来源能力、可信Host context；本页覆盖/退役及body-first验收 |
| R3c / R3d | 任务/资格/索引；正式架构捕获/采用尚待迁 | R3c依赖R3a/b；R3d依赖R2冻结来源与R3a/b正文/正式提交。规则/索引具真实实现后才能接消费者 |
| R3e / R3f / R3g | 证据完成；通信；角色/记忆与退出清单尚待迁 | R3e依赖R3a–d；R3f依赖R3a/b/c；R3g依赖R3a/b及旧配置入口盘点。H3–H9分别按上表落批 |
| R4a / R4b | R4a Kernel已验收；平台Session目录/稳定映射/原历史未交付 | R4b依赖真实WG Session/操作/映射持久结构及R3材料能力；R3a仅Goal子集不能冒充全部Session事务/索引已就绪 |
| R4c / R4p | Task/Query共同占用、增量观察、同目录范围并行未交付 | 实际资格/角色/材料规则、R4a/b；R4p还需范围事务/索引与R4c共用驱动，不能因R3a有commit就认为claims/indexGuards已实现 |
| R4d / R4e | 控制/重启/终止、Session维护与关联收口 | R4d依赖R4c真实可恢复执行；R4e依赖R4b–d，同一个执行/维护占用槽 |
| R5a / R5b / R5c | 业务流程、检查Reviewer返工、Handoff/等待及Context总门面退役 | R5a真实R3规则和R4能力；R5b R3e+R4；R5c R3f+R4占用+R5a/b |
| R6a / R6b / R6c | UI查询/操作与最终旧模块清零 | 只读UI按所需R3/R4能力接线；动作按R4d/e与R5能力。R6c必须有全部退出清单、真实旧消费者清零和兼容验收 |

以上是生产接线前置，不强制内部工作全局串行。公开契约和文件所有者明确后可并行编写独立内部实现；验收仍要求真实提供者、调用者、来源与失败路径一起成立。
