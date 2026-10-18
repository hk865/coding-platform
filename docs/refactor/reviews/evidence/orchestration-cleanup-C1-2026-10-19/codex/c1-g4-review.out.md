只读审查完成，未写文件、未运行测试。基准为提供的 diff 和 `base/`；diff 确为 **32 文件，+407/−617**。以下 `tasks/` 均指 `src/core/work-graph/tasks/`。

| 分类 | 文件:行 | 发现与证据 | 修法 |
|---|---|---|---|
| **会出错** | [tasks/run-state-service.ts:205](D:/cxt/c1-g4-review/src/core/work-graph/tasks/run-state-service.ts:205)；[base:242](D:/cxt/c1-g4-review/.lead-ref/base/src/core/work-graph/tasks/run-state-service.ts:242) | **成功结果新增 `scope`，违反 rule 1 的字段存在性与键序要求。** 具体输入：`projectId='p'`、`workspaceId='w'`，principal/materialReader 均为同范围、actor 为 `human:h` 的合法 Host，signal 为正常 AbortSignal。旧结果键为 `ok,ctx,actor`；新结果为 `ok,ctx,scope,actor`，新增 `scope:{projectId:'p',workspaceId:'w'}`。当前消费者未使用此字段，尚未发现外部 DTO 改变，但内部成功协议确实变了。 | 从本地 `OwnedCtx` 和返回对象删除 `scope`，恢复原键序，同时移除无用类型导入。 |
| **不整洁** | [tasks/trusted-context.ts:35](D:/cxt/c1-g4-review/src/core/work-graph/tasks/trusted-context.ts:35)、[52](D:/cxt/c1-g4-review/src/core/work-graph/tasks/trusted-context.ts:52) | `allowArraySignal` 保住了当前行为，但把调用方差异搬进公共函数；[refresh TA-1:115](D:/cxt/c1-g4-review/.lead-ref/c1-refresh.out.md:115) 明确要求 signal 判断“这一步留在入口”。以后修改公共分支会同时影响多个入口。`label` 参数化则是明确授权，不应一并判违规；现有业务包装也仍在。 | 将 signal 判定留在各入口，以入口提供的判定函数接入原检查位置：scope 之后、身份克隆之前；移除业务布尔开关。 |
| **不整洁** | [tasks/completion.ts:105](D:/cxt/c1-g4-review/src/core/work-graph/tasks/completion.ts:105)；[tasks/execution-entry-service.ts:144](D:/cxt/c1-g4-review/src/core/work-graph/tasks/execution-entry-service.ts:144)；[交接报告:32](D:/cxt/c1-g4-review/.lead-ref/c1-g4-final.md:32) | **B 接线仍有明确清单内的同体副本。** nullable canonical：`completion.ts:105`、`control-service.ts:190`、`run-state-service.ts:119`；nullable JSON parser：`execution-entry-service.ts:144`、`plan-readers.ts:131`、`run-state-service.ts:122`；整数原语：`completion.ts:112/115`。通用 rejection 也仍重复，例如 `claim-service.ts:115`、`context-input-service.ts:106`、`initial-plan.ts:40`。这些不能用报告中的 “throwing refKeyOf / codec parsers / near-copies”解释。 | 按既定 B 清单补接 G1 实现，保留原签名、窄类型、各自 `current` 规则及固定业务包装；交接表准确列出剩余项。 |
| **不整洁** | [tasks/execution-entry-service.ts:1929](D:/cxt/c1-g4-review/src/core/work-graph/tasks/execution-entry-service.ts:1929)；[tasks/run-reconcile-service.ts:734](D:/cxt/c1-g4-review/src/core/work-graph/tasks/run-reconcile-service.ts:734) | 两处仍有 `R10 (review item 10)` 施工审查标签，TA-2 未完全收尾，违反 rule 5。 | 只删除该前缀，保留 RUN-21、原始 `endedAt` 和替换时间 `recordedAt` 的全部解释。 |
| **建议** | [交接接口表:17](D:/cxt/c1-g4-review/.lead-ref/c1-g4-final.md:17) | `terminalProposalOf` 签名准确，其他 helper 的返回形状也与代码一致，但表中省略了部分参数类型；`waitPredecessorWalk` 未写出异步签名，terminal 行未明确“调用方先过滤 superseded，保留 live/兜底”。 | 补全参数类型、`Promise<{waitingCycle:boolean} \| CoreRejection>`、TaskPhaseFacts 六字段及 G3 调用前提。同时修正报告“所有包装成功字段保持”的断言。 |

其余重点核对结果：

- **Trusted context / request isolation：**除上述 run-state 成功字段外，检查顺序和文本保持：空 context → scope → signal → 克隆 principal/materialReader → principal → actor → materialReader。claim 仍接受具有对应属性的数组 signal，其余三个拒绝数组。claim 成功键为 `ok,ctx,actor`；history 为 `ok,ctx,scope,actor`；entry 为 `ok,ctx,scope,actor,signal`。请求检查仍是 input → requestId → expected → 克隆，返回键仍为 `ok,input,requestId,expected`。run-state 原 `sameHostActor` 较宽，但前面的 actor 检查已限定 human/system，因此共享实现没有新增可达拒绝。[trusted-context.ts:40](D:/cxt/c1-g4-review/src/core/work-graph/tasks/trusted-context.ts:40)、[107](D:/cxt/c1-g4-review/src/core/work-graph/tasks/trusted-context.ts:107)

- **TaskPhaseFacts：**三个调用方均保留六个键及顺序：`taskKind,applicableReduction,selectedRun,originUnresolvable,round,coveringRequeue`；没有条件展开，也没有将 `undefined` 改成省略或 `null`。claim 的缺 Run/Reduction 检查、plan-readers 的额外读取保持。requeue 不接线正确：它判断 `reductionRevision === null`，helper 判断实际 `applicableReduction === null`；例如 revision 非空但 map 缺记录、selectedRun 为 null、phase 为 blocked，两式分别为 false/true。[task-phase-facts.ts:18](D:/cxt/c1-g4-review/src/core/work-graph/tasks/task-phase-facts.ts:18)、[requeue-service.ts:428](D:/cxt/c1-g4-review/src/core/work-graph/tasks/requeue-service.ts:428)

- **TA-4：**哈希输入仍精确为 `{planRef, consumerTaskId:edge.taskId, dependsOnId:edge.dependsOnId, requires:edge.requires}`。两个 task 服务保持 legacy→edge，assembler 保持 edge→legacy；entry 的 `schemaVersion !== 2` 门槛、consumer 和 requires 复制保持。assembler 的 diff 仅有允许的 import 和两处 ID 表达式，没有额外排序或枚举改动。[input-declaration-id.ts:9](D:/cxt/c1-g4-review/src/contracts/input-declaration-id.ts:9)、[execution-entry-service.ts:990](D:/cxt/c1-g4-review/src/core/work-graph/tasks/execution-entry-service.ts:990)、[context-input-service.ts:366](D:/cxt/c1-g4-review/src/core/work-graph/tasks/context-input-service.ts:366)、[context-assembler.ts:761](D:/cxt/c1-g4-review/src/core/agent-runtime/context-assembler.ts:761)

- **TA-10：**两个入口分别传原 `goalRef/predecessor`、`laterRef/earlierRead.goal`；seen 初始化、循环起点、`depth < 64`、每步读取及失败原样返回均相同，包括第 64 次迭代中原有的后继读取。capacity 文本仍为 `the wait-predecessor chain exceeds the 64-link read window`。[goal-settings-service.ts:104](D:/cxt/c1-g4-review/src/core/work-graph/tasks/goal-settings-service.ts:104)、[415](D:/cxt/c1-g4-review/src/core/work-graph/tasks/goal-settings-service.ts:415)、[789](D:/cxt/c1-g4-review/src/core/work-graph/tasks/goal-settings-service.ts:789)

- **已完成的 B 接线：**按 `StoreFailure` 联合允许的所有分支核对，错误码、文本、字段及键序一致。history/entry 的 unique glue 不读取旧实现也不消费的 claim-slot `current`；reason=`slot` 时，旧新均为 `busy`、`slot (the Kernel identity slot is held by another Run)`，无 `current`。pin decoder 保留 `{}`、重复项及顺序，跳过 null revision、坏 JSON 和非对象 ref；claim corrupt 仍无前缀。requeue 仍省略空 `current`。已切换的 primitive 未发现更严或更松判断；entry canonical 的成功字节与失败返回保持。[execution-history-service.ts:100](D:/cxt/c1-g4-review/src/core/work-graph/tasks/execution-history-service.ts:100)、[claim-service.ts:129](D:/cxt/c1-g4-review/src/core/work-graph/tasks/claim-service.ts:129)、[requeue-service.ts:187](D:/cxt/c1-g4-review/src/core/work-graph/tasks/requeue-service.ts:187)

- **范围、注释及交接：**提供的 diff 无白名单外文件、G1 模块、G5 K3 集合、`*-codecs.ts`、测试或 allowlist 修改。`goal-decision-reader` 仅在 [386 行](D:/cxt/c1-g4-review/src/core/work-graph/tasks/goal-decision-reader.ts:386)删掉注释中的 `K3`，`atLeastCursor` 原状保持。未发现删除规则、why 或状态机规则说明。静态生产引用核对支持仅剩 `okFalse`（G3）、`sessionStoreFailureToRejection`（G2）、两个 owner failure mapper（G5）未接；其余五个 G1 pending，以及 G4 新增五个 helper 均有生产调用。此结论不等于运行 production-reach 测试通过。

**G3 可否切换**

**可以替换终态选择循环，不能直接替换整个 view 分支。** [terminalProposalOf:762](D:/cxt/c1-g4-review/src/core/work-graph/tasks/plan-readers.ts:762) 与它替换的 plan-readers inline loop 完全一致。对照 [view:1613](D:/cxt/c1-g4-review/src/core/work-graph/views/decision-read-model.ts:1613)，区别如下：

| 项目 | 必须保留的 view 行为 |
|---|---|
| 输入 | helper 接收已过滤的 `heads`；view 的 `candidates` 还包含 superseded。必须保留 [1669 行](D:/cxt/c1-g4-review/src/core/work-graph/views/decision-read-model.ts:1669)的集合构造，并按原顺序过滤后传入。 |
| 优先与兜底 | 保留 [1667 行](D:/cxt/c1-g4-review/src/core/work-graph/views/decision-read-model.ts:1667) live 优先，以及 [1692 行](D:/cxt/c1-g4-review/src/core/work-graph/views/decision-read-model.ts:1692)“首个非 candidate”兜底；helper 本身没有这两项。显式 `proposalRef` 分支也保持原样。 |
| 比较与顺序 | 两者均调用同一 comparator；`planProposalRefKey` 就是原 canonical JSON。先比 since，缺失排前；since 相同再比 canonical refKey；**整个比较结果相等**才保留先遇到者。均严格 `>0`，不排序。 |
| 读取与返回 | helper 零 store 读取，返回原 proposal 引用或 null。view 原来的读取、解码、origin 提取和失败传播必须留在原处，读取次数才能保持。 |

直接传未过滤的 `candidates` 会改变选择：例如 `z` 为 `not_adopted`、`replacedBy=a`，`a` 为 accepted，两者 since 相同；旧 view 排除 `z` 后返回 `a`，未过滤的 helper 会因 refKey 较大返回 `z`。

会出错 1 项，不整洁 3 项。