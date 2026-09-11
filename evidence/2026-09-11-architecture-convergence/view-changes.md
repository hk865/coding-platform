# AC-VIEW 实现与集成交接

依据 tickets.md AC-VIEW；只修改分配范围与主Agent追加授权的 tests/app/governance-commands.test.ts fixture。写入前 view-transform.mjs 对 src/app/governance.ts 完整 SHA256 与 baseline.json 比较一致才执行；没有覆盖治理并发改动。初次只读结论见 audit-interaction.md。

## 实际修复

- 公共治理查询/命令回执 JSON 类型从 app 移至 `src/contracts/governance-view.ts`；保留原字段、种类顺序、身份助手函数。app 保留 type re-export 兼容未迁移调用者；UI 与明确分配的 tests/app 类型消费改向 contract。
- `src/data/read-model-index/governance-view.ts` 的 `GovernanceReadModel` 承担 canonical/事件读取、角色目录、当前矩阵与治理展示组装。既有读取算法保留：逐次重读当前 active，20×1000 事件扫描上限，缺口/安装者/时间保持原来语义。不增加持久表、缓存或完成/授权权威。
- `GovernanceEntry.view` 只委托注入的 `GovernanceViewPort`；写入仍交现有 Control 命令。app 保留的是命令 CAS、幂等重放回执所需 canonical load，已经不依赖 events 查询能力。
- 角色 pin 就绪判据通过具名 `GovernanceRolePolicyExplanationPort.roleSpecPinReadiness` 注入，ReadModel 不复制守卫。返回类型 `RoleSpecPinReadinessV1` 放 contract，主Agent负责既有 Control 同名 type 的 import/re-export。
- 清理原治理头部把 Host 例外说成合理架构的长注释，以及移位后不再对应的说明。未按施工编号增加模块/框架。

## 主Agent集成位置

`src/app/service.ts`（主独占）增加 `GovernanceReadModel`、`evaluateRoleSpecPinReadiness` import，并给 GovernanceEntry 增加：

```ts
views: new GovernanceReadModel({
  ledger: () => h.ledger,
  defaults: { RoleSpecs: ROLE_SPEC_SOURCES_V1.map(source => ({ roleId: source.roleId, content: source.content })) },
  entryRoles: [
    { roleId: OPERATOR_ENTRY_ROLES.develop, purpose: '人工授权的真实运行（/api/real/tasks）' },
    { roleId: OPERATOR_ENTRY_ROLES.explore, purpose: '只读探索运行（/api/real/explorations/run）' },
  ],
  policyExplanation: { roleSpecPinReadiness: evaluateRoleSpecPinReadiness },
}),
```

建议在组合根共享同一份 RoleSpecs 和 entryRoles 配置，避免复制配置内容。原 install/activate/defaults/actor/now/commandId 不变。文档 module-boundaries Host 例外段由主统一移为历史原因并写当前责任，ReadModel README/Module 与最终状态由主更新。

## 验证范围与未完成验证

新增 `tests/read-model/governance-view.test.ts` 五项行为：没有治理不能编造自动授权；两次查询读到新 active 引用；扫描超过20页必须显示缺口；角色就绪解释原样来自注入Control端口；查询中激活切换不把新矩阵贴在旧policy身份上。原 tests/app 业务断言没有改动；governance-commands fixture 只新增 view 依赖（命令构造测试若误走查询则抛错）。

独立复核者 audit_data 指出原读取算法的具体竞态：roleMatrixView 获得 policy A 的revision后又重读active，可能读取 B 的roles再标成A。已按A类修复：矩阵直接解析传入revision.content，不再次读取active，字段/判断语义保持；新增受控第三次读取切换B的反例。全视图仍不声称统一事务快照，但同一roleMatrix的政策身份与正文现在同源。

本子Agent未运行安装、全仓测试、构建或 WSL。此前 pnpm 环境失败原文保留 audit-interaction.md；主Agent统一验证，尚不能自称 PASS。建议运行类型检查、新ReadModel测试及 governance/governance-commands/role-spec-governance/role-material-run/rework-dispatch/plan-changes 现有消费者；必要UI类型检查。新文件自动按既有 Module 目录归属，未迁移运行产物路径，无旧 dist 路径删除需求。

限制：本次保留原查询读取算法，不声称得到全模块单一事务快照；canonical当前引用仍是权威，历史事件扫描不足依旧显式 gaps。完整源基线/演进、暂停接续和完整语义协作仍属产品剩余能力。本实现需要未参与实现者复核，不能由本报告自验收。
