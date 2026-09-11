# 独立复核：公共契约导出收敛

Ticket：SC-EXPORT-PRUNING-REVIEW。复核者未实现本轮源码变更；写范围仅本报告。已读产品根、文档根 AGENTS.md 及当前模块状态相关条目。基线采用本目录 baseline.json 和 history，未以 git HEAD 或前轮 dirty 差异代替。

## 结论

本次限定变更未发现阻断性问题。9 项无消费者声明删除、54 项文件内声明取消命名导出、5 项模块内部类型迁移和 3 项无用转导出移除均有实际消费依据。取消命名导出不等于删除公开结果中的字段；不得将二者混为同一删减指标。

## 独立检查与证据

- 独立检查 33 份改动前归档，其 SHA-256 全部匹配 baseline.json；审查范围不包含前轮实现。
- 未执行主 Agent 的迁移脚本复现结果，而是另行解析归档与当前文件、按顶层声明匹配，移除注释并仅归一化 export 修饰符：503 个保留声明、5 个迁移声明正文全部等价；9 个删除项与清单一致，无其他声明差异。此检查同时覆盖修改到的实现类和两个测试文件的声明正文。
- 另行 AST 扫描 src、tests、scripts、vendor 共 933 个代码文件，包含标识符及字符串字面量；被删除或取消导出的名字没有所属文件以外的代码引用。检查 import、inline import、namespace import、动态 import 和 reexport；涉及目标的四处转导出仅指向存续声明。计算属性拼接的任意动态协议不由静态扫描证明，未发现契约动态枚举加载机制。
- ports.ts 的 26 个文件消费者仅导入 RunPort、DispatchDriveResult、DispatchDriveFailure、DispatchDriveTrigger、DispatchPort、RunHandle、RunCapabilities；没有 ArtifactPort、TaskContextPort、DispatchIntentV1 转导出消费者。原定义仍保留。
- 邻接 coding-agent 工作树对旧文件路径、已删端口和迁移类型名的检索无匹配。package.json 为 private 且无发布 exports。仓内结果不能证明未知第三方深路径导入兼容；本次命名导出删减确实改变内部源码导入表面，不应宣传所有源码导入兼容。

## 删除与归属判断

- GoalChangePort 无实现/消费，且 amend 返回值已落后于 modules.ts 的 HumanCollaboration 权威入口，后者保留 needs_material。真实 HumanCollaboration.amend/decide/applyChange 及 Control.recordUserDecision/applyPlanChange 未删。
- PublicSnapshotPort 无消费；实际在用 SnapshotPort 及 PublicSnapshotQueryV1/ResultV1 未删，没有移除公开快照读取能力。
- 三个 reviewer-work command builder 仅 structuredClone 输入，未发现调用；删除空文件没有删除命令结构、Control 受理或 Reviewer 守卫。executionNoteBody、materialBasisKey 无调用；RuntimeEvent、GateTask 为无消费者别名，实际 RuntimeEventV1 和任务判别结构仍在。
- 五个迁移类型的生产消费者只位于各自 VerificationEngine 或 ContextCompiler；迁移未把模块职责交给组合根，也未新增 Contracts 对实现的反向导入。
- RuntimeContextMaterials 仍在 Contracts 中公开，workContext、roleMaterials 等跨模块材料没有因命名消费者少而移出协议。文件内子类型仍保留在原声明的字段引用中。其余 54 项同理，仅改变直接命名导入能力，值、字面量联合及嵌套结构没有改变。

## 行为和兼容性范围

AST 等价与消费检查支持此次变更未改变持久化字段、HTTP 形状、来源授权、Plan/Evidence/Reviewer 守卫或旧 FAIL 留存。未新增执行入口、Agent 启动、Verification 回调依赖或第 13 个 Module。本复核没有实现“协调角色实际消费 FAIL 并形成计划调整”，也不将清理等同能力完成。

复核时主 Agent 已产生 backend-types、ui-types、boundaries、targeted 的退出码 0；完整回归、构建、真实 HTTP/浏览器和文档验证由主 Agent 汇总，不能将本静态复核替代那些验收。

## 非阻断注释发现及复验

已向主 Agent 报告两处邻近旧说明，主 Agent 保留原文后修正，复验已关闭：

1. src/fixtures/plan-fixtures.ts 顶部已去掉不存在的旧 IMPLEMENTATION-HANDOFF.md 章节和 GateTask 旧名；当前说明使用 taskKind="gate" 等真实结构，保留原有效 admission 约束。
2. tests/app/plan-changes.test.ts 已将不存在的 HumanCollaboration.GoalChangePort.decide/applyChange 改为 HumanCollaboration.decide/applyChange；“尚无人的 HTTP 提交入口”限制保留。

已复看 contracts README、Verification README、权威 module-boundaries.md 的此次补充，均区分共享协议、模块内部类型和命名导出删减，没有将内部路径收敛写成语义编排能力完成。

只读检索中曾误猜 HumanCollaboration 目录而收到路径不存在，随后使用 rg --files 定位为 src/interaction/human-collaboration 并完成核对；不属于产品或测试失败。

## 当前状态更新的写前复核

已只读核对 current-state.mjs 待写文案。VerificationService.openIssues 经 VerificationOpenIssues 归一失败事实、ControlReworkDisposition 投影正式处置，再由 composeReworkDrive 预取 issueMaterials 传给 Dispatch；ExecutionFeedbackCompiler.request 与 service.continueEndedRun 的 Query 消费执行反馈；ReworkDriveEngine 提交 acceptReworkProposal，Control 的 AutonomousRework 使用 recordPlanChangeProposal、recordUserDecision、applyPlanChange。文案准确区分该已有机械路径与尚未实现的 FAIL 语义调查/计划调整。

脚本仅替换 module-status.md 的“本次源码与契约整理”与“当前语义协作增量”两个标题之间内容，原文 body.slice(end) 全部拼回。写前有效未完义务后缀 8647 字符，SHA-256 为 `e4d6eece9d5171608ba46d51455038ac3913ea338e09fc18e76752b068a3f278`，包含既有 14 项未完能力说明；交接继续链接该唯一权威状态，不重新定义或取消义务。

脚本要求 browser.exit 为 0 才能写入浏览器通过声明。本写前复核尚未收到 browser/docs 最终证据，不预先认定它们通过，实际写后内容和后缀保留另行核对。

## 最终写后复验

已读取实际交接、实际 module-status.md、本轮 verification.md、final.json 关联保留记录及最终验证日志；结论仍为无阻断，未发现把剩余导出都写成必要、把 named export 兼容写成外部深路径兼容、或把机械返工写成已完成语义调整的问题。

- module-status 的未完义务后缀仍为 8647 字符，SHA-256 与写前 `e4d6eece9d5171608ba46d51455038ac3913ea338e09fc18e76752b068a3f278` 完全一致，既有未完能力未删。
- 独立重算 40 个产品改动路径和 3 个文档改动路径的原文归档哈希，全部匹配 baseline。仅删除一个源码文件，无新增源码文件；两仓 HEAD 未变。保留记录显示 UI 构建探针恢复、gitignore 未动。
- 收尾涉及的 modules.ts、HumanCollaboration 实现、plan-fixtures.ts、plan-changes.test.ts 另行 AST 去注释比对均相同，仅修说明，没有新增业务改动。
- 读取实际原始日志：全仓 299 文件/1951 项通过，浏览器 26 项通过（3.9m），文档 13/13 通过；full-tests、browser、docs、build、ui-artifacts 退出码均为 0。source-docs.json 记录 73 个链接、零失败。这是对主 Agent 实际验收证据的复验，不冒充独立重跑。
- 当前交接和完整交付报告保留确定性模型夹具的证据边界、源码导入表面收窄限制、旧兼容路径及工具 FAIL 语义协调缺口；限定清理完成后停止的描述与授权范围一致。
