# R4.3b：普通取消后的原历史与后继上下文

状态：2026-09-27，14路径骨架已[冻结导入](../reviews/evidence/next-b2-2026-09-26/r4-terminal-history-skeleton-import.json)，后续六生产实现及空消息壳精修也已[独审导入](../reviews/evidence/next-b2-2026-09-26/r4-terminal-history-implementation-import.json)。最终固定15项、types、28产物逐字再生通过；原历史/推理/真实结果保留，取消后同Session第二正式Task实际消费前缀已通过。下文首红与待导入记录均为原骨架前态，不要求重开施工；恢复等未完成范围不变。

## 1. 具体问题与同一个解决位置

当前 Kernel terminalState 会把未开始的 pending 调用标为 abandoned，并保留真实已有结果；Session history 的 restoreSessionHistory 仍直接对 state.transcript 做严格工具配对，因此普通取消后包含 abandoned 声明的历史不能进入下一个合法 Turn。只放宽平台释放而不接 Kernel 历史消费会交付无法继续工作的 Session。

在原 session-history.ts 声明并最终实现一个纯函数 `projectTerminalTranscript(state: Readonly<RunState>): TranscriptEntry[]`，公开 public-api re-export，平台原 observer 与 Kernel restoreSessionHistory 共同复用。该投影只用于后继模型上下文和原 observer 的可消费性判断。**原 SessionRecord、归约 RunState、原文 UI/原始推理/工具声明和结果全部保留，不把投影冒充历史原文。** 最新用户历史展示纠偏同样适用。

## 2. 最小算法约束（阶段二实现）

仅接受真实 terminal、无 activeModelRequest、无 pending/running/outcome_unknown 的归约状态；同时拒绝 transcript 中正式 error.code=outcome_unknown 的工具结果，不能以 toolBatch 已清空证明结果已知。复用原状态和 error 枚举，不递归猜错误、不再解析材料/Role/全图。

从实际 toolBatch 中的 abandoned 调用取得可省略声明的 callId，仅在返回副本的 assistant_message.toolCalls 中移除没有结果的这些调用；assistant message 原 content/reasoningContent 等不变，实际已结算结果及对应声明保留。缺失结果且没有 abandoned 事实仍由原 assertTranscriptExchangeIntegrity 拒绝。不得为 abandoned 造 success/error/cancelled ToolResult，不能修改 caller 借入对象。

restoreSessionHistory 在每个终止 Turn 消费同一投影并沿原精确 throughPosition 拼接，最终仍执行原严格配对。位置连续、Session/Run/Turn 身份、边界及当前 Turn 排除逻辑保持。原 observer 在 R4.3a 已有本地退出/资源清理确认后复用该函数，再沿现 recordRunResult/完成 cursor 提交；不新增历史游标、控制状态或日志扫描器。unknown 继续保留占用并拒绝后继恢复。

## 3. 两阶段与精确范围

拟 12 生产路径：新增受管 session-history.ts＋其已有4产物、原受管 public-api.ts＋其4产物、build-kernel-patch.mjs 的显式源名单、原 execution-observation.ts。机器范围见 [scope](R4-terminal-history-skeleton-scope.json)。只从冻结 map 提取受管源码，原 Kernel 工程只读；主审记录提取来源 SHA 与原产物基线，再开放明确文件。生成物只由原脚本产生，不能手改 dist；原六受管源及其余产物不漂移。

阶段一只发布函数签名、公共导出、必要消费者接缝与最终正常链测试，新 projector 明确抛 StoreError(version_unsupported)。尚不接管旧正常 terminal 的已实现配对路径，不能把所有既有 Session 历史退回 unsupported；新增 abandoned 分支首红于新接缝后 STOP。主审中审冻结后另发阶段二实现；内部 projection 算法不得提前完成来绕过骨架审核。

测试仅 `tests/kernel/R4-terminal-history.test.ts` 新正常 Kernel 链＋现 `tests/runtime/R4-control-runtime.test.ts` 追加一个对应平台消费者，不改旧案例、共享 fixture 或矩阵：真实模型声明两个串行组，第一组确定结算，取消后第二组未 started且由原 reducer 标为abandoned；原历史仍含声明，平台正式取消释放，同 Session 下一个合法 Task/Turn 读取原前缀，实际 provider 接到匹配上下文而不是伪结果。Kernel 层核纯副本与原记录保留；平台层核既有控制/释放/后继消费接线，不复刻原 R4.3a 的所有竞争排列。真实 started＋outcome_unknown 的原 R4.3a 反例复用；仅补本新增消费分支仍拒绝未知的对应断言，不能直接构造 ToolResult 冒充真实 drain 超时。

固定检查由主审派发时注册一个两文件目标；types、Kernel 28项产物逐字再生分别运行。只因实际共享历史行为改动补原 session-history 定向集合，不重跑整个权限/Store矩阵。完成正确 unsupported 首红、类型与产物再生后STOP，如实列未到达的后继段；主审独立review/audit/精确导入后才进入实现。

提取前已核的 session-history map 嵌入源 SHA-256：`964a9f51b2e124d7f834074e1f2900eaf326b7d5cea5ff49bf23c78d9aff5639`。这是读取时来源，不是已提取或实现的声明；派发前重新对账，原多源再生脚本结构不另建。

## 4. 本次 Stage1 派发冻结

派发前再核 `dist/core/ports/session_store/session-history.js.map` SHA-256 为 `dc34ab0ae7eb2cd94da6fee224451b48c7876bb5eabbd7f43bd28de38180fbd6`；`sourcesContent[0]` UTF-8 SHA 精确为上文 `964a9f…f5639`，已不作编辑提取到受管 source。新 Kernel 测试只有一行挂载占位，SHA `cb3d832cb37705fc463c42a5dbe265a23cbcbbac4123742c8afa4d6cc272cbb8`，不是已有测试。详见 [准备证据](../reviews/evidence/next-b2-2026-09-26/r4-terminal-history-skeleton-preparation.json)。harness prepare 此后才能捕获原文/占位基线，不修改任何 manifest 来掩盖变更。

当前 R4.3a observer SHA 为 `087f9ed3b843c033d9571e9e7ae7210b56ddb2d66ab72dc45d2c4f7336e17457`：有真实 Kernel exit/cleanup proof、原 terminal pending 保存、原控制 source cache/ack 与 finishing context，全部保留。当前旧 unknown 分支包含 abandoned、turnIsComplete 也拒绝 abandoned；阶段一仅给正常已 terminal、真实 abandoned 分支接新 projector 的显式 unsupported 接缝，不得把未知副作用放行，不能让 old early return 遮住新骨架首红，也不能提前实现过滤算法。

- 新函数签名 `projectTerminalTranscript(state: Readonly<RunState>): TranscriptEntry[]` 明确抛原 `StoreError('version_unsupported', ...)`，公共导出仅从既有受管 public-api 加同一符号。
- Kernel restore 与平台 observer 仅为新增 abandoned 消费路径接骨架；没有 abandoned 的旧正常终态继续原已实现配对路径，不整体回退 unsupported。原持久记录/归约输入不可改写。
- 新正常 Kernel 流程和 Runtime 对应追加流程按 §3；原 R4.3a 三案例的执行流程/断言不删改，不造 synthetic unknown。若为新增 projector 补 unknown 拒绝断言，仅复用旧真实 drain case 已读的原 SessionRecord，经既有 reducer 得 state 后追加读取断言，不再执行第二轮未知场景、不弱化原断言。
- 生成物只由同一 `scripts/build-kernel-patch.mjs --write` 写出。该脚本原六源保持，仅加入提取的 session-history；28 项产物独立 `--check` 必须逐字匹配。除 public-api 与新 session-history 的八产物，其余旧20产物 hash 应保持；不得修改原 Kernel 参考工程或手写 dist。
- 固定两文件目标：`python3 tools/dsh-refactor/check.py next-terminal-history`（新 Kernel 1 正常链＋原 Runtime 3 案例及追加 1 对应链）；分别执行 `next-types` 与 `next-kernel-patch`。旧普通历史消费若接缝实际触及，只用原 `next-frozen-kernel` 中 session_history 相关定向案例，不扩整套权限/Store/恢复矩阵。新两条首红必须实际到 StoreError version_unsupported 新接缝，如实注明未到后继段。

只写 scope 固定 14 路径，与 R6 当前六生产路径无交集。不得修改 tools/check、其它测试或补框架。完成签名/导出/窄消费者接缝/真实正常链、types 和 28 产物再生后交付 hash 与首红位置，立即 STOP，等 root 中审冻结后另派算法实现；DSH 不导入。

## 5. 骨架 STOP / 独立中审交付（未导入）

Lane `r4-terminal-history-skeleton-20260926`，fresh session `session-a31a9261-27dd-4a32-8565-31d07a005ccd` 已 exit0 STOP。独立目标为 3 pass / 2 正确首红，均来自新 projectTerminalTranscript 的 StoreError(version_unsupported,status=cancelled)；types pass；7 源 28 产物全部逐字匹配，原其他20受管产物 hash 不变；audit outsideScope/originalWorkspaceChanged 均空。旧 Runtime 三案例正文未变，仅 imports 与新 case 追加。

完整 [中审证据](../reviews/evidence/next-b2-2026-09-26/r4-terminal-history-skeleton-review.json)、[候选 diff](../reviews/evidence/next-b2-2026-09-26/r4-terminal-history-skeleton.diff)、[14 路径 hashes](../reviews/evidence/next-b2-2026-09-26/r4-terminal-history-skeleton-candidate-hashes.json)、[28 项产物](../reviews/evidence/next-b2-2026-09-26/r4-terminal-history-skeleton-repro.json)已落盘。

交主审核定的窄问题：新增 Runtime 的后继尾部仍直接 runCodingAgent，须接正式下一 Task claim→prepare→start；新 Kernel 投影 assistant 缺失分支须先断言存在；按原任务在既有真实 drain 原状态上补 projector 拒绝 unknown 的读取断言，不另造执行/矩阵。另新授权 public export 对原 B2 导出白名单有预期影响，DSH 未越 scope 修改；主审需同步允许 projectTerminalTranscript 这一符号。原两个首红之后的产品尾部尚未到达，不以骨架首红当作已通过。

未实现 projector 算法、未导入 lane 文件、未更改 manifest 原基线，等待 root 中审冻结。

## 6. 主审批准的骨架测试精确收敛（当前唯一执行节）

原 lane `r4-terminal-history-skeleton-20260926`、session `session-a31a9261-27dd-4a32-8565-31d07a005ccd`。**仅改原 scope 内两个测试文件**：`tests/kernel/R4-terminal-history.test.ts` 与 `tests/runtime/R4-control-runtime.test.ts`。当前生产骨架无算法返修要求，其余12文件 hash 冻结；不改其它测试、共享 fixture、工具脚本或 manifest，不新建 case/执行轮次/矩阵。

1. 新 Runtime case 的后继尾部删除直接 `runCodingAgent`、手填 executionIdentity/throughPosition/Kernel配置的段落。使用同一 fx 现成正式路径：`fx.claimFixture.tasks.second`、`fx.claimFixture.buildRequest` 构造当前 pins 与同一 `fx.claim.sessionRef` 的下一 Task 请求，经 `fx.deps.claims.claimTask`（或同一个既有 TaskClaimPort）正式领取，随后 `fx.allowRun(newRunRef)` 为该真实 Run 绑定同一受信 Host fixture，再用原 runtime.port.prepareExecution / startRun。不要 raw seed Run/Task、改 store、制造新 Session；Role 仍原绑定。后继 actual provider 的声明/结果匹配断言、原取消释放/占用/回执断言保留；核原 Session 新 Turn 和保存的取消原始前缀未改。现 `R4-control-runtime-platform.test.ts` 的 secondClaim 只读可复用做法，不改该文件。
2. Kernel 新 case 在 `projectedAssistant` 缺失会 early return 之前增加明确存在/assistant_message 断言；保留后续已结算 g1、未开始 g2、原 content/reasoning 与借入 state 未修改的原断言。不要新增测试。
3. 原真实 unknown case 已通过实际 drain 得到 SessionRecords。仅在原全部断言后，用已读取的这些真实 records 与原公开 `createInitialRunState/reduceRunState` 重建同一 Run/Turn state，追加 `projectTerminalTranscript` 拒绝未知结果的断言，明确合法未知状态导致原 `StoreError` 的 conflict，不造 ToolResult、不得重新跑未知场景。现 projector 骨架抛 version_unsupported，因此本新增断言可以使原 unknown case 多一个正确预期首红；如实报告 2/3 首红数，不为凑 2 红放宽预期。原占用/Lease/ack断言必须仍先执行且保留。

新公共符号白名单 `B2-history-public-export.test.ts` 的一行机械更新由 root 在最终 scope审计通过并导入时负责；本 lane 不改它，不通过修改 manifest 规避越界。阶段二任务/六生产scope由 root 已准备，当前不得实现 projector 算法。仅重跑原固定两文件目标、types 和28产物再生后 STOP，报告首红位置、只两文件差异与最终14 hashes。完成后可中审冻结进入实现，不再扩验收。

## 7. §6 收敛后独立验收（待 root 冻结/导入）

原 session 的 `attempt-1790438056724534052` 已 exit0 STOP。仅两个测试变化：Kernel `cdd75d64a937a295e4075629937ba7db0550bf275830bb9d200568b93a205985`；Runtime `cbd89f515cfb1df72a0784ea0d60b84f1398700a5618782e0ff2e35529aa0838`。其余12生产候选 hash 冻结，manifest.originalAllowedHashes 与提取后准备证据逐字相同，原工作区14路径仍匹配基线。

独立 next-terminal-history 为 2 pass / 3 首红：新 Kernel 与 Runtime abandoned 接缝均为原 StoreError(version_unsupported)；原真实 drain case 原占用/Lease/ack断言先通过，新增 projector code=conflict 目标收到 version_unsupported 是第三个预期首红。没有为凑红数弱化断言。next-types exit0；7源28产物逐字匹配；audit outsideScope/originalWorkspaceChanged 均空。正式 second Task 的同Session claim→prepare→start 后继段已接入，但仍在骨架首红之后，未宣称尾部通过。

[最终中审证据](../reviews/evidence/next-b2-2026-09-26/r4-terminal-history-skeleton-final-review.json)、[最终差异](../reviews/evidence/next-b2-2026-09-26/r4-terminal-history-skeleton-final.diff)与[最终14哈希](../reviews/evidence/next-b2-2026-09-26/r4-terminal-history-skeleton-final-candidate-hashes.json)可供root冻结。未导入、不再扩测试；新公共导出白名单一行仍由root在精确导入后机械更新。Stage2按既有六生产scope另派，全部terminal经共享投影以拒绝unknown；本阶段正常旧恢复路径不回退 unsupported。
