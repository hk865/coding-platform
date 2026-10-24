# src/core/work-graph/configuration：WorkGraph 的初始化与设置写入 owner（L2）

## 负责什么，不负责什么
- 负责：Project/Workspace 登记与 CompletionPolicy 安装/激活、role-spec 安装/激活/解析、Workspace 决定设置（`markNoticesSeen`）、工作线 pin（`setLinePins`）、消息 duty 事实适配，以及这些记录的纯 codec。
- 依赖只允许 `model, state, persistence`（以及 `src/contracts`、RecordStore 端口）；不得 import `sessions`、`queries`、`tasks`、`materials`、`architecture`、`communication`、`views`、`app`、`business`、`composition`。
- 需要 Session 读取等上层事实时由组合根注入窄函数（例如 `LineSettingsDependencies.sessionRead`），本层不反向 import 上层。
- 设置读取/写入只经本层服务；上层不要直接 `readMany`/`encodeWorkspaceSnapshot` 再自己写设置，否则身份、pin、重放和 CAS 会分叉。
- 业务状态迁移只经 `state/`（notice-settings、line-pin 等纯机器）；本层只做协议校验、pin、一次提交和原始事件重放。
- 不启动 Agent、不写消息、不判断完成；`registerWorkspace` 只登记领域事实，不打开/创建目录，也不保存第二份 Host root。

## 文件
- `project-bootstrap-contracts.ts` — `ProjectRegistrationPort`、`CompletionPolicyConfigurationPort` 与 bootstrap 依赖/服务类型。
- `project-bootstrap-record-codecs.ts` — 四个初始化事件的 codec、CompletionPolicy 纯内容校验与 schema 注册。
- `project-bootstrap-service.ts` — 四个 Host 写操作（建 Project、登记 Workspace、安装政策、激活政策）+ 三个精确读；一次 `PreparedCommit` 与 event replay。
- `role-record-codecs.ts` — role-spec / coordination-policy 的记录与事件 codec、ref/snapshot 解码。
- `role-memory-service.ts` — 角色规格安装、精确读、激活与绑定解析；文件名仍带 memory，但记忆读写尚未实现（memory 是独立未完成族）。
- `decision-settings-service.ts` — Workspace 决定设置的唯一 owner：`markNoticesSeen`（display token、seenThrough、一次 Workspace 提交）；带 Goal 的 token 只认主对话签发的，队列签发的照旧拒绝。
- `line-settings-service.ts` — Workspace 工作线 pin 的唯一 owner：`setLinePins`（注入 Session 读、一次 Workspace 提交）。
- `message-duties-adapter.ts` — 从 Session 固定角色与既有 resolver 派生唯一生效 duty 的事实适配器。
- `workspace-settings-reads.ts` — 两个 Workspace owner 共用的绑定上下文、Workspace pin 校验、精确读与原始事件重放。

## 可以复用的能力
| 名字 | 位置 | 做什么 | 什么时候用 |
| --- | --- | --- | --- |
| `createDecisionSettingsService` | `src/core/work-graph/configuration/decision-settings-service.ts:52` | `markNoticesSeen`：校验 display token/位置、走 notice-settings 状态机、提交 Workspace 快照 | 要推进请知悉 seenThrough 时；不要另写设置写入 |
| `createLineSettingsService` | `src/core/work-graph/configuration/line-settings-service.ts:84` | `setLinePins`：校验操作者与新加 Session、走 line-pin 状态机、提交 Workspace | 要增删工作线 pin 时 |
| `createMessageDutiesFactsAdapter` | `src/core/work-graph/configuration/message-duties-adapter.ts:47` | 解析 Role 绑定与 Session 自身角色，返回 duty、只读副本、独立评审与 guards | 消息路由/资格需要正式 duty 时；读失败不回落默认 duty |
| `createProjectBootstrapServices` | `src/core/work-graph/configuration/project-bootstrap-service.ts:1125` | 返回 `projects` 与 `completionPolicies` 两组 Host 写/读（含冷启动读） | 新 Store 初始化、reopen 后取真实 revision 时 |
| `createRoleConfigurationService` | `src/core/work-graph/configuration/role-memory-service.ts:206` | `installRoleSpec`/`readRoleSpec`/`activateRoleSpec`/`resolveRoleBinding` 与内部 guards 版 | 角色规格与绑定解析的唯一入口 |
| `ROLE_RECORD_SCHEMAS` | `src/core/work-graph/configuration/role-record-codecs.ts:491` | role-spec / coordination-policy 四类记录与两个事件的 backend schema 注册 | 组合根注册记录与事件 schema 时 |
| `PROJECT_BOOTSTRAP_RECORD_SCHEMAS` | `src/core/work-graph/configuration/project-bootstrap-record-codecs.ts:425` | 四个初始化事件的 schema 注册 | 组合根注册事件 schema 时 |

同一种能力的正本：`canonicalKey` 在 `src/contracts/fingerprint.ts`；`canonicalRefKey`（`src/core/work-graph/persistence/record-codecs.ts:79`）把对象 ref 交给它。`sameActorIdentity`（unknown 值）与 `sameActorKindAndId`（typed 形状）在 `src/contracts/actor-equality.ts`，本层用前者。

## 内部用
- 设置基元：`ownScope`、`isOwned`、`workspacePinProblem`、`loadWorkspace`、`replayWorkspace`。
- codec 辅助（role）：`roleSpecRevisionRefFromValue`、`projectRoleSpecActiveRefFromValue`、`coordinationPolicyRevisionRefFromValue`、`projectCoordinationPolicyActiveRefFromValue`、`roleSpecRevisionSnapshotFromValue`、`projectRoleSpecActiveSnapshotFromValue`、`coordinationPolicyRevisionSnapshotFromValue`、`projectCoordinationPolicyActiveSnapshotFromValue`、`decodeRoleSpecRevisionSnapshot`、`decodeProjectRoleSpecActiveSnapshot`、`decodeCoordinationPolicyRevisionSnapshot`、`decodeProjectCoordinationPolicyActiveSnapshot`、`decodeRoleSpecInstalledEvent`、`decodeRoleSpecActivatedEvent`、`encodeRoleSpecRevisionSnapshot`、`encodeProjectRoleSpecActiveSnapshot`、`encodeRoleSpecInstalledEvent`、`encodeRoleSpecActivatedEvent`、`canonicalRefKey`。
- codec 辅助（project bootstrap）：`completionPolicyContentProblem`、`decodeProjectRegisteredEvent`、`decodeProjectWorkspaceRegisteredEvent`、`decodeProjectCompletionPolicyInstalledEvent`、`decodeProjectCompletionPolicyActivatedEvent`、`encodeProjectRegisteredEvent`、`encodeProjectWorkspaceRegisteredEvent`、`encodeProjectCompletionPolicyInstalledEvent`、`encodeProjectCompletionPolicyActivatedEvent`。
- 常量：`ROLE_SPEC_REVISION_SCHEMA_ID`、`PROJECT_ROLE_SPEC_ACTIVE_SCHEMA_ID`、`COORDINATION_POLICY_REVISION_SCHEMA_ID`、`PROJECT_COORDINATION_POLICY_ACTIVE_SCHEMA_ID`、`ROLE_SPEC_INSTALLED_EVENT_TYPE`、`ROLE_SPEC_ACTIVATED_EVENT_TYPE`、`PROJECT_REGISTERED_EVENT`、`PROJECT_WORKSPACE_REGISTERED_EVENT`、`PROJECT_COMPLETION_POLICY_INSTALLED_EVENT`、`PROJECT_COMPLETION_POLICY_ACTIVATED_EVENT`、`PROJECT_BOOTSTRAP_EVENT_SCHEMA_VERSION`。

## 不要做
- 不要绕过本层服务直接写 Workspace/角色/政策记录；身份、pin 顺序、replay 与 CAS 只有这里一套。
- 不要把读失败或损坏记录折成 `absent`、默认 duty 或“没有矩阵”（FP-05、MH-06）。
- 不要另写 Store 失败映射或重放；选 `persistence` 的 owner 映射，重放读原始事件而不是当前快照（M1-30、M1-25、M1-26）。
- 不要在 configuration 里 import 上层；需要的 Session/材料读取由组合根注入窄端口。
- 不要只改类型或只改消费方；新配置要贯穿声明、校验、组合根转发与 reopen（FP-15、MH-02）。
- 不要在本层改 Session 生命周期、发消息或判断完成；这些有各自的 owner，状态写只经 `state/`。
