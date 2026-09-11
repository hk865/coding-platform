# M6 独立质量评审报告

- 评审日期：2026-08-28
- 评审角色：独立质量评审 Agent
- 项目目录：`/home/han001/projects/agents/coding-agent`
- 评审分支：`codex/m6-completion`
- 基线提交：`beaeaff7b1d830498fd98308a549b154383165c0`（`m6-baseline`）
- 最终建议：**修复阻塞项后提交**

## 1. 执行摘要

本次评审没有采信既有修复报告、已有测试绿灯或场景 oracle 的结论，而是从生产源码、事件落库行为、恢复组合根、场景 Runner 和独立黑盒测试重新建立事实。

评审确认，大部分工具生命周期基础能力已经实现：required sink 的 `tool.started` 屏障有效；cancelled
ToolResult 可以携带新的 workspace
revision；并行工具结果不会互相覆盖；取消后可以有限等待不响应 AbortSignal 的工具；started 工具崩溃恢复不会自动重放副作用，并且只合成一次
`outcome_unknown`。

但当前版本仍存在一个 P0 和多个 P1/P2 问题：

1. `toolDrainTimeoutMs`
   被无条件用于所有正在运行的工具，而不是只在取消后用于收尾。正常长工具会在 Run 已经失败后继续产生副作用。
2. 场景 Runner 对 `scenarioId` 和 workspace 的路径约束不足，不能强制保证 oracle 隔离。
3. 场景 Runner 会把损坏 YAML、无效 JSON 和信号退出错误分类，可能形成假阳性。
4. 生产恢复直接写 Session，绕过 Web Projection 的事件投递路径。
5. CheckpointingEventSink 的核心行为正确，但生产 composition 没有接入。
6. Bug Hunt 官方 acceptance 和当前 CI 场景门禁不足以覆盖若干真实业务边界。

因此，本次评审结论为：**修复阻塞项后提交**。

## 2. 评审边界与保护措施

本次评审遵守以下约束：

- 未执行 `git reset`、`git checkout` 覆盖、`git clean` 或删除操作。
- 未提交代码。
- 未修改生产源码。
- 完整保留评审开始前已有的 tracked/untracked 修改和用户文档。
- Bug Hunt 和 Web Game 均从 `base/` 复制到独立临时目录后测试。
- 未打开、读取或复制任何 `oracle/`
  文件内容；报告中出现 oracle 路径仅来自 Git 文件枚举和 Runner 路径审查。
- 独立测试全部放在 `tests/review/`，没有修改场景 `base/`。
- 可能无限等待的工具测试设置了有限超时，没有让测试进程无限挂起。

## 3. 事实基线

### 3.1 Git 基线

评审开始时确认：

- 当前分支为 `codex/m6-completion`。
- HEAD 为 `beaeaff7b1d830498fd98308a549b154383165c0`，与指定基线一致。
- 已有 25 个 tracked 文件被修改，tracked diff 统计为 `892 insertions(+), 146 deletions(-)`。
- 工作树包含大量 untracked 文档、源码和测试，均予以保留。

### 3.2 已阅读材料

完整阅读：

- `docs/adr/0005-tool-lifecycle-states.md`
- `docs/development/post-m6-large-repo-roadmap.md`
- `docs/development/improvement-plan-from-codex-review.md`
- `tests/scenarios/README.md`

同时阅读了本轮涉及的 RuntimeRunner、Reducer、RunState、RecoveryCoordinator、CheckpointingEventSink、SessionEventSink、Session
store、Web Event Projection、composition
roots、工具协议/schema、ToolDispatcher、场景 Runner、场景 acceptance 和相关既有测试。

### 3.3 三类事实的区分

#### 代码已经实现并经独立测试确认

- required sink 在 `tool.started` 精确失败时，ToolExecutor 不会被调用。
- cancelled ToolResult 携带的新 workspace revision 能由 CheckpointingEventSink 保存。
- 并行组内 success、真实 cancelled、AbortError 可以分别结算。
- 取消发生后，不响应 AbortSignal 的工具不会无限阻塞 Run 结束。
- started 工具崩溃恢复会将 pending 调用标记为 abandoned，只追加一次
  `outcome_unknown`，并把合成 ToolResult 放入 transcript。
- 当前生产恢复不会再次调用模型。

#### 只写在文档中的规划

- Artifact Store。
- durable inbox/profile。
- 完整 Context Projection。
- 恢复后下一 Turn 的模型 handoff。
- edit 工具的确定性副作用对账。
- 更完整的 sandbox/recovery declaration。
- 面向大型仓库的完整增量化能力。

ADR
0005 已明确说明：当前恢复只完成终态事实投影，不在同一 Turn 内继续调用模型。独立跨进程测试证实生产模型调用次数为 0。这是当前设计边界，不应描述为“恢复后模型已经看到合成结果并继续运行”。

#### 现有测试声称覆盖的行为

- 排除新增 review 测试后，现有测试实际结果为 35 个测试文件通过，`137 passed / 3 skipped`，不是 132。
- Web
  Projection 既有单元测试通过手工发布事件验证 projector，但没有证明生产恢复会把同样事件发给 observer。
- 场景测试主要验证任务包结构、base 文件和 baseline 失败，不会在 CI 中运行一个完成版本的业务验收。

## 4. 评审方法与过程

### 4.1 源码和事件路径审查

按以下顺序独立跟踪工具生命周期：

1. RuntimeRunner 生成 `tool.started`。
2. required/best-effort sink 投递。
3. ToolExecutor 调用和 AbortSignal 传播。
4. 工具结果归一化为 completed/cancelled/outcome_unknown。
5. Reducer 更新 RunState 和 transcript。
6. SessionEventSink 落库。
7. CheckpointingEventSink 保存工具边界 checkpoint。
8. RecoveryCoordinator 从 Session/checkpoint 重建事实。
9. resume composition 是否继续建立 RuntimeRunner 或提前返回。
10. Web observer 是否能收到恢复合成事件。

### 4.2 独立核心状态测试

使用独立 Fake Model、ToolExecutor、required sink、checkpoint store、Session
store 和跨进程 fixture，覆盖：

- required sink 在 `tool.started` 失败。
- cancelled partial edit 产生新 revision。
- 并行 success/cancelled/AbortError。
- 忽略 AbortSignal 且永不结束的工具。
- started 工具跨进程崩溃恢复。
- 生产恢复是否真正重新调用模型。
- 正常长工具是否被 drain timeout 错误截断。

### 4.3 Bug Hunt 黑盒测试

将 `tests/scenarios/bug-hunt/base/` 复制到独立临时目录，校验原始文件哈希保持不变。新增黑盒用例覆盖：

- 两行订单第二行库存不足时整体回滚。
- 第二行 SKU 不存在时整体回滚。
- 0%、100%、超过 100% 折扣。
- reserved 等于或超过 stock。
- 零数量和负数量。
- 同一订单重复调用的幂等性。

除原始 base 和独立完整实现外，还构造了一个“只满足官方测试”的 near-miss 实现，用于验证 acceptance 是否会放过真实业务错误。

### 4.4 Web Game 测试

将 `tests/scenarios/web-game/base/` 复制到隔离临时目录，先执行语法、静态结构和独立逻辑测试，覆盖：

- 16 张牌、8 个符号、每个符号两张。
- 唯一牌 ID。
- 同牌、异牌和重复同一张牌的匹配逻辑。
- score 单调且不为负。
- 多次 shuffle 不固定。

随后按要求完整阅读 computer-use
skill、guidance、confirmations 和 API 文档，并启动本地服务。Provider 初始化失败，返回：

```text
codex/sandbox-state-meta: sandboxCwd is not a local file URI
```

因此真实 Windows 浏览器测试记为 `external_dependency_missing`，没有把静态测试冒充为真实游玩。

### 4.5 场景 Runner 审查

独立验证：

- scenarioId 路径穿越。
- scenario 根、base 原目录和含 oracle 的父目录能否作为 workspace。
- 损坏或结构不完整的 YAML。
- acceptance 超时、无效 JSON、SIGTERM、SIGKILL。
- `external_dependency_missing` 是否被保留。
- CI 是仅验证任务包结构，还是执行真实业务验收。

## 5. 发现与证据

### P0-1：tool drain timeout 错误截断正常长工具

**真实业务影响**

正常但耗时超过 drain
timeout 的工具会被 Run 提前判定失败，而底层执行器仍可能在后台完成文件或外部副作用。事件日志中没有
`tool.completed`，形成“Run 已失败但副作用后来发生”的不一致，恢复或重试时存在重复执行风险。

**源码位置**

- `src/core/runtime/loop/runtime-runner.ts:710-715`
- `src/core/runtime/loop/runtime-runner.ts:723-755`
- `src/core/runtime/loop/runtime-runner.ts:759-781`
- `src/core/runtime/loop/runtime-runner.ts:832-839`
- `src/tools/dispatcher/tool-dispatcher.ts:167-182`

RuntimeRunner 在没有取消信号时也无条件启动 drain timer。默认 drain
timeout 为 5 秒，而部分工具自己的合法 timeout 达到 10、15 或 30 秒。

**最小复现**

```bash
PATH="$PWD/.tooling/node-v24.18.0-linux-x64/bin:$PATH" \
  npm exec -- vitest run tests/review/runtime-drain-regression.test.ts
```

**新测试结果**

1/1 失败。实际事件序列：

```text
run.started
model.request_started
assistant.message_completed
tool.started
run.failed
```

Run 失败后，测试继续观察到 `sideEffects=1`，但没有 `tool.completed` 或 `run.completed`。

**期望与实际**

- 期望：drain timeout 只在取消信号发生后开始计时；未取消的工具遵从自己的工具 timeout。
- 实际：工具一开始运行就进入 bounded drain，正常长工具被错误判定为失败。

**归属**

本轮引入。当前 diff 将原有等待执行结果的逻辑改成了通用 bounded drain。

### P1-1：场景路径和 workspace 隔离可以绕过

**真实业务影响**

Runner 不能强制保证被测 Agent 看不到 oracle。调用者可以通过路径穿越选择场景根之外的任务包，也可以把包含所有场景和 oracle 子目录的
`tests/scenarios` 目录作为 workspace。

**源码位置**

- `tests/scenarios/runner.mjs:83-85`
- `tests/scenarios/runner.mjs:108`
- `tests/scenarios/runner.mjs:147-164`

**最小复现**

- 使用 `validate ../../<外部任务包>`。
- 使用 `check bug-hunt --workspace tests/scenarios`。

**新测试结果**

两项安全断言均失败：Runner 接受了路径穿越，也没有拒绝包含 oracle 的场景父目录。

**期望与实际**

- 期望：基于 canonical
  path 做 containment 校验，拒绝场景根、base 原目录、oracle、包含它们的父目录和指向它们的链接。
- 实际：scenario 只使用 `path.join`；workspace guard 只拒绝两个完全相等的字符串路径。

默认 `prepare` 确实只复制
`base/`，这个默认路径未发现 oracle 泄漏；缺陷在于安全约束没有被所有入口强制执行。

**归属**

本轮引入。场景 Runner 是当前工作树中的新文件。

### P1-2：Runner 的解析和失败分类不可信

**真实业务影响**

损坏任务包、没有给出合法 JSON 的 acceptance 和异常信号退出可能被标记为 parsed、pass、timeout 或普通业务失败，导致自动门禁假阳性和错误诊断。

**源码位置**

- `tests/scenarios/runner.mjs:92-105`
- `tests/scenarios/runner.mjs:127-130`
- `tests/scenarios/runner.mjs:218-231`

**最小复现**

```bash
PATH="$PWD/.tooling/node-v24.18.0-linux-x64/bin:$PATH" \
  npm exec -- vitest run tests/review/scenario-runner-security.test.ts
```

**新测试结果**

8 项中 7 项失败，只有 Runner 自身实际触发超时的用例通过：

- malformed YAML 被标记为 valid/parsed。
- exit 0 且 stdout 为无效 JSON时仍判 pass。
- acceptance 明确报告 `external_dependency_missing` 时被覆盖为 `acceptance_failed`。
- acceptance 自己发送 SIGTERM 被误判为 timeout。
- SIGKILL 被分类为普通 acceptance failure。
- 真实 Runner timeout 能正确得到 `timedOut=true` 和 `runner_error`。

**期望与实际**

- 期望：使用严格 YAML 解析和 schema；无效结果是 runner
  error；区分真实 timeout 与进程信号；保留明确的 external dependency 分类。
- 实际：手写 parser 只提取简单键值；exit code 0 直接决定 pass；任何 SIGTERM 都被当成 timeout。

**归属**

本轮引入。

### P1-3：生产恢复事件绕过 Web Projection

**真实业务影响**

数据库和 transcript 中虽然存在合成的
`tool.outcome_unknown`，但 Web 客户端收不到该事件。用户只能看到 Run 最终失败，无法在 Timeline 中看到副作用未知、cancelled 或 abandoned 的工具事实。

**源码位置**

- `src/core/runtime/recovery/recovery-coordinator.ts:361-383`
- `src/app/composition/resume-composition.ts:139-155`
- `src/app/composition/resume-composition.ts:223-233`

**最小复现**

跨进程写入 `tool.started` 和一次副作用 marker，随后注册 observer 并对同一 Session 调用生产
`resumeCodingAgent` 两次。

**新测试结果**

- Session 中 `outcome_unknown`：1 次。
- transcript 中合成 ToolResult：1 次。
- pending 调用：abandoned。
- 副作用 marker：保持 1 次。
- 模型调用：0 次。
- observer 收到恢复事件：0 次。

**期望与实际**

- 期望：恢复追加事实经过生产事件投递路径，使 Web Projection 能消费。
- 实际：RecoveryCoordinator 直接调用
  `sessions.append`，而 resume 在创建 SessionEventSink 和 RuntimeRunner 前提前返回。

**归属**

本轮恢复实现的集成缺口。

### P2-1：CheckpointingEventSink 未接入生产 composition

**真实业务影响**

生产 Run 不会在工具边界保存独立 checkpoint；恢复只能依赖 Session 事件重放。大型 Session 的恢复成本和“最新 checkpoint
revision”承诺不能由当前生产 wiring 保证。

**源码位置**

- `src/core/runtime/checkpointing/checkpointing-event-sink.ts:31-44`
- `src/core/runtime/checkpointing/checkpointing-event-sink.ts:69-83`
- `src/app/composition/composition-root.ts:202`
- `src/app/composition/composition-root.ts:264-274`

**最小复现和新测试结果**

独立测试显式注入 CheckpointingEventSink 后，`tool.cancelled` checkpoint 保存了
`revision-after-partial-change`，恢复没有误判外部并发修改。检查生产 composition 的 sink 列表，只发现 SessionEventSink 和 observers，没有 CheckpointingEventSink。

**期望与实际**

- 期望：生产事件链同时接入 SessionEventSink、CheckpointingEventSink 和 observer sinks。
- 实际：checkpoint 核心组件有效，但没有生产接线。

**归属**

基线遗留的 wiring 缺口，本轮测试和文档没有覆盖真实 composition。

### P2-2：Bug Hunt 官方 acceptance 可放过真实业务错误

**真实业务影响**

一个实现可以通过官方验收，但仍接受负数量、让负数量反向减少 reserved，并在重复订单调用时重复预留。

**源码位置**

- `tests/scenarios/bug-hunt/acceptance/check.mjs:73-87`
- `tests/review/minimart-blackbox.mjs:30-127`

**最小复现和新测试结果**

对独立构造的 `minimart-official-near-miss` fixture：

- 官方 acceptance：通过。
- 独立 blackbox：3 项失败。
- 零/负 allocation 未拒绝。
- 零/负订单行被接受，负数量将 reserved 从 2 降至 1。
- 同一订单重复执行后 reserved 变成 6。

原始 base 官方验收失败 6 项；独立完整实现同时通过官方 acceptance 和 8 项新增黑盒测试。

**期望与实际**

- 期望：官方验收覆盖非法数量、折扣边界、整体回滚和订单幂等性。
- 实际：已知原始 bug 被覆盖，但若干真实业务边界没有成为门禁。

**归属**

本轮 acceptance 测试缺口。

### P2-3：CI 没有执行完成版本的场景业务验收

**真实业务影响**

任务包结构合法即可使场景检查通过，即使原始业务仍失败、acceptance 自身存在分类漏洞。

**源码位置**

- `package.json:26`
- `.github/workflows/ci.yml:29`
- `tests/scenarios/scenarios.test.ts:1-4`
- `tests/scenarios/scenarios.test.ts:91-104`

**最小复现和新测试结果**

- `npm run check:scenarios`：退出 0。
- 随后对原始 Bug Hunt base 执行 acceptance：失败。

**期望与实际**

- 期望：CI 除任务包结构外，运行受控完成 fixture 或 Runner 自测，验证业务 acceptance 和失败分类。
- 实际：当前 CI 只证明任务包存在、字段被 parser 接受，以及 baseline 能失败。

**归属**

本轮场景门禁设计缺口。

### P3

没有发现需要单列、且证据强于以上问题的新 P3 项。

## 6. 独立测试结果汇总

| 测试                                    | 结果      | 结论                                                                   |
| --------------------------------------- | --------- | ---------------------------------------------------------------------- |
| `independent-runtime-lifecycle.test.ts` | 5/5 通过  | required sink、cancel revision、并行状态、取消收尾、跨进程恢复符合预期 |
| `runtime-drain-regression.test.ts`      | 0/1 通过  | 暴露正常长工具被错误截断的 P0                                          |
| `scenario-runner-security.test.ts`      | 1/8 通过  | 暴露路径、解析、JSON 和信号分类问题                                    |
| Bug Hunt 原始 base 官方 acceptance      | 失败 6 项 | baseline 确实未修复                                                    |
| Bug Hunt 独立完整版本官方 acceptance    | 通过      | 官方已知用例通过                                                       |
| Bug Hunt 独立完整版本 blackbox          | 8/8 通过  | 新增业务边界通过                                                       |
| Bug Hunt near-miss 官方 acceptance      | 通过      | 证明官方验收存在漏网实现                                               |
| Bug Hunt near-miss blackbox             | 3 项失败  | 非法数量和幂等性缺陷被独立测试捕获                                     |
| Web Game 静态/逻辑检查                  | 通过      | 牌组、配对、分数和洗牌逻辑通过                                         |
| Web Game 真实浏览器                     | 未执行    | `external_dependency_missing`                                          |

## 7. 完整门禁结果

所有命令均使用仓库自带 Node：

```bash
PATH="$PWD/.tooling/node-v24.18.0-linux-x64/bin:$PATH"
```

### `npm run check`

结果：失败。

- format：通过。
- lint：通过。
- typecheck：通过。
- build：通过。
- tests：`36 passed files / 2 failed files`，`143 passed / 8 failed / 3 skipped`。
- 8 个失败全部来自新增独立评审测试：1 个 runtime P0，7 个 Runner 问题。

排除 `tests/review/` 后，原有套件结果为：

```text
35 test files passed
137 passed | 3 skipped
```

### `npm run check:scenarios`

结果：退出 0，但只验证任务包结构和 baseline 行为，不是完整业务门禁。

### 强制 bubblewrap E2E

结果：3 通过、3 失败。

当前环境没有系统或 bundled `bwrap`，另一个 CLI 流程停在一次性授权提示。因此本项记为
`external_dependency_missing`，不作为产品通过证据。

### 其他门禁

- `git diff --check`：通过。
- `npm run check:architecture`：通过，验证 64 个源码文件。
- `npm run benchmark:validate`：通过，4 个任务包 preflight 正常。

## 8. 未执行项目

以下 Web Game 真实浏览器行为没有执行，也没有标记为通过：

- 点击不匹配牌并等待翻回。
- 匹配牌保持 matched 且不可重复计分。
- move、timer、score 的浏览器更新。
- 完成全部配对后的胜利状态和动画。
- restart 重置状态并重新洗牌。
- 快速连续点击和重复点击同一张牌。
- 完成动画期间点击。
- 键盘操作。
- 窄屏布局和遮挡。
- 浏览器 console 错误和资源加载失败。
- 关键截图。

原因是 computer-use Provider 不可用，而不是这些能力已经验证通过。官方 Web acceptance 内的 browser
gate 也固定报告 `external_dependency_missing`，不能替代真实浏览器测试。

## 9. 对既有表述的纠正

上一位 Agent 的报告原文不在当前工作区。根据现有文档、题述和可复现实验，可以纠正以下表述：

1. “132 个测试通过”已经过时；当前原有套件为 `137 passed / 3 skipped`，加入独立测试后有 8 个红灯。
2. “永不返回工具不会阻塞取消”本身成立，但当前 drain 实现同时错误截断未取消的正常长工具。
3. “Web
   Timeline 可以区分 outcome_unknown/cancelled”只在手工 projector 单元测试中成立；生产恢复 observer 实测收到 0 个事件。
4. “恢复后模型继续处理合成结果”不成立；生产模型调用数为 0，当前 ADR 也明确尚未实现下一 Turn
   handoff。
5. “cancelled
   revision 保存进最新 checkpoint”只在显式注入 CheckpointingEventSink 时成立；生产 composition 未接入。
6. “场景 CI 验证业务验收”不准确；当前主要是任务包结构门禁。
7. `docs/development/improvement-plan-from-codex-review.md` 所称“当前工作树 clean”与现场不符。

## 10. 评审意见

### 提交前必须处理

1. 修复 RuntimeRunner 的 drain
   timeout 触发条件：只在取消已经发生后启动 drain；正常工具继续遵从自己的执行超时。
2. 修复后保留 `runtime-drain-regression.test.ts` 作为回归门禁，验证 Run 终态与真实副作用不会脱节。
3. 对 Runner 的 scenario/workspace 使用 canonical path
   containment 校验；明确拒绝 oracle、base 原目录、场景根及包含它们的父目录。
4. 使用严格 YAML parser 和 schema；无效 acceptance JSON 必须是 runner error。
5. 区分 Runner 自己触发的 timeout、acceptance 自发 SIGTERM 和异常信号退出；保留明确的
   `external_dependency_missing`。

### 建议本轮一并处理

1. 让恢复合成事件通过统一事件投递管线，确保 Session、Web Projection 和 observer 得到一致事实。
2. 将 CheckpointingEventSink 接入生产 composition，并增加从生产入口验证 cancelled
   revision 的集成测试。
3. 扩充 Bug Hunt 官方 acceptance，至少纳入非法数量、折扣边界、整体回滚和幂等性。
4. 在 CI 中运行一个受控完成 fixture 和 Runner 分类自测，而不只是验证任务包结构。

### 后续验证

1. 在 computer-use Provider 可用的环境重新执行 Web Game 真实浏览器矩阵。
2. 在具备 bubblewrap 的 Linux 环境重跑强制 sandbox E2E。
3. 对真实浏览器验证保存截图、console 和资源加载日志，不以 DOM 静态读取代替交互。

## 11. 新增评审文件

```text
tests/review/fixtures/minimart-fixed/inventory.js
tests/review/fixtures/minimart-fixed/order.js
tests/review/fixtures/minimart-official-near-miss/inventory.js
tests/review/fixtures/minimart-official-near-miss/order.js
tests/review/fixtures/seed-started-tool.mjs
tests/review/fixtures/web-game-complete/README.md
tests/review/fixtures/web-game-complete/game-logic.mjs
tests/review/fixtures/web-game-complete/index.html
tests/review/fixtures/web-game-complete/script.js
tests/review/fixtures/web-game-complete/style.css
tests/review/independent-runtime-lifecycle.test.ts
tests/review/minimart-blackbox.mjs
tests/review/runtime-drain-regression.test.ts
tests/review/scenario-runner-security.test.ts
tests/review/web-game-logic-blackbox.mjs
```

本次整理另新增本报告：

```text
docs/development/m6-independent-quality-review-2026-08-28.md
```

## 12. 生产代码修改声明

本次独立评审和报告整理均未修改生产代码。新增内容仅包括独立评审测试、测试 fixture 和本报告文档。
