# R5a：Project/Workspace 与 CompletionPolicy 正式初始化骨架草案

状态：2026-09-26，主审已核 DTO、职责和六生产/两测试 scope；W2/C2隔离通过后已派发 r5a-project-bootstrap-skeleton-20260926（session-5af5f9e6-bc65-46a6-baa4-995ef15a3517），只交骨架/测试后STOP，不表示已实现。实现位置为 `coding-platform/next`，旧 `coding-platform/src` 只读参考。

## 1. 当前产品范围与本批闭环

用户已授权当前产品范围内的初始化、规划和执行推进，不增加重复“是否开始”的审批。R5a 只补新存储缺失的领域生产者：受信 Host 创建 Project、登记 Workspace、安装并启用 CompletionPolicy；随后实际调用已有 Goal、初始 Architecture、Plan 方法。本批交付的是 Host 公开 ports 与真实空库消费者链，不宣称 GUI、无 Plan 模型规划或 Workflow 自动推进已经实现。

不实现 QueryJob/QueryRun、Workflow 循环、Role/CoordinationPolicy writer、运行中 Role 切换、独立 Agent 聚合、Runtime driver 或新的配置管理框架。不自动接受架构、不从 imports 猜正式边界、不生成空 baseline 解除门槛。缺初始架构时 Goal 可创建，Plan 采用仍按现有治理前置返回 incomplete；无 baseline 的调查/初始规划是后续 R5 的真实执行接线问题。

最小验收路径：空 SQLite → 正式 Project/Workspace → 正式 Goal → 政策安装/启用 → 真实 `architecture.adoptInitialArchitecture` → Host `plans.proposePlan/applyPlanChange` → 关闭重开后查询 Goal/Plan 和重放初始化原回执。途中不得调用 raw Store commit 或复用已预置 scope/governance 的 task-claim fixture。

## 2. 已核源码、复用与合法 owner

| 事实/旧符号 | 已有能力与本批使用方式 |
| --- | --- |
| next `contracts/ledger.ts:ProjectSnapshot/WorkspaceSnapshot`；`work-graph/persistence/record-codecs.ts` | 两种正式快照都是 `{ref,revision}`，已有 schema、纯 encode/decode、canonical key；原样复用，不给 Workspace 填第二份 root 或权限配置。 |
| next `tasks/task-service.ts:createGoal`、`persistence/graph-repository.ts:readGoalScope` | 真正 Goal producer 已有；必须先存在本项目的 Project/Workspace。R5a 不复制 Goal compiler。 |
| next `tasks/plan-readers.ts:PLAN_GOVERNANCE_RECORD_SCHEMAS/resolveGovernance/completionPolicyDigest` | 政策 revision/active schema、精确读取及消费者已存在；摘要是整个版本化政策对象的 JCS+SHA-256。补 writer，不复制 schema 注册或第二套 digest。 |
| next `architecture/catalog-service.ts:adoptInitialArchitecture` | 已原子写 baseline、catalog、active pointer；同项目 scope 已存在即可调用。本批只复用实际接口。 |
| 旧 `contracts/bootstrap.ts`、`control-engine.ts:bootstrap/buildBootstrapArtifacts` | 可参考 revision-1 Project/Workspace fold 和真实 actor/event 归因；旧命令是多项目、全账本 only-if-empty 初始化。目标单项目注册不搬 BootstrapManifest、不搬全账本空库锁，也不声称保持旧命令身份兼容。 |
| 旧 `contracts/workspace-registration.ts`、`control/control-engine/workspace-registration.ts` | 复用已登记 Workspace 不覆盖的语义；不迁回扫描全部历史事件查 registration 的循环。新请求读本地 scope，原请求沿 Store receipt 定位事件。 |
| 旧 `contracts/governance.ts:CompletionPolicyRevisionSnapshot/ProjectCompletionPolicyActiveSnapshot/governanceContentDigest` | 原样迁入 next 尚缺的两个纯快照类型，保留 contentRevision 与行 revision 的区别、原摘要字节规则。 |
| 旧 `contracts/validation/governance.ts:validateCompletionPolicyContent`、`control/control-engine/governance-install.ts/governance-activate.ts` | 提取政策专用纯结构检查：版本、非空 requirementKinds、正整数 minimumRequiredRequirementsPerObligation、可选字符串数组 fastPathDiffClasses；沿安装不可变 revision、启用精确 pin+active CAS 的 fold。不要移植整个旧 Control/StateLedger/validation 目录。 |
| next `workspace/access.ts:WorkspaceAccessFactory` 与 `composition/create-platform.ts` | 唯一受信 root/权限仍来自现有 Host bindings，access 留在实际目录使用边界。登记服务不依赖 access；现有生产桥从已存在的领域 Workspace 读取 revision，不能用它作为创建该记录的前置。 |

Project/Workspace 的正式归属及政策记录由 WorkGraph 持有；RecordStore 只提供原子提交。Host 持有目录映射、身份与授权配置，WorkspaceTools 核实际目录访问。R5a 不在 Workflow 建另一份项目库，不把 `ctx.principal.kind=host` 描述成用户可自报的授权。

## 3. 拟冻结公开接口

在 `work-graph/configuration/project-bootstrap-contracts.ts` 声明两个小 Port；`GraphWrite`、CoreCallContext、WriteResult、WorkspaceScope、Snapshot/Pin 均导入现有来源，不复述其结构。

```ts
export interface ProjectRegistrationPort {
  createProject(
    ctx: CoreCallContext,
    request: GraphWrite<{ projectId: string }>,
  ): Promise<WriteResult<ProjectSnapshot>>;
  registerWorkspace(
    ctx: CoreCallContext,
    request: GraphWrite<{ workspace: WorkspaceScope }>,
  ): Promise<WriteResult<WorkspaceSnapshot>>;
}

export interface CompletionPolicyConfigurationPort {
  installCompletionPolicy(
    ctx: CoreCallContext,
    request: GraphWrite<{
      policyId: string;
      contentRevision: number;
      content: CompletionPolicyContentV1;
    }>,
  ): Promise<WriteResult<CompletionPolicyRevisionSnapshot>>;
  activateCompletionPolicy(
    ctx: CoreCallContext,
    request: GraphWrite<{ target: CompletionPolicyPin }>,
  ): Promise<WriteResult<ProjectCompletionPolicyActiveSnapshot>>;
}
```

`CompletionPolicyRevisionSnapshot`、`ProjectCompletionPolicyActiveSnapshot` 从旧纯类型迁到 next `contracts/governance.ts`，字段与已注册 JSON 一致。install 的返回快照含 `ref/contentDigest`，调用者据此组成精确 pin；activate 返回真实 active revision，不能只返回 boolean。没有本批尚无消费者的管理查询矩阵；Goal/Plan 继续使用既有领域读取，初始化重试使用原 requestId/receipt。

组合根公开 `platform.projects: ProjectRegistrationPort` 与 `platform.completionPolicies: CompletionPolicyConfigurationPort`。这是已有 WorkGraph 配置操作的分组，不新增平台 manager。工厂形状：

```ts
export type ProjectBootstrapDependencies = {
  records: GoalRecordTransactionPort;
  now(): string;
  eventId(): string;
};
export function createProjectBootstrapServices(
  deps: ProjectBootstrapDependencies,
): {
  projects: ProjectRegistrationPort;
  completionPolicies: CompletionPolicyConfigurationPort;
};
```

Host 项目映射和权限已由应用可信配置提供；模型不得传 root、权限谓词、Store、actor 或回调。Project 操作/政策操作的 scope 为 ctx.projectId；输入 projectId 或 target.ref.projectId 必须相同。Workspace 登记要求 ctx.workspaceId 与 workspace.workspaceId 相同且 project 相同。只允许受信 Host 的 human/system，work_run/query_run 均 forbidden。创建 Project 无需已存在的 Project 记录，这是本批唯一必要的 scope 起点；不为此放开别的公开 writer。

## 4. 身份、版本和副作用边界

所有方法首 await 前隔离请求与 ctx，保留原 AbortSignal；结构/作用域检查 → 原 identity/fingerprint receipt → miss 后读取本次必要事实 → 编译局部 guards → 单次 commit。原回执从对应事件恢复原 value/cursor，不从当前 active pointer 重建。fresh 检查或提交失败时重查同键回执，处理同键竞争；不要每次 query 执行注册检查。

新命令 identity 使用各自固定前缀加现有 `commandIdentityKey`，隔离四种操作。fingerprint 由完整 scope、实际 actor、输入和经过校验/按完整 ref 排序的 caller expected 计算；不能接受 caller 自带摘要。政策内容摘要由 writer 计算，使用与 `resolveGovernance` 完全相同的 `{schemaVersion:1,identity:{policyId},revision:contentRevision,content}`。不得把 policy 行 revision=1 与 contentRevision 混淆。

| 方法 | caller expected（必须精确提供） | 实际 guard/提交 |
| --- | --- | --- |
| createProject | 目标 Project@0 | Project 缺席 guard，写原结构 revision=1 与一个创建事件；不核全库为空。同项目已存在的新 request 返回 revision_conflict，不覆盖。 |
| registerWorkspace | Project@已读 revision、目标 Workspace@0 | 读/解码实际 Project；guard Project 精确版本+Workspace 缺席，写原结构 Workspace@1 与登记事件。不打开目录、不要求 Host 在登记前返回未来 Workspace revision。 |
| installCompletionPolicy | Project@已读 revision、精确 policy revision ref@0 | 读 Project，核政策纯结构；guard Project 精确版本+目标政策记录缺席，写 immutable revision 行（行 revision=1）与安装事件；不启用、不递增 Project、不造 baseline。 |
| activateCompletionPolicy | Project@已读 revision、ProjectCompletionPolicyActive@已读 revision（首次0） | 读精确 target+active，要求 target 已安装且摘要等于 pin；guard Project、target 实际 revision、active 版本/缺席；仅写 active@old+1 与启用事件。不改已接受 Plan 的 effectiveCompletionPolicy。 |

expected 中缺项、重复、异 scope 或无关 ref 返回 invalid；版本不合为 revision_conflict。0 在公开 pin 表示缺席，编译成 Store `expectedRevision:null`，不能以 0 写入正版本记录。ref 不存在为 not_found；pin digest 不匹配使用现有 `source_stale`，不扩 CoreError；结构不合为 invalid；Host 访问拒绝保留 forbidden/unavailable。取消在 commit 前零写，commit 已成功必须返回 committed。

Workspace 登记是 Host 已授权 scope 的领域注册，不表示目录当前可访问，不创建目录、不 clone repo、不修改 Host root 映射。WorkspaceSnapshot 仍只含原字段且首次 revision=1；事件不保存未发生的目录打开或预注册版本。登记完成后，实际 WorkspaceAccess/capture/Runtime 继续核当前 Host 权限及领域版本：`source-capture-access.ts:resolveRoot` 从正式 Workspace 读取 revision，`execution-driver.ts` 将其与 Run.workspaceSnapshot.revision 比较。该 workspaceRevision 不是外部配置版本；permissionRevision/configurationRevision 仍各用原字段。不为登记反向要求未来版本、不建立跨系统原子或 root 热切换协议。目录不可访问不能抹去已发生的登记回执。

政策启用只推进该项目的 CompletionPolicy 默认指针。允许通过新的 exact expected 启用另一已安装 revision，沿旧启用语义执行局部 CAS；历史 Plan 的精确 pin 不被改写，不扫描全部 Goal/Task，不重算完成，不调用或修改 Role/Run/Session。此能力不是 runtime 热角色切换。future Plan 的政策精确 pin 使用规则归既有未来意图批次，R5a 不改 W1 算法。

## 5. 编码与复用约束

Project/Workspace 继续使用原 `GOAL_RECORD_SCHEMAS` 中的记录 schema；政策继续使用 `PLAN_GOVERNANCE_RECORD_SCHEMAS`。新增仅四种操作事件的 schema/encode/decode，拟固定为 `ProjectRegistered@1`、`ProjectWorkspaceRegistered@1`、`ProjectCompletionPolicyInstalled@1`、`ProjectCompletionPolicyActivated@1`。共同正文为 `{eventId,eventType,schemaVersion:1,occurredAt,identityKey,fingerprint,projectId,actor,requestId,payload:{value}}`，value 分别是该操作返回的正式快照，不含预注册目录身份或外部版本。沿旧安装/启用语义，但采用新事件名称容纳精确历史返回值，不冒充旧多项目 bootstrap 或改变旧 WorkspaceRegistered/CompletionPolicyInstalled 的同名同版本 wire shape。原事件解码仅承担正常回执对应关系与形状，不新增内部篡改防御矩阵。

政策 digest/已存记录读取由现有 `plan-readers.ts` 的政策专用逻辑提供最小导出，必要时提取到同一批已有配置文件并让原 Plan reader 反向复用；最终只有一个摘要算法和一份注册。新增输入检查只移入旧政策专用纯函数，不复制整体旧 validation。不得为了 bootstrap 新增 Store schema factory、全局注册表、通用授权器或事件扫描回执恢复。

## 6. 精确候选写 scope（中审后再冻结）

以下路径相对 `coding-platform/next`，预计 **6 个生产文件 + 2 个测试文件**：

1. `src/contracts/governance.ts`：迁入两个缺失 Snapshot 纯类型；若提取 digest，同文件只增加这一政策纯函数。
2. `src/core/work-graph/configuration/project-bootstrap-contracts.ts`（新）：上述 ports/deps，不增业务状态机。
3. `src/core/work-graph/configuration/project-bootstrap-service.ts`（新）：四个真实操作与私有小型提交函数；不拆四套服务框架。
4. `src/core/work-graph/configuration/project-bootstrap-record-codecs.ts`（新）：四种新操作事件和必要纯输入/fold；复用旧记录 codecs。
5. `src/core/work-graph/tasks/plan-readers.ts`：仅政策摘要/既有记录解码的窄导出或消费提取结果；不改 Plan 采用/资格语义，不重复登记 aggregate schema。
6. `src/composition/create-platform.ts`：同 backend 创建两个服务，合并新事件 schemas，接既有 close/drain 追踪并返回公开 ports；不暴露 backend。
7. `tests/work-graph/R5a-project-bootstrap.test.ts`（新）：本批四操作独有的边界/局部竞争。
8. `tests/composition/R5a-project-bootstrap-platform.test.ts`（新）：真正空 SQLite 的公开消费者闭环。

既有 `persistence/record-codecs.ts`、RecordStore、Architecture、Goal、Plan service、Runtime、Workflow、Role 配置都先只读。若发现必须新增类型导出或工具检查项，主审先审实际缺口再调整 scope，不自行扩大。无需新 test helper；两测试可各自创建真实 backend/临时目录，不复制 task-claim 夹具矩阵。

## 7. 最小消费者验收与失败语义

1. **空 SQLite 实际链。** 用空目录 createTargetPlatform 和受信 workspace Host 映射，公开注册 Project/Workspace、创建 Goal。安装政策后、启用前，真实 Plan 采用因治理缺失失败；启用后但无架构仍失败。给出有实际模块/职责/路径的 fixture catalog，通过已有 `adoptInitialArchitecture` 正式采用，再用 Host propose/apply 接受完整 Plan。queryGoal/queryTaskGraph 读取真实结果。不要用 raw seed、fake read、伪造 completed receipt 或提前导入测试账本。
2. **持久回执与幂等。** 关闭重开同目录，通过相同四请求取回原 value/cursor/replayed；同一 identity 下仍满足结构和 scope 的 content、目标或 expected 变化产生 idempotency_conflict；无效 expected 先 invalid，异 scope 先 forbidden，不能把改变 ctx 项目形成的另一 identity 当作重放。对新 request 不覆盖已有 Project、Workspace 或 immutable policy ref。政策后来另行激活仍能重放原启用回执，不返回当前指针伪装历史。
3. **项目局部创建与登记。** 第二项目可在非空库正式创建；给已有 Project 登记第二 Workspace 不要求 ledger 空、不修改首个 Workspace。跨项目/工作区 ctx、新增 work_run/query_run 调用拒绝。正式登记成功后，通过现有公开 Workspace 访问入口验证 Host 拒绝时不可读、允许时可读取真实临时目录；访问使用已登记的领域 revision，不用 fixture 预报未来版本来让登记通过。目录访问被拒仍可重放已发生的登记回执。
4. **政策精确版本与并发。** 正式安装第二内容 revision；错误 digest/异项目 target/未安装 target 拒绝启用。两条不同启用请求使用同 active pin，至多一条成功，另一条 revision_conflict；同键竞争恢复原回执。已经采用的 Plan 仍引用原政策 pin，Role/Run 不受写入。
5. **调用隔离/取消。** 在真实必要读取边界取消原 signal，零正式写；实际提交成功后的晚取消保留 committed。覆盖四操作共享的提交接缝即可，不复制 Store 全矩阵或内部损坏数据反例。

骨架测试不得通过 raw seed 越过缺失前置后宣称消费者绿。阶段一新 writer 保持明确 unsupported，后段消费者尚未到达的断言如实标注；阶段二由独立主审检查真实空库链。检查建议：next-types、这两个新 test targets、邻接 next-plan/初始 Architecture 精确相关 tests；不因一次通过宣称 R5/无 Plan 初始规划完成。

## 8. 骨架阶段派发边界

只读范围宽、写范围严格按 R5a-project-bootstrap-skeleton-scope.json；新文件由主审先创建。原地写入，不用同级临时文件rename。先读当前HANDOFF、CODE-QUALITY-GUIDELINES §2.1、DSH-WORKFLOW/DSH-EXECUTION-HARNESS及本任务所列真实上下游。

本轮只交完整DTO、窄注册/组合接线和真实目标测试，四个新writer均明确unsupported，新增事件codec可以明确未实现，不提前实现提交/回执/政策安装算法；原有Goal/Plan/schema/公开读必须保持。不用rawseed伪造空库链。新方法到达后的预期红与前置错误分别报告；少量必要旧绿测、next-types通过后STOP，等待中审，不继续第二阶段。

检查：python3 tools/dsh-refactor/check.py next-bootstrap next-plan next-catalog；next-types/next-architecture单独运行。不可为了骨架绿而断言unsupported或跳过最终行为；新测试断言最终真实用户路径。既有类型/解析导出可正常复用，不把本批stub灌入旧消费者。主审后再冻结测试和实施scope。

## 9. 骨架中审返修：仅完善真实测试后再冻结

主审已确认现DTO/单一摘要抽取/四事件注册方式/组合根tracked接线方向可保留；四writer与新事件codec继续明确未实现，不进入第二阶段，不改其他生产文件。GraphWrite从tasks/contracts导入可接受；无需空注册掩盖实际schema。以下只修改两个本批测试，沿现有成功case补关键断言，不铺Store通用矩阵。

1. 异项目target.ref.projectId输入违反ctx scope，activate应forbidden；expected中异scope pin仍按原invalid规则。不要把两者混淆。
2. 原同active pin竞争只是不同request，保留其一胜一冲突；原事后串行replay不叫same-key race。在同一case或一个小case用两个同identity真实调用、真实lookup miss窗口证明恢复同cursor/value，不能靠seed或伪造commit。
3. 原late cancel在方法已返回后abort，无验收价值。使用真实records.commit包装：等待真实commit返回committed，再abort原signal，随后把真实结果交还service，必须仍committed；before-commit取消放在真实必要lookup/read await边界，核零正式写。不要新增任意回调生产接口。
4. 空库链的未激活政策拒绝不能同时缺architecture而声称独有因果。保留已启用政策但缺architecture的检查；补另一个Goal/项目或在采用architecture后、尚无有效policy处验证单独缺policy，尽量复用已有流程。也可用实际active记录缺席+明确合并治理限制说明，不为测试重造治理。
5. Host permissionRevision用与领域workspaceRevision不同的值（如host-grant-7），核Project/Workspace登记不调用resolveRoot/authorize；真正workspace访问再走Host绑定，领域revision从登记真实结果获取。
6. 政策digest不要只与同一生产函数比较；选固定规范JSON字节及独立SHA256值核原协议，contentRevision=2明确断行revision=1。无需新增摘要算法到生产。
7. 在现有成功case按真实cursor/eventAt直接断actor、requestId和payload.value，证明正式回执归因；不要扫描全部事件或构造内部损坏反例。

异步夹具遇骨架unsupported应及时结束并报告准确首红，所有barrier在finally释放，避免只等尚未到达的promise超时。新writer首红遮挡后段的情况继续明确列出，不能宣称这些后段已经运行成功。独立基线旧39项通过，15个新目标红；修订后跑next-bootstrap next-plan next-catalog与单独next-types，然后STOP再次交中审。
