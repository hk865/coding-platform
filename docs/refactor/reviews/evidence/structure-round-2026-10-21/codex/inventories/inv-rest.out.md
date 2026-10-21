四项都可以按“只搬结构”推进，但应收窄两处：D2 不统一 Work、Query 的资格检查和失败协议；A6 本轮只抽出 Work 已在用的纯规则，不提前接 Query。当前替换函数的直接调用只有 `planRunActivity`，Query 的复用是后续安排。依据：`src/core/agent-runtime/execution-driver.ts:238–335`、`src/core/agent-runtime/query-execution.ts:213–255`、`src/core/work-graph/tasks/run-activity-service.ts:151–188`、`.lead-ref/d84-refute-A.out.md:10`。

以下行号来自当前文件；新路径和接口均为建议。行数估计按新增＋删除计算，搬移计两次。全程未写文件，未运行测试、构建、git 或网络操作。

为避免长路径反复挤占表格，下面使用三个明确的路径前缀：

- `AR/`＝`src/core/agent-runtime/`
- `WG/`＝`src/core/work-graph/`
- `T/`＝`tests/`

“调用方”列举被搬符号的直接调用、导入，以及原入口的生产接线和测试构造入口；覆盖测试另列，不把测试通过等同于字节等价证明。

**1．D2：集中工具组装配，保留各调用类的判断位置**

当前需要处理的代码：

| 内容 | 当前位置 | 直接调用方 |
|---|---|---|
| 平台工具名集合、探索名称集合、builtin/reserved 集合、`CoordinationTools` | `AR/execution-driver.ts:98–130` | `selectCoordinationTools`：`AR/execution-driver.ts:238–250`；builtin 筛选：`:651` |
| `createGraphHistoryProxy` | `AR/execution-driver.ts:132–196` | Work：`AR/execution-driver.ts:297`；Query：`AR/query-execution.ts:21`、`:244` |
| `selectCoordinationTools`：名称筛选、依赖检查、六组工厂、产物检查 | `AR/execution-driver.ts:198–340` | 唯一调用：`AR/execution-driver.ts:687–712` |
| review/proposal 工厂及单工具适配 | `AR/execution-driver.ts:729–743` | 同文件 start 路径；传入模型循环：`:1220–1221` |
| rerun 工厂及单工具适配 | `AR/execution-driver.ts:760–773` | 同文件 start 路径；传入模型循环：`:1222–1223` |
| Query graph 工厂及过滤 | `AR/query-execution.ts:239–255` | 同文件 start 路径；模型循环入口：`:505` |
| 三种专用工具槽转换为名字、最终 enabled/authorized 名单、定义追加顺序 | `AR/observed-model-run.ts:288–303`、`:316–337` | Work：`AR/execution-driver.ts:1211`；Query：`AR/query-execution.ts:505` |
| 探索工具名称及 enabled 名单的条件选择 | `AR/observed-model-run.ts:176–179`、`:280–285`、`:301–303` | Work 名称识别：`AR/execution-driver.ts:24`、`:108`；名称测试：`T/runtime/K3-34-tool-name-constants.test.ts:13`、`:65–68` |

只读命令构造已经合一，不再重做：`registerReadonlyCommandTool` 已被 Work、Query 共用，分别在 `AR/execution-driver.ts:1151–1159`、`AR/query-execution.ts:360–368` 调用；实现位于 `AR/readonly-command-tool.ts:409–438`。

建议新增 `src/core/agent-runtime/tool-group-assembly.ts`。所有工具组使用同一种有效值形状：

```ts
export type ToolGroup = {
  names: readonly string[];
  create: (workspace: WorkspaceSandbox) => ToolDefinition[];
};

export type ToolGroupResult<T = ToolGroup> =
  | { ok: true; value: T }
  | { ok: false; rejection: CoreRejection };

export type GraphHistoryProxyInput = {
  graph: GraphContextReadPort;
  history: GraphExecutionHistoryReadPort;
  goalRef: GoalRef;
  hostContext: CoreCallContext;
};

export function createGraphHistoryProxy(
  input: GraphHistoryProxyInput,
): GraphExecutionHistoryReadPort;
```

Work 输入原样提取，不能用一个新的“大 deps”替代：

```ts
export type WorkToolGroupInput = {
  selected: readonly string[];
  mailbox: SessionMailboxPort | undefined;
  decisionMessages?: RuntimeExecutionDependencies['decisionMessages'];
  applicationReceipt?: RuntimeExecutionDependencies['applicationReceipt'];
  sessions: SessionDirectoryPort;
  plans: PlanTaskPort;
  context: CoreCallContext;
  sessionRef: SessionRef;
  goalRef: GoalRef;
  requestIdForCall: (call: Readonly<ToolCall>) => string;
  onWaitRegistered?: (message: SessionMessage) => void;
  graph?: {
    graphContext: GraphContextReadPort;
    taskInputs: TaskContextInputPort;
    graphHistory: GraphExecutionHistoryReadPort;
    hostContext: CoreCallContext;
  };
  notes?: RuntimeExecutionDependencies['notes'];
  extensionNames?: ReadonlySet<string>;
};

export function selectWorkToolGroup(
  input: WorkToolGroupInput,
): ToolGroupResult<ToolGroup | null>;

export function createQueryGraphToolGroup(input: {
  names: readonly string[];
  context: CoreCallContext;
  goalRef: GoalRef;
  graph: GraphContextReadPort;
  inputs: TaskContextInputPort;
  history: GraphExecutionHistoryReadPort;
  hostContext: CoreCallContext;
}): ToolGroup;

export function createReviewToolGroup(
  input: Parameters<typeof createUnknownCallReviewTools>[0],
): ToolGroupResult;

export function createRerunToolGroup(
  input: Parameters<typeof createCommandRerunTools>[0],
): ToolGroupResult;

export function createReadonlyCommandToolGroup(
  input: ReadonlyCommandRegistrationInput,
): ToolGroup | null;
```

模型循环保留现有公开 options，通过内部适配收拢旧槽：

```ts
export function assembleObservedExtensions(
  input: Pick<ObservedModelRunOptions,
    | 'coordinationTools'
    | 'readonlyCommandTool'
    | 'unknownCallReviewTool'
    | 'unknownCallReviewToolName'
    | 'commandRerunTool'
    | 'commandRerunToolName'>,
): ToolGroup;

export function kernelEnabledToolNames(input: {
  allowed: readonly string[];
  hasRead: boolean;
  reviewSource: boolean;
  hasFrozenSource: boolean;
  hasMaterialTools: boolean;
  extensionNames: readonly string[];
}): string[];
```

这两个适配应在原来计算名单的位置调用。资源打开、探索 handle 登记、关闭和错误优先级继续留在模型循环；原位置分别是 `AR/observed-model-run.ts:279`、`:319–330`、`:377–397`。不要因统一工具组，把资源打开提前到 driver 的装配阶段。

必须留在原处的判断：

- Work 的未知名称、缺依赖判断仍先于后面的 Role/Host 核对；当前顺序为装配 `AR/execution-driver.ts:687–774`，Role/Host `:802–849`。
- Query 先筛 graph 名称、检查 graph 依赖，只有非空时才读一次 preparation facts；身份构造也留在这里。`AR/query-execution.ts:213–238`。
- review/proposal 的资格与缺 owner 检查留在 driver；普通 Work 的 rerun 资格仍是 `purpose === undefined && blockedBinding.length > 0`。`AR/execution-driver.ts:722–728`、`:750–759`。
- Query 的准备期权限投影不搬；它保留 Host 名单的过滤顺序。`AR/query-preparation.ts:141–143`、`:199–218`。
- review 两个正式名单不改：review 是 `read、run_readonly_command、record_unknown_call_review`，proposal 最后一项换成 `propose_safer_method`。`src/contracts/review-admission.ts:29–40`。

旧出口必须保留：

| 旧模块出口 | 保留方式及消费者 |
|---|---|
| `execution-driver.ts` 的 `BUILTIN_TOOL_NAMES`、`RESERVED_TOOL_NAMES` | 原 `Set<string>` 实现搬入新模块，旧模块重导出；测试直接导入：`T/runtime/K3-34-tool-name-constants.test.ts:15–16`、`:45–62` |
| `execution-driver.ts` 的 `createGraphHistoryProxy` | 同签名重导出；当前 Query 导入：`AR/query-execution.ts:21` |
| `observed-model-run.ts` 的 `EXPLORATION_TOOL_NAMES` | 原只读字面量元组搬入新模块并重导出；消费者：`AR/execution-driver.ts:24`、`T/runtime/K3-34-tool-name-constants.test.ts:13` |
| `runObservedModel`、`ObservedModelRunOptions` | 原名、原签名、原可选字段全部保留，不要求调用者改用新工具组；现有槽见 `AR/observed-model-run.ts:89–123` |

`runObservedModel` 的直接测试调用分布在：

- `T/app/AG6-agent-assembly.test.ts:193`
- `T/data/cpp-source-index.test.ts:148`
- `T/runtime/B1-kernel-assembly.test.ts:189–425`
- `T/runtime/R4c-execution-history.test.ts:54`
- `T/runtime/R4c-graph-history.test.ts:234`
- `T/runtime/R4c-session-continuity.test.ts:66–139`
- `T/runtime/source-text-loop-migration.test.ts:186`
- `T/runtime/source-tool-lifecycle.test.ts:125–220`
- `T/runtime/W2-role-skills.test.ts:145–221`

两个 driver 的生产构造入口不搬：`AR/runtime.ts:687–689`。

D2 专属保留清单：

1. **不能把两条路径的失败检查合成一个规则。** Work 有：
   `throw new Error('the coordination tool factory did not produce exactly the selected definitions')`；
   Query 只有 `handle.create(workspace).filter(...)`，没有完整性、重复项检查。两处为 `AR/execution-driver.ts:330–335`、`AR/query-execution.ts:251–254`。

2. **缺依赖文字不能统一。** Work 使用  
   `the Run selects graph read tools but no graph read dependency is bound: ...`；  
   Query 使用  
   `the Query grant selects graph read tools but no graph read dependency is bound: ...`。  
   两者均为 `unsupported`，但触发位置不同。`AR/execution-driver.ts:261–262`、`AR/query-execution.ts:215–223`。

3. Work 检查顺序保持：未知名字 → 无协调工具直接返回 null → mailbox → decisionMessages → graph → note write/check → 建工厂 → 名字重复 → reserved 冲突 → 实例化时产物检查。不要删除第二次 note 依赖检查。`AR/execution-driver.ts:238–335`。

4. Work 工具组顺序固定为 mailbox、user decision、whiteboard、session discovery、graph、note；各组保持自身常量顺序，不能按 manifest 顺序或字母顺序重排。`AR/execution-driver.ts:245–250`、`:318`。组内常量见 `AR/communication-tools.ts:45–63`、`AR/whiteboard-tools.ts:55–60`、`AR/session-discovery-tools.ts:34`、`AR/graph-tools.ts:45`、`AR/note-tool.ts:40`。

5. Kernel enabled 名单保持“builtin／固定源读取前缀 → exploration → coordination → readonly command → review → rerun”；authorized 名单只有后四类。定义构造顺序保持 exploration → material → coordination → readonly → review → rerun。`AR/observed-model-run.ts:301–303`、`:316–337`。

6. **名字与工厂缺失不能补成新错误。** 当前 review/rerun 只给工厂、不给名字时，名字不进入名单，但工厂仍会被调用；只有名字没有工厂时不注册。内部归一化必须照旧，而非增加“配对完整性”检查。`AR/observed-model-run.ts:294–300`、`:335–336`。

7. `names` 在装配时复制；coordination 的 `create` 在 Kernel 回调执行时才从 options 取。不要顺手统一快照时点。`AR/observed-model-run.ts:288`、`:333`。可选字段仍用原条件展开，不能补成显式 `undefined`；Work 原接线见 `AR/execution-driver.ts:1218–1223`。

8. 工厂装配不新增存储读取；Query 保留上述条件读取。历史代理每次先读 Run card，只有全部检查通过才读历史，保留异常文字、workspace 检查及 ` (Run ...)` 后缀。`AR/execution-driver.ts:153–193`。只读命令授权读取条件也不变：Work `:1119–1127`，Query `AR/query-execution.ts:314–322`。

现有重点测试及缺口：

| 测试 | 已覆盖 |
|---|---|
| `T/runtime/C2-runtime-platform-tools.test.ts:185`，`exposes only the granted platform tools, skips the source authorization, and honors an explicit empty Skill set (RED)` | 平台工具授权、无源读取时零授权读取 |
| 同文件 `:234`，`refuses a Run granted the two rework tool names at the start, before any provider call (GAP-46)` | 未知／未接工具拒绝 |
| `T/runtime/S3-graph-tools.test.ts:505`、`:534`，GT10、GT11 | Query 真正调用 graph、写工具排除 |
| 同文件 `:706`、`:728`，GT19、GT20 | Work 有 `record_note`，Query 不注入 |
| `T/runtime/K-readonly-command.test.ts:492`、`:539`、`:754`、`:767`，KB-07、KB-09 | Work/Query 只读命令及 mutation 名称处理差异 |
| `T/runtime/K3-14-record-unknown-call-review-tool.test.ts:223` | 普通 Run 不注入 review 工具 |
| `T/runtime/K3-16-proposal-tool.test.ts:82` | review/proposal 工厂选择 |
| `T/runtime/source-tool-lifecycle.test.ts:164`、`:204` | 后续工厂抛错时资源关闭与原错误优先级 |

名单顺序仍有缺口：平台集成测试先排序再比较，常量测试也排序；顺序回归可以逃过这些断言。`T/runtime/C2-runtime-platform-tools.test.ts:201–202`、`T/runtime/K3-34-tool-name-constants.test.ts:45–68`。上述集成测试也没有完整覆盖所有缺依赖组合、Query 工厂异常产物、旧 options 单边缺字段；这些必须逐行保持，不能用新增校验“补齐”。

估计 **800 行**，合理范围 700–900。文件为三个现有文件 `AR/execution-driver.ts`、`AR/query-execution.ts`、`AR/observed-model-run.ts`，加新 `AR/tool-group-assembly.ts`。工具实现文件只导入，不编辑，因此与 D3 搬工具说明不争文件。D3 要搬的说明范围见 `docs/refactor/design/orchestration-2026-10/slices/slice-6-7-PROMPTS-SPEC.md:284–300`。

**2．C2：只合并四段稳定窗口控制流**

四段控制流及其唯一窗口调用：

| 外壳 | 待替换范围 | 窗口函数及调用 |
|---|---|---|
| 日历 | `WG/views/activity-read-model.ts:768–786` | 定义 `:222`，调用 `:773` |
| Run 活动列表 | `WG/views/activity-read-model.ts:793–811` | 定义 `:683`，调用 `:798` |
| 轨道 | `WG/views/track-read-model.ts:1169–1188` | 定义 `:1097`，调用 `:1174` |
| 任务时间线 | `WG/views/task-state-timeline.ts:543–561` | 定义 `:452`，调用 `:548` |

`Budget`、底层读取、`readWatermark` 已共享，不搬、不换算法。`WG/views/activity-read-helpers.ts:37–43`、`:56–130`。

建议新建 `src/core/work-graph/views/activity-stable-window.ts`：

```ts
export const ACTIVITY_WINDOW_MAX_ATTEMPTS = 4;

export function readStableActivityWindow<T>(input: {
  records: Parameters<typeof readWatermark>[0];
  cap: number;
  read: (budget: Budget) => Promise<ReadResult<T>>;
  mapError: (error: unknown) => CoreRejection;
  exhausted: () => CoreRejection;
}): Promise<ReadResult<T>>;
```

`read` 必须是延迟回调。日历传入的是 `budget => readCalendarWindow(deps, ctx, input, now(), budget)`，不能先求 `now()`。

输入验证、window 字符串、容量错误和耗尽错误的构造、`ForbiddenError` 留在调用方。三个原工厂及全部类型保持原出口：

- `createActivityReadModel`：`WG/views/activity-read-model.ts:757–759`
- `createTrackReadModel`：`WG/views/track-read-model.ts:1162`
- `createTaskStateTimeline`：`WG/views/task-state-timeline.ts:536`

生产构造是 `src/composition/create-platform.ts:1088–1093`；路由调用是 `src/app/core-routes.ts:1135–1138`。直接测试构造入口如下，均不改：

| 工厂 | 测试及夹具构造位置 |
|---|---|
| Activity | `T/helpers/S2B-activity-fixture.ts:550`；`T/helpers/S2B-runtime-store-fixture.ts:81`；`T/app/S2B-backfill-host.test.ts:60`；`T/runtime/S2B-15-end-retry-activity.test.ts:55` |
| Track | `T/helpers/S2B-track-fixture.ts:744`；`T/work-graph/S2B-r2-workspace-binding.test.ts:115` |
| Timeline | `T/helpers/S2B-task-timeline-fixture.ts:690`、`:696`；`T/work-graph/S2B-r2-workspace-binding.test.ts:116` |
| 三者 | `T/app/S2B-35-activity-routes.test.ts:154–157`、`:174–176` |

C2 专属保留清单：

- 每次尝试先新建 Budget，随后 before → window → after；只有两次水位都 ready、window ready 且水位不等才重试。任何非 ready 或异常立即停止；第四次不稳定后返回 unavailable，没有第五次读取。四段分别见上表范围。
- 每个完整尝试恰好额外调用两次 `readMany([])`；before 失败只有一次，window 非 ready 不读 after，after 失败不再尝试。水位读取本身不扣 Budget。`WG/views/activity-read-helpers.ts:125–130`。
- 新 Budget 不能移到循环外。计费依旧是索引返回行数、请求的 keyed record 数；缺失 keyed record 也扣一次。`WG/views/activity-read-helpers.ts:71`、`:102`、`:117–121`。
- 日历 `now()` 在每次成功读取 before 之后求值；其余三段控制外壳不增加时钟调用。对照 `WG/views/activity-read-model.ts:771–773`、`:796–798`、`WG/views/track-read-model.ts:1172–1174`、`WG/views/task-state-timeline.ts:546–548`。
- 返回窗口原结果，不重新包装 ready、不添 cursor/current 字段、不排序结果。当前四处均直接 `return result`，见 `WG/views/activity-read-model.ts:777`、`:802`、`WG/views/track-read-model.ts:1178`、`WG/views/task-state-timeline.ts:552`。

四种错误文字必须分开保留：

| 调用 | capacity 的主语 | 四次耗尽的主语 |
|---|---|---|
| 日历 | `the activity read for window ${window}` | 同左 |
| Run | `the Run activity read` | 同左 |
| Track | `the track read for window ${window}` | 同左 |
| Timeline | `the task timeline read for ${window}` | 同左 |

容量后缀都是 ` exceeds the storage-read cap of ${String(cap)}`；耗尽后缀都是 ` did not yield one stable read window within ${String(...)} attempts`。出处分别为 `WG/views/activity-read-model.ts:779–786`、`:804–811`、`WG/views/track-read-model.ts:1180–1188`、`WG/views/task-state-timeline.ts:554–561`。

另一个实质差异必须保留：Track 在 CapacityError 后有  
`if (error instanceof ForbiddenError) return rejected('forbidden', error.reason)`；  
日历直接进入 `storeFailureToRejection(...)`。两处为 `WG/views/track-read-model.ts:1180–1185`、`WG/views/activity-read-model.ts:779–783`。不能让共用执行器识别并统一处理这两种错误。

现有测试：

- `T/work-graph/S2B-activity-read-faults.test.ts:65`：`2B-27 fails the whole read on an injected index, record or eventAt failure`。
- 同文件 `:101`：`2B-27 retries one moved window and reports unavailable when the window never settles`；`:124`：容量错误包含窗口和 cap。
- `T/work-graph/S2B-r2-27-moving-window.test.ts:75`、`:93`：Track、Timeline **恰好四次**，分别在 `:90`、`:109` 断言八次水位读。
- 同文件 `:112`、`:156`：一次移动后稳定，分别在 `:130`、`:174` 断言四次水位读。
- `T/work-graph/S2B-r2-keyed-cap.test.ts:20`、`:33`；`T/work-graph/S2B-r2-r7-keyed-read-cap.test.ts:25`、`:49`：缺失记录计费。
- `T/work-graph/S2B-33-task-timeline-pagination.test.ts:20`、`:55`：计划顺序及跨页计划变化。
- `T/work-graph/S2B-r2-r4-bound-workspace.test.ts:26`、`:42`：跨 workspace 拒绝。

缺口：日历移动窗口测试只断结果，不锁精确尝试数；未找到 Run 活动列表对应的精确四次断言。这些已有断言也不能完整锁住 before/window/after 每个失败位置的“后续零读取”、每次重建 Budget 和 `now()` 时点。证据边界是 `T/work-graph/S2B-activity-read-faults.test.ts:95–121`，与 Track/Timeline 的计数断言形成对照。

估计 **190 行**。编辑三个外壳文件，新增一个执行器文件，共四个文件；不编辑 `activity-read-helpers.ts`。与 SC、D3、另外三项均无文件交集。建议完整做这一小项，但不推广到其他分页器或稳定读取。

**3．C1：拆掉注记读写之间的运行时依赖**

当前需要搬的只有：

- `ReadFailureCode`、`ReadOutcome<T>`：`WG/notes/note-read-model.ts:98–101`。
- `readAllRecords`：`WG/notes/note-read-model.ts:122–138`。
- `readAllHeads`：`WG/notes/note-read-model.ts:140–152`。
- `renderUnderstandingBody`：`WG/notes/note-service.ts:351–354`。

当前直接环是 reader 导入 writer 的 renderer，writer 导入 reader 的扫描器和错误映射：`WG/notes/note-read-model.ts:58`、`WG/notes/note-service.ts:36`。还必须处理 writer → scribe-scope → reader 这条边，前两段见 `WG/notes/note-service.ts:30–31`、`WG/notes/scribe-scope.ts:37`。

全部直接调用／导入：

| 符号 | 位置 |
|---|---|
| `readAllRecords` | reader 内：`WG/notes/note-read-model.ts:143`、`:690`；scribe：`WG/notes/scribe-scope.ts:280`；组合根：`src/composition/create-platform.ts:73`、`:1701` |
| `readAllHeads` | reader 内：`WG/notes/note-read-model.ts:211`、`:225`、`:681`；writer：`WG/notes/note-service.ts:301`、`:313`；scribe：`WG/notes/scribe-scope.ts:292`；卡源：`WG/notes/note-decision-source.ts:44`、`:144`；待办：`WG/notes/note-scribe-todos.ts:47`、`:86` |
| `ReadFailureCode` | writer 导入及类型使用：`WG/notes/note-service.ts:36`、`:298`、`:312`；scribe：`WG/notes/scribe-scope.ts:37`、`:260`、`:278`、`:312`；reader 自身：`WG/notes/note-read-model.ts:101`、`:112`、`:142`、`:536`、`:713`、`:829`、`:981`、`:1009`、`:1039` |
| `renderUnderstandingBody` | writer：`WG/notes/note-service.ts:393`、`:1482`；reader：`WG/notes/note-read-model.ts:58`、`:2009` |

未找到测试直接调用这三个函数。现有测试直接依赖 reader 工厂的模块位置，尤其三处 spy：`T/work-graph/S4C2-memory-material.test.ts:55`、`T/work-graph/S4C2-project-set-shared.test.ts:95`、`T/work-graph/S4C2-read-counts.test.ts:79`；工厂不搬。

建议新增 `src/core/work-graph/notes/note-base-reader.ts`：

```ts
export type ReadFailureCode =
  | 'invalid' | 'not_found' | 'revision_conflict' | 'unavailable';

export type ReadOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; code: ReadFailureCode; reason: string };

export function readAllRecords(
  records: RecordLookupPort,
  index: string,
  values: readonly (string | null)[],
): Promise<ReadOutcome<EncodedRecord[]>>;

export function readAllHeads(
  records: RecordLookupPort,
  index: string,
  values: readonly (string | null)[],
): Promise<
  | { ok: true; heads: NoteHeadSnapshot[] }
  | { ok: false; code: ReadFailureCode; reason: string }
>;
```

另新增 `src/core/work-graph/notes/note-rendering.ts`：

```ts
export function renderUnderstandingBody(sections: {
  status: string;
  decided: string;
  open: string;
  next: string;
  risks: string;
}): string;
```

reader、writer、scribe、卡源、待办改从底层 reader 导入；writer 和 scribe 的错误映射直接从现成 `store-failures.ts` 导入。**不再搬一次错误映射**：它已经独立，代码及返回协议见 `WG/notes/store-failures.ts:4–20`。

旧出口安排：

- `note-read-model.ts` 重导出 `readAllRecords`、`readAllHeads`、`ReadFailureCode`，继续保留 `mapStoreFailure`、`MappedStoreFailure` 的旧重导出；当前重导出在 `WG/notes/note-read-model.ts:64`。组合根继续走旧出口，避免为两行导入修改整个组合根。
- `note-service.ts` 重导出 `renderUnderstandingBody`，自身也从新纯模块导入。
- 所有其他 reader/writer 工厂和类型原地保留。

C1 专属保留清单：

1. `readAllRecords` 第一页省略 `after`，每页 `limit: 200`；只按 `next === null` 停，不根据页长停。每个返回页面正好一次 lookup，不补 keyed read、不去重、不排序。`WG/notes/note-read-model.ts:129–136`。
2. **必须读完所有页面再解码。** 当前先 `await readAllRecords(...)`，成功后才逐条 decode。不能改为边翻页边解码，否则“第一页坏 head＋后页读取失败”的返回优先级和读取次数都会变。`WG/notes/note-read-model.ts:143–149`。
3. 扫描失败不返回部分集合；解码第一个坏 head 就返回 `{ok:false, code:'unavailable', reason:'damaged note head'}`。`WG/notes/note-read-model.ts:133`、`:144–151`。
4. 错误码只保留 invalid/not_found/revision_conflict，其余映射 unavailable，reason 原样；不要改成返回 CoreRejection，也不新加 catch。`WG/notes/store-failures.ts:9–20`。
5. 两个成功形状不同：记录扫描是 `{ok:true,value}`，head 扫描是 `{ok:true,heads}`。不能为了通用化统一字段名。`WG/notes/note-read-model.ts:135`、`:151`。
6. 五段正文必须逐字符保持：

```text
现状\n${status}\n\n已定\n${decided}\n\n未决\n${open}\n\n下一步\n${next}\n\n风险\n${risks}
```

没有末尾换行，也不 trim 输入。原文为 `WG/notes/note-service.ts:352–354`。reader 的 `sections === undefined ? head.body : renderUnderstandingBody(...)` 分支原样保留，不能顺手删掉。`WG/notes/note-read-model.ts:2009`。

现有测试：

- `T/work-graph/S4A-note-caps.test.ts:63`：`N-07 %s listByAnchor returns every note past 200`。
- 同文件 `:107`：`N-04 %s the same-topic gate sees every note past 200`。
- `T/work-graph/S4A-note-failures.test.ts:36`、`:56`：anchor／goal-state lookup 失败拒绝写入。
- 同文件 `:108`：`N-11 an unreadable head is unavailable, not not_found`。
- `T/work-graph/S4A-note-history.test.ts:424`：`N-19 %s stores the five sections and enforces the strict per-kind union`。
- `T/work-graph/S4C2-read-counts.test.ts:295`、`:365`、`:553`：pointer/head/trigger、review bucket、plan/catalog 读取次数。
- `T/work-graph/S4C2-memory-material.test.ts:97`、`:112`：材料顺序及重复注记去重结果。

缺口：N-19 锁住五段字段及 6,144/6,145 字节边界，并没有直接比较完整存储正文；等长文字变化可能逃过它。`T/work-graph/S4A-note-history.test.ts:435–449`。未找到“前页坏 head、后页读取失败”的组合断言，不能据普通读取失败测试认为解码时序已经受保护；现有失败测试的注入及断言见 `T/work-graph/S4A-note-failures.test.ts:36–68`。

估计 **160 行**。五个现有文件：`note-read-model.ts`、`note-service.ts`、`scribe-scope.ts`、`note-decision-source.ts`、`note-scribe-todos.ts`；两个新文件，共七个。`store-failures.ts`、组合根、测试不编辑。与 SC、D3、另外三项无直接交集；这里搬的是注记存储正文，不是 D3 的模型提示模板。

**4．A6：把替换判定放入 state，只缩窄参数**

当前迁移体是七行规则说明和函数，共约三十行：`WG/tasks/run-activity-service.ts:138–167`；结果类型在 `:76`。

调用链完整如下：

- `decideRunActivityOutcome` 唯一直接调用：`WG/tasks/run-activity-service.ts:188`。
- `planRunActivity` 调用：同文件 `:241–244`、`:383–385`。
- `planRunActivityForCommit` 外部调用：`WG/tasks/execution-entry-service.ts:1921–1927`、`WG/tasks/run-reconcile-service.ts:728–733`。
- 测试未直接导入上述判定函数；通过真实 writer、结束提交和 backfill 验证，见下面测试表。

当前没有已接入的 Query 替换调用；不应在任务书写成“同时修改现有 Run 和 Query owner”。未来公共落点应使用 `state/`：tasks、queries 都允许依赖 state，而 queries 不允许依赖 tasks。`docs/refactor/module-target.json:94–114`。

建议新增 `src/core/work-graph/state/activity-replacement.ts`：

```ts
export type ActivityWriteOutcome =
  | 'created' | 'replaced' | 'unchanged';

export function decideActivityOutcome(
  existing: RunActivityFactsV1 | null,
  incoming: RunActivityFactsV1,
  endCommit: boolean,
): ActivityWriteOutcome;
```

原模块保留：

```ts
export type RunActivityWriteOutcome = ActivityWriteOutcome;

export function decideRunActivityOutcome(
  existing: RunActivitySnapshot | null,
  incoming: RunActivityFactsV1,
  endCommit: boolean,
): RunActivityWriteOutcome;
```

旧函数作为兼容包装，仍由 `planRunActivity` 调用；包装传入 `existing === null ? null : existing.facts`。不要用 `existing?.facts ?? null` 扩大“没有旧记录”的含义。这样既保留旧签名，也不留下一个只为兼容而无人调用的函数；生产可达检查要求每个声明有真实路径，见 `T/architecture/production-reach.test.ts:93–105`。

A6 专属保留清单：

| 顺序 | 原样保留的判断 |
|---|---|
| 1 | 无旧记录 → created |
| 2 | `old.ruleVersion < incoming.ruleVersion` → replaced |
| 3 | old counted 时，非 endCommit 或 incoming 非 counted → unchanged |
| 4 | 只有 incoming terminal、`throughPosition` **严格增加**、且旧窗口非 terminal **或** unresolvedCalls > 0，才 replaced |
| 5 | old unknown、incoming counted → replaced |
| 6 | 两者 unknown，仅比较 reason；相同 unchanged，不同 replaced |

以上顺序及短路表达式来自 `WG/tasks/run-activity-service.ts:156–166`。不能新增版本倒退拒绝、比较 detail、比较 totals，或把旧 counted 的判定提前到规则版本判断之前。

- 新纯函数零读取、零时钟、零写入，不接收完整 snapshot。原判定只取 `facts`，见 `WG/tasks/run-activity-service.ts:157`。
- `planRunActivity` 的 unchanged 路径继续返回旧 snapshot 本身；其他路径的字段顺序、revision、span、facts 引用不动。`WG/tasks/run-activity-service.ts:188–199`。
- 终态提交辅助仍只做原来那一次 `readMany([key])`，unchanged 时 record 为 null；不增删事件。`WG/tasks/run-activity-service.ts:230–246`。
- backfill 的身份、重放、CAS、Session 读取、`now()` 和 unchanged 回执原地保留。即使最终 unchanged，也不能提前跳过当前的 Session 读取或时钟调用。`WG/tasks/run-activity-service.ts:365–388`。
- unchanged 回执里的 `replayed:true`、空 cursor 保持；写入时 event JSON、guards、records/events 数组顺序不动。`WG/tasks/run-activity-service.ts:386–402`。
- endCommit 的来源仍是两个结束提交调用的 true，backfill 的 false，不从 `recordedBy` 重新推导。`WG/tasks/execution-entry-service.ts:1927`、`WG/tasks/run-reconcile-service.ts:733`、`WG/tasks/run-activity-service.ts:385`。

现有重点测试：

| 测试 | 已覆盖 |
|---|---|
| `T/app/S2B-be2-late-evidence-activity.test.ts:65`，2B-14(a) | unknown → counted；自动补算跳过已 counted |
| 同文件 `:112`，2B-14(b) | 人工 backfill 不替换不完整 counted，RUN-21 补全 |
| 同文件 `:160`，2B-14(c) | RUN-22 不改变 tally |
| `T/runtime/S2B-45-inprocess-run21-activity.test.ts:70` | 进程内 RUN-21 补全不完整 counted |
| `T/runtime/S2B-15-end-retry-activity.test.ts:32` | 丢失提交回执后重试，不改变 recordedAt |
| `T/app/S2B-r2-backfill-revision-race.test.ts:48`、`:83` | CAS 竞争与普通 unchanged 重试的区别 |
| `T/app/S2B-backfill-workflow.test.ts:221`，2B-18 | unknown 写入、可重试原因、unknown → counted |
| `T/work-graph/S2B-r2-activity-run-ended-at.test.ts:48` | 替换时保留原 runEndedAt |

缺口：这些生产路径测试不能完整证明规则版本比较优先级、throughPosition 相等边界、unknown 同 reason 但 detail 不同等纯表分支；当前逻辑在 `WG/tasks/run-activity-service.ts:158–166`，上述 2B-18 的实际序列主要是 unknown → counted，见 `T/app/S2B-backfill-workflow.test.ts:228–252`。本轮应逐句搬迁，不补规则，不为未来 Query 发明新类型层级。

估计 **85 行**。只编辑 `WG/tasks/run-activity-service.ts`，新增 `WG/state/activity-replacement.ts`；不编辑两个结束提交 owner、Query、contracts 或 codec。与 SC、D3、另外三项无文件交集。

**5．文件交集、风险和分组建议**

本次四项与 SC 的**直接编辑文件交集为零**。SC 明列的生产文件是：

- `WG/persistence/lookup-all.ts`
- `WG/views/decision-read-model.ts`
- `WG/tasks/plan-readers.ts`
- `WG/tasks/planning-question-reader.ts`
- `WG/tasks/command-rerun-request-service.ts`
- `WG/views/automatic-rework-notices.ts`
- `WG/views/context-extensions.ts`
- `WG/views/undelivered-reply-notices.ts`
- `WG/views/work-line-reader.ts`

依据为 `.lead-ref/sc-book.md:55–81`。尤其不要把 C1 趁机改成使用 `lookup-all.ts`，也不要把 C2 做成通用分页器；这样会引入本来不存在的 SC 冲突和协议迁移。

四项之间也没有编辑文件重叠。D3 与这四项可保持不重叠，条件是采用上面的窄范围：D2 不改工具说明文件，C1 不搬进提示模板，A6 不扩 Query。D3 自身与 SC 的交集需要另外登记，不能把“四项为零”写成“整个结构轮为零”：例如 D3 明确包含提醒短句，而 `context-extensions.ts` 存在提醒文本，SC 也编辑它。出处为提示规格 `:293`、`WG/views/context-extensions.ts:122`、`:132`、`.lead-ref/sc-book.md:70–71`。

建议任务书单列六项风险：

1. **D2 检查协议被统一**：Work 的完整性检查被套给 Query，产生新失败路径。`AR/execution-driver.ts:330–335`、`AR/query-execution.ts:251–254`。
2. **D2 名单／时点变化**：排序、统一快照、提前装配，改变名单顺序或资源失败时点。`AR/observed-model-run.ts:279–337`。
3. **C2 停止规则变化**：对所有失败重试、跨尝试共享 Budget、提前求 now。`WG/views/activity-read-model.ts:768–811`。
4. **C1 扫描与解码交错、正文改字**：改变失败优先级、读取次数或持久化字节。`WG/notes/note-read-model.ts:127–152`、`WG/notes/note-service.ts:352–354`。
5. **A6 提前实现 Query／补规则**：当前只有 Work 调用，而规则表还有现有测试未逐项锁住的边界。`WG/tasks/run-activity-service.ts:151–188`、`.lead-ref/d84-refute-A.out.md:10`。
6. **把 D3 旧估量当成可直接分组的任务书**：冻结规格现在要求搬全部平台工具说明、提醒等文字，范围已明确到 `slice-6-7-PROMPTS-SPEC.md:284–300`；不能只按旧“context assembler＋guide”的估量机械切组。

无需跳过四项本身；应跳过上述扩大范围的做法。尤其不允许通过改测试、改 production-reach allowlist，掩盖新出口无人使用或字节变化。

可直接采用的两个文件责任组：

| 组 | 内容与估量 | 文件归属 | 冻结接口 |
|---|---|---|---|
| G1 | D2，约 800 行 | 三个 Runtime 现有文件＋`tool-group-assembly.ts` | `ToolGroup`、上述装配函数、旧模块重导出；旧 `ObservedModelRunOptions` 不变 |
| G2 | C2＋C1＋A6，约 435 行；**与 B1 合组**后约 785–1,035 行 | 上文 C2 四文件、C1 七文件、A6 两文件；再加 B1 独占文件 | 稳定窗口接口、note 底层读接口、纯 renderer、activity replacement；旧出口兼容表 |

B1 的 350–600 行估计来自 `.lead-ref/d84-condensed.md:14`；其具体白名单须由 B1 盘点确认后并入 G2，不能仅凭估量让它修改 G1 文件。若 B1 不能并组，G2 就保持约 435 行的小组，不为凑 600 行扩大工作；示例任务书也明确不为达到下限填充范围，见 `.lead-ref/c1-book-format-example.md:33`。

顺序为 **SC 合入并冻结 → G1、G2**；G1/G2 互不依赖，可以并行。各组必须完成本组新模块的生产接线，不把未使用的新接口留给另组。后续 D3、PC、6A 只消费冻结接口，不能回头改这两组的文件。

整个六项若要求“每组严格 600–1,200 行、任何两组绝不编辑同一文件”，目前不能给出可信的完整分组：D3 按原抽取范围，仅 `context-assembler.ts` 的渲染和事实读取主体就跨越 `AR/context-assembler.ts:266–958`、`:971–1667`，原文件删除量本身已经超过一组上限。建议给 D3 一个独占原文件的责任组，另按新文件拆内部子任务；把它明确列为组大小例外，而不是让多个名义分组先后编辑同一个 assembler。D3 的完整新白名单和新版总估量应由其专门盘点冻结。

末行的 SC 数量仅统计本次 D2、C2、C1、A6 四项；“风险 6”对应上面的六条。

D2 800 行，C2 190 行，C1 160 行，A6 85 行，和 SC 重叠文件 0 个，风险 6