已完成 P1 只读盘点：**182 条白名单逐条列出，另列 5 条 C1 转交项和 1 条 N0 清理项，共 188 条**。未写文件，未运行测试、构建或可达分析器，未访问网络。

下文的“可达/未接线”是依据声明、引用和既有检查规则作出的静态判断，不是本次重新执行检查所得。检查要求删除已经消失或已经可达的白名单项，见 `tests/architecture/production-reach.test.ts:99-107`；因此下列删除、接线建议都包含同步移除对应白名单项，但不删除检查本身。

**记号与计数口径**

- 类别：`B`＝`allowlist-pre-batch`；`K`＝`allowlist-kept-for`；`W`＝`allowlist-wire-format`；`C`＝`c1-transfer`；`N`＝`n0`。
- `user-decides（建议留）`：保留的用途写在各行证据中，仍由用户决定；不是替用户批准。
- 按 `.lead-ref/t-common.md:61`，`估计行数 / est_lines` **只统计建议删除或修改的测试代码行**，不把生产代码、白名单、注释算成测试缩减。生产改动范围另写明。
- JSON 的 `tests: []` 表示没有本条建议要求修改的测试，不表示该功能没有测试。
- `spec_row: true` 表示涉及冻结规格行或其固定规则测试，必须保留其行为断言。
- 为使表格可读，位置使用以下文件缩写；例如 `H:298` 就是 `src/app/core-http-types.ts:298`。JSON 使用完整路径。

| 缩写 | 完整文件 |
|---|---|
| H | `src/app/core-http-types.ts` |
| CLI | `src/app/main.ts` |
| HC | `src/contracts/human-role-collaboration.ts` |
| RM | `src/contracts/role-material-channels.ts` |
| RS | `src/contracts/role-spec.ts` |
| VR | `src/contracts/validation/role.ts` |
| CC | `src/core/work-graph/architecture/catalog-contracts.ts` |
| CE | `src/core/work-graph/architecture/catalog-record-codecs.ts` |
| CS | `src/core/work-graph/architecture/catalog-service.ts` |
| RC | `src/core/work-graph/model/configuration-contracts.ts` |
| RMEM | `src/core/work-graph/configuration/role-memory-service.ts` |
| RE | `src/core/work-graph/configuration/role-record-codecs.ts` |
| WS | `src/core/workspace/role-source-reader.ts` |
| DC | `src/core/work-graph/persistence/decision-record-codecs.ts` |
| MB | `src/core/work-graph/sessions/message-body-envelope.ts` |
| NC | `src/core/work-graph/model/note-contracts.ts` |
| AI | `src/contracts/architecture-inspection.ts` |
| AC | `src/core/work-graph/architecture/architecture-record-codecs.ts` |
| AS | `src/core/work-graph/architecture/architecture-service.ts` |
| AP | `src/core/work-graph/architecture/contracts.ts` |
| FG | `src/core/work-graph/architecture/file-graph-index.ts` |
| TC | `src/core/work-graph/model/tool-commit-arguments.ts` |
| CN | `src/core/work-graph/state/command-normalization.ts` |
| UK | `src/core/work-graph/state/unknown-call-kinds.ts` |
| UR | `src/core/work-graph/state/unknown-call-review.ts` |

**共用证据索引**

以下编号是表格、JSON 中证据的完整展开。

| 证据 | 核对结果与位置 |
|---|---|
| E-H | HTTP 类型从当前 owner/port 的参数、结果派生；当前路由分派见 `src/app/core-routes.ts:1055-1112`。这些名称未被生产路径引用，不等于其描述的协议已废弃。保留用途是给 HTTP 调用方提供具名请求、响应类型。 |
| E-CLI | 两个类型描述启动 JSON 的工作区和整体配置，声明在 `src/app/main.ts:19-51`；实际配置解析从 `src/app/main.ts:72` 开始；`README.md:59` 指向该配置类型。保留用途是说明、检查启动配置，不能把类型声明当成运行时校验。 |
| E-R | 决定 34 明确保留角色规格，见 `docs/refactor/HANDOFF.md:110`；决定 6 的用途是按语义挑选成员，见 `docs/refactor/HANDOFF.md:782`。安装、激活等公开口仍未接线，但内部角色事实解析已被领取和执行链使用，见 `docs/refactor/IMPLEMENTED-CAPABILITIES.md:194`。原 note 的“由第 3 片接上”已不能当成尚未完成的第 3 片任务。 |
| E-RS | 有界角色源码读取仍被明确列为保留、暂不接线的角色能力，见 `docs/refactor/IMPLEMENTED-CAPABILITIES.md:298`；实现 `src/core/workspace/role-source-reader.ts:45-131`，配套类型 `src/contracts/role-material-channels.ts:3-52`。未找到第 6、7、8 片给这个旧接口安排的新直接消费者，因此保留结论依赖既有决定，置信度中。 |
| E-A | 目录修订仍在计划：`docs/refactor/design/orchestration-2026-10/slices/slice-8-SPEC.md:132-133` 明列 `architecture/revise`，并要求复用 `reviseArchitectureCatalog` 的守卫、校验和重放；决定 34 也明确保留，见 `docs/refactor/HANDOFF.md:110`。 |
| E-W5 | 当前路由实际接收并返回第 5 片形状：`src/app/core-routes.ts:1140-1151`。表中逐对给出具体路由行。这里保留的是当前 wire contract，不是旧版本兼容。 |
| E-EVT | 当前目标设置事件编码、解码在 `src/core/work-graph/persistence/decision-record-codecs.ts:60-75`；通知已读事件在同文件 `:78-95`；注册在 `:427-439`；写入方分别在 `src/core/work-graph/tasks/goal-settings-service.ts:315`、`src/core/work-graph/configuration/decision-settings-service.ts:160`。两个 schema-id 常量名本身未被引用，但其对应事件类型和版本仍在写读，不能据常量未引用把格式判为旧格式。 |
| E-MSG | 用户决定正文仍写成当前信封：`src/core/work-graph/sessions/message-body-envelope.ts:34-47`；读取在 `:145-170`、`:180-220`；写方使用编码器见 `src/core/work-graph/communication/decision-service.ts:778`、`:825`。 |
| E-W2 | 当前活动、轨道、时间线和补录路由在 `src/app/core-routes.ts:1153-1157`。 |
| E-NOTE | 规格仍显式声明 2 KiB 默认、4 KiB 上限，见 `docs/refactor/design/orchestration-2026-10/slices/slice-4-SPEC.md:518`；当前正文读法固定使用 2 KiB，见 `src/core/work-graph/notes/note-read-model.ts:1182`。未发现 4C 路由使用 `NOTE_BODY_PAGE_MAX_BYTES`；原 note 所称未来消费者已经失实。暂留冻结规格常量，不能宣称已接线。 |
| E-W4 | 当前注记、计划版本和架构版本路由在 `src/app/core-routes.ts:1167-1172`。 |
| E-F | 文件图三读口仍由规格点名，尤其 `listFiles` 明写“架构页用”：`docs/refactor/design/orchestration-2026-10/slices/slice-8-SPEC.md:328-330`；页大小、深度约束见 `:173`。服务对应读口在 `src/core/work-graph/architecture/architecture-service.ts:1653-1705`。 |
| E-V2 | `FILE_GRAPH_CHUNK_SCHEMA_ID` 的值还是 `ObservedFileGraphChunk@1`，见 `src/core/work-graph/architecture/architecture-record-codecs.ts:41`；当前校验器只接受 v2，见 `:314-340`，解码只走该校验器，见 `:345-349`；写入前也使用它，见 `src/core/work-graph/architecture/architecture-service.ts:1161-1165`，实际写块见 `:1179`。旧常量没有源码调用方或测试导入。按决定 79-1，见 `docs/refactor/HANDOFF.md:565-570`，可删除该常量。 |
| E-K39 | `toolCommitLookupNotPublished` 与实际分派处的字面结果重复：`src/core/work-graph/model/tool-commit-arguments.ts:181-183`、`src/composition/tool-commit-lookup.ts:48`。让实际分派调用该助手，保留 K3-39 测试，随后移除白名单。 |
| E-PARSE | 当前业务使用详细解析口；公开简版仍被冻结规格明确保留，见 `docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md:1841`；实现注明该投影不变，见 `src/core/work-graph/state/command-normalization.ts:520-539`。不能把 B2-10 解析规则测试当作普通琐碎测试删除。 |
| E-NAME | `kernelToolNameOf` 的 `write → edit` 映射在 `src/core/work-graph/state/unknown-call-kinds.ts:44-46`，生产处在 `src/core/agent-runtime/observed-model-run.ts:303` 又写一次。让实际工具名装配调用该函数，保留 K3-34 和规则表测试，随后移除白名单。 |
| E-BUDGET | 预留值 `365536`、总上限 `524288`、创建预算 `158720` 在 `src/core/work-graph/state/unknown-call-review.ts:35-39`。规格明确另外留 32 字节，见 `docs/refactor/design/orchestration-2026-10/slices/slice-K3-SPEC.md:1856`。建议把创建预算写成 `MAX - RESERVED - 32`，数值和行为均不变；不能误改成 `158752`。 |
| E-ALIAS | `UnknownCallReviewEvent` 只是当前 `UnknownCallReviewEventV1` 的同义别名，见 `src/core/work-graph/state/unknown-call-review.ts:129`。只有两个测试文件导入和使用此别名，详见 P1-182；直接改用 V1，保留状态机和 K3-45 行为。 |
| E-C1A～E-C1D、E-N0 | 见表后的精确施工范围；这些说明也是对应 JSON 字段的展开。 |

**逐条盘点表**

同一格内的声明名称是该白名单项的精确名称。P1-001～P1-182 按白名单原顺序编号；其 `name` 所在行是 `tests/architecture/production-reach-allowlist.json` 的 `6 × 序号` 行，例如 P1-063 在 `:378`、P1-182 在 `:1092`。

| 编号 | 类别 | 位置；声明/测试 | 证据 | 建议 | 被谁覆盖 | 估计行数 | 规格行 | 把握 |
|---|---|---|---|---|---|---:|---|---|
| P1-001 | B | H:298 `ProjectsCreateBody` | E-H；创建项目请求类型 | user-decides（建议留） | 不删 | 0 | 否 | 高 |
| P1-002 | B | H:300 `WorkspacesRegisterBody` | E-H；登记工作区请求类型 | user-decides（建议留） | 不删 | 0 | 否 | 高 |
| P1-003 | B | H:302 `CompletionPoliciesInstallBody` | E-H；安装完成标准请求类型 | user-decides（建议留） | 不删 | 0 | 否 | 高 |
| P1-004 | B | H:304 `CompletionPoliciesActivateBody` | E-H；启用完成标准请求类型 | user-decides（建议留） | 不删 | 0 | 否 | 高 |
| P1-005 | B | H:306 `CompletionPoliciesReadBody` | E-H；读取完成标准请求类型 | user-decides（建议留） | 不删 | 0 | 否 | 高 |
| P1-006 | B | H:307 `CompletionPoliciesReadResponse` | E-H；读取完成标准响应类型 | user-decides（建议留） | 不删 | 0 | 否 | 高 |
| P1-007 | B | H:308 `GoalsCreateBody` | E-H；创建目标请求类型 | user-decides（建议留） | 不删 | 0 | 否 | 高 |
| P1-008 | B | H:310 `GoalsReadBody` | E-H；读取目标请求类型 | user-decides（建议留） | 不删 | 0 | 否 | 高 |
| P1-009 | B | H:311 `GoalsReadResponse` | E-H；读取目标响应类型 | user-decides（建议留） | 不删 | 0 | 否 | 高 |
| P1-010 | B | H:312 `ArchitectureAdoptInitialBody` | E-H；采用初始架构请求类型 | user-decides（建议留） | 不删 | 0 | 否 | 高 |
| P1-011 | B | H:315 `ArchitectureReadResponse` | E-H；读取正式架构响应类型 | user-decides（建议留） | 不删 | 0 | 否 | 高 |
| P1-012 | B | H:319-325 `ArchitectureCaptureBody` | E-H；捕获观测架构请求，排除内部 requestSeq | user-decides（建议留） | 不删 | 0 | 否 | 高 |
| P1-013 | B | H:326 `ArchitectureCaptureResponse` | E-H；捕获观测架构响应类型 | user-decides（建议留） | 不删 | 0 | 否 | 高 |
| P1-014 | B | H:327 `ArchitectureQueryBody` | E-H；查询观测架构请求类型 | user-decides（建议留） | 不删 | 0 | 否 | 高 |
| P1-015 | B | H:328 `ArchitectureQueryResponse` | E-H；查询观测架构响应类型 | user-decides（建议留） | 不删 | 0 | 否 | 高 |
| P1-016 | B | H:329 `PlansProposeBody` | E-H；提出计划变更请求类型 | user-decides（建议留） | 不删 | 0 | 否 | 高 |
| P1-017 | B | H:331 `PlansApplyBody` | E-H；采用计划变更请求类型 | user-decides（建议留） | 不删 | 0 | 否 | 高 |
| P1-018 | B | H:333 `PlansProposalBody` | E-H；读取计划提议请求类型 | user-decides（建议留） | 不删 | 0 | 否 | 高 |
| P1-019 | B | H:334 `PlansProposalResponse` | E-H；读取计划提议响应类型 | user-decides（建议留） | 不删 | 0 | 否 | 高 |
| P1-020 | B | H:335 `TasksQueryBody` | E-H；查询任务图请求类型 | user-decides（建议留） | 不删 | 0 | 否 | 高 |
| P1-021 | B | H:336 `TasksQueryResponse` | E-H；任务图查询响应类型 | user-decides（建议留） | 不删 | 0 | 否 | 高 |
| P1-022 | B | H:337 `FilesReadBody` | E-H；读取工作区文件请求类型 | user-decides（建议留） | 不删 | 0 | 否 | 高 |
| P1-023 | B | H:342 `FilesListBody` | E-H；列工作区文件请求类型 | user-decides（建议留） | 不删 | 0 | 否 | 高 |
| P1-024 | B | H:343 `FilesListResponse` | E-H；文件列表响应类型 | user-decides（建议留） | 不删 | 0 | 否 | 高 |
| P1-025 | B | H:346 `SourceCaptureBody` | E-H；捕获源码材料请求类型 | user-decides（建议留） | 不删 | 0 | 否 | 高 |
| P1-026 | B | H:348 `SourceQueryBody` | E-H；查询已捕获源码请求类型 | user-decides（建议留） | 不删 | 0 | 否 | 高 |
| P1-027 | B | H:362 `SessionsFindBody` | E-H；查找 Session 请求类型 | user-decides（建议留） | 不删 | 0 | 否 | 高 |
| P1-028 | B | H:364 `SessionsReadBody` | E-H；读取 Session 请求类型 | user-decides（建议留） | 不删 | 0 | 否 | 高 |
| P1-029 | B | H:366 `SessionsOperationBody` | E-H；读取 Session 操作状态请求类型 | user-decides（建议留） | 不删 | 0 | 否 | 高 |
| P1-030 | B | H:368 `RuntimeCapabilitiesBody` | E-H；查询运行能力请求类型 | user-decides（建议留） | 不删 | 0 | 否 | 高 |
| P1-031 | B | H:370 `SessionsCreateBody` | E-H；创建 Session 请求类型 | user-decides（建议留） | 不删 | 0 | 否 | 高 |
| P1-032 | B | H:372 `SessionsHistoryBody` | E-H；读取原历史请求类型 | user-decides（建议留） | 不删 | 0 | 否 | 高 |
| P1-033 | B | H:374 `MessagesSendBody` | E-H；发送成员消息请求类型 | user-decides（建议留） | 不删 | 0 | 否 | 高 |
| P1-034 | B | H:376 `MessagesInboxBody` | E-H；读取收件箱请求类型 | user-decides（建议留） | 不删 | 0 | 否 | 高 |
| P1-035 | B | H:378 `MessagesReadBody` | E-H；读取消息记录请求类型 | user-decides（建议留） | 不删 | 0 | 否 | 高 |
| P1-036 | B | H:380 `MessagesBodyBody` | E-H；读取消息正文请求类型 | user-decides（建议留） | 不删 | 0 | 否 | 高 |
| P1-037 | B | H:382 `MessagesOutboxBody` | E-H；读取发件箱请求类型 | user-decides（建议留） | 不删 | 0 | 否 | 高 |
| P1-038 | B | H:383 `MessagesOutboxResponse` | E-H；发件箱响应类型 | user-decides（建议留） | 不删 | 0 | 否 | 高 |
| P1-039 | B | H:505 `WorkspacesRegistrationBody` | E-H；读取工作区登记请求类型 | user-decides（建议留） | 不删 | 0 | 否 | 高 |
| P1-040 | B | H:509 `QueriesReadBody` | E-H；读取查询任务请求类型 | user-decides（建议留） | 不删 | 0 | 否 | 高 |
| P1-041 | B | H:511 `QueriesClaimBody` | E-H；领取查询任务请求类型 | user-decides（建议留） | 不删 | 0 | 否 | 高 |
| P1-042 | B | H:512 `QueriesClaimResponse` | E-H；领取查询任务响应类型 | user-decides（建议留） | 不删 | 0 | 否 | 高 |
| P1-043 | B | H:513 `QueriesPrepareBody` | E-H；准备查询执行请求类型 | user-decides（建议留） | 不删 | 0 | 否 | 高 |
| P1-044 | B | H:515 `QueriesStartBody` | E-H；启动查询执行请求类型 | user-decides（建议留） | 不删 | 0 | 否 | 高 |
| P1-045 | B | H:517 `QueriesObserveBody` | E-H；观察查询执行请求类型 | user-decides（建议留） | 不删 | 0 | 否 | 高 |
| P1-046 | B | H:518 `QueriesObserveResponse` | E-H；查询执行观察响应类型 | user-decides（建议留） | 不删 | 0 | 否 | 高 |
| P1-047 | B | H:521 `MaterialsOpenBody` | E-H；打开材料请求类型 | user-decides（建议留） | 不删 | 0 | 否 | 高 |
| P1-048 | B | H:524 `WorkflowGoalInputResponse` | E-H；当前初始规划响应，不能随 N0 删除 | user-decides（建议留） | P1-188 保留当前流程 | 0 | 否 | 高 |
| P1-049 | B | H:526 `WorkflowAdvanceResponse` | E-H；Workflow 推进响应类型 | user-decides（建议留） | 不删 | 0 | 否 | 高 |
| P1-050 | B | H:537 `WorkflowDriverReadBody` | E-H；读取持续驱动状态请求类型 | user-decides（建议留） | 不删 | 0 | 否 | 高 |
| P1-051 | B | H:539 `WorkflowDriverStopBody` | E-H；停止持续驱动请求类型 | user-decides（建议留） | 不删 | 0 | 否 | 高 |
| P1-052 | B | H:550 `ExecutionsReadBody` | E-H；读取执行请求类型 | user-decides（建议留） | 不删 | 0 | 否 | 高 |
| P1-053 | B | H:552 `ExecutionsHistoryBody` | E-H；读取任务执行历史请求类型 | user-decides（建议留） | 不删 | 0 | 否 | 高 |
| P1-054 | B | H:567 `ExecutionsListBody` | E-H；列执行请求类型 | user-decides（建议留） | 不删 | 0 | 否 | 高 |
| P1-055 | B | H:569 `ProjectsReadBody` | E-H；读取项目请求类型 | user-decides（建议留） | 不删 | 0 | 否 | 高 |
| P1-056 | B | H:571 `FilesSaveBody` | E-H；保存工作区文件请求类型 | user-decides（建议留） | 不删 | 0 | 否 | 高 |
| P1-057 | B | H:573 `FilesCompareBody` | E-H；比较工作区文件请求类型 | user-decides（建议留） | 不删 | 0 | 否 | 高 |
| P1-058 | B | H:575 `CommandsStartBody` | E-H；启动命令请求类型 | user-decides（建议留） | 不删 | 0 | 否 | 高 |
| P1-059 | B | H:577 `CommandsReadBody` | E-H；读取命令状态请求类型 | user-decides（建议留） | 不删 | 0 | 否 | 高 |
| P1-060 | B | H:579 `CommandsStopBody` | E-H；停止命令请求类型 | user-decides（建议留） | 不删 | 0 | 否 | 高 |
| P1-061 | B | CLI:19-29 `WorkbenchCliWorkspace` | E-CLI；说明单工作区启动配置 | user-decides（建议留） | 不删 | 0 | 否 | 高 |
| P1-062 | B | CLI:31-51 `WorkbenchCliConfig` | E-CLI；说明整体启动 JSON | user-decides（建议留） | 不删 | 0 | 否 | 高 |
| P1-063 | K | HC:73-76 `CoordinationPolicyPin` | E-R；角色保留决定仍在，但未找到该 pin 的明确后续调用点 | keep：暂留待 lead 明确消费者 | 不删；不能据缺引用认定取消 | 0 | 否 | 低 |
| P1-064 | K | RM:3-16 `RoleSourceIndexRequestV1` | E-RS；有界角色源码请求 | keep：角色读取能力仍列保留 | 不删 | 0 | 否 | 中 |
| P1-065 | K | RM:17-19 `RoleSourceIndexEntryV1` | E-RS；源码索引条目 | keep：配套契约 | 不删 | 0 | 否 | 中 |
| P1-066 | K | RM:20-25 `RoleSourceIndexExcerptV1` | E-RS；源码片段条目 | keep：配套契约 | 不删 | 0 | 否 | 中 |
| P1-067 | K | RM:26-48 `RoleSourceIndexResultV1` | E-RS；有界读取结果 | keep：配套契约 | 不删 | 0 | 否 | 中 |
| P1-068 | K | RM:50-52 `RoleSourceIndexPort` | E-RS；角色源码读取口 | keep：已有保留决定 | 不删 | 0 | 否 | 中 |
| P1-069 | K | RS:46 `ROLE_SPEC_REVISION` | E-R；角色规格版本 | keep：决定 34 | 不删 | 0 | 否 | 高 |
| P1-070 | K | RS:154-156 `roleSpecRevisionRefFor` | E-R；构造角色版本引用，当前无调用 | keep：角色规格配套；待实际接线复核 | 不删 | 0 | 否 | 中 |
| P1-071 | K | RS:177-190 `InstallRoleSpecRevisionCommand` | E-R；安装角色规格命令 | keep：决定 34 | 不删 | 0 | 否 | 高 |
| P1-072 | K | RS:191-203 `ActivateRoleSpecRevisionCommand` | E-R；启用角色规格命令 | keep：决定 34 | 不删 | 0 | 否 | 高 |
| P1-073 | K | RS:204-216 `InstallRoleSpecRevisionReceipt` | E-R；安装回执 | keep：决定 34 | 不删 | 0 | 否 | 高 |
| P1-074 | K | RS:217-229 `ActivateRoleSpecRevisionReceipt` | E-R；启用回执 | keep：决定 34 | 不删 | 0 | 否 | 高 |
| P1-075 | K | RS:230-238 `installRoleSpecRevisionFingerprint` | E-R；安装幂等指纹 | keep：安装链配套 | 不删 | 0 | 否 | 高 |
| P1-076 | K | RS:239-247 `activateRoleSpecRevisionFingerprint` | E-R；启用幂等指纹 | keep：启用链配套 | 不删 | 0 | 否 | 高 |
| P1-077 | K | RS:248-265 `RoleSpecInstalledEvent` | E-R；安装事件 | keep：安装链配套 | 不删 | 0 | 否 | 高 |
| P1-078 | K | RS:266-284 `RoleSpecActivatedEvent` | E-R；启用事件 | keep：启用链配套 | 不删 | 0 | 否 | 高 |
| P1-079 | K | VR:187-198 `validateRoleSpecInstallCommon` | E-R；安装共用校验 | keep：安装链配套 | 不删 | 0 | 否 | 高 |
| P1-080 | K | VR:199-218 `validateInstallRoleSpecRevisionCommand` | E-R；安装命令校验 | keep：安装链配套 | 不删 | 0 | 否 | 高 |
| P1-081 | K | VR:219-246 `validateActivateRoleSpecRevisionCommand` | E-R；启用命令校验 | keep：启用链配套 | 不删 | 0 | 否 | 高 |
| P1-082 | K | CC:101-105 `ReviseArchitectureCatalogInput` | E-A；目录修订入参 | keep：8C 修订仍计划接线 | 不删 | 0 | 否 | 高 |
| P1-083 | K | CC:125-128 `ArchitectureCatalogPort.reviseArchitectureCatalog` | E-A；目录修订口 | keep：8C 明确消费者 | 不删 | 0 | 否 | 高 |
| P1-084 | K | CE:569-571 `encodeArchitectureCatalogRevisedEvent` | E-A；修订事件编码 | keep：修订链配套 | 不删 | 0 | 否 | 高 |
| P1-085 | K | CS:62 `REVISE_IDENTITY_PREFIX` | E-A；修订幂等身份前缀 | keep：修订链配套 | 不删 | 0 | 否 | 高 |
| P1-086 | K | CS:63 `REVISE_COMMAND_TYPE` | E-A；修订命令类型 | keep：修订链配套 | 不删 | 0 | 否 | 高 |
| P1-087 | K | CS:64 `MAX_REVISE_REASON_BYTES` | E-A；修订理由限额 | keep：修订链配套 | 不删 | 0 | 否 | 高 |
| P1-088 | K | CS:249 `CallerScope` | E-A；项目/工作区守卫结果 | keep：修订链配套 | 不删 | 0 | 否 | 高 |
| P1-089 | K | CS:254-272 `readCallerScope` | E-A；读取并核对修订范围 pin | keep：修订链配套 | 不删 | 0 | 否 | 高 |
| P1-090 | K | CS:303-329 `restoreRevised` | E-A；从原事件恢复修订回执 | keep：修订重放配套 | 不删 | 0 | 否 | 高 |
| P1-091 | K | RC:16 `RoleConfigurationPort.installRoleSpec` | E-R；安装公开口 | keep：决定 34 | 不删 | 0 | 否 | 高 |
| P1-092 | K | RC:19 `RoleConfigurationPort.activateRoleSpec` | E-R；启用公开口 | keep：决定 34 | 不删 | 0 | 否 | 高 |
| P1-093 | K | RC:27-28 `RoleConfigurationPort.resolveRoleBinding` | E-R；解析角色绑定公开口 | keep：决定 34 | 不删 | 0 | 否 | 高 |
| P1-094 | K | RMEM:77 `CommittedStoreReceipt` | E-R；角色写入提交回执类型 | keep：角色写链配套 | 不删 | 0 | 否 | 高 |
| P1-095 | K | RMEM:83 `ROLE_INSTALL_IDENTITY_PREFIX` | E-R；安装幂等身份 | keep：角色写链配套 | 不删 | 0 | 否 | 高 |
| P1-096 | K | RMEM:84 `ROLE_ACTIVATE_IDENTITY_PREFIX` | E-R；启用幂等身份 | keep：角色写链配套 | 不删 | 0 | 否 | 高 |
| P1-097 | K | RMEM:91-98 `actorRefEquals` | E-R；核对原命令 actor | keep：角色写链配套 | 不删 | 0 | 否 | 高 |
| P1-098 | K | RMEM:132-134 `roleInstallIdentityKey` | E-R；安装身份键 | keep：角色写链配套 | 不删 | 0 | 否 | 高 |
| P1-099 | K | RMEM:135-137 `roleActivateIdentityKey` | E-R；启用身份键 | keep：角色写链配套 | 不删 | 0 | 否 | 高 |
| P1-100 | K | RMEM:176-188 `mapInstallStoreFailure` | E-R；安装存储失败映射 | keep：角色写链配套 | 不删 | 0 | 否 | 高 |
| P1-101 | K | RMEM:189-201 `mapActivateStoreFailure` | E-R；启用存储失败映射 | keep：角色写链配套 | 不删 | 0 | 否 | 高 |
| P1-102 | K | RE:421-428 `encodeRoleSpecRevisionSnapshot` | E-R；角色版本编码 | keep：安装链配套 | 不删 | 0 | 否 | 高 |
| P1-103 | K | RE:429-436 `encodeProjectRoleSpecActiveSnapshot` | E-R；当前角色指针编码 | keep：启用链配套 | 不删 | 0 | 否 | 高 |
| P1-104 | K | RE:437-439 `encodeRoleSpecInstalledEvent` | E-R；安装事件编码 | keep：安装链配套 | 不删 | 0 | 否 | 高 |
| P1-105 | K | RE:440-442 `encodeRoleSpecActivatedEvent` | E-R；启用事件编码 | keep：启用链配套 | 不删 | 0 | 否 | 高 |
| P1-106 | K | WS:45-131 `WorkspaceSourceIndexReader` | E-RS；路径权限和有界源码读取 | keep：保留决定尚未撤销 | 路径边界测试保留 | 0 | 否 | 中 |
| P1-107 | W | H:393 `GoalsSettingsBody` | E-W5；路由 :1140 当前请求 | keep：当前格式 | 不删 | 0 | 否 | 高 |
| P1-108 | W | H:394 `GoalsSettingsResponse` | E-W5；路由 :1140 当前响应 | keep：当前格式 | 不删 | 0 | 否 | 高 |
| P1-109 | W | H:395 `GoalsSettingsSetBody` | E-W5；路由 :1141 当前请求 | keep：当前格式 | 不删 | 0 | 否 | 高 |
| P1-110 | W | H:396 `GoalsSettingsSetResponse` | E-W5；路由 :1141 当前响应 | keep：当前格式 | 不删 | 0 | 否 | 高 |
| P1-111 | W | H:397 `GoalsReorderBody` | E-W5；路由 :1142 当前请求 | keep：当前格式 | 不删 | 0 | 否 | 高 |
| P1-112 | W | H:398 `GoalsReorderResponse` | E-W5；路由 :1142 当前响应 | keep：当前格式 | 不删 | 0 | 否 | 高 |
| P1-113 | W | H:399 `GoalsConflictsBody` | E-W5；路由 :1143 当前请求 | keep：当前格式 | 不删 | 0 | 否 | 高 |
| P1-114 | W | H:400 `GoalsConflictsResponse` | E-W5；路由 :1143 当前响应 | keep：当前格式 | 不删 | 0 | 否 | 高 |
| P1-115 | W | H:401 `PlansRequestCandidateBody` | E-W5；路由 :1144 当前请求 | keep：当前格式 | 不删 | 0 | 否 | 高 |
| P1-116 | W | H:402 `PlansRequestCandidateResponse` | E-W5；路由 :1144 当前响应 | keep：当前格式 | 不删 | 0 | 否 | 高 |
| P1-117 | W | H:403 `PlansAbandonBody` | E-W5；路由 :1145 当前请求 | keep：当前格式 | 不删 | 0 | 否 | 高 |
| P1-118 | W | H:404 `PlansAbandonResponse` | E-W5；路由 :1145 当前响应 | keep：当前格式 | 不删 | 0 | 否 | 高 |
| P1-119 | W | H:405 `DecisionsQueueBody` | E-W5；路由 :1146 当前请求 | keep：当前格式 | 不删 | 0 | 否 | 高 |
| P1-120 | W | H:406 `DecisionsQueueResponse` | E-W5；路由 :1146 当前响应 | keep：当前格式 | 不删 | 0 | 否 | 高 |
| P1-121 | W | H:407 `DecisionsCardBody` | E-W5；路由 :1147 当前请求 | keep：当前格式 | 不删 | 0 | 否 | 高 |
| P1-122 | W | H:408 `DecisionsCardResponse` | E-W5；路由 :1147 当前响应 | keep：当前格式 | 不删 | 0 | 否 | 高 |
| P1-123 | W | H:410 `DecisionsAnswerBody` | E-W5；路由 :1148 当前请求 | keep：当前格式 | 不删 | 0 | 否 | 高 |
| P1-124 | W | H:411 `DecisionsAnswerResponse` | E-W5；路由 :1148 当前响应 | keep：当前格式 | 不删 | 0 | 否 | 高 |
| P1-125 | W | H:412 `DecisionsApplicationBody` | E-W5；路由 :1149 当前请求 | keep：当前格式 | 不删 | 0 | 否 | 高 |
| P1-126 | W | H:413 `DecisionsApplicationResponse` | E-W5；路由 :1149 当前响应 | keep：当前格式 | 不删 | 0 | 否 | 高 |
| P1-127 | W | H:414 `DecisionsNoticesSeenBody` | E-W5；路由 :1150 当前请求 | keep：当前格式 | 不删 | 0 | 否 | 高 |
| P1-128 | W | H:415 `DecisionsNoticesSeenResponse` | E-W5；路由 :1150 当前响应 | keep：当前格式 | 不删 | 0 | 否 | 高 |
| P1-129 | W | H:416 `MessagesUserSendBody` | E-W5；路由 :1151 当前请求 | keep：当前格式 | 不删 | 0 | 否 | 高 |
| P1-130 | W | H:417 `MessagesUserSendResponse` | E-W5；路由 :1151 当前响应 | keep：当前格式 | 不删 | 0 | 否 | 高 |
| P1-131 | W | DC:53 `GOAL_SETTINGS_CHANGED_SCHEMA_ID` | E-EVT；对应事件仍写读，常量名未引用 | keep：格式当前；不谎称常量被读 | 不删 | 0 | 否 | 中 |
| P1-132 | W | DC:54 `WORKSPACE_NOTICE_SEEN_CHANGED_SCHEMA_ID` | E-EVT；对应事件仍写读，常量名未引用 | keep：格式当前；不谎称常量被读 | 不删 | 0 | 否 | 中 |
| P1-133 | W | MB:34-42 `UserDecisionBodyEnvelopeV1` | E-MSG；当前决定答复正文信封 | keep：当前格式 | 不删 | 0 | 否 | 高 |
| P1-134 | W | H:426 `ActivityCalendarBody` | E-W2；路由 :1153 当前请求 | keep：当前格式 | 不删 | 0 | 否 | 高 |
| P1-135 | W | H:427 `ActivityCalendarResponse` | E-W2；路由 :1153 当前响应 | keep：当前格式 | 不删 | 0 | 否 | 高 |
| P1-136 | W | H:428 `ActivityRunsBody` | E-W2；路由 :1154 当前请求 | keep：当前格式 | 不删 | 0 | 否 | 高 |
| P1-137 | W | H:429 `ActivityRunsResponse` | E-W2；路由 :1154 当前响应 | keep：当前格式 | 不删 | 0 | 否 | 高 |
| P1-138 | W | H:430 `ActivityTrackBody` | E-W2；路由 :1155 当前请求 | keep：当前格式 | 不删 | 0 | 否 | 高 |
| P1-139 | W | H:431 `ActivityTrackResponse` | E-W2；路由 :1155 当前响应 | keep：当前格式 | 不删 | 0 | 否 | 高 |
| P1-140 | W | H:432 `TasksTimelineBody` | E-W2；路由 :1156 当前请求 | keep：当前格式 | 不删 | 0 | 否 | 高 |
| P1-141 | W | H:433 `TasksTimelineResponse` | E-W2；路由 :1156 当前响应 | keep：当前格式 | 不删 | 0 | 否 | 高 |
| P1-142 | W | H:434 `ActivityBackfillBody` | E-W2；路由 :1157 当前请求 | keep：当前格式 | 不删 | 0 | 否 | 高 |
| P1-143 | W | H:435 `ActivityBackfillResponse` | E-W2；路由 :1157 当前响应 | keep：当前格式 | 不删 | 0 | 否 | 高 |
| P1-144 | K | NC:44 `NOTE_BODY_PAGE_MAX_BYTES` | E-NOTE；冻结上限仍在，原消费者说明失实 | keep：暂留规格常量，lead 更正保留依据 | 不删；未声称已接线 | 0 | 否 | 中 |
| P1-145 | W | H:485 `NotesListBody` | E-W4；路由 :1167 当前请求 | keep：当前格式 | 不删 | 0 | 否 | 高 |
| P1-146 | W | H:486 `NotesListResponse` | E-W4；路由 :1167 当前响应 | keep：当前格式 | 不删 | 0 | 否 | 高 |
| P1-147 | W | H:487 `NotesWriteBody` | E-W4；路由 :1168 当前请求 | keep：当前格式 | 不删 | 0 | 否 | 高 |
| P1-148 | W | H:488 `NotesWriteResponse` | E-W4；路由 :1168 当前响应 | keep：当前格式 | 不删 | 0 | 否 | 高 |
| P1-149 | W | H:489 `NotesWithdrawBody` | E-W4；路由 :1169 当前请求 | keep：当前格式 | 不删 | 0 | 否 | 高 |
| P1-150 | W | H:490 `NotesWithdrawResponse` | E-W4；路由 :1169 当前响应 | keep：当前格式 | 不删 | 0 | 否 | 高 |
| P1-151 | W | H:491 `NotesReviewBody` | E-W4；路由 :1170 当前请求 | keep：当前格式 | 不删 | 0 | 否 | 高 |
| P1-152 | W | H:492 `NotesReviewResponse` | E-W4；路由 :1170 当前响应 | keep：当前格式 | 不删 | 0 | 否 | 高 |
| P1-153 | W | H:493 `PlansVersionsBody` | E-W4；路由 :1171 当前请求 | keep：当前格式 | 不删 | 0 | 否 | 高 |
| P1-154 | W | H:494 `PlansVersionsResponse` | E-W4；路由 :1171 当前响应 | keep：当前格式 | 不删 | 0 | 否 | 高 |
| P1-155 | W | H:495 `ArchitectureVersionsBody` | E-W4；路由 :1172 当前请求 | keep：当前格式 | 不删 | 0 | 否 | 高 |
| P1-156 | W | H:496 `ArchitectureVersionsResponse` | E-W4；路由 :1172 当前响应 | keep：当前格式 | 不删 | 0 | 否 | 高 |
| P1-157 | K | AI:85-96 `FileGraphPageV1` | E-F；架构页文件图响应；不是旧持久块 v1 | keep：第 8 片明确消费者 | 不删 | 0 | 否 | 高 |
| P1-158 | K | AC:41 `FILE_GRAPH_CHUNK_SCHEMA_ID` | E-V2；只剩旧 @1 名称，无测试导入 | delete | 旧块格式已退出当前写读；决定 79-1 | 0 | 否 | 高 |
| P1-159 | K | AS:241-244 `readFileGraphCursor` | E-F；文件图读口游标校验 | keep：架构页读链配套 | 不删 | 0 | 否 | 高 |
| P1-160 | K | AP:158-160 `ObservedArchitecturePort.listFiles` | E-F；规格点名架构页 | keep：第 8 片明确消费者 | 不删 | 0 | 否 | 高 |
| P1-161 | K | AP:161-163 `ObservedArchitecturePort.neighbors` | E-F；文件邻接读取 | keep：第 8 片明确消费者 | 不删 | 0 | 否 | 高 |
| P1-162 | K | AP:164-166 `ObservedArchitecturePort.impact` | E-F；文件影响读取 | keep：第 8 片明确消费者 | 不删 | 0 | 否 | 高 |
| P1-163 | K | FG:21-26 `FileGraphPageData` | E-F；文件图分页数据 | keep：文件图读链配套 | 不删 | 0 | 否 | 高 |
| P1-164 | K | FG:29-32 `FileGraphData` | E-F；文件图输入数据 | keep：文件图读链配套 | 不删 | 0 | 否 | 高 |
| P1-165 | K | FG:34 `FILE_GRAPH_PAGE_SIZE` | E-F；规格一页 200 | keep：文件图读链配套 | 不删 | 0 | 否 | 高 |
| P1-166 | K | FG:35 `FILE_GRAPH_MAX_IMPACT_DEPTH` | E-F；规格深度最多 3 | keep：文件图读链配套 | 不删 | 0 | 否 | 高 |
| P1-167 | K | FG:37-42 `FileGraphCursorError` | E-F；拒绝错误游标 | keep：真实读边界配套 | 不删 | 0 | 否 | 高 |
| P1-168 | K | FG:44-46 `captureKeyOf` | E-F；游标绑定捕获身份 | keep：文件图读链配套 | 不删 | 0 | 否 | 高 |
| P1-169 | K | FG:47-49 `queryKeyOf` | E-F；游标绑定查询身份 | keep：文件图读链配套 | 不删 | 0 | 否 | 高 |
| P1-170 | K | FG:50-63 `readOffset` | E-F；读取并核对分页位置 | keep：文件图读链配套 | 不删 | 0 | 否 | 高 |
| P1-171 | K | FG:66-70 `orderedNodes` | E-F；稳定节点顺序 | keep：文件图读链配套 | 不删 | 0 | 否 | 高 |
| P1-172 | K | FG:72-82 `orderedEdges` | E-F；稳定边顺序 | keep：文件图读链配套 | 不删 | 0 | 否 | 高 |
| P1-173 | K | FG:83-93 `buildPage` | E-F；构造分页结果 | keep：文件图读链配套 | 不删 | 0 | 否 | 高 |
| P1-174 | K | FG:96-100 `listFilesPage` | E-F；文件列表分页 | keep：架构页读链配套 | 不删 | 0 | 否 | 高 |
| P1-175 | K | FG:103-117 `neighborsPage` | E-F；邻接分页 | keep：架构页读链配套 | 不删 | 0 | 否 | 高 |
| P1-176 | K | FG:120-147 `impactPage` | E-F；影响范围分页 | keep：架构页读链配套 | 不删 | 0 | 否 | 高 |
| P1-177 | K | TC:181-183 `toolCommitLookupNotPublished` | E-K39；生产分派重复字面结果 | change:生产分派调用此助手并移除白名单 | K3-39 保留 | 0 | 是 | 高 |
| P1-178 | K | CN:12-14 `ShellActionsResult` | E-PARSE；冻结的公开投影类型 | keep：规格明确保留 | B2-10 规则测试保留 | 0 | 是 | 高 |
| P1-179 | K | CN:524-529 `parseShellActions` | E-PARSE；冻结的公开简版解析口 | keep：规格明确保留 | B2-10 规则测试保留 | 0 | 是 | 高 |
| P1-180 | K | UK:44-46 `kernelToolNameOf` | E-NAME；生产重复 write→edit | change:实际工具名装配调用此函数并移除白名单 | K3-34 与规则表测试保留 | 0 | 是 | 高 |
| P1-181 | K | UR:37 `UNKNOWN_CALL_REVIEW_RESERVED_BYTES` | E-BUDGET；创建预算未引用预留常量 | change:创建预算写成MAX减RESERVED减32并移除白名单 | 预算数值和 K3 规则不变 | 0 | 是 | 高 |
| P1-182 | K | UR:129 `UnknownCallReviewEvent`；两个测试导入见下 | E-ALIAS；纯同义别名 | delete | 当前 `UnknownCallReviewEventV1`；全部行为测试保留 | 4 | 是 | 高 |
| P1-183 | C | 31 个 `src` 文件各 :1，完整清单见 E-C1A | 同一迁移来源注释已失去当前用途 | delete | 注释无行为；C1 明确转交 | 0 | 否 | 高 |
| P1-184 | C | `src/core/work-graph/views/track-read-model.ts:224-226` | E-C1B；缺 ca 被当 null 的旧游标兼容 | change:ca必须为string或null，删除缺字段兼容 | 当前编码器及分页测试保留 | 0 | 是 | 高 |
| P1-185 | C | `src/core/work-graph/model/claim-contracts.ts:95-107` | E-C1C；与 state 的 outbox 形状重复 | change:TaskClaimOutbox改为DispatchOutboxRecord别名 | state 单一声明；调用方名字不变 | 0 | 否 | 高 |
| P1-186 | C | `src/core/work-graph/model/claim-contracts.ts:92`；中转出口见下 | E-C1C；V1 同义别名另有 codec 转出 | delete | 当前 `DispatchStateV1`；仅去掉别名恒等断言 | 5 | 否 | 高 |
| P1-187 | C | `tests/kernel/RL-12-15-conditions.test.ts:360,403`；RL-15b(a)/(b) | E-C1D；两处均没有下界容差 | change:两处下界改9990ms，上界仍12000ms | 原失败分类、回收、缓存断言全部保留 | 2 | 是 | 高 |
| P1-188 | N | `src/business/workflow/contracts.ts:60-68` 及所有出口、旧分支见下 | E-N0；未实现旧形状，决定 85-4 指定删除 | delete | 当前两种初始规划分支与业务流程测试保留 | 5 | 否 | 高 |

**删除及修改项的精确范围**

**P1-158。** 只删除 `src/core/work-graph/architecture/architecture-record-codecs.ts:41` 的 `FILE_GRAPH_CHUNK_SCHEMA_ID` 声明及其白名单项 `tests/architecture/production-reach-allowlist.json:946-951`。全 `src/`、`tests/` 名称检索没有测试导入；测试目录内只有白名单字符串命中。保留当前 v2 校验器、解码器、content type、manifest 和文件图公开响应 `FileGraphPageV1`。后者名称中的 V1 不代表持久块仍写 v1，见 E-F、E-V2。

**P1-177。** 在 `src/composition/tool-commit-lookup.ts:48` 用 `toolCommitLookupNotPublished()` 替换相同的字面返回值，并增加其导入；助手声明保留。相关测试是 `tests/work-graph/K3-39-tool-commit-lookup.test.ts:20,72`，保留断言。接线后移除白名单 `tests/architecture/production-reach-allowlist.json:1060-1065`。

**P1-180。** 在 `src/core/agent-runtime/observed-model-run.ts:303` 将内联映射换成 `allowed.map(kernelToolNameOf)` 并导入助手。相关测试：

- `tests/runtime/K3-34-tool-name-constants.test.ts:22,50-52,61`；
- `tests/state/unknown-call-kinds.test.ts:14,68-72`。

这些测试不删除。该建议不增加新映射规则；接线后移除白名单 `tests/architecture/production-reach-allowlist.json:1078-1083`。

**P1-181。** 修改 `src/core/work-graph/state/unknown-call-review.ts:38-39` 的预算表达式和说明，明确：
`UNKNOWN_CALL_REVIEW_MAX_BYTES - UNKNOWN_CALL_REVIEW_RESERVED_BYTES - 32`。
结果仍为 `158720`。保留 `:37` 的预留常量，移除其白名单 `tests/architecture/production-reach-allowlist.json:1084-1089`。不要求改动测试，尤其不把规格允许的 32 字节余量“修正”掉。

**P1-182。** 删除 `src/core/work-graph/state/unknown-call-review.ts:129` 的同义别名及白名单 `tests/architecture/production-reach-allowlist.json:1090-1095`。测试导入和类型使用全部如下：

- `tests/state/unknown-call-review.test.ts:30` 导入，`:157` 参数；
- `tests/work-graph/K3-45-review-incomplete.test.ts:20` 导入，`:114` 参数。

这四处改用 `UnknownCallReviewEventV1`，不删测试体、不删冻结状态机行。没有要保留的“旧事件行为”，删除的只是重复命名。

**E-C1A / P1-183。** 精确匹配如下整行，共 31 处，均在第 1 行：

```text
// Migrated contract declarations; source provenance is recorded in the N0 transfer manifest.
```

完整位置：

```text
src/contracts/architecture-inspection.ts:1
src/contracts/architecture-source.ts:1
src/contracts/artifact.ts:1
src/contracts/command-event.ts:1
src/contracts/context-continuity.ts:1
src/contracts/control-intent.ts:1
src/contracts/coordination.ts:1
src/contracts/core/call-context.ts:1
src/contracts/core/identity.ts:1
src/contracts/core/results.ts:1
src/contracts/core/source.ts:1
src/contracts/dispatch.ts:1
src/contracts/evidence.ts:1
src/contracts/fingerprint.ts:1
src/contracts/goal-change.ts:1
src/contracts/goal-phase.ts:1
src/contracts/governance.ts:1
src/contracts/human-role-collaboration.ts:1
src/contracts/initial-planning.ts:1
src/contracts/ledger.ts:1
src/contracts/material-access.ts:1
src/contracts/opaque.ts:1
src/contracts/plan.ts:1
src/contracts/query-job.ts:1
src/contracts/reduction.ts:1
src/contracts/reviewer-work.ts:1
src/contracts/role-spec.ts:1
src/contracts/task-envelope.ts:1
src/contracts/validation/common.ts:1
src/contracts/validation/goal.ts:1
src/contracts/validation/identity.ts:1
```

只删注释，共 **31 行生产文件文本**，不是删除这些文件或其声明。没有测试导入“注释”，没有需要删除的测试断言；行为覆盖不适用。转交依据是 `.lead-ref/t-area-P1.txt:9-10`。

**E-C1B / P1-184。** `QueryCursor.ca` 已是必填的 `string | null`，见 `src/core/work-graph/views/track-read-model.ts:195`。当前编码器直接编码当前对象，见 `:200-202`；构造查询游标的分支带 `ca`，见 `:908,920,976,988`。将 `:224-226` 改成：

```ts
if (!isStringOrNull(ca)) return null;
return { a: a as number, p, c, p2, o, k, occ, ca };
```

删掉“earlier versions”注释，不扩大到其他可选字段。缺失 `ca` 的旧游标按无效输入处理，是外部游标边界校验，不属于“只有篡改数据库才能触发”的检查。

直接相关、应保留的测试包括：

- `tests/work-graph/S2B-30-track-bars.test.ts:137-143`：连续页游标读取；
- `tests/work-graph/S2B-r2-r3-track-pagination.test.ts:54-76`，`2B-r2 R3 a Run added before the boundary does not duplicate or skip`；
- `tests/app/S2B-35-activity-routes.test.ts:232`：HTTP 对应轨道读口；
- 查询副本相关轨道覆盖仍保留，例如 `tests/work-graph/S2B-30-track-bars.test.ts:365-380`、`tests/work-graph/S2B-r3-consultation-cap.test.ts:51`。

没有找到专门断言“缺 ca 仍接受”的测试，因此不报虚构的测试删除量。依据决定 79-1，`docs/refactor/HANDOFF.md:565-570`。

**E-C1C / P1-185、186。**

1. 以 `src/core/work-graph/state/attempt-machine.ts:64-71` 的 `DispatchOutboxRecord` 为唯一形状。
2. 将 `src/core/work-graph/model/claim-contracts.ts:95-107` 改为 `export type TaskClaimOutbox = DispatchOutboxRecord`，调整 `:24` 的导入。保留 `TaskClaimOutbox` 这个仍有真实调用方的接口名称。
3. 删除 `src/core/work-graph/model/claim-contracts.ts:92` 的 `TaskDispatchStateV1`；清理不再使用的类型导入，并更正 `:93` “beside V1”的说明。
4. **任务书列举之外还有一个中转出口**：删除 `src/core/work-graph/persistence/execution-entry-codecs.ts:39` 的导入及 `:45` 的同名转出；`:9` 的说明改为当前实际状态类型。这里不是删除 `DispatchStateV1` 格式或其校验。
5. 在 `tests/state/attempt-machine.test.ts:37` 去掉 `TaskDispatchStateV1` 导入；在 `:705` 的 `DispatchOutboxRecord is the TaskClaimOutbox record of claim-contracts.ts` 测试中，只去掉 `:708-709,711-712` 的 V1 别名恒等转换及断言。保留 `:706-707,710` 的 outbox 接口断言。合计 **5 行测试修改/删除**。

`TaskClaimOutbox` 的直接测试导入如下；改成别名后这些消费者不需改名：

```text
tests/runtime/R4c-graph-history.test.ts:32
tests/runtime/S3-context-assembler.test.ts:49
tests/state/attempt-machine.test.ts:37
tests/state/invariants.test.ts:48
tests/state/invariants.ts:92
tests/work-graph/R4c-execution-history-index.test.ts:29
```

生产消费者仍包括 `src/core/work-graph/communication/mailbox-service.ts:88,1150,1252`、`src/core/work-graph/model/execution-read-contracts.ts:20,28`、`src/core/work-graph/tasks/claim-record-codecs.ts:35,272,279,323`、`src/core/work-graph/tasks/run-state-service.ts:77,224,517`。因此不能连名字一起删除。

`tests/architecture/state-writes.test.ts:100-102` 对这些 record 名称的检查保留。状态迁移仍归 `state/`，符合 `AGENTS.md:38`。

**E-C1D / P1-187。** 两处都应改，不能只修第一次报错的位置：

| 测试 | 下界位置 | 保留的上界 |
|---|---|---|
| `RL-15b (a) a hanging systemd-run --version stops at the 10 s deadline and reports probe_failed` | `tests/kernel/RL-12-15-conditions.test.ts:360` | `:361`，12000 ms |
| `RL-15b (b) a bwrap whose --version hangs ends as probe_failed, not sandbox_unavailable` | `tests/kernel/RL-12-15-conditions.test.ts:403` | `:404`，12000 ms |

建议两处均为 **`elapsed >= 9_990` 且 `elapsed <= 12_000`**。10 ms 是名义 10 秒的 0.1%，给计时和定时器边界留小幅余量，足以容纳任务书记录的 9999.91 ms；仍能拒绝明显提前结束。这个容差是建议值，不是本次测量所得。

保留单调时钟计时 `:349-353,397-399`，保留 `probe_failed` 分类、缓存和子进程回收断言 `:355-377,401-406`。不修改生产 10 秒超时，不删除 RL-15b 冻结行。

**E-N0 / P1-188。** 清理依据是 `docs/refactor/HANDOFF.md:683` 的决定 85-4，以及结构审查
`docs/refactor/reviews/evidence/structure-review-d84-2026-10-19/codex/d84-struct-D.out.md:93`。精确范围如下：

| 文件位置 | 删除或收窄内容 |
|---|---|
| `src/business/workflow/contracts.ts:60-68` | 删除 `N0GoalInput` 及其 N0-only 注释；旧形状是 `meta / goal / requestBodyRef / text / action.request_work`。 |
| `src/business/workflow/contracts.ts:1,3,18` | 分别清理仅供该形状使用的 `ArtifactRef`、`CommandMeta`、`CreateGoalInput` 导入；保留同一 import 中其他仍用的名字。 |
| `src/business/workflow/index.ts:4` | 删除 `N0GoalInput` 转出。 |
| `src/business/workflow/ports.ts:42` | 删除该类型导入。 |
| `src/business/workflow/ports.ts:221-226` | 清理旧骨架说明；`handleGoalInput` 参数收窄为 `InitialPlanningGoalInput`。 |
| `src/business/workflow/workflow.ts:40` | 删除该类型导入。 |
| `src/business/workflow/workflow.ts:810,813` | 删除 N0 unsupported 注释；参数 union 去掉 `N0GoalInput`。 |
| `src/business/workflow/workflow.ts:815-819` | 删除“接受 N0 但未实现”的专门语义和错误文字。保留真实输入的 kind 校验；非 `planning_answer/adopt_initial_plan` 应按当前输入无效处理，建议返回 `invalid`，不继续宣传 N0 骨架。 |
| `tests/composition/platform.test.ts:79-83` | 删除旧形状调用及 `unsupported` 断言，共 5 行。所属测试是 `:50` 的 `%s: public composition wires Host material and real workspace reads with narrow unsupported gaps`，memory/sqlite 两种参数化执行；其余材料、工作区、关闭重开断言全部保留。 |

全树检索未发现测试按名称导入 `N0GoalInput`；上述 `platform.test.ts:79-83` 是旧形状调用。`handleGoalInput` 的现行消费者和出口必须保留：

- `src/business/workflow/workflow.ts:828` 起的 `planning_answer` 分支和后续采用分支，以及 `:2939` 的公开返回；
- `src/composition/create-platform.ts:1927` 的装配；
- `src/app/core-routes.ts:1097` 的路由；
- `src/app/core-http-types.ts:523-524` 的当前请求/响应类型，尤其 P1-048；
- `tests/business/R5b-initial-planning-workflow.test.ts:247` 的 `consumes the answer, adopts the candidate, then advances to a formal Goal completion`，实际调用在 `:292,311`；
- `tests/app/R6-host.test.ts:711` 的公开 Query/Workflow 流程，相关调用在 `:807,834`；
- `tests/app/R6-workbench.test.ts:591` 的当前界面调用。

这里删除的是从未实现的旧输入入口，不是已经实现的初始规划能力，也不预先实现第 6 片新协议。

**同一盘点结果的 JSON**

`evidence` 中的 E-* 引用严格对应上文证据索引及精确范围；`covered_by: "不删"` 表示本条没有删除行为。

```json
[
  {"id":"P1-001","category":"allowlist-pre-batch","file":"src/app/core-http-types.ts","lines":"298","tests":[],"evidence":"E-H；ProjectsCreateBody：创建项目请求；保留供HTTP调用方使用","action":"user-decides","covered_by":"建议保留","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-002","category":"allowlist-pre-batch","file":"src/app/core-http-types.ts","lines":"300","tests":[],"evidence":"E-H；WorkspacesRegisterBody：登记工作区请求；建议保留具名契约","action":"user-decides","covered_by":"建议保留","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-003","category":"allowlist-pre-batch","file":"src/app/core-http-types.ts","lines":"302","tests":[],"evidence":"E-H；CompletionPoliciesInstallBody：安装完成标准请求；建议保留","action":"user-decides","covered_by":"建议保留","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-004","category":"allowlist-pre-batch","file":"src/app/core-http-types.ts","lines":"304","tests":[],"evidence":"E-H；CompletionPoliciesActivateBody：启用完成标准请求；建议保留","action":"user-decides","covered_by":"建议保留","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-005","category":"allowlist-pre-batch","file":"src/app/core-http-types.ts","lines":"306","tests":[],"evidence":"E-H；CompletionPoliciesReadBody：读取完成标准请求；建议保留","action":"user-decides","covered_by":"建议保留","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-006","category":"allowlist-pre-batch","file":"src/app/core-http-types.ts","lines":"307","tests":[],"evidence":"E-H；CompletionPoliciesReadResponse：完成标准响应；建议保留","action":"user-decides","covered_by":"建议保留","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-007","category":"allowlist-pre-batch","file":"src/app/core-http-types.ts","lines":"308","tests":[],"evidence":"E-H；GoalsCreateBody：创建目标请求；建议保留","action":"user-decides","covered_by":"建议保留","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-008","category":"allowlist-pre-batch","file":"src/app/core-http-types.ts","lines":"310","tests":[],"evidence":"E-H；GoalsReadBody：读取目标请求；建议保留","action":"user-decides","covered_by":"建议保留","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-009","category":"allowlist-pre-batch","file":"src/app/core-http-types.ts","lines":"311","tests":[],"evidence":"E-H；GoalsReadResponse：读取目标响应；建议保留","action":"user-decides","covered_by":"建议保留","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-010","category":"allowlist-pre-batch","file":"src/app/core-http-types.ts","lines":"312","tests":[],"evidence":"E-H；ArchitectureAdoptInitialBody：采用初始架构请求；建议保留","action":"user-decides","covered_by":"建议保留","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-011","category":"allowlist-pre-batch","file":"src/app/core-http-types.ts","lines":"315","tests":[],"evidence":"E-H；ArchitectureReadResponse：正式架构读取响应；建议保留","action":"user-decides","covered_by":"建议保留","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-012","category":"allowlist-pre-batch","file":"src/app/core-http-types.ts","lines":"319-325","tests":[],"evidence":"E-H；ArchitectureCaptureBody：观测捕获请求，排除内部requestSeq；建议保留","action":"user-decides","covered_by":"建议保留","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-013","category":"allowlist-pre-batch","file":"src/app/core-http-types.ts","lines":"326","tests":[],"evidence":"E-H；ArchitectureCaptureResponse：观测捕获响应；建议保留","action":"user-decides","covered_by":"建议保留","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-014","category":"allowlist-pre-batch","file":"src/app/core-http-types.ts","lines":"327","tests":[],"evidence":"E-H；ArchitectureQueryBody：观测架构查询请求；建议保留","action":"user-decides","covered_by":"建议保留","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-015","category":"allowlist-pre-batch","file":"src/app/core-http-types.ts","lines":"328","tests":[],"evidence":"E-H；ArchitectureQueryResponse：观测架构查询响应；建议保留","action":"user-decides","covered_by":"建议保留","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-016","category":"allowlist-pre-batch","file":"src/app/core-http-types.ts","lines":"329","tests":[],"evidence":"E-H；PlansProposeBody：提出计划变更请求；建议保留","action":"user-decides","covered_by":"建议保留","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-017","category":"allowlist-pre-batch","file":"src/app/core-http-types.ts","lines":"331","tests":[],"evidence":"E-H；PlansApplyBody：采用计划变更请求；建议保留","action":"user-decides","covered_by":"建议保留","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-018","category":"allowlist-pre-batch","file":"src/app/core-http-types.ts","lines":"333","tests":[],"evidence":"E-H；PlansProposalBody：读取计划提议请求；建议保留","action":"user-decides","covered_by":"建议保留","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-019","category":"allowlist-pre-batch","file":"src/app/core-http-types.ts","lines":"334","tests":[],"evidence":"E-H；PlansProposalResponse：计划提议响应；建议保留","action":"user-decides","covered_by":"建议保留","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-020","category":"allowlist-pre-batch","file":"src/app/core-http-types.ts","lines":"335","tests":[],"evidence":"E-H；TasksQueryBody：任务图查询请求；建议保留","action":"user-decides","covered_by":"建议保留","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-021","category":"allowlist-pre-batch","file":"src/app/core-http-types.ts","lines":"336","tests":[],"evidence":"E-H；TasksQueryResponse：任务图查询响应；建议保留","action":"user-decides","covered_by":"建议保留","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-022","category":"allowlist-pre-batch","file":"src/app/core-http-types.ts","lines":"337","tests":[],"evidence":"E-H；FilesReadBody：读取工作区文件请求；建议保留","action":"user-decides","covered_by":"建议保留","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-023","category":"allowlist-pre-batch","file":"src/app/core-http-types.ts","lines":"342","tests":[],"evidence":"E-H；FilesListBody：工作区文件列表请求；建议保留","action":"user-decides","covered_by":"建议保留","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-024","category":"allowlist-pre-batch","file":"src/app/core-http-types.ts","lines":"343","tests":[],"evidence":"E-H；FilesListResponse：工作区文件列表响应；建议保留","action":"user-decides","covered_by":"建议保留","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-025","category":"allowlist-pre-batch","file":"src/app/core-http-types.ts","lines":"346","tests":[],"evidence":"E-H；SourceCaptureBody：源码材料捕获请求；建议保留","action":"user-decides","covered_by":"建议保留","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-026","category":"allowlist-pre-batch","file":"src/app/core-http-types.ts","lines":"348","tests":[],"evidence":"E-H；SourceQueryBody：已捕获源码查询请求；建议保留","action":"user-decides","covered_by":"建议保留","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-027","category":"allowlist-pre-batch","file":"src/app/core-http-types.ts","lines":"362","tests":[],"evidence":"E-H；SessionsFindBody：Session查找请求；建议保留","action":"user-decides","covered_by":"建议保留","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-028","category":"allowlist-pre-batch","file":"src/app/core-http-types.ts","lines":"364","tests":[],"evidence":"E-H；SessionsReadBody：Session读取请求；建议保留","action":"user-decides","covered_by":"建议保留","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-029","category":"allowlist-pre-batch","file":"src/app/core-http-types.ts","lines":"366","tests":[],"evidence":"E-H；SessionsOperationBody：Session操作状态请求；建议保留","action":"user-decides","covered_by":"建议保留","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-030","category":"allowlist-pre-batch","file":"src/app/core-http-types.ts","lines":"368","tests":[],"evidence":"E-H；RuntimeCapabilitiesBody：运行能力查询请求；建议保留","action":"user-decides","covered_by":"建议保留","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-031","category":"allowlist-pre-batch","file":"src/app/core-http-types.ts","lines":"370","tests":[],"evidence":"E-H；SessionsCreateBody：Session创建请求；建议保留","action":"user-decides","covered_by":"建议保留","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-032","category":"allowlist-pre-batch","file":"src/app/core-http-types.ts","lines":"372","tests":[],"evidence":"E-H；SessionsHistoryBody：原历史读取请求；建议保留","action":"user-decides","covered_by":"建议保留","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-033","category":"allowlist-pre-batch","file":"src/app/core-http-types.ts","lines":"374","tests":[],"evidence":"E-H；MessagesSendBody：成员消息发送请求；建议保留","action":"user-decides","covered_by":"建议保留","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-034","category":"allowlist-pre-batch","file":"src/app/core-http-types.ts","lines":"376","tests":[],"evidence":"E-H；MessagesInboxBody：收件箱读取请求；建议保留","action":"user-decides","covered_by":"建议保留","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-035","category":"allowlist-pre-batch","file":"src/app/core-http-types.ts","lines":"378","tests":[],"evidence":"E-H；MessagesReadBody：消息记录读取请求；建议保留","action":"user-decides","covered_by":"建议保留","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-036","category":"allowlist-pre-batch","file":"src/app/core-http-types.ts","lines":"380","tests":[],"evidence":"E-H；MessagesBodyBody：消息正文读取请求；建议保留","action":"user-decides","covered_by":"建议保留","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-037","category":"allowlist-pre-batch","file":"src/app/core-http-types.ts","lines":"382","tests":[],"evidence":"E-H；MessagesOutboxBody：发件箱读取请求；建议保留","action":"user-decides","covered_by":"建议保留","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-038","category":"allowlist-pre-batch","file":"src/app/core-http-types.ts","lines":"383","tests":[],"evidence":"E-H；MessagesOutboxResponse：发件箱响应；建议保留","action":"user-decides","covered_by":"建议保留","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-039","category":"allowlist-pre-batch","file":"src/app/core-http-types.ts","lines":"505","tests":[],"evidence":"E-H；WorkspacesRegistrationBody：工作区登记读取请求；建议保留","action":"user-decides","covered_by":"建议保留","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-040","category":"allowlist-pre-batch","file":"src/app/core-http-types.ts","lines":"509","tests":[],"evidence":"E-H；QueriesReadBody：查询任务读取请求；建议保留","action":"user-decides","covered_by":"建议保留","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-041","category":"allowlist-pre-batch","file":"src/app/core-http-types.ts","lines":"511","tests":[],"evidence":"E-H；QueriesClaimBody：查询任务领取请求；建议保留","action":"user-decides","covered_by":"建议保留","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-042","category":"allowlist-pre-batch","file":"src/app/core-http-types.ts","lines":"512","tests":[],"evidence":"E-H；QueriesClaimResponse：查询任务领取响应；建议保留","action":"user-decides","covered_by":"建议保留","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-043","category":"allowlist-pre-batch","file":"src/app/core-http-types.ts","lines":"513","tests":[],"evidence":"E-H；QueriesPrepareBody：查询执行准备请求；建议保留","action":"user-decides","covered_by":"建议保留","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-044","category":"allowlist-pre-batch","file":"src/app/core-http-types.ts","lines":"515","tests":[],"evidence":"E-H；QueriesStartBody：查询执行启动请求；建议保留","action":"user-decides","covered_by":"建议保留","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-045","category":"allowlist-pre-batch","file":"src/app/core-http-types.ts","lines":"517","tests":[],"evidence":"E-H；QueriesObserveBody：查询执行观察请求；建议保留","action":"user-decides","covered_by":"建议保留","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-046","category":"allowlist-pre-batch","file":"src/app/core-http-types.ts","lines":"518","tests":[],"evidence":"E-H；QueriesObserveResponse：查询执行观察响应；建议保留","action":"user-decides","covered_by":"建议保留","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-047","category":"allowlist-pre-batch","file":"src/app/core-http-types.ts","lines":"521","tests":[],"evidence":"E-H；MaterialsOpenBody：材料打开请求；建议保留","action":"user-decides","covered_by":"建议保留","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-048","category":"allowlist-pre-batch","file":"src/app/core-http-types.ts","lines":"524","tests":[],"evidence":"E-H、E-N0；WorkflowGoalInputResponse是现行初始规划响应，不随N0删除","action":"user-decides","covered_by":"建议保留；当前handleGoalInput","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-049","category":"allowlist-pre-batch","file":"src/app/core-http-types.ts","lines":"526","tests":[],"evidence":"E-H；WorkflowAdvanceResponse：推进响应；建议保留","action":"user-decides","covered_by":"建议保留","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-050","category":"allowlist-pre-batch","file":"src/app/core-http-types.ts","lines":"537","tests":[],"evidence":"E-H；WorkflowDriverReadBody：持续驱动读取请求；建议保留","action":"user-decides","covered_by":"建议保留","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-051","category":"allowlist-pre-batch","file":"src/app/core-http-types.ts","lines":"539","tests":[],"evidence":"E-H；WorkflowDriverStopBody：持续驱动停止请求；建议保留","action":"user-decides","covered_by":"建议保留","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-052","category":"allowlist-pre-batch","file":"src/app/core-http-types.ts","lines":"550","tests":[],"evidence":"E-H；ExecutionsReadBody：执行读取请求；建议保留","action":"user-decides","covered_by":"建议保留","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-053","category":"allowlist-pre-batch","file":"src/app/core-http-types.ts","lines":"552","tests":[],"evidence":"E-H；ExecutionsHistoryBody：任务执行历史请求；建议保留","action":"user-decides","covered_by":"建议保留","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-054","category":"allowlist-pre-batch","file":"src/app/core-http-types.ts","lines":"567","tests":[],"evidence":"E-H；ExecutionsListBody：执行列表请求；建议保留","action":"user-decides","covered_by":"建议保留","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-055","category":"allowlist-pre-batch","file":"src/app/core-http-types.ts","lines":"569","tests":[],"evidence":"E-H；ProjectsReadBody：项目读取请求；建议保留","action":"user-decides","covered_by":"建议保留","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-056","category":"allowlist-pre-batch","file":"src/app/core-http-types.ts","lines":"571","tests":[],"evidence":"E-H；FilesSaveBody：工作区文件保存请求；建议保留","action":"user-decides","covered_by":"建议保留","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-057","category":"allowlist-pre-batch","file":"src/app/core-http-types.ts","lines":"573","tests":[],"evidence":"E-H；FilesCompareBody：工作区文件比较请求；建议保留","action":"user-decides","covered_by":"建议保留","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-058","category":"allowlist-pre-batch","file":"src/app/core-http-types.ts","lines":"575","tests":[],"evidence":"E-H；CommandsStartBody：命令启动请求；建议保留","action":"user-decides","covered_by":"建议保留","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-059","category":"allowlist-pre-batch","file":"src/app/core-http-types.ts","lines":"577","tests":[],"evidence":"E-H；CommandsReadBody：命令状态读取请求；建议保留","action":"user-decides","covered_by":"建议保留","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-060","category":"allowlist-pre-batch","file":"src/app/core-http-types.ts","lines":"579","tests":[],"evidence":"E-H；CommandsStopBody：命令停止请求；建议保留","action":"user-decides","covered_by":"建议保留","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-061","category":"allowlist-pre-batch","file":"src/app/main.ts","lines":"19-29","tests":[],"evidence":"E-CLI；WorkbenchCliWorkspace：说明单工作区启动配置；建议保留","action":"user-decides","covered_by":"建议保留","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-062","category":"allowlist-pre-batch","file":"src/app/main.ts","lines":"31-51","tests":[],"evidence":"E-CLI；WorkbenchCliConfig：说明整体启动JSON；建议保留","action":"user-decides","covered_by":"建议保留","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-063","category":"allowlist-kept-for","file":"src/contracts/human-role-collaboration.ts","lines":"73-76","tests":[],"evidence":"E-R；CoordinationPolicyPin未找到明确后续调用点；既有角色保留决定未撤销","action":"keep","covered_by":"暂留；lead需明确消费者，不能认定已取消","est_lines":0,"spec_row":false,"confidence":"低"},
  {"id":"P1-064","category":"allowlist-kept-for","file":"src/contracts/role-material-channels.ts","lines":"3-16","tests":[],"evidence":"E-RS；RoleSourceIndexRequestV1：角色有界源码请求","action":"keep","covered_by":"不删；角色读取保留决定","est_lines":0,"spec_row":false,"confidence":"中"},
  {"id":"P1-065","category":"allowlist-kept-for","file":"src/contracts/role-material-channels.ts","lines":"17-19","tests":[],"evidence":"E-RS；RoleSourceIndexEntryV1：角色源码索引条目","action":"keep","covered_by":"不删；角色读取配套","est_lines":0,"spec_row":false,"confidence":"中"},
  {"id":"P1-066","category":"allowlist-kept-for","file":"src/contracts/role-material-channels.ts","lines":"20-25","tests":[],"evidence":"E-RS；RoleSourceIndexExcerptV1：角色源码片段","action":"keep","covered_by":"不删；角色读取配套","est_lines":0,"spec_row":false,"confidence":"中"},
  {"id":"P1-067","category":"allowlist-kept-for","file":"src/contracts/role-material-channels.ts","lines":"26-48","tests":[],"evidence":"E-RS；RoleSourceIndexResultV1：有界读取结果","action":"keep","covered_by":"不删；角色读取配套","est_lines":0,"spec_row":false,"confidence":"中"},
  {"id":"P1-068","category":"allowlist-kept-for","file":"src/contracts/role-material-channels.ts","lines":"50-52","tests":[],"evidence":"E-RS；RoleSourceIndexPort：角色源码读取口","action":"keep","covered_by":"不删；已有保留决定","est_lines":0,"spec_row":false,"confidence":"中"},
  {"id":"P1-069","category":"allowlist-kept-for","file":"src/contracts/role-spec.ts","lines":"46","tests":[],"evidence":"E-R；ROLE_SPEC_REVISION：角色规格版本","action":"keep","covered_by":"不删；决定34","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-070","category":"allowlist-kept-for","file":"src/contracts/role-spec.ts","lines":"154-156","tests":[],"evidence":"E-R；roleSpecRevisionRefFor：角色版本引用构造；当前无调用","action":"keep","covered_by":"不删；角色规格配套，接线时复核","est_lines":0,"spec_row":false,"confidence":"中"},
  {"id":"P1-071","category":"allowlist-kept-for","file":"src/contracts/role-spec.ts","lines":"177-190","tests":[],"evidence":"E-R；InstallRoleSpecRevisionCommand：安装命令","action":"keep","covered_by":"不删；决定34","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-072","category":"allowlist-kept-for","file":"src/contracts/role-spec.ts","lines":"191-203","tests":[],"evidence":"E-R；ActivateRoleSpecRevisionCommand：启用命令","action":"keep","covered_by":"不删；决定34","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-073","category":"allowlist-kept-for","file":"src/contracts/role-spec.ts","lines":"204-216","tests":[],"evidence":"E-R；InstallRoleSpecRevisionReceipt：安装回执","action":"keep","covered_by":"不删；决定34","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-074","category":"allowlist-kept-for","file":"src/contracts/role-spec.ts","lines":"217-229","tests":[],"evidence":"E-R；ActivateRoleSpecRevisionReceipt：启用回执","action":"keep","covered_by":"不删；决定34","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-075","category":"allowlist-kept-for","file":"src/contracts/role-spec.ts","lines":"230-238","tests":[],"evidence":"E-R；installRoleSpecRevisionFingerprint：安装幂等指纹","action":"keep","covered_by":"不删；角色安装链","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-076","category":"allowlist-kept-for","file":"src/contracts/role-spec.ts","lines":"239-247","tests":[],"evidence":"E-R；activateRoleSpecRevisionFingerprint：启用幂等指纹","action":"keep","covered_by":"不删；角色启用链","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-077","category":"allowlist-kept-for","file":"src/contracts/role-spec.ts","lines":"248-265","tests":[],"evidence":"E-R；RoleSpecInstalledEvent：安装事件","action":"keep","covered_by":"不删；角色安装链","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-078","category":"allowlist-kept-for","file":"src/contracts/role-spec.ts","lines":"266-284","tests":[],"evidence":"E-R；RoleSpecActivatedEvent：启用事件","action":"keep","covered_by":"不删；角色启用链","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-079","category":"allowlist-kept-for","file":"src/contracts/validation/role.ts","lines":"187-198","tests":[],"evidence":"E-R；validateRoleSpecInstallCommon：共用校验","action":"keep","covered_by":"不删；角色安装链","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-080","category":"allowlist-kept-for","file":"src/contracts/validation/role.ts","lines":"199-218","tests":[],"evidence":"E-R；validateInstallRoleSpecRevisionCommand：安装校验","action":"keep","covered_by":"不删；角色安装链","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-081","category":"allowlist-kept-for","file":"src/contracts/validation/role.ts","lines":"219-246","tests":[],"evidence":"E-R；validateActivateRoleSpecRevisionCommand：启用校验","action":"keep","covered_by":"不删；角色启用链","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-082","category":"allowlist-kept-for","file":"src/core/work-graph/architecture/catalog-contracts.ts","lines":"101-105","tests":[],"evidence":"E-A；ReviseArchitectureCatalogInput：目录修订入参","action":"keep","covered_by":"不删；8C修订消费者","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-083","category":"allowlist-kept-for","file":"src/core/work-graph/architecture/catalog-contracts.ts","lines":"125-128","tests":[],"evidence":"E-A；ArchitectureCatalogPort.reviseArchitectureCatalog：目录修订口","action":"keep","covered_by":"不删；8C修订消费者","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-084","category":"allowlist-kept-for","file":"src/core/work-graph/architecture/catalog-record-codecs.ts","lines":"569-571","tests":[],"evidence":"E-A；encodeArchitectureCatalogRevisedEvent：修订事件编码","action":"keep","covered_by":"不删；修订链配套","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-085","category":"allowlist-kept-for","file":"src/core/work-graph/architecture/catalog-service.ts","lines":"62","tests":[],"evidence":"E-A；REVISE_IDENTITY_PREFIX：修订幂等身份","action":"keep","covered_by":"不删；修订链配套","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-086","category":"allowlist-kept-for","file":"src/core/work-graph/architecture/catalog-service.ts","lines":"63","tests":[],"evidence":"E-A；REVISE_COMMAND_TYPE：修订命令类型","action":"keep","covered_by":"不删；修订链配套","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-087","category":"allowlist-kept-for","file":"src/core/work-graph/architecture/catalog-service.ts","lines":"64","tests":[],"evidence":"E-A；MAX_REVISE_REASON_BYTES：修订理由限额","action":"keep","covered_by":"不删；修订链配套","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-088","category":"allowlist-kept-for","file":"src/core/work-graph/architecture/catalog-service.ts","lines":"249","tests":[],"evidence":"E-A；CallerScope：修订范围守卫结果","action":"keep","covered_by":"不删；修订链配套","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-089","category":"allowlist-kept-for","file":"src/core/work-graph/architecture/catalog-service.ts","lines":"254-272","tests":[],"evidence":"E-A；readCallerScope：核对项目和工作区pin","action":"keep","covered_by":"不删；修订链配套","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-090","category":"allowlist-kept-for","file":"src/core/work-graph/architecture/catalog-service.ts","lines":"303-329","tests":[],"evidence":"E-A；restoreRevised：恢复原修订回执","action":"keep","covered_by":"不删；修订重放配套","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-091","category":"allowlist-kept-for","file":"src/core/work-graph/model/configuration-contracts.ts","lines":"16","tests":[],"evidence":"E-R；RoleConfigurationPort.installRoleSpec：角色安装公开口","action":"keep","covered_by":"不删；决定34","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-092","category":"allowlist-kept-for","file":"src/core/work-graph/model/configuration-contracts.ts","lines":"19","tests":[],"evidence":"E-R；RoleConfigurationPort.activateRoleSpec：角色启用公开口","action":"keep","covered_by":"不删；决定34","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-093","category":"allowlist-kept-for","file":"src/core/work-graph/model/configuration-contracts.ts","lines":"27-28","tests":[],"evidence":"E-R；RoleConfigurationPort.resolveRoleBinding：角色绑定解析公开口","action":"keep","covered_by":"不删；决定34","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-094","category":"allowlist-kept-for","file":"src/core/work-graph/configuration/role-memory-service.ts","lines":"77","tests":[],"evidence":"E-R；CommittedStoreReceipt：提交回执类型","action":"keep","covered_by":"不删；角色写链","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-095","category":"allowlist-kept-for","file":"src/core/work-graph/configuration/role-memory-service.ts","lines":"83","tests":[],"evidence":"E-R；ROLE_INSTALL_IDENTITY_PREFIX：安装身份前缀","action":"keep","covered_by":"不删；角色写链","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-096","category":"allowlist-kept-for","file":"src/core/work-graph/configuration/role-memory-service.ts","lines":"84","tests":[],"evidence":"E-R；ROLE_ACTIVATE_IDENTITY_PREFIX：启用身份前缀","action":"keep","covered_by":"不删；角色写链","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-097","category":"allowlist-kept-for","file":"src/core/work-graph/configuration/role-memory-service.ts","lines":"91-98","tests":[],"evidence":"E-R；actorRefEquals：原actor核对","action":"keep","covered_by":"不删；角色写链","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-098","category":"allowlist-kept-for","file":"src/core/work-graph/configuration/role-memory-service.ts","lines":"132-134","tests":[],"evidence":"E-R；roleInstallIdentityKey：安装身份键","action":"keep","covered_by":"不删；角色写链","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-099","category":"allowlist-kept-for","file":"src/core/work-graph/configuration/role-memory-service.ts","lines":"135-137","tests":[],"evidence":"E-R；roleActivateIdentityKey：启用身份键","action":"keep","covered_by":"不删；角色写链","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-100","category":"allowlist-kept-for","file":"src/core/work-graph/configuration/role-memory-service.ts","lines":"176-188","tests":[],"evidence":"E-R；mapInstallStoreFailure：安装失败映射","action":"keep","covered_by":"不删；角色写链","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-101","category":"allowlist-kept-for","file":"src/core/work-graph/configuration/role-memory-service.ts","lines":"189-201","tests":[],"evidence":"E-R；mapActivateStoreFailure：启用失败映射","action":"keep","covered_by":"不删；角色写链","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-102","category":"allowlist-kept-for","file":"src/core/work-graph/configuration/role-record-codecs.ts","lines":"421-428","tests":[],"evidence":"E-R；encodeRoleSpecRevisionSnapshot：角色版本编码","action":"keep","covered_by":"不删；角色安装链","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-103","category":"allowlist-kept-for","file":"src/core/work-graph/configuration/role-record-codecs.ts","lines":"429-436","tests":[],"evidence":"E-R；encodeProjectRoleSpecActiveSnapshot：当前角色指针编码","action":"keep","covered_by":"不删；角色启用链","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-104","category":"allowlist-kept-for","file":"src/core/work-graph/configuration/role-record-codecs.ts","lines":"437-439","tests":[],"evidence":"E-R；encodeRoleSpecInstalledEvent：安装事件编码","action":"keep","covered_by":"不删；角色安装链","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-105","category":"allowlist-kept-for","file":"src/core/work-graph/configuration/role-record-codecs.ts","lines":"440-442","tests":[],"evidence":"E-R；encodeRoleSpecActivatedEvent：启用事件编码","action":"keep","covered_by":"不删；角色启用链","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-106","category":"allowlist-kept-for","file":"src/core/workspace/role-source-reader.ts","lines":"45-131","tests":["tests/data/workspace-path-boundary.test.ts:15,65-105"],"evidence":"E-RS；WorkspaceSourceIndexReader：有界角色源码读取；既有保留决定未撤销","action":"keep","covered_by":"不删；路径权限和有界读取测试保留","est_lines":0,"spec_row":false,"confidence":"中"},
  {"id":"P1-107","category":"allowlist-wire-format","file":"src/app/core-http-types.ts","lines":"393","tests":[],"evidence":"GoalsSettingsBody；src/app/core-routes.ts:1140当前请求","action":"keep","covered_by":"不删；当前格式","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-108","category":"allowlist-wire-format","file":"src/app/core-http-types.ts","lines":"394","tests":[],"evidence":"GoalsSettingsResponse；src/app/core-routes.ts:1140当前响应","action":"keep","covered_by":"不删；当前格式","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-109","category":"allowlist-wire-format","file":"src/app/core-http-types.ts","lines":"395","tests":[],"evidence":"GoalsSettingsSetBody；src/app/core-routes.ts:1141当前请求","action":"keep","covered_by":"不删；当前格式","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-110","category":"allowlist-wire-format","file":"src/app/core-http-types.ts","lines":"396","tests":[],"evidence":"GoalsSettingsSetResponse；src/app/core-routes.ts:1141当前响应","action":"keep","covered_by":"不删；当前格式","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-111","category":"allowlist-wire-format","file":"src/app/core-http-types.ts","lines":"397","tests":[],"evidence":"GoalsReorderBody；src/app/core-routes.ts:1142当前请求","action":"keep","covered_by":"不删；当前格式","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-112","category":"allowlist-wire-format","file":"src/app/core-http-types.ts","lines":"398","tests":[],"evidence":"GoalsReorderResponse；src/app/core-routes.ts:1142当前响应","action":"keep","covered_by":"不删；当前格式","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-113","category":"allowlist-wire-format","file":"src/app/core-http-types.ts","lines":"399","tests":[],"evidence":"GoalsConflictsBody；src/app/core-routes.ts:1143当前请求","action":"keep","covered_by":"不删；当前格式","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-114","category":"allowlist-wire-format","file":"src/app/core-http-types.ts","lines":"400","tests":[],"evidence":"GoalsConflictsResponse；src/app/core-routes.ts:1143当前响应","action":"keep","covered_by":"不删；当前格式","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-115","category":"allowlist-wire-format","file":"src/app/core-http-types.ts","lines":"401","tests":[],"evidence":"PlansRequestCandidateBody；src/app/core-routes.ts:1144当前请求","action":"keep","covered_by":"不删；当前格式","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-116","category":"allowlist-wire-format","file":"src/app/core-http-types.ts","lines":"402","tests":[],"evidence":"PlansRequestCandidateResponse；src/app/core-routes.ts:1144当前响应","action":"keep","covered_by":"不删；当前格式","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-117","category":"allowlist-wire-format","file":"src/app/core-http-types.ts","lines":"403","tests":[],"evidence":"PlansAbandonBody；src/app/core-routes.ts:1145当前请求","action":"keep","covered_by":"不删；当前格式","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-118","category":"allowlist-wire-format","file":"src/app/core-http-types.ts","lines":"404","tests":[],"evidence":"PlansAbandonResponse；src/app/core-routes.ts:1145当前响应","action":"keep","covered_by":"不删；当前格式","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-119","category":"allowlist-wire-format","file":"src/app/core-http-types.ts","lines":"405","tests":[],"evidence":"DecisionsQueueBody；src/app/core-routes.ts:1146当前请求","action":"keep","covered_by":"不删；当前格式","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-120","category":"allowlist-wire-format","file":"src/app/core-http-types.ts","lines":"406","tests":[],"evidence":"DecisionsQueueResponse；src/app/core-routes.ts:1146当前响应","action":"keep","covered_by":"不删；当前格式","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-121","category":"allowlist-wire-format","file":"src/app/core-http-types.ts","lines":"407","tests":[],"evidence":"DecisionsCardBody；src/app/core-routes.ts:1147当前请求","action":"keep","covered_by":"不删；当前格式","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-122","category":"allowlist-wire-format","file":"src/app/core-http-types.ts","lines":"408","tests":[],"evidence":"DecisionsCardResponse；src/app/core-routes.ts:1147当前响应","action":"keep","covered_by":"不删；当前格式","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-123","category":"allowlist-wire-format","file":"src/app/core-http-types.ts","lines":"410","tests":[],"evidence":"DecisionsAnswerBody；src/app/core-routes.ts:1148当前请求","action":"keep","covered_by":"不删；当前格式","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-124","category":"allowlist-wire-format","file":"src/app/core-http-types.ts","lines":"411","tests":[],"evidence":"DecisionsAnswerResponse；src/app/core-routes.ts:1148当前响应","action":"keep","covered_by":"不删；当前格式","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-125","category":"allowlist-wire-format","file":"src/app/core-http-types.ts","lines":"412","tests":[],"evidence":"DecisionsApplicationBody；src/app/core-routes.ts:1149当前请求","action":"keep","covered_by":"不删；当前格式","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-126","category":"allowlist-wire-format","file":"src/app/core-http-types.ts","lines":"413","tests":[],"evidence":"DecisionsApplicationResponse；src/app/core-routes.ts:1149当前响应","action":"keep","covered_by":"不删；当前格式","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-127","category":"allowlist-wire-format","file":"src/app/core-http-types.ts","lines":"414","tests":[],"evidence":"DecisionsNoticesSeenBody；src/app/core-routes.ts:1150当前请求","action":"keep","covered_by":"不删；当前格式","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-128","category":"allowlist-wire-format","file":"src/app/core-http-types.ts","lines":"415","tests":[],"evidence":"DecisionsNoticesSeenResponse；src/app/core-routes.ts:1150当前响应","action":"keep","covered_by":"不删；当前格式","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-129","category":"allowlist-wire-format","file":"src/app/core-http-types.ts","lines":"416","tests":[],"evidence":"MessagesUserSendBody；src/app/core-routes.ts:1151当前请求","action":"keep","covered_by":"不删；当前格式","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-130","category":"allowlist-wire-format","file":"src/app/core-http-types.ts","lines":"417","tests":[],"evidence":"MessagesUserSendResponse；src/app/core-routes.ts:1151当前响应","action":"keep","covered_by":"不删；当前格式","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-131","category":"allowlist-wire-format","file":"src/core/work-graph/persistence/decision-record-codecs.ts","lines":"53","tests":[],"evidence":"E-EVT；GOAL_SETTINGS_CHANGED_SCHEMA_ID对应当前写读事件；常量名本身未引用","action":"keep","covered_by":"不删；当前事件格式","est_lines":0,"spec_row":false,"confidence":"中"},
  {"id":"P1-132","category":"allowlist-wire-format","file":"src/core/work-graph/persistence/decision-record-codecs.ts","lines":"54","tests":[],"evidence":"E-EVT；WORKSPACE_NOTICE_SEEN_CHANGED_SCHEMA_ID对应当前写读事件；常量名本身未引用","action":"keep","covered_by":"不删；当前事件格式","est_lines":0,"spec_row":false,"confidence":"中"},
  {"id":"P1-133","category":"allowlist-wire-format","file":"src/core/work-graph/sessions/message-body-envelope.ts","lines":"34-42","tests":[],"evidence":"E-MSG；UserDecisionBodyEnvelopeV1是当前决定答复正文信封","action":"keep","covered_by":"不删；当前信封写读链","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-134","category":"allowlist-wire-format","file":"src/app/core-http-types.ts","lines":"426","tests":[],"evidence":"ActivityCalendarBody；src/app/core-routes.ts:1153当前请求","action":"keep","covered_by":"不删；当前格式","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-135","category":"allowlist-wire-format","file":"src/app/core-http-types.ts","lines":"427","tests":[],"evidence":"ActivityCalendarResponse；src/app/core-routes.ts:1153当前响应","action":"keep","covered_by":"不删；当前格式","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-136","category":"allowlist-wire-format","file":"src/app/core-http-types.ts","lines":"428","tests":[],"evidence":"ActivityRunsBody；src/app/core-routes.ts:1154当前请求","action":"keep","covered_by":"不删；当前格式","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-137","category":"allowlist-wire-format","file":"src/app/core-http-types.ts","lines":"429","tests":[],"evidence":"ActivityRunsResponse；src/app/core-routes.ts:1154当前响应","action":"keep","covered_by":"不删；当前格式","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-138","category":"allowlist-wire-format","file":"src/app/core-http-types.ts","lines":"430","tests":[],"evidence":"ActivityTrackBody；src/app/core-routes.ts:1155当前请求","action":"keep","covered_by":"不删；当前格式","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-139","category":"allowlist-wire-format","file":"src/app/core-http-types.ts","lines":"431","tests":[],"evidence":"ActivityTrackResponse；src/app/core-routes.ts:1155当前响应","action":"keep","covered_by":"不删；当前格式","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-140","category":"allowlist-wire-format","file":"src/app/core-http-types.ts","lines":"432","tests":[],"evidence":"TasksTimelineBody；src/app/core-routes.ts:1156当前请求","action":"keep","covered_by":"不删；当前格式","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-141","category":"allowlist-wire-format","file":"src/app/core-http-types.ts","lines":"433","tests":[],"evidence":"TasksTimelineResponse；src/app/core-routes.ts:1156当前响应","action":"keep","covered_by":"不删；当前格式","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-142","category":"allowlist-wire-format","file":"src/app/core-http-types.ts","lines":"434","tests":[],"evidence":"ActivityBackfillBody；src/app/core-routes.ts:1157当前请求","action":"keep","covered_by":"不删；当前格式","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-143","category":"allowlist-wire-format","file":"src/app/core-http-types.ts","lines":"435","tests":[],"evidence":"ActivityBackfillResponse；src/app/core-routes.ts:1157当前响应","action":"keep","covered_by":"不删；当前格式","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-144","category":"allowlist-kept-for","file":"src/core/work-graph/model/note-contracts.ts","lines":"44","tests":[],"evidence":"E-NOTE；NOTE_BODY_PAGE_MAX_BYTES仍在冻结规格；4C消费者说明失实","action":"keep","covered_by":"暂留规格常量；lead需更正保留依据，不声称已接线","est_lines":0,"spec_row":false,"confidence":"中"},
  {"id":"P1-145","category":"allowlist-wire-format","file":"src/app/core-http-types.ts","lines":"485","tests":[],"evidence":"NotesListBody；src/app/core-routes.ts:1167当前请求","action":"keep","covered_by":"不删；当前格式","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-146","category":"allowlist-wire-format","file":"src/app/core-http-types.ts","lines":"486","tests":[],"evidence":"NotesListResponse；src/app/core-routes.ts:1167当前响应","action":"keep","covered_by":"不删；当前格式","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-147","category":"allowlist-wire-format","file":"src/app/core-http-types.ts","lines":"487","tests":[],"evidence":"NotesWriteBody；src/app/core-routes.ts:1168当前请求","action":"keep","covered_by":"不删；当前格式","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-148","category":"allowlist-wire-format","file":"src/app/core-http-types.ts","lines":"488","tests":[],"evidence":"NotesWriteResponse；src/app/core-routes.ts:1168当前响应","action":"keep","covered_by":"不删；当前格式","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-149","category":"allowlist-wire-format","file":"src/app/core-http-types.ts","lines":"489","tests":[],"evidence":"NotesWithdrawBody；src/app/core-routes.ts:1169当前请求","action":"keep","covered_by":"不删；当前格式","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-150","category":"allowlist-wire-format","file":"src/app/core-http-types.ts","lines":"490","tests":[],"evidence":"NotesWithdrawResponse；src/app/core-routes.ts:1169当前响应","action":"keep","covered_by":"不删；当前格式","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-151","category":"allowlist-wire-format","file":"src/app/core-http-types.ts","lines":"491","tests":[],"evidence":"NotesReviewBody；src/app/core-routes.ts:1170当前请求","action":"keep","covered_by":"不删；当前格式","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-152","category":"allowlist-wire-format","file":"src/app/core-http-types.ts","lines":"492","tests":[],"evidence":"NotesReviewResponse；src/app/core-routes.ts:1170当前响应","action":"keep","covered_by":"不删；当前格式","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-153","category":"allowlist-wire-format","file":"src/app/core-http-types.ts","lines":"493","tests":[],"evidence":"PlansVersionsBody；src/app/core-routes.ts:1171当前请求","action":"keep","covered_by":"不删；当前格式","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-154","category":"allowlist-wire-format","file":"src/app/core-http-types.ts","lines":"494","tests":[],"evidence":"PlansVersionsResponse；src/app/core-routes.ts:1171当前响应","action":"keep","covered_by":"不删；当前格式","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-155","category":"allowlist-wire-format","file":"src/app/core-http-types.ts","lines":"495","tests":[],"evidence":"ArchitectureVersionsBody；src/app/core-routes.ts:1172当前请求","action":"keep","covered_by":"不删；当前格式","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-156","category":"allowlist-wire-format","file":"src/app/core-http-types.ts","lines":"496","tests":[],"evidence":"ArchitectureVersionsResponse；src/app/core-routes.ts:1172当前响应","action":"keep","covered_by":"不删；当前格式","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-157","category":"allowlist-kept-for","file":"src/contracts/architecture-inspection.ts","lines":"85-96","tests":[],"evidence":"E-F；FileGraphPageV1是架构页响应，不是旧持久块格式","action":"keep","covered_by":"不删；第8片明确消费者","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-158","category":"allowlist-kept-for","file":"src/core/work-graph/architecture/architecture-record-codecs.ts","lines":"41","tests":[],"evidence":"E-V2；FILE_GRAPH_CHUNK_SCHEMA_ID为旧ObservedFileGraphChunk@1；当前只写读v2；无测试导入","action":"delete","covered_by":"旧块格式已退出当前写读；docs/refactor/HANDOFF.md:565-570","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-159","category":"allowlist-kept-for","file":"src/core/work-graph/architecture/architecture-service.ts","lines":"241-244","tests":[],"evidence":"E-F；readFileGraphCursor：文件图读口游标校验","action":"keep","covered_by":"不删；架构页读链","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-160","category":"allowlist-kept-for","file":"src/core/work-graph/architecture/contracts.ts","lines":"158-160","tests":[],"evidence":"E-F；ObservedArchitecturePort.listFiles：规格点名架构页","action":"keep","covered_by":"不删；第8片明确消费者","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-161","category":"allowlist-kept-for","file":"src/core/work-graph/architecture/contracts.ts","lines":"161-163","tests":[],"evidence":"E-F；ObservedArchitecturePort.neighbors：文件邻接读取","action":"keep","covered_by":"不删；第8片明确消费者","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-162","category":"allowlist-kept-for","file":"src/core/work-graph/architecture/contracts.ts","lines":"164-166","tests":[],"evidence":"E-F；ObservedArchitecturePort.impact：文件影响读取","action":"keep","covered_by":"不删；第8片明确消费者","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-163","category":"allowlist-kept-for","file":"src/core/work-graph/architecture/file-graph-index.ts","lines":"21-26","tests":[],"evidence":"E-F；FileGraphPageData：分页数据","action":"keep","covered_by":"不删；文件图读链","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-164","category":"allowlist-kept-for","file":"src/core/work-graph/architecture/file-graph-index.ts","lines":"29-32","tests":[],"evidence":"E-F；FileGraphData：图输入数据","action":"keep","covered_by":"不删；文件图读链","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-165","category":"allowlist-kept-for","file":"src/core/work-graph/architecture/file-graph-index.ts","lines":"34","tests":[],"evidence":"E-F；FILE_GRAPH_PAGE_SIZE：一页200","action":"keep","covered_by":"不删；文件图读链","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-166","category":"allowlist-kept-for","file":"src/core/work-graph/architecture/file-graph-index.ts","lines":"35","tests":[],"evidence":"E-F；FILE_GRAPH_MAX_IMPACT_DEPTH：深度最多3","action":"keep","covered_by":"不删；文件图读链","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-167","category":"allowlist-kept-for","file":"src/core/work-graph/architecture/file-graph-index.ts","lines":"37-42","tests":[],"evidence":"E-F；FileGraphCursorError：真实游标边界错误","action":"keep","covered_by":"不删；文件图读链","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-168","category":"allowlist-kept-for","file":"src/core/work-graph/architecture/file-graph-index.ts","lines":"44-46","tests":[],"evidence":"E-F；captureKeyOf：绑定捕获身份","action":"keep","covered_by":"不删；文件图读链","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-169","category":"allowlist-kept-for","file":"src/core/work-graph/architecture/file-graph-index.ts","lines":"47-49","tests":[],"evidence":"E-F；queryKeyOf：绑定查询身份","action":"keep","covered_by":"不删；文件图读链","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-170","category":"allowlist-kept-for","file":"src/core/work-graph/architecture/file-graph-index.ts","lines":"50-63","tests":[],"evidence":"E-F；readOffset：核对分页位置","action":"keep","covered_by":"不删；文件图读链","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-171","category":"allowlist-kept-for","file":"src/core/work-graph/architecture/file-graph-index.ts","lines":"66-70","tests":[],"evidence":"E-F；orderedNodes：稳定节点顺序","action":"keep","covered_by":"不删；文件图读链","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-172","category":"allowlist-kept-for","file":"src/core/work-graph/architecture/file-graph-index.ts","lines":"72-82","tests":[],"evidence":"E-F；orderedEdges：稳定边顺序","action":"keep","covered_by":"不删；文件图读链","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-173","category":"allowlist-kept-for","file":"src/core/work-graph/architecture/file-graph-index.ts","lines":"83-93","tests":[],"evidence":"E-F；buildPage：构造分页结果","action":"keep","covered_by":"不删；文件图读链","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-174","category":"allowlist-kept-for","file":"src/core/work-graph/architecture/file-graph-index.ts","lines":"96-100","tests":[],"evidence":"E-F；listFilesPage：文件列表分页","action":"keep","covered_by":"不删；架构页读链","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-175","category":"allowlist-kept-for","file":"src/core/work-graph/architecture/file-graph-index.ts","lines":"103-117","tests":[],"evidence":"E-F；neighborsPage：邻接分页","action":"keep","covered_by":"不删；架构页读链","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-176","category":"allowlist-kept-for","file":"src/core/work-graph/architecture/file-graph-index.ts","lines":"120-147","tests":[],"evidence":"E-F；impactPage：影响分页","action":"keep","covered_by":"不删；架构页读链","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-177","category":"allowlist-kept-for","file":"src/core/work-graph/model/tool-commit-arguments.ts","lines":"181-183","tests":["tests/work-graph/K3-39-tool-commit-lookup.test.ts:20,72"],"evidence":"E-K39；toolCommitLookupNotPublished与src/composition/tool-commit-lookup.ts:48重复","action":"change:生产分派调用此助手并移除白名单","covered_by":"K3-39保留；现行分派结果不变","est_lines":0,"spec_row":true,"confidence":"高"},
  {"id":"P1-178","category":"allowlist-kept-for","file":"src/core/work-graph/state/command-normalization.ts","lines":"12-14","tests":["tests/state/command-normalization.test.ts:15,52,62,116"],"evidence":"E-PARSE；ShellActionsResult是冻结公开投影类型","action":"keep","covered_by":"不删；slice-K3-SPEC.md:1841明确保留","est_lines":0,"spec_row":true,"confidence":"高"},
  {"id":"P1-179","category":"allowlist-kept-for","file":"src/core/work-graph/state/command-normalization.ts","lines":"524-529","tests":["tests/state/command-normalization.test.ts:15,52,62,116,222,269,282,331,401,436"],"evidence":"E-PARSE；parseShellActions公开words/text投影被冻结规格保留","action":"keep","covered_by":"不删；B2-10规则测试","est_lines":0,"spec_row":true,"confidence":"高"},
  {"id":"P1-180","category":"allowlist-kept-for","file":"src/core/work-graph/state/unknown-call-kinds.ts","lines":"44-46","tests":["tests/runtime/K3-34-tool-name-constants.test.ts:22,50-52,61","tests/state/unknown-call-kinds.test.ts:14,68-72"],"evidence":"E-NAME；kernelToolNameOf与src/core/agent-runtime/observed-model-run.ts:303重复","action":"change:实际工具名装配调用此函数并移除白名单","covered_by":"K3-34及规则表测试保留","est_lines":0,"spec_row":true,"confidence":"高"},
  {"id":"P1-181","category":"allowlist-kept-for","file":"src/core/work-graph/state/unknown-call-review.ts","lines":"35-39","tests":[],"evidence":"E-BUDGET；UNKNOWN_CALL_REVIEW_RESERVED_BYTES应参与预算表达式；规格另留32字节","action":"change:创建预算写成MAX减RESERVED减32并移除白名单","covered_by":"创建预算仍158720；冻结预算规则不变","est_lines":0,"spec_row":true,"confidence":"高"},
  {"id":"P1-182","category":"allowlist-kept-for","file":"src/core/work-graph/state/unknown-call-review.ts","lines":"129","tests":["tests/state/unknown-call-review.test.ts:30,157","tests/work-graph/K3-45-review-incomplete.test.ts:20,114"],"evidence":"E-ALIAS；UnknownCallReviewEvent只是UnknownCallReviewEventV1的同义别名；两个测试四处引用","action":"delete","covered_by":"测试改用UnknownCallReviewEventV1；状态机和K3-45行为全部保留","est_lines":4,"spec_row":true,"confidence":"高"},
  {"id":"P1-183","category":"c1-transfer","file":["src/contracts/architecture-inspection.ts","src/contracts/architecture-source.ts","src/contracts/artifact.ts","src/contracts/command-event.ts","src/contracts/context-continuity.ts","src/contracts/control-intent.ts","src/contracts/coordination.ts","src/contracts/core/call-context.ts","src/contracts/core/identity.ts","src/contracts/core/results.ts","src/contracts/core/source.ts","src/contracts/dispatch.ts","src/contracts/evidence.ts","src/contracts/fingerprint.ts","src/contracts/goal-change.ts","src/contracts/goal-phase.ts","src/contracts/governance.ts","src/contracts/human-role-collaboration.ts","src/contracts/initial-planning.ts","src/contracts/ledger.ts","src/contracts/material-access.ts","src/contracts/opaque.ts","src/contracts/plan.ts","src/contracts/query-job.ts","src/contracts/reduction.ts","src/contracts/reviewer-work.ts","src/contracts/role-spec.ts","src/contracts/task-envelope.ts","src/contracts/validation/common.ts","src/contracts/validation/goal.ts","src/contracts/validation/identity.ts"],"lines":"所有文件均为1","tests":[],"evidence":"E-C1A；31处精确相同N0迁移来源注释；.lead-ref/t-area-P1.txt:9-10","action":"delete","covered_by":"注释无行为；不删除声明或文件；生产文本31行","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-184","category":"c1-transfer","file":"src/core/work-graph/views/track-read-model.ts","lines":"195,200-202,224-226,908,920,976,988","tests":["tests/work-graph/S2B-30-track-bars.test.ts:137-143,365-380","tests/work-graph/S2B-r2-r3-track-pagination.test.ts:54-76::2B-r2 R3 a Run added before the boundary does not duplicate or skip","tests/app/S2B-35-activity-routes.test.ts:232","tests/work-graph/S2B-r3-consultation-cap.test.ts:51"],"evidence":"E-C1B；当前QueryCursor必带ca；只有解码器接受旧缺字段形状","action":"change:ca必须为string或null，删除缺字段兼容","covered_by":"当前编码器及分页测试保留；旧格式按HANDOFF:565-570退出","est_lines":0,"spec_row":true,"confidence":"高"},
  {"id":"P1-185","category":"c1-transfer","file":"src/core/work-graph/model/claim-contracts.ts","lines":"24,95-107","tests":["tests/runtime/R4c-graph-history.test.ts:32","tests/runtime/S3-context-assembler.test.ts:49","tests/state/attempt-machine.test.ts:37,705-710","tests/state/invariants.test.ts:48","tests/state/invariants.ts:92","tests/work-graph/R4c-execution-history-index.test.ts:29","tests/architecture/state-writes.test.ts:100-102"],"evidence":"E-C1C；TaskClaimOutbox重复src/core/work-graph/state/attempt-machine.ts:64-71的DispatchOutboxRecord","action":"change:TaskClaimOutbox改为DispatchOutboxRecord别名","covered_by":"state中的单一声明；现有名字及状态写入检查保留","est_lines":0,"spec_row":false,"confidence":"高"},
  {"id":"P1-186","category":"c1-transfer","file":["src/core/work-graph/model/claim-contracts.ts","src/core/work-graph/persistence/execution-entry-codecs.ts","tests/state/attempt-machine.test.ts"],"lines":["92-94及相关导入","9,39,45","37,708-709,711-712"],"tests":["tests/state/attempt-machine.test.ts:705::DispatchOutboxRecord is the TaskClaimOutbox record of claim-contracts.ts"],"evidence":"E-C1C；TaskDispatchStateV1同义别名；除测试外还有execution-entry-codecs中转导出","action":"delete","covered_by":"当前DispatchStateV1；只删V1别名恒等断言，保留outbox断言和状态行为","est_lines":5,"spec_row":false,"confidence":"高"},
  {"id":"P1-187","category":"c1-transfer","file":"tests/kernel/RL-12-15-conditions.test.ts","lines":"360,403","tests":["RL-15b (a) a hanging systemd-run --version stops at the 10 s deadline and reports probe_failed","RL-15b (b) a bwrap whose --version hangs ends as probe_failed, not sandbox_unavailable"],"evidence":"E-C1D；两处无容差下界；任务书记一次9999.91ms；10ms为建议容差","action":"change:两处下界改9990ms，上界仍12000ms","covered_by":"原probe_failed、缓存、子进程回收及RL-15b规格行全部保留","est_lines":2,"spec_row":true,"confidence":"高"},
  {"id":"P1-188","category":"n0","file":["src/business/workflow/contracts.ts","src/business/workflow/index.ts","src/business/workflow/ports.ts","src/business/workflow/workflow.ts","tests/composition/platform.test.ts"],"lines":["1,3,18,60-68","4","42,221-226","40,810,813,815-819","79-83"],"tests":["tests/composition/platform.test.ts:50::%s: public composition wires Host material and real workspace reads with narrow unsupported gaps"],"evidence":"E-N0；HANDOFF:683决定85-4；删除N0GoalInput、专用导入转出和未实现旧形状，保留当前kind边界校验","action":"delete","covered_by":"旧N0行为从未实现；tests/business/R5b-initial-planning-workflow.test.ts:247,292,311现行初始规划流程保留；tests/app/R6-host.test.ts:711,807,834保留；不删handleGoalInput","est_lines":5,"spec_row":false,"confidence":"高"}
]
```

**分类总数**

| 类别 | 条数 | 建议分布 | 估计测试删改行数 |
|---|---:|---|---:|
| allowlist-pre-batch | 62 | user-decides 62；逐条建议保留 | 0 |
| allowlist-kept-for | 71 | keep 66；change 3；delete 2 | 4 |
| allowlist-wire-format | 49 | keep 49 | 0 |
| c1-transfer | 5 | change 3；delete 2 | 7 |
| n0 | 1 | delete 1 | 5 |
| old-data | 0 | 旧游标项归 C1，避免重复计数 | 0 |
| legacy | 0 | 不另重复登记 | 0 |
| **合计** | **188** | **keep 115；user-decides 62；change 6；delete 5** | **16** |

白名单建议的直接结果是：删除 2 个条目对应声明、给 3 个条目接上已有生产消费者或表达式，故可移除 **5 个白名单条目**；其余 **177 个**不在本报告中批准删除。其中 62 个仍等待用户决定。上述数字不包含 P1-183 的 31 行生产注释，也不把 N0 生产代码和重复类型的缩减冒算成测试缩减。

**覆盖说明与未裁定项**

白名单 **182/182** 已核对，涉及的 **25 个生产文件全部进入盘点**；C1 四类转交事项完整覆盖，其中重复类型拆成两个可独立处理的发现；N0 的声明、专用导入、转出、参数 union、未实现分支、旧形状测试均已追踪。

完整阅读的主要文件：

- `.lead-ref/t-common.md`、`.lead-ref/t-area-P1.txt`、`AGENTS.md`、`README.md`、编排设计目录 `README.md`；
- `tests/architecture/production-reach-allowlist.json`、`tests/architecture/production-reach.ts`；
- `src/contracts/human-role-collaboration.ts`、`role-material-channels.ts`、`role-spec.ts`、`validation/role.ts`、`architecture-inspection.ts`；
- `src/core/workspace/role-source-reader.ts`；
- `src/core/work-graph/model/configuration-contracts.ts`；
- `src/core/work-graph/architecture/catalog-contracts.ts`、`contracts.ts`、`file-graph-index.ts`；
- `src/core/work-graph/sessions/message-body-envelope.ts`、`state/unknown-call-kinds.ts`；
- `src/composition/tool-commit-lookup.ts`；
- `tests/data/workspace-path-boundary.test.ts`、`tests/composition/platform.test.ts`。

其余长文件按声明、调用方、编码/解码、测试导入和相关规格段落定向阅读，没有把“检索命中”记成全文阅读。包括：

- `src/app/core-http-types.ts`、`main.ts`、`core-routes.ts`；
- 角色服务与 codec、目录服务与 codec、决定 codec、注记契约和正文读取；
- 观测架构服务与 codec、工具提交助手、命令解析、未知调用复查；
- 轨道读模型、claim 契约、attempt 状态机、execution-entry codec；
- Workflow 契约、ports、index、实现和组合根；
- 本报告引用的 K3、S2B、R4c、R5b、R6、RL-15b 测试，以及架构检查相关部分；
- `STATUS.md`、`HANDOFF.md` 顶部与决定 6/34/79/85，**决定 79 全段已读**；第 3、4、6、7、8、K3 片相关规格，E3 待办、MVP 行为、能力索引及结构审查相关段落；
- P1-183 中其他文件仅核对精确注释位置，不代表审查这些文件全部业务。

全树引用搜索覆盖 `src/`、`tests/`，后续消费者检索覆盖相关规格与 E3 文档。环境没有可用的 `rg`，使用只读文本扫描代替，未执行仓库程序。

仍需 lead 裁定的具体点：

1. **P1-063**：尚不能把 `CoordinationPolicyPin` 绑定到明确的新消费者。泛指角色规格的保留理由不足以证明它一定会被用，但也没有找到已取消它的决定；因此是低置信度暂留。
2. **P1-064～068、106**：能力索引明确保留角色源码 reader，然而第 3 片已合入，第 6、7、8 片未给该旧接口新的直接接线点。应更新保留依据，不能原样继续写“等第 3 片”。
3. **P1-070**：构造角色版本引用的助手仍无调用；暂按角色规格保留，真正接线时应再判断是否需要这个独立助手。
4. **P1-144**：冻结规格仍列 4 KiB 常量，但实际读取固定 2 KiB，原 note 指定的 4C 消费者未出现。是否继续保留一个未接线的规格常量，应由 lead 明确；本报告没有擅自补一个新的可调页大小功能。
5. **P1-178、179**：当前冻结规格明确保留公开简版解析口；应把白名单理由改成准确的规格依据，不能以“只被测试用”为由直接删掉 B2-10 规则保障。
6. **P1-131、132**：确认的是事件格式当前仍写读，未确认两个具名常量本身有消费者。若 lead 要进一步削减无引用符号，可单独讨论删除常量名字；这不应被表述为删除旧事件格式。