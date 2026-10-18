**本轮不能整体关闭：67 个 must-fix 行中，45 个已修，22 个部分完成。** F-102 符合冻结接口；本轮新增生产缺陷 1 个，另有 10 行台账削弱、6 组假保护。

本次仅静态读取代码和所给材料，没有写文件、运行测试、构建或检测器。当前副本没有可用的 `.git` 元数据，因此提交范围按提供的两份 diff 核对，未独立验证 tag。下文“已修”均指 **STATIC 核对成立**，不代表本次执行通过；两份 DSH 答复中的通过数不作为证据。

为方便逐行定位，以下省略扩展名：测试文件均为 `.test.ts`，其余均为 `.ts`。

| 缩写 | 目录 |
|---|---|
| R / W / B / S / A / ST / H | `tests/runtime/` / `tests/work-graph/` / `tests/business/` / `tests/scenarios/` / `tests/app/` / `tests/state/` / `tests/helpers/` |
| RT / TG / WS | `src/core/agent-runtime/` / `src/core/work-graph/tasks/` / `src/core/work-graph/state/` |
| WF / VR / CM | `src/business/workflow/` / `src/core/work-graph/views/` / `src/core/work-graph/communication/` |

**1．逐个 must-fix 行**

生产行：

| 行 | 判定与修复、证明位置 |
|---|---|
| F-069 | **部分完成**：`TG/command-rerun-request-service:741` 已拒绝非 ready 的 Task reviews；缺 owner 实际遭遇 not_ready/rejected/cancelled 的保护。`W/B2-09-crr-owner:127` 只是正常接线，删掉失败守卫没有相应失败证据。 |
| F-070 | **已修**：`RT/execution-driver:539` 将 recognizer throw／非 ready 失败关闭；`R/B2-02-recognition-unified:306`、`:321` 分别保护失败与 ready/null 放行。 |
| F-071 | **部分完成**：`RT/execution-preparation:408` 接共享 reader，`:413` 传播失败；`R/K3-B3-runtime-fail-closed:28`、`:48` 只直接测试 reader，未保护真实 prepare 的消费守卫。 |
| F-072 | **部分完成**：`WF/decision-actions:277` 已捕获②异常；缺“①已保存、②读取 throw、公开读回答复、再重驱”的用例。`S/K3-44-crr-kind4:279` 的失败发生在 coordinator 读答复处，未到该 adapter。 |
| F-073 | **部分完成**：`TG/unknown-call-review-answers:206` 已保留②尚未完成的答复；但 `S/K3-44-crr-kind4:210` 明确使用②已经提交的前置，没有保护新增 `applied === null` 分支。 |
| F-074 | **已修**：共享排序在 `TG/blocked-command-order:26`；prepare `RT/execution-preparation:260`、brief `RT/context-assembler:1443`、recognizer `TG/command-recognition:47` 均使用；独立顺序断言在 `ST/K3-B3-shared-rules-pure:22`。 |
| F-075 | **部分完成**：共享分页实现 `TG/task-review-reader:45`，三个消费者已接入；`R/K3-B3-runtime-fail-closed:33` 仍手造 ready 分页和记录，未提供规定的真实分页及消费者失败保护。 |
| F-076 | **部分完成**：多处失败传播已改；但 `VR/decision-read-model:550`、`:562`、`:634` 仍把 CRR 分页取消降为 unavailable，`RT/context-assembler:1275` 仍吞取消。`R/K3-B3-runtime-fail-closed:67` 只保护内层 reader。 |
| F-077 | **已修**：`WF/workflow:514`、`:1954` 删除旧投影／清理，公开拒绝旧字段保留在 `:725`；证明见 `B/K3-46-review-advance-failures:626`、`:733`，`B/K3-UR7-crr-failed-set:388`、`:445`。 |
| F-078 | **已修**：卡的无用 Run 参数删除于 `TG/command-rerun-request-card:65`，消费者调整于 `VR/decision-read-model:604`、`CM/decision-source-facts:823`；卡内容回归在 `W/B2-07-crr-card:79`。额外读取的删除以静态调用链确认。 |
| F-079 | **已修**：`TG/command-expansion:99`、`:217` 不再返回顶层 actions，实际使用的 expansion.actions 保留；证明在 `W/B2-11-script-expansion:141`、`:241`。 |
| F-080 | **已修**：owner `TG/command-rerun-request-service:818`、`:827` 复用 `WS/command-rerun-request:151`；`W/B2-09-crr-owner:336`、`:362` 保护 pending/allowed/denied_final。 |
| F-081 | **已修**：owner 重复上限删除于 `TG/command-rerun-request-service:640`，正式规则保留在 `WS/command-rerun-request:222`；八项／第九项保护在 `ST/K3-B3-shared-rules-pure:89`，公开拒绝在 `W/B2-14-crr-forms:98`。 |
| F-082 | **已修**：必需 blockedCommands 的 fallback 已从 `RT/context-assembler:1446`、`RT/continuation-brief-assembly:333`、`CM/decision-source-facts:827`、`VR/decision-read-model:604` 删除；codec 必需约束在 `TG/unknown-call-review-codecs:522`。按 9b §2.2，无需新增行为测试。 |
| F-083 | **已修**：统一实现 `src/contracts/utf8:21`，三个指定消费者使用；`ST/K3-B3-shared-rules-pure:36` 有中文、代理对、精确边界和零字节独立预期。 |
| F-084 | **已修**：`WF/decision-actions:259` 保留原身份验证并删除后续重复计算；现有有效请求回归见 `W/B2-09-crr-owner:285`、`W/B2-07-crr-card:79`。 |
| F-085 | **已修**：`TG/command-rerun-request-service:601` 删除未用 ctx，`:724` 调用适配；公开请求回归在 `W/B2-09-crr-owner:260`。 |
| F-086 | **已修**：`TG/command-rerun-request-card:45` 直接返回 AggregateRef，无旧说明／双重 cast；source/object 断言在 `W/B2-07-crr-card:79`。 |
| F-087 | **已修**：`RT/execution-contracts:339` 改为缺 recognizer 失败关闭；实现 `RT/execution-driver:528`，证明 `R/B2-02-recognition-unified:338`。 |
| F-088 | **部分完成**：统一算法 `WS/command-normalization:47` 及三个消费者已改；`ST/K3-B3-shared-rules-pure:56` 仍用生产 key 作 expected，`:59` 是生产函数自比，未保护真实 whole-text fallback。 |
| F-089 | **已修**：CRR owner 和 `TG/revision-guard:13` 复用字段谓词；边界证明 `ST/K3-B3-shared-rules-pure:64`、`:122`。 |
| F-098 | **部分完成**：最新请求改成降序取首项，但 `RT/context-assembler:1456` 的 locale 排序与卡 `TG/command-rerun-request-card:146` 的 ref 字符序不一致；新增缺陷详见第 4 部分。`R/K3-B3-runtime-fail-closed:87` 也未使用冻结要求的公开请求前置。 |
| F-099 | **已修**：`TG/unknown-call-review-codecs:273` 拒绝空 cwd；`ST/K3-B3-crr-codec-rejects:69` 先证明基体合法，再只改 cwd，检查确切拒绝。 |
| F-100 | **部分完成**：`TG/command-rerun-request-service:959` 起的重放、saved answer、source/selection、request pin、Goal basis 静态实现齐全；缺“保存答复后改 Goal 内容拒绝”和“pause/resume 只改 revision 仍接受”两条指定测试。现有 `W/B2-09-crr-owner:285`、`:296` 不是这两个行为。 |
| F-101 | **部分完成**：`RT/context-assembler:1199` 已补 reader 窗口／失败语义；但 `:1275` 的 review 消费者仍吞 cancelled。`R/K3-B3-runtime-fail-closed:67`、`:75` 只到内层。页帽／停滞测试按 9b 裁定留 T，不重开。 |
| F-102 | **已修**：接口 `src/core/work-graph/model/command-recognition-contracts:35`、选择 `TG/command-recognition:137`、owner `TG/command-rerun-request-service:761`；两后端公开正反例在 `R/B2-02-recognition-unified:214`、`:251`。完整调用链见第 2 部分。 |

保护缺口行：

| 行 | 判定；生产检查；删除检查后的 STATIC 判断 |
|---|---|
| F-008 | **已修**：`H/B2-crr-world:288` 真实 requeue→claim→Runtime 请求；`W/B2-07-crr-card:54` 证明请求 Run 与被核对 Run 不同，`:61`、`:84` 精确校验卡。检查是 `TG/command-rerun-request-card:153` 使用保存的 reviewRef；改用请求 Run 会使该测试失败。**STATIC：会失败。** |
| F-020 | **部分完成**：`S/K3-44-crr-kind4:60` 手工组 startup dependencies，`:216` 手调 reconcile，`:232` 过滤答复后手交新 Workflow；没有 Host 重启。可守 startup 枚举，但删掉 `src/app/host:1029`、`:1045` 的自动交接仍会通过。**STATIC：完整恢复保护不会失败。** |
| F-021 | **部分完成**：真实 reader 在 `H/K3-real-workspace:48`；真实文件展开／删除已有 `W/B2-11-expansion-levels:60`、`:118` 和 `R/B2-16-hook-reads:223` 保护，删除对应展开／不可读处理会失败。但 `R/B2-02-recognition-unified:90` 仍返回构造 WorkspaceFile；`W/B2-12-recognition:154` 把 owner 读失败改成读取成功但无脚本。**STATIC：已改子路径会失败，整行保护未齐。** |
| F-026 | **部分完成**：固定拦截文字、allowance 文字和审批标签已有独立断言，例如 `R/B2-02-recognition-unified:311`、`W/K3-16-approval-application:211`；但 `W/B2-01-blocked-commands:77`、`:110`、`:132`、`W/B2-03-crr-request:89`、`W/B2-14-crr-forms:76` 等仍用生产 hash／规范化规则生成 expected，`B/K3-46-review-advance-failures:498` 仍复制生产拒绝原因。检查如 `WS/command-normalization:33` 的规范化被同时改坏时，相关自算断言会跟随。**STATIC：未全部形成独立保护。** |
| F-031 | **已修**：`R/B2-02-recognition-unified:175` 使用递增 A8 时间和反向 Run ID，`:205` 精确断言较早 A 胜出。检查是 `TG/blocked-command-order:28` 的 createdAt 优先比较；删去该比较后会按反向 ref 选 B。**STATIC：会失败。** |
| F-032 | **部分完成**：`R/B2-401-world:78` 的第 401 个请求才 allowed，`:93` 证明 200/200/1，`:108` 证明消费末页请求，保护 `TG/command-rerun-request-service:606` 的完整读取；`S/K3-20-review-card-paging:149` 的 Goal B gate 与 `:195` 的 4→5 断言保护一致性重试。两者删目标检查会失败；`W/K3-15-list-by-task:54` 仍每 Task 仅一条，第二个同 Task Run 未完成。**STATIC：两个子项会失败，K3-15 子项不会。** |
| F-033 | **已修**：`R/K3-19-review-admission:303`、`:333` 用同一 configurationRevision 分别命中 entry 和 driver 准入；read 次数及零模型调用在 `:325`、`:352`。检查是 `src/contracts/review-admission:102`，经 `src/composition/create-platform:499`、`RT/execution-driver:835` 调用；删除目标层检查会改变拒绝或配置读取次数。**STATIC：会失败。** |
| F-035 | **部分完成**：`W/B2-UR7-crr-answer:118` 已经由 Workflow 选择／执行②重放及③，`:147`、`:163` 保护 receipt 和幂等 revision；但它手交 answers，`S/K3-44-crr-kind4:236` 同样手交，未守 `src/app/host:1036` 的重启交接。另丢公开 allowed 状态断言，见 D27。**STATIC：②／③局部会失败，完整重启交接不会。** |
| F-040 | **已修**：`W/K3-18-review-card-queue:195` 真设 every_step，`:200` 真暂停，`:202` 公开确认，`:218` 无 automation card；检查是 `WS/decision-policy:213` 对 unresolved review 的阻止。**STATIC：删除该判断会产生不应有的确认卡，测试失败。** |
| F-041 | **已修**：`W/K3-26-unknown-call-review-storage:608` 包真实 commit 一次失败，`:673` 用公开读验证失败时 Run/review 均未部分提交、重试一起出现。检查是 `TG/run-reconcile-service:725`、`:772`、`:779` 将两者放入同一 commit。**STATIC：破坏该原子提交关系会失败。** |
| F-042 | **已修**：`W/K3-47-claim-gate:262`、`:281`、`:302` 分别保护 absent 成功、system pending 拒绝、人类 requeue 后真实 claim 拒绝；检查是 `TG/requeue-service:905` 和 `WS/run-machine:632`／`:649` 的 review gate。**STATIC：会失败。** |
| F-044 | **已修**：`B/K3-41-release-hold:371` 在真实 durable release commit 后 gate 旧 Host，`:430` crash restart，`:438` 同请求恢复，`:455` 再重放；检查是 `TG/unknown-call-review-service:1124` 的 release 重放、`src/app/core-routes:811` 的 release→requeue 链及其幂等性。**STATIC：丢失恢复或精确一次语义会失败。** |
| F-045 | **已修业务保护**：`B/K3-15-ur3h:280` 真 perform cancel、`:292` 公开读 cancelled、`:301` settle；`B/K3-review-workflow-rows:1063` 把 baseline 放在首次 apply 前，`:1107`、`:1120` 查 revision／无重复写；`:875` 校验完整 receipt。**STATIC：删除 cancel、receipt 字段传递或③幂等会失败。** receipt 构造形式另列 DEFERRED。 |
| F-054 | **部分完成**：多数指定服务行已双后端、断言共用，详台账；但 `B/K3-review-workflow-rows:815`、`:828`、`:839`、`:864`，`R/K3-review-preparation:245`、`:288`，`R/K3-12-review-round-tools:233` 仍未完成。此行为是执行矩阵要求，没有单一生产判断可删；缺失后端上的守卫仍无测试保护。 |
| F-066 | **部分完成／BLOCKED**：新增入口 `H/K3-35-continuation-fixture:942`、`H/K3-35-prepare:121` 未被目标测试调用；现有 `R/K3-35-T-by-hand:166` 仍期待 prepare ready。检查是 `src/contracts/continuation-brief:482` 的容量 throw 和 `RT/context-assembler:1709` 的 capacity 转换。**STATIC：纯 renderer 删除 throw 会失败；删除 prepare 转换没有本行真实路径测试保护。** 算术及 option(c) 见下。 |
| F-067 | **部分完成**：`W/K3-48-2-unknown-call-review-model-text-budget:517` 拒绝长 rationale，`:526` 记录不变，`:531` 接受短 rationale，`:542` 完整读回；确实保护 `WS/unknown-call-review:231` 的 optional-text admission，**STATIC：删该检查会失败**。但 `:497`–`:503` 从生产记录大小反推 proposal cwd，不是冻结要求的固定公共前置与独立 C 手算。 |
| F-097 | **已修**：`W/B2-07-crr-card:138` 的 reader 与世界 owner 共用，`:151` 请求后只读一次，`:158` 修改真实 package.json，`:163` 公共读卡后计数不增，`:166` 保留原命中；检查／数据路径是 `TG/command-rerun-request-card:157` 直接投影保存的 match。**STATIC：重展开并使用新文件内容，会破坏计数或原命中断言。** |

9a 报称完成的 package-A 行：

| 行 | 判定与修复、证明位置 |
|---|---|
| F-014 | **部分完成**：纯 helper 已抽到 `H/K3-continuation-pure-fixture:14`；`R/K3-15-blocked-omission:29`、`R/K3-15-blocked-sentence:14` 已改纯依赖，但仍未按指定迁入 `*-pure.test.ts`。这是明确的迁移缺口，未发现因此产生业务假保护。 |
| F-023 | **已修**：`W/B2-07-crr-card-pure:77`–`:124` 覆盖 earlier 前五条、过滤、全文和 ref 降序 tie。 |
| F-024 | **已修**：`W/B2-command-rerun-request-event-pure:79`–`:112` 独立保护 proof/usedBy/无 proof；服务公共读在 `W/B2-08-crr-answer:69`、`W/B2-09-crr-owner:306`。 |
| F-027 | **部分完成**：state 两文件的固定 hash／forms 已改；但 `R/K3-19-review-admission-pure:35`、`:67`、`:73`、`:91`、`:97` 仍用生产工具常量，`R/K3-26-unknown-call-review-pure:159` 仍用生产 decisionSourceKey 算 expected。 |
| F-030 | **已修**：`R/B2-01-shell-hook:88`–`:109` 两个真实不同命令分别命中 unparsed 和 all-irrelevant，并完整断言唯一 fallback action。 |
| F-034 | **已修**：`S/K3-29-startup-reconcile-2b:256`–`:285` 先 held＋activeRound 再结束，排除了 kind 1 的遮蔽。 |
| F-037 | **已修**：`W/B2-11-blocked-commands-bytes-pure:32`–`:71` 各字段独立变化，精确差值 69、1998、−1、93、288、33。 |
| F-038 | **已修**：指定删除均有本行授权，逐项见台账；未把被删内部自证算作业务验收。 |
| F-039 | **已修**：`R/K3-15-blocked-sentence-pure:20`–`:56` 用完整固定旧文字替代输出自比。 |
| F-043 | **已修**：`W/K3-47-reader-facts:167`、`:186` 断言完整 stopped／unknown_call_review／unreadable verdict。 |
| F-046 | **部分完成**：多个指定纯文件已建；`W/K3-26-unknown-call-review-storage:142`–`:160` 原 codec 行未迁，disposition 迁移另丢了具体文字、负断言和顺序，见 A72 等台账行。 |
| F-050 | **已修**：`W/B2-08-crr-cancel:54`–`:64` 使用真实当前 source；closed card 的 pins=[] 按 9b 裁定接受。 |
| F-053 | **已修**：`W/K3-48-3-required-writes:55`、`:70` 正确登记 UCR-07。 |
| F-055 | **部分完成**：9b §2.2 要恢复 120,000 的三项仍为默认：`W/K3-16-approval-application:238`、`:332`、`:385`。 |
| F-056 | **已修**：`R/K3-06-mixed-kinds-pure:115`、`:157`、`:186` 保护 contained、alias、digest、kind。 |
| F-057 | **已修本行混合义务**：`R/K3-15-disposition-effects-pure:196`、`:207` 先证明行存在，再检查 targets＜platform＜reminder；旧 disposition＜targets 的丢失归 F-046／台账。 |
| F-059 | **已修**：`R/K3-16-targets-pure:80`–`:106` 从两个 process＋platform 输入推导 targets。 |
| F-060 | **已修**：`R/K3-16-review-extremes-pure:218`–`:281` 检查完整混合摘要末句。 |
| F-061 | **已修**：`R/K3-16-proposals-pure:117`–`:137` 倒序写入 12 次真实 transition，再断言保存数组完整升序。 |
| F-062 | **已修**：`R/K3-35-manifest-trim-pure:283`、`:284` 独立超限；`:295`、`:428` 保留 toolName、完整句、非 null／truncated 和整 manifest 排除 callId。 |
| F-063 | **已修**：`W/K3-35-owner-manifest-trim:67`、`:81`–`:100` 从公开 material 读真实 manifest，检查 digest 和两换行拼接。 |
| F-064 | **已修**：`R/K3-26-unknown-call-review-codec-pure:74`–`:92` 保护 512 接受、513 拒绝；ASCII 字节边界按 9b 裁定接受。 |
| F-065 | **已修**：`R/K3-35-renderer-boundary-pure:260`–`:320` 保护八锚点、长原因、全文、callId 排除、15,692／16,396／704 和容量异常。 |
| F-068 | **已修**：`B/K3-15-ur3h:241` 固定断言 `['k3-15-ur3h-call-1']`。 |

两个 BLOCKED 的核对：

- **F-066：报告“尚未完成”是诚实的；15,030 和“该组合已形成”的论据不成立。**  
  `14,934 + 95 + 1 = 15,030` 的加法正确，但代码中没有独立证明 14,934 的完整算式或目标用例。按答复列出的、相对纯例的差项计算：

  `16,396 − (6,143 − 5,731) − 1 − 8 × (118 + 1) = 15,031`

  尚差 1 字节未解释。这个推算也不是公开 prepare 的实测值；无论 15,030 还是 15,031，都低于 16,384。

  更关键的是，新入口在第九 Run **创建自己的 review 之前**返回：`H/K3-35-continuation-fixture:942`–`:952`；review 随后才在 `:974` 附近创建。第九 Run 进入后，`TG/run-state-service:453`–`:458` 会把其 binding 中的八锚点视为已拾取，后续带批准块的 continuation 就不再携带它们。因此该入口没有证明“八个未拾取锚点＋该 K3 review 块”同时到达目标 prepare，也没有实际 capacity 拒绝可引用。

- **F-066 option(c)：对纯 renderer 的 16,384-byte 拒绝保护，今天确实成立；对真实 prepare 拒绝，不成立。**  
  [纯例第 319 行](D:/cxt/k3g4b3-review11/tests/runtime/K3-35-renderer-boundary-pure.test.ts:319) 明确要求 `ContinuationBriefCapacityError`，删除 [renderer 的拒绝分支](D:/cxt/k3g4b3-review11/src/contracts/continuation-brief.ts:482) 会失败。但它不经过 [prepare 的 capacity 转换](D:/cxt/k3g4b3-review11/src/core/agent-runtime/context-assembler.ts:1709)，不能替代 F-066。

- **F-032／K3-15：夹具阻塞报告可信，但不是产品不可达。**  
  当前 `W/K3-15-list-by-task:54`、`:55` 是两个 Task 各一条；`:59` 的分页比较没有第二个同 Task 对象。答复所引拒绝来自 `H/K3-35-continuation-fixture:517`，经 `H/B2-crr-world:125`，是 “Run settled before shell” 的夹具失败。该 harness 的 Runtime 接线缺 recognizer，而非“同 Task 不能有第二个 blocked Run”；F-031/F-102 使用的 `H/K3-blocked-command-fixture` 已通过窄 recognizer 接线建立两个真实记录。应保留未完成状态，修窄接线后完成；不能自行移 T。

**2．F-102 冻结接口与全部生产调用**

| 要求 | 核对 |
|---|---|
| optional、已解析的 preferred | `src/core/work-graph/model/command-recognition-contracts:35` 是 `preferred?: {reviewRunId, alias}`。 |
| 同一次 parse／expansion | `TG/command-recognition:60` parse 一次，`:73` expansion 一次，`:137`–`:156` 从同一结果找 preferred，未命中回到 firstHit。 |
| owner 传 resolved rewriteOf | `TG/command-rerun-request-service:751`–`:767` 先解析，再在 recognizer 调用传 preferred。 |
| hook 不传 preferred | `RT/execution-driver:536` 不传，继续按第一命中拦截和显示处置。 |
| 所有直接生产调用 | 只有上述 owner 和 hook 两处；`src/composition/create-platform:761`、`:776`、`:1178` 共用正式 recognizer。 |
| persisted match 一个 hit | owner `:798`、`:800` 选择单个 record／alias／match，`:876` 保存单个 match；没有新增命中数组。 |
| pending／deny／allow 跟随所选记录 | owner `:810` 之后按所选 reviewRef＋alias 继续处理。 |
| card 不变 | `VR/decision-read-model:590`、`:604` 读所选 review；`TG/command-rerun-request-card:153`、`:157` 显示所选记录及保存的 match。 |
| brief 不变 | `RT/context-assembler:1448` 仍按 review Run ID＋alias 连接，两个记录的 `#1` 不会合并。 |
| allowance 不变 | `RT/execution-driver:477`、`:493` 仍比较**整条 command digest**，未变成按 preferred/action 放行。 |
| 正反例 | `R/B2-02-recognition-unified:214` 接受组合命令指定 B，保存 B 并显示 B；`:251` 只命中 A 却指定有效 B，精确拒绝 mismatch 且公开请求集合不变；均两后端。 |

**3．逐行 D1 台账**

分类：**要求 F-x**＝冻结行要求的改写／删除；**等价**＝相同主体、相同检查已保留；**削弱**＝丢失原义务或未经授权放宽。允许迁移不等于允许丢断言。

`D` 为 [d1-round-9b.txt](D:/cxt/k3g4b3-review11/.lead-ref/d1-round-9b.txt) 的物理行号；`A` 为 [d1-round-9.txt](D:/cxt/k3g4b3-review11/.lead-ref/d1-round-9.txt) 的物理行号。

9b 的全部 **83 行**：

| D | 原位置 | 判定及现址 |
|---|---|---|
| 4 | R/B2-401-world:81 | **要求 F-032**；`:81` 的 B401_R 是测试输入常量，`:85`、`:93`–`:100` 另守 401 和 200/200/1。 |
| 5 | S/K3-20-review-card-paging:195 | **要求 F-032**；现 `:195` 确认 gate 命中输入 Goal B。 |
| 6 | 同文件 :197 | **要求 F-032**；现 `:197` 确认第五条属于 Goal B，`:198`–`:199` 确认 4→5。 |
| 7 | W/K3-48-2-unknown-call-review-model-text-budget:526 | **要求 F-067**；拒绝前后完整 JSON 相等，属于 unchanged 检查。 |
| 10 | R/B2-401-world:112 | **削弱**；新增 `1_200_000` 超时没有 F-032 授权，邻行旧超时不构成本行授权。 |
| 13 | B/K3-review-workflow-rows:1065 | **要求 F-045**；现 `:1117`–`:1120` 保留第二次 selection 零写入，首次 apply 基线在 `:1063`。 |
| 14 | R/B2-02-recognition-unified:138 | **要求 F-031/F-102**；现 `:185`–`:186` 精确检查反向 A/B ID，强于不相等。 |
| 15 | 同文件 :139 | **等价**；A 的 `[{alias:1}]` 保留于 `:189`。 |
| 16 | 同文件 :140 | **等价**；B 的 `[{alias:1}]` 保留于 `:190`。 |
| 17 | 同文件 :156 | **要求 F-031**；冻结允许改 A/B 命令，`:205`–`:207` 精确检查较早 A 的 block。 |
| 18 | S/K3-16-approval-round:163 | **要求 F-026**；`:165`–`:166` 写出方案字面文本，不再调用生产 formatter 算 expected。 |
| 19 | S/K3-44-crr-kind4:43 | **等价并增强**；`:184`–`:186` 保留 application_not_recorded，并查各阶段结果。 |
| 20 | 同文件 :91 | **等价**；`:228`–`:229` 保留相同 requestRef／answerRef 的 handoff。真实重启缺口另归 F-020。 |
| 21 | 同文件 :99 | **要求 F-020/F-035**；`:239`–`:243` 在 Workflow receipt 中保留 applied／application committed。 |
| 22 | W/B2-07-crr-card:157 | **等价**；同一次 request 写入的 committed 检查移至 `H/B2-crr-world:357`–`:360`，调用在本测试 `:147`。 |
| 23 | 同文件 :163 | **要求 F-021/F-097**；`:151` 改为共享真实 reader 完整 paths=`['package.json']`。 |
| 24 | 同文件 :172 | **要求 F-097**；`:163` 公共读卡后仍为同一 paths 数组，计数不增。 |
| 25 | W/B2-11-script-expansion:157 | **要求 F-021**；`:196` 改真实 root 下相对路径四项，`:197`–`:198` 保留长度与截断。 |
| 26 | W/B2-UR7-crr-answer:54 | **要求 F-035**；`:147`–`:152` 在 Workflow receipt 保留 applied、② replay、allowed、③ committed。 |
| 27 | 同文件 :59 | **削弱**；原公共 readRequest 的 `state:'allowed'` 丢失，`:153`–`:156` 只查 revision；receipt 的 allowed 不是公共读回状态。 |
| 28 | 同文件 :66 | **要求 F-035**；`:163`–`:166` 保留第二次 application committed。 |
| 29 | 同文件 :67 | **等价**；`:154` 首次固定 revision+1，`:168` 再次公开读回等于该 revision。 |
| 30 | W/K3-47-claim-gate:261 | **要求 F-042**；旧任意拒绝改为 absent→requeue→claim 成功，现 `:270`、`:274`–`:276`。 |
| 31 | 同文件 :262 | **要求 F-042**；同上，不应继续保留错误的 rejected 期望。 |
| 34 | B/K3-UR7-crr-failed-set:354 | **要求 F-054**；现 `:354` 两后端共用原断言。 |
| 35 | B/K3-review-workflow-rows:521 | **要求 F-054**；现 `:532` 两后端、相同主体及断言。 |
| 36 | 同文件 :856 | **要求 F-045**；现 `:875`–`:887` 完整 receipt 相等。 |
| 37 | R/B2-01-shell-hook:46 | **要求 F-054**；现 `:47` 两后端、原断言保留。 |
| 38 | R/B2-02-approved-method:42 | **要求 F-054**；现 `:42` 两后端、原断言保留。 |
| 39 | R/B2-02-recognition-unified:121 | **要求 F-031**；排序组移至 `:175`。 |
| 40 | 同文件 :122 | **要求 F-031**；`:176`–`:207` 使用冻结的双记录反例。 |
| 41 | 同文件 :161 | **要求 F-054**；现 `:275` 两后端、原断言保留。 |
| 42 | 同文件 :231 | **要求 F-054**；现 `:345` 两后端、原断言保留。 |
| 43 | R/B2-03-request-tool:57 | **要求 F-054**；现 `:57` 两后端、原断言保留。 |
| 44 | 同文件 :115 | **要求 F-054**；现 `:115` 两后端、原断言保留。 |
| 45 | R/B2-04-allowance:39 | **要求 F-054**；现 `:40` 两后端、原断言保留。 |
| 46 | R/B2-05-06-denial:55 | **要求 F-054**；现 `:55` 两后端、原断言保留。 |
| 47 | R/B2-09-allowance-crash:39 | **要求 F-054**；现 `:40` 两后端、原断言保留。 |
| 48 | R/B2-13-allow-one-form:42 | **要求 F-054**；现 `:42` 两后端、原断言保留。 |
| 49 | R/B2-15-replay:118 | **要求 F-054**；现 `:118` 两后端、原断言保留。 |
| 50 | R/B2-16-hook-closure:72 | **要求 F-054**；现 `:72` 两后端、原断言保留。 |
| 51 | R/B2-16-hook-reads:178 | **要求 F-054**；现 `:183` 两后端、原断言保留。 |
| 52 | R/K3-35-T-by-hand:97 | **要求 F-054**；现 `:97` 两后端、原断言保留。 |
| 53 | 同文件 :153 | **要求 F-054**；现 `:153` 两后端；原 ready 断言保留，但不构成 F-066 拒绝覆盖。 |
| 54 | R/K3-35-approved-methods-brief:86 | **要求 F-054**；现 `:78` 两后端、原断言保留。 |
| 55 | R/K3-35-workspace-baseline-prepare:205 | **要求 F-054**；现 `:189` 两后端、原断言保留。 |
| 56 | R/K3-review-preparation:375 | **要求 F-054**；现 `:376` 两后端、原断言保留。 |
| 57 | 同文件 :386 | **要求 F-054**；现 `:387` 两后端、原断言保留。 |
| 58 | 同文件 :407 | **要求 F-054**；现 `:408` 两后端、原断言保留。 |
| 59 | R/S4C2-assembly:417 | **等价增强／按 F-054 实施**；现 `:419` 两后端、同断言；不据此扩大其他已裁定 T 的旧 S3/S4C2 行。 |
| 60 | S/K3-44-crr-kind4:30 | **要求 F-020/F-035**；组移至 `:205`；真实重启仍缺。 |
| 61 | 同文件 :31 | **要求 F-020/F-035/F-054**；现 `:206` 两后端；真实重启仍缺。 |
| 62 | W/B2-01-blocked-commands:93 | **要求 F-054**；现 `:93` 两后端、原断言保留。 |
| 63 | 同文件 :114 | **要求 F-054**；现 `:115` 两后端、原断言保留。 |
| 64 | 同文件 :139 | **要求 F-054**；现 `:141` 两后端、原断言保留。 |
| 65 | 同文件 :148 | **要求 F-054**；现 `:151` 两后端、原断言保留。 |
| 66 | W/B2-03-crr-request:78 | **要求 F-054**；现 `:78` 两后端、原断言保留。 |
| 67 | W/B2-07-crr-card-closed:37 | **要求 F-054**；现 `:37` 两后端、原断言保留。 |
| 68 | W/B2-07-crr-card:40 | **要求 F-008/F-054**；现 `:40` 两后端，并分清请求 Run／被核对 Run。 |
| 69 | 同文件 :117 | **要求 F-021/F-097/F-054**；现 `:128`–`:173` 两后端，共享真实 reader。 |
| 70 | W/B2-08-crr-answer:52 | **要求 F-054**；现 `:52` 两后端、原断言保留。 |
| 71 | W/B2-08-crr-cancel:28 | **要求 F-054**；现 `:28` 两后端、原断言保留。 |
| 72 | W/B2-09-answer-replay:27 | **要求 F-054**；现 `:27` 两后端、原断言保留。 |
| 73 | W/B2-09-crr-owner:238 | **要求 F-054**；现 `:260` 两后端、原断言保留。 |
| 74 | 同文件 :253 | **要求 F-054**；现 `:275` 两后端、原断言保留。 |
| 75 | 同文件 :263 | **要求 F-054**；现 `:285` 两后端、原断言保留。 |
| 76 | 同文件 :274 | **要求 F-054**；现 `:296` 两后端、原断言保留。 |
| 77 | 同文件 :284 | **要求 F-054**；现 `:306`，两后端共用 `:316`–`:318` 的状态断言。 |
| 78 | 同文件 :299 | **要求 F-054**；现 `:321` 两后端、原断言保留。 |
| 79 | 同文件 :313 | **要求 F-054**；现 `:335` 两后端、原断言保留。 |
| 80 | 同文件 :386 | **要求 F-054**；现 `:408` 两后端、原断言保留。 |
| 81 | W/B2-11-expansion-levels:101 | **要求 F-021**；现 `:118` 移走真实文件制造失败，`:134` 另保留原不可读结果形状。 |
| 82 | W/B2-12-recognition:125 | **削弱**；虽在 `:130` 双后端化，但原 owner 的 reader throw 被 `:154`–`:172` 的“成功读 package、没有目标脚本”替换；故障主体丢失。 |
| 83 | W/B2-12-rewrite-prefix:103 | **要求 F-054**；现 `:103` 两后端、原断言保留。 |
| 84 | W/B2-14-crr-forms:66 | **要求 F-054**；现 `:66` 两后端、原断言保留。 |
| 85 | W/B2-17-disposition-reads:33 | **要求 F-054**；现 `:33` 两后端、原断言保留。 |
| 86 | W/B2-18-request-reads:93 | **要求 F-054**；现 `:99` 两后端、原断言保留。 |
| 87 | W/B2-UR7-crr-answer:28 | **要求 F-035**；组移至 `:117`。 |
| 88 | 同文件 :29 | **要求 F-035/F-054**；现 `:118` 两后端；丢公开 allowed 断言已单列 D27。 |
| 89 | W/K3-15-disposition-effects:147 | **要求 F-054**；现 `:148` 两后端、保留服务断言。 |
| 90 | W/K3-26-unknown-call-review-storage:158 | **要求 F-054**；现 `:162`，`:163`–`:166` 选真实两种 backend，共用断言。 |
| 91 | W/K3-47-claim-gate:254 | **要求 F-042**；现 `:262`，absent 的真实 requeue→claim 成功。 |
| 92 | 同文件 :276 | **要求 F-042**；现 `:302`，实际 requeueRef 后 claim busy/pending，`:316`–`:321` 查不增 Run。 |

9a 的额外台账行如下。两账本重复的同一断言／标题已在上表裁定，不因旧行号漂移再计一次；9b 明确接受的 F-050、F-064、F-082、F-101 页帽例外不重新打开。

| A | 原位置 | 判定及现址／丢失内容 |
|---|---|---|
| 15 | A/K3-15-review-routes:126 | **要求 F-038**；删除 hold route 配置表自证。 |
| 16 | 同文件 :129 | **要求 F-038**；删除 release-hold 配置表自证。 |
| 17 | B/K3-15-ur3h:221 | **要求 F-038**；删除内部 predicate，公共 cancel 检查保留于 `:221`–`:242`。 |
| 18 | 同文件 :241 | **要求 F-068**；现 `:241` 固定 callId 数组。 |
| 19 | 同文件 :300 | **要求 F-038**；删除内部 predicate，真实检查在 `:332`–`:354`。 |
| 20 | B/K3-46-review-advance-failures:717 | **要求 F-077**；现 `:717` 改完整 failedCardRefs。 |
| 21 | 同文件 :754 | **要求 F-038**；删除已移除内部第三参数的自证。 |
| 22 | B/K3-UR7-crr-failed-set:443 | **要求 F-077**；现 `:435` 检查完整 failedCardRefs，`:445` 旧字段 undefined。 |
| 24 | R/B2-01-shell-hook:90 | **要求 F-030**；`:88`–`:109` 两个独立 fallback，完整一个 action。 |
| 29 | R/K3-15-blocked-sentence:141 | **要求 F-039**；迁至 `R/K3-15-blocked-sentence-pure:20`–`:56`，完整旧文字。 |
| 30 | R/K3-review-preparation:126 | **要求 F-046**；`R/K3-review-input-pure:87` 独立完整 reviewRef。 |
| 31 | 同文件 :157 | **等价增强**；`R/K3-review-input-pure:123`–`:126` 先非 null，再 truncated=true。 |
| 32 | 同文件 :158 | **等价**；`R/K3-review-input-pure:127` 同 command text＋`/w` 的 4096 上限。 |
| 33 | 同文件 :440 | **等价增强**；`R/K3-review-input-pure:198`–`:200` 先 ok，再 changedSample=2。 |
| 34 | 同文件 :441 | **等价**；`R/K3-review-input-pure:201` changedOmitted=3。 |
| 35 | 同文件 :444 | **等价增强**；`R/K3-review-input-pure:204`–`:206` 先 ok，再 notVisible=[]。 |
| 36 | 同文件 :445 | **等价**；`R/K3-review-input-pure:207` 全部 unexpanded。 |
| 38 | S/K3-29-startup-reconcile-2b:197 | **要求 F-038**；删除 emptyStartupReport 自证。 |
| 42 | S/K3-44-crr-kind4:102 | **要求 F-038**；删除 AG2B_AT 真值自证。 |
| 43 | ST/command-normalization:47 | **要求 F-027**；`ST/command-normalization-pure:15`–`:16` 两输入各比固定 SHA。 |
| 44 | 同文件 :48 | **要求 F-027**；pure `:20`–`:21` 分别固定 tool a/tool b 的摘要。 |
| 45 | ST/command-rerun-request:290 | **要求 F-027**；`ST/command-rerun-request-pure:93` 固定长度 8。 |
| 46 | 同文件 :292 | **等价增强**；pure `:95`–`:97` 明确 false 后查 guard_failed/capacity。 |
| 47 | W/B2-07-crr-card:137 | **要求 F-023**；`W/B2-07-crr-card-pure:85`–`:98` 完整摘要。 |
| 48 | 同文件 :153 | **等价**；pure `:103`–`:105` 同 aggregate/ref/revision/label。 |
| 49 | 同文件 :164 | **要求 F-023/F-098**；pure `:108`–`:124` 冻结的 ref 降序和完整文本。 |
| 50 | W/B2-08-crr-answer:73 | **要求 F-024**；事件定位从服务移除，pure `:88` 检查解码，服务现 `:69`–`:71` 公开读状态。 |
| 51 | 同文件 :78 | **等价**；`W/B2-command-rerun-request-event-pure:90` 同三种 change。 |
| 52 | 同文件 :79 | **等价增强**；event-pure `:92`–`:99` 完整 proof。 |
| 53 | 同文件 :82 | **要求 F-024**；event-pure `:93`–`:95` 固定 acknowledgementRef。 |
| 54 | 同文件 :83 | **要求 F-024**；event-pure `:96` 固定 capturedPins。 |
| 55 | W/B2-08-crr-cancel:67 | **要求 F-038**；删除摘要真值自证。 |
| 56 | 同文件 :68 | **要求 F-038**；删除命令常量自证。 |
| 57 | W/B2-09-crr-owner:239 | **要求 F-024**；内部 event read 改 pure `:103`–`:112`，服务现 `:316`–`:318` 查 used 状态。 |
| 58 | W/B2-11-expansion-levels:172 | **要求 F-037**；`W/B2-11-blocked-commands-bytes-pure:39` 精确正差 1998。 |
| 59 | 同文件 :173 | **等价**；同 pure `:39` 保留差值 1998。 |
| 60 | 同文件 :179 | **要求 F-037**；pure `:47`–`:50` actions 单字段差 93。 |
| 61 | 同文件 :182 | **要求 F-037**；pure `:60`–`:71` basis 单字段差 33。 |
| 62 | W/B2-11-script-expansion:60 | **要求 F-079**；删除已移除顶层 actions 的断言，现 `:104`–`:105` 检查实际返回值。 |
| 63 | 同文件 :75 | **要求 F-079**；同上，现 `:112`。 |
| 65 | W/B2-17-disposition-reads:74 | **要求 F-038**；删除两世界冒充单次 per-command budget 的断言。 |
| 66 | 同文件 :75 | **要求 F-038**；同上。 |
| 71 | W/K3-15-disposition-effects:269 | **等价**；`R/K3-15-disposition-effects-pure:196`–`:197` 同 choice／标签／`answer ${choice}` 文字。 |
| 72 | 同文件 :270 | **削弱**；单目标字面 `- 作用对象：#1。` 未迁；pure `:198` 改成混合 `#1、#2`。 |
| 73 | 同文件 :278 | **等价**；pure `:289`–`:291` 保留 skip 的固定提醒＋紧邻 blocked sentence。 |
| 74 | 同文件 :281 | **削弱**；rerun_as_is／handle_myself 不出现 blocked sentence 的负断言未迁。 |
| 75 | 同文件 :304 | **等价**；pure `:233` 同 no-target 的 `- 作用对象：无。`。 |
| 76 | 同文件 :305 | **等价**；pure `:234` 同 no-target 不出现平台条目。 |
| 77 | 同文件 :314 | **削弱**；`照原样重跑…附言：照写。` 整行未断言；pure `:205` 只保留该输入。 |
| 78 | 同文件 :315 | **削弱**；原单目标 `#1` 文字未保留，改成混合目标。 |
| 79 | 同文件 :316 | **等价**；pure `:209` 保留 rerun 的完整固定提醒。 |
| 80 | 同文件 :317 | **削弱**；disposition＜targets 顺序检查丢失；pure `:213`–`:217` 只查 targets＜platform＜reminder。 |
| 81 | 同文件 :318 | **要求 F-057／增强**；pure `:213`–`:217` 先证明三行存在，再查顺序，包含原 targets＜reminder。 |
| 82 | 同文件 :326 | **削弱**；skip 的完整 `…附言：skip it。` 未迁；pure `:286` 有输入但没有该文字断言。 |
| 83 | 同文件 :331 | **等价**；pure `:289`–`:291` 同固定提醒和 blocked sentence。 |
| 84 | 同文件 :346 | **削弱**；released handle_myself 的 `…（卡上选的）；附言：I handled it。` 完整文字未迁。 |
| 85 | 同文件 :356 | **等价**；pure `:241`–`:242` 完整 automatic disposition。 |
| 86 | 同文件 :357 | **等价**；pure `:243` automatic 无目标。 |
| 87 | 同文件 :358 | **等价**；pure `:244` automatic 固定提醒。 |
| 88 | 同文件 :359 | **等价**；pure `:245` automatic 无平台条目。 |
| 89 | 同文件 :412 | **等价增强**；pure `:261`–`:270` 同两条 annotations，先确认解码／非 null。 |
| 90 | 同文件 :417 | **等价**；pure `:275` 同 record annotation 文字。 |
| 91 | 同文件 :418 | **等价**；pure `:276` 同 file annotation 文字。 |
| 92 | W/K3-18-requeue-confirmed:137 | **要求 F-046**；`R/K3-18-requeue-confirmed-pure:51`–`:56` 同 every_step system_requeue 规则。 |
| 93 | 同文件 :152 | **等价增强**；pure `:61`–`:64` 先非 null，再完整 action／countedNext。 |
| 94 | W/K3-18-review-card-queue:311 | **要求 F-046**；`R/K3-18-review-card-pure:110` 写出混合提示完整字面。 |
| 95 | 同文件 :358 | **要求 F-046**；pure `:160` 同文字负断言。 |
| 98 | W/K3-receipt-replay:102 | **要求 F-038**；删除 fake decoder 伪服务覆盖。 |
| 99 | 同文件 :104 | **要求 F-038**；同上。 |
| 102 | A/K3-15-review-routes:125 | **要求 F-038**；删除配置表测试标题及主体。 |
| 103 | B/K3-46-review-advance-failures:738 | **要求 F-038**；删除已移除第三参数的内部测试。 |
| 108 | R/B2-01-shell-hook:85 | **要求 F-030**；现 `:88`–`:109` 拆成两个反例。 |
| 113 | R/B2-02-recognition-unified:192 | **要求 F-070**；现 `:306`–`:318` 把旧“拒绝仍继续”纠正为 fail closed。 |
| 128 | R/K3-review-preparation:121 | **要求 F-046**；纯 build/render/fit 迁至 `R/K3-review-input-pure:82`–`:210`。 |
| 133 | S/K3-29-startup-reconcile-2b:196 | **要求 F-038**；删除 emptyStartupReport 测试。 |
| 136 | ST/command-normalization:46 | **要求 F-027**；迁至 `ST/command-normalization-pure:13`–`:21`。 |
| 137 | ST/command-rerun-request:143 | **要求 F-027**；迁至 `ST/command-rerun-request-pure:78`–`:88`。 |
| 138 | 同文件 :286 | **要求 F-027**；迁至 pure `:91`–`:97`。 |
| 146 | W/B2-07-crr-card:111 | **要求 F-023**；迁至 `W/B2-07-crr-card-pure:76`–`:105`。 |
| 154 | W/B2-09-crr-owner:224 | **要求 F-024**；公开 usedBy 在现 `:306`–`:318`，事件形状在 event-pure `:103`–`:112`。 |
| 159 | W/B2-11-expansion-levels:159 | **要求 F-037**；迁至 `W/B2-11-blocked-commands-bytes-pure:31`–`:71`。 |
| 160 | 同文件 :169 | **要求 F-037**；pure `:36`–`:39` 单独改变 reviewRunId。 |
| 161 | 同文件 :176 | **要求 F-037**；pure `:42`–`:71` 分开各字段精确差值。 |
| 166 | W/B2-17-disposition-reads:62 | **要求 F-038**；删除两世界的 budget 伪证明。 |
| 171 | W/K3-15-disposition-effects:285 | **要求 F-046**；no-target renderer 迁至 pure `:220`–`:234`。 |
| 172 | 同文件 :308 | **要求 F-046 迁移**；主体迁至 pure `:203`，未完整承接的断言已分别计 A77/A78/A80，不重复计削弱数。 |
| 173 | 同文件 :321 | **要求 F-046 拆分**；服务现 `:230`、pure `:279`；丢整行文字计 A82。 |
| 174 | 同文件 :334 | **要求 F-046 拆分**；服务现 `:240` 保留 released hold；丢 rendered 文字计 A84。 |
| 175 | 同文件 :349 | **等价迁移**；pure `:237`–`:245` 承接 automatic 四项断言。 |
| 176 | 同文件 :362 | **等价迁移**；pure `:248`–`:256` 保留 61→60、后缀和完整 60 字。 |
| 177 | 同文件 :375 | **等价迁移**；pure `:259`–`:276` 保留 codec／assembler／renderer annotations。 |
| 178 | W/K3-18-review-card-queue:300 | **要求 F-046**；迁至 `R/K3-18-review-card-pure:99`–`:176`。 |
| 182 | W/K3-48-3-required-writes:55 | **要求 F-053**；现 `:55`、`:70` 更名为 UCR-07。 |
| 183 | W/K3-receipt-replay:101 | **要求 F-038**；删除 fake decoder 测试标题及主体。 |
| 186 | 删除 R/K3-35-renderer-boundary | **要求 F-046/F-065**；四个测试及其保护迁至 `R/K3-35-renderer-boundary-pure:232`–`:320`。 |

台账削弱计 **10 行**：D10、D27、D82；A72、A74、A77、A78、A80、A82、A84。对应删除测试标题不再次重复计数。

**4．本轮新代码的问题**

**新增生产缺陷 1 个：F-098 的两个排序规则不一致。**

[brief 比较器](D:/cxt/k3g4b3-review11/src/core/agent-runtime/context-assembler.ts:1454) 使用 `localeCompare`；[card 比较器](D:/cxt/k3g4b3-review11/src/core/work-graph/tasks/command-rerun-request-card.ts:142) 使用 ref key 的 `<`／`>`。owner 在 `TG/command-rerun-request-service:872` 原样接受 requestId，没有限定小写 hash。

同时间、同记录／alias，requestId=`a` 为 denied、requestId=`B` 为 allowed：ref 字符序降序应选 `a`，locale 字母排序却可能选 `B`，使 brief 显示不同的最新状态。应复用相同的 ref-key 比较规则。此反例是静态推导，未执行。

F-076 的卡分页取消丢失、F-101 的 review fallback 吞取消，是**表内未修旧分支**，不计为本轮新增生产缺陷。

以下 **6 组新假保护**计入 must-fix。计数按不同缺失的守卫，不按涉及的 F 行数重复计：

| 组 | 新测试与规则问题 | 为什么删除目标检查仍可通过 |
|---|---|---|
| G1：F-020/F-035 | `S/K3-44-crr-kind4:60`、`:107`、`:232` 和 `W/B2-UR7-crr-answer:142`，构造 startup 依赖、缓存 mailbox、手交 answers；F4/F11。 | 绕过 `src/app/host:1036` 的真实启动交接，删掉该交接不影响测试。 |
| G2：F-073 | `S/K3-44-crr-kind4:210` 的新恢复前置已经完成②；F11。 | 删掉 `TG/unknown-call-review-answers:206` 对 `applied === null` 的新支持，该用例仍走旧的“②已提交、③未完成”路径。 |
| G3：F-071/F-075 | `R/K3-B3-runtime-fail-closed:28`、`:33`、`:48` 直接调用 reader，ready 页和记录由 stub 构造；F4/F11。 | prepare 根本未运行，删掉 `RT/execution-preparation:413` 的消费失败守卫仍通过。 |
| G4：F-076/F-101 | `R/K3-B3-runtime-fail-closed:67` 只测内层 reader；F11。 | 当前上层 `RT/context-assembler:1275` 已经吞取消，该测试仍可通过，不能保护入口到返回的取消语义。 |
| G5：F-088 | `ST/K3-B3-shared-rules-pure:56`、`:59` 用生产 key 算 expected，并以生产函数自比；F8/F11。 | 同时改错共享 key，或删除 UCR 的 whole-text fallback，不会被这个“fallback”例子发现。 |
| G6：F-098 | `R/K3-B3-runtime-fail-closed:88`–`:115` 手造 request owner 结果；F4/F11。 | 两请求经既存 revision 升序后已经是期望的 b、a；删掉新增“最新 ref 降序”sort，取首项仍是 b，测试仍通过。 |

F-069、F-072、F-100 是**指定测试缺失**，没有把不存在的测试另算成假保护。F-067 则确实会因删除容量检查而失败；它的问题是冻结算术前置未完成，不能说容量保护完全是假的。

**DEFERRED**——以下新形式实例不另作为 must-fix 假保护：

- `B/K3-review-workflow-rows:878`：完整 receipt 仍由 stub 构造（F4）；删除字段传递会使新增断言失败，业务保护存在。
- `R/K3-19-review-admission:303`、`:333`：拒绝后缺少对应公开持久状态 unchanged 断言；已有精确拒绝、固定版本、读取次数和零模型调用，不是遮蔽守卫的反例。
- `W/K3-47-claim-gate:305`–`:321`：部分“不变”依据仍经内部 durableFacts 读取（F7）；真实 claim 拒绝及 Run 数保护存在。
- `R/K3-35-renderer-boundary-pure:270`、`:308`：expected marker 仍调用生产 `continuationBriefDigest`（F8）；不影响本次独立容量异常保护。
- `R/B2-02-recognition-unified:221`–`:228`：F-102 正例仍直接装配 work principal／调用 tool handler，没有完整后续 Runtime 请求过程；移除 preferred 选择仍会使例子失败，按本轮边界留形式清理。
- `R/B2-401-world:112`：未经授权新增 timeout（F12），已作为台账削弱 D10 记录，不另算假保护。

F-014、F-027、F-046、F-055 中明确点名而未完成的事项仍在第 1 部分；没有借 DEFERRED 将这些 package-A 验收义务移出本轮。已由书移 T 的其他行不报告为 open。

**5．9b 答复的 FOUND／UNSPECIFIED**

| 答复条目 | 代码事实 | 建议裁定 |
|---|---|---|
| FOUND：K3-44 taskIds 原为 [] | `S/K3-44-crr-kind4:223`–`:224` 已断言 `['k3-20-a']`。 | 接受局部修正；不据此关闭真实重启恢复。 |
| FOUND：S4C2／K3-35 prepare 缺 Task-review reader | `R/S4C2-assembly:147`–`:154` 接正式 owner；`R/K3-35-workspace-baseline-prepare:168` 接 world.reviews。 | 接受必要的窄接线。 |
| FOUND：改默认 requestRerunOf 破坏旧消费者 | `H/B2-crr-world:288` 新增 opt-in continuation 方法，`:346` 保留旧默认方法；`W/B2-07-crr-card:55` 检查两个 Run 不同。 | 接受 opt-in 修法。 |
| FOUND／UNSPECIFIED：F-032 K3-15 BLOCKED | `W/K3-15-list-by-task:54` 仍单条；拒绝是 `H/K3-35-continuation-fixture:517` 的夹具未到 shell。 | 接受“尚未完成”的报告；修窄 recognizer 接线后补同 Task 第二条，不自行移 T。 |
| UNSPECIFIED：F-066 BLOCKED | 新 step entry 停在第九 Run review 创建前，且没有测试调用；15,030 的基数未证实，逐项差额还差 1 字节。 | 保留 BLOCKED；要求重新给出可同时形成目标事实的公共步骤和独立算式。纯 renderer option(c) 只能作为另一个已成立的保护，不能自动替代 F-066。 |
| UNSPECIFIED：F-054 的 S3 是 no-store harness | `R/S3-context-assembler:315` 有 bodyStore；`:618`、`:629`、`:826` 调 preparationHarness；并非整段 A5 纯函数。 | 不接受“no-store 所以纯”的理由；但书 9 §2.1 明确移 T 的原八项继续按该裁定处理，不因 9b 的概括文字扩大范围。F-054 的明确 K3 遗漏仍须完成。 |
| UNSPECIFIED：S4C2 已补两后端 | `R/S4C2-assembly:419` 已参数化，原断言共用。 | 接受已有增强，不推导其他旧行重新入范围。 |
| UNSPECIFIED：K3-18／K3-41 restart 行仅 SQLite | 真正需要重启的行保留 SQLite；`B/K3-41-release-hold:430` 有实际 crash restart。 | 按 9b §3 接受；手调 startup 的 K3-44 不享受“已证明重启”的结论。 |
| UNSPECIFIED：F-026 无 RED、全部 expected 已字面化 | 部分文字已改；但生产 hash/key／输出自算仍见 `W/B2-01-blocked-commands:77`、`W/B2-14-crr-forms:76`、`B/K3-46-review-advance-failures:498`。 | 接受单纯字面替换可以没有行为 RED；驳回“全部完成”，按原点名实例补齐。 |

must-fix 行：已修 45／部分完成 22／未修 0；ledger 削弱 10 行；假保护 6 组；本轮新增生产缺陷 1 个。