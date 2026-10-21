建议选 **GoalSettingsChanged、WorkspaceNoticeSeenChanged、WorkspaceLinePinsChanged**，采用“**有序配方＋原校验钩子**”。它能验证“格式描述派生编解码及登记”，又能保留目前复杂的正文检查。首轮审查也明确允许格式说明调用已有正文校验器，并未要求此次生成全部嵌套类型。`.lead-ref/d84-struct-B.out.md:13`

本次只读，未修改文件，未运行测试、构建、git 或网络操作。以下是任务书盘点，不是实现验收。行数是新增＋删除的估计。

为避免长路径淹没内容，下文这些文件名对应：

| 文件名 | 完整路径 |
|---|---|
| `decision-record-codecs.ts` | `src/core/work-graph/persistence/decision-record-codecs.ts` |
| `line-settings-codecs.ts` | `src/core/work-graph/persistence/line-settings-codecs.ts` |
| `event-validation.ts` | `src/core/work-graph/persistence/event-validation.ts` |
| `event-envelope.ts` | `src/core/work-graph/persistence/event-envelope.ts` |
| `record-codecs.ts` | `src/core/work-graph/persistence/record-codecs.ts` |
| `common.ts` | `src/contracts/validation/common.ts` |
| `decision-contracts.ts` | `src/core/work-graph/model/decision-contracts.ts` |

**1．事件选择、现有入口和完整拒绝顺序**

| 事件 | 类型 | 编码／解码 | 正文检查 | 登记 |
|---|---|---|---|---|
| `GoalSettingsChanged@1` | `decision-contracts.ts:426`；值为单个 Goal 或 `{goals: GoalSnapshot[]}` | `decision-record-codecs.ts:56`、`:60` | `goalSettingsChangedEventProblem`，`:354` | 验证包装 `:411`；登记项 `:429` |
| `WorkspaceNoticeSeenChanged@1` | `decision-contracts.ts:431` | `decision-record-codecs.ts:74`、`:80` | `workspaceNoticeSeenChangedEventProblem`，`:363` | 验证包装 `:416`；登记项 `:434` |
| `WorkspaceLinePinsChanged@1` | `line-settings-codecs.ts:33` | `line-settings-codecs.ts:52`、`:56` | `workspaceLinePinsChangedEventProblem`，`:82` | 验证包装 `:94`；登记项 `:106` |

这三个事件适合一起试：其外层流程完全同序，都是“外壳→JSON→内外绑定→正文→返回解析对象”；差异集中在正文。`decision-record-codecs.ts:63`、`:83`；`line-settings-codecs.ts:59`

所有正常返回的解码失败都是 **`{status: 'invalid', reason: 原文字}`**，没有额外 `code`、`issues` 或字段路径。`common.ts:62`；`src/core/record-store/ports.ts:64`

下面列出完整失败树。同一层按列出的顺序检查，首次失败立即返回；进入子检查时，先完成该子检查再继续下一项。`${…}` 是现有动态插值，不是建议改写的文字。

三者共有的前半段：

| 顺序 | 条件及原文 | 出处 |
|---|---|---|
| 1 | 外层类型不符：`expected eventType ${eventType}, got ${event.eventType}` | `event-validation.ts:11` |
| 2 | 外层版本不符：`expected schemaVersion 1, got ${String(event.schemaVersion)}` | `event-validation.ts:12` |
| 3 | 外层事件 ID 非非空字符串：`${eventType} eventId must be a non-empty string` | `event-validation.ts:15` |
| 4 | 外层时间非非空字符串：`${eventType} occurredAt must be a non-empty string` | `event-validation.ts:16` |
| 5a | JSON 解析失败：`${eventType} event is not valid JSON` | `common.ts:50`；三处调用见 `decision-record-codecs.ts:65`、`:85`，`line-settings-codecs.ts:63` |
| 5b | JSON 解析成功但不是非数组对象：`${eventType} event JSON must be an object` | `common.ts:58` |
| 6 | 内外 ID 不同：`${eventType} body eventId disagrees with the encoded event` | `event-validation.ts:30` |
| 7 | 内外类型不同：`${eventType} body eventType disagrees with the encoded event` | `event-validation.ts:31` |
| 8 | 内外版本不同：`${eventType} body schemaVersion disagrees with the encoded event` | `event-validation.ts:32` |
| 9 | 内外时间不同：`${eventType} body occurredAt disagrees with the encoded event` | `event-validation.ts:35` |
| 10 | 顶层有未知字段：`the event body carries unknown fields` | `event-validation.ts:63` |
| 11 | `identityKey`：`the event identityKey must be a non-empty string` | `event-validation.ts:66` |
| 12 | `fingerprint`：`the event fingerprint must be a lowercase sha256 hex` | `event-validation.ts:67` |
| 13 | `projectId`：`the event projectId must be a non-empty string` | `event-validation.ts:68` |
| 14 | `workspaceId`：`the event workspaceId must be a non-empty string` | `event-validation.ts:69` |
| 15 | `requestId`：`the event requestId must be a non-empty string` | `event-validation.ts:70` |
| 16 | 检查 actor，顺序如下 | `event-validation.ts:71` |
| 17 | payload 非对象或有未知字段：`the event payload must carry exactly value and proof` | `event-validation.ts:73` |

actor 的分支顺序：

1. 非对象或 `id` 不是非空字符串：`the event actor must be an ActorRef`。`event-validation.ts:41`
2. `human/system` 分支：多余字段时报 `the event actor carries unknown fields`，否则该子检查结束。`event-validation.ts:42`
3. 其余 kind 不是 `agent`：`the event actor kind must be human, system or agent`。`event-validation.ts:45`
4. agent 多余字段：`the event agent actor carries unknown fields`。`event-validation.ts:46`
5. agent 的 RunRef 形状、类型或必需字符串错误：`the event agent actor runRef must be a complete RunRef`。`event-validation.ts:47`

这里的“非空”只看 `length > 0`，不 trim；fingerprint 只接受 64 位小写十六进制。`common.ts:13`、`:17`

`eventBodyProblem` 还有 `the event body must be an object`，但三条完整解码链已先通过 JSON 对象检查，因此这条只关系到直接调用正文检查器的行为，不能误列为这些 decoder 可达的额外失败。两个公开正文检查器必须继续保留这一直接调用行为。`event-validation.ts:62`；`decision-record-codecs.ts:354`、`:363`

GoalSettingsChanged 在公共检查之后：

- **先 value，再 proof。** value 是对象且仅含允许键 `goals` 时走重排分支：非数组或空数组报 `a GoalSettingsChanged goals value must be a non-empty array`，否则按数组原顺序逐个检查 Goal；其余值走单 Goal 检查。`decision-record-codecs.ts:333`
- **注意 `{}` 也进入重排分支**：`hasOnlyKeys` 只禁止多余字段，不要求键存在。不能把这一分支改成“必须存在 goals 才进入”。`common.ts:29`；`decision-record-codecs.ts:336`
- value 全过之后，proof 为 null 直接通过；否则进入下面的证明检查。`decision-record-codecs.ts:348`、`:357`

单个 Goal 的失败顺序：

| 顺序 | 原文 | 出处 |
|---|---|---|
| 1 | `Goal value must be an object` | `record-codecs.ts:521` |
| 2 | `Goal snapshot has no valid GoalRef` | `record-codecs.ts:321` |
| 3 | `Goal snapshot has no valid workspaceRef` | `record-codecs.ts:323` |
| 4 | `Goal snapshot workspaceRef belongs to another project` | `record-codecs.ts:324` |
| 5 | `Goal snapshot objective must be a string` | `record-codecs.ts:327` |
| 6 | `Goal snapshot desiredState must be "active", "paused" or "cancelled"` | `record-codecs.ts:328` |
| 7 | `Goal snapshot activePlanRevision is not a legal PlanRevisionRef` | `record-codecs.ts:331` |
| 8 | `Goal snapshot revision must be a safe integer >= 1` | `record-codecs.ts:336` |
| 9 | `Goal snapshot desiredStateRevision must be a safe integer between 1 and the Goal revision` | `record-codecs.ts:341` |
| 10 | `Goal snapshot desiredStateRequestedBy must be null or a Host (human/system) actor` | `record-codecs.ts:345` |
| 11 | settings 存在时进入下表 | `record-codecs.ts:355` |
| 12 | `Goal value must carry exactly the Goal snapshot fields` | `record-codecs.ts:524` |

最后一步才检查 Goal 本体及相关 ref、请求 actor 的精确字段集合；不能提前做统一“未知字段拒绝”。`record-codecs.ts:505`

Goal settings 的失败顺序：

| 顺序 | 原文 | 出处 |
|---|---|---|
| 1 | `Goal snapshot settings must carry exactly the GoalSettingsV1 fields` | `record-codecs.ts:388` |
| 2 | `Goal settings schemaVersion must be 1` | `record-codecs.ts:392` |
| 3 | `Goal settings autonomy is not a legal GoalAutonomyV1` | `record-codecs.ts:393` |
| 4 | `Goal settings order must be a safe non-negative integer` | `record-codecs.ts:397` |
| 5 | `Goal settings waitForGoalRef must be null or a GoalRef in this project` | `record-codecs.ts:400` |
| 6 | `Goal settings parallelRisks must be an array` | `record-codecs.ts:407` |
| 7 | 逐项：`Goal settings parallelRisks entry must carry exactly otherGoalRef, selfPlanRef and otherPlanRef` | `record-codecs.ts:369` |
| 8 | 该项：`Goal settings parallelRisks.otherGoalRef must be a GoalRef in this project` | `record-codecs.ts:373` |
| 9 | 该项依次检查 `selfPlanRef`、`otherPlanRef`：`Goal settings parallelRisks.${field} must be null or a PlanRevisionRef in this project` | `record-codecs.ts:377` |

proof 的完整检查树：

| 顺序 | 检查及原文 | 出处 |
|---|---|---|
| 1 | 非对象或未知字段：`a DecisionChangeProofV1 must carry exactly acknowledgementRef, capturedPins, changes and basisRebases` | `decision-record-codecs.ts:296` |
| 2a | acknowledgement 非对象或未知字段：`the acknowledgement ref must be a complete SessionMessageRef` | `decision-record-codecs.ts:100` |
| 2b | acknowledgement 值错误：`the acknowledgement ref is not a valid SessionMessageRef` | `decision-record-codecs.ts:104` |
| 3 | `a DecisionChangeProofV1 capturedPins must be an array` | `decision-record-codecs.ts:301` |
| 4 | 按原数组顺序检查每个 captured pin，使用下述 pin 检查，revision 必须正数 | `decision-record-codecs.ts:303` |
| 5 | `a DecisionChangeProofV1 changes must be an array` | `decision-record-codecs.ts:307` |
| 6 | 每个 change 先查：`a DecisionChangeProofV1 change must carry exactly before and after` | `decision-record-codecs.ts:309` |
| 7 | 同一 change 先 before pin，允许 revision 0；再 after pin，要求正数 | `decision-record-codecs.ts:315` |
| 8 | `a DecisionChangeProofV1 basisRebases must be an array` | `decision-record-codecs.ts:320` |
| 9 | 按原数组顺序检查 rebase，见下表 | `decision-record-codecs.ts:322` |

每个 pin 的顺序：

1. 非对象或未知字段：`a version pin must carry ref and revision`。`decision-record-codecs.ts:227`
2. 先检查 aggregate ref，错误原样返回。`decision-record-codecs.ts:228`
3. 最后检查 revision；before 的错误是 `a version pin revision must be a non-negative safe integer`，其他位置为 `a version pin revision must be a positive safe integer`。`decision-record-codecs.ts:230`

aggregate ref 的全部错误模板和顺序：

| 顺序 | 原文 | 出处 |
|---|---|---|
| 1 | `an aggregate ref must be an object` | `decision-record-codecs.ts:175` |
| 2 | `an aggregate ref must carry a non-empty aggregateType` | `decision-record-codecs.ts:177` |
| 3 | `the aggregate ref type ${aggregateType} is not a known aggregate` | `decision-record-codecs.ts:179` |
| 4 | 依规则表的 strings 顺序：`an aggregate ref ${aggregateType} requires a non-empty ${field}` | 规则表 `decision-record-codecs.ts:116`；遍历 `:180` |
| 5 | 依规则表的 integers 顺序：`an aggregate ref ${aggregateType} requires a positive integer ${field}` | `decision-record-codecs.ts:183` |
| 6 | 依规则表的 objects 顺序：`an aggregate ref ${aggregateType} requires an object ${field}` | `decision-record-codecs.ts:189` |
| 7 | 仅 SessionWorkLink：`an aggregate ref SessionWorkLink requires a known relation` | `decision-record-codecs.ts:205` |
| 8 | 仅 SessionWorkLink：`an aggregate ref SessionWorkLink requires a task, work or module target` | `decision-record-codecs.ts:212` |
| 9 | 仅 SessionWorkLink：`an aggregate ref SessionWorkLink target belongs to another project` | `decision-record-codecs.ts:217` |

这里 `${field}` 严格来自现有 `AGGREGATE_REF_RULES` 的数组顺序，不是 `Object.keys(ref)` 顺序；普通 aggregate ref 没有统一拒绝多余字段的步骤。`decision-record-codecs.ts:116`、`:174`

每个 rebase 的顺序：

| 顺序 | 原文或子检查 | 出处 |
|---|---|---|
| 1 | `a GoalControlRebaseV1 must carry exactly captured, actualBefore and basis` | `decision-record-codecs.ts:280` |
| 2 | captured pin，正 revision | `decision-record-codecs.ts:283` |
| 3 | actualBefore pin，正 revision | `decision-record-codecs.ts:285` |
| 4 | `a GoalDecisionBasisV1 must carry exactly goalRef, workspaceRef, objective, activePlanRef and settings` | `decision-record-codecs.ts:263` |
| 5a | `a decision basis goalRef must be a GoalRef` | `decision-record-codecs.ts:239` |
| 5b | `a decision basis goalRef is not a valid GoalRef` | `decision-record-codecs.ts:242` |
| 6a | `a decision basis workspaceRef must be a WorkspaceRef` | `decision-record-codecs.ts:247` |
| 6b | `a decision basis workspaceRef is not a valid WorkspaceRef` | `decision-record-codecs.ts:250` |
| 7 | `a GoalDecisionBasisV1 objective must be a string` | `decision-record-codecs.ts:270` |
| 8a | activePlanRef 非 null 时：`a decision basis activePlanRef must be a PlanRevisionRef` | `decision-record-codecs.ts:254`、`:271` |
| 8b | `a decision basis activePlanRef is not a valid PlanRevisionRef` | `decision-record-codecs.ts:258` |
| 9 | 运行上面的完整 Goal settings 检查，但错误加前缀：`a GoalDecisionBasisV1 settings: ${settings}` | `decision-record-codecs.ts:275` |

两个 Workspace 事件在公共检查之后：

- notice 先检查 proof：`a WorkspaceNoticeSeenChanged proof must be null`；再检查 Workspace。`decision-record-codecs.ts:367`
- pins 先检查 proof：`a WorkspaceLinePinsChanged proof must be null`；再检查 Workspace。`line-settings-codecs.ts:86`

共享 Workspace 的完整失败顺序：

| 顺序 | 原文或子检查 | 出处 |
|---|---|---|
| 1 | `Workspace value must be an object` | `record-codecs.ts:534` |
| 2 | `Workspace value must carry exactly its ref, revision and the optional decisionSettings/lineSettings` | `record-codecs.ts:535` |
| 3 | `Workspace value has no valid WorkspaceRef` | `record-codecs.ts:543` |
| 4 | `Workspace value revision must be a safe non-negative integer` | `record-codecs.ts:545` |
| 5 | 若有自有属性 decisionSettings，进入其检查 | `record-codecs.ts:546` |
| 6 | 若有自有属性 lineSettings，进入其检查 | `record-codecs.ts:550` |

decisionSettings 子检查：

1. `Workspace decisionSettings must carry exactly schemaVersion and noticeSeen`。`record-codecs.ts:255`
2. `Workspace decisionSettings schemaVersion must be 1`。`record-codecs.ts:259`
3. `Workspace decisionSettings noticeSeen must be an object`。`record-codecs.ts:261`
4. 按 `Object.keys(noticeSeen)` 原顺序，每项先检查类别：`Workspace decisionSettings noticeSeen carries an unknown notice category`。允许类别是 `member_notice / second_expiry / handoff / note_review / undelivered_reply / automatic_rework / continuation`。`record-codecs.ts:228`、`:262`
5. 再检查该项 position：非对象报 `Workspace decisionSettings notice position must be an object`。`record-codecs.ts:238`
6. kind 不是 commit：`a notice position kind must be "commit"`。`record-codecs.ts:240`、`:250`
7. commit 分支依次为：
   - `a commit notice position must carry exactly kind, cursor and itemKey`。`record-codecs.ts:241`
   - `a commit notice position cursor must be a CommitCursor`，条件为字符串且匹配 `^c\d{10}$`。`record-codecs.ts:244`
   - `a notice position itemKey must be a non-empty string`。`record-codecs.ts:248`

lineSettings 子检查：

1. `Workspace lineSettings must carry exactly schemaVersion and pinned`。`record-codecs.ts:279`
2. `Workspace lineSettings schemaVersion must be 1`。`record-codecs.ts:283`
3. `Workspace lineSettings pinned must be an array`。`record-codecs.ts:285`
4. `Workspace lineSettings pinned must hold at most 100 items`。`record-codecs.ts:286`
5. 按 pinned 原数组顺序，每项依次：
   - `a pinned line must carry exactly sessionRef and pinnedAt`。`record-codecs.ts:289`
   - `a pinned line sessionRef must be a complete SessionRef`：先检查精确键，再检查两个非空字符串；两处文字相同。`record-codecs.ts:294`、`:298`
   - `a pinned line pinnedAt must be a non-empty string`。`record-codecs.ts:301`
   - `Workspace lineSettings pins a Session more than once`：在该项 pinnedAt 合法之后，以 canonical SessionRef 判断重复。`record-codecs.ts:302`

**2．两种具体方案**

以下代码是描述形状示意，不是现有代码或已验证补丁。

**方案一：有序字段表解释器。**

以置顶事件为例：

```ts
const linePins = eventFormat<WorkspaceLinePinsChangedEventV1>({
  eventType: WORKSPACE_LINE_PINS_CHANGED_EVENT,
  schemaVersion: 1,
  jsonLabel: 'WorkspaceLinePinsChanged event',

  body: orderedObject({
    keys: [...EVENT_ENVELOPE_KEYS, ...EVENT_BODY_KEYS],
    keyMode: 'only-known',
    unknownReason: 'the event body carries unknown fields',

    steps: [
      field('identityKey', nonEmpty,
        'the event identityKey must be a non-empty string'),
      field('fingerprint', isSha256Hex,
        'the event fingerprint must be a lowercase sha256 hex'),
      field('projectId', nonEmpty,
        'the event projectId must be a non-empty string'),
      field('workspaceId', nonEmpty,
        'the event workspaceId must be a non-empty string'),
      field('requestId', nonEmpty,
        'the event requestId must be a non-empty string'),
      hook('actor', actorProblem),
      objectField('payload', {
        keys: ['value', 'proof'],
        keyMode: 'only-known',
        shapeReason: 'the event payload must carry exactly value and proof',
        steps: [
          field('proof', isNull,
            'a WorkspaceLinePinsChanged proof must be null'),
          hook('value', workspaceSnapshotValueProblem),
        ],
      }),
    ],
  }),
});
```

- **拒绝顺序**：外层四阶段固定；正文只按 `steps` 执行，不从字段声明顺序自动推导。必须区分“仅禁止未知字段”和“要求精确字段集合”，还必须支持先检查 value 再 proof 的 Goal 分支。现有差异见 `event-validation.ts:57`、`common.ts:29`、`record-codecs.ts:488`、`decision-record-codecs.ts:357`。
- **编码**：描述只负责验证，编码仍直接调用 `encodeEventEnvelope(event)`，不按表重建对象、不排序、不补默认字段、不剥离未知字段，也不先验证。当前编码是直接 `JSON.stringify(event)`。`event-envelope.ts:4`
- **类型**：保留三个现有公开类型和函数签名；字段表用映射类型约束字段名、字段类型以及必填／可选性。不能把“验证后更窄的类型”替换现有公开类型，尤其 notice 的 proof。`decision-contracts.ts:418`、`:431`；`line-settings-codecs.ts:33`
- **代价估计**：新增约 330–460 行，删除约 150–200 行，合计 **480–660 行**。其中包括解释器、描述、公开包装和共用正文规则迁移；不重写 Goal、Workspace、proof 的深层检查。
- **以后新增同族事件**：约 25–50 行描述和出口；新嵌套值的校验另计。出现新的检查时序或跨字段规则时，需要扩展描述语言，不能凭“字段类型一样”自动套用。

优点是字段与检查关系可见；缺点是这次就要重新表达当前公共正文规则，而现有测试没有逐条锁住它们的错误文字。

**方案二：有序配方＋原校验钩子，推荐。**

每个事件只定义一次名称、版本、JSON 标签和正文检查入口；固定四阶段由一个小工厂实现。例如：

```ts
const linePinsFormat = {
  eventType: WORKSPACE_LINE_PINS_CHANGED_EVENT,
  schemaVersion: 1,
  jsonLabel: 'WorkspaceLinePinsChanged event',
  bodyProblem: workspaceLinePinsChangedEventProblem,
} satisfies EventFormat<WorkspaceLinePinsChangedEventV1>;

const linePinsCodec = createEventCodec(linePinsFormat);

// 原模块继续保留同名函数及原签名。
export function encodeWorkspaceLinePinsChangedEvent(
  event: WorkspaceLinePinsChangedEventV1,
): EncodedDomainEvent {
  return linePinsCodec.encode(event);
}

export function decodeWorkspaceLinePinsChangedEvent(
  event: EncodedDomainEvent,
): DecodeResult<WorkspaceLinePinsChangedEventV1> {
  const result = linePinsCodec.decodeBody(event);
  return result.status === 'invalid' ? result : {
    status: 'decoded',
    value: result.value as unknown as WorkspaceLinePinsChangedEventV1,
  };
}

export const LINE_SETTINGS_RECORD_SCHEMAS: RecordBackendSchemas = {
  records: [],
  events: [linePinsCodec.registration],
  lookups: [],
};
```

另两个描述分别绑定现有 `goalSettingsChangedEventProblem`、`workspaceNoticeSeenChangedEventProblem`，顺序仍是 Goal、notice。`decision-record-codecs.ts:354`、`:363`、`:428`

- **拒绝顺序**：工厂逐句保留“`eventEnvelopeProblem`→`parseTaggedObject`→`eventBodyEnvelopeProblem`→`bodyProblem`”。正文函数及其嵌套检查原样留在现处，避免第二份规则。当前三条链见 `decision-record-codecs.ts:60`、`:80`，`line-settings-codecs.ts:56`。
- **编码字节**：工厂的 encode 只转交原 `encodeEventEnvelope`。JSON 的键顺序来自调用方传入对象；数组顺序、缺字段、显式 null 和 `JSON.stringify` 原有处理均保留。登记的 validate 成功时返回原来的外层 `event`，不能返回重新编码对象。`event-envelope.ts:7`；`decision-record-codecs.ts:411`；`line-settings-codecs.ts:94`
- **类型精度**：旧类型、旧函数声明、旧返回类型全部保留；工厂内部返回 `UnknownRecord`，原具名 decoder 内完成现有类型断言。notice 的公开 proof 仍为 `DecisionChangeProofV1 | null`，尽管其 decoder 仍只接受 null。`decision-contracts.ts:418`、`:431`；`decision-record-codecs.ts:367`
- **不扩大承诺**：这是“描述派生流水线及登记”的试点；类型声明和复杂正文校验仍是已有契约。不能把它写成“全部格式、类型、深层校验已由一份字段表生成”。这个边界符合原审查允许校验钩子的范围。`.lead-ref/d84-struct-B.out.md:13`
- **代价估计**：新增约 170–240 行，删除约 90–140 行，合计 **260–380 行**。现有公共 envelope、body、parser 已有独立实现，因此无需为凑原预算再搬一遍。`event-validation.ts:6`、`:57`；`common.ts:50`
- **以后新增同族事件**：已有正文检查器时，约 20–35 行描述、旧式公开出口及登记接线；新类型和新正文规则另计。不同阶段顺序的记录不计入这个成本。

推荐方案二，因为它把重复接线变成一次实现，而把目前最难证明等价的深层校验留在原处。RunActivity 的顺序实际是先解析再验外壳，必须继续留在试点之外。`src/core/work-graph/persistence/run-activity-codecs.ts:403`

**3．现有测试、文字覆盖缺口、需要保留的导入**

没有找到直接逐项断言这三个 decoder 的 `reason` 原文的测试。现有证据主要如下；其中业务拒绝不能替代 codec 拒绝文字的覆盖。

| 文件、测试名 | 实际锁住什么 |
|---|---|
| `tests/work-graph/S5-goal-settings.test.ts:393` — `SS01 B every_step commits B@8 with one GoalSettingsChanged event and keeps Run RA` | 单次事件、解码成功、payload.value 与写入返回值相同；具体解码和比较在 `:122`、`:132` |
| 同文件 `:407` — `SS02 same set identity replays the complete B@8 and cursor after B is cancelled` | 后续状态变化后，原值和 cursor 回放 |
| 同文件 `:430` — `SS04 order B,A,C commits B0/A1/C2 once and retains the accepted risk on B` | 重排分支、Goal 列表顺序和风险保留 |
| 同文件 `:558` — `SS11 paused B@7 conflict answer applies after resume with captured7/actual8` | rebase 路径；证明完整比较在 `:375` |
| `tests/work-graph/S5-decision-application.test.ts:189` — `AP03 a real settings receipt records exact before/after pins and removes one pending application` | 合法证明、before/after 和应用链 |
| 同文件 `:365` — `AP12 a corrupt formal receipt event is unavailable and leaves application null with zero writes` | 将 JSON 换成 `{` 后，上层返回 unavailable；`:377` **不检查 reason** |
| `tests/work-graph/S2C-pins.test.ts:134` — `2C-07 a no-change request is accepted, keeps version and pinnedAt, and replays` | pins 事件正常回放、值与时间保留 |
| 同文件 `:206` — `2C-19 a replay returns the original receipt across later writes` | 名字虽写 pin，实际最后回放的是 notice mark；两个 Workspace 事件交错写入后仍取原快照，见 `:226` |
| 同文件 `:235`、`:249` — `2C-19 a pin first and a notice mark after keep each field`、`2C-19 a notice mark first and a pin after keep decisionSettings` | 两种可选设置字段互不丢失 |
| `tests/work-graph/S5-notices.test.ts:240` — `NR06: two saved category positions survive reopen without changing stored message facts` | notice 设置和重开后读取；不是逐条 decoder 错误测试 |
| `tests/business/S5R2-settings-replay.test.ts:85`、`:130` — R2C01、R2C03 | 后续 pause/resume 或其他 Goal 设置变化之后，原收据回放 |

这些测试仍可能看不见的差异：

- **错误优先级和精确文字**：AP12 只检查上层码；它不能区分“坏外壳＋坏 JSON”先报哪一个，也不能发现文字变化。`tests/work-graph/S5-decision-application.test.ts:372`、`:377`
- **编码键顺序和 JSON 字节**：现有直接 Goal 检查比较的是解码对象的 `payload.value`，不是固定 JSON 字符串。`tests/work-graph/S5-goal-settings.test.ts:126`、`:138`
- **缺键、null、多余字段、多个错误同时出现、数组中首次错误位置**：合法回放覆盖不到完整失败树；相关分支实际存在于 `event-validation.ts:63`、`decision-record-codecs.ts:295`、`record-codecs.ts:533`。
- **registration.validate 返回对象身份**：现实现返回原 event，不能因普通深相等断言仍通过就换成复制对象。`decision-record-codecs.ts:413`、`:418`；`line-settings-codecs.ts:96`

有现存测试导入必须保留：

- `decodeGoalSettingsChangedEvent`：`tests/work-graph/S5-goal-settings.test.ts:31`、`tests/work-graph/S5-decision-application.test.ts:10`、`tests/helpers/S5R2-c-support.ts:22`。
- `DECISION_RECORD_SCHEMAS`：例如 `tests/helpers/S5-decision-fixture.ts:88`、`tests/helpers/S2C-P-pins-fixture.ts:33`、`tests/record-store/SP-lookup-index-migration.test.ts:20`。
- `LINE_SETTINGS_RECORD_SCHEMAS`：例如 `tests/helpers/S2C-P-pins-fixture.ts:32`、`tests/helpers/S2C-L-line-support.ts:33`、`tests/record-store/SP-lookup-index-migration.test.ts:21`。
- 非试点的 `decodeNoticeOrigin` 也有测试直接导入，必须原样保留。`tests/work-graph/S5-notices.test.ts:22`

此外，状态写入检查按**文件＋函数名**列出了这三个 decoder。保留原具名函数及类型断言位置，比直接把导出替换成工厂成员更稳妥；本轮不得通过修改此测试来放行。`tests/architecture/state-writes.test.ts:177`

**4．文件范围与交叉**

推荐方案的最小写入范围：

| 文件 | 拟改内容 |
|---|---|
| 新增 `src/core/work-graph/persistence/event-codec-factory.ts` | 格式描述类型、固定四阶段执行、原样编码、登记验证包装 |
| `src/core/work-graph/persistence/decision-record-codecs.ts` | 两份描述，替换两条重复流水线及登记包装；保留原出口。现有位置 `:56`、`:80`、`:411` |
| `src/core/work-graph/persistence/line-settings-codecs.ts` | 一份描述，替换重复流水线及登记包装；保留原类型和出口。现有位置 `:33`、`:52`、`:94` |

`event-validation.ts`、`event-envelope.ts`、`record-codecs.ts`、`common.ts`、`decision-contracts.ts` 作为原样依赖，不需修改。组合根继续消费两个原 schema bundle，顺序维持原处，无需改 `src/composition/create-platform.ts:648`。

**B1 与 SC 同改文件：无。** SC 的九个生产接缝文件为：

- `src/core/work-graph/persistence/lookup-all.ts`；
- `src/core/work-graph/views/decision-read-model.ts`；
- `src/core/work-graph/tasks/plan-readers.ts`；
- `src/core/work-graph/tasks/planning-question-reader.ts`；
- `src/core/work-graph/tasks/command-rerun-request-service.ts`；
- `src/core/work-graph/views/automatic-rework-notices.ts`；
- `src/core/work-graph/views/context-extensions.ts`；
- `src/core/work-graph/views/undelivered-reply-notices.ts`；
- `src/core/work-graph/views/work-line-reader.ts`。

这些范围逐项来自 `.lead-ref/sc-book.md:56`、`:57`、`:59`、`:66`、`:67`、`:69`、`:70`、`:72`、`:74`。SC 的配置、脚本和测试改动也不在上述 B1 写入范围内。`.lead-ref/sc-book.md:34`、`:86`

有依赖交叉，但不应变成同文件施工：SC 的 decision、automatic-rework、work-line 三个 reader 导入 `decodeNoticeOrigin`，该函数与试点事件同处一个文件；B1 保持它及转出口不动。`src/core/work-graph/views/decision-read-model.ts:60`、`src/core/work-graph/views/automatic-rework-notices.ts:38`、`src/core/work-graph/views/work-line-reader.ts:54`；`decision-record-codecs.ts:381`

| 同轮项 | 当前定位 | 与推荐 B1 的同改文件 |
|---|---|---|
| D3 | `src/core/agent-runtime/context-assembler.ts:266`、`:971`、`:1253`；guide 在 `src/core/agent-runtime/query-preparation.ts:50` | 无 |
| D2 | `src/core/agent-runtime/execution-driver.ts:206`；**Runtime** 的 `src/core/agent-runtime/query-execution.ts:213`；`src/core/agent-runtime/observed-model-run.ts:288` | 无；不要误认成 WorkGraph 的同名 query-execution |
| C2 | `src/core/work-graph/views/activity-read-model.ts:768`、`:793`；`track-read-model.ts:1169`；`task-state-timeline.ts:543` | 无；三者均依赖原 `decodeNoticeOrigin` 出口，见各文件 `:31`、`:40`、`:28` |
| C1 | `src/core/work-graph/notes/note-read-model.ts:58`；`src/core/work-graph/notes/note-service.ts:36` | 无 |
| A6 | `src/core/work-graph/tasks/run-activity-service.ts:151` | 无 |

按上述六项限定范围，也未见必须与 SC 同改的生产文件；不能为了统一 reader、迁移调用方或整理组合根扩大交叉面。六项范围依据 `.lead-ref/d84-condensed.md:13`、`:15`、`:16`、`:18`、`:19`。

**5．六项风险与不能偷偷改变的部分**

1. **失败时序变了。** 公共字段声明中的 actor 在 requestId 前，但实际检查 requestId 在 actor 前；Goal 与两个 Workspace 事件的 value/proof 顺序也相反。不能用声明顺序自动生成检查顺序。`decision-contracts.ts:421`；`event-validation.ts:70`；`decision-record-codecs.ts:357`、`:367`

2. **“exactly”被误实现为统一严格模式。** `hasOnlyKeys` 不要求字段存在；WorkspaceRef 的读取也没有统一禁止额外键。将这些统一成严格 schema 会改变接受集合或首次错误。`common.ts:29`；`record-codecs.ts:126`、`:543`

3. **重建对象改变字节或字段存在性。** 不能按描述字段顺序重新组装、默认填 settings、把缺失 proof 改成 null、排序数组或 canonicalize 整个事件。当前编码直接 stringify 原对象，解码直接返回 parsed。`event-envelope.ts:12`；`decision-record-codecs.ts:71`、`:91`；`line-settings-codecs.ts:69`

4. **类型“修正”改变既有签名。** notice 的公开类型允许非空证明，decoder 却只接受 null；这次必须保留。仅从运行时 schema 推断更窄类型，会违反旧签名不变。`decision-contracts.ts:418`、`:431`；`decision-record-codecs.ts:367`

5. **迁移后破坏架构检查或生产可达性。** 原 decoder 的文件和名字已经列入状态写入检查；新工厂、描述及辅助必须由真实生产链使用，不能添加 allowlist 或假调用。`tests/architecture/state-writes.test.ts:181`；`tests/architecture/production-reach.test.ts:93`、`:104`

6. **三事件成功被误当成通用记录生成器已成立。** RunActivity 的解析顺序不同；新增记录还可能需要不同 ref、revision 和失败协议。不得在本轮扩到它，也不得加入统一异常捕获或新的 schema 配置错误路径。`src/core/work-graph/persistence/run-activity-codecs.ts:403`；当前捕获仅位于 JSON 解析处，`common.ts:52`

推荐方案没有发现必须修改测试才能保持行为的事项：它可以不增加存储调用、不改变 owner 的调用点，也不新增状态迁移。当前三条 decoder 只调用纯检查，owner 仍经原 decoder 做回放。`decision-record-codecs.ts:60`、`:80`；`line-settings-codecs.ts:56`；`src/core/work-graph/configuration/decision-settings-service.ts:106`、`src/core/work-graph/configuration/line-settings-service.ts:130`

但“不改测试”意味着**不能获得现有测试并未提供的完整错误文字证明**。任务书应要求按上面的失败树逐项静态对照；不能以正常回放通过代替该核对，也不能为生成器的偏差修改断言。若要求“从验证规则直接推导并收窄所有公开类型”，则与当前 notice 类型兼容要求冲突；应调整生成方案，不能靠测试修改解决。`tests/work-graph/S5-decision-application.test.ts:377`；`decision-contracts.ts:431`

选的事件 3 个，方案 2 种，推荐 有序配方＋原校验钩子，估计行数 260–380，风险 6