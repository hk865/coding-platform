# 公共命名导出删减

本轮按用户继续委托，实际删减接口及导出，不把目录调整当接口收敛。记录属于同一有界 [source-cleanup evidence](../verification.md)，前轮 [contracts-followup](../contracts-followup/verification.md) 和历史失败均保留。当前状态仍只在 human/module-status.md 与 IMPLEMENTATION-HANDOFF.md。

## 实施结果与依据

contracts TS 文件116→115，顶层文件仍85；直接命名导出声明1531→1463，另去掉3个转导出绑定。没有新文件或新Module承接它们。所有决策及真实消费者列表见 [decisions.json](decisions.json)，盘点见 consumers-before.json/consumers-after.json。并非所有剩余导出都已经证明必要，本轮只处理指定链路中已确认的68项。

| 操作 | 明确对象与理由 |
| --- | --- |
| 删除2个旧接口 | GoalChangePort 没有消费者，与 modules.ts 的 HumanCollaboration 重复且缺少正式 amend 已有的 needs_material 分支；PublicSnapshotPort 无消费者，真正使用的是 SnapshotPort，查询/快照能力没有删除 |
| 删除3个命令包装 | buildCreateReviewWorkCommand、buildBindReviewOutputCommand、buildValidatedReviewResultCommand 都只是无人调用的 structuredClone；commands/reviewer-work.ts 整文件移除。实际 Reviewer 命令、授权和受理守卫不变 |
| 删除2个旧类型别名 | RuntimeEvent、GateTask 没有消费者；RuntimeEventV1、RuntimeTask.taskKind 和全部正式 gate 义务保留 |
| 删除2个未使用包装 | executionNoteBody、materialBasisKey 仅包一层 canonicalJson，没有调用方；原正文/摘要/授权算法不变 |
| 54项取消export | 仅本文件被引用的子类型、拒绝码、常量与校验函数保留定义和字段。包括反馈类型、结果子类型、validatePlanRevisionDraft 等；外层公开结果引用的字段没有删除 |
| 5项回归Module | VerificationPlanCompileInput/Result/RejectionCode 移到 Verification 的 verification-plan-compiler.ts；CandidatePatchCheckPort 移到该模块 candidate-patch-check.ts；CoordinationSourcePort 移到 Context 的 query-execution-context.ts。只在同Module/测试消费，无 contracts 反向依赖 |
| 删除3个转导出 | ports.ts 不再转导出 ArtifactPort、TaskContextPort、DispatchIntentV1；它的真实消费者只使用保留的 Run/Dispatch 接口 |

类型只有一个模块直接命名引用，不自动表示可以移出共享协议。例如 RuntimeContextMaterials 的嵌套材料仍构成跨Module公开结果，继续保留；只取消零跨文件消费的额外命名导出。ReviewerPort、RunPort、SnapshotPort 和版本化记录均有真实消费者，也没有为了数量删除。

同步清理 ports/context-continuation/query-job 的旧冻结/施工说明、旧 GoalChangePort 名称及计划夹具的旧交接引用；历史报告指向已删命令包装的链接改指本目录保存的原文。原文均保存在 history，不改历史报告结论，不删除有效风险或未完义务。

## 兼容性、责任与独立复核

[compatibility.json](compatibility.json) 比较1562个保留契约声明（含5个迁移项），只忽略export修饰和注释，正文无差异。独立复核对503个涉及的保留声明和5个迁移声明做了单独比对，并扫描933个src/tests/scripts/vendor代码文件的标识符、字符串、namespace、转导出消费；未发现漏掉的消费者。完整结论和关闭的注释发现见 [independent-review.md](independent-review.md)。

持久事件、journal、schemaVersion、散列、HTTP路由/请求/响应、拒绝码和错误文本不变。删除named export属于源码接口收窄：仓内消费者已核实，相邻coding-agent未找到这些接口引用；private包且无package exports不等于保证未知外部deep-import兼容。

Control仍是正式状态、权限、计划和义务唯一权威，PlanCompiler只提案，Context不启动Agent。组合根先取Verification问题再交Dispatch，未增加反向回调。旧FAIL、精确材料授权、requiredOutputs声明性语义、Reviewer独立性和未知副作用拒绝重跑不变。legacyFingerprintMatches旧命令日志兼容、revisionAssignments旧计划读取与旧pending Query恢复继续保留；其真实历史消费者没有被本轮清理消除。

## 验证

- backend-types、ui-types、boundaries：退出0，现有12 Module、零边界问题。
- targeted：15文件/154项PASS，覆盖契约、规划/返工、Verification与接续。
- artifacts-before：返回1，准确发现已删命令包装留下的 dist/contracts/commands/reviewer-work.js；原始结果保留，后续只删除这个明确路径并保存副本。
- 一次多文件apply_patch返回行匹配错误，回读确认首文件已是目标内容，另外文件未改；只补剩余修改，见patch-tool-note.txt。未观察到额外同文件写入。
- full-tests：299文件/1951项PASS；build、ui-artifacts退出0，完整构建及6步真实HTTP产物校验通过，包括干净构建、过期资源替换、旧页面和单次源码变化后的产物身份。
- artifacts-after：337个服务端JS、零无源码残留；只移除首检确认的一个旧包装器产物。
- browser：26项PASS（3.9分钟），使用真实HTTP、Chromium与沙箱；覆盖来源补料、原始FAIL留存、Reviewer独立消费、重开报告和未知提交结果恢复。模型输出使用既有确定性夹具，不证明真实模型语义规划质量。
- docs：13/13通过；source-docs：73个本地链接通过。独立复核无阻断项，两条旧注释发现已修复。

工具链沿用前次交付：WSL Node24、已安装的隔离Vitest/TypeScript、固定Chromium1234与本地bubblewrap。浏览器继承原配置，只使用本轮专属44393端口和全新夹具目录，避免已占用的默认端口及旧测试数据。没有重装依赖、删断言、放宽守卫或跳过测试。

## 源码身份与保留

起点见 [baseline.json](baseline.json)：产品HEAD `65d270d75f3088d7baa4ef3a7c80fdaa62c3a38d`，摘要 `486834413c503516aeb7646ec2baec4f911bae79f89aa89903bc8254cac4647a`；文档HEAD `2f9a5df01175fb5686bb8bf02abc65216055a570`，摘要 `e87d6833641efbb10cd86ffdcfc027ad439fd98065068d41c149bb9ea5b2e596`。它们与上一轮closure一致，不用HEAD代替dirty工作树。状态原始清单和可观察进程分别保存为status-before与process-observation；多Node进程本身不证明有源码写入。目标修改前有SHA保护，原文归档。

交付 [final.json](final.json)：两个HEAD均未变化；产品1418文件、摘要 `b23d5c9617df2b08926170646674176ff9f1ee989c2bdea53d3b59f08a288b51`；文档487文件、摘要 `07c4a7005ac3103aac2eb2b3a2049c678094905aad4d552afbfe6492b515df93`。摘要包含当前文本工作树，排除生成物/evidence等，算法见同根snapshot.mjs。

[preservation.json](preservation.json) 确认本轮产品40个路径变化（仅删除一个源码文件、无新增源码文件），文档3个路径变化；所有43个改动前原文均与起点SHA匹配并归档，未改路径保持基线。构建临时UI探针已原样恢复、gitignore未动。起点既有dirty改动保留，未观察到额外源码并发写入；未提交或推送。

## 下一步检查题与剩余债

失败材料从 VerificationService.openIssues / VerificationOpenIssues 进入，Control 投影当前处置，组合根作为 issueMaterials 交给 Dispatch。协调角色现在通过 ExecutionFeedbackCompiler→正式只读Query实际消费的是执行反馈。现有机械调整由 ReworkPlanCompiler 提案，Dispatch 调用 acceptReworkProposal，由 Control 经 recordPlanChangeProposal→recordUserDecision→applyPlanChange 受理。

工具FAIL自动进入协调角色语义调查、协调结果形成正式语义调整提案并受理的连接仍未实现。调查刷新、人的决定回流、必要重审联合链、多失败/恢复验收等有效未完义务继续保留。本轮没有实现新能力。

其余协议仍有候选未使用导出、大型声明文件和内部实现债；全仓盘点只是定位，不授权继续删除未知用途的常数、历史兼容或未完能力。完成本轮68项有界删减后停止，不自动启动其他架构工程。
