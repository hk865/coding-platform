# S85 S1 回复：D2 — 一个工具组装配模块

提交：`0695a5f` `S85 S1: D2 tool-group assembly`（base `s85-base` = `e94d7b9` / lead `20f64821`）。

## 0. 看不懂或偏离的地方

1. **scratch 路径（环境限制，不是书的问题）。** 本会话的写沙箱只允许写仓库工作区，`/home/han001/dsh-work/s85-scratch/S1` 创建时被拒（`Permission denied`，提权 `danger-full-access` 也没有审批通道）。所有 base/result 副本、探针、日志改放在 **`/tmp/s85-scratch/S1`**（仍在仓库副本之外）。探针脚本按“传入副本根目录”工作，换根即可复跑；下面列了完整路径与命令。
2. **书 §5.2 的 `createGraphHistoryProxy` 附注。** 书写“Query imports it there”。按要求把旧导出从 `execution-driver.ts` 重导出了，但 D2 重接后 Query 改走 `createQueryGraphToolGroup`，已无模块从 execution-driver 导入它。重导出保留。
3. **inventory 里的 `createReadonlyCommandToolGroup`** 没有做：书 §5.2 的 Target 列表没有它，且明确“read-only command tool 已经共享，leave it”（书优先于 inventory）。
4. 没有其它阻塞；没有跳过书里的步骤。

## 1. 摘要（< 300 字）

D2 完成。新增 `src/core/agent-runtime/tool-group-assembly.ts`（445 行），把 Work 的协调工具选择、Query 的 graph 工具组、review/rerun 单工具适配、graph history 代理、以及 model loop 的扩展槽归一化/enabled/authorized 名单集中到一处。`execution-driver.ts`、Runtime `query-execution.ts`、`observed-model-run.ts` 只保留各自的资格、失败协议、身份构造、资源开关和调用时点，改为调用新模块；旧导出 `BUILTIN_TOOL_NAMES`、`RESERVED_TOOL_NAMES`、`createGraphHistoryProxy`（execution-driver）与 `EXPLORATION_TOOL_NAMES`（observed-model-run）按原对象/原元组重导出。Work/Query 的失败检查、两句“no graph read dependency”文字、Work 检查顺序与六组顺序、Kernel enabled/authorized/定义顺序、名字与工厂缺失的旧规则、存储读取次数与时钟时点均未改。测试未改一行，生产代码无新增校验/错误路径。类型检查、架构检查、build、`s85-tests.txt` 全部 28 个测试文件 + `tests/architecture` 全绿（302 项通过）。byte proof 在 base 与 result 副本上各捕获 321 次调用，base 自比与 base↔result 均为 0 差异；八个场景全部捕获。新增+删除 807 行（+486 / −321，净 +165），在 700–900 范围内。

## 2. 分步表

| 步骤 | 状态 | 说明 |
| --- | --- | --- |
| 建 `tool-group-assembly.ts`（照抄 base 三个文件） | 完成 | 445 行；`selectWorkToolGroup` 函数体与 base `selectCoordinationTools`（:238–340）逐行相同（只多外层 `}`）；graph history 代理体照抄 |
| 重接 `execution-driver.ts` | 完成 | 删 270 行、加 20 行；改为 `selectWorkToolGroup` / `createReviewToolGroup` / `createRerunToolGroup`；资格与缺 owner 检查仍在原处；旧导出重导出 |
| 重接 Runtime `query-execution.ts` | 完成 | 只替换 handle/`coordinationTools` 字面量；graph 名称过滤、依赖检查、条件 `readPreparationFacts`、身份构造未动 |
| 重接 `observed-model-run.ts` | 完成 | 13 加 / 35 删；`assembleObservedExtensions(o)` + `kernelEnabledToolNames(...)` 在原计算点调用；资源打开/登记/关闭未动 |
| 旧导出保持 | 完成 | 同一 `Set` 对象、同一 `as const` 元组、同签名函数重导出 |
| byte proof（§5.0） | 完成 | 3 个探针，321/321 次捕获，0 差异；八场景全捕获 |
| 检查（typecheck / architecture / build / tests） | 完成 | 全绿 |
| 提交 / 范围 / 尺寸 | 完成 | 见 §6 |

## 3. 新模块接口表（S4 按此编码）

路径均为 `src/core/agent-runtime/tool-group-assembly.ts`。

| 导出 | 签名 | 来源（base） | 使用方 |
| --- | --- | --- | --- |
| `ToolGroup` | `{ names: readonly string[]; create: (workspace: WorkspaceSandbox) => ToolDefinition[] }` | `execution-driver.ts:130`（`CoordinationTools`；同 query-execution.ts:224 内联形） | `selectWorkToolGroup`、`createQueryGraphToolGroup`、review/rerun group、`assembleObservedExtensions` |
| `ToolGroupResult<T = ToolGroup>` | `{ ok: true; value: T } \| { ok: false; rejection: CoreRejection }` | `execution-driver.ts:237` 返回联合 | `selectWorkToolGroup`、`createReviewToolGroup`、`createRerunToolGroup` |
| `GraphHistoryProxyInput` | `{ graph: GraphContextReadPort; history: GraphExecutionHistoryReadPort; goalRef: GoalRef; hostContext: CoreCallContext }` | `execution-driver.ts:146–151` 内联参数 | `createGraphHistoryProxy` |
| `WorkToolGroupInput` | 原 `selectCoordinationTools` 参数，逐字段不变（selected/mailbox/decisionMessages?/applicationReceipt?/sessions/plans/context/sessionRef/goalRef/requestIdForCall/onWaitRegistered?/graph?/notes?/extensionNames?） | `execution-driver.ts:206–237` | `selectWorkToolGroup` |
| `BUILTIN_TOOL_NAMES` | `Set<string>`（`['read','write','shell']`） | `execution-driver.ts:122` | `execution-driver.ts` 重导出 + builtin 过滤；`tests/runtime/K3-34…` 从旧路径导入 |
| `RESERVED_TOOL_NAMES` | `Set<string>`（15 项） | `execution-driver.ts:125–128` | `execution-driver.ts` 重导出；`tests/runtime/K3-34…` |
| `EXPLORATION_TOOL_NAMES` | 同字面量 `as const` 元组（10 项） | `observed-model-run.ts:176–179` | `observed-model-run.ts` 重导出；`kernelEnabledToolNames`；`tests/runtime/K3-34…` |
| `createGraphHistoryProxy` | `(input: GraphHistoryProxyInput) => GraphExecutionHistoryReadPort` | `execution-driver.ts:132–196` | `selectWorkToolGroup`、`createQueryGraphToolGroup`；`execution-driver.ts` 重导出（旧入口保留） |
| `selectWorkToolGroup` | `(input: WorkToolGroupInput) => ToolGroupResult<ToolGroup \| null>` | `execution-driver.ts:198–340` | `execution-driver.ts:447`（原调用点） |
| `createQueryGraphToolGroup` | `(input: { names: readonly string[]; context: CoreCallContext; goalRef: GoalRef; graph: GraphContextReadPort; inputs: TaskContextInputPort; history: GraphExecutionHistoryReadPort; hostContext: CoreCallContext }) => ToolGroup` | `query-execution.ts:239–255` | Runtime `query-execution.ts:239`（原事实读取之后） |
| `createReviewToolGroup` | `(input: Parameters<typeof createUnknownCallReviewTools>[0]) => ToolGroupResult` | `execution-driver.ts:729–743` | `execution-driver.ts` review 分支（资格与缺 owner 检查之后） |
| `createRerunToolGroup` | `(input: Parameters<typeof createCommandRerunTools>[0]) => ToolGroupResult` | `execution-driver.ts:760–773` | `execution-driver.ts` rerun 分支（`purpose === undefined && blockedBinding.length > 0` 之后） |
| `assembleObservedExtensions` | `(input: Pick<ObservedModelRunOptions, 'coordinationTools' \| 'readonlyCommandTool' \| 'unknownCallReviewTool' \| 'unknownCallReviewToolName' \| 'commandRerunTool' \| 'commandRerunToolName'>) => ToolGroup` | `observed-model-run.ts:288–300, 333–336` | `observed-model-run.ts:276`（`assembleObservedExtensions(o)`） |
| `kernelEnabledToolNames` | `(input: { allowed: readonly string[]; hasRead: boolean; reviewSource: boolean; hasFrozenSource: boolean; hasMaterialTools: boolean; extensionNames: readonly string[] }) => string[]` | `observed-model-run.ts:280–285, 301–303` | `observed-model-run.ts:277` |

说明：`assembleObservedExtensions(o)` 传原始 options 对象；coordination 的 `create` 在 Kernel 回调时从 options 读取，readonly/review/rerun 三个槽在装配时快照（与 base 的 const 时点一致）；`names` 在装配时复制。review/rerun 的 `create` 返回单元素数组，工厂无定义时抛原来那句 `Error`；无名字返回原来的 `unsupported` 文字。Query 组只过滤、不做完整性检查。

## 4. Byte proof（§5.0）

### 4.1 探针表

同一个探针按同一语义加到 base 与 result。所有捕获在 `src/core/agent-runtime/observed-model-run.ts`。

| 探针 | 包住什么（符号、文件、base 行） | base 调用 | result 调用 | 差异 |
| --- | --- | --- | --- | --- |
| `observed-lists` | `enabledNames` + `hostAuthorizedTools` 数组，`observed-model-run.ts:301–303`、`:316` | 98 | 98 | 0 |
| `additional-tools` | 现有 `additionalTools` 回调自己的返回值（只包返回值，不额外调用任何工厂；定义名字按顺序），`:317–338` | 95 | 95 | 0 |
| `model-client-tools` | 模型客户端输入处的完整 `request.tools`（Kernel 转换并按名排序后的 specs，含描述/schema，按收到顺序），`:258–267` | 128 | 128 | 0 |
| **合计** | | **321** | **321** | **0** |

`compare.py` 按 §5.0 规则 4：字符串按 UTF-8 buffer（首差打印字节偏移/长度/前后 16 字节）、数组逐元素保序、对象按自有键顺序、`missing`/`undefined`/`null` 分开、数字精确、不排序不规范化。比较键一致（test file + test name + run index + probe 种类）。

- 确定性：`base-1` vs `base-2`：321 vs 321，**0 差异**（`base-compare.txt`）。
- 结果：`base-1` vs `result-1`（HEAD `0695a5f`）：321 vs 321，**0 差异**（`result-compare.txt`）。
- 有 3 个 `source-tool-lifecycle` 的 pre-Kernel 失败 run 根本没执行 `additionalTools` 回调；按“未运行”记录，未当作 equal。

### 4.2 八个场景（书 §5.2）

| # | 场景 | 到达的测试 / 探针驱动（run index） | base/result |
| --- | --- | --- | --- |
| 1 | Work，六组协调工具全有（mailbox/user decision/whiteboard/session discovery/graph/note） | 探针驱动 `probe case 1`（`tests/runtime/__probe-cases.test.ts`，idx 1） | 捕获，0 差异 |
| 2 | Work，无协调工具 | `tests/runtime/K-readonly-command.test.ts` :: “KB-07 authorized empty-write Work sees run_readonly_command, runs it and stores the output in this execution”（idx 1） | 捕获，0 差异 |
| 3 | review Run | 探针驱动 `probe case 3 + 4`（idx 2，`record_unknown_call_review`） | 捕获，0 差异 |
| 4 | proposal Run | 探针驱动 `probe case 3 + 4`（idx 3，`propose_safer_method`） | 捕获，0 差异 |
| 5 | blocked commands（rerun） | 探针驱动 `probe case 5`（idx 3，`request_command_rerun`） | 捕获，0 差异 |
| 6 | Query 有 graph 工具 | `tests/runtime/S3-graph-tools.test.ts` :: “GT10 sends find then look through the real Query Kernel seam and reports no workspace change and no write tool”（idx 1） | 捕获，0 差异 |
| 7 | Query 无 graph 工具 | `tests/runtime/K-readonly-command.test.ts` :: “KB-09 an authorized Query granted shell, edit and write still sees none of them”（idx 1） | 捕获，0 差异 |
| 8 | fixed-source（`read_source`/`read_material`） | 探针驱动 `probe case 8`（idx 1） | 捕获，0 差异 |

为什么用驱动：`B2-01-shell-hook` 只到 hook（24 次捕获都是 fixture 的原 Run，没有 `request_command_rerun`）；`K3-14` 只证明普通 Run 不注册 review 工具；`K3-16` 是单元测试、零捕获；没有签入测试同时授权 `read_source`+`read_material`。驱动在 scratch 副本里调用现有公共入口 + scripted model，没有进 result。

### 4.3 锚点适配（语义不变）

| 捕获点 | base 锚点 | result 锚点 |
| --- | --- | --- |
| import | `kernelToolNameOf` import 之后 | `assembleObservedExtensions, kernelEnabledToolNames` import 之后 |
| `hostAuthorizedTools` | `[...coordinationNames, ...readonlyCommandNames, ...unknownCallReviewNames, ...commandRerunNames]` | `[...extensions.names]`（同一 local-log-use 包装） |
| `additionalTools` 收尾 | `if (commandRerunTool !== undefined) tools.push(...)` | `tools.push(...extensions.create(workspace))` |
| `additionalTools` 开头 / client stream | 不变 | 不变 |

### 4.4 探针文件与命令

`S=/tmp/s85-scratch/S1`

- 探针：`$S/probes/README.md`、`apply-probe.py`、`probe-log.ts`、`probe-cases.test.ts`、`compare.py`
- 日志：`$S/probes/logs/base-1`、`base-2`、`result-1`；报告 `base-compare.txt`、`result-compare.txt`
- 副本：`$S/base`（`git archive s85-base`）、`$S/result-1`（`git archive HEAD`），两者的 `node_modules` 都是指向工作区的 symlink
- 复跑（base 或 result 副本根）：

```bash
python3 $S/probes/apply-probe.py <copy-root>
S85_PROBE_LOG_DIR=$S/probes/logs/<name> timeout 900 npx vitest run --maxWorkers=2 \
  tests/runtime/C2-runtime-platform-tools.test.ts tests/runtime/S3-graph-tools.test.ts \
  tests/runtime/K-readonly-command.test.ts tests/runtime/K3-14-record-unknown-call-review-tool.test.ts \
  tests/runtime/K3-16-proposal-tool.test.ts tests/runtime/B1-kernel-assembly.test.ts \
  tests/runtime/source-tool-lifecycle.test.ts tests/runtime/B2-01-shell-hook.test.ts
S85_PROBE_LOG_DIR=$S/probes/logs/<name> timeout 900 npx vitest run --maxWorkers=2 tests/runtime/__probe-cases.test.ts
cd $S/probes && python3 compare.py logs/<left> logs/<right>
```

## 5. 测试与检查

### 5.1 测试文件（书 §3 / run sheet）

`./.dsh-ref/s85-tests.txt` 的 28 个文件 + `tests/architecture`，分两条并发命令，均 `timeout 900 npx vitest run --maxWorkers=2`，不超过 10 个文件/命令：

| 批次 | 文件 | 结果 |
| --- | --- | --- |
| A（2 条命令） | `s85-tests.txt` 前 20 个（AG6、cpp-source-index、B1、B2-01…B2-09、B2-13…B2-401、C2、K-readonly、K3-14、K3-16、K3-34） | 20/20 文件通过，163 项通过，0 失败，0 跳过 |
| B（1 条命令） | 后 8 个（K3-B3、R4c×3、S3-graph-tools、W2、source-text-loop-migration、source-tool-lifecycle）+ `tests/architecture`（4 个测试文件） | 12/12 文件通过，139 项通过，0 失败，0 跳过 |
| **合计** | **32 个测试文件** | **302 项通过，0 失败，0 跳过** |

没有环境失败（无 bwrap/systemd 报错）；没有改测试或 allowlist。

### 5.2 检查（§3，逐个执行）

| 检查 | 结果 |
| --- | --- |
| `flock /tmp/s85-scratch/tsc.lock npm run typecheck` | 绿（exit 0） |
| `npm run check:architecture` | 绿（`next source boundaries: OK`） |
| `flock /tmp/s85-scratch/tsc.lock npm run build` | 绿（exit 0） |
| `s85-tests.txt` + `tests/architecture` | 见上，全绿 |

## 6. 范围、尺寸、提交

- 提交：`0695a5f`（paths `src`，message `S85 S1: D2 tool-group assembly`）。
- `git diff --name-only s85-base HEAD | grep -vE -f ./.dsh-ref/s85-whitelist.txt`：无输出。
- `git diff --name-only s85-base HEAD -- tests`：无输出。
- `git status --porcelain`：无输出。
- `git diff --numstat s85-base HEAD`：

| 文件 | 加 | 删 |
| --- | --- | --- |
| `src/core/agent-runtime/execution-driver.ts` | 20 | 270 |
| `src/core/agent-runtime/observed-model-run.ts` | 13 | 35 |
| `src/core/agent-runtime/query-execution.ts` | 8 | 16 |
| `src/core/agent-runtime/tool-group-assembly.ts`（新文件，对空文件计） | 445 | 0 |
| **合计** | **486** | **321** |

**新增+删除 = 807，净 +165**；对照 run sheet 的“约 800（700–900）”在范围内。

## 7. 对书 / inventory / run sheet 的疑点

1. run sheet 指定的 `$S85_SCRATCH` 在本沙箱不可写（见 §0.1），已改用 `/tmp/s85-scratch/S1`；探针脚本以参数接收副本根，lead/Codex 换路径即可复跑。
2. §5.2 “Query imports it there”：重接后 Query 不再从 `execution-driver.ts` 导入 `createGraphHistoryProxy`；旧导出仍保留。
3. inventory 的 `createReadonlyCommandToolGroup` 与书 §5.2 的 Target 列表不一致；按书不实现（只读命令构造已共享，明确 leave it）。
4. 无其它 UNSPECIFIED；没有半移文件，没有跳过项。

## 8. HANDOFF

不适用：本 run 已提交并全绿，无未完成步骤。
