# M2：材料读取事实与局部事务 guard 骨架

状态：2026-09-26，主审批准方向，已批准第一阶段任务。仅新增窄事实读取端口与显式 unsupported 骨架、独立行为测试。不得提前实现；交付后停止等待主审中审。生产施工范围相对 coding-platform/next，原 coding-platform/src 只读。

## 1. 问题与复用

B2 authorize、fresh begin、model issue、fresh consume 在同一事务中提交执行许可或模型消费。现有 MaterialPort.openArtifact(current) 会重核真实 grant/source，但只返回 ArtifactRecord，最后一次授权读取与 B2 提交之间仍可发生撤权。只 guard Run/Session 无法阻止已被撤销的材料继续进入模型。

必须复用：

- materials/material-service.ts：createMaterialService、openArtifact 的真实上下文/工作区校验、正文完整性、取消和错误语义。
- materials/applicability.ts：createMaterialAccessResolver、createMaterialApplicability、现有 grant/current/history/owner/basis 判断。不得复制授权算法。
- materials/record-ports.ts：MaterialAuthorityReads.load 已返回 found(snapshot.ref/revision)、明确 not_found(ref)、unavailable；足够产生局部 guards，不需增加数据库查询协议。
- materials/record-readers.ts：createMaterialRecordReaders 的真实 RecordStore canonical 读取与注册候选 lookup。
- core/workspace/source-applicability.ts：materialSourcePinIsCurrent 与真实 SourceApplicabilityPort；没有 provider 时必须保持 current 失败语义。
- configuration/contracts.ts 的 RoleBindingFacts 模式：结果与该次判定使用的局部 guards 一同返回，不能用随后另读的版本替代。

不新增数据库、授权管理器、Plan 公开端口、全局 commit horizon、全源码锁或第二套材料 authority。MaterialPort 原接口和现有消费者保持兼容。

## 2. 冻结接口

在 materials/contracts.ts 追加 WorkGraph 内部接口，RecordGuard 从现有 RecordStore ports 导入，不进入共享 contracts：

```ts
export type MaterialReadFacts = {
  result: ReadResult<ArtifactRecord>;
  guards: readonly RecordGuard[];
};
export interface MaterialReadFactsPort {
  openArtifactFacts(
    ctx: CoreCallContext,
    input: Parameters<MaterialPort['openArtifact']>[1],
  ): Promise<MaterialReadFacts>;
}
```

新 materials/material-facts-service.ts 导出：

```ts
export type MaterialReadFactsDependencies = {
  authority: MaterialAuthorityReads;
  index: MaterialCandidateReads;
  bodies: RawArtifactStorePort;
  sourceApplicability?: SourceApplicabilityPort;
  now(): string;
};
export function createMaterialReadFactsService(
  deps: MaterialReadFactsDependencies,
): MaterialReadFactsPort;
```

组合根将同一 backend.records 产生的 authority/index、同一 bodies 与可信 source provider 注入。source provider 不由模型或请求字段指定。此端口只有读取方法；不对调用者公开 tracking 对象、裸 body 或调用方 guards。第一阶段方法统一返回 result=rejected/unsupported、guards=[]，不实现 collector 或算法。

## 3. 第二阶段实现约束（第一阶段仅写职责注释与测试）

每次 openArtifactFacts 创建一次局部读集合，调用完成即销毁，不在实例或全局共享 mutable Map。同步固定 ctx/input，保留原 AbortSignal；包装本次 authority 与 index，再组合现有 createMaterialAccessResolver 和 createMaterialService，调用其正式 openArtifact。完整上下文校验及 workRunWorkspaceBound 也必须使用本次 tracked authority，不绕过普通服务准入。

- authority.load 成功 found：验证 requested full ref 与 snapshot.ref 一致，记录 canonical refKey + snapshot.revision。
- 明确 not_found：验证返回 ref 与请求一致，可记录 expectedRevision:null；损坏、unavailable、未交代的结果不当作 missing。
- 同一 key 重复观察完全相同版本可去重。出现两个不同版本或 missing→found/found→missing，事实窗口冲突，返回 rejected/revision_conflict、guards=[]；不能 latest-wins，也不能用第一次或最后一次版本掩盖混合判据。
- canonical authority 或 candidate provider 的 unavailable 应被该次 scope 记住并 fail closed 为 unavailable，避免旧 resolver 将失败投影为 [] 后被误解释成没有 grant。原有合法 forbidden/source_stale/unsupported/not_found/cancelled 语义不改写为成功。
- 仅 result=ready 时交付本次完整 guards；失败 guards=[]。所有 guards 仅限本次实际读取的 authority 记录：reader Run/QueryRun、Goal、Workspace、canonical MaterialAccessGrant，以及历史路径实际使用的 owner/源 Goal/Workspace。index 仅找候选，不把投影当授权；不添加全局 horizon 或 candidate 集合版本锁。授权是存在一个有效精确 grant，新的无关 grant 不应使提交冲突。
- 候选发现后的正式 grant@1 及 currentBasisValid 最后再次读取的版本均在同一 collector 中。撤权后 grant@2 不得被旧候选接受。若多个候选引起额外局部 guards，允许保守冲突；禁止扫描全账本。
- 只复用 MaterialPort 正文校验，不额外创造来源/正文权威。facts 不代表持久许可；每个 fresh B2 屏障必须重新调用。原幂等回执恢复不受后来撤权影响，重放不触发模型。

## 4. B2 与 Plan 的接线约束（本 lane 不写）

不新增 PlanTaskInputFactsPort，不改 plan-service.ts。B2 已从真实 WG11/Plan/Goal 读取并 guard 正式 PlanRevision 与 Goal，但在当前 externalMaterialsProblem 的 unsupported 分支之前只检查 selection 形状；后续 B2 接线必须补 requirementId、consumerTaskId 和完整 ArtifactRef 在正式 Plan.inputRequirements 中的成员核对，不能把本任务的设计要求误记成已有实现。

B2 从已经核实的正式 Run 重建 work_run principal 与 run materialReader/currentBasis（不能用 Host 读取身份绕过 grant），调用 plans.readTaskInput(ctx, exact selection) 核选中正文，再用同一完整 ArtifactRef 调 openArtifactFacts(current)，核返回 ref 与选择完全相同，按 immutable digest 绑定同一正文，合并其 guards 与正式 Plan/Goal/Run/Session/Role 等 guards。不得使用 Prepared 自报的 materialAccessRefs 代替真实 resolver 结果。additionalMaterialRefs 直接走同一 facts/current 路径。选中材料不能因 Prepared 正文由本 Run 所有而跳过 current 授权。

这足以保护 Plan 选择：现有 accepted PlanRevision 是明确不可变的选择版本；Goal 改 activePlan 会改变 Goal revision，Plan 改版使用新的 PlanRevisionRef，B2 的正式 Goal/Plan guards 阻止旧窗口提交。即使底层损坏写者修改同 ref，版本 CAS 仍需阻止混用。B2 合并不同来源 guards 时遇到同 key 不同版本也须拒绝/重新建立完整窗口，不能覆盖。

两次正文读取不获得永久权限：第一次成功、第二次发现撤权即失败；第二次成功后再撤权由提交中 grant guard 拦截。不新增 readTaskInput 公开端口，也不把 Plan 内部 readThrough 当全局事务 horizon。

## 5. source capture 的跨系统边界

真实 source capture 先执行，再做现有 currentBasisValid 的 Workspace/Goal/Run/grant 最后正式读取。facts wrapper 将原 signal 绑定到可信 provider 的 capture 调用（现有 helper 未传 signal 时也不能丢弃本次取消）。取消期间不返回 ready facts。

RecordStore CAS 能保护正式 ledger 授权记录，不能原子锁住普通文件系统。WorkspaceSourceApplicability 通过两次观察检测采样中变化，本身明确不是多文件原子快照。材料 current 表示本次检查所观察到的 source pin 符合；不声称从 capture 到 Kernel 执行期间文件永不变化。不得为了弥补这一跨系统间隙新增全源码锁、将摘要回显当 capture、或者把 historical_explanation 当 current。B2 每个实际 fresh 屏障重新核 source；未来若需要更强执行快照，由 Host/Workspace 另外定义，本批不扩展。

缺 provider 的 current 授权保持 source_stale/既有失败；测试必须显式区分真实材料链装配与测试 source provider。M2 不生产 grant、不宣称完成 M1 source/grant 接线。

## 6. 独立行为测试（5项，不重复旧 Store 矩阵）

新 tests/work-graph/M2-material-read-facts.test.ts，复用已有真实 RecordStore、RawArtifact/Material、Material grant/Task fixture。不要复制第二账本或用 fake ready 代替材料授权。阶段一目标行为应因 unsupported 红，而非非法夹具。

1. 精确 current 材料读取返回真实正文/applicability=current，guards 覆盖该判据使用的 reader/Goal/Workspace/grant 正式版本；不含无关记录。提交只包含 facts guards：无关正式提交后仍成功，证明不用全局 horizon。
2. 在 facts 返回后通过正式可用 grant 写者（未提供时明确领域种子）撤销 grant@1→2；下一笔包含原 facts guards 的实际 Store 提交 revision_conflict，且无目标记录/事件发布。fresh facts 同时拒绝 current；不能仅断 mock 回调次数。
3. 原 resolver 在 source capture 后重读 canonical grant：在 capture 等待中撤权，facts 不得 ready。另以真实 authority 读取窗口中途改变 reader/Workspace 版本制造同key两版，必须 conflict，而不是交付混合 guards。
4. 候选 source/ref 匹配也不能代替真实 current：缺 source provider、错误 pin、scope不一致分别失败；authority/candidate unavailable 不变成 missing或空授权成功。historical owner 正文不能用 usage=current 绕过 grant。
5. 同一服务两个交错调用对不同精确材料/读者保持各自 guards；原 signal 在 capture 期间取消后无 ready 结果。一次调用的版本/取消不能污染另一次。

测试不得把伪 source provider 声称成真实文件系统捕获。若复用 M1 fixture 尚未接入本快照，报告缺口，由主审提供最小 fixture；实现者不能扩大 scope 或放宽 current 规则。

## 7. 精确拟议 scope 与交付

本 lane 仅拟写：

- src/core/work-graph/materials/contracts.ts：追加内部 facts DTO/Port，不改 MaterialPort。
- src/core/work-graph/materials/material-facts-service.ts：明确 unsupported 骨架与本任务约束注释。
- tests/work-graph/M2-material-read-facts.test.ts：独立目标行为红测。

主审预建新增文件并配置 scope；组合根、B2 deps/types、provider 装配与冻结快照由主审处理。不要写 applicability.ts、record-readers.ts、MaterialPort 原实现、plan-service.ts、共享 contracts、生产/测试其他文件。若无法直接复用而必须增加写范围，报告精确缺口后等主审修订，不另造算法。

阶段一报告需求→复用符号→接缝→真实测试结果；类型检查通过不代表行为完成。停止等待中审后，第二阶段才实现局部 collector 与复用装配。

主审执行补充：类型检查用check.py next-types，专项用next-material-facts。可复用tests/work-graph/material-readers.test.ts的明确领域种子模式与原真实RecordStore/Material服务，不声称seed为M1生产证明；完整M1→B2消费链由主审后续组合根验收。禁止复制第二账本假fixture。原地写scope文件，不能rename/probe。交付骨架/测试后停止。
