# R6：本地 Work Run 的暂停/取消消费者骨架

2026-09-27。主审已按现有公开端口核对的下一批草稿；**尚未批准 prepare/派发**。必须等 R6 graph/history 两 UI 实现最终导入，fresh main 取基线，避免共写 main/views。只消费已导入的 R4.3a/b，不设计 resume、冷恢复、Query 控制或新执行引擎。生产范围为原五文件，加原两份 R6 测试；见 [scope](R6-work-control-consumer-skeleton-scope.json)。

先读 docs/AGENTS.md、当前 HANDOFF、IMPLEMENTED-CAPABILITIES 的 RT10–RT12、R4-control-runtime-implementation.md、R4-terminal-history-implementation.md、已导入 R6 graph/history 契约。源码以 `control-contracts.ts`、`contracts/control-intent.ts`、原 Runtime ports/execution-control/observer、composition 与当前 UI 为事实。原五模块、Host token/scope/身份和两阶段工作法不变。

## 1. 三条现有 owner 的薄路由

| suffix | 原 public 方法 | body |
| --- | --- | --- |
| controls/submit | platform.controls.submitControl | `{scope,request:GraphWrite<SubmitControlInput>}` |
| controls/read | platform.controls.readControl | `{scope,input:ControlIntentRef}` |
| runtime/deliver-control | platform.runtime.deliverControl | `{scope,input:{intentRef}}` |

请求/响应类型由 RunControlPort 与 NonNullable<RuntimeExecutionPort['deliverControl']> 派生；沿 CoreRouteSuffix/Bindings/Specs、原实例绑定和明确 switch，前者 graph_write，后两 plain。不公开内部 recordControlObservation、AbortController、Kernel 身份或 generation，不允许UI自报Host/context。不新增Host配置、Server队列、Store或控制状态 owner。

现 `executions/read` 读取 TaskExecutionRecord；复用它取得完整 RunRef、**当前 Run revision**、原 controlState.intentRef、原 claim Session。submit 的 meta.expected 恰为一个同 Run 的正整数 pin，不加 Session/Lease/intent pin。intent身份、时间、actor、queued由正式owner生成。

## 2. 准确能力与实际控制对象

composition 只修当前 capabilities 的过期显示：trusted Runtime 已装配且 workspace 的 Kernel Store 存在时，safePointPause/cancel 可声明已有的有限支持，reason 清楚表达“本 Host 活跃 Work Run；暂停等待安全点；实际结果以原观察为准”。没有 Runtime 仍 false；没有 Kernel Store 保持原拒绝。其它能力不顺带开放；拆开原‘全部未实现’文案，避免把本批成功误报为Query控制/resume/冷恢复。views 在 supported=true 时也显示有意义的有限支持说明，不添加新 DTO 或生命周期状态。

在途 Work 的引用来自原 workflow/advance 的 perform/start request.prepared.claim.runRef（取 start 发送前已保存的 resumeIntent/input 或 pending.request，不能等响应后才赋值的 advanceRequest）；现 UI ExecutionRun.runRevision 是 QueryRun 版本，绝不能用于控制。也可从 TaskRow.execution/已读执行页拿完整引用，历史 ended Run 只显示事实。每次新控制先明确读取当前 Run，再产生新动作 requestId/pin；按钮显示范围不取代原 owner 最终判断。暂停保持原占用，界面不得提供未实现的恢复按钮，也不以新Session/Run冒充恢复。

## 3. 原请求、原回执与独立页面动作

server 每请求独立 inFlight、composition trackedCall 仅跟踪关闭，所以 workflow/start 长请求在途时仍可接受独立 read/submit/deliver。页面不得因执行中将所有控制按钮禁用；不通过中断原HTTP请求来实现取消。

在首await前捕获 scope、完整 Work Run、发起页面对象。控制动作使用单独的页面 pending/回执，复用 callCore，不覆盖正在执行的 run.calls/callIndex/pending 或重入 driveRun。精确提交成功后只对返回的原 intentRef 调 deliver；之后沿 controls/read 与 executions/read 手动刷新正式结果，不造ack、终态、Task/Goal完成或释放。

queued表示请求受理，deliver ready/queued仅表示已尝试投递。只有原 applied/paused 或 applied/cancelled 可显示相应实际结果；superseded/terminal_without_cancel表达自然结束，outcome_unknown保留未确认。无live handle仍可能queued，不能显示成功停止或自动恢复。原快照/回执与技术字段按需折叠，常驻只保留工作、请求/实际状态及适用动作。

网络/提交结果不明保留原 route/body/requestId/expected，只原样重试；lookup replay可能返回旧 queued@1，随后按ref读当前snapshot。不拿新Run版本套进旧requestId。revision_conflict先展示冲突/当前读取，新动作才使用新ID；无无限轮询、无自动反复控制。新动作/普通刷新不能覆盖尚未确认的提交请求。

本次图/Session历史仍走刚交付的页面读取和原cursor，不能另造控制历史或抄transcript。读取历史不调用observe/reconcile/模型。完整Task尝试枚举、强等待/唤醒、resume/维护与UI最终视觉整理仍为原后续范围。

## 4. 骨架、正常链与STOP

Stage1：三路由可直接真实透传，不把已实现owner改unsupported；UI定义最小类型/显示/点击接缝，尚未实现明确显示缺口；不在骨架写完请求/重试算法。capabilities实际投影留Stage2，避免把最终行为测试绑定为永久false。测试与接口中审冻结后，Stage2预计只main/views/composition三文件。

只扩原 R6-host.test.ts、R6-workbench.test.ts，复用既有JSON配置/公开初始化/受控provider，不修改B2共享fixture：

- Host增**一条正常在途Work取消**：原公开初始化→规划/采用→同Workflow start在途；复用createScriptedModel既有beforeReply，Query前两回复照常，第一Work provider(index2)等真实signal。同期通过新HTTP submit→deliver，等原start收尾，按原intent/read与Run读核applied/cancelled、Run ended、原Session同代释放且原历史仍可读。Workflow等待而非Goal完成。不给Kernel mock工具，不直接写terminal/locator，不取消HTTP客户端来制造结果；finally能释放临时provider等待，避免失败挂死。
- 原唯一正常规划完成链及图历史读取断言保持。新控制同request原样replay可在同case尾核原回执，不另增重启/并发/权限矩阵。该case也读实际已装配capabilities，只对pause/cancel的有限支持作最终断言；无Runtime的原路径保持。
- Workbench沿现显示it核queued≠applied，原完整细节默认折叠，控件最终入口而非unsupported；不新建DOM框架。骨架首红必须落在明确新消费者缺口；正常生产者前态不合法就修fixture本身，不改生产约束。

固定检查 next-r6-host、next-types、next-ui-types、next-build，必要原architecture；不跑重复全平台矩阵。交付范围audit、hash、准确首红/已达流程后STOP。主审冻结后才派算法；实现最终独审后用一个新临时工作区和受控provider做一次真实CUA取消路径。已有完成库 NJz7aU 继续仅用于原历史读取，不将其改造成取消fixture。
