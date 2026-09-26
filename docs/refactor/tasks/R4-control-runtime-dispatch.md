# R4.3a 本地控制投递与原历史确认：骨架与测试派发说明

状态：2026-09-27，R4.3a骨架及八生产实现均已中审/独审并精确导入，见[最终导入](../reviews/evidence/next-b2-2026-09-26/r4-control-runtime-implementation-import.json)。固定四流程与types通过；R4.3b取消后同Session新Turn消费者也已[导入](../reviews/evidence/next-b2-2026-09-26/r4-terminal-history-implementation-import.json)。下文保留原第一阶段派发约束与前态，不再是待prepare指令；fresh resume/冷恢复等后续范围未关闭。

唯一施工依据是 [R4 主任务 §11.1–11.7](R4-control-recovery-skeleton.md#11-r43-候选契约持久控制投递进入事实与原历史确认)，精确写范围见 [scope](R4-control-runtime-skeleton-scope.json)。本轮仅授权 R4.3a 第一阶段骨架和两份目标测试，完成即 STOP。§11.8 的 R4.3b projector、R4.4/5 的冷 owner/预算/resume 以及其它后续批均不施工；Kernel patches/dist、原工程、shared fixtures、模型准入服务和 scope 外文件只读。不得安装依赖、改 harness/check.py、生成新管理器或扩大范围。原地写入，不用同级临时 rename。

先读 docs/AGENTS.md、当前 HANDOFF、IMPLEMENTED-CAPABILITIES 相关 R4/B2/组合根能力、CODE-QUALITY-GUIDELINES §2.1 和 DSH-WORKFLOW/DSH-EXECUTION-HARNESS，再沿 §11 所列原 source/provider/consumer 核对。复用当前公开 Kernel run/controlHooks/toolGroupBarrier、原 observer reducer/history cursor 及同一个 raw control service，不复制算法。

## 第一阶段生产边界

发布 §11.2–11.3 的兼容类型、可选 `controls` 依赖、内部 observation port 与公开 `runtime.deliverControl`；新 deliver/observation 方法明确返回 unsupported，不提前执行信号投递、entered 重试、观察归约、ack 或释放。原 submit/read、queued@1、原 Submitted 事件 codec/schema、同 identity 原回执与 R4.1 三处 fresh gates 保持现有行为。声明新 observation codec/接缝不等于实现新 validator，不把原已实现 queued codecs 退回占位。

Runtime 只装配一个内部 control coordinator；同一私有退出/清理 proof 接缝连向 driver 和原 observer，依赖可选以保持旧直接构造路径。正式组合注入同一 raw controls，public controls 仍只暴露 submit/read；deliver 沿原 tracked call，收尾归属已有受跟踪 Promise，不新增公共 close API 或后台恢复。`observed-model-run` 按 §11.5 预置可选 barrier/资源关闭通知的签名与透传接缝；未选择新控制行为时保持旧路径，不把新控制静默忽略后假称成功。具体控制算法留中审后实现。

ack 的来源必须按 §11 绑定真实 `agent.event`：Kernel eventId/sequence 取原 `payload.event.meta`，position 取其原 SessionRecord 位置，不拿外层 recordId 充当 eventId；固定 Run/Turn/Session 与实际消费 intent 的因果关联不能由 caller 或最新指针拼装。暂停允许未启动 pending；退出、清理成功及无未知事实缺一不可。原 reducer 可能清空 toolBatch，但 transcript 的正式 outcome_unknown 结果仍须拒绝释放/恢复；此判据在原 observer owner 完成，不新建错误解释器。Stage1 只冻结接缝与最终行为测试，不提前实现这些领域判断。

## 两份真实消费者测试

只在scope两测试中优先验证公开 `submitControl → deliverControl → 原历史ack → readControl/observeRun` 的正常pause/cancel链：消费真实queued请求、原Session/Run/Turn事件与清理事实，结果和占用沿§11契约裁决。Runtime测试核真实投递/观察，composition测试核公开入口接到同实例，不交叉复制生命周期排列。保留一条真实drain超时/outcome_unknown不释放的必要边界（原case3）；signal已发送或toolBatch清空不是停止证明。正常cancel沿R4.3a实际可达事实验收，§11.8 projector仍另批，不为本轮伪造完成。

§11.7功能契约保持；已验R4.1幂等/竞争/fresh fence、Kernel组await/required sink直接复用，不机械重做五组生命周期交叉矩阵。正常链暴露实际接线缺陷时才加最小对应断言，不新增角色热换、直接篡改持久记录或通用矩阵。

复用真实 B2 fixture、R4.1 writer、SQLite Kernel 和脚本 provider，新 Runtime 可用 `createAgentRuntime({...fixture.deps, controls})`；不改共享 fixture，不 seed entering/paused/control/terminal，不用返回值或发送 signal 代替原历史事实。受控门闩须与真实返回结果竞速，try/finally 释放并等待原运行结束，首个 unsupported 后遮挡的断言逐项标未到达，不挂起直到测试超时。原 public observer 在清理仍悬停时也不能提前释放；不得仅在 driver 尾部加等待而让该消费者绕过。

## 检查与 STOP

固定目标 `python3 tools/dsh-refactor/check.py next-control-runtime`，加`next-types`、`next-architecture`分别运行。已有R4.1与Kernel安全点结果直接作为原语基线，不默认运行广泛邻接；仅实际改动影响既有路径时，由主审指定最小相关集合。不运行Kernel重建/全矩阵，不修改selector。新目标断言最终公开行为，阶段一由明确unsupported首红；原queued producer和无控制Runtime行为保持不变。

交付 scope 内每文件 hash、实际检查结果、每个新 case 的首红位置与未到达后段，然后立即 STOP 等待主审中审冻结。不得继续生产实现，不宣称平台 pause/cancel/resume 完整闭环；R4.3b 后续必须单独派发。
