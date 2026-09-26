# R6.1a 实现返修：正常交互与工作区结果归属

2026-09-26。承接 [原实现任务](R6-host-workbench-implementation.md) 和同一 [六文件 scope](R6-host-workbench-implementation-scope.json)。候选已 STOP：`r6-host-workbench-implementation-20260926/attempt-1790404711062536398`。本轮只修主审实际浏览器与源码确认的正常路径问题，不新开骨架轮次，不扩测试矩阵；HTTP/UI 检查与最终浏览器验收仍由原流程完成。

## 写范围与保留约束

仍仅 `coding-platform/next/` 下六生产文件：`src/app/host.ts`、`src/app/core-routes.ts`、`src/ui/main.ts`、`src/ui/views.ts`、`src/ui/index.html`、`src/ui/styles.css`。预计修正集中在 UI，不为凑范围修改已正确文件。所有测试（冻结 15 项）、DTO、server/token/CLI、composition/core/Kernel、检查与构建配置均只读；不得新增产品文件、路由、依赖或持久化状态。

保留同一 platform、17 条明确路由、真实返回引用、领域权限/CAS 和回执语义。尤其普通 `files/read` 的 rejected body 既有 HTTP 200，GraphWrite conflict 既有 HTTP 409；不得统一改变读写失败语义。

## 必须修正

1. **异步返回必须归发出请求的工作区。** 当前 `main.ts::submit` 在 await 前保存 `current`，但随后 `applyResult(route, payload)` 又调用 `state()` 取得当时选中的工作区。用户在 A 发出捕获/创建/读取后切到 B，A 的响应就会污染 B 的 capture、Goal、图等引用。让结果处理显式接收本次原 `ScopeState`（或等价原 scope 身份），将本次请求、回执、错误和 DTO 始终写回该实例；渲染可以只显示当前选择。切换后不能将 A 的引用、cursor 或 pending 写到 B，也不必取消 A 的真实操作或丢弃其已提交事实。保留每个 scope 的原请求重放按钮语义。
2. **普通输入失焦不得销毁下一控件。** 主审真实浏览器填写 Goal ID 后，输入节点被断开。原因是全局 `change` handler 将文本 input 当成 select 并 `renderAll()`，失焦时重建整组表单。普通文本输入仅同步本 scope 表单状态；必要的 select 变化才更新依赖面板。不得以每次输入重绘、定时重绘或自动提交替代；正常填写目标、再点击下一按钮和其他导航应连续可用。
3. **默认页面使用产品语言，完整技术事实收进可展开详情。** 默认标题与说明去掉 `R6.1a`、Runtime、token、requestId、expected、路由名和成段 JSON 等施工说明；例如用“项目 / 工作区”“目标”“计划”“采用架构 / 观察结构”“文件”“重新发送”“查看详情”表达操作。Host 重开提示用户刷新连接即可。原完整请求、回执、版本/ref/digest、错误码/current 和原始拒绝原因仍可在有明确标签的可展开详情中查看，不能丢弃、修改或伪造事实。成功摘要和真实缺项/拒绝应直接可读。继续保留原样重发与重放原请求两个实际动作，不把技术信息折叠解释成删掉协议字段；不得新增 UI 框架或业务逻辑。
Plan 准入沿现有 owner：当前空 `meta.expected` 已由领域接受，内部采用与 basedOn guards 保持原有语义；主审真实浏览器已通过初始化 → propose/apply → TaskGraph。本轮不因任务文案更严格而追加 Goal pin 校验或扩大正常路径前提。

## 验收与停止

只运行原 `next-r6-host`、`next-types`、`next-ui-types`、`next-build`；不改测试、不新增异常矩阵，不扩邻接或全量。如主审在同一正常初始化浏览器路径追加确认的直接阻断，再合并到本任务一次处理；不得为展示更漂亮另开返修轮次。

交付六文件最终 SHA-256（未改文件也列出）、四项检查结果、实际改动摘要后立即 STOP。主审继续真实浏览器验收正常初始化、连续填写/导航、在途切工作区、原请求重放、文件和两图；不能用 HTTP 15 项通过替代浏览器交互结论。
