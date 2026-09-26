# R3g：协调政策正式安装与启用（Stage1，待主审）

状态：2026-09-26，Astra 已完成源码与真实消费者对账，本页为下一有界骨架候选，**仅文档准备，未改源码/测试、未建占位、未 prepare/派发**。组合入口先让 R4 → R6 execution；收到主审排期后才 fresh snapshot。保留两阶段：骨架 + 一条最终行为正常链 STOP → 中审冻结 → 两文件实现。

依据：[原 R3g 已交付切片](R3d-R3g-next-skeleton.md#1-r3g正式角色规格)、[WorkGraph 模块](../modules/core/work-graph.md)、PRODUCT §6.2。原 R3g 明确没有交付协调政策生产安装；本批填该 producer 缺口，不重新实现角色准入、运行生命周期或自动返工。

## 1. 准确缺口与既有原子能力

路径以下相对 coding-platform/next。

- `src/contracts/human-role-collaboration.ts` 已有 CoordinationPolicyContentV1 / Pin / RevisionSnapshot / ProjectCoordinationPolicyActiveSnapshot / `coordinationPolicyContentDigest(content, policyId, revision)`。不得创建第二份类型或摘要。
- `configuration/role-record-codecs.ts` 已注册 CoordinationPolicyRevisionSnapshot@1 与 ProjectCoordinationPolicyActiveSnapshot@1；已有对应 ref/snapshot parser、record decoder、`coordinationPolicyContentProblem` 与 `validateCoordinationRoleMatrix` 复用。缺的是这两个记录的 encoder，以及正式 install/activate 事件；不重复注册 record schema。
- `createRoleConfigurationService` 是当前 RoleSpec 写入与 CoordinationPolicy 读取的同一配置 owner。已有 `trustedHost`、clone、记录查询与原事件回执模式；RecordStore 仍是唯一事务 owner。不要添加 CoordinationManager、Repository 或单独 policy provider。
- 同一 `resolveRoleBindingFacts` 读取政策 active → 精确政策正文 → matrix pin → RoleSpec/RoleActive 并返回局部 guards；`resolveRoleBinding` 是它的公开投影。真实消费者是 claim-service、execution-entry-service、execution-preparation、execution-driver、query-execution 与 composition 的配置授权。没有矩阵为 absent，不等于角色通过；有矩阵仍沿原准入，不复制规则。
- `tests/helpers/B2-runtime-fixture.ts` 约 184 行仍用 commitRaw 同时 seed policy revision+active；`C2-runtime-platform-fixture.ts` 也有政策 seed。它们证明原 reader/执行链已有，不证明生产政策可创建。本批新增完整无 policy seed 的 composition 正常链；共享 fixture 全家族替换留随对应消费者迁移，不把新 writer 未被全体旧 fixture 使用伪称零 seed E2E。
- next 目前 budget/maxAutonomousReworks/maxClarifications/inScopeRework 等只由 codec 检查结构，真正运行消费者仅角色矩阵；旧原工程 autonomous-rework 不能计入 next 已交付。本批保存原政策，不宣称自动返工/澄清预算已执行，也不为其创建新治理总管。

## 2. 两个窄写入口，沿现配置 owner

在现 `configuration/contracts.ts` 的 `RoleConfigurationPort` 增加两个方法，在现 `platform.roles` 以同 roleService 的 trackedCall 公开。不新建实例/owner，不改四个既有 Role 方法签名：

```ts
installCoordinationPolicy(ctx: CoreCallContext, request: GraphWrite<{
  policyId: string;
  contentRevision: number;
  content: CoordinationPolicyContentV1;
}>): Promise<WriteResult<CoordinationPolicyRevisionSnapshot>>;

activateCoordinationPolicy(ctx: CoreCallContext, request: GraphWrite<{
  target: CoordinationPolicyPin;
}>): Promise<WriteResult<ProjectCoordinationPolicyActiveSnapshot>>;
```

复用 GraphWrite、WriteResult、现政策类型，不搬旧 Control 命令/Receipt 层，也不改 human-role-collaboration.ts 声明。public 归于 roles 配置对象只是既有入口分组，不表示由 RoleSpec 反向持有另一份政策事实。Core 未来可按需增加读入口，本批不为 UI 增加无消费者的 list/current/exact API。

可信边界沿原 trustedHost（human/system、project、相符 material reader）；首 await 前隔离输入与可信 actor，保留原 signal。政策是项目级，ctx 的 workspace 不变成政策身份或额外治理门槛。模型不能自报 Host 或调用安装接口取得工具授权。

### install：不可变正文，不隐式启用

input 恰含 policyId/contentRevision/content；revision 正整数，调用者不供应 contentDigest，按原函数算。meta.expected 恰含现 Project pin 与目标 CoordinationPolicyRevision 的缺席 pin（row revision 0，ref.revision=contentRevision）。沿已存在 Project 正式注册链读取并 CAS；不要求空库、Workspace、架构/Plan、RoleActive 或所有 Run 停止。

复用既有政策内容 validator / snapshot parser；budget 保留当前 next 接受的非负安全整数（包括 0），不要复活原工程旧预算下限/上限。allowed/upgrade 和本次 content 的 `changesRequireHumanDecision` 固定声明遵守既有类型；roles 可缺省，但存在时通过原矩阵 validator，coordinator 指向本次 catalog 键，完整 role pin 必须同项目。只核本次 payload，不扫描全项目 Role/Session。安装不要求所有被引用 Role 已 active；实际可用性由原 resolver 判定。缺 roles 不能补默认角色，也不能当已准入。

一次 PreparedCommit 写 immutable policy row（外层 revision=1，contentRevision 为输入版本，可不等于 1）、正式 installed event 与幂等 identity，guards 只有 Project 与目标 row 缺席。installedAt/eventId 只在确定 fresh 后产生。不会创建/改 active、RoleSpec、RoleActive、Session 或 Run。

### activate：精确目标与唯一项目指针

input.target 为完整本项目 policy ref+digest；meta.expected 恰为 Project pin 和 ProjectCoordinationPolicyActive 当前行 pin（明确 0 表示缺席）。读精确已安装政策并核摘要，不能启用尚未安装内容或把 ref.revision 当行版本。

一次 PreparedCommit 只写该项目 active 新 revision、完整 activated event 与 identity；guards 为 Project、target immutable row、active 当前行/缺席。读取失败保留未知/不可用，不能默认 absent。既有 Role resolver 自然读取此唯一指针；不为 activate 新加全部矩阵 Role 当前 active 一致门槛、全部 Session 迁移门槛、运行中换角色机制或任何跨 owner 写。

政策启用只改变之后对当前政策的读取；不重写现有 Session.role / Run.roleBinding / Context / 已经发生的事实。现有各 action 的角色准入消费者继续按原职责工作；本批不新增每次 model/observation 的读取链。

### 原回执与持久事件

使用不同 identity 前缀 `coordination-policy-install:` / `coordination-policy-activate:` + 原 commandIdentityKey（trusted actor 与 requestId）。fingerprint 覆盖完整已隔离输入、规范 expected 和项目/操作，保留 absent roles 与显式 matrix 区别。

在读当前 Project/target/active 前先 lookupCommit；同 identity/fingerprint 从原 eventAt 恢复完整原 value、cursor、replayed，不能按后来 active/Role 状态重新生成。Store commit 再去重；必要版本冲突只做一次 exact identity recovery，无全局 retry/ledgerHorizon。实际提交后响应丢失可以查原 receipt 确认；结果仍未知就 unavailable，不声称零写或安全重复。

在原 ROLE_RECORD_SCHEMAS.events 增加 `CoordinationPolicyInstalled@1` / `CoordinationPolicyActivated@1`。事件含真实 project/actor/request identity/fingerprint 和完整本次 snapshot（installed 为 policy，activated 为当次 active），因此 old activation replay 不依赖最新 pointer。沿原 event/schema codec，不建另一份 mutable receipt 表。编码校验限原持久契约/本次来源，不加内部记录篡改测试。

## 3. 最小正常消费者链与固定检查

只改既有 `tests/composition/R3d-R3g-platform.test.ts`，原角色/observed 用例逐字保留，仅新增一个 it：

1. 空 SQLite，以公开 projects.createProject/registerWorkspace 建真实 scope；不沿旧用例 seed Store；workspace grant 可拒绝源读取，因为配置不需读源码。
2. 经现 roles.installRoleSpec/activateRoleSpec 正式安装并启用 builder v1，得到真实 pin；未创建运行，无 Role 热切换。
3. policy 使用该 pin 与原 content 结构，contentRevision 取 2（证明不是 immutable row revision）。通过新 install，断言返回真实 snapshot、原 digest、row revision=1/contentRevision=2；调用原 resolveRoleBinding 仍 absent（安装不启用）。
4. 新 activate exact pin（Project@1、policy active@0）后调用同一公开 resolveRoleBinding，declaredPermissions 取 RoleSpec 已有 tools/writeScope 子集；断言 resolved 与原 builder revision/spec。该 resolver 就是 claim/runtime/query 的原正式消费者，不能 stub/memoize 结果，也不另外实现角色规则。
5. 关闭重开同库；原 resolver 仍 resolved，原 install 与 activate 原样 replay 返回各自完整 original value/cursor，replayed=true；不新装/新启用、不根据当前时钟重造事件。

无需新 Task/Plan、模型调用或 Session 冷热切换即可证明 writer→现 consumer。同库已存在其他事实不构成阻断。不要扩异常矩阵、new permission framework 或多轮局部测试。

固定检查：现 `next-roles`；现组合文件单独窄 selector（派发前由主审在 check.py 登记 `next-role-platform`，只指向该一文件）；两者合并一次运行，再独立 `next-types`。本次文档准备不改 check.py、不运行测试。

## 4. 五路径 scope 与两阶段

[候选五路径 scope](R3g-coordination-policy-skeleton-scope.json)，全部文件已存在：

1. `coding-platform/next/src/core/work-graph/configuration/contracts.ts`：窄 install/activate typed 方法。
2. `coding-platform/next/src/core/work-graph/configuration/role-memory-service.ts`：原 owner 两 explicit unsupported 骨架；实现阶段再接正常原子算法。
3. `coding-platform/next/src/core/work-graph/configuration/role-record-codecs.ts`：复用原 decoder/schema，补 encoders/two events/必要共享纯形状检查，不重复注册记录。
4. `coding-platform/next/src/composition/create-platform.ts`：原 roles 对象两 tracked 方法，close 排空不变；其他在途接线保留。
5. `coding-platform/next/tests/composition/R3d-R3g-platform.test.ts`：仅新 1 条正常链，原用例不弱化。

Stage1 第一次 policy install 在明确 unsupported 处首红，其前的 Project/Workspace/Role 公开初始化必须真实成立；后段未达如实报告。接口/测试/组合根冻结后，Stage2 预计只开放 role-memory-service.ts + role-record-codecs.ts，使该条正常链全绿。不得为通过测试迁入旧 Control/Ledger，遇真实接口缺口先报主审。

唯一共享 production 写点为 create-platform.ts，必须排在 R4→R6 execution 组合窗口之后 fresh prepare；政策文件与 R3d catalog/R2 mixed 没有交集。主审批准前不启动 DSH。后续共享 B2/C2 fixture 生产 writer 迁移、Host 配置 UI、具体自动返工/澄清消费者另逐批推进；它们保留产品范围，本批不冒称完成。
