# AC-VIEW 独立复核

复核者：audit_data，未参与 AC-VIEW 源码实施。本次只读检查 app/governance.ts、contracts/governance-view.ts、read-model-index/governance-view.ts、ui/features/governance.tsx、主 Agent 已集成的 service.ts、Control 的 evaluateRoleSpecPinReadiness 与新行为测试；未以测试结果代替职责审查。

## 结论

读取归位符合既有责任：GovernanceEntry.view 只委托 GovernanceViewPort，底层canonical/事件读取、角色枚举、当前治理材料与展示字段组装由 ReadModelIndex 持有。app 保留的 ledger.load 用于命令 CAS/重放回执，未继续维护展示扫描。没有新增持久状态权威，也没有让 ReadModel 提交命令或决定正式资格。

真实消费者已接通：service.ts:279 为 GovernanceEntry 注入 GovernanceReadModel；组合根共享同一 governanceRoleSources 与 governanceEntryRoles 配置。UI 治理视图类型改从 contracts 消费。旧 app 类型 re-export 为兼容用途，不含第二份 schema。

政策唯一性成立：GovernanceRolePolicyExplanationPort 是具名契约；service 将 Control 的 evaluateRoleSpecPinReadiness 注入。后者仍调用既有 evaluateRoleBindingAdmission；ReadModel 不另写角色准入算法。automationSwitch 的解释来自所选已生效策略字段，不能推进任何状态。读取上限和缺口保留，内置 source 不被当成已激活授权。

可读性有实际改善：治理展示实现与HTTP命令适配不再混合，公共wire类型有明确归属。未机械拆成多层转发框架；唯一新读取类有真实消费者。模块内仍有较长说明文字/历史编号，可作后续局部维护债，不以总行数作不通过理由。

## 复核发现及回修

初次复核发现 roleMatrixView 已持有 policy A 的 revision/content，却再次读取 activeMatrix(projectId)。并发激活时会将 B 的矩阵贴在 A 的policyId上。这是当前取材/展示来源一致性问题，非新产品语义。

已由 AC-VIEW 原作者修复：矩阵仅从传入 active.revision.content.roles 解析，不复读 active 指针；新受控测试将多余第三次active读切到B，检查policyId和coordinator均A。复核当前源码确认这一单点已经消除。角色目录各行仍包含各自所读精确active引用；本次不声称整个治理查询是跨聚合原子快照。

## 验证边界

以上是职责、接口、数据来源与可读性的独立源码复核结论。运行验收由主 Agent 的真实WSL类型检查与治理/角色/计划变更消费者回归日志决定，本复核未重跑安装、全仓或浏览器测试。新治理视图测试覆盖缺失、不编造授权、跨查询active更新、扫描不完整、政策端口与激活穿插；原消费者回归仍需主记录通过结果。

未发现阻断本次 AC-VIEW 归位的剩余责任偏移；最终文档同步需删除现行 Host 治理读取例外，将其保留为历史原因，并准确说明按需读取的非事务视图限制。
