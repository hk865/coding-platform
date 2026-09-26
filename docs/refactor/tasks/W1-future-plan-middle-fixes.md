# W1 骨架中审返修：先修正确可达的行为契约，再进入实现

继续当前 Stage 1 Session，原 7 生产 + 2 测试 scope 不变；仍不实现业务。读原任务、WorkGraph §5.1 与实际 Claim/Store/Plan。编号齐全不等于风险已验证，以下是主审实际发现的错误。返修后停下再次中审。

## 生产骨架的收敛

- `FrozenTaskDefinition.carriedObligationIds` 只能比身份，不能校验验收正文/强度/verificationRequirements。改为完整义务语义切片（例如 `readonly Omit<AcceptanceObligation,'taskIds'>[]`，身份已包含其中）；只排除其他任务承担者列表。在同一纯 helper 提供提取函数接点供 validator 与 reader 复用，不让两边各造 parser；先声明/unsupported，仍不实现。
- `selectAcceptedLeaseHolder` 的 holderRunPlanRef 无法判断跨版 basis/版本，且只是未用的转发函数。删除这个额外接点；在已有 canonical reader 使用已经筛选合法的 Run 集投影 holder，复用同一个接受判据。
- `readFutureChangeTaskFacts` 不必构造完整 CanonicalTaskState Map。未来性检查成功只需返回精确缺失 guards（与必要读水位）；发现执行痕迹返回具体失败。保持定向查询，不因为复用类型而复制完整状态装配器。
- `readOriginPlans` 的批量目标来自实际 Run/Reduction 所引用的 Plan，并核对相关 basis 定义来源；不是只读 selected.basis 指向的 Plan 而漏掉实际 origin。内部具体返回类型可在既定职责内收窄，不新建接口/模块。

## 修正当前必错的测试

1. composition 的 edit-first 当前 `applied committed` 后又要求 Goal.active 仍旧Plan，正确实现必失败。成功应指新Plan；失去竞争的一方不产生孤立 Run/占用/Plan。work split成功后的 active 同样不能再要求原P1。
2. composition 当前修改已经 seed running 的 refine、且 target.planRevision 与 source同为2，却要求成功。这不符合future-only。改为真正未执行任务，target=source+1。真实组合根测试走 propose→apply 成功→关闭→重开→重放/历史查询；不能只有原始seed未来快照冒充采用。
3. split负例要各自基于可用 active source/独立 fixture，不能成功拆分后仍basedOn旧P1而只测试stale。`o-solo` 必须是source已存在且B独占的required义务，候选取消/optional替代才真正触及覆盖规则；不能新增义务后被unsupported提前挡住。

## 让重要反例真正可达，集中在现有场景中

4. 场景1/2采用后必须 queryTaskGraph/queryReadyTasks，断言 A running + 原Run、C satisfied + 原Reduction，不能只查新快照basis与旧字节不变。再在合法同Goal完整basis下篡改对应义务正文/强度/verificationRequirements，reader须 unavailable；形状invalid不能代替语义不一致。原source无basis v1/v2读取保留。
5. 无关历史追加必须用真实 records 包装器在本次读取与commit之间插入（断言确实进入该点且提交成功），不能在调用前seed，更不能 `.catch(()=>undefined)` 吞失败。读A相关最新事实即可；新W1写不使用ledgerHorizon。
6. SQLite竞争必须让两边基于同一个旧source完成读取，然后按两种次序提交。可在已有 records.commit 依请求identity/写集合加受控barrier，复用TaskClaim fixture；无需修改Store/Claim。claim-first检验Lease缺失guard，edit-first检验Goal guard。所有barrier finally释放/等待。只按串行API调用只能证明顺序拒绝，不能证明竞争边界。
7. 场景5增加可控 `lookupCommit miss → peer 同identity提交 → 原调用读到accepted proposal/新Goal` 窗口，必须返回原receipt；复用已有查重接口，不作mock假结果。原请求在后续又一次合法修订及SQLite重启后仍返回原采用结果。同identity不同body继续冲突。不要复制一整套并发测试，合在相应用例/fixture。
8. 历史Lease用例保留，排除后来Run及reason；不要把历史projection误当当前领取许可。提示关系连接运行A的纯描述变更应允许且不重置basis。

测试都描述最终期望；不要一边要求未来采用成功，一边为了当前骨架红测写“unsupported所以active不变”的断言。Stage1红测因未实现，不等于后续断言可随意与规格相反。`expect.soft`也不能代替控制流正确性。为合法基础fixture、barrier可达点、当前明确拒绝分支做足核对，提交报告列每个反例真正阻断的错误实现。

保持测试数量约原来的规模，新增少量独有断言，不复制整个后端矩阵。不要以盲目增加setup/seed体积解决；复用现有fixture。类型检查、W1专项红测、R3c-plan-adoption一次。报告真正限制/不可达原因；完成后停止，中审前不实现。
