# M6 第三轮修复独立复审补充报告

- 复审日期：2026-08-28
- 复审对象：阻塞项修复报告（第三轮）
- 分支：`codex/m6-completion`
- HEAD：`beaeaff7b1d830498fd98308a549b154383165c0`
- 原始评审报告：`docs/development/m6-independent-quality-review-2026-08-28.md`
- 最终建议：**修复剩余 Runner 阻塞项后提交**

## 1. 复审原则与范围

本补充报告不采信第三轮修复报告中的源码描述、测试数量或门禁结论，而是重新读取当前源码、事件投递路径和测试，并独立运行正向与反向复现。

本轮未修改生产代码、场景 Runner、acceptance 或既有测试断言。新增内容仅包括两个独立评审测试和本补充报告：

- `tests/review/production-checkpoint-wiring.test.ts`
- `tests/review/scenario-runner-residual-security.test.ts`
- `docs/development/m6-independent-quality-re-review-round-3-2026-08-28.md`

Bug Hunt 和 Web Game 仍在独立 `/tmp` 工作区执行。没有读取或复制任何 `oracle/` 内容。

## 2. 复审结论

第三轮报告中的以下修复已经获得独立证据，可以关闭原问题：

- P0-1：正常长工具不再被 drain timeout 截断。
- P1-3：恢复合成事件会投递给 observer/Web Projection。
- P2-1：生产 run 与 resume 续跑已经接入 CheckpointingEventSink。
- P2-2：Bug Hunt 官方 acceptance 已覆盖非法数量、折扣边界、回滚和幂等性。
- P2-3：场景 CI 已执行受控完成 fixture，并能抓住 near-miss。
- 强制 bubblewrap E2E：在按文档设置仓库内绝对路径后 6/6 通过。

以下声明只完成了一部分，仍有阻塞项：

- P1-1：workspace containment 已修复，但 `check` 仍允许 `scenarioId` 穿越并执行场景根外的 acceptance
  JavaScript。
- P1-2：原始 malformed
  YAML、无效 JSON 和信号分类用例已修复，但 environment 仍没有 schema 校验；合法 JSON 的空对象仍被判 pass。

因此仍不建议直接提交。

## 3. 已验证关闭的问题

### 3.1 P0-1 tool drain timeout：通过

源码证据：

- `src/core/runtime/loop/runtime-runner.ts:741-760`
- `src/core/runtime/loop/runtime-runner.ts:785-843`

当前实现先等待 `allSettledSignal`；只有 `cancellationHappened` resolve 后才创建 drain
timer。未取消的正常工具不会被 `toolDrainTimeoutMs` 提前截断。

独立结果：

```text
tests/review/runtime-drain-regression.test.ts  1/1 passed
```

80ms 正常工具在 20ms drain 配置下完成，事件包含 `tool.completed` 和
`run.completed`；永不返回工具的取消收尾测试仍通过。

结论：原 P0-1 已关闭。

### 3.2 P1-3 恢复事件投递：通过

源码证据：

- `src/core/runtime/recovery/recovery-coordinator.ts:128-248`
- `src/app/composition/resume-composition.ts:140-159`

RecoveryResult 现在返回按追加顺序排列的 `reconciledEvents`。resume
composition 在终态提前返回前，把这些事件投递给全部 best-effort observer。

跨进程独立结果：

- `tool.outcome_unknown` 在 Session 中仅 1 次。
- `run.failed` 在 Session 中仅 1 次。
- observer 收到 `tool.outcome_unknown` 和 `run.failed`。
- 第二次幂等恢复不重复投递对账事件。
- 模型调用仍为 0，符合 ADR 对当前恢复边界的说明。

结论：原 P1-3 已关闭。

### 3.3 P2-1 生产 checkpoint 接线：通过

源码证据：

- `src/app/composition/composition-root.ts:204-217`
- `src/app/composition/composition-root.ts:279-283`
- `src/app/composition/resume-composition.ts:234-247`
- `src/core/runtime/event_delivery/event-delivery-coordinator.ts:80-112`

事件协调器先投递 required Session sink，再投递 best-effort checkpoint
sink。因此 checkpoint 保存时，Session cursor 已经推进到当前事件位置。

新增生产入口测试结果：

```text
tests/review/production-checkpoint-wiring.test.ts  1/1 passed
```

该测试使用真实 `runCodingAgent` 和 SQLite，确认：

- 生产 Run 确实生成 checkpoint。
- 最新 checkpoint 状态为 completed。
- checkpoint `recordPosition` 等于 Session 最新记录位置。
- checkpoint `lastEventId` 等于 Session 最新 AgentEvent ID。

结论：原 P2-1 已关闭。

### 3.4 P2-2 Bug Hunt acceptance：通过

在全新隔离工作区中独立运行：

- `minimart-fixed`：官方 acceptance 通过，独立 8 项 blackbox 全部通过。
- `minimart-official-near-miss`：官方 acceptance 失败，准确抓住以下 3 项：
  - `allocateStock 拒绝零/负数量且不改变库存`
  - `零/负数量订单行失败且不预留`
  - `同一订单重复调用不重复预留`
- near-miss 的独立 blackbox 同样失败 3 项。

官方 acceptance 还验证了测试文件哈希和 `src` 文件结构未改变。

结论：原 P2-2 已关闭。

### 3.5 P2-3 场景 CI 业务验收：通过

`tests/scenarios/scenarios.test.ts`
现在包含 6 个测试，实际运行受控完成 fixture 和 near-miss，而不再只检查目录结构。

独立结果：

```text
tests/scenarios/scenarios.test.ts  6/6 passed
```

结论：原 P2-3 已关闭。

### 3.6 bubblewrap 强制 E2E：通过并纠正原评审

仓库文档明确说明：系统没有 `/usr/bin/bwrap` 时，应设置绝对
`CODING_AGENT_BWRAP_PATH`。仓库内 binary 存在于 `.tooling/bwrap/usr/bin/bwrap`。

独立命令：

```bash
PATH="$PWD/.tooling/node-v24.18.0-linux-x64/bin:$PATH" \
CODING_AGENT_BWRAP_PATH="$PWD/.tooling/bwrap/usr/bin/bwrap" \
npm run test:e2e:bwrap
```

结果：

```text
Test Files  2 passed (2)
Tests       6 passed (6)
```

原评审只执行 npm script、没有按仓库文档设置本地 bwrap 绝对路径，因此把该门禁记为
`external_dependency_missing` 不够完整。第三轮报告对此项的纠正成立。

## 4. 剩余发现

### P1-1：`check` 仍存在 scenarioId 路径穿越并执行外部脚本

**真实业务和安全影响**

`check` 可以接受指向 `tests/scenarios` 之外的相对路径，并由 Node 直接执行该外部目录中的
`acceptance/check.mjs`。workspace
containment 只能约束传给 acceptance 的工作区参数，不能限制 acceptance 进程自身读取文件、访问凭据或执行任意代码。

这不仅是 oracle 隔离问题，也是 Runner 任意脚本执行边界问题。

**源码位置**

- `tests/scenarios/runner.mjs:115-131`
- `tests/scenarios/runner.mjs:170-180`
- `tests/scenarios/runner.mjs:256-258`
- `tests/scenarios/runner.mjs:299-304`
- `tests/scenarios/runner.mjs:438-453`

`resolveExplicitScenarioRoot` 只做 realpath 和 `task.md`
存在性检查，没有 containment。随后 acceptance 路径使用原始 `id` 拼接并执行。

**最小复现**

1. 在 `/tmp` 创建具备任务包结构和 `acceptance/check.mjs` 的场景。
2. 计算它相对于 `tests/scenarios` 的 `../../..` scenarioId。
3. 执行 `runner.mjs check <穿越 ID> --workspace <独立临时目录>`。

**新测试结果**

`tests/review/scenario-runner-residual-security.test.ts` 第一项失败：

```text
expected exitCode not to be 0
actual exitCode = 0
actual status = pass
```

**期望与实际**

- 期望：`list`、`validate`、`check` 对生产 scenarioId 使用同一 canonical direct-child containment。
- 实际：只有 `list`/`validate` 被限制；`check` 有意允许外部场景并执行外部 JavaScript。

**评审意见**

不要为了 Runner 自测放宽生产入口。分类测试应复制 Runner 到临时场景根，或通过内部可注入函数测试；生产 CLI 的
`check` 必须拒绝外部 scenarioId。

### P2-1：environment.yaml 仅做表面语法检查，没有结构 schema

**真实业务影响**

一个只有 `title: incomplete`
的 environment 文件会被标记 valid。CI 因而无法保证场景声明了 runtime、tools、permissions、budget 和 evaluation 等运行约束。

**源码位置**

- `tests/scenarios/runner.mjs:133-168`
- `tests/scenarios/runner.mjs:200-213`

当前 parser 只检查每个非列表行包含冒号，以及方括号/花括号数量配对；不检查必需字段、嵌套结构、类型、重复 key 或未知字段。

**新测试结果**

`tests/review/scenario-runner-residual-security.test.ts` 第二项失败：

```text
environment.yaml = "title: incomplete"
expected status = invalid
actual status = ok / valid
```

**期望与实际**

- 期望：使用真实 YAML
  parser 并按明确 schema 验证至少 scenario、title、runtime、tools、permissions、budget 和 evaluation。
- 实际：合法 `key: value` 行即足以通过所谓“严格结构检查”。

**评审意见**

第三轮报告中的“严格结构检查”表述应改为“最小语法检查”，除非补充实际 schema。

### P1-2：合法 JSON 但协议结构无效时仍可假通过

**真实业务影响**

acceptance 只需 exit 0 并输出
`{}`、数组或其他合法 JSON，就会被 Runner 判为 pass。验收器可以在没有任何 `status: pass`
或 checks 证据时制造 CI 假绿灯。

**源码位置**

- `tests/scenarios/runner.mjs:306-343`

关键逻辑是
`parsedOutput.status === "pass" || parsedOutput.status === undefined`，因此空对象被当成通过。

**新测试结果**

`tests/review/scenario-runner-residual-security.test.ts` 第三项失败：

```text
acceptance stdout = {}
acceptance exitCode = 0
expected runner_error
actual status = pass
```

**期望与实际**

- 期望：合法 JSON 之后继续执行 acceptance result schema 校验；pass 必须显式声明
  `status: "pass"`，并校验 failureClassification/checks 等字段的一致性。
- 实际：JSON 可解析且 status 缺失时直接 pass。

**评审意见**

第三轮修复只解决了“不是 JSON”的情况，没有解决“JSON 结构不符合协议”的情况。该项仍可能让业务验收假绿，属于提交阻塞项。

## 5. 门禁结果

### 第三轮现有测试，未加入新复现前

第三轮报告的数量可以由独立结果交叉验证：

```text
38 test files
153 passed
3 skipped
```

其中：

- `tests/review/` 原 3 个文件：14/14 通过。
- `tests/scenarios/scenarios.test.ts`：6/6 通过。

### 加入本次独立复现后

`npm run check`：

- format：通过。
- lint：通过。
- typecheck：通过。
- build：通过。
- tests：失败。

```text
Test Files  1 failed | 39 passed (40)
Tests       3 failed | 154 passed | 3 skipped (160)
```

3 个失败全部来自新增 Runner 残余安全/协议测试。由于 test 阶段失败，`npm run check`
没有继续执行后续命令；这些门禁随后被单独运行：

- `npm run check:architecture`：通过，64 个源码文件。
- `npm run benchmark:validate`：通过，4 个任务 preflight 正常。
- `npm run check:scenarios`：通过，bug-hunt 和 web-game 均报告 valid。
- `git diff --check`：通过。
- 强制 bubblewrap E2E（显式绝对路径）：6/6 通过。

## 6. Web Game 状态

Web Game 完成 fixture 的官方静态 acceptance 和独立逻辑测试均通过：

- 16 张牌。
- 8 个符号、每个两张。
- card ID 唯一。
- match/same-card 判断。
- score 单调且非负。
- 多次 restart/shuffle 可产生不同排列。

真实浏览器点击、翻回、胜利、重启、窄屏、键盘、console 和截图仍未执行，继续记为
`external_dependency_missing`。本轮没有把静态检查冒充真实浏览器通过。

## 7. 最终评审意见

### 提交前必须处理

1. 移除 `check` 对外部 scenarioId 的例外，所有生产命令统一使用 canonical direct-child containment。
2. 对 acceptance 输出增加 schema 校验；exit 0 但缺少明确 `status: "pass"` 时必须返回
   `runner_error`。

### 建议同时处理

1. 对 `environment.yaml` 使用真实 YAML parser 和显式 schema，而不是只做行级/括号检查。
2. 将本轮新增的 3 个反向测试保留为门禁，不要降低断言换取绿灯。
3. Runner 分类测试需要临时场景时，应复制 Runner 到临时根或抽出可注入的内部组件，不应放宽生产 CLI 的安全边界。

### 提交范围确认

修复上述 Runner 项并使完整 `npm run check`
恢复绿色后，再与用户确认是否把用户文档、原始评审报告、第三轮补充报告和全部 review
fixture 一并纳入提交。

## 8. 生产代码修改声明

本次第三轮独立复审没有修改生产代码。新增的两个测试文件均位于 `tests/review/`，本报告位于
`docs/development/`。
