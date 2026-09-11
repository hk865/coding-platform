# 业务场景任务包（tests/scenarios/）

```yaml
status: current
updated: 2026-08-28
scope: L2 真实本地业务场景的目录约定与最小 runner
```

`tests/scenarios` 是独立于 Runtime 的本地业务验收子系统。模块测试只证明函数行为；**场景任务包**
证明 Agent 能在真实用户需求下完成「理解需求 → 修改正确文件 → 运行验证 → 处理失败 → 解释结果 → 保留可审计轨迹」的完整闭环。Runner 负责包发现、schema、路径隔离和验收协议，具体 Agent 执行层只接收
`task.md` 与隔离后的 `base/`。

## 任务包目录约定

```text
scenario-id/
  task.md                 用户只会看到的真实需求（只描述症状/目标，不含修复提示）
  base/                   固定起始仓库（Agent 从这份代码开始工作）
  environment.yaml        依赖、工具、权限和预算
  acceptance/check.mjs    可执行验收器：node check.mjs <workspace>，退出码 0 = 通过
  oracle/                 仅供 evaluator 使用，Agent 与模型上下文不得读取
  interruption-plan.md    取消/崩溃注入点与恢复验证方式
  expected-artifacts.md   patch、报告、截图、Run Manifest 等交付要求
```

- `task.md` 是 Agent 唯一能看到的需求描述；缺陷位置、期望实现等线索必须放在 `oracle/`。
- 验收器必须真实可执行且**不依赖 Agent 未要求的工具**；无法在本机执行的验收（浏览器、GPU、凭据）在
  `expected-artifacts.md` 中如实标记为外部门禁。
- Agent 暂时无法通过时，runner 记录失败分类（`acceptance_failed` / `runner_error` /
  `external_dependency_missing`）与 trace，**禁止降低验收标准换取绿灯**。

## runner 用法

```bash
node tests/scenarios/runner.mjs list                          # 发现全部场景
node tests/scenarios/runner.mjs validate [scenarioId]         # 校验任务包结构
node tests/scenarios/runner.mjs check <id> --workspace <dir>  # 在给定工作区运行验收器
node tests/scenarios/runner.mjs check <id> --workspace <dir> --json out.json
node tests/scenarios/runner.mjs check <id> --from-base        # 从 base/ 复制隔离临时工作区再验收
npm run check:scenarios                                       # CI 等价入口（validate）
```

所有命令输出结构化 JSON；`check` 退出码 0
= 验收通过。场景发现与结构校验已接入自动门禁（`tests/scenarios/scenarios.test.ts`，随 `npm test`
运行）；同一门禁还运行**受控完成 fixture 的真实业务验收**（bug-hunt 完整实现通过、near-miss 实现被业务边界黑盒抓住、web-game 完成实现通过），防止「结构合法但业务失败」的假绿灯。

## 路径安全与失败分类

- **scenarioId containment**：`list`/`validate`/`check` 对 scenarioId 使用同一 canonical
  direct-child containment（真实路径必须位于 `tests/scenarios/` 直接子目录，拒绝 `..`
  穿越、绝对路径、链接逃逸与深层路径），**不提供外部场景例外**——任何越界 id 都输出 `runner_error`
  且不执行任何外部脚本。Runner 自测需要临时场景时，把 `runner.mjs` 与其 `vendor/`
  复制到临时场景根再运行（本文件自包含）。
- **workspace containment**：`--workspace` 拒绝场景目录、`base/`、`oracle/`、`tests/scenarios/`
  及其祖先目录（如仓库根），也拒绝指向这些位置的链接。
- **environment.yaml schema**：真实 YAML parser（vendored
  js-yaml，`vendor/`，MIT），重复 key 即结构错误；随后按显式 schema 校验必需字段（`scenario`、`title`、`runtime`、`tools`、
  `permissions`、`budget`、`evaluation`，`dependencies`
  可选）、字段类型、嵌套结构与未知字段。缺字段、类型错误、未知字段都记为 invalid，`title: incomplete`
  这类残缺文件不再通过。
- **acceptance 输出协议**：输出必须是合法 JSON 对象（**不可解析时不论退出码一律 `runner_error`**，带
  `protocolError`）；`status` 只允许 `pass`/`fail` 且 `pass` 必须**显式声明** （exit 0 输出
  `{}`、数组等一律 `runner_error`）；`failureClassification` 只允许五种分类且必须与 `status`
  一致；`checks`（若存在）必须是 `{ name: string, pass: boolean }` 数组，且必须与总 `status`
  一致——`pass` 时不得存在 `pass=false` 的阻塞检查项（`nonBlocking: true` 项除外）， `fail`
  时必须存在未通过的阻塞检查项。协议违规返回 `runner_error` 并带 `protocolError`
  说明，绝不制造假绿灯。分类优先级：Runner 自身超时（`timedOut`）→
  `runner_error`；验收器自发信号退出 → `runner_error`；acceptance 显式声明的
  `external_dependency_missing` 分类被保留。

## 工作区与 oracle 隔离

- **推荐入口 `--from-base`**：runner 从 `base/` 复制出独立临时工作区（`os.tmpdir()` 下）， `oracle/`
  等任务包文件不会进入工作区；结果 JSON 带 `workspacePath` 与 `prepared: true`。
- **防呆**：`--workspace` 拒绝把场景目录、`base/`、`oracle/`
  或包含它们的目录（含仓库根）直接作为 workspace。
- 调用方（L3 执行层或人工）使用 `--workspace` 时，仍须自行保证：任务输入只包含 `task.md`
  与工作区内容；`oracle/` 只交给 evaluator，不得出现在 Agent 可见根目录中。

## 统一评价维度

功能正确性、工程质量、自主性、安全性、恢复性、性能和可审计性。性能至少记录：总时间、模型轮次、工具次数、Token、Session/Artifact 大小与 Workspace 扫描成本。

## 测试分层

```text
L0  单元测试：状态机、Schema、Policy、算法
L1  集成测试：Runtime—Session—Tool—Sandbox 闭环
L2  真实本地业务场景：真实文件、构建、确定性 evaluator（本目录）
L3  真实 Provider 场景：固定模型与预算，评价 Agent 联合能力
L4  大型代码库长任务：多小时、中断恢复、人类纠偏
```

发布判断不能只凭 L0/L1；状态与安全改动还应通过对应 L2 场景。

## 场景矩阵

| 场景          | 任务示例                             | 必须验证                                   | 验收产物                           |
| ------------- | ------------------------------------ | ------------------------------------------ | ---------------------------------- |
| 网页游戏      | 从空目录实现记忆翻牌小游戏           | 多文件规划、前端实现、运行修复、交互可用   | 可启动项目、自动测试、Run Manifest |
| 项目 Bug 排查 | 给定带真实缺陷的中型仓库，只描述症状 | 搜索定位、复现、最小修复、回归、不过度改动 | 复现记录、patch、测试、原因说明    |

后续按路线图补充：前端素材库、3D 模拟、引擎算法优化，以及至少一个大型现有代码库场景。
