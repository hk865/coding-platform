# R6 真实浏览器问题：三生产文件窄修（已授权）

2026-09-26。根代理已完成实际生产 Host/SQLite 浏览器首验，授权将本页列出问题一次修复并独审导入。fresh lane `r6-ui-browser-repair-20260926`，从最终已导入 UI 基线准备；旧 `r6-ui-layout-implementation-20260926` lane/session 与其 originalAllowedHashes 保留。本任务仅开放 [三路径 scope](R6-ui-browser-repair-scope.json)：`next/src/ui/main.ts`、`views.ts`、`styles.css`。index.html、所有测试/DTO/routes/Host/core/Kernel/manifest/构建脚本只读，不新增模块/依赖/后端 owner。

冻结测试 `next/tests/app/R6-workbench.test.ts` SHA256=`2960b61e492980bb9718eef81253cc430e4a7baafa6733fe55d3eab4fae25f78`。本轮不改断言，不增测试矩阵；此前 raw-history 测试修订仍依原用户授权，不能倒退回永久删除原文。

## 真实证据与已通过路径

根浏览器证据位于 `/tmp/coding-platform-r6-layout-review-_bie2rkk/graph.png`、`graph-probe.json`、`history.png`、`remaining.json`。同 depth 的 implement/gate 节点完全重叠，点击 implement 实际选 gate；双击/右键 pin 尚未实证通过。1440px 视口读 Session 原历史后 document.scrollWidth=4799，展开原文后=4814，外页高仍960。历史 raw details 实际默认关闭、主动点击后 open=true；早先 open=false 是点击中心超视口的布局后果，不应误修已正常的详情事件。

file-probe 已确认：目录与文件编辑页独立、内存草稿切页/隐藏恢复、选区引用携带 path/行/草稿标签、加入引用不发送均正常。本轮保留这些逻辑，不重构或补额外校验。右分隔实际拖动 420→600 有效；修后由根一起复验。

## 一次修复的明确范围

1. **真实图布局。** `views.ts:renderNodeLinkGraph` 当前按 depth 建 columnX，随后 bucket.forEach 不使用 index，使同层所有节点同 x/y。应为纵向 depth 层、每层内按各节点实际宽度+gap 横向逐一排布；画布宽取本层总宽的最大值+边距，高按层数与纵向间距。pin 加宽后同层节点不重叠，边仍由真实节点框中点连接。label/caption 的 text-anchor 中置；中文/英文完整标签应有足够宽度或可完整读的换行，不能用7.2/字加720硬上限后把中文全文画出框。只修简单确定性布局，不造图引擎或假时间。
2. **长历史内容 containment。** 历史长 cursor/依据当前常驻 header 撑宽整个页面。外层 flex/grid 项与三栏容器设置正确 min-width:0，必要 grid 列使用 minmax(0,1fr)，列/子页/详情限制在所属宽度；长引用可断行，完整原始文本在自己的 pre/details 内部滚动。cursor/recordId/basis 等依据保留到默认折叠详情，不常驻长串挤占对话。保留原 recordId/cursor/position/source、完整保存 body、reasoning/tool原字段和事件顺序；不能截断字段或用生成摘要冒充原文。默认关闭及主动展开逻辑已通过，不重做无关事件；修后1440视口文档宽不应随历史原文增长。
3. **紧凑全局状态。** `main.ts:renderLastPanel/renderLastResult` 与 `.wb-status`：只读动作后默认只需紧凑一行状态；完整结果/原始回执/重放操作放按需默认折叠详情，不再每次常驻结果+重放两张巨卡占34vh约300px。pending/失联仍如实表示结果尚未确认，保留原请求供显式重试；不改 requestId/expected、异步归属或自动重放规则。完整原文仍能展开内部滚动。
4. **导航与setup空间。** region-scope 自适应内容高度，region-nav 占左栏剩余空间，取消当前二者同flex:1把Agent列表推到半屏以下的布局。setup 原项目/工作区/完成策略/Goal/Plan/查询等能力都保留，以扁平分组/默认折叠呈现，去掉卡片墙；不删操作，不改变固定外页高度与内部滚动。
5. **产品文案。** 清理常驻 messages/send、等待执行入口批、沿用原字段等内部路由/施工说明，用直接产品语言说明当前可用/不可用能力。不要因清理文案删掉原始历史/回执内真实字段；技术依据可在用户主动展开详情中保留。
6. **原生节点手势。** 保持单击原图内/旁边详情、双击/右键切换本图页签pin集合、显式“在新页打开”才建详情页的契约。root将在修布局后原生重验；如果同节点连续点击仍受单击renderAll/innerHTML替换影响，只修这一真实接缝，不以handler存在宣称通过，不新增框架或测试矩阵。

## 检查与停止

分别运行固定 `next-r6-host`（19项目标）、`next-types`、`next-ui-types`、`next-build`，不跑全仓、不新增案例。仅现三文件原地写，不修改测试，不装依赖，不读打印任何凭据或漫游 profile/provider 配置，不启动浏览器。交付三文件 hash、准确检查与尚待浏览器实证项目后 STOP，不自行导入。主审固定独立检查和 audit 后精确导入三文件；根重建物理副本做最终原生浏览器复验。本任务不触及 R6 执行入口前置或未接后端能力。
