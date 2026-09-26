# 指定大文件增长解释：有界只读审查

快照时间：2026-09-26T16:25:27.844285+00:00。只读四个指定主体文件及其直接消费点；未改生产代码、未运行测试或重新统计规模。图与历史接线继续推进，本报告不是新的放行门槛。

冻结统计仍采用 `new-code-inventory-20260926`：src TS 从 165 文件 / 30,464 物理行到 225 文件 / 60,612 行，净增 30,148。该统计时点为 2026-09-26T15:23:51.770568+00:00；本次最新 UI 已包含随后导入的执行入口，因此不把本次文件状态反写进旧快照，也不以旧 LOC 为最新文件行数。请求中的 `src/core/agent-runtime/execution-entry.ts` 实际不存在，对应大文件是 WorkGraph 的 `tasks/execution-entry-service.ts`。

## 实际增长对应什么

| 文件与消费链 | 新增产品行为 | 入口、回执与并发机械代码 |
| --- | --- | --- |
| [execution-entry-service.ts](/home/hyh001/projects/coding-platform/coding-platform/next/src/core/work-graph/tasks/execution-entry-service.ts:856)；composition 的 entry 进入 Runtime，并把同一依赖交给 model-call 服务 | `authorizeRuntimeEntry` → `beginRuntimeEntry` → `recordExecutionEntered` → `recordRunResult`，把 Task Claim/Attempt/Run、真实 Kernel 身份、历史边界及终态写成正式事实；终态只释放本 Run 仍拥有的 Lease/Session（1292、1383–1438）。这比仅有 Task DTO 多了实际执行闭环。 | 调用上下文与请求隔离（201、248）、保存的 manifest 解码（361）、精确 Run pin、原事件回执恢复（809）、一笔提交内多个事实的 guards/records/events。`admitEnteredRun`（748）已被 [model-call-service.ts](/home/hyh001/projects/coding-platform/coding-platform/next/src/core/work-graph/tasks/model-call-service.ts:123) 的准入和实际请求记录（223）共同调用，并非复制两套准入算法。 |
| [WG query-execution.ts](/home/hyh001/projects/coding-platform/coding-platform/next/src/core/work-graph/queries/query-execution.ts:629) → [Runtime query-execution.ts](/home/hyh001/projects/coding-platform/coding-platform/next/src/core/agent-runtime/query-execution.ts:133) | WG 增加 Query 领取、准备绑定、进入、用量、观察与正式 Answer 写入；`recordObservation`（1241，terminal 分支 1339）把 Job/Run/Answer 与 Session 占用一起结算。Runtime 从原 Session 历史边界启动真实只读 Query，已开始的 Run 只观察原执行（174–181）。 | WG `validateExpected`（530）、`replayOriginal`（606）、`commitOperation`（467）承接 CAS、原请求身份、提交结果不确定及原回执；不能拿后来的当前状态伪装旧结果。Runtime 使用既有 `ModelBudget`（301）和 `runObservedModel`（424），不是新增模型循环或独立账本。composition（319、329、395）把同一个 Query writer 注入 Query 服务和 Runtime。 |
| [ui/main.ts](/home/hyh001/projects/coding-platform/coding-platform/next/src/ui/main.ts:1135) → HTTP → 原 Query/Workflow owner | 三栏、Session、辅助页签、文件引用等显示能力之外，`executeQueryFlow`（1135）实际调用 goals/read、registration、Session、submit/claim/prepare/start、answer/materials，再把正式 planning answer 交给 Workflow；`drainContinuation`（1083）发送原 owner 返回的 continuation。`renderAll`（2734）显示这些正式读取结果。 | `executionCall`（949）保留同一次动作的原请求与确认回执，`runExecution`（1271）在首次 await 前捕获 scope、Goal、Session，防止正常切页把晚回执套到另一操作。`submit`（451）是一般单次操作，前者还要恢复一串已确认步骤；两者已有共同 `callCore`（430），不能仅因都发送 HTTP 就把其中一套删除。布局、草稿、焦点和滚动状态也不是第二份领域事实。 |

上述说明证明这些大文件承担了实际新增能力，不能证明新增 30,148 行全部必要，更不能仅凭生产/测试比例给出必要性百分比。这里没有逐条认可所有 validation；尤其不以产品不存在的 Role 热切换、直接改坏数据库为额外理由。材料撤销、Session 占用、重复请求、切页中的延迟回执属于实际路径，应与纯 DTO 解码分开判断。Task 终态分支（1368–1372）明确不重新套用新动作的 Host/Role/material 准入，保留已发生事实。

## 两处有具体重复证据的后续收敛候选

1. **同一 Query manifest 的读取解码重复。** WG `loadQueryManifest`（352–396）与 Runtime `loadManifest`（81–117）都读取相同 body，逐项比较 ref、digest、字节长度、原 QueryRun owner，再解 JSON、QueryRunRef 和 inputDigest。WG 消费点是 `bindPrepared`（853）与 `beginEntry`（997）；Runtime 消费点是 `start`（162）。可把同一 PreparedQuery 的静态解码部分收成双方可导入的一处函数，复用现有 body port 与契约；两端在各自动作边界仍按需读原 body，保留各自的当前状态/授权检查，不能用跨动作缓存替代准入。现有两份校验在 size 下界、错误文案上已略有差异，合并前应明确契约，不能简单删一端。这是局部重复实现，非删掉 Query writer 或 Runtime 的理由。

2. **Session 历史请求装配重复。** UI `buildSessionHistoryRequest`（852–865）与 `buildSessionHistoryRequestFor`（2217–2230）都验证上一页属于同一 Session、提取 nextCursor，并装配 `sessionRef/afterCursor/throughCursor/limit`。前者被中栏历史首/次页动作消费（1554、1560），后者被指定 Session/历史页签动作消费（1575、1597、1605）。可让当前选中入口先捕获明确 scope/ref，再共同调用显式参数 builder；保留捕获 scope 的约束，不回退到异步完成时的新选择。这里只合并请求构造，不合并各页签结果与游标状态。此文件正由图/历史接线消费，后续若同一范围已收敛，应直接视为该候选关闭，不额外开清理批次。

两项只定位了少量可复用代码，不足以解释或否定全部约三万行增长；不据此发起大范围删改、通用 validation manager 或新的验收矩阵。

## 所读文件 SHA-256

- `src/core/work-graph/tasks/execution-entry-service.ts`：`1fdafb34ca337df23682bf5556f30ab2ebe1f7ab31b0c0e28d61c293e6368a09`
- `src/core/work-graph/queries/query-execution.ts`：`30263f0a77b54de09d8ee81b6ad950c5b0d40c07d0944985dcb420d70f730381`
- `src/core/agent-runtime/query-execution.ts`：`15522b4182e532063665de7959eae035ea07fca529e5abe8da6c22176338d2f0`
- `src/ui/main.ts`：`65f227d05f435b515441601b573bfaf5d7e710b50a46f5ef53c6d00003a8d805`
- `src/core/work-graph/tasks/model-call-service.ts`：`810c8044666fad7aecbd063caef18b9d37fe224f8d43710916292c03ca39d4c0`
- `src/composition/create-platform.ts`：`9d5be391be290d065be762f733acd44a91e7481ed3643b6cc61698db5c1297aa`
