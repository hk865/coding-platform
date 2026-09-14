# ArtifactVault

保存材料正文、来源和 owner，按摘要读取并检查访问权限。

## 源码入口

- [artifact-vault.ts](artifact-vault.ts)
- [sqlite-artifact-vault.ts](sqlite-artifact-vault.ts)

## 边界与接线

真实宿主使用 SQLite 版本；跨主体读取经账本登记的 `MaterialAccessGrant` 授权，声明基线不符返回 `rejected/stale`。宿主按完整身份查询全部候选并重核实际 Goal/工作区归属；Vault 限制 owner 与签发者作用域。通用版本自动作废仍未实现。未注入解析器时保持 P1-03 owner-only。

## 修改与验证入口

涉及职责或策略时读 [Module 规范](../../../../agent_learn/agent_dev/agent_platform/dev_docs/modules/data/artifact-vault.md)。 完成状态与实施顺序统一看 [module-status](../../../../agent_learn/agent_dev/agent_platform/human/module-status.md)，本页不维护第二份状态表。

相关测试：[tests/vault](../../../tests/vault)。构建与测试命令以 [package.json](../../../package.json) 为准；WSL 前置与独立 runner 见 [产品 README](../../../README.md)。测试结果须说明真实 Adapter、模型夹具或外部模型的边界。


本次增量支持撤销、同工作区精确历史读取和宿主 canonical 版本复核；历史正文/首次 owner 不变。通用源码适用性仍需补齐，详见 ArtifactVault Module 与 runtime-collaboration。
