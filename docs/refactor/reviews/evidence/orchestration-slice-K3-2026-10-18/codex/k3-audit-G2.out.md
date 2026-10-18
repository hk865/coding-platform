G2 只读审查完成：21 个目标文件、3,200 行全部读完；76 个测试声明，展开首个 `.each` 后为 82 个用例。未修改文件，未运行测试、构建或生产代码。**不能判定 G2 合规。**

下文测试文件的短名均指 `tests/runtime/`；helper 短名均指 `tests/helpers/`；`SPEC` 指 `docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md`。行号均为当前快照行号；LEDGER 中特别标注的“旧行”除外。

实例计数按 FINDINGS 的编号计算：同一 helper 的同一源位置只计一次，调用影响在 COVERAGE 中展开；T 项计入实例数。单后端、A1/A5 边界问题另列，不冒充 F12。ROWS 中“会失败”是静态判断，**不是实际做过删除检查的变异测试**。

## 1. COVERAGE

为避免把公共步骤和 helper 内部的问题混为一谈，先固定以下 helper 判定，覆盖表引用这些判定：

- **H-B**：`B2-blocked-runtime.ts:373` 的 `openB2BlockedWorld`、`:193` 的 `openB2HookWorld` 整体不能判 A1：继承 H-W/H-C 的 F1/F2/F3/F4/F6/F9，并在 `:268` 自造工作区读取结果；`:95` 的 `bindingOf` 自行生成准备阶段 binding，`:169` 先取消后续 Run，`:413`、`:424` 再直接调用 hook/tool，未形成真实运行中的模型调用链；`:235` 的提交故障注入属 A2，委托计数属 A3，`:340` 的答卡步骤属 A1，`:359`、`:364` 的公开读取属 A1，`:113` 的 ID 生成本身可用。
- **H-W**：`K3-review-card-fixture.ts:127` 的 `openK3ReviewCardWorld` 继承 `S5-decision-fixture.ts:131` 所调用初始化链的 F1/F3；默认 Kernel 读取 `:139`、工作区读取 `:162`、职责读取 `:245` 为 F4；`realKernelCommandFacts` 分支 `:150` 属 A1；`setK3TaskDisposition:329` 的公开 Plan 修改步骤属 A1，但世界前置仍受污染。
- **H-C**：`K3-blocked-command-fixture.ts:395`、`:520` 的世界/seed/answer 链包含 Host 读取覆写 `:146`（F2）、文件字典端口 `:416`（F4）、无真实能力失败的 `review_unavailable` `:367`（F6）、轮询 `:350`（F9）；真实 Kernel 事实委托 `:424` 属 A3，答卡 `:492` 属 A1；`sha256Of` 仅作输入摘要计算，不单独构成 F8。
- **H-P**：`K3-proposal-round.ts:255` 的 `createK3PendingReview` 继承世界前置；`claimK3ReviewRound:383` 含 Host 读取覆写 `:428`（F2）和轮询 `:356`（F9）；`reachK3AwaitingProposal:863` 含虚构失败原因 `:874`（F6）；`endK3RunCompleted:526` 的放行脚本模型并等待 Runtime 终态属 A1；答卡 `answerK3Disposition:654` 属 A1；`writeK3Proposal:712`/`writeK3Proposals:744` 使用真实工具/owner，但整条前置不能因此自动成为 A1。
- **H-S**：`K3-tool-seams.ts:79` 的 `shellSeam` 取消真实能力要求 `:85`，放行后返回自造成功结果 `:93`，判 F4；阻塞意图本身不能给整段替身豁免。
- **H-X**：`K3-prefix-claim.ts:59` 的 `createBlockedRecord` 继承 H-C；`requeueAfterRun:85` 的虚构根目录 `:94`、固定源摘要 `:96` 为 F4；后者已由裁决明确点名。
- **H-401**：`B2-401-world.ts:174` 的 `openB401World` 继承 H-W/H-C，另有文件字典 `:225`（F4）、轮询 `:157`（F9）；委托存储计数 `:194`、`:210` 属 A3；`B401_R:60` 是测试侧字面量 401，不是生产常量；`shellCall` 只是调用参数构造器。
- **H-M**：`B2-runtime-fixture.ts:69` 的 `createScriptedModel` 属 A1，`beforeReply` 故障可属 A2；`createB2RuntimeFixture:167` 含原始 matrix 提交 `:195`（F3）和 Session 覆写 `:197`（F2），该 helper 自身在 T 清单。
- **H-R**：`K3-35-continuation-fixture.ts:443` 的共享 continuation/Host 认定路径按规则表所点名的范围判 A1；同后端工厂 `:637`、同 body store 工厂 `:646` 判 A4；真实 source capture `:493` 判 A1；这些局部结论不豁免调用前的 S5 原始种子。`baseBrief:181`、`sha:119` 的调用本身是纯数据计算，但它们所在模块导入 Runtime、platform、store，见 OPEN QUESTIONS。
- **H-A**：`B2-crr-world.ts:50` 的唯一 ID 来源、`:253` 的 `crrCardOf` 公开卡读取可用；G2 所调用的这两个函数未发现独立 F 命中。`S5-decision-fixture.ts:126` 的时间常量 `T` 本身可用，不能把整个 S5 世界也判为允许。

以下每行列一个目标文件：

- `tests/runtime/B2-01-shell-hook.test.ts` | 5 个声明／11 个用例，`:45/:60/:73/:80/:85` | 全读 | F1/F2/F3/F4/F6/F9（helper），F11；仅 memory | helpers：`world`→H-B、`shellSeam`→H-S；`shell`、`WHERE`、`nextCall` 为参数/字面文本构造 | 最后测试：`B2-01: unparsed / all-irrelevant stored commands keep one whole-normalized action`（`:85`）。
- `tests/runtime/B2-02-approved-method.test.ts` | 1，`:42` | 全读 | F1/F2/F3/F4/F6/F9；仅 SQLite | helpers：H-W、H-P、H-B、H-S；`shell/nextCall` 为参数构造 | 最后测试：`B2-02: the approved method runs, the original and another blocked-action form are blocked`。
- `tests/runtime/B2-02-recognition-unified.test.ts` | 6，`:122/:162/:178/:192/:200/:208` | 全读 | F1/F2/F3/F4/F5/F6/F8/F9/F11；仅 memory | helpers：H-B、H-C、H-W、H-X、H-S；`countingReader:88` F4；`:213` 的 recognizer 计数委托 A3；故障分支 `:195` 为故障注入意图，仍须用真实依赖包装 | 最后测试：`B2-02: the hook calls the recognizer once per shell call and never repeats a package read inside one call`。
- `tests/runtime/B2-03-request-tool.test.ts` | 5，`:58/:72/:81/:104/:116` | 全读 | F1/F2/F3/F4/F6/F9（helper），F10；仅 memory | helpers：H-B、H-S；`toolWithoutPointRead:38` 的委托与拒绝读取属 A3/A2；`textOf:51` A5 | 最后测试：`B2-14: a declared unrecognised rewrite is appended to the pending request, no second card`。
- `tests/runtime/B2-04-allowance.test.ts` | 2，`:40/:71` | 全读 | F1/F2/F3/F4/F6/F7/F8/F9；仅 memory | helpers：H-B、H-S；`failNextCrrCommit` A2；`answer/listRequests` 的局部步骤 A1 | 最后测试：`B2-04: a failed consumeAllowance commit blocks the call and keeps the allowance allowed`。
- `tests/runtime/B2-05-06-denial.test.ts` | 2，`:56/:78` | 全读 | F1/F2/F3/F4/F6/F9；仅 memory | helpers：H-B、H-S；`laterRun:40` 不是 A1，`:73` 接受自造 Run 身份；`ask:48` 沿用该身份 | 最后测试：`B2-06: deny_final refuses every later form and Run, no card`。
- `tests/runtime/B2-09-allowance-crash.test.ts` | 2，`:40/:64` | 全读 | F1/F2/F3/F4/F6/F8/F9；前例 memory，后例 SQLite，均未覆盖双后端 | helpers：H-B、H-S；提交故障 A2；后例标题已限定 owner 部分，不能计作真实崩溃覆盖 | 最后测试：`B2-09b (owner part): the committed consume leaves the request used with usedBy, and the same command is blocked again`。
- `tests/runtime/B2-13-allow-one-form.test.ts` | 1，`:43` | 全读 | F1/F2/F3/F4/F6/F9（helper）；仅 memory | helpers：`allowedWorld:29`→H-B、H-S；`answer/listRequests` 局部 A1 | 最后测试：`B2-13: another form with the same parsed actions is still blocked while the card form is allowed`。
- `tests/runtime/B2-15-replay.test.ts` | 2，`:119/:164` | 全读 | F1/F2/F3/F4/F6/F9（helper），F10 | helpers：H-B、H-S、H-M 的 `createScriptedModel` A1；`kernelHarness:68` 真正调用 `runCodingAgent:97`，`resultOf:110` 读取其公开返回值 A1；WorkGraph 仅 memory，另开的 Kernel 为 SQLite | 最后测试：`a no-write request_command_rerun result replays through the Kernel with no second CRR write or receipt`。
- `tests/runtime/B2-16-hook-closure.test.ts` | 3，`:73/:89/:103` | 全读 | F1/F2/F3/F4/F6/F9（helper）；仅 memory | helpers：H-B、H-S；`countedWorld:48` 的 closure 委托 A3；H-W 的 `setK3TaskDisposition` 局部 A1；`:118` 直接调用 delivery owner 不能视为真实 shell 调用 | 最后测试：`B2-16 (vii): a closed Task still voids the delivery allowance (busy) after ONE closure read`。
- `tests/runtime/B2-16-hook-reads.test.ts` | 3，`:179/:191/:214` | 全读 | F1/F2/F3/F4/F6/F8/F9；另有自造空 binding；仅 SQLite | helpers：H-B、H-C、H-S、H-A 的 `T`；`countingWorld:91` 的存储包装 A3、closure 故障 A2、工作区端口 `:133` F4 | 最后测试：`B2-16 (iv): a closure read failure blocks with the fixed unconfirmed text, never continues`。
- `tests/runtime/B2-401-world.test.ts` | 2，`:50/:73` | 全读 | F1/F2/F3/F4/F6/F9（helper），F10/F11；仅 SQLite | helpers：H-401、H-S、H-B 的 `runHook`；`B401_R` 来源允许，物理页计数包装 A3 | 最后测试：`rework 2 item 4 / B2-18 request reads: R = 401 reads exactly three task pages for one request call`。
- `tests/runtime/K3-06-mixed-kinds-pure.test.ts` | 2，`:111/:157` | 全读 | clean，限纯函数证明 | helpers：本文件 `item:49/build:61/context:78/nextOf:87` A5；调用纯构造器与状态迁移 `:34`，无 owner/store 场景 | 最后测试：`K3-13 pure: item 1 keeps done/review_round, item 2 settles undetermined/settlement with the fixed sentence and reasons`。
- `tests/runtime/K3-12-review-round-tools.test.ts` | 2，`:228/:330` | 全读 | F4/F7；准备场景没有真实 memory/SQLite 后端 | helpers：`kernel/processItem/review/roleResolution/hostConfiguration/sessionOf/claimOf/recordOf` 的构造值被端口送入 Runtime，不能判 A5；`bodyStore:197` F4；`writeAttemptTool:318` F4 | 最后测试：`K3-12 maps a file-changing command to execution_failed and reports no workspace change`。
- `tests/runtime/K3-14-record-unknown-call-review-tool.test.ts` | 6，`:92/:110/:125/:133/:141/:223` | 全读 | **T：**F2/F3/F4/F8/F11 | helpers：`toolHandle:50` F4；`completeReview:173` F2/F4；`startedRuntime:198` F4并继承 H-M；参数构造不等于公开前置 | 最后测试：`K3-14 the driver never registers record_unknown_call_review on an ordinary Run`。
- `tests/runtime/K3-15-blocked-omission.test.ts` | 4，`:76/:96/:113/:131` | 全读 | 无已确认 F 号；A5 导入边界待裁决，不能标 clean | helpers：本地 `blockedEntries:41/padded:55/render:67/commandLines:71` 为纯调用；H-R 的 `baseBrief` 来源模块混有 Runtime/store | 最后测试：`drops the whole section first and leaves the other optional body at full length`。
- `tests/runtime/K3-15-blocked-sentence.test.ts` | 5，`:37/:58/:97/:121/:135` | 全读 | F11；另有 A5 导入边界待裁决 | helpers：本地 `review:20/render:32` A5；H-R 的 `baseBrief/sha` 为纯计算，但模块边界未判 clean | 最后测试：`no blocked commands means no section and byte-identical output`。
- `tests/runtime/K3-16-review-extremes-pure.test.ts` | 4，`:86/:115/:153/:174` | 全读 | 无已确认 F 号；`:23` 从 Runtime 装配模块导入纯函数，A5 边界待裁决，不能标 clean | helpers：本地 `processItem:37/platformItem:48/recordOf:63/utf8BytesOf:83` A5；codec、renderer、summary 为纯调用 | 最后测试：`K3-16: a 12,000-byte, 12-item/itemsOmitted-3 record round-trips byte-identically`。
- `tests/runtime/K3-19-review-admission-pure.test.ts` | 13，`:47/:51/:57/:65/:71/:77/:83/:89/:95/:101/:105/:111/:117` | 全读 | F8 | helpers：`admissible:35` 的纯构造形状 A5，但允许工具集来自被测生产常量 `:38`，不满足独立期望来源 | 最后测试：`refuses a Host layer 1 whose read-only command access is narrowed`。
- `tests/runtime/K3-19-review-admission.test.ts` | 2，`:61/:76` | 全读 | F1/F2/F3/F4/F6/F9（helper），F11；仅 memory，违反明确裁决 | helpers：H-W、H-P、H-S；`expectEntered:54` 读公开返回的 Run 可用 | 最后测试：`K3-19 L20: a real proposal-phase Run (public claim + production prepare/start) is admitted`。
- `tests/runtime/K3-26-unknown-call-review-pure.test.ts` | 4，`:71/:89/:140/:155` | 全读 | F8 | helpers：本地 `processItem:40/tooManyCallsRecord:53/listed512Item:117/undecodableListedRecord:123` A5；constructor/codec/card projection 纯调用；`:159` 用生产 key 函数生成期望不允许 | 最后测试：`K3-26: the pure card facts give it the aggregate object and the four L18 options`。

**UNREAD：无目标文件未读。** 未将 H 组其余未调用分支、其余测试组或整个仓库判为 clean。

## 2. FINDINGS by rule

以下“共享前置”指 COVERAGE 中列出的实际调用链。每项只给一个处置；“helper missing”表示现有 helper 还不能提供合规的完整入口，不代表已经证明公开路径不可达。

### F1：接受构造的事实

- **F1-01** | `S5-decision-fixture.ts:736` | 共享前置，影响 H-W 的所有 G2 调用者：把 `:707` 手组 manifest、`:719` envelope、`:725` inputBinding 交给 `authorizeRuntimeEntry` 并要求提交成功；实际初始化在 `:783` 必经此步骤 | **处置①：helper missing：**用公开 Host 建 Session、真实 claim、生产 prepare/start 和脚本模型建立该运行前置。
- **F1-02** | `B2-05-06-denial.test.ts:73`，测试 `B2-05: same Run asks again -> denied_in_this_run, no card; a new Run may ask again` | `laterRun:40` 只拼 RunRef 并改主体，随后 owner 接受并产生新请求，`:74` 断言成功；没有真实新 Run | **处置①：**使用 `openRealRunHarness`（`K3-35-continuation-fixture.ts:443`）的 `requeue:780 → claimRun:523 → prepareAndStart:536` 取得真实后续 Run，再让脚本模型请求重跑。

### F2：覆写读取结果、记录或 Session

- **F2-01** | `K3-blocked-command-fixture.ts:146` | 共享 blocked Run 前置：先读 Host 配置，再 spread 并强置 `shellWorkspaceAccess`；影响 H-C 调用者 | **处置①：helper missing：**从 Host 的公开配置入口设置授权，让 Runtime 原样读取配置。
- **F2-02** | `K3-proposal-round.ts:428`，赋值位置 `:431` | B2-02 approved-method、K3-19 两类轮次前置：包装 Host 读取结果，再补 `readonlyCommandAccess`；即使当前基础配置已提供该值，此覆写层也不是必要的公开步骤 | **处置①：helper missing：**通过真实 Host 配置提供只读命令授权，删除读取后的修补层。
- **F2-03** | `K3-14-record-unknown-call-review-tool.test.ts:195`，测试 `K3-14 the driver never registers record_unknown_call_review on an ordinary Run` | `completeReview` 把纯构造器返回记录的 revision 改成 3，再供 Runtime 端口返回 | **处置④：T**，依据 `.lead-ref/k3-b3-rulings-v1.md:11`。
- **F2-04** | `B2-runtime-fixture.ts:197`，调用者 `K3-14-record-unknown-call-review-tool.test.ts:202` | 直接把现有 Session 的 role 改成安装后的 pin | **处置④：T**，依据 `.lead-ref/k3-b3-rulings-v1.md:10`；不把该豁免传播给其他非 T 调用者。

### F3：代替 Host/Runtime 写入或直接写 store

这些位置不是“使用真实存储即可允许”；禁止点是写入事实的来源。

- **F3-01** | `task-claim-fixture.ts:233` | 共享世界初始化直接提交 Project、Workspace、治理快照与种子事件 | **处置①：helper missing：**通过公开安装/项目/工作区初始化入口创建根事实。
- **F3-02** | `task-claim-fixture.ts:324` | 共享世界初始化直接调用 Kernel store 创建 Session | **处置①：helper missing：**调用 Host 的公开 Session 创建流程。
- **F3-03** | `task-claim-fixture.ts:327` | 共享世界初始化自行提交 `recordSessionCreated`，承担 Host 的登记工作 | **处置①：helper missing：**由同一公开 Host Session 创建流程完成登记。
- **F3-04** | `S5-decision-fixture.ts:543` | 共享世界初始化直接 seed Project/Workspace 快照 | **处置①：helper missing：**公开根对象初始化。
- **F3-05** | `S5-decision-fixture.ts:568` | 共享世界初始化直接 seed 治理修订及 active 指针 | **处置①：helper missing：**公开治理安装与激活。
- **F3-06** | `S5-decision-fixture.ts:574` | 共享世界初始化直接提交手组的 Goal@6，再让后续公开 Plan 操作建立在它上面 | **处置①：helper missing：**公开 createGoal 与设置更新。
- **F3-07** | `S5-decision-fixture.ts:630` | `createS5Session` 直接向 Kernel store 创建 Session；H-W 初始化与后续 claim helper 均调用它 | **处置①：helper missing：**公开 Host Session 创建。
- **F3-08** | `S5-decision-fixture.ts:632` | `createS5Session` 自行写 `recordSessionCreated` | **处置①：helper missing：**让 Host 创建流程自行提交登记事实。
- **F3-09** | `S5-decision-fixture.ts:715` | 把手组 prepared manifest 写入 body store，随后被 F1-01 接受 | **处置①：**使用生产 prepare；可复用共享 harness 的 `prepareAndStart`（`K3-35-continuation-fixture.ts:536`），前置 bootstrap 须先修复。
- **F3-10** | `S5-decision-fixture.ts:739` | 自行调用 `beginRuntimeEntry`，Kernel run/turn ID 来自 `:733` 的构造值 | **处置①：**由共享 harness 的真实 Runtime `startRun` 完成进入。
- **F3-11** | `S5-decision-fixture.ts:742` | 自行写 entered，位置 3、history 起点 2 均在 `:744`、`:745` 手填 | **处置①：**由真实 Runtime 写 entered/history，使用 `prepareAndStart`（`K3-35-continuation-fixture.ts:536`）。
- **F3-12** | `S5-decision-fixture.ts:816` | 两份手组 candidate proposal 经 seedCommit 入库，连带手组事件和唯一 claim | **处置①：helper missing：**用公开 proposal owner 建立确实需要的候选；G2 的最小世界不应无条件携带无关候选。
- **F3-13** | `S5-decision-fixture.ts:869` | 初始化自行构造并写入消息/响应 body，再供原始 SessionMessage 记录引用 | **处置①：helper missing：**公开消息发送和答复入口。
- **F3-14** | `S5-decision-fixture.ts:881` | 直接 seed pending DecisionMessage 及 Sent 事件 | **处置①：helper missing：**公开决策消息发送入口。
- **F3-15** | `S5-decision-fixture.ts:892` | 直接 seed 第二份 pending DecisionMessage 及 Sent 事件 | **处置①：helper missing：**公开决策消息发送入口。
- **F3-16** | `S5-decision-fixture.ts:906` | 直接 seed responded 消息和 Responded 事件，响应内容由 `:896` 构造 | **处置①：helper missing：**公开 `answerDecision` 路径。
- **F3-17** | `B2-runtime-fixture.ts:195`，调用者 `K3-14-record-unknown-call-review-tool.test.ts:202` | 原始提交 CoordinationPolicy 与 active 指针 | **处置④：T**，依据 `.lead-ref/k3-b3-rulings-v1.md:10`。

### F4：端口返回构造结果

- **F4-01** | `K3-tool-seams.ts:93` | H-S 所有调用者：替换整个 shell，放行后返回固定成功和 `sideEffect:'none'`，没有调用真实 shell 后原样返回 | **处置①：helper missing：**在真实 shell/解释器依赖上设 A3 gate；故障时由真实调用的取消或崩溃生成结果。
- **F4-02** | `B2-blocked-runtime.ts:268` | H-B 所有调用者：根据内存 `files` 字典构造 `WorkspaceFile`，包括 digest、版本、时间 | **处置①：helper missing：**把公开文件内容写进世界临时目录，委托真实 `WorkspaceToolsPort.readWorkspace`，仅外包计数。
- **F4-03** | `K3-blocked-command-fixture.ts:416` | ② disposition 前置：文件字典被包装成成功的工作区读取事实 | **处置①：helper missing：**同一真实工作树上的文件写入和生产工作区读口。
- **F4-04** | `B2-401-world.ts:225` | 两个 401 行：固定 FILES 字典生成工作区读取结果 | **处置①：helper missing：**401 世界使用真实磁盘文件与委托读口。
- **F4-05** | `K3-prefix-claim.ts:96`，调用者 `B2-02-recognition-unified.test.ts:133` | 创建时间优先测试的 requeue 依赖返回固定 `'a'.repeat(64)`；裁决已明确为 F4 | **处置①：**改走 `openRealRunHarness.requeue`（`K3-35-continuation-fixture.ts:780`），其真实 capture 接线在 `:493`。
- **F4-06** | `K3-prefix-claim.ts:94`，同一测试 | requeue 的 workspaceHost 返回固定 `/tmp/k3-prefix-fixture`，不是该世界真实根目录 | **处置①：**使用同一 `openRealRunHarness.requeue`（`K3-35-continuation-fixture.ts:780`）。
- **F4-07** | `K3-review-card-fixture.ts:139` | 默认世界的 Kernel-command 端口从测试 Map 拼事实；`B2-02-recognition-unified.test.ts:76/:127`、`K3-19-review-admission.test.ts:48` 使用默认配置 | **处置①：**使用已有 `realKernelCommandFacts:true` 分支（`K3-review-card-fixture.ts:150`）。
- **F4-08** | `K3-review-card-fixture.ts:164` | 默认工作区读口无条件返回自造 `not_found`，没有真实依赖，也不是围绕真实读取的故障包装 | **处置①：helper missing：**接真实工作区读口；需要不存在文件时，保持磁盘上确实不存在该文件。
- **F4-09** | `K3-review-card-fixture.ts:247` | 答卡相关 mailbox owner 收到手组 duties/readOnlyCopy/independentReview/guards | **处置①：helper missing：**使用 Host 的真实职责读取接线。
- **F4-10** | `B2-02-recognition-unified.test.ts:103`，测试 `a package.json read failure…` 与 `the hook calls the recognizer once…` | `countingReader` 的非故障分支生成成功读取事实；名称“counting”没有改变其非委托性质 | **处置①：helper missing：**包装真实文件读口；一次抛错留作 A2，其余调用原样委托。
- **F4-11** | `B2-16-hook-reads.test.ts:133`，三个 hook-read 测试的 `countingWorld` | 本地再次实现字典工作区读口 | **处置①：helper missing：**真实磁盘读口加 A3 计数包装。
- **F4-12** | `K3-12-review-round-tools.test.ts:206`，测试 `K3-12 prepares…` | `bodyStore:197` 是 Map 实现的替身，自己生成成功 put/read 回执；不是 A4 所允许的同一个真实 backend 工厂 | **处置①：**在共享真实世界中 prepare，复用其真实 body store，入口为 `openRealRunHarness`（`K3-35-continuation-fixture.ts:443`）。
- **F4-13** | `K3-12-review-round-tools.test.ts:233`，测试 `K3-12 prepares…` | executions 端口返回手组 ROUND_RECORD/ORIGIN_RECORD | **处置①：**用真实 review claim，入口 `claimK3ReviewRound`（`K3-proposal-round.ts:383`），并先修复 H-P 的前置问题。
- **F4-14** | `K3-12-review-round-tools.test.ts:235`，同一测试 | roles 端口返回手组 resolution 和空 guards | **处置①：helper missing：**经公开安装/激活 Role，再由真实 resolver 读取。
- **F4-15** | `K3-12-review-round-tools.test.ts:237`，同一测试 | Host 端口返回 `hostConfiguration()` 构造结果 | **处置①：helper missing：**通过真实 Host 配置表达该工具授权，再真实 prepare。
- **F4-16** | `K3-12-review-round-tools.test.ts:238`，同一测试 | review 端口返回包含三个构造条目的 `review()` | **处置①：**保留可达的一条 process 记录，使用 `createK3PendingReview`（`K3-proposal-round.ts:255`）及真实 prepare；此行工具集证明不需要三条构造记录。
- **F4-17** | `K3-12-review-round-tools.test.ts:239`，同一测试 | Kernel store locator 固定返回 null，未使用真实世界的 Kernel store | **处置①：**使用共享 harness 的真实 Kernel registry（`K3-35-continuation-fixture.ts:443`）。
- **F4-18** | `K3-12-review-round-tools.test.ts:292`，测试 `K3-12 maps a file-changing command…` | sandbox probe 返回手组 available profile | **处置①：helper missing：**真实只读 sandbox probe 和真实工作区。
- **F4-19** | `K3-12-review-round-tools.test.ts:299`，同一测试；构造结果在 `:334` | execute 返回预先写好的 exitCode 1、只读文件系统错误和空 effects，没有执行命令 | **处置①：helper missing：**在真实只读 sandbox 运行 `echo written > out.txt`，从真实结果验证映射。
- **F4-20** | `K3-12-review-round-tools.test.ts:324`，同一测试 | 当前授权端口无条件返回构造的 wholeWorkspaceRead grant | **处置①：helper missing：**使用真实 Host 当前授权读口。
- **F4-21** | `K3-14-record-unknown-call-review-tool.test.ts:67`，测试 `the tool binds the review ref…` | owner 替身固定返回 committed/revision/cursor | **处置④：T**。
- **F4-22** | `K3-14-record-unknown-call-review-tool.test.ts:111`，测试 `the tool surfaces the owner receipt…` | 手组 replayed receipt，而不是重复真实调用得到回执 | **处置④：T**。
- **F4-23** | `K3-14-record-unknown-call-review-tool.test.ts:117`，同一测试 | 手组 idempotency_conflict，而不是同身份改内容触发真实 owner | **处置④：T**。
- **F4-24** | `K3-14-record-unknown-call-review-tool.test.ts:126`，测试 `a non-process alias…` | owner 无条件返回“不是 process”错误 | **处置④：T**。
- **F4-25** | `K3-14-record-unknown-call-review-tool.test.ts:146`，测试 `the review round input channel supplies only control inputs` | input supply 返回构造的 ControlIntent 输入；没有真实控制 owner 前置 | **处置④：T**。
- **F4-26** | `K3-14-record-unknown-call-review-tool.test.ts:212`，测试 `the driver never registers…` 的依赖配置 | readReview 配置成返回手组 review；该行本身不证明此端口被调用 | **处置④：T**。
- **F4-27** | `K3-14-record-unknown-call-review-tool.test.ts:213`，同一测试 | listReviews 返回固定空页，给普通 Run 的 prepare 制造“没有记录”事实 | **处置④：T**。
- **F4-28** | `K3-14-record-unknown-call-review-tool.test.ts:216`，同一测试的依赖配置 | recordConclusion 配置成返回手组 committed 回执；`:230` 期望它不被调用，不能据此把替身认作真实 owner | **处置④：T**。

### F5：没有真实原因地重发触发

- **F5-01** | `B2-02-recognition-unified.test.ts:228`，测试 `the hook calls the recognizer once per shell call…` | 再次把同一 `call` 直接送进 hook，并期望 recognizer 次数变成 2；没有第二次真实调用，也没走 Kernel 回放 | **处置①：helper missing：**用脚本模型发出第二个不同 callId 的真实 shell 调用，逐调用清零/核对计数；回放留给真实 Kernel replay 行。

### F6：虚构失败原因后写 owner

- **F6-01** | `K3-blocked-command-fixture.ts:367` | H-C 的 blocked record 前置直接提交 `cause:'review_unavailable'`，没有先关闭 Host 能力或制造实际 probe 失败 | **处置①：helper missing：**真实收窄 Host 授权，再由 Workflow 的 UR2 推进到 `settle_review`。
- **F6-02** | `B2-02-approved-method.test.ts:51`，测试 `the approved method runs…` | 直接把 pending review 定稿成 review_unavailable，以制造第一张卡 | **处置①：helper missing：**通过真实 Host 能力不可用及 Workflow advance 产生卡，再走现有 `answerK3Disposition`（`K3-proposal-round.ts:654`）。
- **F6-03** | `K3-proposal-round.ts:874`，调用者 `K3-19-review-admission.test.ts:80` | `reachK3AwaitingProposal` 同样无实际故障直接写 review_unavailable | **处置①：helper missing：**真实 Host 能力不可用→Workflow UR2→答 safer_method→恢复公开配置→领取 proposal。

### F7：从存储事实作断言

- **F7-01** | `B2-04-allowance.test.ts:58`，测试 `allow_rerun lets exactly the card form run once…` | `usedEvent` 来自 `B2-blocked-runtime.ts:248` 对 commit 输入 event JSON 的捕获，不是公开读取；`:59` 用它断言业务事实 | **处置①：**使用已有公开 `listRequests`（`B2-blocked-runtime.ts:364`）断言 state/revision/usedBy；本测试 `:54` 已有相同业务事实的公开证据。
- **F7-02** | `K3-12-review-round-tools.test.ts:249`，测试 `K3-12 prepares…` | 经 body store 重新加载 manifest，再在 `:252/:253/:261/:262` 断言；不是公开运行观察 | **处置①：helper missing：**真实 prepare/start 后从返回 envelope 和脚本模型收到的实际工具清单、输入验证；`:258/:259` 的 envelope 断言可保留在真实路径上。

### F8：期望依赖生产定义

- **F8-01** | `B2-02-recognition-unified.test.ts:203`，测试 `a missing recognizer…` | 期望 reason 引用生产 `SHELL_BLOCKED_UNCONFIRMED_TEXT` | **处置①：helper missing：**在真实调用路径的缺失接线故障行中使用规格固定文字字面量。
- **F8-02** | `B2-04-allowance.test.ts:80`，测试 `a failed consumeAllowance commit…` | 期望来自生产 `SHELL_ALLOWANCE_UNCONFIRMED_TEXT` | **处置①：**保留 `failNextCrrCommit`（`B2-blocked-runtime.ts:358`）故障入口，期望改为 SPEC:531 的字面量“暂时确认不了允许，稍后再试”。
- **F8-03** | `B2-09-allowance-crash.test.ts:53`，测试 `B2-09a…` | 同一生产允许确认失败常量 | **处置①：**同上，使用公开调用加 SPEC:531 字面量。
- **F8-04** | `B2-16-hook-reads.test.ts:218`，测试 `a closure read failure…` | 期望 reason 引用生产常量 | **处置①：helper missing：**真实 closure 依赖的 A2 包装加规格固定文字。
- **F8-05** | `K3-14-record-unknown-call-review-tool.test.ts:229`，测试 `the driver never registers…` | “不得出现”的工具名称来自生产导出常量；导出名称改变时测试会随之改变 | **处置④：T**。
- **F8-06** | `K3-19-review-admission-pure.test.ts:38`，测试 `admits a review-phase…`、`admits a proposal-phase…`，并作为后续行基础 | 被断言为合法的完整工具集取自被测函数也使用的两个生产常量，合法集合没有独立固定 | **处置②：**在现有 `K3-19-review-admission-pure.test.ts` 的纯函数 `reviewRoundAdmissionProblem` 测试中使用 SPEC:367、SPEC:548 的字面工具集。
- **F8-07** | `K3-19-review-admission-pure.test.ts:67`，测试 `refuses a review-phase purpose with a proposal-phase manifest` | 错配集合来自生产 proposal 常量 | **处置②：**留在该纯测试文件，固定 proposal 集合字面量。
- **F8-08** | `K3-19-review-admission-pure.test.ts:73`，测试 `refuses a proposal-phase purpose with a review-phase manifest…` | 错配集合来自生产 review 常量 | **处置②：**留在该纯测试文件，固定 review 集合字面量。
- **F8-09** | `K3-19-review-admission-pure.test.ts:91`，测试 `refuses a review-purpose manifest with one extra tool` | “正确集合＋shell”中的正确集合跟随生产常量 | **处置②：**留在该纯测试文件，固定完整 review 集合再加 `shell`。
- **F8-10** | `K3-19-review-admission-pure.test.ts:97`，测试 `refuses a proposal-purpose manifest with one extra tool` | 同上，proposal 集合跟随生产 | **处置②：**留在该纯测试文件，固定完整 proposal 集合再加 `shell`。
- **F8-11** | `K3-26-unknown-call-review-pure.test.ts:159`，测试 `the pure card facts give it the aggregate object…` | 期望 key 再调用一次生产 `decisionSourceKey`；被测 card 同样在 `src/core/work-graph/tasks/unknown-call-review-card.ts:159` 调用它 | **处置②：**留在 `K3-26-unknown-call-review-pure.test.ts`，测 `unknownCallReviewCardFacts`，用固定自然身份手算的规范化 key 字面量。

### F9：计时等待

- **F9-01** | `K3-blocked-command-fixture.ts:350` | H-C seed 用 5 ms sleep 轮询工具进入 | **处置①：helper missing：**包装真实工具并暴露“已进入”A3 gate。
- **F9-02** | `K3-proposal-round.ts:356` | B2 approved-method、K3-19 的轮次 helper 用 10 ms sleep 轮询 entered | **处置①：helper missing：**包装真实 entry 提交，提交成功后通知 gate，保持真实结果不变。
- **F9-03** | `B2-401-world.ts:157` | 401 个运行及 startNext 使用 5 ms sleep 等 entered | **处置①：helper missing：**复用同一个真实 entry 提交 gate。

### F10：计数位置不覆盖声明的公开操作

- **F10-01** | `B2-03-request-tool.test.ts:69`，测试 `a blocked command becomes requested and writes one CRR` | 注释把它关联到 B2-18，但数的是 review 列表调用；计数源为 `B2-blocked-runtime.ts:280`，不是 CRR 的按任务物理分页 | **处置①：helper missing：**完整真实 `request_command_rerun` 调用外，使用 `B2-401-world.ts:210` 这种委托 records.lookup 包装记录 `k3-crr-by-task` 页和 CRR commit。
- **F10-02** | `B2-15-replay.test.ts:161`，测试 `a shell call blocked through an expansion replays…` | `listCalls` 只在 `B2-blocked-runtime.ts:309` 的 `listRequests` 递增；实际 hook 调用的是 `src/core/agent-runtime/execution-driver.ts:471` 的 `listTaskRequests`，而 helper `:312` 不计数 | **处置①：helper missing：**对真实 hook 使用的 `listTaskRequests` 或底层公开 lookup 作委托计数，再核对 replay 零新增读取。
- **F10-03** | `B2-401-world.test.ts:81`，测试 `B2-18 request reads…` | 直接调用 requestService owner，计数窗口没有包含 `request_command_rerun` 工具适配层；SPEC:1500 限的是工具每次调用 | **处置①：helper missing：**让 startNext 的脚本模型调用真实请求工具，整个工具调用共用现有物理页/commit 计数器。

### F11：断言不能区分标题声称的检查

- **F11-01** | `B2-01-shell-hook.test.ts:85`，测试 `unparsed / all-irrelevant stored commands keep one whole-normalized action` | 使用默认正常命令；只断 blockedCommands 长度 1、actions 长度大于 0；移除 `src/core/work-graph/tasks/unknown-call-review-service.ts:229` 的 unparsed/空动作 fallback，正常输入仍走 `:234` | **处置①：**使用 `openB2BlockedWorld`（`B2-blocked-runtime.ts:373`）分别传公开的 unparsed 命令及全无关命令，断公开记录中唯一 action 的完整规范化字面量。
- **F11-02** | `B2-02-recognition-unified.test.ts:122`，测试 `an earlier record’s action hit wins over a later record’s exact hit` | 两次 seed 使用同一固定 T，且 Run ID `aaaaaaaa-0000…`、`aaaaaaaa-1111…` 顺序恰好相同（`:130/:135`）；它没有进入创建时间不同的排序分支，删去 `src/core/work-graph/tasks/command-recognition.ts:50` 的时间比较不影响本例 | **处置①：helper missing：**用共享世界可控时钟产生两个不同创建时间，并让 Run ID 字典序与时间顺序相反。
- **F11-03** | `K3-14-record-unknown-call-review-tool.test.ts:125`，测试 `a non-process alias is invalid_arguments and writes nothing` | 替身 `:126` 无条件返回 invalid；真实类型检查 `src/core/work-graph/state/unknown-call-review.ts:301` 根本没运行；`:130` 还断 owner 写方法被调用一次，不能证明存储不变 | **处置④：T**。
- **F11-04** | `K3-15-blocked-sentence.test.ts:141`，测试 `no blocked commands means no section and byte-identical output` | 把同一当前 renderer 对等价输入的输出互相比；基础无块文本任意改变，两边仍一起改变 | **处置②：**移到 `K3-15-blocked-sentence-pure.test.ts` 测 `renderContinuationBriefZh`，对固定手算完整旧文本作逐字节字面量比较。
- **F11-05** | `B2-401-world.test.ts:50`，测试 `R = 401 reads exactly three pages…` | `:58` 是创建时累计数，`:62/:65` 是页数/游标数，没有检查读回的请求集合；即使删除 `src/core/work-graph/tasks/command-rerun-request-service.ts:507` 的 `items.push`，仍可读三页并按 review 的原命令拦截，不能证明“不重不漏” | **处置①：helper missing：**在同一公开操作的 A3 委托包装中观察真实返回集合，断 401 个真实 requestId 恰好各一次，并让最后一页的一项影响公开结果。
- **F11-06** | `K3-19-review-admission.test.ts:61`，测试 `a real review-phase Run…is admitted` | 只验证允许的 review Run；删除 `src/core/agent-runtime/execution-driver.ts:839` 的准入拒绝检查仍可通过，不能覆盖 SPEC:1433 的 Host 关开关、零模型调用及定稿 | **处置①：helper missing：**真实 pending_review 前置后收窄 Host 授权，走 Workflow advance，断零模型调用和公开 review_unavailable 结果。
- **F11-07** | `K3-19-review-admission.test.ts:76`，测试 `a real proposal-phase Run…is admitted` | 同样只验证允许的 proposal Run；没有验证开关在 safer_method 后关闭的拒绝路径 | **处置①：helper missing：**答 safer_method 后真实关闭 Host 能力，再推进，断零模型调用及 `review_unavailable, proposal_missing`。

### F12

本组适用 D1 条目中，**未确认未经任务书允许的 F12**。K3-19 旧的非法组合场景删除有返工 8 第 5 项授权；这不等于新文件已经完整覆盖 K3-19，见 F11-06/F11-07。

### 默认拒绝与双后端：不能遗漏，也不硬塞 F 编号

- `B2-blocked-runtime.ts:325` | 所有 H-B hook 行使用 `bindingOf(record)` 自建准备值；`:169` 已把后续 Run 取消，`:413/:424` 再直接驱动 hook/tool；不符合 A1 的真实运行步骤 | **处置①：helper missing：**真实 prepare/start 后由脚本模型调用工具，binding 由生产 prepare 生成。
- `B2-02-recognition-unified.test.ts:149` | 排序行把两份记录自行拼成 binding | **处置①：helper missing：**真实后续 Run 的 prepare 收集两份记录并生成 binding。
- `B2-16-hook-reads.test.ts:196` | “没有被拦命令”行仍用有 blocked record 的世界，仅把 binding 改为空 | **处置①：helper missing：**建立实际无 blockedCommands 的任务，真实 prepare/start 后测零额外读。
- `B2-05-06-denial.test.ts:92` | deny_final 行也使用 `laterRun` 自造身份；该拒绝不能证明真实后续 Run 的行为 | **处置①：**真实 requeue/claim/start，入口同 F1-02。
- `B2-16-hook-closure.test.ts:118` | 直接制造 delivery 调用并调用 `consumeAllowance`；没有真实 shell/Kernel 原因 | **处置①：helper missing：**通过真实后续调用触发 delivery。
- `B2-01-shell-hook.test.ts:34` | 全文件仅 memory | **处置①：**H-B 修复后参数化 memory/SQLite。
- `B2-02-approved-method.test.ts:43` | 仅 SQLite，无 Host 重启例外 | **处置①：**H-W/H-P 修复后参数化双后端。
- `B2-02-recognition-unified.test.ts:76`、`:127` | 六行均仅 memory | **处置①：**两处世界入口参数化双后端。
- `B2-03-request-tool.test.ts:26` | 五行仅 memory | **处置①：**世界入口参数化双后端。
- `B2-04-allowance.test.ts:29` | 两行仅 memory | **处置①：**世界入口参数化双后端。
- `B2-05-06-denial.test.ts:30` | 两行仅 memory | **处置①：**世界入口参数化双后端。
- `B2-09-allowance-crash.test.ts:41` | 第一行仅 memory | **处置①：**参数化双后端。
- `B2-09-allowance-crash.test.ts:65` | 第二行仅 SQLite，但此处不是重启测试 | **处置①：**参数化双后端。
- `B2-13-allow-one-form.test.ts:30` | 仅 memory | **处置①：**参数化双后端。
- `B2-15-replay.test.ts:121`、`:165` | WorkGraph 世界均仅 memory；独立 Kernel SQLite 不是第二种 WorkGraph 后端 | **处置①：**两个真实平台场景均参数化双后端。
- `B2-16-hook-closure.test.ts:50` | 三行仅 memory | **处置①：**参数化双后端。
- `B2-16-hook-reads.test.ts:63` | 三行仅 SQLite，注释理由不能替代重启例外 | **处置①：**参数化双后端。
- `B2-401-world.ts:177`，调用者 `B2-401-world.test.ts:43` | helper 固定 SQLite，两个服务层行均缺 memory | **处置①：helper missing：**给同一 401 世界入口增加 backend 公共选项。
- `K3-12-review-round-tools.test.ts:230` | 准备行只有端口替身，没有任何真实后端 | **处置①：**用真实世界覆盖 memory/SQLite。
- `K3-19-review-admission.test.ts:48` | 两行仅 memory，直接违反 `.lead-ref/k3-b3-rulings-v1.md:38` | **处置①：**真实场景参数化 memory/SQLite。
- `K3-14-record-unknown-call-review-tool.test.ts:202` | Runtime 行默认 memory，其他行为行是替身 | **处置④：T**。

## 3. ROWS

记号：M＝memory，S＝SQLite，P＝纯函数，无 backend 要求。以下“敏感”只说明对应断言能否辨别所列生产逻辑；前置存在 FINDINGS 问题的行，即使敏感也不是合规通过。

### B2

- `B2-01-shell-hook.test.ts:46/:56` | B2-01，`npm run db:migrate → block`，命中动作及完整中文提示；来源 SPEC:1483、SPEC:500 | M | 敏感于 `command-recognition.ts:139` 的动作命中和 `execution-driver.ts:486` 的提示选择。
- `B2-01-shell-hook.test.ts:47/:56` | B2-01，`bash -c "cd app && npm run db:migrate" → block`；来源 SPEC:1483 | M | 敏感于 `command-recognition.ts:60` 的解析及 `:139` 的动作匹配。
- `B2-01-shell-hook.test.ts:48/:56` | B2-01，`FOO=1 npm run db:migrate 2>&1 | tee log → block`；来源 SPEC:1483 | M | 敏感于 `command-recognition.ts:60/:139`。
- `B2-01-shell-hook.test.ts:49/:56` | B2-01，`npx prisma migrate deploy → block`；来源 SPEC:1483 | M | 敏感于 `command-recognition.ts:119` 的已存展开匹配。
- `B2-01-shell-hook.test.ts:50/:56` | B2-01，`prisma migrate deploy → block`；来源 SPEC:1483 | M | 敏感于 `command-recognition.ts:119`。
- `B2-01-shell-hook.test.ts:51/:56` | B2-01，`./node_modules/.bin/prisma migrate deploy → block`；来源 SPEC:1483 | M | 敏感于解析后动作匹配 `command-recognition.ts:60/:119`。
- `B2-01-shell-hook.test.ts:52/:56` | B2-01，`npm run migrate:prod → block`；来源 SPEC:1483 | M | 敏感于当前脚本展开 `command-recognition.ts:73/:91`。
- `B2-01-shell-hook.test.ts:60/:64/:69` | B2-01，空白差异、不同 cwd 均 `block`；来源 SPEC:1483 | M | 敏感于整段规范化摘要匹配 `command-recognition.ts:53/:136`。
- `B2-01-shell-hook.test.ts:73/:76` | B2-01，`cd app`、`git status`、`echo 'npm run db:migrate' → continue`；来源 SPEC:1483 | M | 去掉 `execution-driver.ts:537` 的“无命中放行”会改变结果；不证明实际起 sandbox。
- `B2-01-shell-hook.test.ts:80/:82` | B2-01，附加 `-- --force → continue`；来源 SPEC:1483 | M | 敏感于 `command-recognition.ts:109` 的完整动作比较；不是子串比较。
- `B2-01-shell-hook.test.ts:85/:89` | B2-01 fallback，实际字面量只有 blocked 数 `1`、actions `>0` | M | **不敏感**于 `unknown-call-review-service.ts:229`，见 F11-01；未断唯一整段规范化 action。
- `B2-02-approved-method.test.ts:42/:85` | B2-02，批准命令 `continue`，原命令及其他包装 `block`；来源 SPEC:1484、SPEC:540 | S | 敏感于 `execution-driver.ts:515` 的 approved-method 放行。
- `B2-02-recognition-unified.test.ts:122/:156` | K8-6/B2-02，提示归于 early Run 的 alias 1；来源 SPEC:539 | M | **不敏感**于不同创建时间排序 `command-recognition.ts:50`；只命中平局分支 `:46`。
- `B2-02-recognition-unified.test.ts:162/:169/:174` | B2-12/B2-14，`requested`、declaredForms 含改写、随后 `block`；来源 SPEC:1494、SPEC:1496 | M | 敏感于 `command-recognition.ts:141` 的 declared 匹配。
- `B2-02-recognition-unified.test.ts:178/:185` | B2-11，文件读取失败后仍命中已存 `prisma migrate deploy`，并确认读过 package.json；来源 SPEC:1493 | M | 敏感于 `command-recognition.ts:86` 的读取故障降级；成功读端口仍为 F4。
- `B2-02-recognition-unified.test.ts:192/:196` | recognizer 抛错后 `continue`；与仅丢失识别能力的接线语义对应，SPEC:1493 | M | 敏感于 `execution-driver.ts:536`；不是 owner 拒绝输入行。
- `B2-02-recognition-unified.test.ts:200/:203` | 缺 recognizer 时 `block`；期望文字来自生产常量，不是独立字面量 | M | 敏感于 `execution-driver.ts:525`，文字断言受 F8-01 污染。
- `B2-02-recognition-unified.test.ts:208/:219/:229` | B2-16，recognizer 次数 `1→2`、每次文件读数 `≤2`且不重复；来源 SPEC:541 | M | 首次调用可辨别重复识别；第二次是 F5，不能作为真实第二次调用或回放证据；生产调用在 `execution-driver.ts:533`。
- `B2-03-request-tool.test.ts:58/:62/:67` | B2-03/B2-18，`requested`、固定请求文字、一个 pending CRR | M | 状态来源 SPEC:523、SPEC:1485；敏感于 `command-rerun-request-service.ts:900` 和 `command-rerun-tools.ts:107`；`:69` 不证明 CRR 页上界。
- `B2-03-request-tool.test.ts:72/:76/:78` | B2-03，第二次 `pending`、请求数仍 `1`；来源 SPEC:1485 | M | 敏感于 `command-rerun-request-service.ts:839`。
- `B2-03-request-tool.test.ts:81/:90/:99` | B2-03/B2-14，pending、allowed 文案含等待中的 A，不含本次 B；来源 SPEC:523、SPEC:524、SPEC:1496 | M | 敏感于 `command-rerun-tools.ts:111/:117` 的 waitingCommand 选择。
- `B2-03-request-tool.test.ts:104/:108/:111` | B2-03，`not_blocked`、固定未识别文案、记录数不变；来源 SPEC:520、SPEC:1485 | M | 敏感于 requestRerun 的无命中分支及 `command-rerun-tools.ts:127`。
- `B2-03-request-tool.test.ts:116/:124/:127` | B2-14，原请求 `pending`、仍一条请求、declaredForms 正好一条且文字为 `npm run db:migrate -- --force`；来源 SPEC:1496 | M | 敏感于 `command-rerun-request-service.ts:842` 的 append。
- `B2-04-allowance.test.ts:40/:48/:54` | B2-04/CRR-03，allowed@2→used@3，usedBy 是当前 runId/callId，后续拦截；版本手算为创建 1＋答复 1＋消费 1，状态来源 SPEC:531 | M | 敏感于 `execution-driver.ts:500/:509` 及 `command-rerun-request-service.ts:1115`；不证明“运行中的这一轮”，因为 helper 已取消 Run。
- `B2-04-allowance.test.ts:71/:80/:83` | B2-04/B2-09a，提交失败→block，仍 allowed@2、usedAt null；来源 SPEC:531 | M | 敏感于 `execution-driver.ts:509`；文字受 F8-02 污染。
- `B2-05-06-denial.test.ts:56/:68/:74` | B2-05，同 Run `denied_in_this_run`，新 Run `requested`、数量＋1；来源 SPEC:532、SPEC:1487 | M | 敏感于 `command-rerun-request-service.ts:864`；新 Run 前置为 F1。
- `B2-05-06-denial.test.ts:78/:89/:94` | B2-06，当前及所谓后续 Run 均 `denied_final`、数量不变；来源 SPEC:533、SPEC:1488 | M | 敏感于 `command-rerun-request-service.ts:853`；所谓后续 Run 没有公开生成。
- `B2-09-allowance-crash.test.ts:40/:55/:61` | B2-09a，失败后 allowed@2，重试后 used@3；来源 SPEC:1491及创建/答复/消费手算 | M | 敏感于 `execution-driver.ts:509`；未涉及真实进程崩溃。
- `B2-09-allowance-crash.test.ts:64/:80/:90` | B2-09b 的 owner 部分，used@3、usedBy、usedAt 非空，下一次 block | S | 敏感于 `command-rerun-request-service.ts:1115`；**不覆盖** SPEC:1491 的“提交后、命令开始前崩溃→outcome_unknown→核对”。
- `B2-13-allow-one-form.test.ts:43/:46/:52/:57` | B2-13，其他同动作写法 block，卡片原写法一次 continue，再次 block；来源 SPEC:1495 | M | 敏感于 `execution-driver.ts:493` 的 commandSha256 相等条件。
- `B2-15-replay.test.ts:119/:136/:156` | B2-15，第一次 `hook_blocked/retryable:false`，第二次结果对象和 JSON 相同，模型/读取数不增长；来源 SPEC:1497及裁决§3.1 | WorkGraph M＋独立 Kernel S | 真实 Kernel replay 的再次执行会增加 reviewReads，`:160`可识别；`:161` 的 CRR 读计数无效，见 F10-02；package.json 改动只改字典 `:149`。
- `B2-15-replay.test.ts:164/:180/:190` | B2-09/B2-15，无写请求结果 `not_blocked` 回放相同，CRR commit `0`、记录 `0`、无 cursor/replayed 字段；来源 SPEC:1289、SPEC:1491 | WorkGraph M＋独立 Kernel S | 能辨别再次模型调用及 CRR 写；这是 Kernel 返回状态证据，不是 store 断言。
- `B2-16-hook-closure.test.ts:73/:82` | B2-16(v)，消费整次 hook closure 恰好 `1`；来源 SPEC:541及该补充成本要求 | M | 敏感于 `execution-driver.ts:507` 传递已有 closure；若消费再次读取，计数变 2。
- `B2-16-hook-closure.test.ts:89/:96/:100` | B2-16(vi)，真实 Plan 关闭后 closure `1`且 block；来源 SPEC:537 | M | 敏感于 `command-rerun-request-service.ts:562` 的关闭投影和 `execution-driver.ts:493` 的 allowed 筛选。
- `B2-16-hook-closure.test.ts:103/:115/:123` | B2-16(vii)，closure `{closed:true}`，消费 `busy`，传入已有 closure 后新增读取 `0`；来源 SPEC:537 | M | 敏感于 `command-rerun-request-service.ts:1105`；入口是直接 owner delivery，不是完整 hook。
- `B2-16-hook-reads.test.ts:179/:184` | B2-16(i)，review read `1`、CRR page `{limit:200}` 一次、closure `1`、package `≤2`且唯一；来源 SPEC:541、SPEC:1498 | S | 对所注入整次 hook 的读取重复敏感；计数仍建立在 F4 文件读口上。
- `B2-16-hook-reads.test.ts:191/:209` | B2-16(ii)，`continue`、reads `[]`；来源 SPEC:1498 | S | 对 `execution-driver.ts:439` 空 binding 短路敏感；**不证明真实无 blockedCommands 任务的 prepare 接线**。
- `B2-16-hook-reads.test.ts:214/:218` | B2-16(iv)，closure 故障→block，closure 读 `1` | S | 敏感于 `execution-driver.ts:474`；固定文字受 F8-04 污染。
- `B2-401-world.test.ts:50/:58/:62` | B2-16(iii)，R=401、页数 `3`、limit `[200,200,200]`、closure `1`、package `≤2`；`ceil(401/200)=3`，来源 SPEC:1498 | S | 页数对分页停止条件敏感；**不敏感**于漏汇总返回 records，见 F11-05。
- `B2-401-world.test.ts:73/:90/:99` | B2-18，页数 `3`，其他两个索引 `0`，pointRead `[]`，CRR writes `1`；来源 SPEC:1500，页数手算同上 | S | 对 owner 内分页/commit 敏感，生产入口 `command-rerun-request-service.ts:740/:900`；不覆盖工具层额外读取。

### K3 纯状态与 Runtime

- `K3-06-mixed-kinds-pure.test.ts:111/:114` | K3-06 纯部分：aliases `[1,2,3]`、种类 `[platform,file_edit,process]`，仅 shell 为目标，最后 resolved/open=no/activeRound=null、finished 一轮；来源 SPEC:1413、SPEC:290及裁决§2 | P | 敏感于 `state/unknown-call-review.ts:806/:815` 目标选择及 `:446/:449` 定稿；不证明 owner 只领取一次。
- `K3-06-mixed-kinds-pure.test.ts:157/:183` | K3-13 纯部分：第一条保留 done/review_round，第二条 undetermined/settlement，固定“核对轮没有给出结论”，原因 `[undetermined,crash_undetermined]`；来源 SPEC:407、SPEC:1427 | P | 敏感于 `state/unknown-call-review.ts:666/:668` 及原因计算 `:686`。
- `K3-12-review-round-tools.test.ts:228/:252` | K3-12，固定 `[read,run_readonly_command,record_unknown_call_review]`、writeScope `[]`，无 shell/edit/write/send_message/ask_user；来源 SPEC:367、SPEC:1426 | 无真实 backend | 对 `execution-preparation.ts:403/:412` 的 review 专用分支敏感；F4/F7 使此行不能作为场景验收。
- `K3-12-review-round-tools.test.ts:330/:350` | K3-12，`execution_failed`、retryable `true`、exit 1 文字、空 changedPaths、sideEffect none；非零结果映射来源 SPEC:1426，具体 stderr 是本行自造输入 | 无真实 backend | 删除 `readonly-command-tool.ts:345` 的非零退出映射会失败；删除真实只读挂载限制不会使该替身行失败，不能据此证明磁盘没改。
- `K3-14-record-unknown-call-review-tool.test.ts:92/:101` | K3-14，绑定 reviewRef/work_run/requestId、read `0`、owner call `1`、committed；来源 SPEC:376、SPEC:378 | 替身，T | 对工具参数绑定 `unknown-call-review-tools.ts:177` 附近敏感；不测真实 owner 身份守卫。
- `K3-14-record-unknown-call-review-tool.test.ts:110/:115/:122` | K3-14，replayed true、idempotency_conflict；来源 SPEC:379 | 替身，T | 仅错误/回执映射敏感于 `unknown-call-review-tools.ts:205`；删除 owner replay 检查 `unknown-call-review-service.ts:564`不会失败。
- `K3-14-record-unknown-call-review-tool.test.ts:125/:129` | K3-14，非 process alias→invalid_arguments；来源 SPEC:377 | 替身，T | 不敏感于真实类型检查 `state/unknown-call-review.ts:301`，见 F11-03。
- `K3-14-record-unknown-call-review-tool.test.ts:133/:136` | K3-14，缺 crashSuspicion→invalid_arguments，reads/writes `[]`；来源 L14 入参形状 | 替身，T | 对 `unknown-call-review-tools.ts:151` 后参数解析敏感；不能据此豁免同文件替身。
- `K3-14-record-unknown-call-review-tool.test.ts:141/:150` | L13 输入隔离，返回 inputId `control:1`、委托一次；来源 SPEC:366 | 替身，T | 对 `execution-inputs.ts:226` 的委托敏感；没有实际 Session 信件，不能证明信件留待后续。
- `K3-14-record-unknown-call-review-tool.test.ts:223/:229` | L14 普通 Run 不注册 review 工具、ownerCalls `[]`；来源 SPEC:376 | M，T | 对 `execution-driver.ts:724` 的按用途注册分支敏感；工具名期望受 F8-05 污染。

### K3-15 渲染

- `K3-15-blocked-omission.test.ts:76/:87` | K3-15(二)/B3 omission，`16384`字节、16 命令行、无 count line、无省略注记；手算 `1504 + 3×41 + 4000+4000+3417 + 3340 = 16384`，依据本文件 `:77` 与任务书 `k3-g4b3-impl.md:245` | P，导入边界待裁决 | 敏感于 `continuation-brief.ts:416/:420` 先移 count line 的顺序。
- `K3-15-blocked-omission.test.ts:96/:106` | `16304`字节、15 行、恰好省略 1 行；手算 `13104+3132+68=16304`，本文件 `:97` | P，边界待裁决 | 敏感于 `continuation-brief.ts:412/:414` 把省略注记一同计入候选。
- `K3-15-blocked-omission.test.ts:113/:124` | `5809`字节、整节消失、省略 16 行；手算 `1504+4×(41+1018)+69=5809`，本文件 `:114` | P，边界待裁决 | 敏感于 `continuation-brief.ts:426/:434` 保留被删除命令行计数。
- `K3-15-blocked-omission.test.ts:131/:143` | `16273`字节、整节消失、其他正文仍完整；手算 `16204+69=16273`，本文件 `:132` | P，边界待裁决 | 敏感于 `continuation-brief.ts:400/:422` 先移整个被拦节、后缩正文。
- `K3-15-blocked-sentence.test.ts:37/:38/:43` | K3-15(二)，固定句“平台拦下原命令；要再跑先请求并得到允许。”含列表前缀共 `62` UTF-8 字节，置于“不在清单…”之后；来源任务书 `k3-g4b3-impl.md:134` | P，边界待裁决 | 敏感于 `continuation-brief.ts:934` 的非空条件。
- `K3-15-blocked-sentence.test.ts:58/:66` | alias 33 拒绝且错误含 alias；上限 32 来源 L7 | P，边界待裁决 | 敏感于 `continuation-brief.ts:1681`。
- `K3-15-blocked-sentence.test.ts:58/:70` | 大写 digest 拒绝且错误含 commandSha256；来源规范 SHA-256 形状 | P，边界待裁决 | 敏感于 `continuation-brief.ts:1693`。
- `K3-15-blocked-sentence.test.ts:58/:76` | 额外字段拒绝；来源严格字段契约 | P，边界待裁决 | 敏感于 `continuation-brief.ts:1689`。
- `K3-15-blocked-sentence.test.ts:58/:88` | 非法 requestState 拒绝；来源任务书 `k3-g4b3-impl.md:144` | P，边界待裁决 | 敏感于 `continuation-brief.ts:1708`。
- `K3-15-blocked-sentence.test.ts:58/:92` | 非字符串 declaredForms 拒绝；来源字段契约 | P，边界待裁决 | 敏感于 `continuation-brief.ts:1710`。
- `K3-15-blocked-sentence.test.ts:97/:108` | 五种状态文案、最多 16 行、另有 1 条、四种写法仅显示 a/b/c 并标总数 4；来源 SPEC:534及任务书 `k3-g4b3-impl.md:143` | P，边界待裁决 | 敏感于 `continuation-brief.ts:534/:536/:545/:550`。
- `K3-15-blocked-sentence.test.ts:121/:129` | 每写法 `≤160`字节，显示三种且不出现“等3种”；来源任务书 `k3-g4b3-impl.md:147` | P，边界待裁决 | 敏感于 `continuation-brief.ts:542/:546`。
- `K3-15-blocked-sentence.test.ts:135/:139` | 无 heading、无固定句；来源 SPEC:534 | P，边界待裁决 | absence 对 `continuation-brief.ts:400/:934`敏感；`:141` 的“旧字节不变”断言不敏感，见 F11-04。

### K3-16、K3-19、K3-26

- `K3-16-review-extremes-pure.test.ts:86/:98` | K3-16/L18/D7，process aliases `[1,2]`、targets `[1,2]`、platformTargets `[3]`，完整原命令及固定平台说明；来源 SPEC:548及混合目标规则 | P，Runtime 模块导入待裁决 | 敏感于 `context-assembler.ts:423` 的 process 过滤及 `src/contracts/core/prepared-execution.ts:97` 的 renderer。
- `K3-16-review-extremes-pure.test.ts:115/:128` | K3-16，完整 summary 字面量、alias 升序、方法前缀 `28`字节；`28＋"second"` 为手算，本文件 `:147` | P | 敏感于 `unknown-call-review-card.ts:144` 排序及 `continuation-brief.ts:876` 的格式化。
- `K3-16-review-extremes-pure.test.ts:153/:157` | L7/L13 极值，32 条、aliases 1…32、每条渲染恰好一次；来源 L7 的 32 条上限 | P，导入边界待裁决 | 敏感于 `context-assembler.ts:424` 的条目生成；不是 32 条真实 Run 验收。
- `K3-16-review-extremes-pure.test.ts:174/:190` | codec 极值，`12000`字节、12 条、itemsOmitted `3`、incomplete/kernel_unreadable；12000 是本行选定样例大小，填充差额在 `:182` 计算，不是生产容量常量 | P | 对 `unknown-call-review-codecs.ts:550/:559` 保真敏感；不证明 512 KiB 容量边界。
- `K3-19-review-admission-pure.test.ts:47/:48` | review 合法→null；来源 SPEC:367 | P | 删除拒绝检查不使正例失败；集合独立性受 F8-06 污染。
- `K3-19-review-admission-pure.test.ts:51/:52` | proposal 合法→null；来源 SPEC:548 | P | 同上。
- `K3-19-review-admission-pure.test.ts:57/:62` | 普通工具集配 review purpose→`tool_set_mismatch`；来源 L13 固定集 | P | 删除 `review-admission.ts:132` 会失败；其余字段保持合法。
- `K3-19-review-admission-pure.test.ts:65/:68` | review purpose＋proposal 集→`tool_set_mismatch` | P | 对 `review-admission.ts:129/:132`敏感；F8-07。
- `K3-19-review-admission-pure.test.ts:71/:74` | proposal purpose＋review 集→`tool_set_mismatch` | P | 对 `review-admission.ts:129/:132`敏感；F8-08。
- `K3-19-review-admission-pure.test.ts:77/:80` | 缺 review 写工具→`tool_set_mismatch` | P | 对 `review-admission.ts:132`敏感。
- `K3-19-review-admission-pure.test.ts:83/:86` | 缺 proposal 写工具→`tool_set_mismatch` | P | 对 `review-admission.ts:132`敏感。
- `K3-19-review-admission-pure.test.ts:89/:92` | review 多 shell→`tool_set_mismatch` | P | 对 `review-admission.ts:132`敏感；F8-09。
- `K3-19-review-admission-pure.test.ts:95/:98` | proposal 多 shell→`tool_set_mismatch` | P | 对 `review-admission.ts:132`敏感；F8-10。
- `K3-19-review-admission-pure.test.ts:101/:102` | review writeScope `['.']`→`write_scope_not_empty`；来源 SPEC:367 | P | 对 `review-admission.ts:133`敏感，未同时制造工具集错误。
- `K3-19-review-admission-pure.test.ts:105/:108` | proposal writeScope `['.']`→同一拒绝；来源 SPEC:548 | P | 对 `review-admission.ts:133`敏感。
- `K3-19-review-admission-pure.test.ts:111/:114` | Host 仅 read→`host_tool_missing`；来源 SPEC:369 | P | 对 `review-admission.ts:100`敏感；该 Host 收窄是可达 A2，并非必须只留纯测试。
- `K3-19-review-admission-pure.test.ts:117/:120` | readonlyCommandAccess null→`readonly_command_access_not_full`；来源 SPEC:369 | P | 对 `review-admission.ts:102`敏感；同样可通过真实 Host 收窄到达。
- `K3-19-review-admission.test.ts:61/:66/:73` | review purpose/phase/round=1、running/entered、最终 completed；来源 SPEC:305、SPEC:367 | M | 不敏感于删除 `execution-driver.ts:839` 的拒绝检查；没有覆盖 SPEC:1433 的不可用行。
- `K3-19-review-admission.test.ts:76/:82/:88` | proposal purpose/phase/round=1、entered、completed；来源 SPEC:548 | M | 同上，未验证不可用后的 needs_decision。
- `K3-26-unknown-call-review-pure.test.ts:71/:79` | K3-26(七)纯部分，schema `UnknownCallReview@1`、32 条、itemsOmitted=1、incomplete/too_many_calls/needs_decision/inventory_incomplete；来源 SPEC:1457及裁决§2 | P | 敏感于 `state/unknown-call-review.ts:794` 的 incomplete 初态和 codec 保真；不证明真实 owner 接受。
- `K3-26-unknown-call-review-pure.test.ts:89/:93` | 四个固定选项及次序、effect apply；来源 L18 | P | 敏感于 `unknown-call-review-card.ts:109/:113/:116`。
- `K3-26-unknown-call-review-pure.test.ts:140/:143` | 构造的 incomplete/undecodable_call＋已列 512 字节条目、itemsOmitted=0，codec 保留；来源 SPEC:278、SPEC:280及返工 8 第1项许可的纯组合 | P | 敏感于初态和 codec；**不能声称真实 Turn 能产生这一组合**。
- `K3-26-unknown-call-review-pure.test.ts:155/:161` | pins 数3、revision1、closedReason null、一个 aggregate object、四选项；来源 L18，测试数据身份手算 | P | 对 `unknown-call-review-card.ts:161/:169/:177`敏感；source.key 期望不独立，见 F8-11。

G2 没有独立声称覆盖 RUN-25 或完整 UR 行的测试；helper 使用 RUN-20/RUN-22 作为前置，不应记作这些规格行已验收。

## 4. LEDGER

以下逐一处理适用于 G2 的 9 条，不重抄 ledger 原断言。

- `.lead-ref/d1-k3g4b3-r8.txt:4` | **早期任务书要求。** `k3-g4b3-impl.md:100` 要求 replay 原结果、不重解析；当前 `B2-15-replay.test.ts:156/:157` 保留对象与序列化相等。裁决 `k3-b3-rulings-v1.md:29` 接受这种 replay 证明。不是 F8/F12；本行的其他前置问题另列。
- `.lead-ref/d1-k3g4b3-r8.txt:5` | **早期任务书要求。** `k3-g4b3-impl.md:165` 明确 R=401；当前断言 `B2-401-world.test.ts:58` 所用 `B401_R` 定义于测试 helper `B2-401-world.ts:60`，值为 401。不是生产常量，不判 F8/F12；不重不漏仍缺证据。
- `.lead-ref/d1-k3g4b3-r8.txt:93` | **任务书要求移出旧非法场景。** `k3-g4b3-rework-8.md:44` 第5项禁止覆写 purpose；旧 Runtime rejected/forbidden 包装断言随场景移除有授权。当前纯判断见 `K3-19-review-admission-pure.test.ts:60`，不能称 Runtime 回执的等价搬移。
- `.lead-ref/d1-k3g4b3-r8.txt:94` | **等价搬移，限准入原因。** 旧 tool_set_mismatch 语义现在位于 `K3-19-review-admission-pure.test.ts:62`；依据返工8第5项。
- `.lead-ref/d1-k3g4b3-r8.txt:95` | **任务书要求移出旧非法场景。** 同返工8第5项；proposal 错配的纯判断在 `K3-19-review-admission-pure.test.ts:72`，未保留 Runtime rejected/forbidden 包装证明。
- `.lead-ref/d1-k3g4b3-r8.txt:96` | **等价搬移，限准入原因。** 当前 `K3-19-review-admission-pure.test.ts:74` 固定 tool_set_mismatch。
- `.lead-ref/d1-k3g4b3-r8.txt:97` | **随被禁止场景移除，由返工8第5项授权；不是等价搬移。** 纯谓词不调用模型，不能替代真实 Runtime 的 modelCalls=0；当前服务测试 `K3-19-review-admission.test.ts:88` 反而断完成。应以可达 Host 收窄场景补实 SPEC:1433，见 F11-07，不把授权删除本身再报 F12。
- `.lead-ref/d1-k3g4b3-r8.txt:428` | **任务书要求移出旧场景。** 普通 manifest＋review purpose 的组合迁至 `K3-19-review-admission-pure.test.ts:57`，依据返工8第5项；当前服务正例 `K3-19-review-admission.test.ts:61` 不是同一拒绝行。
- `.lead-ref/d1-k3g4b3-r8.txt:429` | **任务书要求移出旧场景。** proposal 错配组合迁至 `K3-19-review-admission-pure.test.ts:71`；当前服务正例 `K3-19-review-admission.test.ts:76` 不是“拒绝且零模型调用”的等价替代。

## 5. CANARIES

- 裁决§4 `k3-b3-rulings-v1.md:44` 的 business `performWorld`：不在 G2 的21文件中，归其他组；不作“未发现”结论。
- 裁决§4 `:45` 的两个 owner 多条目文件：不在 G2；G2 的 `K3-06-mixed-kinds-pure.test.ts:111/:157` 是纯函数文件，不能用它们证明那两个 owner 文件已清理。
- 裁决§4 `:46` 的 app routes 固定 digest：不在 G2；但同一裁决§3点名的 `K3-prefix-claim.ts:96` 被 G2 的 `B2-02-recognition-unified.test.ts:133` 调用，已列 F4-05。
- 裁决§4 `:47` 的 whole-summary `toBe→toContain`：不在 G2；G2 的 `K3-16-review-extremes-pure.test.ts:128` 仍断完整 summary，不能替代其他文件的 ledger 审查。
- 裁决§4 `:48` 的容量弱化及 `:49` 的 SQLite-only：不在 G2。
- 裁决§4 `:49` 的七个提高 timeout：D1 中没有一个落入 G2。当前文件已有 timeout 不等于本轮提高 timeout，不另造 F12。
- 补充裁决§3 `:38` 的 K3-19 双后端：已找到违例 `K3-19-review-admission.test.ts:48`，仍固定 memory。

## 6. STATIC claims

以下都是**静态沿调用链核对**，没有实际尝试运行。

- **多条非只读调用同时在途不可由当前正常批处理顺序产生。** 静态序列：公开 claim→prepare→start→脚本模型在一批返回 shell/shell 或 platform/edit/shell→首个非只读调用阻塞；`vendor/coding-agent/dist/tools/registry/tool-registry.js:142` 把它们拆为单调用 serial 组，`vendor/coding-agent/dist/core/runtime/loop/runtime-runner.js:629` 顺序遍历，`:644` 等待本组执行，`:703` 处理未知结果，`:757/:763` 在取消/失败后结束，不会先启动后面的非只读组。因此 G2 的多 process/混合组合只可作为纯输入，不能据此恢复 owner 成功提交构造记录。
- **真实 review/proposal prepare 不会自然产生相反 phase 的固定工具集。** 静态序列：`claimK3ReviewRound` 的真实 claim（`K3-proposal-round.ts:389`）→生产 prepare→start；`src/core/agent-runtime/execution-preparation.ts:343` 从可信 Run purpose 取用途，`:408` 按 phase 选工具集，`:412` 写 permissions。只有改 prepared/read 事实才能把这一序列变成旧 K3-19 错配场景；Runtime 的拒绝线在 `execution-driver.ts:839`。
- **Host 只读能力不足不是不可达组合。** 静态序列：真实 pending review→公开 Host 配置关闭 read-only command→Workflow reviewCapability→UR2；规格明确要求该序列（SPEC:370、SPEC:1322），纯 Host 判断拒绝位于 `src/contracts/review-admission.ts:100/:102`。因此不能借“旧错配场景不可达”把可达的 Host 关闭场景一并移出服务层。
- **普通 completed Run 不能直接用该 requeue 链继续堆 401 请求。** 静态序列：真实 start→脚本模型 final text→Run completed、任务 verifying→requeueTask；`src/core/work-graph/state/task-machine.ts:1218` 拒绝 `busy`，理由为 selected Run is verifying。`B2-401-world.ts:64` 选择 crashed，`:328` 放行脚本故障并由 Runtime 记终态，是绕开此业务阻挡的 A2 方向；问题仍是周围 helper 的其他不合规点。
- **RUN-25 双后端在共享 harness 中没有静态 backend 阻挡。** 序列：`openK3ReviewCardWorld(kind)`→`openRealRunHarness(world,{gitWorkspace:true,takeover})`→公开建 Session/claim→`prepareAndStart` 保存真实开始基准→工具在途→`reconcileUnknownTwice`；git 初始化不分 backend（`K3-35-continuation-fixture.ts:450`），memory 的 records/body 同实例接线在 `:637/:646`，SQLite 分支在 `:660`，真实 read/probe/reconcile 在 `:687/:691/:694`。所以不能用“需要 git 工作树”作为 SQLite-only 理由。这里回答的是 harness 可行性，未宣称实际跑通，也未豁免其上游初始化问题。
- **没有借“公开步骤不可达”删除本组任何行。** 本报告的删除授权判断仅来自返工任务书及裁决；其余不可达判断只限定具体组合，不把整个功能归为不可测。

## 7. OPEN QUESTIONS

- **OQ-1：A5 的模块边界如何计算。** `K3-15-blocked-omission.test.ts:29`、`K3-15-blocked-sentence.test.ts:14` 导入的 `baseBrief` 本身只做纯装配，但来源模块导入 platform/store/Runtime（`K3-35-continuation-fixture.ts:61/:82`）；`K3-16-review-extremes-pure.test.ts:23` 导入 `context-assembler.ts:404` 的纯函数，但该模块同时承担 Runtime 装配。最小选项：① 将这些纯导出放入无上述依赖的纯模块，测试只导入纯模块；② lead 在下一版规则明确允许“混合模块的经核实纯导出”。当前不将三文件判 clean。
- **OQ-2：被明确接受的共享 harness 内，初始 Host 配置适配器的许可范围。** `K3-35-runtime.ts:143`、`K3-35-prepare.ts:75` 返回测试提供的初始配置，`:103` 的授权适配器又在 `:112` 回送输入 permissions；规则同时列 A1 接受共享 continuation 路径、F4 禁止构造端口结果，未明确这类初始配置适配器的边界。最小选项：① 统一改用真实 Host 的公开配置/授权接线；② lead 明确哪些初始配置适配器属于 A1 公共配置输入，并单独要求真实授权检查。未把这一未裁决边界加入 F4 数量；后读覆写、固定 sourceDigest、字典文件结果不依赖此问题，已有明确规则。

## 8. SEARCH LOG

- 先读取 `.lead-ref/groups/G2.txt`、规则表、裁决、D1 ledger；将 G2 路径与 D1 全部条目精确匹配，得到上述9条。
- 逐行读取全部21个目标文件；按文件记录行数、所有 `it/it.each` 声明、helper 导入、最后测试标题；合计3,200行、76声明、82展开用例。
- 搜索 `rg` 时确认环境不可用，改用 PowerShell `Get-ChildItem`、`Select-String` 和 `cmd /c type`；没有把搜索命中数当缺陷数。
- 对中文输出乱码和过长输出截断，重新读取相关范围；规格按分段读取并保留稳定行号，未把截断尾部视为读完。
- 完整读取 G2 直接使用的 helper 文件，并追踪调用到 `B2-crr-world`、`K3-35-runtime`、`K3-35-prepare`、`S5-decision-fixture`、`B2-execution-fixture`、`task-claim-fixture`、`executed-files-stub`；区分实际调用链、配置的替身端口和未调用分支。
- 检查 `.lead-ref/b3-helpers.diff` 的文件/hunk 目录及相关 helper 当前全文；没有声称把 H 清单全部文件审完。
- 读取返工6、7、8任务书、返工8结果及上次 capped review，核对授权删除与当前断言；历史“0 defects”未作为清洁证据。
- 搜索并逐段核对生产 hook、recognizer、request owner、prepare、admission、review tool、readonly tool、状态机、codec、card、continuation renderer 的实际分支。
- 搜索 `independentReadOnly/serial` 后读取 Kernel batch policy 和 runner 等待/终止段，核对多条目不可达说明。
- 搜索并核对 `unparsed/actions.length===0` fallback、创建时间排序、`binding:[]`、spread 后覆写、`captureDigest`、`readWorkspace` 构造结果、`setTimeout` 轮询、store/body 写入、src 常量期望、计数包装实际被调用的方法。
- 对每个 ROWS 条目核对：固定字面量来源、backend、所声称生产检查、删除该检查时是否仍可能由另一分支通过；未执行测试或变异测试。
- UNREAD 目标文件数为0；未写报告文件，报告仅在本回复交付。

G2: files read 21/21; instances by rule: F1 2, F2 4, F3 17, F4 28, F5 1, F6 3, F7 2, F8 11, F9 3, F10 3, F11 7, F12 0; open questions 2