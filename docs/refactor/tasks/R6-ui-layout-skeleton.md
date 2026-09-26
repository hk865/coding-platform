# R6 UI 布局与已有事实：骨架任务（已中审导入）

2026-09-26。本 [5 路径 scope](R6-ui-layout-skeleton-scope.json) 骨架已经中审并导入，证据见 `../reviews/evidence/next-b2-2026-09-26/r6-ui-layout-skeleton-import.json`；其后的 [四生产文件实现](R6-ui-layout-implementation.md) 也已导入，等待真实生产浏览器验收。下文保留阶段契约与已确认产品边界，不再是待派发状态。同 main/views 与 [R6 执行入口](R6-execution-entry-skeleton.md) 串行集成，后者仍依赖 Query、初始 Plan、Workflow 和可信运行配置，本批不改变其前置。

## 1. 目标和真源

把已经可用的生产表单/列表整理为用户确认的三栏工作台：真实会话与图/文件可看，局部页签和引用草稿可用。先读 [UI-WORKBENCH 的 13 项方向](../../UI-WORKBENCH.md#1-已确认的-13-项方向)、[MVP B07](../../MVP-BEHAVIOR.md#b07查询解释与统一导航)、[R6 §6.7](R6-host-workbench-skeleton.md#67-下一批-ui先接真实浏览与草稿再接执行动作未派发)，再看现 `src/ui/main.ts/views.ts/styles.css/index.html`、只读 `src/app/core-http-types.ts/core-routes.ts` 及既有消费者测试。原型只参照交互，禁止复制其示例项目、任务、时间、Agent 或模拟事件作为生产数据。

沿一个 Host/platform 和既有 27 条明确 HTTP 路由，不新增后端接口、业务 store、模型调用、日志 owner、依赖包或图标 CDN。所有领域类型继续从 HTTP DTO type-only 消费；布局/选择/页签/滚动/固定集合/草稿是页面显示状态，不反写正式 Task/Session。构建脚本与 server 当前仅发布 `main.js/views.js/styles.css/index.html`，本批保留这条闭包，不偷加未被发布的 JS 模块；图标用内联 SVG/现有文字按钮，不能依赖原型宿主的 `lucide` 全局。

## 2. 本批接线

1. **布局。** 固定视口高，左导航、中心 Session、右辅助区及详情各自内部滚动，输入和页签可达。两分隔支持指针及键盘调整、最小宽度、辅助区隐藏/放大/恢复。多页新建/切换/关闭保留各页选择、横向滚动、展开和编辑草稿；不要每次响应全量替换输入 DOM。现初始化/Goal/Plan/回执操作仍从辅助页可达，不因换布局丢功能。右侧目录和文件页面分开。
2. **项目与 Agent。** bootstrap 仅代表 Host 允许导航的 scope；领域登记事实仍取原回执。现 `sessions/find` 按 scope 分页，默认 includeArchived:false，并提供用户主动查看归档的筛选。工作中/待命沿 SessionCard.availability，健康/生命周期及 Role 按原字段；不由列表顺序推断正在执行。角色默认折叠，选择 Session 后读原详情/历史，已有邮箱仍明确标为平台消息。
3. **传统历史。** 消费 `sessions/history` 的原 nextCursor/basis 和 recordId/position；默认分段摘要/折叠，已知 `kernel_session_record_json` 呈现用户输入、assistant 正文和工具结果。用户主动展开“原始历史/原始记录”时，可查看 Session 已保存的完整原文，包括 `reasoningContent`/`reasoning`、工具原参数、原结果及未知事件原载荷；保持原身份、位置和事件顺序，不默认摊开。原记录是带来源的既存产品数据，不能生成新的解释冒充原文，也不把原字段冒称另有公开摘要。所有历史详情/回执入口保持同一语义；撤销此前永久过滤这些已持久化原文的限制。工具/Turn 可折叠，原序视图不复制或重新排序事件；不把同一时间的并行工具伪串成因果。当前 DTO 尚无完整 Platform Task↔Kernel Turn 映射，不能按 Session 当前工作链接猜所有历史的 Task；精确 Task 折叠待 §6.7 的执行读取路由接通，未绑定记录保持原 Turn/未关联展示。ArtifactRef body 不能冒充已读取正文。浏览历史不启模型或 ack。
4. **真实双图和详情。** Task 取 `TaskGraph.plan.taskHierarchy.parentOf` 与 TaskRow，包含边、relations/输入条件分开显示；plan_only、optional、缺验收未来节点不滤掉。架构用现正式 catalog.modules/dependencies 与 observed nodes/edges 分别画节点/连线，保留源版本/覆盖。窄栏保留宽画布横向滚动。单击详情、hover 短预览、双击/右键固定完整标签、新 tab 查看均只改变显示；有键盘/按钮等效入口。Task/Module 可用真实 WorkLinkTarget 沿现 `sessions/find` 查看关联会话，包含用户请求的归档；模块路径只能作为目录前缀，不能当文件直接读。
5. **目录、文件草稿和引用。** `source/query` 的 paths 按目录投影并保留 capture/coverage/分页状态，打开页面不自动 capture；已知 path 可直接沿 `files/read`。目录页与独立文件页都能把 path 加入当前草稿；文件选区含 path、文本、起止行及原版本，未保存编辑明确标“草稿快照”。只读历史文件不变可写。草稿键绑定 scope＋项目主对话或完整 SessionRef，切工作区/Session/页签不串内容；归档页禁止发信和加入可发送草稿。加入引用不调用 HTTP/send，不把文件编辑显示为已保存。现有 Host 发信仍走 messages/send 原语义；项目主对话的模型发送显示真实未配置/未接通，等待执行入口批。

异步结果仍使用原发出请求的 scope/Session/对象身份；保留现 main.ts 的请求副本、原 requestId/expected、失联未知和 replay 语义，不因重绘、刷新或切页自动重发写操作。已 committed 的状态仅按回执/正式读结果更新。空、未读取、缺失、未授权、unsupported 和未知结果分别显示。

## 3. 明确保留的后续接口

本批不假装实现完整 13 项的后端缺口：架构包含树尚无 parent/contains 事实，不能由依赖 DAG 推断 root 路径和兄弟；当前 TaskGraph 无完整历史尝试枚举/执行时间，连续时间放大镜与全历史轨迹要先接原 execution/history 读口及必要正式引用；无时间的未来节点保留未来区，不填演示时间。Git 精确版本 read/compare 已有核心 port，但本批无 compare HTTP，diff 留后续窄路由；完整文件系统目录、文件保存、终端会话、模型发送、控制恢复各沿原 owner 接通。本地页签/固定/草稿保留先覆盖当前页面，跨浏览器重启持久化不能仅凭内存状态宣称已交付。相关缺口继续在 R6 §6.7，不新增管理层。

## 4. 精确写入范围与阶段停止

scope 为 **4 个已有生产文件＋1 个已有消费者测试**：

- `coding-platform/next/src/ui/main.ts`：复用既有请求/作用域/回执，改局部布局和交互接线；将纯呈现转换放 views，不堆第二套领域状态。
- `coding-platform/next/src/ui/views.ts`：同 DTO 的图/Session/文件/详情展示及必要纯显示状态辅助，保持现公开 renderers 的业务语义。
- `coding-platform/next/src/ui/styles.css`：固定高度、内部滚动、宽图、分隔、页签、输入与可访问状态。
- `coding-platform/next/src/ui/index.html`：生产页面骨架与本地资源；保留 token 占位及现静态入口。
- `coding-platform/next/tests/app/R6-workbench.test.ts`：复用现静态闭包/DTO 消费者，不增加浏览器框架或修改领域测试。

Host/core/composition/Kernel、core-http-types/core-routes、构建与边界脚本、所有其它测试及 runtime-assets 只读。第一阶段仅交付新增展示接缝与最终行为断言，既有正常界面保持，明确未实现的新交互首红后 STOP；主审冻结后才开放这 4 个生产文件实现，测试转只读。不要在骨架阶段用假事件把功能填绿，也不删除旧正常断言以适配新布局。

## 5. 最小验证和交付

既有消费者内只增加两组必要正常断言：一组验证同 scope/Session 的 tab/草稿往返和真实文件选区引用（标未保存、无发送、归档只读）；一组验证真实形状 DTO 的原序历史、未来 Task 与结构边/依赖边区别、原 ref/版本导航。纯显示 fixture 明确是展示输入，不 seed 正式领域状态宣称 E2E；不补后端权限/并发矩阵。静态构建仍证明无 Host/core 实现进入浏览器、图标不依赖演示全局。

使用现 `next-r6-host` selector、`next-types`、`next-ui-types`、`next-build` 一次必要检查；原 Host 测试只读跟跑，不扩写。主审在真实生产 Host 一条浏览路径核项目/Agent选择→原历史→双图详情→目录/文件独立页→选区入草稿→切页/隐藏恢复与两侧拖动，确认外页不增长、输入/草稿不丢、未触发额外模型/消息。这条生产路径与原型证据分开记录；真实执行/保存缺口不标完成。交付实际 5 文件 hash、已实现用户路径与仍待接口部分，随后 STOP。
