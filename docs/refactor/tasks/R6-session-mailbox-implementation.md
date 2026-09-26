# R6.1b-2 Session、消息与原历史：四文件实现

2026-09-26。骨架六文件完成中审；本阶段仅实现既有服务的实际 Host/UI 消费者。按用户授权直接施工，保留已落盘成果，完成后 STOP 独审。主协议见 R6-host-workbench-skeleton.md §6、R6-session-mailbox-skeleton.md，范围为同目录 implementation-scope.json。

## 冻结范围与复用

只写 core-http-types.ts、core-routes.ts、ui/main.ts、ui/views.ts；两测试及所有核心/Host/server/composition只读。原17条路径继续真实绑定；新10条沿骨架indexed method类型直接调用 sessions/runtime/messages 唯一实例。不能复制Session、信箱、历史owner，不暴露Host ack/respond，不在普通查看时启动模型。createSession仍plain原CreateSessionRequest（包含meta），messages/send仍GraphWrite。OperationReceipt accepted只表示处理中；创建完成后才能作为真实Session使用。

## 正常用户路径

1. 按当前scope读真实目录、查看会话详情/原历史；分页带原cursor与watermark，不自造session/run/history。可信review.sessionRoles只做选择资料，缺少该资料仍可浏览已有Session。
2. 按可信role引用创建Session，保留原requestId和完整请求供不确定结果重试，不改expected重建同identity；accepted可用getSessionOperation读取原operation，不显示已完成或自动造新Session。
3. 选定收件Session后以Host身份发信，sender只来自服务端ctx。完整原请求可重发，不能网络错误就宣称未提交/安全重试。inbox/read/body用真实ref和正文，读取保持pending，不伪造已读/回复/唤醒。
4. UI结果同时按捕获的scope和Session归位：异步请求完成不能污染后来选中的scope或Session，返回原scope仍能看到它的结果。复用当前ScopeState与异步写回方式，不全页重绘正在输入的表单。技术细节折叠，默认显示产品状态/正文/历史。可按批点查看，不增加未要求的后台轮询服务。

## 检查与交付

已冻结 next-r6-host 原15+新2，共17项。独立骨架结果应为16pass、新HTTP链在sessions/create unsupported首红；类型可编译。实现后必须沿真实SQLite/Kernel Session完成创建/replay/发信/读取/原历史/同库重开整链。只跑 next-r6-host、next-types、next-ui-types、next-build（分别执行），不扩矩阵、不跑全仓。主审最终浏览器验收实际操作。

交付四路径hash、实际通过结果及未实现边界，随后STOP，不自行导入/派发后续。Query/Workflow/材料/控制消费者留下一批，不能从该用户路径推断全部R6完成。

## 本次独审唯一返修（2026-09-26）

只修 ui/main.ts 的 send-message 后继取值，其他生产文件保持交付hash。已独立确认17项HTTP/展示全绿；不重新铺测试矩阵。

真实窗口：A scope/Session A开始发信→等待时用户选B scope→发送成功后，当前buildInboxRequest(false)通过全局state()生成B请求，却submit(scopeA)并标A tag。若B无选中Session还会发null。请在首await前捕获原scope+recipient+submittedText；发送及成功后的收件箱请求均显式使用该同一scope/recipient，结果tags同原ref，不从await后的state()/activeSession取值。仅清除仍等于所提交内容的输入，保留用户等待期间新输入的消息。无需新增状态owner或其他自动动作。

沿原 session-26bd6864-2e56-4765-bd9d-67b5797aee5b 继续；只跑 next-ui-types 与 next-types 即可，主审会在最终物理构建和浏览器实际发信/切scope时验收。交付main.ts新hash及其他三文件保持说明后STOP，不增加审阅目标。

## 最终浏览器发现的同工作区切 Session 返修（当前执行段）

前两阶段及四文件实现已导入，当前只修本段一个真实界面错误。范围仅 ui/main.ts，所有测试与其它生产文件冻结；主协议中的 Session 归属契约不变，不新建框架。

真实浏览器已从空库公开创建两个 Session：A 收到消息且读过正文/原历史后，选 B 并读取空收件箱，页面仍显示 A 的 message/body 和历史。ScopeState 存了某些 tags，但 renderSessions 没按 activeSession 选择，message/body更没有Session tag。不能只显示“属于A”便把旧正文混在B对话，也不能清空一次后让A晚响应重新出现。

修复：复用已有 state/request tags；每个Session相关结果带其原Session归属，渲染/分页/正文动作只消费当前Session及当前消息匹配结果；切换Session重置旧activeMessage，A异步回执仍保存原身份但不出现在B。需要处理会话创建/operation选择同一情形。不造新的业务owner、不重构全UI、不新增测试矩阵。主审浏览器会重验这一行为，现有scope切换与pending新草稿保留不得回退。

本轮fresh lane r6-session-ui-selection-repair-20260926，仅此段优先；只跑 next-ui-types、next-types，完成报告main.ts hash后STOP。
