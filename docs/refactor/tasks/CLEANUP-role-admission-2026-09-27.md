# 清理第一批：同次准入复用角色解析

用户已授权 DSH 探索→主审裁定→DSH 执行。当前生产基线 d0dc9d6cf4b914159a67578dd1de7265fa9bad9d。先读根 AGENTS.md 与 [已审核对照](../reviews/dsh-long-context-review-2026-09-27.md)，再定向读本批文件。不是继续全 MVP 施工。

**已完成并导入（2026-09-27）：** 同一 DSH Session 分两阶段执行，主审将 Stage1 新增回归合并到原真实执行/冷观察用例，删除重复第三条用例与固定六阶段次数断言。修复前额外解析为4次，修复后为0；保留原2条行为用例。三生产文件+一既有测试导入；独立隔离4文件/41项、Node/UI类型、边界与物理构建通过，见[证据](../reviews/evidence/cleanup-2026-09-27/role-admission/verification.json)。生产物理行净变化0（删除重复实现、增加内部输入和说明），测试净+17行；不把本次描述为大规模减行。未推送，未执行其它清理候选。

## 主审冻结的接口与边界

- `src/core/work-graph/tasks/execution-entry-contracts.ts` 的内部 `AuthorizeConfigurationInput` 增加必填 `roleResolution: RoleSpecResolutionV1`（复用既有类型）。这不是模型/HTTP 可提交字段。
- `execution-entry-service.ts` 的 `recheckHostRoleAdmission` 已完成一次 `resolveRoleBindingFacts`；把成功且已检查的 resolution 传给 authorizeConfiguration，保留原 roleFacts/guards、现有 manifest 一致性、Host 与材料/控制/提交检查。
- `src/composition/create-platform.ts` 的 Work `createAuthorizeConfiguration` 只消费该 resolution，不再接收 roles 参数、不再重调 resolveRoleBinding；仍调用现有 Host 配置并检查原权限 ceiling/template/configurationRevision。向 Host 传 resolution 的副本，避免本次复用改变对象隔离；不要新增防御框架、缓存、锁或热切换机制。
- Query 的独立同名契约原本已有 roleResolution，不改。没有改变 active Role/pin 策略、没有合并许可签发/消费、没有删动态材料撤权或 CAS，不改其它候选。

## Stage 1：仅现有测试后 STOP

可写仅 `tests/composition/B2-runtime-platform.test.ts`。先复用已有真实组合根 prepare→start→冷观察用例，不建立新fixture。必要时在该文件添加一个小的调用工作量回归：用真实角色服务工厂配合窄spy，证明同一次 Work 准入不再通过组合根重复 resolveRoleBinding，同时真实 Run 正常结束、冷观察不再发 provider。不得用假的 authorizeConfiguration 替代组合根，也不得通过返回固定Role绕过真实服务。

本轮清理的重复调用次数是被验证的改进，不新增宽泛的恶意修改/重启/并发矩阵。保持原两条行为用例及断言，新增部分约40行内；不能修改生产接口或实现。跑该文件一次，记录预期失败必须来自冗余解析仍存在，而非setup/type/fixture失败。提交报告并STOP，由主审冻结测试后进入Stage2。

## Stage 2：仅三生产文件

只有主审显式发第二阶段提示后，才按上述接口修改三个生产文件。测试只读。删除重复路径，尽量净减实现；不改变其余生命周期语义。跑本文件与现有 B2-model-request，再跑类型检查；主审按真实共享消费者补必要检查，不反复扩矩阵。

写范围由独立 runner 单文件挂载；禁止原子rename替换，使用原地写入。无权限时不要升级/放开目录。只读依赖不限于本批文件，禁止读凭据/旧lane/外部工作区。
