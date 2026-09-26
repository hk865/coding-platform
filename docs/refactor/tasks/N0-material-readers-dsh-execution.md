# N0 / R3c：由目标 RecordStore 提供材料事实与候选读取

用户已授权干净迁入独立 `coding-platform/next`。原工程只读。你仅实现范围文件 `next/src/core/work-graph/materials/record-readers.ts`，其它接口、测试、业务判据、Store与配置不可修改。

## 冻结接口与复用

先读 `record-ports.ts`、本文件中的两个 factory 签名、Store `ports.ts/lookup-ports.ts` 和独立 `tests/work-graph/material-readers.test.ts`。原 `StateLedger`、`ReadModelIndex` 实现不能以任何方式导入或注入。输入仅为目标 `backend.records` 的 readMany/lookup 能力；不得另开 SQLite/Map 或扫描原工程目录。

`materialRecordSchemas()` 返回 Goal 已有注册（直接复用 `GOAL_RECORD_SCHEMAS`），增加 RunSnapshot@1、QueryRunSnapshot@1、MaterialAccessGrantSnapshot@1 读取编码，以及精确 reader 候选 lookup 注册。Store lookup 按注册字段查询完整身份，不接受任意 SQL。

1. 读取 schema 只验证持久行编码、完整身份、revision/schemaVersion与材料使用所需必需字段；不把“可读取历史行”当作新的 Run/Grant 业务受理操作。保留原 JSON，不改变快照或归一化历史内容。复用 Store 的机械编码检查与已有合法引用判据；只补本域必需字段检查。
2. 验证 Run 完整 projectId/goalId/runId、workspaceSnapshot、planRef等实际访问字段；QueryRun 包含完整 projectId/workspaceId/queryJobId/runId 与对应 run.queryJobRef/runId；MaterialGrant 包含完整 ref 与 grantId/scope一致、materials/reader/issuedBy/basis/history等所需形状及可选撤权。格式损坏不能通过 `as` 断言被当成合法实体。领域授权仍在既有 applicability.ts；例如一条字节结构完整但 reader 跨scope的旧grant，不应因此被赋予权限。
3. authority.load 以完整 canonical refKey 调 `records.readMany`，只接受精确匹配的已验证行。缺失返回 not_found；物理损坏/不支持/读取失败返回 unavailable，不能伪装成功或缺失。返回 JSON 独立对象。
4. index.materialAccessCandidates 通过注册 lookup 按 reader 的完整身份取候选（Run与QueryRun及项目/工作区/goal/job全部相应字段），再复用 `sameArtifactRef`/完整reader比较筛选精确材料。不能用裸 runId、digest 或scope不完整的键。
5. Store 每页最多200，必须继续 keyset 页面直到结束，不能以UI显示上限截断授权候选。不跨次调用缓存候选，不隐藏撤权或同ref修订；候选提供当前canonical行，是否撤权/是否授权仍由共同判据复核。防止异常提供者的非前进游标造成无限循环；不宣称跨页事务冻结。
6. 业务不复制存储或授权算法；这两个 reader 是关闭旧依赖的真实实现，不是给旧服务换名的wrapper。禁止任何旧 Ledger/Index 输入参数、隐藏全局对象或动态 import。

## 测试与实施协调

```sh
python3 tools/dsh-refactor/check.py next-material-readers
python3 tools/dsh-refactor/check.py next-types
python3 tools/dsh-refactor/check.py next-architecture
```

Store lookup 正由另一个受限 Session 并行实现，你不能改 Store。初始快照可能缺该真实能力；先完成 reader 实现与类型/编码检查，报告由 Store 缺失导致的具体测试阻塞。主 Agent 验收 Store 后将三个提供者文件作为只读 root update 放入你的快照，再让你完成真实集成验证；不能为过测试写假的提供者或绕开冻结断言。

不改接口、测试、package或类型定义，不安装依赖，不 stage/commit/push。写文件需原位写入（受单文件挂载限制）。最终如实报告实际测试与未闭合项。


2026-09-24 主审补充：候选游标必须按 Store 的 UTF-8 字节序严格前进，下降和重复均 unavailable；Agent ActorRef 的撤权归因必须包含完整 runRef。结构类型不能防止任意 provider 注入，生产装配使用目标 backend.records 的事实由组合根与真实集成测试证明。
