# R4.3a 骨架中审：只补真实控制正常路径

2026-09-26。原 session `session-7ffe634d-e8f9-41a4-a209-8692ac461333` 已 STOP。生产骨架职责与可选依赖接线接受；本轮仅修原两份目标测试，原十五文件 scope 不扩大。**不开始控制实现，不重跑已自检61项邻接，不加生命周期排列矩阵。** 继续当前 lane/原session，保留所有生产骨架与共享 fixture。

中审没有要求“测试更漂亮”，而是当前三项测试缺少本批明示的两条正常行为，且未知结果来源不是所需真实行为：

- pause 当前只有一组调用，不能验收 group boundary 后第二组未启动；本批必须接两串行组。
- cancel 没有一条成功取消并释放的正常链；composition 仅无 handle 查询，未验公开入口接到活跃 driver。
- unknown 工具直接返回自制 `error.code=outcome_unknown`，它没有证明真实 cancel drain 超时；这是测试制造结论，不能作为已经覆盖原Kernel未知收尾的证据。

## 有界修订（保持两文件、合计四条流程）

1. 原 runtime pause case 改成一次模型声明两个串行工具组。第一组真实 in-flight，submit/deliver pause；实际executor、required result sink或owned resource close仍未收尾时原intent保持queued，公共observe也不能释放；放行后第二组零started、真实run.paused、原Session/Lease仍占用且ack applied。沿原 Kernel 注入接缝挂门闩可以，但不能给本来拒绝的模型动作加假领域权限。使用真实SQLite（原 makeFixture 默认 memory 不符合本批声明）。核 ack 的 eventId/sequence/position 与原 `agent.event.payload.event.meta` 和 SessionRecord 精确对应，不能只检查非空。
2. 原 runtime unknown case 使用真实工具忽略signal并持续悬停，由原Kernel drain timeout产生 `tool.outcome_unknown` 与正式结果；不要自行构造该错误。submit/deliver cancel 后保留原副作用未知和占用，不假取消成功。finally解除测试门闩并排空，沿实际running结果与门闩race，不挂死。明确核真实reducer与transcript中的unknown事实，不能用toolBatch空当已停止。
3. 在同runtime文件加一条本批原§11.7第一条的进入正常链：真实begin之后、before_model补entered之前submit pause；随后可信Host fresh配置拒绝新动作，真实已发生进入仍记录并run.paused，provider为零、占用保留。原expected Run pin竞争及真实来源固定来自公开操作，不raw改Run/Role。无需另加此项交叉矩阵。
4. 将原composition case升级为真实活跃单工具cancel正常链（未启动下一组的普通取消归R4.3b，不在此提前验）：公开platform.controls.submitControl→platform.runtime.deliverControl→实际协作取消的原terminal/清理→readControl applied/cancelled→原Run终态/同代占用释放。同case末尾保留无匹配handle不启动恢复、内部writer不公开的原断言。不要仅用自建Runtime证明composition内同实例。

只补以上用户可达正常行为与原task明确的未知副作用边界；不补原候选§11.7第四条排列竞争（已有共同幂等基线继续复用）。合法extension只作为可控工具执行时间接缝，Host/manifest权限必须如实；控制结果/历史/占用由原正式owner产生，不能seed entered/paused/terminal/ack或以返回值代替历史。

本阶段仍明确unsupported，首红应来自目标新入口；后段未达按原任务如实报告，门闩必须finally清理。运行固定 `next-control-runtime`、`next-types`，生产未改无需再次完整边界/邻接。报告四条流程首红/后段未达及两文件hash，然后STOP；这是最后一次骨架范围修订，随后实现及必要真实缺陷修复，不循环扩测试。

## Astra 局部中审修正与冻结

第二 attempt STOP 后独立核出三项测试前态/时序问题，root 授权 Astra 只在原两文件局部修正：让原 entry 闭包捕获的同一 Host provider 看到 fresh 拒绝；unknown 等待使用 8s 自有 deadline/running race 后 finally 无条件放门闩排空；协作取消允许合法快速 applied，同时保留最终 terminal/同代释放断言。无新 case、无生产改动、无新 DSH 轮次。

重跑 next-control-runtime 四条均在新入口 unsupported 预期首红（2.13s 无挂起），types pass。query_middle_review 已独立放行 13 个生产骨架文件；audit 无越界/主区基线漂移，按原 originalAllowedHashes 精确导入 15 scope 文件（14 实际变更，execution-entry-service 原值保留）。契约/测试/组合根冻结，后续只按 Stage2 scope 实现。证据 [`r4-control-runtime-skeleton-import.json`](../reviews/evidence/next-b2-2026-09-26/r4-control-runtime-skeleton-import.json)。
