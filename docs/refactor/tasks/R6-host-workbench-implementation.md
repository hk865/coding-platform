# R6.1a：接通本地工作台正常路径

2026-09-26，四文件中审返修已确认并冻结导入 main；目标 2 个正常路径首红、13 项通过，Node/UI types 通过。现在授权六生产文件实现。设计真源为 [R6 原任务](R6-host-workbench-skeleton.md)，已确认纠正见 [中审返修](R6-host-workbench-middle-repair.md)。本批直接完成 R6.1a 正常端到端路径，不再追加骨架审阅矩阵；不代表 R6.1b、Query/Workflow 或完整 R6 已交付。

## 唯一写范围

[implementation scope](R6-host-workbench-implementation-scope.json) 仅六个现有生产文件（相对 `coding-platform/next/`）：`src/app/host.ts`、`src/app/core-routes.ts`、`src/ui/main.ts`、`src/ui/views.ts`、`src/ui/index.html`、`src/ui/styles.css`。

现有 `core-http-types.ts` 已提供全部 17 条路由的 Body/Response 类型、GraphWriteBody/PlainBody 及图/文件 DTO，可用 indexed access 派生所需纯类型，本轮无需新增 alias 或扩协议。server/token/CLI/HTTP DTO、Node/UI 构建与检查脚本、全部测试、composition/core/contracts/Kernel 均冻结只读；不安装依赖、不新建产品文件或第二业务状态库。

## 直接施工

1. **Host 真实接线。** 在 `core-routes.ts` 建立绑定同一 platform 的明确 named bindings，`host.ts` 替换 unsupported bindings；逐路由复用原 switch。严格沿原 17 方法 owner，尤其 `goals/read → plans.queryGoal`、`source/capture → workspace.captureSourceChanges` 的 plain 请求、`architecture/capture → architecture.captureSourceChanges` 的 GraphWrite。领域 rejection 通过既有 CoreRouteRejectionError 交 server 映射正确 HTTP 状态，保留原结果体。只传递原领域结果，不在 Host 实现治理/Plan/CAS，不直接读写 Store，不用动态 method 分发。
2. **持续可用的页面。** 保留工作区选择、导航、表单和结果区；操作结果只更新对应面板，不再一次 show 替换全部页面而丢失按钮。所有受信配置 workspaces 均可选择；选择切换同步绑定 scope、Goal/ref、文件 capture/cursor 和图状态，不能把上一 scope 的引用用于下一 scope。状态仅为页面选择、原请求和实际返回 DTO，不成为第二业务 owner。
3. **首次初始化与审阅。** 提供具体的 Project/Workspace 初始化、Goal ID/目标输入，以及可信初始化资料的政策、架构与 Plan 审阅/选择。按真实 Project → Workspace → policy install/activate → Goal → initial architecture → Plan propose/apply 串接；采用每一步真实返回 ref/digest/revision、proposal revision 和实际 Goal 版本构造下一请求。各操作独立提交，失败保留已成功事实与具体原因，不暗示跨步骤原子。没有 review 仍允许通过具体输入创建目标；政策、baseline、Plan 缺项明确展示，不补造空数据或自动生成验收。复杂资料可使用对应领域专用输入/资料审阅，不能退化成通用 method/JSON 执行器。
4. **真实版本与重试。** 一次具体操作在发送前隔离并保存完整 body（scope/input/requestId/expected）；失联重试原样重发。成功后的下一操作使用新 key 与该操作实际需要的 pin，不按 route 永久复用旧 key，不自动修改待重放请求。首次创建用正式缺席 pin；后续使用已读/返回版本。冲突展示原 current，明确重新操作时才构建新请求，不伪造成功或无限更新版本重试。没有对应 reader 的状态不推测已登记；使用现有回执/冲突信息和已知引用，不新增查询路由或状态库。Host 重开旧 token 按现协议提示刷新，不自动重发写操作。
5. **文件正常链。** 当前 scope 明确 capture → 保存真实 CaptureSummary.ref → paths 分页 → 点选 path 精确 read；保留 capture/cursor/scope，使用真实 nextCursor，不用 `{}` 占位。capture 是用户明确动作，页面打开和查看不自动捕获。正文、路径拒绝、缺失、source_stale、容量限制按原结果显示，不合成空文件成功；保留原授权和 source provider。
6. **双图及观察结构。** 从真实采用 baseline/ref 读取采用架构，从真实 architecture capture 返回引用查询 observed 结构，从 Goal 读取正式 TaskGraph；采用/观察明确区分，同时呈现任务图与其关系、实际任务状态/诊断。图可用已有列表/SVG，必须展示真实节点/边而非只给 baseline 标签或 JSON。Plan 的业务版本显示 `planRevision`，不可将不可变行 `revision=1` 当后续计划版本。无 Plan、无 baseline、无 observed capture 均显示实际缺口，仍能继续浏览/初始化；不宣称 Task/Goal 已正式完成。

初始化后的读取入口必须可重新打开：允许输入/选择已知 Goal 与领域引用，复用 `goals/read`、`plans/proposal`、`tasks/query`、`architecture/read`；不得为方便恢复扫描全账本。浏览器仅调用既有明确路由、type-only HTTP DTO；主路径不调用模型、不注入 Runtime。R6.1b 的 Session/材料/历史/邮箱、Git 预览、Query/Workflow/control UI 均留原后续批次，不返回假成功。

## 验收与停止

先运行冻结的 `next-r6-host`、`next-types`、`next-ui-types`、`next-build`，修实现直到本批目标通过；不改测试期望、不新增 case、不自行扩邻接/全量矩阵。遇到真实既有 port 缺口，报告具体符号与正常链阻断，不另造接口、DB、manager 或后台循环。

交付六文件 hash、检查结果、实际本地启动方式和一份可供主审浏览器点选的可信配置/初始化资料说明，立即 STOP。说明使用已有资料或在回复提供配置，不超 scope 创建配置/测试文件。主审最后以真实浏览器验收：空库初始化与保留 Goal 的缺项路径、逐步回执后继续导航、文件 capture/分页/read、采用/观察与任务图、重开后的既有引用查看/原请求重放。HTTP 绿测或纯展示字符串不替代真实点选；完整隔离由主审按整批节奏收口。
