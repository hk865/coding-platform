# R4b next Session 目录、固定 Kernel 映射与原历史读取

状态：本页创建/目录/原历史/重试子集已独立验收，见 [本轮报告](../reviews/next-r3c-r4b-2026-09-24.md)；完整R4执行/维护仍未完成。目标工程是 `coding-platform/next/`；原 `src/` 仅供行为核对，受管 Kernel 冻结源码不改。

## 可交付边界

WorkGraph `sessions/` 是平台 SessionRecord、创建操作、SessionWorkLink 与目录索引的唯一正式写者。Runtime `session-operations.ts` 只协调 `admitSessionCreation → Kernel Store.create/get → recordSessionCreated`，`kernel-store-locator.ts` 只解析受信配置的 adapterId、数据库位置与原历史。Host 负责注入受信身份、配置、句柄生命周期并接创建、目录、历史三条入口；本批不进入模型，不创建 Run/QueryRun，不占用执行槽，不宣称连续 Context 已接通。正式执行与共同占用属于 R4c，维护属于 R4e。

平台 `SessionRef = {projectId,sessionId}`，持久引用加 `aggregateType:'Session'`。Kernel 映射键为 `{adapterId,kernelSessionId}`；adapterId 指向一个稳定的**存储实例**，不只是适配器类名。新 Session 根据受信 workspace 配置选择稳定 SQLite 库；旧每 Run 分库只凭可核对的真实 locator 读取。两个库里的同名 kernelSessionId 不能合并。路径不接受客户端或模型指定。

创建命令的 requestId 在可信 Host actor + 项目作用域内与请求指纹共同定位同一个持久 OperationRef 与 planned SessionRef。重放返回原 operation/ref，内容变化返回 idempotency_conflict。`admit` 原子记录请求、稳定 ID、workspace、role、推荐来源、初始关联意图与 Host 选定的 kernelStore(adapterId/storeKey)；此时没有可领取 SessionRecord，也没有已生效关联。Kernel 创建使用同一固定 sessionId/recordId；响应丢失先 `get` 并核对原身份。Kernel 创建成功而 WG 登记失败或进程崩溃时，重开同一操作，核对固定身份后补 `recordSessionCreated`。不能证明时保留 accepted/unknown，不能随机新造一条或登记假映射。

`recordSessionCreated` 在一个 WG 提交中校验原操作、planned ref、workspace、真实 adapter 身份与唯一反向映射，再写 SessionRecord、初始链接、目录索引、操作完成；并发登记至多一方获正式映射，同请求重放回原结果。生命周期 `active/archived`、健康 `available/recoverable/unavailable`、判别 `execution/maintenance` 占用、lastExecutionRef 只采用共享合同字段。本批新创建记录为 `active/available/occupancy:null/lastExecutionRef:null`，不能把这些初值当已支持 claim 或 Run 的证据。关联 since 必须绑定本次真实 commit cursor，不预猜或二次补写。

目录查询按受信 project/workspace、可选 target/role 与 includeArchived 过滤，并以稳定索引及绑定过滤条件/水位的 cursor 有界分页。现有 `RecordLookupPort` 可作为候选索引，WG 复核正式记录；不为目录再造全库索引引擎。planned ref 不出现在可用目录。跨项目/工作区读取拒绝或返回无可见项，不能借 Session ID 枚举。历史由 Runtime 使用映射后的原 Kernel SessionStore 分页读取，游标绑定 adapterId、kernelSessionId、首次读取时的记录上界与位置；每项经公开 `sessionRecordSchema` 验证，不经恢复入口，不新建 Run，不调用模型，不复制原日志到平台。位置 1 的 `session.created` 是原历史记录，不是已完成 turn 的连续 Context 游标；新空 Session 的 `SessionRecord.historyCursor` 为 null。损坏/缺失历史明确返回 unavailable/not_found，不降级为空历史。

## 接口冻结与 Store 门槛

按 `modules/core/work-graph.md` §6.1 的 `SessionDirectoryPort` 与 `modules/core/agent-runtime.md` §4/§8 的请求/历史形状定义最小 R4b 子集；其余维护与执行方法仍 unsupported 或不可调用。新增 `sessions/contracts.ts` 和独立 Runtime 文件可以先落骨架，但不提前改共享 `contracts/core/{identity,session,operations}`、`record-store/ports.ts`、通用 codec 注册、组合根或 Store 后端。主 Agent 负责这些公共文件的接口冻结与集成次序。

初次骨架时 `next` RecordStore 尚未支持所需原子扩展；现已独立接入非空 claims、ledgerHorizon、commitCursorBindings（indexChanges 仍为空，仅用已注册 lookup）。单靠 `readMany+commit` 无法原子维护 Kernel 唯一映射、目录索引和带提交游标的链接。因此正式实现需要两后端同语义的条件唯一 claim（`expectedOwner` 原子检查）、现有注册 lookup 的目录候选、真实 commit cursor 绑定和原收据恢复。范围水位按受理所需使用 `ledgerHorizon`。不能用进程内 Map、先查后写、事后修链接或全表扫描伪装通过。若公共能力尚未落地，骨架显式返回 unsupported；不假成功。

Runtime 需受信 `KernelStoreRegistry` 将 adapterId 持久对应真实 `kernelStoreKey`/数据库位置，负责 `SqliteStores.open` 和句柄关闭。Host 启动固定注册 `{adapterId,storeKey,workspace,databasePath}`，规范化并拒绝同库不同 adapter、同 adapter 多库及同 workspace 多库；请求不接受数据库路径。稳定性包含进程重启及不同 workspace；既有 per-Run locator 只读且要核对记录中的真实数据库/session 对应关系。Kernel 创建/get 的确切 `SessionStorePort` 形状以冻结 public 构建为准，不使用私有源码入口。

## 验收

使用真实 Memory 和 SQLite RecordStore、真实 Kernel SQLite SessionStore 与本地可控数据，验证同请求重放与异请求冲突、并发唯一登记、创建响应丢失、Kernel 成功后 WG 失败再重开、不同库同 SessionId、范围隔离、目录有界分页与 cursor 失效、无 Run 原历史分页、旧 per-Run locator、缺失/损坏 fail closed、Host 句柄关闭。测试还应断言创建过程模型调用数为零，且 planned ref 无法被当成已映射 Session。只对真实支持的路径宣告 PASS；未实现的公共 Store 能力维持明确失败测试和待办，不用 fake 证明两后端持久保证。

## 分 lane 文件所有权

- **WG Session lane**：只改 `next/src/core/work-graph/sessions/{session-directory.ts,session-record-codecs.ts}`，必要时新增纯 `session-commit-compiler.ts`；`sessions/contracts.ts` 已冻结只读。测试由 Sol/主审拥有，DSH 只读。实现正式 admit/record/read/find、同请求恢复、唯一 Kernel claim 与游标绑定。不要加无逻辑的纯转发 repository。
- **Runtime Session lane**：只改 `next/src/core/agent-runtime/{kernel-store-locator.ts,session-operations.ts}`，若游标规则确有复用才新增 `session-history-cursor.ts`；对应 runtime 测试由 Sol/主审拥有，DSH 只读。在 WG lane 可用后接 Kernel 固定身份与首记录核对、无模型创建、原历史读取、重试/丢响应和旧 locator。生产 Host 接线由主 Agent 集成。
- **主 Agent / Store lane**：共享 `contracts/core/*`、`record-store/*`、通用 schema 注册与组合根；WG/Runtime 两 lane 不改。Store 机械实现 `UniqueClaimChange.expectedOwner`、已注册 lookup、`ledgerHorizon` 和 `commitCursorBindings`。WG 的 SessionWorkLink schema 声明 `commitCursorFields: ['since','until']`，最终记录校验非空真实游标。

当前骨架节点的验收红测按 WG/Runtime 两文件分开；它们在两种真实后端上以 `unsupported` 失败，不能标记为已交付 Session 能力。`R4b-session-skeleton.test.ts` 仅验证可用的冻结 Kernel/受信 registry 边界。

依据：`refactor-plan.md` R4b；`modules/core/work-graph.md` §6.1；`modules/core/agent-runtime.md` §4/§8；`skeleton/CONTRACTS.md` §6；`skeleton/END-TO-END.md` 路径 B/C。

## 主审冻结（2026-09-24）
shared Session/Operation 身份及 Store 原子扩展已冻结。Graph目录sourceCursor为平台CommitCursor；Runtime原历史输出为共享Page<SessionHistoryEntry>，basis.kind=session，是Kernel历史位置水位。两者不得互换。plannedSessionRef是普通SessionRef（不含aggregateType），正式记录才用SessionAggregateRef；都必须核对project/workspace/role/target交叉scope。initialLinks在同一正式提交绑定真实since，schema严格验证最终形状。图目录lookup与Store claims所有权分离，不能先查后插做唯一保证。
平台不直接读Kernel私表；历史page的物理性能受当前冻结Kernel read实现限制（当前每页内部加载全Session再slice）。本批不声称已消除这个成本，后续Kernel公开分页优化单独验收。旧库只读不能靠新建一个空库掩盖缺失，缺失要明确失败。
创建流程需要测试真正的副作用后异常/登记前失败，不仅测试完整成功后的再调用；fixed IDs必须可从原Operation稳定恢复并核对首记录。API只是可信内部工具边界，Model不能直接选择adapter/path或填写created证明。派发/执行/角色授权策略不在本批偷渡实现。

第二轮主审补充：初始Task关联须核对真实Goal/activePlan成员并guard；Module/WorkContext关联在R3d正式目标reader接通前返回unsupported。命令身份绑定可信Host actor，Operation读取及重放核对原workspace；目录分页不能静默漏行/截断关联。原历史limit限制1..200，basis为平台SessionRef，cursor还绑定可信主体。无上下文调用原来骨架测试期望unsupported，能力实装后主Agent将该断言改为forbidden，仍验证不触碰持久化；实现Agent无权改测试。

第三轮主审补充：受理的 create action 持久保存 Host 提供的 `kernelStore:{adapterId,storeKey}`。公开 Runtime 创建请求不接收此字段。路由建议不属于业务幂等指纹，重放沿原 action 固定目标；仅首次新受理采用当前配置。恢复按原 adapterId 定位并核对 storeKey/workspace/current；原实例未注册时拒绝，不能在新默认库另建同名 Session。登记结果 adapterId 必须与持久 pin 一致。

历史 cursor 是内部查询书签，不是权限证明或签名凭证；每次读取仍核对当前可信身份和 Session 范围。正常续页保持首读上界，畸形/不匹配 cursor 拒绝。本批不新增签名密钥或 cursor 数据库。

冻结Kernel限制：`SqliteStores.open(path)`没有物理readOnly选项，会执行初始化/pragma。本批legacy reader只暴露get/read，不调用create/append；不能据此宣称SQLite文件以OS只读方式打开。缺失路径会在打开前拒绝。若要求只读介质/绝不改变已有文件，需后续Kernel公开只读打开能力，平台不绕过公开API私读SQL。
