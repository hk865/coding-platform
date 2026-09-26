# R4.2 Kernel 工具组屏障实现

本任务只实现已审核骨架的工具组 awaited 屏障，依据 [R4 控制任务 §10](R4-control-recovery-skeleton.md#10-r42-精确候选契约kernel-工具组-awaited-barrier) 与[骨架派发边界](R4-tool-group-barrier-dispatch.md)。主审冻结最终测试并刷新只读依赖后才可派发；创建本文不代表已获准开始实现。R4.1、R4.3–R4.5 的平台控制、持久投递、ack、恢复和预算接线不在本批。

## 1. 冻结输入与唯一写范围

唯一写范围由 [implementation scope](R4-tool-group-barrier-implementation-scope.json) 指定，相对 `coding-platform/next` 仅五文件：

1. `vendor/coding-agent/patches/core/runtime/loop/runtime-runner.ts`。
2. `vendor/coding-agent/dist/core/runtime/loop/runtime-runner.js`。
3. `vendor/coding-agent/dist/core/runtime/loop/runtime-runner.js.map`。
4. `vendor/coding-agent/dist/core/runtime/loop/runtime-runner.d.ts`。
5. `vendor/coding-agent/dist/core/runtime/loop/runtime-runner.d.ts.map`。

另外三份受管源 `composition-root.ts`、`resume-composition.ts`、`public-api.ts` 及其产物只读；三 DTO、可选 dependency 和普通 run／已有 executionIdentity 转 resume／公开 resume 的三处透传已经审核，不再改接口。全部测试、构建脚本、control-hooks、SqliteStores、Hook 协议、reducer/schema、ToolDispatcher/Registry、平台 Runtime/WorkGraph/composition 与原工程只读。

冻结测试为 `tests/kernel/R4-tool-group-barrier.test.ts`。**最终 SHA-256 已由主审确认**：`973484cc25714dd53e9d0dd7fa6acee7dd1e42bfd3b2d1f1f27146089d324795`。group3 三方竞速已独审通过，最终独立6红/61绿及types通过，20文件骨架已按原hash导入。该冻结文件是唯一实现验收输入；实现者不得改测试或降低断言。

受管 Runner 骨架 SHA-256 为 `474a908211cce1faf540a0982776aa489e8267e4a090e036eddc0bcaef82436f`。派发快照若不一致，先核对主审导入记录，不重新从旧 map 覆盖源。只从受管 TS 经现有 `scripts/build-kernel-patch.mjs --write` 生成对应产物，不手改 dist/map/d.ts，不修改脚本或构建名单。脚本会重建全部六源／24 项，其他产物须字节不变；若出现额外变化，停止报告差异，不扩大写范围。

## 2. 只在原 Runner 接通决策

替换私有 `#awaitToolGroupBarrier` 的显式 unsupported，复用唯一 `#execute`／`#executeTools`、原分组策略、结果配对、取消排空和事件提交。不得增加第二模型循环、调度器、全局锁、Workspace 锁、独立计时器或工具许可管理层。未提供 callback 保留原路径；原 awaited `before_model` 时点与语义不动，也不把全部 `before_tool` Hook 移入分组。原 modify 后 effective calls 分组、block 的配对工具错误保持。

- **组前**：已获得原策略的 effective group，但组内任何 `tool.started` 尚未提交。新增屏障分支先 await 原 `#checkStop`；若已终止，直接沿原结果返回。随后 await callback，再检查同一 signal/deadline；只有仍可继续且 decision 为 continue，才执行原工具 limit、required `tool.started` 和执行器启动顺序。
- **组后**：原组内执行器全部 settled、afterTool 及已知结果的 required sink 均完成，且原取消、unknown、executor failure 分支已处理后，才允许进入屏障。仍有 running/unknown 工具或已终态时不能调用 callback 或写 paused。进入 callback 前及返回后同样沿原 `#checkStop` 检查；最后一组也必须等待此屏障，不能延到下一次 before_model，continue 后才进入下一组或返回原循环。
- **调用载荷**：每次由真实 state/group 构造 point、runId、turnId、lastEventSequence 和复制后的 callIds，传同一取消 signal。不暴露可变 RunState、arguments、执行器或提交函数；callback 修改定位数组不得影响实际分组。
- **pause**：仅在上述可暂停状态，await 原 `#commit` 写 `run.paused`，使用 `reason:'operator_requested'`、`requestedBy:'app'`；pendingToolCallId 为当前仍 pending 的首项，没有则 null。required sink 未完成时调用不能返回 paused；sink 拒绝或降级为 failure 时返回原失败结果，不伪造 pause ack。完成组不重置为 pending。
- **取消与故障优先**：pause 不 abort 在途组；取消、排空超时的 outcome_unknown、executor failure 和真实终态保留原处理顺序，不能由 callback pause 覆盖。callback 抛错或返回非法 decision 走 Runner 既有失败通道，不吞错继续，不启动新工具，不伪装为暂停。callback 尚未返回时不得宣称停止；仍沿传入 signal 完成可取消 I/O，不另造超时或重试机制。

暂停只是 Kernel 持久安全点，不证明平台已收到控制 ack、Session 可释放或外部副作用已停止；本批不增加 WG/Kernel 跨系统原子承诺。

## 3. 原身份恢复与冻结验收

公开 runCodingAgent 使用原 executionIdentity/input/config/limits 恢复时，继续原 Turn 和 pending 工具；已完成第一组不重复，第二组只执行一次，turn.started 不增加。恢复后的 before_group 必须实际调用同一 callback 并 await；不因恢复绕过屏障，不创建替代 Run/Session，不改既有恢复入口。

只读运行冻结六组测试：组前 await；串行组间暂停与同身份恢复；并发组排空、结果 required sink 和最后一组屏障；required pause sink 悬停/拒绝；cancel/unknown；Hook 与无 callback 旧路径。group3 等待真实结果 sink 时须同时观察提前 after_group 或调用结束，错误提前屏障应明确失败，不允许挂起掩盖问题。失败用例的释放/收尾已由主审冻结，不能改成等待永远不发生的回调或 seed paused。

执行现有检查：`python3 tools/dsh-refactor/check.py next-tool-group-barrier next-frozen-kernel next-kernel-history-public next-runtime-execution`；`next-types` 单跑；在 next 用 `node scripts/build-kernel-patch.mjs --check` 验证全部 24 项逐字再生。不安装依赖、不运行旧 kernel:build、不扩为原 Kernel 全工程矩阵。

完成后报告五文件实际变化与完整 hash、目标及相邻检查真实结果、24 项再生结果和 scope 核对，STOP 等待独审。只可声明工具组 awaited 安全点及原身份恢复通过，不宣称平台 pause/cancel/recoverRun 或整个 R4 已交付。

## 独立实现初审返修

原独立5文件67项/types通过，但after_group callback真实I/O失败抛错会跨出executeTools，外层execute的state仍是工具执行前旧值；随后run.failed使用旧sequence且丢失已完成工具状态。主审新增一条真实SQLite/公共runCodingAgent回归：第一工具完成后callback抛错，只能有一条连续序号的run.failed，保留该completed工具、第二组零启动、原provider仅一次。只补这一独有风险，不复制非法返回的同分支测试。全部测试仍只读。

在持有最新state的屏障接缝内复用原failure/#commit与取消处理收束callback错误（非法decision仍沿同一已声明失败通道）。回调抛错与取消同时到达时仍先沿原checkStop；不能回到外层旧state构造终态。不要重写整个executeTools循环、复制另一状态机或改变原工具异常归约。生产scope仍runner+4生成物，仅从受管源生成。主审新测试红确认后返修，运行原组合检查/types/24项再生，STOP。

### 最后代码简化

最新state的callback异常收束已通过主审源码核对。移除`const kind: string = (decision as { readonly kind: string }).kind`这处无必要断言，直接`const kind = decision?.kind`。这样缺失返回值也自然到现有失败分支，不在try外再次抛TypeError并退回旧state；不新增校验器、不新增测试矩阵。仅此源码行及脚本生成的对应产物；跑同一专项/types/24项再生后STOP。
