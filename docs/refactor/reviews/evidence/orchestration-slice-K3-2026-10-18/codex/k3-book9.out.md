**这份返工书目前还不能直接标为 buildable。** 主要缺口在裁定 1 的范围自相矛盾、裁定 6 对现有 sandbox helper 能力的假设、裁定 8 尚未冻结容量行的具体处置，以及 F-100/F-101 尚未写全的实施边界。

以下只审 §2 的 21 条新裁定及 F-098–F-101。F-001–F-097 只作为既有任务和调用关系引用，不重新裁决。**未写文件，未运行测试或检测器。**

路径缩写沿用 M：`H`＝tests/helpers，`R`＝tests/runtime，`S`＝tests/scenarios，`W`＝tests/work-graph，`B`＝tests/business，`A`＝tests/app；`RT`＝src/core/agent-runtime，`TG`＝src/core/work-graph/tasks，`CM`＝src/core/work-graph/communication，`VR`＝src/core/work-graph/views。

**1. 返工书直接引用的 file:line**

| 书中引用 | 判断 | 核对结果／正确位置 |
|---|---|---|
| `D1:287` | **ok** | `.lead-ref/b3-tests.diff:17361` 起可见完整变化：Task 标识改为真实公共链取得的 `taskId`，仍对对应 Run 集合做同一个 `.toContain(roundRunRef.runId)`。不是删除该义务。 |
| `D1:371` | **ok** | diff `:20168` 起的旧断言确实包含 `alias: 1, command: 'echo safer', cwd: null, rationale: 'y'.repeat(100)`；现在公开读回后的 `W/K3-48-2…:401` 只比较 rationale。裁定要求恢复完整读回断言是明确的。 |
| `D1:486` | **ok** | 确实是删除 `H/K3-large-review-input.ts` 的 ledger 条目。 |
| `k3-g4b3-rework-6.md:37` | **位置 ok，论据表述过强** | 第 37–39 行要求把手造 32 条记录的 owner 场景移到纯测试，没有逐字要求删除这个 helper 文件。可以由本书明确批准删除；不宜写成旧书已经点名要求删文件。 |
| `RT/context-assembler.ts:1447` | **ok** | 跨请求聚合以 `revision` 打破 `createdAt` 平局的实际位置；下一行 `:1448` 用 `.at(-1)`。修改比较器时必须一起考虑取值方向。 |
| `slice-K3-SPEC.md:555`，称为“L18” | **wrong** | `:555` 属于 **L20**，写的是 approve 的行为；L18 选项 ID 在 `:432`。这两处都不能单独作为两个中文 label 和“没有自查依据”的既有完整字面出处。新裁定本身可以冻结这些字面量。 |
| `TG/unknown-call-review-codecs.ts:273` | **ok** | `proposalProblem` 的 cwd 校验，当前确实接受空串。拒绝句在 `:274`；owner 对应检查在 `unknown-call-review-service.ts:683`，最小长度检查在 `:689`。 |
| `TG/unknown-call-review-service.ts:1307`，称“shared guard” | **位置接近，性质 wrong** | `:1307` 是注释；`:1309` 取已保存答复的 `goalBases[0]`，`:1310` 调用纯谓词。现成共享函数是 `src/core/work-graph/state/goal-settings-machine.ts:256` 的 `goalDecisionBasisMatches`，不是一个可直接调用的完整 owner guard。 |
| `TG/command-rerun-request-service.ts:985` | **ok** | CRR `applyAnswer` 读取当前 Goal 的位置；后面只有 active 检查，没有答复捕获基准的 T02 检查。 |
| `RT/context-assembler.ts:1195` | **ok** | `readKernelCommandFacts` 的 64 页循环；耗尽循环后仍可能走到 `ready`。 |
| 同文件 `:1217` | **ok** | cursor 不前进时直接 `break`，随后返回已收集事实。 |
| `R/B2-02-recognition-unified.test.ts:192,196` | **ok** | 前者是“recognizer rejection is not fail-closed”的测试标题，后者起断言 `continue`。包 B 的文件所有权指派准确。 |

另有一个范围输入错误：`k3-line-scope.txt:13` 把 F-013 的三个调用标成 `nofile`，但当前副本确实有 `S/K-R-attested-facts-source.test.ts`，`:171`、`:309`、`:377` 也是 M§3 所列调用。**不能据此把这三个已经明确加入范围的调用丢掉。**

**2. 各裁定的改动函数、调用者、下游及 OPEN**

旧 helper 的完整调用点清单已经在 [M§4.6](/D:/cxt/k3-audit/.lead-ref/k3-merge.out.md:388)。下表引用这些集合时，只把它们当作调用边清单：不重新审查其中 F 行，也不把所有消费者扩大成全文件整改。

| 裁定 | 改动及调用传播 | 尚未冻结的地方 |
|---|---|---|
| **1 范围** | 本身不改生产函数；决定 `openK3ReviewCardWorld`、proposal helpers、tool seams 等旧行是否进入整改。消费者分别是 M 的 C-WORLD/C-RECORD、C-PROPOSAL、C-TOOLS。 | “B3 改过的 K3 文件全文”与“T-001–T-091 全部保留”冲突，详见第 7 项。 |
| **2 ledger** | 只改变 F-067 的测试断言：`proposalFixture → writeK3Proposal → reviews.readReview` 的完整读回值。D1:287、486 无新增实现。 | 要明确恢复的是 **短理由重试成功后**的完整 proposal，不是仅保留当前长理由成功案例中的中间断言。 |
| **3 Q-03** | `openRealRunHarness` 的真实 probe/reconcile 路径；`B/K3-review-workflow-rows` 的 UR3、UR5、UR7b 场景。harness 出口全部调用者为 C-HARNESS；Workflow 行的具体实例仍按 F-015。下游是 Run 结束、review 定稿及答复落实结果。 | UR3 已明确；UR5 须命名实际失败依赖和发生点，不能继续传成品 probe。 |
| **4 纯测试** | 允许直接调用已有纯导出，例如 build/render/fit/codec；消费者为 C-PURE。不会因为模块还导入 reader 就自动改变生产代码。 | 无须凭此新增生产出口。D3 应按直接导入及实际构造判断；当前 ledger 已报 D3 0 hits，不能反过来拿“模块依赖闭包”判违规。 |
| **5 A1 示例** | `H/K3-35-continuation-fixture.ts` 的 `openRealRunHarness`、prepare/start、recognition、mailbox 装配；调用者是 C-HARNESS/C-PREPARE，以及其上的 C-WORLD/C-PROPOSAL。 | “示例不是整文件豁免”明确，未新增允许造事实的入口。 |
| **6 sandbox/gate** | `ShellSeam.definition`、`BlockingToolSeam.definition/handle`、`createProcessSandboxStandin`。调用者为 C-TOOLS 的 **98 个 shell definition 调用、7 个 read 调用、1 个 mailbox handle 调用**，另加下文列出的 sandbox module mocks。下游依次是工具注册、模型工具清单、dispatcher、Kernel 事件、Run reconcile、review draft、卡和接续说明。 | 现 helper 返回协议不完整；读／mailbox 现 API 不接真实 definition；“每个 mock”是否越出本轮范围；只读隔离例外；held call 的结束方式及 cleanup。 |
| **7 crash** | `HostScenario.restart`、真实模型／handler／commit gate；直接影响 F-044、B2-09b，以及 K3-09/29/37/44 等恢复场景。下游是 startup reconcile、Workflow redrive、幂等回执与新 Run。 | 需要区分 Host crash、正常 restart、Runtime 自己记录的 `crashed`；现有 commit observer 不能充当 gate。 |
| **8 容量** | `openK3_35PublicRecord/prepareWorstCase`，F-067 的 `proposalFixture/writeK3Proposal`，K3-48-3 的公开创建、settle、hold/release。生产预算读取者见第 4 项。 | 三行都没有对应 Host 配置预算；“最大可达输入”未定义、未证明；固定预算但公开可越界的第三种情况没写；B/R 算术差 32 字节。 |
| **9 timeout** | 只改 F-055 对应的测试 timeout；所有被这些测试顺序等待的真实 setup/Runtime/owner 操作都会计入。 | 要写清原值和 rework 6 已批准的 hook 例外；不能把测试 timeout、hook timeout、Runtime drain timeout 混成一个。 |
| **10 排序／F-098** | `readTaskBlockedCommands`；需盘点 `commandRerunRequestSummary` 的 earlier 排序、`commandRerunRequestDeclaredForms` 的声明顺序，以及 shell hook 选择 allowance 的排序。完整生产调用链见下。 | newest 的取值方向；“以前”的成员资格是否仍严格早于当前时间；declared forms 和 allowance 是否属于本裁定。 |
| **11 读取次数** | `listTaskRequests/listRequests` 的分页及 `W/B2-18-request-reads`；hook 的 `before_tool` 和 continuation prepare 是相关公开操作，下游使用整份 requests。 | 公式已清楚。应说明它数的是完整公开操作中的 request 页读取，不含 Task closure 等不同读取，也不能按 alias 重复计算一份全 Task 列表。 |
| **12 字面文案** | 测试使用三个独立字面量；生产自查默认值在 state `unknown-call-review.ts:622`，审批 options 经 UCR card projection 进入 queue/source facts/answer 校验。 | 错误规格定位要改；不存在需要实现者决定的新文案。 |
| **13 cwd／F-099** | `proposalProblem → unknownCallReviewBodyProblem → record/event decoder`，完整调用链见下。 | “cwd”要限定为 proposal.cwd；原命令 summary.cwd 和 approvedMethods 的现校验不是同一入口。`rejects:` 必须打到 codec，否则 owner 已有检查会让测试在修改前就过。 |
| **14 codec 文案** | 保留现有 codec 拒绝断言；没有新增生产函数或异步调用。 | 与 13 不必冲突：可保留现拒绝句；如要把该句改为 `1..512`，必须明确列为唯一文案例外。 |
| **15 UR7 扩展** | F-015 指定的公共 Workflow 路径；涉及 `advanceWork`、真实答复／落实，消费者仍是 K3-46 扩展行。 | lead 登记规格是文档责任；不是实现者自行改变 FIRST failure、继续推进或 T02 中文结果。 |
| **16 T02／F-100** | `createCommandRerunRequestService().applyAnswer`；直接生产调用只有 `createCommandRerunRequestApplicationAdapter.apply`，`WF/decision-actions.ts:284`。经 decision coordinator 被人工 resolve、重试、UR7/恢复使用。结果进入 CRR 状态、正式落实回执、卡历史、hook allowance、接续说明。 | 已保存答复从哪里读、验证哪些身份、共享什么 guard、失败码和重放顺序都未写全。 |
| **17 已知限制** | 不改代码；分别涉及 blocked-command 压缩和 continuation 渲染的最后 fallback。下游仍是识别／展示、接续模型输入。 | “no change this round”是明确裁定；需要 lead 的规格后注，不能被实现者当作额外整改。 |
| **18 不完整 Kernel 读／F-101** | `readKernelCommandFacts`；四类调用者和下游见下。 | 完成条件、64 页的边界、取消优先级、review prepare 的既有 fallback，以及两条分支的合法测试入口。 |
| **19 分类列** | 只改报告分类，不改函数、调用或返回值。 | 无 OPEN。 |
| **20 M§7** | 将既有冲突处置绑定到测试；无独立新实现。 | 必须明确裁定 6 的 A7 例外覆盖 M§7 中“必须真实 sandbox、假 available 为 F4”的旧文字；容量处置也应服从修订后的 8。 |
| **21 RUN-25/mailbox** | `openRealRunHarness` 复用 `hostPlatform()`，新增窄 mailbox 访问出口；RUN-25 出口及调用者为 C-HARNESS 的 `reconcileUnknown/reconcileUnknownTwice/replayRecord`。mailbox 重点消费者是 `W/K3-47-continuation-gate`。下游是实际 message、yield/resume、接续可领取性。 | 缓存 platform 已有，公开 accessor 没有。应冻结“访问已有实例”，避免另建一个 platform/mailbox。 |

四条新生产行的调用闭包如下。

- **F-098**
  - `readTaskBlockedCommands` 唯一生产调用：`RT/context-assembler.ts:1530` 的 `assembleBriefForContext`；其 `requestState/declaredForms` 进入 `assembleContinuationBrief`，再进入渲染、digest、prepared manifest、Runtime 模型输入。
  - `commandRerunRequestDeclaredForms` 唯一生产调用：`command-rerun-request-card.ts:171` 的 `commandRerunRequestSummary`。
  - `commandRerunRequestSummary` 的生产上层是同文件 `:207` 的 `commandRerunRequestCardFacts`；后者两个生产调用：`CM/decision-source-facts.ts:873`、`VR/decision-read-model.ts:655`。下游分别是答复时重新验证的来源事实，以及队列／单卡展示。
  - 若将 allowance 选择也纳入：`RT/execution-driver.ts:493` 的选择值直接交给 `:500 consumeAllowance`；结果决定是否放行真实 shell。它不是纯展示排序。
  - `context-assembler.ts:1409` 和 `execution-driver.ts:462` 排的是 **review records**；不是本条的 request 排序，不应顺手修改。
  - CRR service 内按 revision 合并**同一 ref**的版本，也不是“跨聚合 revision”错误。

- **F-099**
  - `proposalProblem` 被 `unknownCallReviewBodyProblem` 调用；后者的两个生产调用为 record decoder `:572` 和 event decoder `:649`。
  - record decoder 全部生产调用：`TG/claim-service.ts:1005`、`execution-entry-service.ts:1508`、`plan-readers.ts:1757`、`unknown-call-review-service.ts:451,1427,1551`，以及 codec schema registration `:664`。
  - event decoder 全部生产调用：UCR service 的 receipt replay `:467`、`CM/decision-application.ts:92`、schema registration `:674`。
  - 下游分别是 review claim/admission、execution entry、canonical Task facts、owner read/list/write 前置、存储提交验证、回执重放、正式决定落实证明。**encoder 本身没有新增验证**，不能把“encode 成功”当作该检查通过。
  - 现有直接测试消费者在 `R/K3-16-review-extremes-pure`、`R/K3-26-unknown-call-review-pure`、`R/K3-48-3-extremes-pure`、`W/K3-15-disposition-effects`、`W/K3-26-unknown-call-review-storage`、`W/K3-48-2…`、`W/K3-50-codec-shape-checks`。

- **F-100**
  - owner 的唯一生产构造位置是 `src/composition/create-platform.ts:762`；这里目前没有接入 saved-answer reader。
  - owner 唯一生产调用者是上述 CRR application adapter。它把结果交给 coordinator 的③，后者读取正式回执，不凭 adapter 的成功外壳认定落实。
  - 共享纯谓词 `goalDecisionBasisMatches` 还被 `goal-settings-service.ts:662,740,749,897`、`plan-service.ts:469`、UCR service `:1310` 使用。F-100 应复用其语义，不改变这些既有调用者的规则。
  - 当前“完整 guard”还包含 UCR 私有的答复读取、synthetic/responded、source/pins/selection 校验；只复用纯谓词并不能补齐它。

- **F-101**
  - `RT/context-assembler.ts:1249`：`reviewCommandFacts`，再经 `:1299 assembleReviewForContext → buildUnknownCallReviewInputV1 → renderUnknownCallReviewZh → prepare`。
  - `TG/unknown-call-review-service.ts:196`：`buildBlockedCommands`，经 `applyDisposition:1335` 决定是否写处置。
  - `CM/decision-source-facts.ts:848`：CRR 卡的来源事实，供答复校验。
  - `VR/decision-read-model.ts:638`：CRR 卡的读取／队列投影。
  - 后三处通过 `create-platform.ts:753,903,970` 接入同一个 reader。测试中的直接装配在 `H/K3-blocked-command-fixture.ts:429`。
  - 后三类消费者对缺少原命令会拒绝；第一类目前在 `context-assembler.ts:1255` 把非 ready 变成空 facts，随后允许摘要 fallback。**因此不能仅改 reader 就宣称所有上层 prepare 都失败关闭。**

**4. 静态可达性**

**裁定 6：真实 shell 可以进入真实 Runtime，但“现 helper 只把 probe 改为 available”还不足以完成工具调用。**

静态链条是：

1. `RT/observed-model-run.ts:272` 从授权工具集合取 `allowed`；`:301` 构造 `enabledNames`。这里决定模型是否获提供 shell。
2. Kernel composition 在 `vendor/coding-agent/dist/app/composition/composition-root.js:60` 调 **默认模式** `ProcessSandbox.probe(root, workspace)`，`:67` 注册 shell，`:71` 冻结启用清单。
3. 默认 probe 的 `available` 决定 `:76` 是否授予 `isolated_process/network_isolated`。它并不是 `reviewCapability` 的只读 probe。
4. dispatcher 在 `tools/dispatcher/tool-dispatcher.js:72` 检查这些 capability；缺项时返回 `sandbox_unavailable`，到不了 handler。
5. Runtime runner 在提交并等待 `tool.started` 后才调用 executor，位置为 `runtime-runner.js:638`、`:644`。所以 handler 入口 gate 确实在 `tool.started` 提交之后。
6. 调用权限仍通过真实 policy/approval；平台在 `observed-model-run.ts:357` 使用其正式 StaticApprovalRequester。

另一路 `RT/runtime.ts:446` 的 `createReviewCapability` 先核对 Host 只读开关、root、整工作区 read 授权，再在 `:480` 以 `workspaceMode: 'read_only'` 等选项 probe。它控制核对能力，不替代默认 shell probe。

现 helper 的问题有四项：

- `process-sandbox-standin.ts:39` 的默认 probe 取决于 **executeChecks**，不是 `available`。只设 `available=true` 仍可能没有 shell 的两项隔离 capability。
- `:49` 在 `executeChecks=false` 时直接拒绝执行。
- `:64` 返回的 `effects` 只有 revision、changedPaths。真实 shell 原样转交它；dispatcher 用严格 schema 校验。`tool-executor-port.js:28` 要求 `sideEffect`、`changedPaths`、`workspaceRevision`、`artifactRefs`，缺字段会成为协议错误。`timings` 也没有给出。
- 它用 `spawnSync`，不接收 signal，固定 `cancelled:false`，忽略 constructor options，按字符切输出，并在只读模式也执行 `acceptAgentChanges`。这些都不能作为完整替换的既定能力。

gate 本身可以用于未知结果：

- **取消／停止／Run 级截止触发取消**：gate 保持 pending，不响应 abort；Runtime 在取消后的 drain 等待结束后记录 unknown。当前 drain 默认是 **5,000 ms**，见 `runtime-runner.js:116,670` 附近。
- **Host abandonment**：可以保持旧 handler pending，由新 Host 对同一 SQLite 做恢复。
- **模型正常最终回复**：不可以越过仍 pending 的工具组。后续模型请求要等工具组结束。
- **下一次模型调用抛错**：同样不能作为结束一个尚未释放工具的办法，因为下一次模型调用还不可达。
- **仅工具自己的 timeout**：dispatcher 的 timer 只是 abort handler signal，`:130` 仍 await handler；不响应 signal 的 gate 不会因此自动返回。
- **cleanup**：不能在验证未知结果之前释放。取消后的清理可先确认旧父 signal 已 aborted，再释放，让真实 shell handler 在入口返回 cancelled；abandoned Host 必须先完成新 Host 的恢复断言，再处理旧实例，避免旧 handler 真跑命令。

当前所有 process sandbox module mock 共 **48 个测试文件**：

```text
A/K3-19-review-capability-host.test.ts:27
A/RL-33-workbench-resource-caps.test.ts:21
A/RL-34-wiring-resource-caps.test.ts:28
A/RL-44-host-restart-resource-caps.test.ts:21

R/K-readonly-command.test.ts:74
R/K3-12-review-round-tools.test.ts:283
R/K3-19-review-capability.test.ts:28
R/K3-35-approved-methods-brief.test.ts:28
R/K3-35-review-input-size.test.ts:41
R/K3-35-T-by-hand.test.ts:58
R/RL-30-shell-resource-caps.test.ts:15
R/RL-31-readonly-resource-caps.test.ts:18
R/RL-32-check-resource-caps.test.ts:19
R/RL-35-36-sandbox-and-retry.test.ts:25

S/B2-09b-allowance-crash.test.ts:52
S/K3-05-review-round.test.ts:43
S/K3-06-mixed-batch.test.ts:46
S/K3-08-wait-reply.test.ts:42
S/K3-09-restart-between-calls.test.ts:40
S/K3-10-review-round-cells.test.ts:39
S/K3-11-review-reasons-r2.test.ts:51
S/K3-12-14-review-round.test.ts:58
S/K3-13-two-commands.test.ts:35
S/K3-15-card-hold.test.ts:32
S/K3-16-approval-round.test.ts:44
S/K3-16-proposal-round.test.ts:39
S/K3-17-review-answer-shape.test.ts:45
S/K3-18-one-card.test.ts:40
S/K3-19-missing-read-no-round.test.ts:58
S/K3-19-review-unavailable.test.ts:46
S/K3-26-inventory-scenarios.test.ts:125
S/K3-27-review-claim-close.test.ts:39
S/K3-28-attested-continuation.test.ts:31
S/K3-29-disposition-recovery.test.ts:47
S/K3-29-maintenance-review-run.test.ts:38
S/K3-29-recovery-continuation.test.ts:38
S/K3-29-recovery-round.test.ts:50
S/K3-29-startup-variants.test.ts:45
S/K3-37-stopped-review-round.test.ts:40
S/K3-42-truncated-command.test.ts:46
S/K3-42-unexpanded-r2.test.ts:46
S/K3-44-hold-restart.test.ts:37
S/K3-44-recovery-answers.test.ts:48
S/K3-45-review-incomplete-r2.test.ts:53
S/K3-R1-second-cleanup.test.ts:44

W/K3-18-review-card-queue.test.ts:60
W/K3-48-2-unknown-call-review-model-text-budget.test.ts:46
W/RL-32b-rework-notice-memory-cap.test.ts:30
```

其中不能靠现有一个通透 helper 等价替换的需求：

- **K3-12**：`R/K3-12-review-round-tools.test.ts:330` 要求只读命令 `echo written >out.txt` 真正写入失败。通透 shell 在可写工作区会写成功。SPEC `:1426` 原先允许“能力替身下的结果映射”，而 v3 禁止手造 execution result；按新规则，这一行为需要真实只读隔离。因此 §4 的“none should after ruling 6”不成立。
- **K3-19 capability**：`R/K3-19-review-capability.test.ts:33,79` 观察 probe options；共享 helper 需允许 A3 观测实际传入参数，不能丢掉这项断言。
- **8 个 RL 文件**：依赖 `RL-kernel-sandbox-double.ts:63` 起的 probe/constructor options、resource-cap source 的 `current()`、cap 状态、abort/release 等。通透 helper 没有这些行为；其中构造资源上限结果的做法也不能在本轮被悄悄“合法化”。
- **K-readonly-command**：涉及 readonly options、隔离及结果映射等；它不是本轮 K3 helper 整改的自然全文件范围。
- 两个已有 helper 使用者 `S/K3-29-disposition-recovery`、`S/K3-44-recovery-answers` 的正式 check 需要实际执行命令；共享 helper 必须保留这条真实执行能力。

**裁定 7：受控边界上的 Host crash 可用现 harness；它不证明进程已经消失。**

`S/harness.ts:1043` 的 crash 分支实际做的是：

- 标记旧 model 实例 abandoned；
- **保留**旧 Host 到 abandoned 列表；
- 写 stale lock；
- 启动新的 Host，复用 SQLite；
- 最后才由 `drainAbandoned()` 释放／关闭旧实例。

因此 v3 A2 中“its objects dropped”不准确。文件自己的 `:32` 注释明确说 HTTP server、lease、driver、check process 都可能还存在。

对本轮相关边界的判断：

| 行／场景 | 能否服务 | 必须持有的边界 |
|---|---|---|
| **F-044，K3-41（三）** | **能** | release-hold 的真实提交已经 durable，但 route 尚未继续 human requeue。然后 abandon，启动新 Host，同请求重放。当前通过 Goal pause 制造 requeue busy 的路径不满足这个边界。 |
| **B2-09b allowance crash** | **能** | allowance 已 consumed，真实 shell 的 `tool.started` 已提交，handler 尚未执行命令。 |
| **K3-09 两次工具之间／工具在途** | **能** | 分别持有下一次真实模型回复、或指定真实工具 handler。两种边界不能混用。 |
| **K3-29、K3-44 的答复／②／③恢复** | **能** | 分别停在真实已保存答复、落实提交前后、或正式落实记录前后；按该行要证明的 durable 状态选择。 |
| **K3-37 暂停／Goal 暂停后的重启** | **能** | 先经公共 control 到达该状态，再在旧驱动不会继续推进的边界 abandon。 |
| **Run 因模型异常结束为 crashed 的行** | **不应替换成 Host crash** | 用真实模型异常产生 Runtime terminal；例如 proposal fixture 的 unfinished 行。 |
| **证明旧子进程／systemd 单元已经消失** | **不能** | `restart({crash:true})` 不杀进程。SPEC K3-49 `:1441` 属于这一类，但不在本轮新裁定所需整改范围。 |

我没有发现本轮已命名的 **Host crash 恢复义务**必须使用 child-process kill。问题是书中把所有 `"crash" or "restart"` 一概同化，以及尚未提供持有 commit 边界的 fixture。

尤其 `S/harness.ts:132` 的现有 commit observer 在真实 commit 后同步通知，`:138` 不 await observer；它明文不能 delay write。**传一个 async observer 不能构成 F-044 所需 gate。** 必须加 A2 的真实 commit wrapper，并限定到旧 Host／目标提交，避免把新 Host 恢复也挂住。

**裁定 8：三处主要预算均不是 Host/Runtime 配置；当前“最大输入低于预算”的前提不成立。**

| 行／预算 | 实际来源 | Host/Runtime 可否调小 |
|---|---|---|
| F-066 接续说明 16,384 bytes | `src/contracts/continuation-brief.ts:276,286`；renderer `:452` 起保留必需部分并判容量 | **否** |
| F-067 可选文字准入 B＝158,720 | `state/unknown-call-review.ts:39,231` | **否** |
| K3-48-3 整记录 524,288；reserve 365,536 | 同文件 `:35,37,225` | **否** |
| 相关 proposal rendered methods 5,120 | `src/contracts/unknown-call-review.ts:186` | **否** |
| 相关完整 manifest 256 KiB | `execution-preparation.ts:81` → `contracts/artifact.ts:7`，实际检查 `:555,565` | **否** |

`fitUnknownCallReviewForManifest` 的 `instructionMaxBytes/manifestMaxBytes` 是纯函数参数（`:101,102`），正式 prepare 在 `:552` 没有从 Host 配置传入它们。不能拿它冒充裁定 8 的“Host 配置”。

Runtime 的 token/request/tool/time budgets 在 `contracts/runtime-budget.ts:13`；这些可以配置，但不能替代上述字节边界。

可据代码手算的结论：

1. **F-066 当前样例不是最大值证明。**  
   当前测试自己写明八个 anchors 已被后续 prepare 拾取，最终无 anomaly section，见 `R/K3-35-T-by-hand.test.ts:146`。其算式是：

   ```text
   12,676 + (600 − 512) = 12,764
   16,384 − 12,764 = 3,620
   ```

   这只说明当前单项样例留有 3,620 bytes，不能证明 T600 的规格极值不可达，更不能证明所有公共输入都低于预算。

   公共 Plan taskId 仅检查非空，见 `plan-record-codecs.ts:352,373`；规格 `:1435` 也明说 512 是预留，不是上限。必需 anomaly 行在 `continuation-brief.ts:741` 原样放入 taskId。因此一个实际带入的 **16,385 个 ASCII 字节 taskId，仅标识自身就超过 16,384**。构造该公共链还必须核算前一轮完整 manifest 等约束；不能未经这一步就宣布样例已经成立，但现书也没有依据宣布“最大值在预算以下”。

2. **F-067 的单个 process item 不意味着小记录。**  
   原始 shell cwd 没有长度上限：shell schema `shell-tool.js:12`；`unknown-call-draft.ts:94,98` 原样保存；codec `:248` 允许任意字符串。proposal.cwd 的 512-byte 限制不适用于这个字段。

   一个不依赖超长实际目录的输入族是：

   ```text
   cwd = './'.repeat(n)
   原始 cwd UTF-8 大小 = 2n
   permission normalize 后 = '.'
   ```

   `permission-policy.js:9` 的规范化会去掉 `.` 和空段，没有长度限制。`n=80,000` 时原始字段就是 **160,000 bytes**：

   ```text
   160,000 − 158,720 = 1,280
   ```

   仅这个字段已超过创建预算，创建时会触发条目截取；不是“公共输入都远小于 B”。

   对近预算 proposal 前置，应固定短 IDs、clock 和所有公共步骤，把 cwd 以外的最终前置 JSON 字节数手算为 `C`，再选：

   ```text
   cwdBytes = 158,720 − 2,000 − C
   前置大小 = 156,720
   ```

   ASCII 的 `./` 重复及末尾 `.` 可以逐字节调节，且规范化仍是根目录。之后 2,000 个“理”至少增加 **6,000 UTF-8 bytes**，存在真正跨 B 的公开输入方向；短理由重试则另按完整 successor 算。**书中还没有冻结这个 C、公共步骤和完整 successor 算式，不能把它当已经完成的 exact fixture。**

3. **K3-48-3 可以沿同一输入方向到达近创建门槛；“绝对上限最坏极值”仍可由纯测试承担。**  
   当前 `W/K3-48-3:55` 的一条短命令，加 2,000 个“核”的 hold text，只证明该小记录的必需写成功；不能称为“最大可达输入”。

4. **B/R 的现有算术不一致必须说明。**

   ```text
   524,288 − 365,536 = 158,752
   158,720 + 365,536 = 524,256
   剩余 = 32
   ```

   SPEC `:260,261` 和生产常量同时保留了这三个数。本轮可以继续按明确字面量 **B=158,720、上限=524,288** 测，不应擅改常量；但不能再把错误等式写成手算证据。

所以裁定 8 至少还缺“**固定预算、公共输入可达到或越过边界**”这一分支。F-066 的“指定 T600 组合是否可达”和 F-067 的“单项记录能否接近 B”也不是同一个问题，不能一起用“小样例成功”关闭。

**裁定 9：应恢复哪些值，哪些行风险较高。**

根 `vitest.config.ts:8` 的默认 test timeout 是 **30,000 ms**。D1 所列 18 个原来无显式 timeout 的测试，应恢复为这个默认值：

| 文件 | 当前 timeout 所在行 |
|---|---|
| `W/K3-15-hold-release` | 220 |
| `W/K3-16-approval-application` | 240、334、387 |
| `W/K3-16-proposal-round-fixture` | 119、135、166、218、246、270 |
| `W/K3-16-proposal-write` | 151、164、187、201 |
| `W/K3-18-autonomy-facts` | 154、169、191 |
| `W/K3-48-3-required-writes` | 109 |

另七项原值均为 **120,000 ms**：approval-application `:410,426,458,471`；proposal-write `:249`；review-card-queue `:494`；K3-48-2 `:403`。

静态风险较高的是：

- `proposal-round-fixture:166`：原始 unknown → review → 第一次 unfinished proposal → 第二次 unfinished proposal → settlement，多轮顺序推进。
- `approval-application:240,334,387`：前置不止造一条 review，还需真实 proposal round、结束／定稿、来源事实读取、答复及落实；`:334` 还做重放和读回。
- `proposal-round-fixture:135,246`：公共前置之后还要产生真实 unfinished terminal；若裁定 7 被错误解释为全部改成 Host abandon/reopen，成本和语义都会增加。
- 120 秒组中，`approval-application:410` 的 **7 轮**场景，以及 `proposal-write:249` 分别建立 over/exact **两个独立真实 world**，是需要重点测量的项。

不能从静态代码断言这些必然超过 30 秒或 120 秒。能确定的新增等待是：每次通过“取消仍 held 的工具”产生 unknown，会付出当前 **5 秒 drain**，此外还有真实 Host、SQLite、prepare、工具、答复和清理步骤。单轮 K3-18／K3-48-3 没有足够证据仅凭结构就判原 30 秒不足。

**rework 6 §2.8 已批准的 K3-35 beforeAll 60 秒不得误恢复成 10 秒。** 裁定 9 应限于 F-055 未授权提高的测试上限。超时后报告实测并 BLOCKED 的处置本身明确，不需要实现者猜一个新 timeout。

**其余与可达性有关的新裁定**

- **10**：相同时间可由 A8 固定 clock 真实形成；两个不同请求可以有不同 revision。新例应让按 revision 和按 ref 得到相反结果，才能保护新规则。
- **11**：R=0 仍需查空一页；1、200、201 分别是 1、1、2 页。这个公式可达且没有必要造存储事实。
- **13**：空 proposal.cwd 经公共 owner 已在 `:689` 被拒绝，因此仅补 owner 拒绝例不能使 codec 修复 RED。应直接用 A5 合法对象只改一个 cwd 字段测试 codec。
- **16**：公共保存答复 → 修改 Goal 内容 → 重试②可达；暂停／恢复只改 revision 而内容基准仍匹配的路径，应与真实内容改变区分。已落实后的同答复重放必须先命中回执。
- **18**：两个 CRR 单卡消费者每次只传一个 `blocked.kernelCallRef`，窗口起止只围绕一个 declared position；不能声称它们自然需要 65 页。真实 `readPositionWindow` 在 `session-operations.ts:989` 过滤并验证连续位置，正常返回的 `hasMore:true` 页会推进。cursor-stall 分支是对依赖违约的防御，书中还没有给它一个符合 v3 的实际测试入口。不能为了 RED 手造一个“ready 但不推进”的事实页。
- **21**：RUN-25 两后端路径存在：真实 git 工作树、memory records/bodies 工厂共享、真实 prepare/start、真实 probe/reconcile。mailbox 可以取 `H/K3-35-continuation-fixture.ts:659` 缓存的同一 platform；`send_session_message → yielded → 另一 Run respond_session_message → 接续` 的真实工具路径也存在。当前缺的是窄出口，不是第二套 mailbox。

**5. F-098–F-101 的 await／返回／异常／取消矩阵**

这里的“reject”区分两种：**返回拒绝结果**和 **Promise reject／同步 throw**。后两者在 await 边界通常由同一个 catch 接住。下面没有把“catch 到异常”解释成“肯定没有提交”。

**F-098：排序本身没有 await。**

| 边界 | 正常 resolve | 返回拒绝／非 ready | Promise reject／throw | abort |
|---|---|---|---|---|
| `readTaskBlockedCommands:1390 listReviews`，每页 | 收集真实记录，到终页后继续 | 现代码经 `mapRead` 返回失败，不生成正常 blocked lines | 现代码 `:1396` 返回 unavailable | 已返回 cancelled 必须保留；现 catch 本身不识别取消异常，排序修改不应冒充修好了这一点 |
| 同函数 `:1422 listRequests`，每页 | 完整读取后才选 newest、收集 forms | 返回失败，不把缺失请求当无请求 | `:1428` unavailable | 同上 |
| 纯 request 比较／选择 | 同时间按冻结的 ref 次序选取；不比较跨聚合 revision | 不适用 | 不应新增异常路径 | 不适用 |
| 若纳入 allowance：driver `:471 listTaskRequests` | 取得真实 requests 和同一次 closure | shell 不放行 | shell 不放行 | 不得通过失败退化为放行 |
| driver `:500 consumeAllowance` | 只有 committed 才继续真实 shell | 不放行 | 不放行；不能宣称 allowance 必未写入 | 若已提交，保留 used 事实；不得因取消重新发放 |

两个关键实施约束：

- 不能只把 `:1447` tie 改成 descending，仍用 `:1448 at(-1)`；这会在同时间选到 ref 较小者。
- `forAlias` 还在 `:1454` 决定 declared forms 展示顺序。newest 的排序不能无声改变声明顺序。

全部生产调用者及下游已在第 2 项 F-098 列出。

**F-099：新增路径是同步纯校验，没有 await，也没有 abort 语义。**

| 输入／结果 | 必需行为 |
|---|---|
| proposal.cwd 为 `null` | 继续既有校验 |
| UTF-8 长度 1–512 | 继续既有校验 |
| `''` | `proposalProblem` 返回拒绝原因；record/event decoder 返回 invalid |
| 非字符串或超过 512 | 保持既有拒绝 |
| 合法记录或事件 | 解码结果不变 |
| 存储验证遇到非法 proposal | 不把该记录／事件作为正常事实接受 |
| receipt replay 遇到非法事件 | 不返回伪造 committed/replayed；由现 replay helper 报事件不可解码 |

单错误测试应以一份其余字段合法的 codec 输入为基础，只有 proposal.cwd 为空。不能同时留下错误 ref、revision、proof 等，亦不能用已有 owner 校验代替 codec 检查。两个 decoder 共用同一个 body validator；原合法读写路径不应增加异步操作。

全部 decoder、registration、replay、事实读取调用者已在第 2 项列全。

**F-100：新增 guard 必须放在回执重放之后，并从已保存答复取基准。**

| await 边界 | 正常 resolve | 返回拒绝／非 ready | Promise reject／throw | abort |
|---|---|---|---|---|
| `:942 lookupCommit` | ready → 原回执重放；not_found → 首次落实路径 | 其他失败返回，不继续写 | unavailable | 不能把取消／异常当 not_found；已有提交的重放优先级保持 |
| `replayRequest → receipt-replay.ts:110 eventAt` | 验证事件、identity/fingerprint 后返回原提交 | 失败则不能重新落实 | 现 helper 返回 unavailable | 不重做已提交动作 |
| **新增 saved-answer read** | 取得真正的 synthetic responded answer，验证来源和 selection，使用 captured goal basis | not_found／形状非法／来源不符必须拒绝 | unavailable | cancelled；不得继续判定并提交 |
| `:951 loadRequest → :219 readMany` | 取得当前 request，检查 workspace、revision、pending | not_found／invalid／存储失败保持拒绝 | unavailable | 不把取消当“没有记录”或正常 pending |
| `:976 taskClosed` | open → 继续；closed → 现 CRR-06 路径 | 失败不当 open | unavailable | 与 F-076 一起保留 cancelled |
| `:979 persistClosed → commitRequest` | 真实写 closed 后返回 busy | 原失败 | 提交结果未知则 unavailable，不能声称无写入 | 提交前取消不写；提交后以 durable 结果为准 |
| `:985 readGoal` | active 且内容基准匹配 → 继续 | 暂停／非 active → busy；内容变更 → T02 revision_conflict | 不得逃出②使已保存答复“消失”；由 owner/adapter 按 F-072 映射 | 不能继续正常落实 |
| `:1019 commitRequest → :318 store.commit` | committed → 返回正式结果；replayed → 原事件重放 | revision conflict 等保持原失败 | unavailable／结果待确认；不自动再提交 | commit 前检查；commit 后不得把已发生的提交报告成未发生 |

还必须冻结：

- saved answer 对应 **本 CRR ref、该卡 revision、该 selection**；不能拿任意消息中的 goalBases。
- T02 比较的是 `goalDecisionBasisMatches` 的内容基础，不是简单“Goal revision 相等”。
- current Goal revision 仍加入最终提交 guards，防止检查后并发改变。
- 重放命中时，不重读当前 Goal，不因现在暂停或内容改变推翻已发生的落实。
- 失败之后，adapter/coordinator 保留①已保存答复，进入未落实状态；不能误记③成功。
- T02 reason 是否复用现有固定 reason 应明确，否则 Workflow `workflow.ts:2274` 的中文映射未必识别。

**F-101：一个直接 await，四类消费者必须区分。**

| `readPositionWindow`／循环结果 | 必需返回 |
|---|---|
| ready，完整覆盖请求窗口 | ready facts |
| 第 64 页恰好读完 | **ready**，不能仅凭“页数等于 64”拒绝 |
| 第 64 页后仍有未读部分 | unavailable，不返回部分 Map |
| cursor 不前进且窗口未读完 | unavailable |
| 空页／`hasMore:false`，但实际还未覆盖请求终点 | 不能仅信 `hasMore:false` 就宣布完整；须按冻结的窗口完成条件处理 |
| 返回 cancelled | cancelled，与 F-076 一致 |
| 返回其他拒绝 | 保持其约定失败语义；不变成 ready 空集合 |
| Promise reject／同步 throw | 普通读取异常 → unavailable；已识别取消 → cancelled |
| 读完前 signal aborted | cancelled；不将部分 facts 当完成结果 |
| 页上限／停滞失败 | 整次读失败，没有任何 owner 写入由这个 reader 自身发生 |

四类上层的必需结果：

- `buildBlockedCommands`：失败时不提交依赖原命令事实的处置；不能把未知全文当空命令。
- `decision-source-facts`：不能据部分事实保存一个已验证来源的答复。
- CRR card reader：不能显示一张伪完整卡。
- `reviewCommandFacts`：当前明确 best-effort。普通 unavailable 是否继续摘要 fallback，应在本条中保留或撤销；**cancelled 不能继续被 `:1255` 吞成空 Map**，否则 F-076 的端到端取消义务仍有洞。

另外，现 reader 的正常窗口约束使“cursor 不推进但 hasMore”的返回不可自然产生。F-101 需要指定符合 A1/A2 的验证入口，或把无法合法到达的分支验证明确报 BLOCKED；不能让实现者自己批准手造窗口例外。

**7. 冲突核对与必须修改的条款**

范围裁定没有一致应用于 M§2–§4：

- 十个 pre-K3 文件只按 B3 改行处理，与范围输入一致；F-093–096、指定八个 F-054 留 T，以及 F-090–092 入范围，可以保留。
- M§3 的 **31 文件、33 调用点**只扩调用点，和裁定 1 最后一项一致。
- 但是 **T-020–T-035** 包含三个 B3 确实改过的 K3 helper 的旧行：`K3-review-card-fixture.ts`、`K3-proposal-round.ts`、`K3-tool-seams.ts`。它们按第一句应在范围内，按第二个 bullet 又被全部排除。
- T-021 必须拆开：K3 helper 中的注入在范围内；`executed-files-stub.ts` 的旧实现不因这一条自动全文件入范围。
- T-040 的 `K3-mixed-seams.ts` 没有因“名字以 K3 开头”自动纳入；不能按同样方式擅自扩大。
- T-043 已被裁定 6 明确重新纳入，是合法显式例外。

与旧书／规格／规则表的关系：

| 对照 | 判断 |
|---|---|
| rework 6 的极值移纯、禁止 owner 造态 | 新书应继续遵守；裁定 8 不能恢复手造记录，也不能把“移纯”解释成所有可达服务拒绝义务都消失。 |
| rework 6 已批准 K3-35 hook timeout | 裁定 9 要明确保留。 |
| rework 7 “production done” | 本书明确新增 F-098–101，属于显式覆盖，不构成隐藏扩范围。 |
| rulings-v1 的 Accepted 6 | 裁定 3 已明确缩窄为 UR3 pre-entry pause；这项可以施工。 |
| v3 A5/D3 | 裁定 4 是直接导入纯出口的解释；不得扩大成允许构造 Runtime/port，也不需要为避开 import closure 改生产架构。 |
| v3 A7 | 允许通透执行不等于提供只读隔离、resource caps 或手造执行结果。裁定 6 的全仓替换文字越过 Scope。 |
| v3 A2 | 允许受控 abandonment；“objects dropped”与 harness 实际不符，需要纠正说明。 |
| v3 F11 | F-099 若只补 owner 空 cwd 拒绝例，修 codec 前也会过；不满足保护新检查。 |
| SPEC L18/L20 | 裁定 12 可以冻结文案，但现引用错误；13 非空 cwd 是新澄清，应准确限定字段。 |
| SPEC L19/L19a/T02 | F-100 方向正确，但当前书没有冻结所需 saved-answer 身份和基准来源。 |
| M§7 与裁定 6 | M 的 v2 处置禁止假 available；v3 A7 已批准一个例外。裁定 20 需要写清优先级。 |
| F-076 与 F-101 | incomplete→unavailable 不得覆盖 cancelled；reviewCommandFacts 的吞失败出口必须明确处理。 |
| coordinator-mode | 共享文件先行、生产一处规则可以遵守；但 F-098 的排序范围、F-100 guard 和裁定 8 的容量处置不能留给子 agent 决策。 |

建议把以下文字直接写入返工书后再冻结：

1. **替换裁定 1 的 T bullet：**

   > `T-001`…`T-091` 中，仅符合本条范围规则及明确旧 T 文件豁免的实例保留为 T。`T-020`、`T-022`、`T-023`…`T-035`，以及 `T-021` 在 `K3-review-card-fixture.ts` 内的注入，随相应 F-001/F-002/F-005 helper 整改纳入；`executed-files-stub.ts` 的旧实现仍为 T。T-043 按裁定 6 纳入。M§3 的 33 个调用点全部保留，scope 文件的 `nofile` 不撤销这项授权。

2. **修正裁定 2 的删除依据：**

   > D1:486 的 helper 删除在本书中明确批准；它配合 rework 6 §2.2 将手造极值移出 owner 场景的要求。旧书第 37 行没有单独点名删除该文件。

3. **扩写裁定 6：**

   > 本条替换范围限于本轮范围内的 sandbox mocks，以及 M§3/C-TOOLS 为完成真实工具包装所必需的调用适配；不扩大到 K-readonly-command 或 RL 测试全文。共享 helper 的默认与 read-only probe 均按 A7 返回可用／指定不可用；执行开关不得使普通 shell 仍不可用。helper 从真实子进程、快照和计时产生完整 ProcessExecutionResult，包含真实 handler 所需的 effects、timings、输出及退出信息；不得在 gate 层补造 ToolResult。保留真实 constructor/probe options 的 A3 观测。需要取消语义的执行不得由忽略 signal 的 spawnSync 冒充。

   > shell/read/mailbox gate 均接收并包装真实 definition；保持全部 metadata、schema、capabilities 和真实 handler 返回。未知结果行通过公共 cancel/stop/Run 截止或受控 Host abandonment 结束，不能等待一个越不过 held tool 的最终模型回复。cleanup 发生在恢复断言之后，并防止旧 handler 在清理时新增命令副作用。

4. **替换 §4 的 bubblewrap 括号：**

   > 通透 sandbox 不验证隔离。K3-12 的只读写入拒绝仍需真实只读 sandbox；实现者环境缺少 bubblewrap 时报告该行 BLOCKED 和实际错误，由 lead 在具备隔离的环境验收。不得构造拒绝结果使它通过。

5. **扩写裁定 7，并修正规则表 A2 的描述：**

   > `restart({ crash: true })` 保留旧 Host 待清理；只有旧实例已在指定真实边界保持停止推进时才代表本轮 crash。F-044 在 releaseHold durable commit 后、human requeue 前持有 commit wrapper；现有 commit observer 不是 gate。新 Host 复用同一 SQLite，gate 不影响新实例。正常关闭重启、Runtime 模型异常导致的 crashed，以及 Host abandonment 分别按各行原有行为执行，不互相替代。本轮不以 abandonment 证明旧进程已经消失。

6. **替换裁定 8：**

   > F-066 的 16,384-byte、F-067 的 158,720-byte 和 K3-48-3 的 524,288-byte 预算均为固定生产预算，不存在对应 Host/Runtime 调小入口。不得用纯 fit 参数或 token budget 代替。固定预算下，公开输入可到达边界的行仍通过公共步骤验证；只有给出所有相关字段和前置约束的有限上界，且该上界严格低于预算，才可采用纯极值＋服务最大值拆分。一个小样例或只有一个 process item 不构成上界证明。

   > F-067 保留 `B−2,000` 前置、长理由 capacity、公开读回不变、短理由接受及完整 proposal 读回。先固定公共 IDs、clock、原始 cwd 和所有步骤，手算完整前置及 successor；若不能完成，报告 BLOCKED，不改成远低于预算的成功。K3-48-3 沿合法公开近门槛前置验证必需写，绝对极值继续由原纯测试承担。F-066 必须区分实际未拾取 anchors 与历史已拾取 anchors；指定 T600 组合仍不能到达时，保留 BLOCKED，交 lead 另行冻结替代验收，不能由实现者判定删除服务拒绝义务。

   > 本轮沿用字面值 `B=158,720`、`R=365,536`、绝对上限 `524,288`，三者相加有 32-byte 余量；不声称 B 等于后二者之差，不自行修改生产常量。

7. **补充裁定 9：**

   > F-055 的 18 个新增测试 timeout 恢复为原默认 30,000 ms，七个提高的 timeout 恢复为 120,000 ms；rework 6 §2.8 已批准的 K3-35 setup hook timeout 保留。超限报告分步骤实测并 BLOCKED；不得改 Runtime drain、减少公共步骤或扩大 timeout 使该行通过。

8. **收紧裁定 10／F-098：**

   > newest 使用 `(createdAt 降序, requestRef 降序)` 的第一项；禁止仅修改 ascending comparator 的 tie 而仍取最后一项。earlier 集合保持 `candidate.createdAt < current.createdAt`，集合内部使用同一降序，最多五项。声明写法仍按既有声明顺序收集，allowance 仍按既有最早创建顺序选择；本条不改变这两类顺序，也不改变 review records 排序或同一 ref 的版本合并。列出并核对 context assembler 与 card summary 两个 request 时间选择点。

9. **修正裁定 12、限定裁定 13：**

   > 本裁定独立冻结自查缺省句 `没有自查依据` 和审批 label `同意`／`不同意`。既有规格 L18:432 规定选项 ID，L20:555 规定 approve 行为；lead 补入字面文案。

   > F-099 只补 proposal.cwd 的空串拒绝，与 owner 的 null 或 1..512 UTF-8 bytes 对齐，不扩大到原命令 summary.cwd。新增一个 A5 codec `rejects:` 单错误例，修改前必须因 codec 接受空串而失败；不能仅测 owner 的既有拒绝。裁定 14 的现有错误句保持不变。

10. **替换裁定 16／F-100：**

   > CRR `applyAnswer` 在回执查找／重放之后读取正式保存的 synthetic responded answer，核对其来源指向当前 CRR 卡及 revision、selection 与请求一致，并从该答复的 captured source 取得对应 Goal basis。复用 `goalDecisionBasisMatches` 比较当前 Goal 的控制内容；非 active 返回 busy，basis 缺失或内容改变返回 T02 revision_conflict，保持既有 T02 reason。当前 Goal revision 继续进入最终 commit guards。抽取共享 guard 时 UCR 调用同时归并，不复制规则。新增读取的拒绝、异常和取消沿 F-072/F-076 保留；①已保存答复不丢失，②失败不得记③成功，已提交的重放不重新检查当前 Goal。

11. **扩写裁定 18／F-101：**

   > `readKernelCommandFacts` 只有证明请求窗口读完才返回 ready。第 64 页恰好完成仍成功；仍有未读部分、cursor 停滞或提前结束则 unavailable，不返回部分 Map。cancelled 始终保持 cancelled。同步异常和 Promise rejection 不变成空事实。同步核对四类消费者：blocked-command 写入、CRR source facts、CRR card reader 均传播失败；review prepare 保留普通 unreadable 的既有摘要 fallback，但不得吞 cancelled。实现前列出页上限／停滞分支符合 v3 的测试入口；找不到时报告该验证 BLOCKED，不构造 ready 窗口或内部 owner 状态。

12. **补充裁定 20 的优先级：**

   > M§7 服从本书具体覆盖：sandbox 按裁定 6 和 v3 A7；容量按修订后的裁定 8；取消按 F-076，不能被裁定 18 的 unavailable 覆盖。其他 M§7 处置继续绑定，规格由 lead 更新。

**结论：需先修正以上条款；当前不能标为 buildable。**