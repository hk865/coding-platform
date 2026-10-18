本次只读审计完成：9 个目标文件共 3,281 行全部读完；没有修改文件，没有运行测试或构建。以下“删除检查后是否失败”均为静态判断，不是实际变异测试结果。

为缩短重复路径，下文不带目录的测试文件均在 `tests/runtime/`，规格文件均在 `docs/refactor/design/orchestration-2026-10/slices/`。共享 helper 的问题按实际实现位置计一次，并列出本组受影响的调用点；不按循环次数或后端次数重复计数。F12 按账本中独立的被削弱条目计数。A1 参数限制、A5 文件隔离和双后端要求另列，不硬套不存在的 F 编号。

**1. COVERAGE**

- `tests/runtime/K3-35-T-by-hand.test.ts` | 4 个测试，178 行 | 全读：是 | F2、F3、F4、F7、F9（含依赖链），F12（600 字节场景） | `suffixOf:93`：A5；`openK3_35PublicRecord`，`tests/helpers/K3-35-continuation-fixture.ts:886`：公开流程部分符合 A1，但递归依赖命中 F2/F3/F4/F7/F9；`prepareWorstCase`，`tests/helpers/K3-35-prepare.ts:107`：读取既有准备结果，不能脱离前置链单独认定合规；`requiredReviewBlock`，`tests/helpers/K3-35-required-review-block.ts:33`：A5；`shellSeam`，`tests/helpers/K3-tool-seams.ts:79`：F4 | 最后测试：`prepare succeeds with the real T = 600 total: 88 bytes more than T = 512, still under the cap`，`:166`。
- `tests/runtime/K3-35-approved-methods-brief.test.ts` | 2 个测试，182 行 | 全读：是 | F2、F3、F4、F7、F9（含依赖链），F12 | `cursorPayload:72`：A5；`openK3_35PublicRecord`：上述 F2/F3/F4/F7/F9；`prepareWorstCase`：同上；`approvedMethodBlockBytes`，`tests/helpers/K3-35-continuation-fixture.ts:198`：A5 手算辅助；`requiredReviewBlock`：A5；`facts.endBoundaryOf`，`tests/helpers/K3-35-continuation-fixture.ts:850`：A1，读取公开执行历史；`shellSeam`：F4 | 最后测试：`K3-35 (二): prepare succeeds on the same Task and carries the required part verbatim`，`:148`。
- `tests/runtime/K3-35-manifest-trim-pure.test.ts` | 1 个测试，418 行 | 全读：是 | clean，限于纯构造、渲染和 fit 算法；不能据此声称执行了真实 `prepare` | `pad:62`、`pathOf:69`、`commandOf:87`、`itemOf:92`、`manifestFor:244`、`measure:270`：A5；直接调用的 `buildUnknownCallReviewInputV1`、`renderUnknownCallReviewZh`、`fitUnknownCallReviewForManifest`：A5 | 最后测试：`K3-35 (一): the 32-item input trims sample, then notVisible, then items from the back; all aliases stay`，`:274`。
- `tests/runtime/K3-35-renderer-boundary.test.ts` | 4 个测试，168 行 | 全读：是 | A5 文件隔离不合规；测试主体属于纯函数测试 | `item:29`、`section:37`、`briefWith:47`、`rendered:51`、`heavySection:57`、`heavyAnomalies:78`、`heavyBrief:106`：A5；`baseBrief`，`tests/helpers/K3-35-continuation-fixture.ts:181`：函数本身纯，但来自同时装配 Store/Host/Runtime 的 helper；`requiredReviewBlock`：函数本身 A5，但其模块在 `tests/helpers/K3-35-required-review-block.ts:10` 又导入上述场景夹具 | 最后测试：`T = 600 throws capacity: the mandatory part alone is 16,396 > 16,384`，`:160`。
- `tests/runtime/K3-35-workspace-baseline-prepare.test.ts` | 1 个测试，218 行 | 全读：是 | F4、F7；服务行没有 memory/SQLite 参数化 | `dirtyGitWorkspace:163`：A1，2,001 个文件用于容量边界，不是 F9；`roleResolution:54`、`hostConfiguration:68`、`executionRecord:85` 经替身端口返回：F4；`bodyStore:120`、`assemblerDouble:141`、`preparation:179`：F4；`loadPreparedManifest` 调用 `:211`：F7 | 最后测试：`K3-35 (四) prepare succeeds and records an unavailable too_many_changes baseline for a >2000-change workspace`，`:205`。
- `tests/runtime/K3-48-3-extremes-pure.test.ts` | 4 个测试，228 行 | 全读：是 | clean，限于纯状态迁移、准入和 codec | `bytes:62`、`buildRecord:64`、`paddedRecord:92`、`context:104`、`expectCodecLegal:116`：A5；`tests/helpers/K3-padded-review-record.ts` 的条目、路径和捕获构造器：A5；用生产序列化长度调整填充量不等于从生产结果取得期望值，最终期望仍固定为 `158_720`，`:131` | 最后测试：`K3-48 (三): a 513-character draft path is refused by the production record codec`，`:201`。
- `tests/runtime/K3-review-preparation.test.ts` | 11 个测试，626 行 | 全读：是 | F2、F3、F4、F6、F7、F9（含依赖链）；6 个纯测试未隔离；服务行未覆盖双后端 | `kernel:64`、`processItem:71`、`review:90` 用于直接纯函数调用时为 A5；它们经 `readReview` 返回给准备服务时为 F4；`roleResolution:233`、`hostConfiguration:247`、`sessionOf:260`、`claimOf:270`、`recordOf:279` 经服务替身使用：F4；`bodyStore:308`：F4；`workPrepare:463`：继承 `openCrrWorld` 的 F2/F3/F4/F6/F9；closure gate `:534`：A3；closure 抛错 `:508`：A2；`setK3TaskDisposition`，`tests/helpers/K3-review-card-fixture.ts:329`：A1；`turnCount:593`：F7 | 最后测试：`a closed Task carries no blocked binding/lines and its prepared start is refused busy`，`:528`。
- `tests/runtime/S3-context-assembler.test.ts` | 15 个测试，832 行 | 全读：是 | F1、F2、F4、F7、F8、F11；7 个纯测试未隔离；服务行未覆盖双后端 | `H:61`、`B:62`、`sectionText:450`、`sha:461`、`c3RunRef:462`、`c3Artifact:463`、`c3ToolCall:466`、`c3Brief:472`：用于纯渲染时为 A5；`planSnapshot:156`、`planOnlySnapshot:192`、`taskRecord:207`、`workRecord:244`、`assemblerInput:254`、`queryFacts:557`：用于服务输入时为 F1；`endedRecordA:248`：F2；`graphContextOf:283`、`taskInputsOf:294`、`bodyStore:315`、`preparationHarness:368`、`extensionsThrowingGraphContext:568`：F4；`ready:409`：仅结果解包，无造事实；`assemblerBase:342` 中未执行的空端口不作为已发生的 F4 返回另计 | 最后测试：`CA15 a throwing extension reader rejects unavailable instead of an empty array`，`:826`。
- `tests/runtime/S4C2-assembly.test.ts` | 7 个测试声明，参数化后 13 行，431 行 | 全读：是 | F1、F3、F4、F7、F11；C-06 只有 memory；helper 接收 `NoteDraftV1` 不符合 A1 参数限制 | `common:165`、`understandingDraft:171`、`generalDraft:177`、`normDraft:182`：普通用户写入内容的构造，不按机器生成事实报 F1；`write:186` 接收 draft：A1 参数限制不合规；`bodyStore:68`、`harness:130`：F4；`prepareOnce:193`：F7；`noteSources:207`、`sectionText:212`：A5；`createS4ANoteFixture` 的项目、文件、计划、注记步骤为 A1，但 `claimRun` 继承 Session 手写事实 F3；`createWP2Platform`：继承 F3；`preparedBundle`，`tests/helpers/WP2-platform-support.ts:914`：公开 prepare 与 material 读取本身为 A1；取消回调 `:284`：A2；图读取计数包装 `:317`：A3 | 最后测试：`C-06 (memory) an ineligible understanding renders one warning line without a body`，`:417`。

UNREAD：目标文件无。

**2. FINDINGS by rule**

下面处置中用到的缺失 helper，含义固定如下；它们是需要补齐的公开入口，不是假称仓库已经存在：

- `helper missing：公共运行世界`：由真实项目/工作区注册、治理配置、计划采用、`runtime.createSession`、claim、prepare、start 建立状态；只收标识、文件内容和脚本模型回复。
- `helper missing：公共核对准备链`：在公共运行世界中让真实工具启动，经过真实历史、分类/认定、核对轮准备；捕获来自真实文件，显示状态来自真实准备清单；结果通过公开 material 读取。
- `helper missing：公共上下文准备链`：公开提交目标、计划、注记、输入材料，真实 Session/claim/prepare；绑定通过 Runtime start，结果通过公开 material 读取。
- `helper missing：公共 Query 链`：公开提交 Query、创建 Session、准备/执行 Query，用脚本模型观察实际模型请求。
- `helper missing：公共接续容量链`：在同一 Task 上通过真实失败、归档、处置、接续产生待测输入，保留真实准备失败及公开状态断言；不得注入 brief、manifest、cursor 或 position。

F1：

- F1 | `S3-context-assembler.test.ts:734`，`CA09 a single 5000-byte input row is omitted whole, never truncated`：把 `assemblerInput(workRecord())` 的手造执行事实直接交给装配服务；构造入口为 `:207`、`:244`、`:254` | 处置(i)：helper missing：公共上下文准备链，用真实提交的 5,000 字节输入材料触发整行省略。
- F1 | `S3-context-assembler.test.ts:746`，`CA10 a plan-only future task writes obligations: 未定义 and never invents acceptance`：构造带 Run 的 `plan_only` 任务绕过 claim 准入 | 处置(ii)：移到 `S3-task-payload-pure.test.ts`，测试现有纯函数 `taskPayload`，`src/core/agent-runtime/context-assembler.ts:769`。
- F1 | `S3-context-assembler.test.ts:758`，`CA11 a legal missing upstream stays ready and reminds with its declaration and tA facts`：手造当前执行和上游执行事实进入装配服务 | 处置(i)：helper missing：公共上下文准备链，公开完成上游 Run、建立输入声明并留下真实缺失选择。
- F1 | `S3-context-assembler.test.ts:797`，`CA13 a Query question with CRLF and Chinese keeps the question and guide verbatim`：`queryFacts()` 的 `record` 是强制转换的空对象，定义在 `:559` | 处置(i)：helper missing：公共 Query 链。
- F1 | `S3-context-assembler.test.ts:815`，`CA14 without extensions all five availability values are not_implemented`：服务接受 `CA_ASSEMBLER_INPUT` 内的手造执行记录，定义在 `:258` | 处置(i)：helper missing：公共上下文准备链，以公开配置不接扩展读取能力。
- F1 | `S4C2-assembly.test.ts:382`，`C-04 (%s) the Query sources are the goal understanding and the norm only`：虽读取真实 Goal/Workspace，却手造 Query facts，尤其 `record: {}`，`:384` | 处置(i)：helper missing：公共 Query 链。
- F1 | `tests/helpers/S5-decision-fixture.ts:736`，影响两个 K3-35 文件的全部场景及三个 closure 测试：`enterClaim` 把 `buildPrepared` 手造的 prepared 值交给 entry owner；构造在 `:698`、`:707`、`:719`、`:725` | 处置(i)：helper missing：公共运行世界，由真实 Runtime prepare 产生该值。

F2：

- F2 | `S3-context-assembler.test.ts:250`，CA11：`endedRecordA` 覆盖构造出的 Run 字段以取得终态事实，随后由 `:755` 的端口返回 | 处置(i)：helper missing：公共上下文准备链，通过真实 Run 结束取得上游事实。
- F2 | `S3-context-assembler.test.ts:633`，CA04：直接覆盖 `run.inputBinding` 和 `run.envelope`，模拟 Runtime 已绑定 | 处置(i)：使用公开 start 后取消的绑定路径，位置 `S4C2-assembly.test.ts:281`、`:295`、`:297`；其基础世界先按本文 F3 修复。
- F2 | `S3-context-assembler.test.ts:635`，CA04：直接覆盖读取替身的 Goal objective | 处置(i)：helper missing：公共上下文准备链，通过目标 owner 修改目标。
- F2 | `S3-context-assembler.test.ts:636`，CA04：直接覆盖扩展读取结果，塞入手造注记索引 | 处置(i)：采用真实注记替换步骤 `S4C2-assembly.test.ts:305`，随后公开 prepare。
- F2 | `tests/helpers/K3-proposal-round.ts:431`，影响 K3-35 核对/提案轮：读取 Host 配置后 spread-then-override `readonlyCommandAccess`，`:432` | 处置(i)：helper missing：在公共运行世界创建 Host 时配置授权，读取包装原样返回真实结果。
- F2 | `tests/helpers/K3-blocked-command-fixture.ts:144`，影响 `K3-review-preparation.test.ts:496`、`:507`、`:528`：`blockedHost` 覆盖已解析配置的 `shellWorkspaceAccess`，`:146` | 处置(i)：helper missing：在公共运行世界的真实 Host 配置入口声明访问范围。

F3：

- F3 | `tests/helpers/S5-decision-fixture.ts:530`，影响上述 K3-35 和 closure 场景：`seedCommit` 直接提交构造的 record/event；实际初始化调用包括 `:543`、`:568`、`:574`、`:816`、`:881`、`:892`、`:906` | 处置(i)：helper missing：公共运行世界，由项目、治理、目标、计划、Query、消息公开 owner 分别建立这些状态。
- F3 | `tests/helpers/S5-decision-fixture.ts:630`，同上：打开 Kernel store 手写 Session | 处置(i)：helper missing：公共运行世界，调用 Runtime 的 Session 创建入口。
- F3 | `tests/helpers/S5-decision-fixture.ts:632`，同上：直接调用 `recordSessionCreated`，自行提供 Kernel identity/history | 处置(i)：helper missing：公共运行世界，让 Runtime 完成登记。
- F3 | `tests/helpers/S5-decision-fixture.ts:715`，同上：直接把手造准备清单写入 body store | 处置(i)：helper missing：公共运行世界，由 Runtime prepare 写清单。
- F3 | `tests/helpers/S5-decision-fixture.ts:736`，同上：测试代替 Runtime 调 entry authorization | 处置(i)：helper missing：公共运行世界，由 Runtime start 授权。
- F3 | `tests/helpers/S5-decision-fixture.ts:739`，同上：测试代替 Runtime 调 begin entry | 处置(i)：helper missing：公共运行世界，由 Runtime start 建立实际进入过程。
- F3 | `tests/helpers/S5-decision-fixture.ts:742`，同上：手写 entered position/history | 处置(i)：helper missing：公共运行世界，由真实 Kernel 执行和 Runtime 记录 entered 事实。
- F3 | `tests/helpers/S5-decision-fixture.ts:869`，同上：初始化直接把消息正文写入 body store，再用 seed 写消息状态 | 处置(i)：helper missing：公共运行世界，通过公开发送和答复消息入口保存正文及状态。
- F3 | `tests/helpers/task-claim-fixture.ts:233`，经 S5、B2、WP2 影响本组调用：直接提交 Project/Workspace/治理快照和构造事件 | 处置(i)：helper missing：公共运行世界，以真实注册、安装、激活建立基础状态。
- F3 | `tests/helpers/task-claim-fixture.ts:324`，同上：直接创建 Kernel Session | 处置(i)：helper missing：公共运行世界，使用 Runtime Session 创建。
- F3 | `tests/helpers/task-claim-fixture.ts:327`，同上：手动登记 Session 完成事实 | 处置(i)：helper missing：公共运行世界，由 Runtime 登记真实完成结果。
- F3 | `tests/helpers/WP2-platform-support.ts:579`，`S4C2-assembly.test.ts:273` 的 C-03：SQLite 分支直接 `commitRaw` 协调策略快照；memory 分支也先调用旧基础夹具，入口 `:331` | 处置(i)：helper missing：公共运行世界，通过真实协调策略安装/激活建立两后端基础。
- F3 | `tests/helpers/S4A-note-fixture.ts:239`，影响 C-01、C-02、PU-03、C-05、C-06 的 `claimRun`，调用分别在 `S4C2-assembly.test.ts:234`、`:263`、`:339`、`:408`、`:423`：直接创建 Kernel Session | 处置(i)：helper missing：公共运行世界，用 Runtime 创建 Session 后保留现有公开 claim。
- F3 | `tests/helpers/S4A-note-fixture.ts:242`，同上五行：直接登记自行提供的 Session 创建事实 | 处置(i)：helper missing：公共运行世界，由 Runtime 完成登记。

F4：

- F4 | `K3-35-T-by-hand.test.ts:58`，该文件全部测试：`ProcessSandbox` 替身报告可用探测结果，没有执行真实探测 | 处置(i)：helper missing：公共核对准备链，使用真实沙箱能力；需要故障时包装真实探测。
- F4 | `K3-35-approved-methods-brief.test.ts:28`，该文件全部测试：相同的成功沙箱探测替身 | 处置(i)：helper missing：公共核对准备链，使用真实探测。
- F4 | `tests/helpers/K3-tool-seams.ts:79`，上述 K3-35 及 closure 场景：shell 替身把 `requiredCapabilities` 清空，`:85`，等待后返回构造的成功 ToolResult，`:93`；没有委托真实 shell | 处置(i)：helper missing：围绕真实 shell 的 A3 gate，放行后返回真实结果。
- F4 | `tests/helpers/K3-proposal-round.ts:571`，K3-35 的核对/提案定稿：`readReviewDisplays` 直接把所有别名映射为 `full`，`:573` | 处置(i)：helper missing：公共核对准备链，从实际冻结清单读取每个条目的 display。
- F4 | `tests/helpers/K3-crr-fixture.ts:157`，三个 closure 测试经 `K3-review-preparation.test.ts:467` 调用：source capture 固定返回 `'a'.repeat(64)`，正中裁定 §3.4 | 处置(i)：改用真实工作树 capture；现成实现入口为 `tests/helpers/K3-35-continuation-fixture.ts:493` 的真实 workspace reader。
- F4 | `tests/helpers/K3-blocked-command-fixture.ts:407`，三个 closure 测试的前置世界：按 `files[path]` 构造 `WorkspaceFile` 或 `not_found`，`:412`、`:416` | 处置(i)：helper missing：公共核对准备链，将内容写入真实工作区后交真实 workspace reader。
- F4 | `K3-35-workspace-baseline-prepare.test.ts:120`，K3-35（四）：自行实现 Map body store，不是 A4 的同一真实后端工厂包装 | 处置(i)：helper missing：公共运行世界，共用真实 body backend。
- F4 | `K3-35-workspace-baseline-prepare.test.ts:141`，K3-35（四）：assembler 固定返回 `k335-input`、手造 binding 和空选择，`:144` | 处置(i)：helper missing：公共上下文准备链。
- F4 | `K3-35-workspace-baseline-prepare.test.ts:182`，K3-35（四）：执行读取返回手造 `executionRecord()` | 处置(i)：helper missing：公共运行世界，通过真实 claim 得到 starting Run。
- F4 | `K3-35-workspace-baseline-prepare.test.ts:183`，K3-35（四）：角色读取返回手造 resolution | 处置(i)：helper missing：公共运行世界，真实安装和解析角色。
- F4 | `K3-35-workspace-baseline-prepare.test.ts:185`，K3-35（四）：配置解析端口固定返回构造配置 | 处置(i)：helper missing：公共运行世界，通过真实 Host 配置解析。
- F4 | `K3-35-workspace-baseline-prepare.test.ts:187`，K3-35（四）：root 解析端口直接宣布工作区 revision 1，没有对应公开注册事实 | 处置(i)：helper missing：公共运行世界，真实注册临时工作区并解析 root。
- F4 | `K3-35-workspace-baseline-prepare.test.ts:188`，K3-35（四）：授权端口直接返回全读 grant | 处置(i)：helper missing：公共运行世界，通过真实 Host 授权入口取得 grant。
- F4 | `K3-review-preparation.test.ts:308`，L13-5、L13-7：Map body store 返回构造 ArtifactRef；L13-7 又在 `:388` 预装构造 capture body | 处置(i)：helper missing：公共核对准备链，使用同一真实 body backend 和真实捕获。
- F4 | `K3-review-preparation.test.ts:336`，L13-5：执行端口返回 `ROUND_RECORD`/`ORIGIN_RECORD` | 处置(i)：helper missing：公共核对准备链。
- F4 | `K3-review-preparation.test.ts:338`，L13-5：角色端口返回手造 resolution | 处置(i)：helper missing：公共核对准备链，真实角色解析。
- F4 | `K3-review-preparation.test.ts:340`，L13-5：Host 配置端口返回手造配置 | 处置(i)：helper missing：公共核对准备链，真实 Host 配置。
- F4 | `K3-review-preparation.test.ts:341`，L13-5：review 端口把 `review()` 构造的多条目事实作为已保存记录返回 | 处置(i)：helper missing：公共核对准备链，服务场景只使用真实可达记录。
- F4 | `K3-review-preparation.test.ts:342`，L13-5：Kernel registry 固定返回 null，原始命令事实没有来自真实 registry | 处置(i)：helper missing：公共核对准备链，连接原始 Run 的真实 Kernel store。
- F4 | `K3-review-preparation.test.ts:393`，L13-7：执行端口返回构造的 round/origin 记录 | 处置(i)：helper missing：公共核对准备链。
- F4 | `K3-review-preparation.test.ts:395`，L13-7：角色端口返回构造 resolution | 处置(i)：helper missing：公共核对准备链，真实角色解析。
- F4 | `K3-review-preparation.test.ts:397`，L13-7：Host 端口返回构造配置 | 处置(i)：helper missing：公共核对准备链，真实 Host 配置。
- F4 | `K3-review-preparation.test.ts:398`，L13-7：review 端口返回测试拼出的 250-path capture 引用及 50-path sample | 处置(i)：helper missing：公共核对准备链，在真实工作区产生 250 个变化并完成捕获。
- F4 | `K3-review-preparation.test.ts:399`，L13-7：Kernel registry 固定返回 null | 处置(i)：helper missing：公共核对准备链，使用实际 registry。
- F4 | `K3-review-preparation.test.ts:483`，三个 closure 测试：准备服务仍由本地端口返回构造 Host 配置 | 处置(i)：helper missing：公共运行世界，保留 closure 的 A2/A3 包装，改接真实 Host。
- F4 | `S3-context-assembler.test.ts:283`，CA09、CA10、CA11、CA13：`graphContextOf` 返回传入的手造 facts，`:286` | 处置(i)：helper missing：公共上下文准备链；CA10 的事实构造随该行移到纯函数文件。
- F4 | `S3-context-assembler.test.ts:294`，CA09、CA11、CA13：`taskInputsOf` 返回手造 selection/page，`:296`、`:298` | 处置(i)：helper missing：公共上下文准备链，通过真实输入声明、提交和选择取得结果。
- F4 | `S3-context-assembler.test.ts:315`，CA03、CA04、CA15：自制 body store 返回构造引用并在测试内实现去重 | 处置(i)：helper missing：公共上下文准备链，共用真实 body backend。
- F4 | `S3-context-assembler.test.ts:377`，CA03、CA04：所谓计数包装实际返回 `structuredClone(facts.current)`，`:380`，没有真实委托 | 处置(i)：helper missing：公共上下文准备链，在真实 graph reader 外计数。
- F4 | `S3-context-assembler.test.ts:386`，CA03、CA04、CA15：输入读取端口固定返回空选择或 not_found，`:387`、`:388` | 处置(i)：helper missing：公共上下文准备链，在真实 task-input reader 外计数。
- F4 | `S3-context-assembler.test.ts:392`，CA03、CA04、CA15：执行读取返回本地 `record` | 处置(i)：helper missing：公共上下文准备链。
- F4 | `S3-context-assembler.test.ts:393`，CA03、CA04、CA15：角色读取返回本地 resolution | 处置(i)：helper missing：公共上下文准备链，真实角色解析。
- F4 | `S3-context-assembler.test.ts:395`，CA03、CA04、CA15：Host 配置读取返回本地配置 | 处置(i)：helper missing：公共上下文准备链，真实 Host 配置。
- F4 | `S3-context-assembler.test.ts:568`，CA15：所谓 extension 故障在测试自己定义、调用并 catch；返回给生产层的已经是构造好的 `unavailable`，`:580` | 处置(i)：helper missing：在真实 graph-context 组件使用的真实 extension reader 外注入一次抛错。
- F4 | `S4C2-assembly.test.ts:68`，C-01、C-02、PU-03、C-05、C-06：自制 Map body store | 处置(i)：使用 `preparedBundle` 的公开 material 读取形状，`tests/helpers/WP2-platform-support.ts:914`，基础世界按本文 F3 修复。
- F4 | `S4C2-assembly.test.ts:138`，上述五行及 C-04 harness：角色端口固定宣告 `absent`，`:140` | 处置(i)：helper missing：公共上下文准备链，真实解析不存在或存在的角色配置。
- F4 | `S4C2-assembly.test.ts:144`，上述 harness：Host 端口返回本地 `runtimeConfiguration(config)` | 处置(i)：helper missing：公共上下文准备链，通过真实 Host 配置选项设置 resident budget。

F5：本组已读路径中未发现无真实原因重复发送通知或触发器的实例。

F6：

- F6 | `tests/helpers/K3-blocked-command-fixture.ts:367`，三个 closure 测试的前置链：直接以 `review_unavailable` 调 settlement，未先让真实能力探测或依赖失败产生该原因 | 处置(i)：helper missing：公共核对准备链，在真实只读能力依赖上注入不可用，再由 Workflow 定稿。

F7：

- F7 | `tests/helpers/K3-35-prepare.ts:97`，两个 K3-35 场景文件：直接 `loadPreparedManifest(bodies, prepared)` 读取 body store，后续结果成为测试断言依据 | 处置(i)：使用公开 material 读取形状 `tests/helpers/WP2-platform-support.ts:919`。
- F7 | `tests/helpers/K3-35-continuation-fixture.ts:949`，两个 K3-35 场景文件：直接读取 requeue record store，再以存在性检查和 JSON 解码验证前置事实，`:953`、`:954` | 处置(i)：helper missing：按 requeue 标识读取公开任务返工事实的 helper。
- F7 | `K3-35-workspace-baseline-prepare.test.ts:211`，K3-35（四）：直接从 raw bodies 加载准备清单断言 baseline | 处置(i)：使用公开 material 读取形状 `tests/helpers/WP2-platform-support.ts:919`。
- F7 | `K3-review-preparation.test.ts:353`，L13-5：raw bodies 读清单后断言工具、范围及 section | 处置(i)：使用公开 material 读取形状 `tests/helpers/WP2-platform-support.ts:919`。
- F7 | `K3-review-preparation.test.ts:409`，L13-7：raw bodies 读清单后断言路径样本 | 处置(i)：使用公开 material 读取形状 `tests/helpers/WP2-platform-support.ts:919`。
- F7 | `K3-review-preparation.test.ts:572`，closed Task 测试：直接从 body store 读取清单判断 blocked binding/文本 | 处置(i)：使用公开 material 读取形状 `tests/helpers/WP2-platform-support.ts:919`。
- F7 | `K3-review-preparation.test.ts:593`，closed Task 测试：`turnCount` 打开 Kernel store，读取并筛 `turn.started`，`:598`、`:599`；`:604`、`:620` 用作前后断言 | 处置(i)：helper missing：通过公开执行历史读取新增 Turn，保留现有公开 Run 未变化断言。
- F7 | `S3-context-assembler.test.ts:626`，CA03：断言自制 body store 的内部 Map 大小 | 处置(i)：helper missing：公共上下文准备链，通过公开 ArtifactRef/读取证明相同内容寻址结果。
- F7 | `S4C2-assembly.test.ts:200`，C-01、C-02、PU-03、C-05、C-06：`prepareOnce` 直接读 raw body store 并 JSON.parse，`:203` | 处置(i)：使用公开读取 helper `preparedBundle`，`tests/helpers/WP2-platform-support.ts:914`。

F8：

- F8 | `S3-context-assembler.test.ts:595`，CA01：完整期望 `CA01_INPUT` 在 `:427` 嵌入生产 `WORK_CONTEXT_PRELUDE`，改坏生产常量会同步改变期望 | 处置(ii)：移到 `S3-context-renderer-pure.test.ts` 测 `renderContext`，把完整 prelude 固定为规格文字。
- F8 | `S3-context-assembler.test.ts:596`，CA01：期望字节数仍由同一受生产常量污染的 `CA01_INPUT` 计算 | 处置(ii)：同一纯文件，使用独立手算输入的字节数。
- F8 | `S3-context-assembler.test.ts:597`，CA01：期望摘要仍来自上述污染文本 | 处置(ii)：同一纯文件，对独立固定文本计算摘要。
- F8 | `S3-context-assembler.test.ts:676`，CA06：复用含生产 prelude 的 `CA01_INPUT` | 处置(ii)：移到 `S3-context-renderer-pure.test.ts` 测 `renderContext`，使用独立完整文本。
- F8 | `S3-context-assembler.test.ts:709`，CA08：`:704` 的 expected 插入生产 `WORK_CONTEXT_PRELUDE` | 处置(ii)：移到 `S3-context-renderer-pure.test.ts`，固定完整零预算文本。
- F8 | `S3-context-assembler.test.ts:711`，CA08：期望总字节数来自上述污染文本 | 处置(ii)：同一纯文件，按独立固定文本手算。
- F8 | `S3-context-assembler.test.ts:718`，CA08：负向期望取生产 `CONTEXT_SECTION_HEADERS.footprint` | 处置(ii)：同一纯文件，使用规格固定标题。
- F8 | `S3-context-assembler.test.ts:719`，CA08：负向期望取生产 `CONTEXT_SECTION_HEADERS.notes` | 处置(ii)：同一纯文件，使用规格固定标题。
- F8 | `S3-context-assembler.test.ts:720`，CA08：负向期望取生产 `CONTEXT_SECTION_HEADERS.reminders` | 处置(ii)：同一纯文件，使用规格固定标题。
- F8 | `S3-context-assembler.test.ts:721`，CA08：负向期望取生产 `CONTEXT_SECTION_HEADERS.inputs` | 处置(ii)：同一纯文件，使用规格固定标题。
- F8 | `S3-context-assembler.test.ts:805`，CA13：`:802` 先把生产 `INITIAL_COORDINATION_RESPONSE_GUIDE` 填进问题，再断言同一常量存在 | 处置(i)：helper missing：公共 Query 链，期望指南取自规格固定文字。

F9：

- F9 | `tests/helpers/K3-proposal-round.ts:356`，两个 K3-35 场景文件：`waitForEntered` 用 10 毫秒 sleep 轮询，调用在 `:444` | 处置(i)：helper missing：真实 Runtime entered 依赖外的 A3 gate，以实际进入事件放行。
- F9 | `tests/helpers/K3-blocked-command-fixture.ts:350`，三个 closure 测试：用 5 毫秒 sleep 轮询 watched calls | 处置(i)：helper missing：真实工具调用入口的 A3 gate。

F10：未发现可确认实例；`S4C2-assembly.test.ts:317` 的真实 graph reader 计数发生在一次后续 prepare 周围，`:318`、`:321`；closure gate 也控制实际一次读取，`K3-review-preparation.test.ts:534`，不因包装位于读取层就自动报 F10。

F11：

- F11 | `S3-context-assembler.test.ts:808`，CA13：检查的是新建的测试配置对象，`:809` 亦然，`:810` 检查静态常量；即使生产模型请求把动态 Goal/问题写入 system prompt，这些断言也不变 | 处置(i)：helper missing：公共 Query 链，检查脚本模型实际收到的 system/user 消息。
- F11 | `S3-context-assembler.test.ts:827`，CA15：异常到 `unavailable` 的转换已在测试 helper `:578` 完成；移除生产 extension 异常处理，不会改变该 helper 返回的拒绝结果 | 处置(i)：helper missing：在真实 extension reader 的依赖上注入抛错，保留真实转换层。
- F11 | `S4C2-assembly.test.ts:227`，C-01：五个不同注记在 `:227` 至 `:231` 分别写入，没有规格要求的 task/module 重叠注记；`:241` 的五来源断言不能保护去重，生产去重位置包括 `src/core/agent-runtime/context-assembler.ts:217` | 处置(i)：helper missing：公共上下文准备链，建立规格规定的两组各两条且有一条重叠的真实注记。
- F11 | `S4C2-assembly.test.ts:338`，PU-03：使用默认预算，未构造规格要求的零预算；`:352` 的五条规范存在断言不能证明规范不受可选预算裁剪，必需 Goal 部分在 `src/core/agent-runtime/context-assembler.ts:306` | 处置(i)：helper missing：公共上下文准备链，通过 Host 平台选项把该行预算设为零。
- F11 | `S4C2-assembly.test.ts:425`，C-06：只检查“包含警示”和“不包含当前理解标签”，`:426`，没有检查警示恰好一次或正文完全不存在；重复警示或额外泄漏正文仍可能通过，待保护分支在 `src/core/agent-runtime/context-assembler.ts:682` | 处置(i)：helper missing：公共上下文准备链，公开读取完整输入后对警示次数及独特正文标记作精确断言。

F12：以下旧行号来自 D1，当前行号另列；不能以“换成真实链”为由自动免除未被指定删除的断言。

- F12 | D1 `:108`，旧测试 `K3-35 (二): renders the 16 KiB-bounded worst case with every mandatory line and no callId`：旧断言检查 brief 中有 8 个锚点；现在 `K3-35-approved-methods-brief.test.ts:116` 只检查世界中的 anchors，而 `:171` 明确要求准备文本没有异常锚点，非等价 | 处置(ii)：在 `K3-35-renderer-boundary-pure.test.ts` 中对 `renderContinuationBriefZh` 恢复八个必需锚点的独立断言。
- F12 | D1 `:109`，同一旧测试：旧断言检查进入 brief 的每个锚点 Task 为 512 字节；当前 `K3-35-approved-methods-brief.test.ts:118` 只检查外部 facts 的 Task 相同 | 处置(ii)：在上述纯文件恢复渲染用八锚点的 512 字节前提及输出断言。
- F12 | D1 `:110`，同一旧测试：10 个 omitted anchors 只作为纯输入留在 `K3-35-renderer-boundary.test.ts:78` 的构造路径，未恢复对其输出计数的断言 | 处置(ii)：在上述纯文件恢复异常锚点省略计数行的精确断言。
- F12 | D1 `:111`，同一旧测试：`WORST_REASON.length > 60` 前提断言被移除；当前 `K3-35-approved-methods-brief.test.ts:119` 检查原因相等，不检查超过截断界限 | 处置(ii)：在上述纯文件恢复 `renderContinuationBriefZh` 长原因边界前提。
- F12 | D1 `:114`，同一旧测试：完整文本 `toBe` 变成当前 `K3-35-approved-methods-brief.test.ts:167` 的必需子块相等及若干包含检查；正文和整体顺序的完整 oracle 丢失 | 处置(ii)：在上述纯文件保留独立完整渲染文本期望。
- F12 | D1 `:123`，同一旧测试：非空省略说明的前提断言没有迁移；当前 `K3-35-renderer-boundary.test.ts:150` 只检查标题消失 | 处置(ii)：在上述纯文件恢复手算的省略说明前提。
- F12 | D1 `:124`，同一旧测试：正文省略说明必须出现的断言没有迁移；当前 `K3-35-renderer-boundary.test.ts:156` 只是排除另一种 blocked count 行 | 处置(ii)：在上述纯文件对实际正文省略行及计数作精确断言。
- F12 | D1 `:125`，同一旧测试：旧全正文省略场景中 process callId 不得残留的断言未迁移；`requiredReviewBlock` 在 `tests/helpers/K3-35-required-review-block.ts:38` 会过滤可选结论行，因此子块相等不能替代它 | 处置(ii)：在上述纯文件对完整输出恢复 process callId 不残留断言。
- F12 | D1 `:126`，同一旧测试：旧场景中 `- #1 =` 可选正文必须被省略的断言未迁移，同样被子块提取过滤掉 | 处置(ii)：在上述纯文件对完整输出恢复可选正文省略断言。
- F12 | D1 `:127`，同一旧测试：平台 callId 不残留断言未迁移；当前 `K3-35-renderer-boundary.test.ts:155` 仅比较提取的必需子块 | 处置(ii)：在上述纯文件对完整输出恢复所有平台 callId 检查。
- F12 | D1 `:131`，旧测试 `K3-35 (三): 600-byte anchor task ids make the renderer throw capacity and prepare reject`：当前 `K3-35-T-by-hand.test.ts:159` 检查的是 Task 自身，未等价恢复八个进入容量样例的 600 字节锚点前提 | 处置(ii)：在上述纯文件恢复八锚点的 600 字节前提断言。
- F12 | D1 `:132`，同一旧测试：T=512 必需部分的精确字节断言被移除；当前 `K3-35-renderer-boundary.test.ts:157` 只断言总输出不超上限 | 处置(ii)：在上述纯文件按新模板手算并精确断言必需部分字节数。
- F12 | D1 `:133`，同一旧测试：超限必需部分的精确字节断言被移除；新值 16,396 仅写在 `K3-35-renderer-boundary.test.ts:163` 注释 | 处置(ii)：在上述纯文件把独立手算的 16,396 字节变成断言。
- F12 | D1 `:134`，同一旧测试：数值“确实大于 16,384”的断言被移除，仅剩 `K3-35-renderer-boundary.test.ts:165` 抛错断言，不能独立证明测试输入确实越界 | 处置(ii)：在上述纯文件恢复手算必需部分大于上限的断言。
- F12 | D1 `:135`，同一旧测试：八锚点的差值 `8 × (600−512)` 不再断言；当前 `K3-35-T-by-hand.test.ts:166` 声称的是单 Task 增长 88 字节，是另一种输入 | 处置(ii)：在上述纯文件恢复八锚点 704 字节差值断言。
- F12 | D1 `:136`，同一旧测试：真实 prepare 从 `rejected` 改成 `K3-35-T-by-hand.test.ts:168` 的 `ready`；原任务书没有授权把 K3-35（三）改为成功 | 处置(i)：helper missing：公共接续容量链，恢复真实 prepare 拒绝；目前记为待裁定缺口，不能关闭此行。
- F12 | D1 `:137`，同一旧测试：真实 prepare 的 `capacity` 错误码断言丢失，纯 renderer 的异常类型不能替代服务错误码 | 处置(i)：helper missing：公共接续容量链，恢复公开 prepare 的 `capacity` 断言。
- F12 | D1 `:432`，旧测试 `K3-35 (二): renders the 16 KiB-bounded worst case with every mandatory line and no callId`：新场景 `K3-35-approved-methods-brief.test.ts:148` 与纯场景 `K3-35-renderer-boundary.test.ts:144` 合起来仍未保留上述完整文本、正文省略和 callId 断言 | 处置(ii)：在 `K3-35-renderer-boundary-pure.test.ts` 完整承接该旧行的纯渲染义务。
- F12 | D1 `:433`，旧测试 `K3-35 (三): 600-byte anchor task ids make the renderer throw capacity and prepare reject`：只迁移 renderer 抛错，服务拒绝部分反转为成功 | 处置(i)：helper missing：公共接续容量链，承接原服务拒绝行。

默认禁止、但不另造 F 编号的实例：

- A5 | `K3-35-renderer-boundary.test.ts:117`，16 位计数行 | 处置(ii)：移到 `K3-35-renderer-boundary-pure.test.ts`，测 `renderContinuationBriefZh`，抽离纯数据依赖。
- A5 | `K3-35-renderer-boundary.test.ts:133`，62 字节句子 | 处置(ii)：同一纯文件，测 `renderContinuationBriefZh`。
- A5 | `K3-35-renderer-boundary.test.ts:144`，T=512 | 处置(ii)：同一纯文件，测 `renderContinuationBriefZh`。
- A5 | `K3-35-renderer-boundary.test.ts:160`，T=600 | 处置(ii)：同一纯文件，测 `renderContinuationBriefZh`。
- A5 | `K3-review-preparation.test.ts:122`，L13-1 | 处置(ii)：移到 `K3-review-input-pure.test.ts`，测 `buildUnknownCallReviewInputV1`。
- A5 | `K3-review-preparation.test.ts:149`，L13-2 | 处置(ii)：移到同一纯文件，测 `buildUnknownCallReviewInputV1`。
- A5 | `K3-review-preparation.test.ts:163`，L13-3 | 处置(ii)：移到同一纯文件，测 `renderUnknownCallReviewZh`。
- A5 | `K3-review-preparation.test.ts:178`，L13-4 | 处置(ii)：移到同一纯文件，测 `trimUnknownCallReviewInput`。
- A5 | `K3-review-preparation.test.ts:418`，L13-8 | 处置(ii)：移到同一纯文件，测 `buildUnknownCallReviewInputV1`。
- A5 | `K3-review-preparation.test.ts:432`，L13-6 | 处置(ii)：移到同一纯文件，测 `fitUnknownCallReviewForManifest`。
- A5 | `S3-context-assembler.test.ts:590`，CA01 | 处置(ii)：移到 `S3-context-renderer-pure.test.ts`，测 `renderContext`。
- A5 | `S3-context-assembler.test.ts:602`，CA02 | 处置(ii)：移到同一纯文件，测 `renderContext`。
- A5 | `S3-context-assembler.test.ts:655`，CA05 | 处置(ii)：移到同一纯文件，测 `renderContext`。
- A5 | `S3-context-assembler.test.ts:671`，CA06 | 处置(ii)：移到同一纯文件，测 `renderContext`。
- A5 | `S3-context-assembler.test.ts:684`，CA07 | 处置(ii)：移到同一纯文件，测 `renderContext`。
- A5 | `S3-context-assembler.test.ts:701`，CA08 | 处置(ii)：移到同一纯文件，测 `renderContext`。
- A5 | `S3-context-assembler.test.ts:770`，CA12 | 处置(ii)：移到同一纯文件，测 `renderContext` 与 `renderContinuationBriefZh` 的组合。
- A1 参数限制 | `S4C2-assembly.test.ts:186`，注记场景的 `write(f, draft, goalId)`，以及 `tests/helpers/S4A-note-fixture.ts:281` 的透传 helper 接收完整 draft | 处置(i)：helper missing：只收 anchor 标识、topic、正文和关联标识的公开注记写入 helper。
- 双后端要求 | `K3-35-T-by-hand.test.ts:102`、`:155`：只开 SQLite，无 Host restart 专属理由 | 处置(i)：修复公共接续容量链后按 memory、SQLite 参数化。
- 双后端要求 | `K3-35-approved-methods-brief.test.ts:83`：只开 SQLite，无 Host restart 专属理由 | 处置(i)：同上。
- 双后端要求 | `K3-35-workspace-baseline-prepare.test.ts:179`：没有真实后端参数 | 处置(i)：公共运行世界分别跑 memory、SQLite。
- 双后端要求 | `K3-review-preparation.test.ts:333`、`:376`、`:496`、`:507`、`:528`：服务行未覆盖两个真实后端 | 处置(i)：公共核对准备链分别跑 memory、SQLite。
- 双后端要求 | `S3-context-assembler.test.ts:618`、`:629`、`:727`、`:753`、`:794`、`:813`、`:826`：服务行未覆盖两个真实后端 | 处置(i)：公共上下文/Query 链分别跑 memory、SQLite。
- 双后端要求 | `S4C2-assembly.test.ts:418`，C-06：显式仅 memory | 处置(i)：使用 `:43` 的双后端列表参数化该服务行。

T 仅列已被裁定明确放入 T 的文件；本组调用者不随之进入 T：

- T | `tests/helpers/B2-execution-fixture.ts:220`、`:277`、`:291`、`:301`：手造 prepared、直接 entry 写入及 entered position；裁定名单在 `.lead-ref/k3-b3-rulings-v1.md:10` | 处置(iv)：T；其上层 S5/K3 调用仍按本文 F1/F3 处理。
- T | `tests/helpers/B2-runtime-fixture.ts:195`、`:197`：raw 协调策略提交及 Session role 覆盖；该文件在同一 T 名单；其 `createScriptedModel:69` 单独符合 A1，不因文件有其他问题而否定脚本模型机制 | 处置(iv)：T。

**3. ROWS**

以下每行给出实际断言、来源、后端及静态敏感性。“部分”表示能保护列出的局部行为，不能据此签收整条规格。

- K3-35（二）前提 | `K3-35-T-by-hand.test.ts:105` | 字面量：Task 512 字节、1 个 process、1 个 blocked command、8 个唯一归档锚点；来自本地 Task 构造和任务书 `.lead-ref/k3-g4b3-impl.md:59`、`:257` | SQLite | 部分：能发现公开结果数量改变；不是准备清单包含八锚点的证明，实际 prepare 文本另在 `:148` 排除异常节。
- K3-35（二）容量 | `K3-35-T-by-hand.test.ts:134` | `ready`、12,676、≤16,384、必需子块全文；手算在 `:25`，规格上限 `slice-K3-SPEC.md:556` | SQLite | 部分：删除必需子块输出会失败，生产位置 `src/contracts/continuation-brief.ts:895`；仅删除超限拒绝分支 `:482`，该成功输入仍会通过。
- K3-35（三）前提 | `K3-35-T-by-hand.test.ts:158` | Task 600 字节；来自本地 `TASK_600`，`:91` | SQLite | 只检查真实记录归属，未保护八个 600 字节异常锚点进入 brief。
- K3-35（三）现有成功行 | `K3-35-T-by-hand.test.ts:166` | `ready`、12,764、比 512 情形多 88；手算在文件开头，规格却要求 `capacity`，`slice-K3-SPEC.md:1435` | SQLite | 否：没有执行或保护 `src/contracts/continuation-brief.ts:482` 的超限拒绝；见 F12。
- K3-35（二）方法前提 | `K3-35-approved-methods-brief.test.ts:87` | 1 个方法、1 个 target、1 个 blocked command、8 个真实锚点、命令 3,892 字节/600 换行、方法块 5,120；手算 `:141`，方法上限来自 `slice-K3-SPEC.md:550` | SQLite | 部分：保留原命令/方法内容能发现结果改变；这里没有超 5,120 的拒绝输入，不能证明 owner 上限拒绝。
- K3-35（二）方法渲染 | `K3-35-approved-methods-brief.test.ts:148` | `ready`、12,171、≤16,384、必需块全文；手算 `:153`，固定模板 `slice-K3-SPEC.md:561` | SQLite | 部分：方法逐字保持受 `src/contracts/continuation-brief.ts:925` 保护；不能证明“最坏八锚点”容量，当前 `:171` 要求无异常节。
- K3-35（一） | `K3-35-manifest-trim-pure.test.ts:274` | 32 项、200 路径、32 notVisible、4,096/65,536/262,144 字节、按 sample→notVisible→倒序 item 收缩、别名保留；来源 `slice-K3-SPEC.md:359` 至 `:365`、`:1435`，本地常量 `:56` | 无后端，A5 | 是，针对纯 fit/trim：`src/core/agent-runtime/context-assembler.ts:484`、`src/core/agent-runtime/execution-preparation.ts:108`、`:114`；但没有调用真实 `prepare` 的 `buildManifest:520` 和最终上限检查 `:565`。
- K3-35（一）完整测量范围 | `K3-35-manifest-trim-pure.test.ts:378` | 本地 `manifestFor` 的字段集合、input、digest、section 边界；返工 6 第 7 项要求完整合法 manifest，`.lead-ref/k3-g4b3-rework-6.md:67` | 无后端 | 对本地测量输入有校验；删除生产 `buildManifest` 字段不一定使它失败，因为它检查的是 `:244` 的本地 builder，不能把这部分写成生产装配覆盖。
- K3-35/L20 计数 | `K3-35-renderer-boundary.test.ts:117` | `9007199254740991`、16 位、141 字节、比 0 多 15；手算 `:122`，模板 `slice-K3-SPEC.md:562`、`:580` | 无后端 | 是：计数行变化会触及 `src/contracts/continuation-brief.ts:900`。
- K3-35/B2 必需句 | `K3-35-renderer-boundary.test.ts:133` | 两句固定文本及新增 63 字节；62 字节句子加一个换行，任务书 `.lead-ref/k3-g4b3-impl.md:153` | 无后端 | 是：删除条件必需句 `src/contracts/continuation-brief.ts:934` 会失败。
- K3-35（二）纯边界 | `K3-35-renderer-boundary.test.ts:144` | T512、完整必需块、无 blocked heading、≤16,384；来源 `slice-K3-SPEC.md:556`、`:587` | 无后端 | 是，保护可选 blocked 节先被删及必需块保留；容量求解位于 `src/contracts/continuation-brief.ts:428`、`:475`；精确省略计数尚缺，见 F12。
- K3-35（三）纯边界 | `K3-35-renderer-boundary.test.ts:160` | 抛 `ContinuationBriefCapacityError`；16,396 的手算仅在 `:162` 注释 | 无后端 | 是，删除 renderer 超限抛错 `src/contracts/continuation-brief.ts:482` 会失败；否，不能保护 prepare 对异常的映射 `src/core/agent-runtime/context-assembler.ts:1702`。
- K3-35（四） | `K3-35-workspace-baseline-prepare.test.ts:205` | 2,001 个真实变化、`ready`、`unavailable/too_many_changes`；来源 `slice-K3-SPEC.md:1435` | 自制端口，无双真实后端 | 是，局部保护 `src/core/workspace/workspace-change-capture.ts:260` 的路径数限制；文件在 `:216` 结束断言，没有测试“之后 Run 不自动收尾”。
- K3-48（三）B 边界 | `K3-48-3-extremes-pure.test.ts:122` | 32 项、32 notVisible、精确 158,720、codec round-trip、optional/required 均准入；B 来自 `slice-K3-SPEC.md:261` | 无后端，A5 | 部分：能保护 B 的边界关系；仅成功等号点不能单独保护超限拒绝，拒绝在同文件下一行覆盖；生产准入 `src/core/work-graph/state/unknown-call-review.ts:221`。
- K3-48（三）必须写 | `K3-48-3-extremes-pure.test.ts:139` | settlement revision2/needs_decision/三原因，hold revision3/resolved/held，release revision4/released；写后 >158,720 且 ≤524,288，optional `capacity`、required 准入；来源 L7/L16/L21 和 `slice-K3-SPEC.md:1440` | 无后端，A5 | 是，保护 B 以上 required/optional 区分，检查 `src/core/work-graph/state/unknown-call-review.ts:231`；状态分支为 `:406`、`:575`、`:598`；未覆盖该规格列出的卡上 disposition/approval 全部路径。
- K3-48 常量钉值 | `K3-48-3-extremes-pure.test.ts:194` | 158,720、524,288；生产常量在 actual 一侧，字面量在 expected 一侧 | 无后端 | 是，常量漂移会失败；定义 `src/core/work-graph/state/unknown-call-review.ts:35`。这不是 F8。
- K3-48/L7 路径 | `K3-48-3-extremes-pure.test.ts:201` | 513 字符路径、codec invalid、精确原因、schema invalid；512 上限来自 L7，手工输入 `:204` | 无后端，A5 | 是：在记录总大小仍合法的前提下只引入路径错误，删除 `src/core/work-graph/tasks/unknown-call-review-codecs.ts:254` 的路径界限会使该行失效；不要求 A6 的 owner 拒绝分组。
- K3-L13-1 | `K3-review-preparation.test.ts:122` | revision7、round1、别名 `[1,2,3]`、sameBatch `[2]`、既有结论、sample/omitted；来自本地手工记录及 `slice-K3-SPEC.md:352` 至 `:364` | 无后端，纯行待迁移 | 是，保护 process 筛选、别名和字段投影，`src/core/agent-runtime/context-assembler.ts:423`、`:444`、`:447`。
- K3-L13-2 | `K3-review-preparation.test.ts:149` | 5,000 字节命令截断、command+cwd≤4,096、另一项全文不变；规格 `slice-K3-SPEC.md:360` | 无后端，纯行待迁移 | 是，保护 `src/core/agent-runtime/context-assembler.ts:430`、`:435`。
- K3-L13-3 | `K3-review-preparation.test.ts:163` | 只核对、不重跑、两问题、工作区提醒、已有结论；规格 `slice-K3-SPEC.md:353`、`:357` | 无后端，纯行待迁移 | 是，删除相应 renderer 行会失败；渲染函数与本文件调用位置 `:167` 对应。
- K3-L13-4 | `K3-review-preparation.test.ts:178` | 手算九步状态序列及最终 null，`:189`；规格收缩顺序 `slice-K3-SPEC.md:362` | 无后端，纯行待迁移 | 是，保护 `src/core/agent-runtime/context-assembler.ts:486`、`:490`、`:494`。
- K3-L13-5 | `K3-review-preparation.test.ts:333` | 固定工具、空写范围、`ks/null` sessionBasis、三个别名、末尾核对 section；工具依据 `slice-K3-SPEC.md:367`，其他身份来自手造夹具 | 无真实后端 | 部分：能保护工具/范围分支 `src/core/agent-runtime/execution-preparation.ts:403`、`:408`；前置状态和观测 F4/F7；`:369` 再渲染实际结构用于一致性检查，不能单独充当完整固定文本 oracle。
- K3-L13-7 | `K3-review-preparation.test.ts:376` | 从 250 条取前200、首尾 `path-0.ts`/`path-199.ts`、omitted50；手算 250−200，规格 `slice-K3-SPEC.md:355` | 无真实后端 | 是，局部区分 full capture 与 50 条 sample，相关读取 `src/core/agent-runtime/context-assembler.ts:1011`、`:1016`，截取 `:458`；仍有 F4/F7。
- K3-L13-8 | `K3-review-preparation.test.ts:418` | 3,000 个“中”=9,000 UTF-8 字节，最终 cwd/command 合计≤4,096 | 无后端，纯行待迁移 | 是，保护 cwd/command 联合预算，`src/core/agent-runtime/context-assembler.ts:433`、`:435`。
- K3-L13-6 | `K3-review-preparation.test.ts:432` | 一步后 sample2/omitted3；floor 全 unexpanded；manifest100 放不下回 capacity；手算输入变化及规格 `slice-K3-SPEC.md:362`、`:363` | 无后端，纯行待迁移 | 是，保护纯 fit 两阶段及 floor 拒绝，`src/core/agent-runtime/execution-preparation.ts:108`、`:114`、`:116`。
- closure 未接线 | `K3-review-preparation.test.ts:496` | `unavailable`，不能把 absent 当 open；来源文件声明的返工2第2项 `:453` | memory 前置链 | 是，保护 required reader 检查 `src/core/agent-runtime/execution-preparation.ts:461`；前置链仍违规。
- closure 读取失败 | `K3-review-preparation.test.ts:507` | 抛错后 `unavailable`，`:514` | memory 前置链 | 是，保护 `src/core/agent-runtime/execution-preparation.ts:463`；注入形状本身 A2。
- closure 已关闭 | `K3-review-preparation.test.ts:528` | 无 blocked binding/行、Task cancelled、Run ended/cancelled、无 authorization、start `busy`、公开 Run 不变 | memory 前置链 | 是，清除绑定分支 `src/core/agent-runtime/execution-preparation.ts:470`、`:472`；start 拒绝 `src/core/agent-runtime/execution-driver.ts:592`、`:593`；原始 Kernel store 的 Turn 计数另属 F7。
- CA01 | `S3-context-assembler.test.ts:590` | 完整文本、bytes/hash、formatVersion、固定 section 顺序；来源 `slice-3-SPEC.md:716`，但文本 expected 被生产 prelude 污染 | 无后端 | 部分：能发现部分 renderer 拼装变化，`src/core/agent-runtime/context-assembler.ts:303`；不能保护 prelude 常量，见 F8。
- CA02 | `S3-context-assembler.test.ts:602` | 不同插入顺序结果相等；规格 `slice-3-SPEC.md:717` 明确要求该等价关系 | 无后端 | 是，去掉非 notes 可选行排序 `src/core/agent-runtime/context-assembler.ts:258` 会影响这些乱序输入；这是规格关系断言，不是固定文本从 actual 抄 expected。
- CA03 | `S3-context-assembler.test.ts:618` | 两次未绑定准备的 digest/ArtifactRef 相同、body数1；规格 `slice-3-SPEC.md:718` | 自制 Map | 部分：ArtifactRef 相等保护内容稳定性；body数1依赖测试自己实现的去重 `:326`，不是生产 body 去重的证据。
- CA04 | `S3-context-assembler.test.ts:629` | 二次 prepared 深相等、graph/input/brief读取0；规格 `slice-3-SPEC.md:719` | 自制 Map | 是，局部保护 bound rehydrate 分支 `src/core/agent-runtime/execution-preparation.ts:356`；状态取得方式 F2/F4。
- CA05 | `S3-context-assembler.test.ts:655` | obligations、acceptance、brief 超4096仍在；规格 `slice-3-SPEC.md:720` | 无后端 | 是，保护 required 与 optional 的区别，`src/core/agent-runtime/context-assembler.ts:303`、`:306`、`:310`。
- CA06 | `S3-context-assembler.test.ts:671` | 预算等于独立 billed 文本字节、全部保留、omitted0；规格 `slice-3-SPEC.md:721` | 无后端 | 是，保护包含等号的预算选择 `src/core/agent-runtime/context-assembler.ts:286`；完整文本期望另有 F8。
- CA07 | `S3-context-assembler.test.ts:684` | F100留下、X200/Y省略、omitted2；手算 `:688`，规格 `slice-3-SPEC.md:722` | 无后端 | 是，保护全局前缀选择 `src/core/agent-runtime/context-assembler.ts:267`。
- CA08 | `S3-context-assembler.test.ts:701` | resident0、四段各omitted1、位置null、必需段保留；规格 `slice-3-SPEC.md:723` | 无后端 | 是，保护无可选行时的 omission 路径 `src/core/agent-runtime/context-assembler.ts:314`；prelude/header oracle 有 F8。
- CA09 | `S3-context-assembler.test.ts:727` | 5,000 字节输入整行省略、omitted1、选择引用保留；规格 `slice-3-SPEC.md:724` | 无真实后端 | 部分：渲染预算可失败，检查 `src/core/agent-runtime/context-assembler.ts:267`；输入选择由替身提供，不能保护真实输入读取。
- CA10 | `S3-context-assembler.test.ts:744` | `obligations: 未定义`、`acceptance: 未定义`；规格 `slice-3-SPEC.md:725` | 无真实后端 | 能保护纯 `taskPayload` 的 `src/core/agent-runtime/context-assembler.ts:804`、`:805`；不能作为 plan_only Run 的服务场景。
- CA11 | `S3-context-assembler.test.ts:753` | ready、缺失 declaration 和 tA 事实提醒；规格 `slice-3-SPEC.md:726` | 无真实后端 | 部分：能保护 `missingInputReminder`，`src/core/agent-runtime/context-assembler.ts:813`；真实缺失输入/上游事实读取未覆盖。
- CA12 | `S3-context-assembler.test.ts:770` | brief 在最后、异常锚点投影进入提醒；规格 `slice-3-SPEC.md:727` | 无后端 | 组合顺序断言有效；不能把生产 renderer 生成的 suffix 再比较解释为对 suffix 全文的独立字面量验收。
- CA13 | `S3-context-assembler.test.ts:794` | CRLF中文原样、指南存在、Goal存在、system不含动态内容；规格 `slice-3-SPEC.md:728` | 无真实后端 | 问题拼接能保护 `src/core/agent-runtime/context-assembler.ts:1824`；指南实际由测试自己添加，system断言不观察生产请求，见 F8/F11。
- CA14 | `S3-context-assembler.test.ts:813` | 五项均 `not_implemented`，两条未接入提醒；规格 `slice-3-SPEC.md:729` | 无真实后端 | 是，局部保护默认扩展与提醒 `src/core/agent-runtime/context-assembler.ts:1595`、`:1608`、`:1611`；前置仍 F1。
- CA15 | `S3-context-assembler.test.ts:826` | unavailable、body put0；规格 `slice-3-SPEC.md:730` | 自制 Map | 否，所声称的 extension 异常处理已在测试 `:578` 完成；只能保护上层拒绝透传 `src/core/agent-runtime/context-assembler.ts:1591`。
- C-01 | `S4C2-assembly.test.ts:224` | 两理解、三一般、共5来源、version均1；规格 `slice-4-SPEC.md:666` | memory、SQLite | 部分：能保护来源收集 `src/core/agent-runtime/context-assembler.ts:224`、`:232`；没有重叠输入，不能保护去重 `:217`。
- C-02 | `S4C2-assembly.test.ts:251` | 零预算、警示不出现、notes omitted1/startnull、无该来源；规格 `slice-4-SPEC.md:667` | memory、SQLite | 是，局部保护预算省略和仅记录保留来源；未独立检查裸结论 `STALE-WARNING` 完全不存在，`:265` 只排除完整警示字符串。
- C-03 | `S4C2-assembly.test.ts:273` | start cancelled、Run starting且有binding、替换注记后 prepared/input相等、读取0；规格 `slice-4-SPEC.md:668` | memory、SQLite | 是，保护 `src/core/agent-runtime/execution-preparation.ts:356` 的 rehydrate；取消和计数形状分别 A2/A3，基础夹具 F3。
- PU-03 | `S4C2-assembly.test.ts:326` | 项目→目标→阶段、最新5规范、另有2条、不重复进notes、9来源；规格 `slice-4-SPEC.md:929`、`:836` | memory、SQLite | 部分：保护顺序和规范输出 `src/core/agent-runtime/context-assembler.ts:704`、`:705`、`:709`；缺零预算，不能保护必需保留部分。
- C-04 | `S4C2-assembly.test.ts:369` | Query仅理解+规范来源，无一般注记；规格 `slice-4-SPEC.md:669`、`:1011` | memory、SQLite基础，Query本身手造 | 是，局部保护 `src/core/agent-runtime/context-assembler.ts:1847` 及 `src/core/work-graph/notes/note-read-model.ts:1995`；没有真实 Query 生命周期覆盖。
- C-05 | `S4C2-assembly.test.ts:404` | 目标/阶段“还没有当前理解”、来源空；规格 `slice-4-SPEC.md:1004` | memory、SQLite | 是，保护 `src/core/agent-runtime/context-assembler.ts:686`、`:687`。
- C-06 | `S4C2-assembly.test.ts:417` | stale警示存在、当前理解标签不存在、来源含noteId；规格 `slice-4-SPEC.md:1006` | 仅memory | 部分：能保护 currentEligible 分支；不能保护“恰好一行、无正文”，见 F11，生产分支 `src/core/agent-runtime/context-assembler.ts:682`。

本组没有独立声明 RUN-25、UR 系列或其他 B2 编号的测试行；helper 内经过的 RUN-20/22、requeue 等前置步骤，不能据此另报这些规格行已被本组验收。

**4. LEDGER**

以下覆盖 D1 中属于本组的全部 57 条；不是重新粘贴机械断言。对新增项，列其任务书依据及是否构成 F8；对删除项，列迁移、授权或 F12。

- D1:6 | 任务书 §2.0 要求 T512，`.lead-ref/k3-g4b3-impl.md:64`；当前 `K3-35-T-by-hand.test.ts:106` 使用测试本地字面量构造，非 F8。
- D1:7 | 任务书 §2.8 要求必需部分逐字保持，`.lead-ref/k3-g4b3-impl.md:153`；当前 `K3-35-T-by-hand.test.ts:141`，手算模板，非 F8。
- D1:8 | 任务书 §2.0 的 T600 前提；当前 `K3-35-T-by-hand.test.ts:159`，非 F8；不代表其 ready 结果获得授权。
- D1:9 | 任务书 §2.8 的必需部分要求；当前 `K3-35-T-by-hand.test.ts:174`，非 F8。
- D1:10 | 同一任务书要求；当前 `K3-35-approved-methods-brief.test.ts:167`，非 F8。
- D1:11 | 裁定 §2 要求多条目转纯测试，`.lead-ref/k3-b3-rulings-v1.md:22`；当前 `K3-35-manifest-trim-pure.test.ts:280` 的32是测试字面量，非 F8。
- D1:12 | 同一纯函数迁移；当前 `K3-35-manifest-trim-pure.test.ts:281` 检查手造输入别名保持，非生产输出 oracle。
- D1:13 | 返工6第7项要求完整 manifest 测量，`.lead-ref/k3-g4b3-rework-6.md:67`；当前 `K3-35-manifest-trim-pure.test.ts:386` 仅校验本地测量 builder，不是生产装配证明。
- D1:14 | 多条目纯迁移；当前 `K3-35-manifest-trim-pure.test.ts:397` 保留32个别名，非 F8。
- D1:15 | 多条目纯迁移；当前 `K3-35-manifest-trim-pure.test.ts:398` 保持输入别名顺序，非 F8。
- D1:16 | 任务书 §2.8 的必需部分全文要求；当前 `K3-35-renderer-boundary.test.ts:155`，非 F8，但需完成 A5 文件隔离。
- D1:32 | 明确由返工6第8项要求的 K3-35 hook timeout，`.lead-ref/k3-g4b3-rework-6.md:70`；当前 `K3-35-approved-methods-brief.test.ts:83` 的60秒不是那七处已知违规加时，不报 F12。
- D1:98 | 裁定 §2 要求删除服务层手造32项；纯32项覆盖位于 `K3-35-manifest-trim-pure.test.ts:280`，不是必须保留32项 owner 场景。
- D1:99 | 同一裁定要求移除伪造31个平台条目的服务前提；纯平台展示输入及全文覆盖在 `K3-35-renderer-boundary.test.ts:57`、`:155`。
- D1:100 | 同一裁定要求移除服务层32 targets前提；纯32 targets全文在 `K3-35-renderer-boundary.test.ts:155`。
- D1:101 | 等价保留：`K3-35-approved-methods-brief.test.ts:108` 直接读取 disposition 的字段，null会使该行失败。
- D1:102 | 账本可见的 safer_method/card 语义由完整必需块保留，`K3-35-approved-methods-brief.test.ts:167`；这里只对账本可见字段作结论，不推测截断行后还有什么字段。
- D1:103 | 多条目服务前提按裁定 §2 移出；纯作用对象全文在 `K3-35-renderer-boundary.test.ts:155`。
- D1:104 | 同上，31个平台作用对象在纯必需块中保持，`K3-35-renderer-boundary.test.ts:155`。
- D1:105 | 同上，32项改由纯输入及渲染检查承担，`K3-35-manifest-trim-pure.test.ts:280`、`K3-35-renderer-boundary.test.ts:155`。
- D1:106 | 等价保留：`K3-35-approved-methods-brief.test.ts:108`，以及 `:167` 的全文方法块。
- D1:107 | 多条目服务前提按裁定 §2 移出；纯平台行在 `K3-35-renderer-boundary.test.ts:155`。
- D1:108 | F12：外部 anchors8 不等于 brief anchors8；当前差异 `K3-35-approved-methods-brief.test.ts:116`、`:171`。
- D1:109 | F12：同 Task 检查不等于八个已装入 brief 的512字节锚点；当前 `K3-35-approved-methods-brief.test.ts:118`。
- D1:110 | F12：纯输入保留 omitted10，未等价迁移输出计数断言；当前构造 `K3-35-renderer-boundary.test.ts:78`。
- D1:111 | F12：原因大于60的前提断言没有迁移；当前原因相等检查 `K3-35-approved-methods-brief.test.ts:119`。
- D1:112 | 任务书 §2.0、§2.8、答复8明确要求重算大小，`.lead-ref/k3-g4b3-impl.md:257`；旧15,681不能继续当新夹具字面量，删除旧数本身不报 F12，精确边界义务丢失另见 D1:132。
- D1:113 | 同一重算要求；新公开样例精确字节断言在 `K3-35-approved-methods-brief.test.ts:164`。
- D1:114 | F12：完整文本相等缩成必需子块相等，当前 `K3-35-approved-methods-brief.test.ts:167`。
- D1:115 | 任务书要求重算；新完整 suffix 字节数精确断言在 `K3-35-approved-methods-brief.test.ts:164`。
- D1:116 | 等价迁移：标题包括在 `K3-35-approved-methods-brief.test.ts:167` 的完整必需块。
- D1:117 | 等价迁移到纯32项必需块：`K3-35-renderer-boundary.test.ts:155`。
- D1:118 | 等价迁移到纯32项、60单位附言的完整必需块：`K3-35-renderer-boundary.test.ts:155`。
- D1:119 | 等价迁移：纯作用对象全文 `K3-35-renderer-boundary.test.ts:155`。
- D1:120 | 等价迁移：纯平台作用对象全文 `K3-35-renderer-boundary.test.ts:155`。
- D1:121 | 等价迁移：`K3-35-approved-methods-brief.test.ts:167` 的必需块及 `:172` 的顺序检查。
- D1:122 | 等价迁移：`K3-35-approved-methods-brief.test.ts:167` 保留完整方法命令及缩进。
- D1:123 | F12：省略说明非空前提没有迁移；当前纯边界只检查 heading 消失，`K3-35-renderer-boundary.test.ts:150`。
- D1:124 | F12：省略说明正文断言未迁移，`K3-35-renderer-boundary.test.ts:156` 不等价。
- D1:125 | F12：完整输出的 process callId 检查未迁移；子块提取会过滤正文，`tests/helpers/K3-35-required-review-block.ts:38`。
- D1:126 | F12：可选正文省略断言未迁移；同一过滤器不能代替全输出检查。
- D1:127 | F12：平台 callId 全输出检查未迁移；当前仅子块相等，`K3-35-renderer-boundary.test.ts:155`。
- D1:128 | 等价迁移：完整必需块中 targets 必须存在，`K3-35-renderer-boundary.test.ts:155`。
- D1:129 | 等价迁移：targets→method 顺序由同一完整必需块固定，`K3-35-renderer-boundary.test.ts:155`。
- D1:130 | 等价迁移：method→platform 顺序由同一完整必需块固定，`K3-35-renderer-boundary.test.ts:155`。
- D1:131 | F12：八个600字节渲染锚点前提断言未迁移；Task本身检查 `K3-35-T-by-hand.test.ts:159` 不等价。
- D1:132 | F12：T512必需部分精确字节数变成总输出≤上限，`K3-35-renderer-boundary.test.ts:157`。
- D1:133 | F12：T600精确必需字节数只有注释，`K3-35-renderer-boundary.test.ts:163`。
- D1:134 | F12：数值越界断言没有保留，仅抛错，`K3-35-renderer-boundary.test.ts:165`。
- D1:135 | F12：八锚点704字节差值没有保留；新88字节场景是不同事实，`K3-35-T-by-hand.test.ts:166`。
- D1:136 | F12：真实 prepare 拒绝改为ready，`K3-35-T-by-hand.test.ts:168`。
- D1:137 | F12：真实 prepare 的capacity错误码消失，纯抛错 `K3-35-renderer-boundary.test.ts:165` 不等价。
- D1:138 | 等价保留：T512 prepare ready，`K3-35-T-by-hand.test.ts:136`。
- D1:430 | 任务书 §2.0 要求重建夹具和拆分纯边界；仅移除 describe 标题不是独立行为削弱，替代分组见 `K3-35-approved-methods-brief.test.ts:86`、`K3-35-renderer-boundary.test.ts:143`。
- D1:431 | 裁定 §2 明确移除手造32项 owner 场景；现服务单项行 `K3-35-approved-methods-brief.test.ts:87`。
- D1:432 | F12：纯迁移没有完整承接旧行全部断言，当前 `K3-35-renderer-boundary.test.ts:144`。
- D1:433 | F12：renderer部分迁移，prepare拒绝部分反转，当前 `K3-35-T-by-hand.test.ts:166`。

**5. CANARIES**

- `.lead-ref/k3-b3-rulings-v1.md:44` 的 `K3-review-workflow-rows.test.ts:736` 及调用者不在 G3 九文件中，不计本组漏检。
- `.lead-ref/k3-b3-rulings-v1.md:45` 的 K3-06/K3-13 多条目 owner 文件不在 G3；G3 的对应多条目主测试已经位于 `K3-35-manifest-trim-pure.test.ts:274`，未发现该文件把多条目写入 owner。
- `.lead-ref/k3-b3-rulings-v1.md:46` 的 `K3-15-review-routes.test.ts:81` 不在 G3；同一裁定点名的 helper 实例已找到：`tests/helpers/K3-crr-fixture.ts:157`，由 `K3-review-preparation.test.ts:467` 调用，影响三个 closure 测试。
- `.lead-ref/k3-b3-rulings-v1.md:47` 的 K3-16 summary 放宽不在 G3。
- `.lead-ref/k3-b3-rulings-v1.md:48` 的 K3-48-2 大小断言放宽及仅SQLite不在 G3；本组 `K3-48-3-extremes-pure.test.ts:131` 仍精确断言158,720。
- `.lead-ref/k3-b3-rulings-v1.md:49` 的七处已知加时均不在 G3；G3 的 D1:32 是另一个有返工6第8项明确要求的 hook timeout，不能混报。

**6. STATIC claims**

- CA10 的“带可执行 Run 的 plan_only Task”不是合法公开前置：静态追踪的调用序列为注册项目/工作区→创建Goal→proposePlan/applyPlanChange保留 `executionIntent:'plan_only'`→Runtime创建Session→`claims.claimTask`；claim 在 `src/core/work-graph/tasks/claim-service.ts:1143` 调共享 eligibility，`src/core/work-graph/tasks/eligibility.ts:55` 添加 `task_planning_only` 拒绝原因，`:57` 明确要求先有 `request_execution`；一旦请求执行，前提已经不再是该行手造的 plan_only Run，因此处置为纯 `taskPayload` 测试。
- 不主张“任何公开序列都不能产生 T600 capacity”：现有 helper 的静态路径是8次创建/启动/归档→原始调用认定→核对→safer_method→提案→批准→requeue→接续prepare，入口 `tests/helpers/K3-35-continuation-fixture.ts:886`，循环 `:902`，处置 `:1007`，批准 `:1023`，接续 `:1033`；当前测试却要求接续文本没有异常节，`K3-35-T-by-hand.test.ts:176`，这只能说明当前样例没有实现原规格，不能证明所有公开路径不可达。
- 不接受“memory 无法重开所以只能SQLite”的静态结论：`tests/helpers/K3-35-continuation-fixture.ts:889` 拒绝 memory 是测试 helper 自己的限制；同文件 `:637` 已有裁定接受的同一内存后端工厂包装，规则 A4 明确允许该形状，`.lead-ref/test-rule-sheet.md:38`。本次没有找到足以为这两文件签发 SQLite-only 豁免的生产拒绝行。
- 不把多条目移纯测试建立在新增不可达推论上：直接依据已冻结裁定 `.lead-ref/k3-b3-rulings-v1.md:18` 至 `:24`；无需通过篡改记录再“验证”不可达。
- 本次没有执行任何上述调用序列；它们是阅读得到的静态控制流，不是运行尝试。

**7. OPEN QUESTIONS**

- Q1：规则 A1 在 `.lead-ref/test-rule-sheet.md:26` 明确点名接受 r8 的整份 `K3-35-continuation-fixture.ts`，但其实际依赖链包含本文列出的 F3、F4、F9；文本没有明确“接受”只指公开流程结构，还是包含递归实现。最小选项：①仅接受公开流程结构，按本文修 helper；②若要接受具体例外，由 lead 按规则版本机制逐项明确例外。当前不能把文件名本身当作递归豁免。
- Q2：K3-35（三）的服务要求仍是 T600→capacity，`slice-K3-SPEC.md:1435`、`.lead-ref/k3-g4b3-impl.md:155`；现有真实场景是12,764字节且ready，`K3-35-T-by-hand.test.ts:168`、`:172`。最小选项：①继续寻找并固定合法公开容量场景，保留服务拒绝要求；②由 lead 明确调整该行验收边界，使纯renderer承接极限，并记录服务映射覆盖如何承担。不能由测试作者自行把原服务行改成成功后宣布完成。

**8. SEARCH LOG**

- 读取范围核对：逐行读取 `.lead-ref/groups/G3.txt` 九文件全部内容，并核对末行与行数：178、182、418、168、218、228、626、832、431，总计3,281；逐个核对最后测试标题。
- 规则读取：完整读取 `.lead-ref/test-rule-sheet.md`、`.lead-ref/k3-b3-rulings-v1.md`；读取 D1 全部相关条目，确认本组57条。
- 历史核对：读取原 B3 任务书、返工6/7/8、返工8总结及此前审查材料中与本组相关的规定；特别核对任务书 §2.0/§2.8/答复8、返工6第7/8项、返工7的固定 B/512KiB 要求。
- helper 追踪：从测试 import 和实际调用向下追踪 K3-35 continuation/prepare/runtime/required-block、proposal-round、review-card、blocked-command、crr、tool-seams、S1-public-anchor、S5-decision、K3-padded-review-record、S4A-note、WP2-platform、task-claim、B2 execution/runtime 的实际调用定义；未把未调用分支当作本组已发生事实。
- 语义候选搜索：查找 `readExecution`、`readReview`、`resolveConfiguration`、`readContextFacts`、`captureDigest`、`recordSessionCreated`、`recordExecutionEntered`、`authorizeRuntimeEntry`、`beginRuntimeEntry`、`commitRaw`、`readMany`、`withStore`、`loadPreparedManifest`、`setTimeout`、`full`、`inputBinding`、`plan_only`，随后阅读完整函数和调用上下文。
- 断言与行名核对：搜索 `it`、`it.each`、`describe`、`expect`，按实际测试声明统计49个测试声明、参数化后55行；没有用搜索命中数代替逐行阅读。
- 生产检查定位：阅读 `execution-preparation` 的 bound replay、closure、review-fit、manifest写入；`context-assembler` 的纯fit/trim、required/optional预算、Query、note来源；continuation renderer容量分支；review状态机和codec；workspace capture容量；claim eligibility；execution driver busy拒绝。
- 工具限制：环境没有可用 `rg`，改用 PowerShell `Select-String`、`Get-Content -Encoding utf8`；中文输出编码异常处通过只读字符转义重新读取，截断的相关输出另行补读；没有执行测试、构建、Git写操作或文件写入。

G3: files read 9/9; instances by rule: F1 7, F2 6, F3 14, F4 37, F5 0, F6 1, F7 9, F8 11, F9 2, F10 0, F11 5, F12 19; open questions 2