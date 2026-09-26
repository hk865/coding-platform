# R6 执行入口：实现已冻结的 Host/UI 消费链

2026-09-27。六生产实现与UI展示收尾已独审并由root[精确导入](../reviews/evidence/next-b2-2026-09-26/r6-execution-entry-implementation-import.json)，SHA256 `edf0ce1745721168c1474c1d19fe22c3c4accea7cbe8464bee34c29bc7f7b6e3`。固定22/22、Node/UI types、物理build与scope通过；[最终真实CUA](../reviews/evidence/next-b2-2026-09-26/r6-execution-entry-browser-final.json) SHA256 `84dc17aebe9bcae7beb28704a85869bb76eba7612408931c04d80d7bcb42f3a2` 已一键Query→Answer→初始Plan采用→两个Work→checks/独立Goal gate→正式Goal COMPLETED，完整回答默认收起可展开，任务图直接显示原TaskGraph.completion。模型使用受控4回复，实际Host/Kernel/SQLite与检查执行真实；不宣称外部模型网络、全MVP/UI或全生命周期完成。原两测试保持冻结；下文实施/展示待验记录保留其当时前态，当前下一批Task→Run/Session/历史骨架正在施工。

依 [原骨架任务](R6-execution-entry-skeleton.md) §1–5 已确认的完整契约施工；这里仅说明第二阶段落位，不复制协议。机器范围见 [六文件 scope](R6-execution-entry-implementation-scope.json)。原 tests、core-http-types、project-bootstrap-contracts、core-routes、composition、Kernel 与所有其它业务实现只读。完成后 STOP，不自动接后续模块。

执行本批第二阶段并在交付后 STOP。W=`/home/hyh001/projects/coding-platform`，T=`W/coding-platform/next`；先读 `docs/AGENTS.md`、当前 HANDOFF、IMPLEMENTED-CAPABILITIES 相关 R6/Query/Initial Plan/Workflow、DSH-WORKFLOW、DSH-EXECUTION-HARNESS，再读本任务与原骨架契约。仅六路径可写，其余源/测试/契约/路由/组合根/Kernel 只读，不安装依赖、不读取真实凭据、不提交 Git。DSH bash 默认只读；写批准现有文件时使用正常 `sandbox_permissions: workspace-write` 与具体理由，并用 Python/Node 原地写入，不通过 edit/write 的同目录临时 rename；不请求 danger-full-access，不修改 profile/approval 或外层挂载。固定检查需分别运行。

## 实现与复用

- `app/runtime-configuration.ts`：将原 resolver 的明确 unsupported 替换为已有 ProviderRegistry 与 SecretSource 的一次选定绑定。当前配置只读、完整 scope/Role 精确选择，首次使用才读该一个变量；复用原 BoundModel/ResolvedRuntimeConfiguration，不重做 provider、模型循环、预算、Role/Grant 准入。现 Work/Query 分支共用同一适配函数与 client，缺配置报告原缺口，错误不回显 secret/options/provider payload。
- `app/main.ts`：完成原纯 JSON 配置的路径解析，将明确资源路径相对配置目录解析后送同 Host；不读取凭据、不启动模型、不设置新的隐含预算。现 CLI 无 runtime 配置继续可用。
- `app/host.ts`：保持一个 platform、一组 Kernel stores、原 sourcePolicyFor 与 Host 许可版本。绑定完成的 Runtime/checks/workflow，程序化受控 registry 接缝和真实 JSON 数据走同适配；不绕过 checks 的真实 permissionRevision。bootstrap 只保留已冻结安全投影。
- `work-graph/configuration/project-bootstrap-service.ts`：在原 owner 实现只读 registration，一次精确读取原 Project/Workspace 记录，复用现 codec/ref/context/Store 结果；返回实际 revision，不增 writer、schema、CAS、全图或全库扫描。
- `ui/main.ts`：用户调查或规划动作依次消费 registration、原 Session/Query 方法与正式 answer/body；按现 Goal/完整 scope/flow 捕获结果，只在 ready 且有原 next 时继续对应 Workflow 路由。请求先保存再发送，网络结果不确定/unknown/waiting/rejected 停止并保留原请求，重试不刷新身份、预算或 expected。原 next 原样传递，UI 不另造 Workflow 状态机、计时轮询、后台执行或强制逐步批准。
- `ui/views.ts`：将已冻结 continuation 接缝实现为现结果的窄选择；显示原回答、来源、实际阶段与正式完成。页面默认只保留配置名称、问题输入、调查/规划并执行/继续执行等产品控件；consumerId、完整 Role、预算、scope/ref/原请求放交互后的现 details。保持三栏固定高度、页签/草稿/原始历史交互，不另起布局重构。

## 固定行为

`Query → real Kernel readonly tool → official Answer → initial candidate → adopt → original Workflow/checks → formal Goal completion` 沿同 SQLite、同组合入口运行。现无 Plan/Policy/baseline 的调查准入由原 owner 决定；后续采用缺治理则保持真实 waiting，不能创建空治理或假成功。Query 模型正常入口只在用户已选择的显式配置下启动。原 tests 的受控 provider 是测试输入，不能成为产品缺配置时的回退。

不扩 Query 多轮、冷恢复、运行中 Role 更换、Reviewer、物理 pause/resume UI 或已结束 WorkLink 查询。后续范围仍在总计划，本批不借接线重写它们。源码增长统计不是删减必要功能的理由，但必须避免重复 DTO、解析器和正式状态。

## 验证与交付

沿已冻结 `next-r6-host`（两既有文件及新增两正常组）、`next-types`、`next-ui-types`、`next-build`；真实路由/边界保持原命名与所有权，必要 architecture 检查使用现入口。出现真实接口/夹具问题，给出具体公开返回与不兼容位置，禁止为局部绿灯弱化生产规则或自己修改 tests。

STOP 后提交六路径差异/哈希、固定检查结果、actual chain、原请求与 owner 复用说明。主审做一次独立相关验证和浏览器实际操作，再精确导入；不为本批另增测试框架或重复全平台矩阵。

## STOP 中审：一次 UI 正常消费者纠正（2026-09-26）

首轮实现 STOP 后独立 22/22 与 next-types 通过，scope 恰原六路径且无主工作区漂移；主审已读四非 UI 实现，保持冻结。本轮仅 `ui/main.ts` / `ui/views.ts` 必要纠正，测试/接口/其它四生产只读：

1. Query claim expected 使用实际 SessionRecord 的完整 aggregate ref/revision（保留 `aggregateType`），Job/Run pins 取原 submit 回执，不裁剪成 UI SessionRef 或以常量代替回执。
2. 已选 Session 忙碌明确等待；选中但详情未就绪/角色不相容也明确报告，不暗中创建新会话绕开选择。首 await 前捕获本动作的 scope/Goal/问题/Session；导航或选择变化不替换该动作身份。确实未选择时才沿原 createSession。
3. Query advisor Session 不作为 builder Work sessionHint；规划后的 Work handoff 使用原 null 选择交原 Workflow，不能换角色。已存在 Plan 的继续动作不依赖 Query profile 或新 Query Session；明确选中的工作 Session 仍由原 owner 处理兼容性。
4. 每次发送前保存精确 route/body，网络/unknown 停后提供实际可用的原请求重试入口；不只显示 run.sent。重试不得新建 flow/job/run/Session、requestId、预算或 expected；复用原 transport/请求详情机制，不造第二队列/状态 owner。
5. 保留当前 Goal/flow 的原采用输入和原 next；治理补齐后的继续消费该原 continuation，不用新 select_work 取代未采用候选。已有 Query 不能禁用继续入口。若有限步数或“停止继续发送”停下，保留尚未发送的原 next，停止只影响后续 HTTP，不冒充 Runtime cancel。结果/回执更新归属发起 scope。

6. 网络结果未确认且原 `run.pending` 仍在时，调查／规划／继续三个新动作在 handler 与按钮中均停止，避免覆盖原未知请求；原重试保持可用。只更正 runtime 配置文件顶部旧骨架注释，不改变非 UI 算法。

固定原 22 + Node/UI types/build；不新增 case 或矩阵。最终由外层主审保留 lane 来源的完整 next 物理构建副本，供真实 Host 浏览器验收，再待主审决定导入。

## 最终独立候选（2026-09-27）

[最终六文件证据](../reviews/evidence/next-b2-2026-09-26/r6-execution-entry-implementation-final-review.json) 保留逐文件基线／最终 SHA、增减行数、原冻结测试及接口 SHA、原 22 项和类型／构建日志。原六文件合计 +883/-84，净增 799；其中页面消费者净增 655，局部请求重试缓冲按主审约定保留，本批未扩重构。实际构建复用 `next-build` 同物理复制与原 build 命令，保留 `/tmp/r6-execution-review-ffmsdj6h/next` 供主审直接启动 Host；本 reviewer 不导入。

## 真实浏览器显示收尾（2026-09-27）

主审实际点击规划并执行已到正式完成，随后读取 TaskGraph 确认两 work 与 gate satisfied、future pending plan_only 保留。唯一当批显示修正：原 `renderQueryAnswer` 将完整计划回答与正文默认重复铺在左栏；沿同 DSH session 只改 `ui/views.ts`，默认折叠完整回答／正文／来源／记录，外露简短正式回答状态与来源数／过期状态。其它五生产与全部冻结测试／接口不变，不解析计划 JSON、不新增摘要模型。修后仅原 22、UI types 与保留物理 build；主审负责实际页面复验，本记录不冒充已完成复验。

同一显示收尾补充：主审确认原 TaskGraph.completion 已携带正式 GoalPhaseSnapshot 与 selectedPlanMatches，故在现 `renderTaskGraph` 直接显示其正式 phase 及当前 Plan 关系；规划字段仅标“规划诊断”，Goal desiredState 标“目标意图”。仍只改 views，未新增领域 owner／路由／DTO。

显示最终候选已 STOP，独立原 22/22、UI types、完整物理 build 与 audit 通过。最终 [显示收尾证据](../reviews/evidence/next-b2-2026-09-26/r6-execution-entry-implementation-display-review.json) 补录更新后的六文件 hash；其它五生产／冻结接口／测试不变。新保留构建 `/tmp/r6-execution-review-knqxsl2h/next` 交主审 CUA；上一真实 E2E 证据保持独立，本 reviewer 未导入。
