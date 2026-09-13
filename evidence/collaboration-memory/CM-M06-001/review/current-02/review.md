# CM-M06-001 current-02 有界独立审查

最终收尾状态：R03、R04 均已修复并由本 Agent 定向复验；本次范围内未发现新增开放关键缺陷。以下按审查阶段保留问题与修复经过，以文末 R04 收尾为准。这是工作版本有界审查，不是冻结 Gate 或整票 PASS。

角色 readonly-design-review。非冻结验收；实施者并行修改中。未修改源码/上游文档、未跑全量。2026-09-13。

## 结论

同 admission 原子保存观察前缀的设计可以成立，不要求新增资格聚合。当前 Control 独立调用可信观察端口，Ledger 重算 canonical 完整候选前缀与 exact grant/CAS，未发现只传调用方 readable 即走真实 Control 的入口。本轮发现一项待收敛观察语义问题 M06-R03；不能据此宣称 M06 整票或整批 PASS。

## M06-R03：瞬时来源读取失败被固化为 stale 前缀（P2）

复现：repro-revoked-overlap.mjs 后半段，真实 ArtifactVault、createMaterialAccessResolver、AlternativeReportMaterialCompiler 和 qualifiedAlternativeReport；仅 ledger/index 为隔离 canonical fixture，source capability 在第 2 次 capture 返回 unavailable，其余均返回同一合法 pin。两份正文真实存在，两个 exact grants 均有效；没有 workspace/goal/grant 版本变化。

实际：第一候选 outcome=stale，第二 readable，transientWinner.conditionIndex=1。首次及后置 capture 均成功不代表 Vault 中间读取也成功；materialSourcePinIsCurrent 将 unavailable 压成 false，Vault 再统一映射成 stale，compiler 因此跳过未能判断的第一候选。

预期：若当前观察能力不可用，整轮 unavailable 并保持 Wait active，下次重新观察完整前缀；不能把 unknown 当作确定无效。最小修复是 Vault 返回 stale 时整体 unavailable（当前 exact grant/basis 已先行校验，revocation 单独处理）；更广泛方案是扩展 resolver/Vault 失败分类，但本票不必展开。

执行：WSL 在产品根使用 Node v24.18.0：
`node --import ./tests/coordination/process-loader.mjs evidence/collaboration-memory/CM-M06-001/review/current-02/repro-revoked-overlap.mjs`
日志 repro-revoked-overlap.log。此复现证明组件组合行为，未执行完整 Host admission。

## 审查中已修正并独立验证的组合

第一报告 exact grant 已撤销，同时存在同 reader/basis、覆盖该 body 的多材料有效 grant。旧 compiler 可因通用 Vault open 经另一 grant 获准而标 readable/break，然后 exact-grant validator 拒绝，阻塞后续有效报告。实施者收到审查反馈后已改为明确 refused/continue。

本轮实际运行到修复后代码；脚本前半段输出 refused(first)、readable(second)、winner=1 并断言 PASS。没有旧版本运行 FAIL 证据，故不把它列为开放缺陷。

## 其余边界核对

- 候选来自 canonical DeliveryRecorded 游标顺序，关联目标 Work、原 DirectedRequestResponded 和当前不可变响应；Ledger 再折叠，完整证明不得跳过前缀。任意较早新候选或引用版本变化可使前缀不匹配/CAS 失败。
- Control 保留 predecessor、Workspace、Goal、policy/role 与每个观察 grant、Delivery、request 的版本守卫；grant 在观察后撤销使准入失败。失败发生在 admission 写入前，零可读保持 Wait active；Dispatch 使用既有 intent 重试。
- exact inspection grant 的投影可见性检查已加入 compiler；投影未包含对应 ref+revision 返回 unavailable，避免常规投影滞后被 general Vault resolver 当成 forbidden。这是当前代码静态核对，本轮未额外模拟投影重建并发。
- Preparation 同一 basis 的 deterministic exact grant 已存在即不重发。撤销仅作用于该 grant；source pin/basis 变化会产生不同 ID，不能把当前实现描述为跨所有未来 basis 的永久 report-wide deny。
- 外部文件正文/source 没有 SQLite 事务锁。当前证明是本次可信观察结果，Ledger CAS 保证 canonical 元数据新鲜；不能证明外部文件在最后 capture 到 commit 的间隙绝对不变。后继 Context/provider 复核仍必需，admission 不是“模型已采用”。无新增跨重启复用证明路径。
- 候选超过 64、事件扫描超过 200000 时显式 unavailable；安全失败而非随意截断，但这是可用性上限，应保留产品边界说明。

## 证据复用与限制

已读取 qualification-02.log（8 passed /19 skipped）及 host-qualification-03.log（真实 Host 3 passed）。这些是实施者既有定向证据，不称为本 Agent 重跑，也不扩张为当前不断变化源码的冻结验收。

本轮独立脚本所有数据驻内存，无真实工作区数据污染；证据唯一写入 review/current-02。产品文件 hash 见 reviewed-files.sha256，记录审查收尾时的工作版本，不代表全树冻结。

## 收尾更新：R03 已修复；新宿主记录生命周期缺口

上述 R03 后实施者将 opened.code=stale 改为整轮 unavailable。本 Agent 重新执行同一隔离脚本：captures=3、transient.status=unavailable、transientWinner=null，断言 PASS。R03 关闭，日志已更新为修复后结果。

接线同步改为 Dispatch 准备并观察 → Host-owned AlternativeReportObservation.record → Control 只消费已完成记录。新文件 src/harness/alternative-report-observation.ts，两个 harness 直接注入记录对象；这一依赖方向避免 Control 间接触发 Context/Vault。

**M06-R04（P2，生命周期设计缺口）**：Map 仅按 wait/predecessor/candidates 键保存结果，observe 时删除；无 invocation scope，也无未消费结果的 finally 清理。coordination-drive.prepare 后 loadBinding/resolveAdmittedDeliveryRefs 可能返回；Control 在 observe 前也有权限/策略校验返回。这样的调用没有消费记录，后续相同键仍拿得到旧观察（外部 source/body 状态变化不在该键中）。脚本最后的组件反例 record 后模拟调用终止，再 observe 同输入，仍返回 observed；未做完整 Host 故障注入，不宣称已复现真实产品误准入。

最小收敛：prepare 返回一次性 handle/dispose，并让 Dispatch 整个 admission 在 try/finally 中撤销未消费记录；准备新轮次先清除旧记录。若要求严格只允许该次调用消费，还应绑定 per-attempt nonce/capability，否则并发相同键调用可互相消费记录。单纯 TTL 或 Map size 上限不等价于本次观察。

目前开放事项为 R04 的生命周期收敛，R03 与 exact-revoked/overlap 组合均已独立验证修复。未冻结验收，不影响 M06 范围之外票的判断。

## R04 收尾：已关闭

最新代码 record 返回随机 token+dispose，Map 按 token 分离；Control 只用当前 command 的 token 及精确 wait/predecessor/candidates key 取已完成结果。无 token、已消费 token、版本不匹配均 unavailable，匹配失败也消耗 token。Preparation 返回 handle；Dispatch 的外层 try/finally 覆盖 prepare、binding/refs 解析、Control 返回、失败收敛与异常，统一 dispose。prepare 在 record 后直接返回，没有生成 handle 后再等待可失败 I/O 的窗口。

独立脚本复验 PASS：dispose 后不可复用；两个并发同版本记录相互隔离；无 token 拒绝；单次消费；predecessor 版本不匹配拒绝并销毁；新 registry 不接受重启前 token。同时 R03 transient source 与 revoked exact/overlap 回归仍 PASS。实际命令和日志同上，rc=0。只使用隔离内存 fixture，没有全量测试。

静态核对 admitWaitSuccessorFingerprint 删除临时 token，避免每次 fresh prepare 改变持久命令身份；成功 admission 仍保存 qualification，不保存 token 作为授权证明。随机 token 是宿主临时 capability，不是调用方 readable verdict。两 harness 注入 registry 对象，Control 不触发 Context I/O。

本范围无新增开放关键缺陷；新 store 超过 64 条会清空旧条目，是 fail-closed 可用性边界，不能解读为授权放宽。外部文件系统非事务新鲜度等既述边界仍成立。真实受影响四文件集成测试由实施者本轮负责，本报告未冒称重跑其测试。
