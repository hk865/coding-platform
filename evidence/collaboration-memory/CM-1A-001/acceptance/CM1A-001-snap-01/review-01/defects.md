# CM-1A-001 缺陷回交

共同范围：CM-1A-001 当前实测树 `26529f1e926bc71220fdcaa128368ac5a168e96fc4f1e16b1104ef2ed5a44589`，声明 CM1A-001-snap-01 指纹不符，不追认其字节内容。所有缺陷 **OPEN**，回交本票 integration-implementer/实施统筹；本轮不修复源码。

## SNAP-01 / P1：被验源码指纹与交付清单不一致（A12，V14–V16）

- 位置：implementation/CM1A-001-snap-01/source-snapshot.json:9。
- 准备/命令：产品根 WSL 执行 `python3 evidence/collaboration-memory/CM-1A-001/acceptance/CM1A-001-snap-01/review-01/capture.py before`。脚本按 BASELINE §5 取 Git 跟踪/未跟踪并集，过滤范围，按路径排序，以原始字节 SHA256 逐项拼接。输出含逐文件哈希。
- 预期：1211 文件且等于声明 `391d23a280689196da24efa0666d11912ad6cdac93891645d3abcbae157e85f2`。
- 实际：1211 文件，两仓 HEAD 与声明一致，但摘要为上述 `26529f…`。另试 localeCompare 排序为 `edf91fa1…`，仍不等于声明。没有依据将其归因为换行或特定人员写入。
- 日志：snapshot-before.json、snapshot-after.json、upstream-current.json；上游准备摘要中的 module-status.md/state-ledger.md 与当前不同，其他清单条目匹配。
- 影响：不能把当前运行结果绑定为原声明快照 PASS。实施者须提交可复算的新快照及逐文件清单、准确差异/来源。

## Standards 轴

### STD-01 / P1：包含 next intent 的路由页必被拒（A03，V02/V03）

- 位置：src/control/control-engine/records/coordination.ts:807；src/data/state-ledger/ledger-validation.ts:2307。
- 准备：独立脚本使用真实 buildRoutePageCommit 构建当前 settled intent 及 next intent；账本是独立 InMemoryLedger。
- 命令：产品根 `node evidence/collaboration-memory/CM-1A-001/acceptance/CM1A-001-snap-01/review-01/standards-repro.mjs`。
- 预期：当前页 Delivery/checkpoint/settle/next intent 原子成功；实际：续页 `invalid_commit`，同账本同输入末页 committed。
- 原因：专用校验既拒绝新增 CommunicationIntentRecorded，又只允许一个 intent 快照。
- 日志：standards-repro.log；退出 0 表示反例断言成功，不表示分页通过。
- 影响：第三处修复未完成消费者对齐，所有 hasMore 续页提交受阻；仅改单个白名单不充分。

### STD-02 / P2：participation-start 放宽了事件基本校验（A01/A12，V06/V14/V15）

- 位置：src/data/state-ledger/ledger-validation.ts:2210（对照通用校验 :2128）。
- 准备/命令：同 standards-repro，每个变异使用独立账本，先合法绑定 Work，再修改真实 builder 产物的一项。
- 预期：空 eventId、schemaVersion=2 被拒；实际：专用校验 true，实际 Ledger.commit 均 committed，而通用校验 false。
- 日志：standards-repro.log。第二事件 workspaceId 不同也被接纳，但通用校验也允许，单独注明为既存缺口，不冒充此次退化。
- 影响：第一处修复确实遗漏基本事件完整性守卫；必须恢复基本校验与专用关联校验的组合。

## Spec 轴

### SPEC-01 / P1：唯一后继 outbox 没有生产 RunSpec prepare（A05/A06，V03/V04）

- 位置：src/control/dispatch-engine/leased-worker-runtime.ts:29；src/control/dispatch-engine/dispatch-engine.ts:173；测试手工补线 tests/coordination/delivery-into-input.test.ts:342。
- 准备：复制原测试到本证据目录，仅调整导入位置并删除手工后继 `runtime.prepare(specFor(root, successorRunId))`，保留真实 SQLite/Control/Dispatch/Runtime/内核与确定性 ModelClient。
- 命令：`bash evidence/collaboration-memory/CM-1A-001/acceptance/CM1A-001-snap-01/review-01/spec-run.sh`（见 spec-commands.log）。
- 预期：正式产品路径自动准备并执行后继；实际：admission=1，随后 drive.failures 报 runtime_error / “真实运行缺少已登记输入”。
- 日志：logs/no-successor-prepare.log；独立 runner 保留官方脚本的 sandbox preflight，仅改测试 include/config 输出以允许 evidence 隔离测试。
- 影响：原 A06 成功用例通过依赖测试补齐生产接线，不能证明实际可执行后继；修复还需覆盖 SQLite 重启后的 RunSpec 恢复。

### SPEC-02 / P1：等待换手后仍向旧 participation 申请接续（A01/A05，V06/V04）

- 位置：src/control/dispatch-engine/coordination-drive.ts:846、855、907；src/control/control-engine/coordination.ts:1760。
- 准备：旧参与者登记 wait，结束参与；同 Work 开始新参与；前驱结束且条件满足，再 drive。
- 预期：等待属于 Work，由有效新参与关系继续；源码实际：drive 从 wait.ownerParticipationRef 读取并提交旧关系，Control 要求其 active，故拒绝 ended。原换手测试只验证保留等待，并未继续 drive。
- 动态命令：`bash evidence/collaboration-memory/CM-1A-001/acceptance/CM1A-001-snap-01/review-01/handover-run.sh`。实际失败：“后继受理被拒绝（invalid）：参与关系不是 active：ended”。日志 logs/handover-successor.log。旧参与 end、新参与 start 均 committed；保留手工 RunSpec prepare 以隔离 SPEC-01。该动态用例严格覆盖同 Agent 的新参与段，不扩大为已动态证明换 AgentId；旧 ref 固定的源码原因同样影响换 AgentId。
- 影响：Work 等待虽然保留，真实换手后不具备可恢复的执行能力。

### SPEC-03 / P1：协调 Host 工具没有生产者接线（A01/A02/A06，V01/V02/V06）

- 位置：src/execution/worker-runtime/coding-agent-runtime.ts:227；src/control/control-engine/control-engine.ts:549。
- 复核命令：`rg -n 'sendDirectedRequest|respondDirectedRequest|createSubscription|registerWait|startWorkParticipation' src`，再追 Runtime additional tools。
- 预期：票 §1/§4 要求已受理 Work 的 Host 协调工具携 exact principal 调正式入口。
- 实际：调用仅有 Control 公开委派/实现，缺 app/Host/runtime adapter 生产者；用例直接 h.control 组命令。内核材料工具注入是既有 reviewer 路径。
- 证据：spec.md 源码追踪，静态发现；不宣称执行过真实 Agent 工具调用。
- 影响：本票要求的正常生产闭环未建立，不能用 harness 直接调用替代。

既知剩余实现/验证 R1–R8 不重复包装成新发现；逐项 Ticket 归属和阻断见 coverage.md。修复以上缺陷仍不自动满足未验证的跨进程竞争、unknown 对账、强杀恢复与真实并发。
