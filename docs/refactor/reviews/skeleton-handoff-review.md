# 详细骨架与无对话记忆交接核对

日期：2026-09-23。范围：用户要求的原始对话保存、分层架构、模块内部关键文件/逻辑/接口与接手说明。本次交付文档，没有再次修改生产源码、测试或Kernel。上一批实际优化及测试仍见[原实施证据](core-design-implementation-evidence.md)。

## 1. 可直接使用的交付

| 层级 | 内容 |
| --- | --- |
| 接手入口 | [HANDOFF](../HANDOFF.md)：用户目的、当前事实、阅读包、仓库路径、实施顺序与完成条件 |
| 意图与原话 | [意图/工程决定](../intent/INTENT-AND-DECISIONS.md)、[完整可取得公开对话](../intent/ORIGINAL-DIALOGUE.md)、[原始JSON](../intent/original-dialogue.json)、原始草图 |
| 系统骨架 | [总览](../skeleton/README.md)、架构、核心数据/操作、状态机、5模块/8边目标DAG |
| 共同契约 | [CONTRACTS](../skeleton/CONTRACTS.md)：身份、调用上下文、请求幂等、读写/操作结果、来源、Session及占用 |
| 模块内部 | 五篇[模块页](../modules/README.md)：目标文件、导出/依赖/状态、完整主要Port、算法/事务/失败恢复、真实旧代码去向、装配和验收 |
| 贯通及迁移 | [Host/UI与真实流程](../skeleton/END-TO-END.md)、[实施方案](../IMPLEMENTATION-PLAN.md)、旧模块承载/退出表 |

这是一套可施工的关键骨架，未提前逐行实现所有私有函数。局部小文件可在相同职责内合并；实现者不能用这一自由重新省略公开方法的关键输入、事务条件、旧消费者或状态恢复。

## 2. 交叉审阅修正的具体问题

1. **真实Session延续前提**：当前Kernel同sessionId的新调用不读旧完成轮次的Context，resume只恢复未结束Run；平台当前还按Run分库。确定最小Kernel公开扩展及稳定存储映射，由Kernel内部处理历史/预算/恢复，平台不复制历史选择器。native compact保持unsupported。
2. **Session互斥范围**：ExecutionRef明确包含Run/QueryRun；执行与维护共用唯一占用槽，旧结果只能释放相同owner/generation。Query不伪造Task，也不继承工作Run写权限。
3. **真实两图关联**：Task/Work可以不经Session直接关联Module；计划已有scope归属仍来自Plan，Session责任仍使用原SessionWorkLink，避免同一关系有多个正式写者。
4. **源码来源层次**：临时SourceCaptureRef与保存后的Artifact引用分开；Workspace不依赖RecordStore，冻结分页不被误称当前状态，敏感使用前的verify保留。
5. **事务与幂等**：WorkGraph编译领域变更与完整读集，RecordStore检查物理CAS/唯一性/范围并原子提交；旧Ledger按kind退出。领域检查前可读取原幂等回执，不能用新版本状态把合法重放拒绝掉。
6. **调用闭合**：补精确读取Execution/Control、原工作区租约、模型调用准入/实际RunFact、指定Plan候选等真实驱动所需Port；纠正compareWorkspace、prepareExecution、applyControl/reconcile等方法归属，continueSession明确消费已有领取。
7. **装配与资源**：明确工厂依赖、真实访问上下文、取消信号唯一来源和Host关闭权；技术operationId按完整作用域身份生成；legacy材料来源只读兼容、不接受新写。
8. **交接独立性**：用户原话与工程选择分栏，历史助手回答标为非当前约束；模块页直接解释核心语义；UI固定查询/维护路由与DTO派生，保留现有受保护入口。

以上属于本次设计修正，没有被宣称为已实现能力。Kernel扩展、Session目录、目标源码目录、UI联动均留在明确实施批次中。

## 3. 检查及证据边界

机器核对结果保存在[检查记录](skeleton-validation.json)：当前设计链20份文档、220处本地链接、18处章节定位均无错误；下列检查区分文档正确性与源码实现验收。

- 当前设计链检查Markdown本地链接与代码围栏；各模块同时核对关键旧源码/类型真实存在及公开输入输出归属。历史原话中的过期链接/行号按历史保留，不当作当前导航。
- 目标JSON为5个唯一模块、8条已声明依赖且无环；13项旧目标模块均有迁移归属。实际源码map仍描述12个旧模块，没有提前修改为不存在的目标目录。
- 旧架构快照manifest中的17份文件SHA256全部保持一致。
- 原始对话JSON包含50条公开消息：26条用户消息、24条助手最终回答。去重保留来源；DLG-046/047前后修订分别保存。未导出系统/开发者指令、工具输出、内部推理或子Agent消息。
- 归档草图与用户原文件逐字节相同，SHA256为`fdbced13b507fb6e3c6e335c8b42d93a078a0e4928db449df234ef0864239136`。
- 生产源码与测试的前批SHA256未变：`project-source-index.ts`为`b113d320466066dd88bb704ce1e42bf36180ea3fa33d384ad83df0c39af60563`；对应测试为`1c3b45f4de0cf3c980d8876eee7c2a501585de500fe69b163c6745bc34f43f6d`。代码仓`git diff --check`通过；用户原有改动保留，重构日志只追加本次Kernel前提差异。

文档中的TypeScript是目标契约，**未作为已迁移源码编译，不能将围栏/链接核对称为类型检查通过**。本次没有因文档变化重跑源码测试；上一批22项相关测试、typecheck与架构检查的通过仅覆盖当时真实改动。未来每批需将契约实现、真实消费者、旧路径退出与相关行为验证一起交付。
