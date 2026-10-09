# 第 0、1、3、5 片：冻结的规格和任务书

2026-10-08，lead 冻结。按 [DESIGN §8.2](../DESIGN.md#82-分片表) 分片施工，先做第 0、1、3、5 片，实现都交给本地 DSH（HANDOFF 决定 36、43）。lead 写定规格行、接口和规则；DSH 按两段做：先写骨架和测试、停下，lead 审过冻结以后再实现（AGENTS.md 第 5 条，[DSH-WORKFLOW](../../../DSH-WORKFLOW.md) §1、§6）。代码基线 9b94fc55（可靠性批次做完；src 与 676a7a7b 相同，全量测试 215 个文件、5234 项全部通过）。

## 这里有什么

| 片 | 规格 | 任务书 | 要用户定（OPEN） |
| --- | --- | --- | --- |
| 0 | [slice-0-SPEC.md](slice-0-SPEC.md) | [第一段](slice-0-book-part1.md)、[第二段](slice-0-book-part2.md) | 无 |
| 1 | [slice-1-SPEC.md](slice-1-SPEC.md) | [第一段](slice-1-book-part1.md)、[第二段](slice-1-book-part2.md) | 无（U1 已由决定 45 定为甲） |
| 3 | [slice-3-SPEC.md](slice-3-SPEC.md) | [第一段](slice-3-book-part1.md)、[第二段](slice-3-book-part2.md) | 无 |
| 5 | [slice-5-SPEC.md](slice-5-SPEC.md) | [第一段](slice-5-book-part1.md)、[第二段](slice-5-book-part2.md) | 无 |
| 接线包 1（2026-10-09 补） | [wiring-1-SPEC.md](wiring-1-SPEC.md) | 发给 DSH 的说明书在[证据](../../../reviews/evidence/orchestration-wiring-1-2026-10-09/README.md)的 `books/` | 无（L13 由决定 48 确认） |

第 1、3、5 片的规格由 Codex（推理强度 xhigh）按 585f1ac0 起草，lead 核对设计和代码后冻结：每份规格的 §0 是 lead 的冻结说明（OPEN、lead 定的技术选择、对草稿的改动、和别的片的接缝、抽查的代码出处、精确数量），正文里改过的地方标【lead 改】、技术选择标【lead 定】。§0 与正文不一致时以 §0 为准。

**2026-10-08 已定：** 用户选甲（等人认定，HANDOFF 决定 45），和下面的冻结做法一致，规格和代码都不用改。原 OPEN 条目留作出处：

**OPEN（要用户定，只有一条）：** 第 1 片 U1，退役、没有接续的线手上的执行结果未知时，自动归档是等人“认定”（lead 建议），还是平台自动认定。两条已定的话（决定 38“马上归档”、决定 42“自动归档只走不需要人选的路”）在这一支上冲突。规格把这一支冻结为“不新增行为”（跳过，记在维护结果里），其余部分可以先施工；详见 [slice-1-SPEC §0.1](slice-1-SPEC.md#01-open要用户定施工到这一支之前停下问)。

## 顺序

1. **第 0 片**：在本分支的基线上做，DSH 两段完成（决定 43）：先写 3 个用例、看它们按预期失败后停下，lead 审过、冻结测试，再改那一行；检查通过、lead 审过后提交。它很小（改 1 行、加 3 个用例），但第 3 片要在它之上改同一个文件。
2. **B0（lead 做，一次提交）**：第 3、5 片都要在新的 `views` 子模块里建文件，第 5 片还要 `configuration → state`。这两处写进 `docs/refactor/module-target.json` 由 lead 一次做完，免得两片各写一份再合并冲突：
   - `configuration.dependencies` 改为 `["model", "state", "persistence"]`；
   - 在 `communication` 之后加子模块 `{"id": "views", "path": "views/", "dependencies": ["model", "state", "persistence", "configuration", "materials", "architecture", "sessions", "queries", "tasks", "evidence", "communication"], "note": "读模型（L7，DESIGN §7.2）：只读，不写记录。编排第 3 片（上下文与图读取）和第 5 片（决定队列、冲突提示、请知悉）在这里建文件。"}`，缩进照文件现有的两格；
   - WorkGraph 的 note 里“notes（L5.5）、views（L7）还没有文件，第一个文件落地时再声明”改为“notes（L5.5）还没有文件，第一个文件落地时再声明；views（L7）在编排第 3、5 片之前声明（design/orchestration-2026-10/slices/README.md 的 B0）”；
   - 建 `src/core/work-graph/views/README.md`（三行：这是读模型子模块、只读、第 3、5 片在这里建文件）。检查器要求声明的子模块目录存在（`scripts/check-boundaries.mjs:183`），没有源文件是允许的；非源文件不参与检查（同目录先例 `src/core/agent-runtime/README.md`）。
   - B0 之后跑一次 `npm run typecheck`、`npm run check:architecture`、`npx vitest run tests/architecture`，应当全过，数字和 B0 之前相同。
3. **第 1、3、5 片**：从 B0 之后的同一个提交各建一个副本（DSH-WORKFLOW §1 的做法：`git archive` + `node_modules` + `vendor/coding-agent/node_modules` 里的 zod 和 openai + `git init` 基线提交）。三片的 DSH 可以接连跑，也可以 2–3 个同时跑（决定 36）；但检查（测试）一次只跑一个，机器空闲时跑（DSH-WORKFLOW §1）。
4. **合入顺序 1 → 3 → 5。** 每片验收后，lead 把它在副本里的改动（相对副本基线提交的 diff）应用到本分支：第 1 片直接应用；第 3、5 片用三方合并（`git apply -3`），冲突由 lead 合并，两边新增的类型、字段、路由、注册项都保留。第 1 片先合，因为它改的是 Session、消息、接续说明这些底层记录，第 3、5 片在上面加接缝；第 5 片最后合，因为它和第 1 片同改的文件最多。

## 三片在哪些文件上碰头

三片都新建同一个共用文件 `src/contracts/platform-duty.ts`，内容逐字节相同（见下面“共用文件”），合并时不冲突。三片都改的：`src/app/core-http-types.ts`、`src/app/core-routes.ts`、`src/composition/create-platform.ts`、`src/core/work-graph/tasks/execution-entry-service.ts`。

| 两片 | 同改的文件 |
| --- | --- |
| 1 和 3 | 上面四个，加 `src/core/agent-runtime/` 下的 `execution-preparation.ts`、`ports.ts`、`runtime.ts`，`src/core/work-graph/queries/query-execution.ts` |
| 1 和 5 | 上面四个，加 `src/app/collaboration-driver.ts`；`src/business/workflow/` 下的 `consultation.ts`、`contracts.ts`、`ports.ts`、`workflow.ts`；`src/contracts/ledger.ts`；`src/core/agent-runtime/execution-inputs.ts`；`src/core/work-graph/` 下的 `communication/mailbox-service.ts`、`model/communication-contracts.ts`、`queries/query-record-codecs.ts`、`sessions/message-record-codecs.ts`、`state/message-machine.ts`、`tasks/claim-record-codecs.ts`、`tasks/claim-service.ts`、`tasks/plan-readers.ts`、`tasks/requeue-service.ts`；`tests/architecture/state-writes.test.ts` |
| 3 和 5 | 上面四个，加 `src/core/agent-runtime/execution-contracts.ts`、`execution-driver.ts`，`tests/architecture/production-reach-allowlist.json` |

合并时要看的语义交叉（不只是文本冲突）：
- 消息记录：第 1 片加 `replyHandler`、`archiveWaitDisposition` 和 `replyHandler` 索引；第 5 片加收信方“你”、`goalRef`、`decision`、`application`、新答复形状、3 个消息索引和创建位置 `since`。两边的 codec、状态机构造、类型等价测试、`state-writes` 的保护字段都要合成一份。
- 重新入队：第 1 片在 `TaskRequeueSnapshotV1` 加 `archiveOrigin` 和归档中断的豁免；第 5 片加自治检查和通知的创建位置 `since`。豁免和自治检查的先后照两份规格各自的检查顺序，合并后跑两片的 requeue 用例。
- 路由：第 1 片 11 个、第 3 片 2 个、第 5 片 12 个新 suffix，都加进 `core-http-types.ts` 的 `CoreRouteSuffix` 和 `core-routes.ts` 的表与分派。

## 合入以后的接线（lead 写一页任务书，交 DSH，照两段做）

这几处依赖两片都已合入，在各片里只留了如实的接缝（读作 `not_implemented` 或用过渡映射），不预先接：
- **I-1**（第 3 片合入后）：第 1 片的 `SessionDutyResolver` 改为读第 3 片的职责（`effectivePlatformDuty`）；读不到时仍是 `'unknown'`。
- **I-2**（第 5 片合入后）：第 5 片 `configuration/message-duties-adapter.ts` 的过渡映射改为读第 3 片的职责。
- **I-3**（第 3 片合入后）：第 3 片装配器的 `extensions.anomalies` 接第 1 片的 `listSessionAnomalies`（按目标、未被接手的锚点），提醒段用 `anomaly:<refkey>` 作行键。
- **I-4**（第 5 片合入后）：第 3 片装配器的 `extensions.goalSettings` 接第 5 片的 `readGoalSettings`（自治级别）。两片的取值相同（`'every_step' | 'after_plan_confirmation'`），原样转交。
- **I-5**（第 5 片合入后）：第 5 片“请知悉”的 `undelivered_reply` 类别接第 1 片的 `readUndeliveredReplies`（退役线上迟到、没送到的回复；DESIGN §1.4、§4.5，AMB-43），按 `messageRef + responseRef` 去重（第 1 片 §2.5）。接上之前，这一类如实读作 `not_available`。
- **I-6**（第 5 片合入后）：第 3 片装配器的 `extensions.decisions` 接第 5 片的决定队列（这个目标、这个任务上还没答的卡；DESIGN §5.1 第 6 段“关于这个任务的待决事项”）。行的写法在接线任务书里由 lead 写定。

## 共用文件 `src/contracts/platform-duty.ts`

第 1、3、5 片各自新建，内容必须逐字节等于下面六行（只有 ASCII，LF 换行，末尾一个换行，318 字节，sha256 `6adfb57e8bcb7ec387257e19c3811abb61a5fd21d37a8889566bf34cc32a9e39`）：

```ts
/**
 * The five platform duties (orchestration design, section 4.10; decision 37).
 * A Session's duty comes from its role configuration and is fixed when the
 * Session is created; it never changes while the Session runs.
 */
export type PlatformDutyV1 = 'executor' | 'secretary' | 'adviser' | 'scribe' | 'reviewer';
```

## 每片多大

| 片 | 文件（新建 / 修改） | 用例（运行次数） | 新测试文件 | 状态行 | 新路由 | 估计行数：生产 / 测试 |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | 2（1 / 1） | 3（3） | 1 | 0 | 0 | 1 / 60–90 |
| 1 | 87（38 / 49） | 151（212） | 23 | 19 | 11 | 2,600–4,100 / 2,100–3,200 |
| 3 | 42（21 / 21） | 116（168） | 11 | 3 行补充守卫 | 2 | 1,600–2,400 / 1,400–1,900 |
| 5 | 82（41 / 41） | 153（224） | 16（另 2 个支持文件） | 23 | 12 | 4,700–6,700 / 1,800–2,600 |

行数是估计，不是验收数字；文件数和用例数是冻结的精确数（各规格 §0.6）。第 1、3、5 片比分级测试做过的任何一级都大（L6 是 94 行的 owner 写入，任务 D 是 158 个文件的机械改动）。所以这几段运行的上限放宽到每段 60 分钟、3000 万 token（运行器默认 20 分钟、1000 万；在 `~/dsh-work/ladder/_common` 的副本里改常量，同修 `--patch` 参数顺序的做法）；碰到上限记 `stopped: limit`，由 lead 看进度再定是在同一 Session 继续还是拆小。

## 每片怎么核对

DSH 的报告只是输入。每段结束后：
1. **脚本核对**（DSH-WORKFLOW §6.6）：`git status --short` 的形状；`git diff --name-only` 等于规格 §6 的清单（第一段只多不少地落在清单内；第二段恰好等于清单）；第二段里冻结测试的 sha256 没变；`npm run typecheck`、`npm run check:architecture` 通过；点名的新测试和回归测试的数字和任务书一致；没有提交；`scan.json` 没有越界访问。
2. **第一段之后**：lead 审测试（每个用例对着规格的表核对给定和期望；RED 必须来自 `not implemented` 桩，不是编译错或夹具错），冻结测试文件的 sha256，再发第二段。第二段的“冻结测试”一节由 lead 在发送前填上文件和 sha256。
3. **第二段之后**，三件事同时开始（DSH-WORKFLOW §7）：脚本核对；Codex 只读审查（推理强度 xhigh，三片都改状态和逻辑；第 0 片用 high），在一次性副本上看 DSH 的结果，说明里附上规格和任务书；lead 读 diff，重点是规格 §8 的规则。lead 逐条核实 Codex 的问题，和自己的发现一起写成一轮返工说明（位置、思路、要重读的规则，不给答案），发给同一 Session。一般一轮就够；第二轮还不行，lead 用别的办法收尾。
4. **合入本分支后**：跑已合入各片的点名测试；最后一片合入后，跑一次全量测试（`npm test`，一次只跑一个、机器空闲时跑），加 `npm run build`。全量数字和 9b94fc55 的 215 个文件、5234 项相比，只多出各片新测试，原有的一个不少、没有新失败。
5. **用量**（决定 43）：每片、每段记 DSH 的时间、token、工具调用次数，lead 的工具调用次数和墙钟（等待单列），写进各片的证据。

## 验收以后 lead 同步的文档（不在 DSH 写范围）

STATE-MACHINES-SPEC（新行和 §15 的行→文件→用例对照）、`module-dag.md` §6（views、`configuration → state`）、能力索引、HANDOFF、STATUS、DESIGN §8.2 的状态。各片证据放在 `docs/refactor/reviews/evidence/` 下新目录。

## 冻结后的审查（2026-10-08）

冻结以后用 Codex（推理强度 xhigh，只读，在 736cea57 的一次性副本上）对着 DESIGN、HANDOFF 决定 20–43 和代码审了一遍规格和任务书；lead 逐条核实，改了真问题，正文改处标【审查改】：
- 第 0 片：S0-01 的假架构读取原来回 `rejected`，scan 会把图当“读不到”，这一条永远不过，改成 `{ status: 'not_found' }`；任务书分成两段（决定 43）。
- 第 1 片：加 IT34 锁住 §0.1 冻结的 U1 跳过；UT11、UT15 不再要求纯 state 给出提交游标；加纯函数 `deriveTaskArchiveState`（“中断，待核对”和下一步提示）；IT09 和 §2.8 去掉已没有的 module-maintainer 职责；几处草稿残句（codec 下移、用例数）。
- 第 3 片：自治取值改成和第 5 片一样（`every_step`）；注意力通知每种行的精确写法和行序。
- 第 5 片：补上 `response.decision.source`、`application.basisRebases` 两个字段；共享消息写入 `persist` 带上入口算好的身份；暂停后落实只比“答复时”和“现在”的内容（删掉要求读中间事件链的那句）；SC02 改成两边计划都有模块 M（本片没有执行改过的文件）；补四个纯函数的签名、消息和计划状态机成员的名字；冲突卡的三个选项照 UI-WORKBENCH §0 的措辞，别的非消息卡 `options: []`；Workflow 结果里放决定原因的字段；加 8 个用例（SS15、SS16、UM13、AP14–AP16、WF01、WF02）和 1 个测试文件。
- 接线加 I-5、I-6，接线任务书也照两段做。

## 施工结果（2026-10-09）

| 片 | 结果 | 提交 | 证据 |
| --- | --- | --- | --- |
| 0 | 做完，合入 | 21a99915（B0 是 48c8d473） | [orchestration-slice-0-2026-10-08](../../../reviews/evidence/orchestration-slice-0-2026-10-08/README.md) |
| 1 | 做完，合入 | 327ec020 | [orchestration-slice-1-2026-10-08](../../../reviews/evidence/orchestration-slice-1-2026-10-08/README.md) |
| 3 | 做完，合入；合入时 lead 修了两处第 3 片的回归 | ccecc016、e48218a5 | [orchestration-slice-3-2026-10-08](../../../reviews/evidence/orchestration-slice-3-2026-10-08/README.md)（含第 1、3 片的合入） |
| 5 | 实现完、冻结测试全过，但唯一一轮返工之后审查仍有大的必改问题，**没有接受，没有合入**；结果留在副本里，下一步要用户或 lead 定 | 无 | [orchestration-slice-5-2026-10-08](../../../reviews/evidence/orchestration-slice-5-2026-10-08/README.md) |

合入第 1、3 片后（e48218a5），类型检查、模块边界检查、构建通过，全量测试 250 个测试文件、5626 项全部通过，`verify:isolated` 通过。和 9b94fc55 的 215 个文件、5234 项比，只多了第 0 片 1 个文件 3 项、第 1 片 23 个文件 212 项（另有它改过的已有状态测试多 9 项）、第 3 片 11 个文件 168 项；原有的一个不少，没有新失败。没有调用真实模型。

**写范围比规格 §6 多出来的**（lead 逐条定的，都不改用户看到的行为，除了第 5 片的 L1）：
- 三片都多 `src/ui/api/routes.ts`：`ROUTE_LABELS` 按 `CoreRouteSuffix` 穷举，新后缀不加标签 `tsconfig.ui.json` 就不过；只加本片新后缀的标签。三份规格都漏了这个文件。
- 第 1 片（最终 95 个路径，规格是 87 个）：`src/core/work-graph/queries/contracts.ts`（`QueryExecutionDependencies.sessionFacts?`，后来加 `legacyProvenance?`）；4 个新的测试辅助文件（Codex 写夹具时加的）；3 个已有测试按规格 §5.5 最后一段改期望（`A2-rework-contract-helpers`、`C1-session-mailbox`、`A2-step1-codecs`）；Workflow 的可选依赖 `records`、`now`、`responsibilityBasis`、`legacyProvenance`，`WorkflowAdvanceResult.value.maintenanceFailures?`，Host 用的 `readTaskRequeue`。`src/app/collaboration-driver.ts` 改过又改回，净不变。
- 第 3 片（42 个路径）：允许清单没改（第 3 片的 `kept-for` 条目一个也没用到），所以规格的 42 个去掉它、加 `routes.ts`。合入时 `tests/work-graph/S3-graph-context.test.ts` 的夹具补注册第 1 片新读的记录（5 行）。
- 第 5 片（副本里 93 个路径，没合入）：A1 接受 6 个类型逼出来的文件（`src/contracts/query-job.ts`、`queries/query-job-service.ts`、`src/ui/views/sessions/render.ts`、`routes.ts`、两个已有测试）；L1 让 `src/app/host.ts` 在已有的 `createTargetPlatform` 调用里加一行 `operatorActor: actor`（不加的话生产 Host 没有操作者，每个新的用户写入都是 `unsupported`）。

**合并时的语义交叉**，比上面“三片在哪些文件上碰头”列的多一处：第 3 片把接续说明的组装从 `execution-preparation.ts` 搬进了 `context-assembler.ts`，而第 1 片改的正是这段（归档来源不带历史种子、异常锚点一段、超大时拒为 `capacity`）。lead 把第 1 片的行为搬进装配器（第 3 片证据“合入”）。

**核对的教训：**
- 第 3 片的验收只跑了点名的回归集，两处回归（平台公开键、C6 的已领取 Run 卡住）到合入后的全量才发现。以后每片在合入前跑一次全量。
- 沙箱没有 bwrap 时，“逐文件数字和基线相同”会盖住失败原因的变化；lead 的核对也要比较失败信息，并在有 bwrap 的 WSL 槽位里复跑这些文件。
- 运行上限按决定 46 改了：token 只记不拦，单步上下文超过 36 万就停，每段最多 120 分钟。第二段和返工都用新 Session、只写关键信息的说明书、分组交给子任务。实测见 [DSH-WORKFLOW §6.10](../../../DSH-WORKFLOW.md#610-大片怎么交给-dsh决定-46)。

**合入以后的接线：** 第 1、3 片都已合入，I-1、I-3 现在可以做；I-2、I-4、I-5、I-6 要等第 5 片。接线任务书照决定 46 写。

## 施工结果（2026-10-09 晚：接线包 1，第 5 片决定 47 的一轮）

| 项 | 结果 | 提交 | 证据 |
| --- | --- | --- | --- |
| 接线包 1：I-1、I-3、改目标说明的检查、普通接续的交接（决定 47 第 2–4 条） | 做完，合入 | 规格 67dfee7a，实现 6180adfc | [orchestration-wiring-1-2026-10-09](../../../reviews/evidence/orchestration-wiring-1-2026-10-09/README.md) |
| 第 5 片，决定 47 破例多给的一轮 | 四个区域都做完、全量全过，但仍有 6 处用户看得到的问题，**没有接受，没有合入**；决定 48 再给一轮，先补测试 | 无 | [第 5 片证据](../../../reviews/evidence/orchestration-slice-5-2026-10-08/README.md#2026-10-09决定-47-的一轮仍没有合入) |

合入接线包 1 后（6180adfc），类型检查、模块边界检查、构建通过，全量测试 258 个测试文件、5,689 项全部通过，`verify:isolated` 通过。和 e48218a5 的 250 个文件、5,626 项比，逐文件只多接线包的 8 个文件 63 项。没有调用真实模型。

**接线包 1 的写范围比规格 §6 多出来的**（lead 定的，不改用户看到的行为）：测试辅助文件 4 个（规格允许最多 3 个；夹具按 4 组分，一组一个）；`tests/architecture/production-reach-allowlist.json` 删 2 条 `kept-for`（`RoleReadOptions`、`RoleConfigurationPort.readRoleSpec`，现在被 I-1 走到了；lead 决定 W-I1）。共 25 个路径。

**现在的接线状态：** I-1、I-3 已接；I-2、I-4、I-5、I-6 等第 5 片合入。I-4 接自治级别时，要按接线包规格 L3 把它加进 Goal 内容摘要（`contentVersion` 升到 2），I-4、I-6 都在 `views/context-extensions.ts` 的提供方里接。第 5 片合入时要和接线包三方合并（两边都改了 Workflow 的 `workflow.ts`、`contracts.ts`、`ports.ts`，`create-platform.ts`、`context-assembler.ts`、`execution-entry-service.ts`、`context-input.ts`；接线包规格 §0.3）。

**第 5 片这一轮的情况：** 先换到合入第 0、1、3 片后的基线（18 个文件 53 处冲突，lead 按规则合并；合并后的 6 处问题 M1–M6 和两处第 5 片自己的回归 R1、R2 由 lead 修，R2 只有全量才跑出来），lead 改了决定 47 点名的 5 个小问题，再把大的分成四个区域（队列历史、决定来源和答复、排序的安全点、设置的重放）各交一个新的 DSH 会话，每个区域之后 Codex 复审、lead 修小的；B 区用了那一次破例多做一轮。合起来全量 266 个文件、5,850 项全过。剩下的 6 条（暂停后自动化确认卡消失、Agent 采纳计划记不下按谁的决定、重试读失败挡住重放、关闭历史没有先后、超量不报“容量不足”、初始化采纳后卡不关闭）和“这些地方都没有测试覆盖”见证据。

**核对的教训（补充）：**
- 第 5 片前几轮“冻结测试全过、问题靠审查找出来”的根本原因是测试没覆盖；每一轮修好一些，审查又找到一些。决定 48 改成先由 Codex 补测试、lead 冻结，再修。
- 换基线时只有全量才跑出一处回归（R2：格式不对的请求让第 5 片的闸门抛异常），点名集合没覆盖到。合入前跑全量这条规则照旧。
- 两条轨道同时做时，测试一次只跑一个成了瓶颈：接线包这边为等测试锁花了约 76 分钟（第 5 片那边的全量用 `--maxWorkers=1`，一次 26–31 分钟）。

## 怎么来的

Codex 三份草稿同时起草（第 1 片 65 分钟、第 3 片 72 分钟、第 5 片 39 分钟；见 lead 临时目录的 `slices/DRAFTS.md`）。lead 冻结时：在 9b94fc55 上抽查了约 110 个 `file:symbol` 引用（都存在），找到四处和当前代码不符（第 1 片漏了 `core-http-types.ts`；第 3 片要删的两个文件已在 7e0b7f56 删掉、`graphHistory` 已是必填依赖；第 5 片说的 `pureDirectories` 已退役），并统一了三片共用的东西（职责类型、`views` 的依赖、合入顺序）。冻结记录在 lead 临时目录的 `slices/FREEZE.md`。
