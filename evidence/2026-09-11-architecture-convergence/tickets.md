# 本次有界修复派发

来源：2026-09-11 当前用户「12 Module 架构一致性核对与修复」委托。baseline.json 为输入身份；独立审查 audit-*.md 为上游产物。产品根 D:/1.project/Software/agent_platform，文档根 D:/1.project/Software/agent_learn/agent_dev/agent_platform。

所有角色共同规则：依据 PRODUCT/ARCHITECTURE/直接 Module 与 Interface。现行文档及已接受决定没有明确相关技术选型时，不得自行拍板或先实现后要求确认；立即报告主 Agent，暂停依赖该选择的工作，继续独立工作；等待超时不视为同意。普通已有规范内编码直接执行。保留未提交修改与旧证据，写前比较 baseline 哈希；非本票文件改变立即协调。子 Agent 不运行全仓/构建、不安装依赖。主 Agent 统一 WSL 验证。

## AC-DATA（实现角色 audit_data）

- Module：WorkspaceReader、ContextCompiler、StateLedger。
- write_scope：src/data/workspace-reader/role-source-reader.ts；src/data/context-compiler/role-source-index.ts；src/data/state-ledger/sqlite-ledger.ts；tests/context/role-source-stability.test.ts；tests/control/work-identity-uniqueness.test.ts；本证据目录 data-*。
- 责任：源码读过程中变动不能冒充同版 sourced；Context 在 I/O 后重核 canonical Workspace。旧库没有 identity_claims 槽时，事务内检查现存工作绑定，拒绝第二身份；不删除/选择旧重复事实。
- 验收：受控 I/O 竞态及旧库升级反例，现有权限/读取边界/内存与SQLite唯一性不退化；行为变化与机制限制如实报告。

## AC-VIEW（实现角色 audit_interaction）

- Module：ReadModelIndex；app 只组合和适配，UI 只展示。
- write_scope：src/app/governance.ts；src/contracts/governance-view.ts；src/data/read-model-index/governance-view.ts；src/ui/src/features/governance.tsx；tests/app/governance.test.ts、role-spec-governance.test.ts、role-material-run.test.ts、rework-dispatch.test.ts、plan-changes.test.ts；tests/read-model/governance-view.test.ts；本证据目录 view-*。
- 责任：现有治理视图类型归 contracts，读取和组装归 ReadModelIndex；保持HTTP字段、缺口、当前引用与事件来源语义。Control 角色政策仍唯一，具名政策解释接口注入，不复制守卫。
- src/app/service.ts 由主 Agent 集成；需要的改动用报告给出。
- 验收：治理安装/激活/角色矩阵既有消费者仍使用同一视图；直接模块查询与宿主查询一致，缺口及当前引用不被隐藏；不新增持久权威或依赖方向。

共享契约、其他 Module 修复由主 Agent 继续集成并单独派发。最终复核交换实现者，不能自行给自己验收。

## 后续协调与验收分工

- AC-DATA实际协调增量：in-memory-ledger.ts隔离公开可变引用；新增tests/ledger/identity-upgrade.test.ts、snapshot-isolation.test.ts。Context I/O后复核由主集成。原work-identity-uniqueness测试保留并纳入回归。
- AC-PLAN：audit_control独占PlanCompiler身份材料、共享纯taskWorkOrigin契约及两编译器；Dispatch/rework-drive材料集成协调后释放主Agent；生产app/harness DI主Agent。验收为真实Control绑定、absent/unavailable与无写入，独立复核audit_data。
- AC-VIEW补充：tests/app/governance-commands.test.ts与governance-view测试按HTTP兼容迁移；矩阵同版修复由原实现者，audit_data独立复核。
- AC-VERIFY主Agent：共享RunOutputMaterial/ReworkDisposition契约、Context存储适配、Control处置、VE与所有组合根/直接测试迁移；Dispatch材料传递用户先明确选择后实施。audit_interaction独立架构复核并追加unknown和正式Evidence反例。
- AC-STATE：audit_data仅module-status、核心义务映射与原样历史副本；AC-SPEC：audit_control仅受影响Module和3 Interface；主Agent PRODUCT/ARCH/ADR/user-replies/摘要/交接。audit_interaction最终独立复核规范与义务承接。
- 本次原样文档快照用.md.txt保存，保留字节与原相对链接语境，避免被当成当前位置现行规范。Windows/WSL失败日志保留，不修改validator迁就错误。
