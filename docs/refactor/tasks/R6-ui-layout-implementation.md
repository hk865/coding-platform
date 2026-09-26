# R6 UI 布局与已有事实：四文件实现（已导入，待浏览器验收）

2026-09-26。骨架已独立中审并精确导入，证据见 `../reviews/evidence/next-b2-2026-09-26/r6-ui-layout-skeleton-import.json`。从最终主工作区 fresh 准备 lane，沿本任务及 `R6-ui-layout-skeleton.md` §1–3 的已确认产品边界实现，完成后 STOP。主审已批准并fresh派发：lane `r6-ui-layout-implementation-20260926` / `session-cc32ca13-8b7b-443a-a8ca-3d86726c99d9`；精确基线见 `r6-ui-layout-implementation-dispatch.json`。R6 执行入口批次的 Query/初始 Plan/Workflow/可信配置依赖保持原样。 最终四文件已独立通过 19 项消费者检查、Node/UI 类型与物理构建，并按原基线精确导入；证据见 `../reviews/evidence/next-b2-2026-09-26/r6-ui-layout-implementation-import.json`。当前只剩根代理的真实生产 Host/SQLite 浏览器验收，不据此宣称全部 R6/E2E 完成。

## 写入范围与冻结契约

只写 `src/ui/main.ts`、`views.ts`、`styles.css`、`index.html`，精确范围见同目录 `R6-ui-layout-implementation-scope.json`。所有测试、HTTP DTO/routes、Host/core/composition/Kernel、依赖和构建脚本只读。已有 27 路由与唯一 platform 实例不变，不增 UI 后端 owner；图标使用内联 SVG/现有文字，不依赖演示全局/CDN。

`R6-workbench.test.ts` 冻结 SHA256：`2960b61e492980bb9718eef81253cc430e4a7baafa6733fe55d3eab4fae25f78`。保留旧 9 条全部原文与同 2 组新增正常链，不删/skip，不扩测试矩阵。用户本轮明确授权修改原第二组的永久屏蔽断言：改为默认折叠但完整原记录可主动展开；这是主审契约修订，不得宣称测试从首次冻结后从未变化。更新后的测试对 DSH 继续只读。现独立状态为原 Host/UI 共 17 项通过、新 2 项分别在 reducer unsupported 和历史占位缺正文首红；后续断言尚未执行，不能写成已验收。

实现 `views.ts` 已冻结入口：`createWorkbenchLayout/reduceWorkbenchLayout/renderWorkbenchLayout`、`renderSessionHistoryTimeline`、`renderTaskStructure`、`renderWorkLinkTarget`。同一 `WorkbenchLayout` 绑定 scope＋项目主对话或完整 SessionRef；`composerDraft` 是当前对话草稿，file 页的 `editorDraft` 独立，引用只加入 composer。现读取文件的 version/digest 保留原事实，未保存选区用 `source:draft_snapshot` 标记，不宣称落盘。纯显示状态不得发送消息/模型请求。

同一 `WorkbenchTab` 判别联合用于真实挂载，禁止再造平行页签模型：`setup` 承载原项目/工作区/完成策略/Goal/Plan 控件；`task_graph` 保存 HTTP TaskGraph 的 GoalRef；`architecture_graph` 保存 HTTP ArchitectureReadBody 的 current 或精确 revision selection；task/module 详情保存完整 WorkLinkTarget，history/session_chat 保存 SessionRef，directory 保存 path，file 保存真实 WorkspaceFile 与独立编辑草稿。scope 取所属 layout。tabId/title 只是显示身份，不能解析来猜领域 ref。主页面可以在现 ScopeState 内保存与这些身份对应的显示结果/选区/滚动，不建立第二份正式状态。

## 一条实际界面路径

1. 将现可工作的表单/列表挂入固定视口高三栏，左项目/Agent 导航、中心原 Session、右辅助页签。所有当前初始化/计划/查询/邮箱操作仍可达；两分隔指针/键盘调宽，右侧隐藏/放大/恢复，多 tab 新建/切换/关闭，子页/详情内滚，输入和页签始终可用。局部刷新保留输入、草稿、展开和滚动，不能每次响应重建整页并丢当前编辑。
2. 沿真实 sessions/find/read/history 展示未归档工作中/待命会话，归档由用户选择；角色默认折叠。bootstrap 只是可导航 scope；没有正式读取/本页回执时，登记状态显示未读取/未知，不能声称不存在或反推登记成功。保持无 review 资料时浏览已有 Session/原历史/消息的真实路径。
3. 原历史按原 recordId/position/cursor 顺序呈现 user、assistant 正文和工具结果，保留分页/basis；Turn/工具可折叠。默认分段摘要/折叠，主动展开“原始历史/原始记录”时可查看 Session 已持久化的完整原文，包括 `reasoningContent`/`reasoning`、工具原参数/原结果、未知事件原载荷。保留原来源/身份/位置与事件顺序，不默认摊开，不生成解释冒充原文。详情与回执的历史入口保持同一语义；撤销此前永久屏蔽已保存原文的要求。ArtifactRef 展示引用及“正文未读取”。不从 Session 当前工作链接猜所有历史的 Task，也不把并行活动伪排成因果。
4. Task 使用真实 parentOf 包含结构，执行 dependsOn 及 relations 分开，未来/plan_only/optional 不滤掉；架构采用 catalog.modules/dependencies 和 observed 事实，current/精确 revision 不混合。窄栏保留宽图与横向滚动。单击详情、hover 预览、双击/右键固定完整标签/新 tab 均只改显示，有键盘按钮等效；真实 target 沿原 sessions/find 关联当前/历史/按需归档会话。
5. source/query 已捕获 paths 按目录投影，保留覆盖/分页，浏览不自动 capture；目录页与独立文件页分开，文件 read 沿原版本。整 path/选区 path+文本+起止行加入当前 composer，未保存标草稿快照，不自动 send。归档可浏览但不能编辑/加入可发送草稿；历史版本保持只读。切 Session/scope/页签及隐藏恢复不得串草稿或丢编辑。

继续保持当前 main 的请求身份绑定：首 await 前捕获原 scope/Session/recipient/submittedText；晚响应保存原身份但不显示在后来选中的 Session，pending 发信只清仍等于所提交内容的输入。不重建已发 requestId/expected，不因刷新自动重发写操作，失联结果保持未知。既有“平台消息”和模型对话边界清晰，模型发送/文件保存未接通处显示实际能力状态。

## 明确接口缺口与检查

本批不造 architecture parent/contains，不以依赖 DAG 猜包含树；不造 Task↔Kernel 映射、完整执行时间或历史尝试。连续时间放大镜/离散全历史、架构 root 路径并集与兄弟、diff HTTP、文件写入/终端/模型发送/控制恢复继续沿 R6 §6.7 与原 owner 后续接通。未来节点无时间不填假时间。当前页的内存保留不声称跨浏览器重启持久化。

只运行固定 `next-r6-host`、`next-types`、`next-ui-types`、`next-build`；目标为 19 项全过及边界/物理构建通过，不扩全仓矩阵。主审用实际生产 Host 做项目/Agent→原历史→双图详情→目录/文件独立页→选区入 composer→切页/隐藏恢复/两侧拖动的一条浏览路径，检查外页不增长、输入草稿不丢、未触发额外模型/消息；原型证据不替代这条验收。交付四文件 hash、实际用户路径与剩余接口缺口后 STOP，不自行导入或继续执行入口批。

## 历史原文契约修订（当前优先，2026-09-26）

用户刚明确要求完整已保存原文按需可达，覆盖此前永久屏蔽条款。主审只在原第二组正常展示断言中改约定，未增加 it/case；`data-history-raw="<recordId>"` 作为每条原记录默认关闭的 details 展开入口，正文保留原 body/source 内容。当前四生产实现范围不变。DSH 在 STOP 后沿同会话接续一次窄纠偏；不删除本轮已完成布局，不扩后端或新增框架。
