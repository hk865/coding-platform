**27 个 K 条目仍成立，没有一项被 K3 完整消除；16 个撤出项不恢复。** K3 增加了可复用助手，也增加了同类副本。`atLeastCursor` 仍未修复。

以下为只读核查结果：未写文件、未运行测试。只使用 `.lead-ref/c1/` 中的输入和当前源码，没有读取其他 `.lead-ref/` 文件。本副本没有 Git 元数据，“K3 新增”依据给定文件清单、原报告和代码中的明确 K3 标识判断，不冒充逐提交 diff。

行数均为**预计净减生产代码行数**，扣除助手、导入和包装；不计测试。新增接线并入对应旧项，独立的新增读取合并另记 **N12**。

**一、27 个 K 条目的逐项结论**

共用项：

| 条目 | 当前定位与结论 | K3 助手及应改的方案 | 原估算 → 当前 |
|---|---|---|---:|
| XX-1 原语 | 仍成立。例如 `src/core/work-graph/communication/decision-service.ts:53`、`src/core/work-graph/tasks/unknown-call-review-service.ts:299`、`src/core/work-graph/tasks/run-reconcile-service.ts:143` | 已有 `src/core/work-graph/tasks/codec-fields.ts:14` 的对象、非空串、整数、字段集合等助手。复用其实现；跨层部分下沉到 `src/contracts/validation/common.ts:11` 所在公共层，原导出保留别名。增加本轮确认的 K3 接线，包括同形 SessionRef 校验，见下表 | 320–360 → **355–410** |
| XX-2／SE-1 事件外壳 | 仍成立。旧外壳见 `src/core/work-graph/configuration/project-bootstrap-record-codecs.ts:383`、`src/core/work-graph/sessions/message-record-codecs.ts:1188`；新增两份见下表 | K3 没有公共事件编码器。仍拟增 `persistence/event-envelope.ts`；保留领域出口、属性顺序和原始 `JSON.stringify(event)` | 190–225 → **200–237** |
| XX-5 nullable canonical | 仍成立：`src/core/work-graph/communication/decision-service.ts:66` | 已有 `src/core/work-graph/tasks/codec-fields.ts:53`。将这一实现归入 `src/contracts/fingerprint.ts:25` 所在模块，原名转出；不要改直接抛错的 canonical 包装 | 90–105 → **96–112** |
| XX-6 nullable 对象解析 | 仍成立：`src/core/work-graph/materials/run-snapshot-decoder.ts:23`、`src/core/work-graph/persistence/execution-entry-codecs.ts:709` | 已有 `src/core/work-graph/tasks/codec-fields.ts:45`；下沉并复用。`src/core/work-graph/tasks/decision-source-identity.ts:18` 的内部解析也可接它，但保留外层参数检查和 `kind` 检查 | 75–90 → **85–104** |
| XX-7／TA-7 失败映射、pins | 原项仍成立：`src/core/work-graph/communication/mailbox-service.ts:177`、`src/core/work-graph/tasks/claim-service.ts:141`、`src/core/work-graph/tasks/execution-entry-service.ts:158`、`src/core/work-graph/tasks/execution-history-service.ts:107` | `src/core/work-graph/persistence/read-result-failures.ts:30` 仍只有通用读映射。K3 的 UCR／CRR／receipt 又有一套相同映射，应另建命名明确的公共函数，不能混进原四服务或 execution 映射 | 80–100 → **100–126** |
| 拒绝结果助手 | 原项仍成立；新增见 `src/core/work-graph/tasks/unknown-call-review-service.ts:308`、`src/core/work-graph/tasks/task-review-reader.ts:23` | codec-invalid 已有 `src/core/work-graph/tasks/codec-fields.ts:60`，应下沉复用。Core rejection 仍按“无 current／有传入 current／省略空 current”等形状分别提供；保留固定业务文字包装 | 100–140 → **108–152** |

不能让 persistence、state 反向导入 tasks；当前依赖限制分别见 `docs/refactor/module-target.json:42`、`docs/refactor/module-target.json:36`。所以这里的“复用”是**搬用已有实现并保留出口**，不是让所有调用方直接 import `tasks/codec-fields.ts`。

区域内条目：

| 条目 | 当前定位 | 当前裁定、助手复用和边界 | 原估算 → 当前 |
|---|---|---|---:|
| TA-1 可信上下文／请求隔离 | `src/core/work-graph/tasks/claim-service.ts:522`；`src/core/work-graph/tasks/execution-entry-service.ts:237`；`src/core/work-graph/tasks/execution-history-service.ts:151`；`src/core/work-graph/tasks/run-state-service.ts:204` | 仍合并共同骨架。K3 没有另一个适用的通用 context helper；保留 entry 的现有导出包装。claim 的 signal 允许数组形对象，另外三份排除数组；检查顺序、克隆失败文字和成功字段不能统一 | 100–140 → **100–140** |
| SE-2 邮箱分页 | `src/core/work-graph/communication/mailbox-service.ts:2231`、`:2303`、`:3123` | 仍抽本文件分页校验和数值水位助手。`lookupAll` 是读完整索引并重试的另一协议，不能替换。继续保留各读口错误文字、limit 1–100 和 null 水位规则 | 45–65 → **45–65** |
| SE-5 当前来源／历史答案读取 | `src/core/work-graph/communication/decision-source-facts.ts:231`、`:252`、`:937`、`:968` | 仍抽本文件读助手。K3 的 `decision-answer-lookup.ts:31` 查的是答案索引，`receipt-replay.ts:101` 处理回执重放，均不能替换这里。保留 missing 与未报告遗漏的区别 | 30–45 → **30–45** |
| PE-2／PE-3 带标签解析、事件校验 | `src/core/work-graph/persistence/record-codecs.ts:100`；`src/core/work-graph/persistence/decision-record-codecs.ts:124`、`:136`；`src/core/work-graph/persistence/line-settings-codecs.ts:94`、`:109` | 仍成立。K3 nullable 解析不能替换带两种错误文字的解析器；`codec-shape-checks.ts` 也不是事件外壳／actor 校验器。沿原方案抽取，保留正文检查顺序和 line 的 null proof 要求 | 50–70 → **50–70** |
| TA-4／VW-4 输入编号 | `src/core/work-graph/tasks/context-input-service.ts:368`；`src/core/work-graph/tasks/execution-entry-service.ts:1076`；`src/core/work-graph/views/graph-context-reader.ts:905`；`src/core/agent-runtime/context-assembler.ts:760` | 仍只抽 `edge:`／`legacy:` 编号。K3 没有替代助手。lead 合并修复后的 assembler 仍是先 edge 后 legacy；两个 task 服务顺序不同，不能合并整个枚举函数 | 15–25 → **15–25** |
| TA-5 TaskPhaseFacts | `src/core/work-graph/tasks/claim-service.ts:256`；`src/core/work-graph/tasks/completion.ts:148`；`src/core/work-graph/tasks/plan-readers.ts:2147`；`src/core/work-graph/tasks/requeue-service.ts:432` | 仍只抽纯拼装。K3 的 `taskClosureOf`（`src/core/work-graph/tasks/plan-readers.ts:1921`）算关闭原因，不能替代 phase facts。requeue 仍判断 `reductionRevision===null`，不接统一公式 | 10–15 → **10–15** |
| TA-10 等待链 | `src/core/work-graph/tasks/goal-settings-service.ts:383`、`:770` | 两份遍历仍在。K3 抽出的 `src/core/work-graph/tasks/revision-guard.ts:22` 只管版本 pin；等待链仍需局部助手。64 链、读取顺序和 capacity 文字保持 | 10–14 → **10–14** |
| ST-1 message／plan 重复类型 | `src/core/work-graph/state/message-machine.ts:71` ↔ `src/core/work-graph/model/communication-contracts.ts:43`；`src/core/work-graph/state/plan-machine.ts:67` ↔ `src/core/work-graph/model/plan-contracts.ts:35` | 仍以 state 记录类型为唯一声明，model 保留别名／转出。Host sender 已共享；不再计一次。字段规则说明须迁到唯一声明处保留 | 90–115 → **90–115** |
| ST 补充一 dispatch／outbox | `src/core/work-graph/state/attempt-machine.ts:51`、`:61` ↔ `src/core/work-graph/model/claim-contracts.ts:97`、`:107` | 同形重复仍在；V2 已从 contracts 转出，不能另造。保持 V1/V2 union 和可选 dispatchState | 16–20 → **16–20** |
| ST 补充二 entry permit | `src/core/work-graph/state/run-machine.ts:360` ↔ `src/core/work-graph/model/execution-entry-contracts.ts:38` | 五字段仍重复；仅改别名。Kernel binding 两边已经共享，不计收益 | 5–7 → **5–7** |
| ST-6 预算条件 | `src/core/work-graph/state/task-machine.ts:668` ↔ `:1233` | 仍把前者改调现有 `requeueBudgetIncreased`。不删构造器校验，不调换 transition 检查 | 1–2 → **1–2** |
| ST-7 递归 ref 比较 | `src/core/work-graph/state/session-anomaly.ts:93` ↔ `src/core/work-graph/state/session-availability.ts:1047` | 仍抽独立递归比较。K3 没有等价公共版本；不能换 canonical 比较，也不能换只比较三个字段的 RunRef 比较 | 10–12 → **10–12** |
| VW-5 终态候选选择 | `src/core/work-graph/tasks/plan-readers.ts:731`、`:745` ↔ `src/core/work-graph/views/decision-read-model.ts:1669`、`:1675` | 仍抽终态选择助手。K3 `lookupAll` 只替读取，没合并选择。保留 chain position、严格 `>0`、相等保留先遇到者；live 与后备分支留原处 | 12–18 → **12–18** |

注记补审中的三个 K：

| 条目 | 当前定位 | 当前裁定 | 原估算 → 当前 |
|---|---|---|---:|
| N1 补审原语 | `src/core/work-graph/architecture/file-graph-index.ts:44`；`src/core/work-graph/notes/note-anchors.ts:584`；`src/core/work-graph/notes/note-service.ts:106`、`:328`；`src/core/work-graph/persistence/note-record-codecs.ts:118` | 仍接 XX-1 的公共实现，不再造助手。`src/core/work-graph/notes/note-read-model.ts:117` 的严格键数版本继续排除 | 20–25 → **20–25** |
| N5 anchor／路径前缀 | `src/core/work-graph/notes/note-related-scope.ts:81`、`:86`；`src/core/work-graph/notes/note-read-model.ts:305`、`:689`；`src/core/work-graph/notes/note-service.ts:1314`；`src/core/work-graph/views/note-views.ts:1061` | 仍保留 related-scope 实现并导出。K3 没有替代；槽位顺序、仅排除 null、目录边界和 `anchor_not_found` 不变 | 5–8 → **5–8** |
| N8 注记应用输入类型 | `src/core/work-graph/model/note-contracts.ts:197` ↔ `src/core/work-graph/model/decision-contracts.ts:202` | 仍引用 `NoteDecisionApplicationInputV1`。decision 已从 note-contracts 导入类型（`:50`），沿这个方向即可，不增加反向依赖 | 2–3 → **2–3** |

五个 K 注释项也全部保留，当前估算如下；新增块数和例子见第五部分。

| 条目 | 当前代表位置 | 原估算 → 当前 |
|---|---|---:|
| TA-2 tasks | `src/core/work-graph/tasks/plan-service.ts:18`；`src/core/work-graph/tasks/codec-fields.ts:1` | 60–90 → **85–125** |
| VW-2 views／queries／model | `src/core/work-graph/model/claim-contracts.ts:91`；`src/core/work-graph/model/command-rerun-request-contracts.ts:1` | 45–70 → **48–75** |
| SE-4 communication／configuration／sessions | `src/core/work-graph/communication/mailbox-service.ts:150`；`src/core/work-graph/sessions/message-record-codecs.ts:1252` | 40–65 → **40–65** |
| PE-1 persistence／materials／evidence | `src/core/work-graph/persistence/execution-history-codecs.ts:17`；`src/core/work-graph/persistence/lookup-all.ts:1` | 100–170 → **101–173** |
| ST-5 state | `src/core/work-graph/state/message-machine.ts:210`；`src/core/work-graph/state/task-failure.ts:731` | 8–15 → **9–17** |

**K3 新增、确认可合并的同类重复**

下表的收益除 N12 外，均已计入上面的对应项，不能再加一次。

| 重复 | 两侧当前位置 | 处理 |
|---|---|---|
| 原语重复 | `src/core/work-graph/tasks/codec-fields.ts:14` ↔ `src/core/work-graph/tasks/unknown-call-review-service.ts:299`、`src/core/work-graph/tasks/unknown-call-review-answers.ts:65`；`:33` ↔ `src/core/work-graph/tasks/run-reconcile-service.ts:143` | 并入 XX-1 |
| 同形 SHA／枚举／UTF-8 小助手 | `src/core/work-graph/tasks/codec-fields.ts:21` ↔ `src/core/work-graph/persistence/decision-record-codecs.ts:115`；`:42` ↔ `src/core/work-graph/tasks/run-reconcile-service.ts:146`；`:36` ↔同文件 `:181` | 同体部分接公共版本，计 XX-1；不改变字节／码点单位 |
| 严格、带标签的 SessionRef 校验 | `src/core/work-graph/tasks/unknown-call-review-codecs.ts:93` ↔ `src/core/work-graph/tasks/session-anomaly-codecs.ts:83` ↔ `src/core/work-graph/persistence/note-record-codecs.ts:158` | 公共层保留一份，计 XX-1。K3 的 `src/core/work-graph/tasks/codec-shape-checks.ts:27` 校验的是 **SessionMessageRef**，不能误用 |
| nullable canonical／JSON／invalid | `src/core/work-graph/tasks/codec-fields.ts:53`、`:45`、`:60` ↔ `src/core/work-graph/persistence/note-record-codecs.ts:138`、`:130`、`:145` | 分别计 XX-5、XX-6、拒绝助手 |
| 两个新事件外壳 | `src/core/work-graph/tasks/command-rerun-request-codecs.ts:287` ↔ `src/core/work-graph/tasks/unknown-call-review-codecs.ts:607`，并与 `src/core/work-graph/configuration/project-bootstrap-record-codecs.ts:383` 同形 | 计 XX-2 |
| 新 Core rejection | `src/core/work-graph/tasks/command-rerun-request-service.ts:98` ↔ `src/core/work-graph/tasks/unknown-call-review-service.ts:308`；`src/core/work-graph/tasks/receipt-replay.ts:66` ↔ `src/core/work-graph/tasks/task-review-reader.ts:23`、`src/core/work-graph/tasks/unknown-call-review-answers.ts:61` | 按各自 current 规则接线，计拒绝助手 |
| 新读／写失败映射 | `src/core/work-graph/tasks/command-rerun-request-service.ts:101`、`:112` ↔ `src/core/work-graph/tasks/unknown-call-review-service.ts:334`、`:330`；写映射另见 `src/core/work-graph/tasks/receipt-replay.ts:71` | 计 XX-7。unique→busy **不附文字**，unsupported 写→unavailable、读→unsupported，均须保留 |
| **N12：两个 owner 的单记录读取** | `src/core/work-graph/tasks/command-rerun-request-service.ts:199` ↔ `src/core/work-graph/tasks/unknown-call-review-service.ts:446` | 建局部共用读取器，参数化 decoder 和完整错误模板；净减 **10–16**。继续一次 `readMany`，缺记录仍 `{ok:false,notFound:true}`，解码失败仍 invalid；不能套用 SE-5 的 missing 检查 |

另外，K3 确有小型字段比较副本：`src/core/work-graph/state/command-rerun-request.ts:249` ↔ `src/core/work-graph/state/task-machine.ts:565`，以及 `src/core/work-graph/state/review-lease.ts:67` ↔ `src/core/work-graph/state/task-machine.ts:772`。它们只比较指定字段，**不并入 ST-7 的递归比较**；本轮保留这些领域包装，不计净减。

**二、16 个撤出项及非 K 项：只列变化**

没有撤出项因 K3 而重新成为本轮 C1。需要更新说明的只有：

| 条目 | K3 后变化 | 裁定 |
|---|---|---|
| ST-3 | 暂停时的动作推导新增 review 未解决／held 的前置阻断：`src/core/work-graph/state/decision-policy.ts:211`；执行判定侧有对应 AV-2b／AV-4c：`src/core/work-graph/state/task-failure.ts:864` | 更不能直接合并两个入口；继续撤出。`reverifyHeadStop` 不是 K3 新抽出的助手，旧证据已有记录：`.lead-ref/c1/ST.clean.md:35` |
| VW-9 | 原 `lookupAll`／`LookupBatch` 已移到 `src/core/work-graph/persistence/lookup-all.ts:19`、`:32`，`src/core/work-graph/views/goal-conflicts.ts:80` 保留转出 | K3 已完成搬移，不再计搬移收益；`truncated` 仍在返回协议中（`lookup-all.ts:54`、`goal-conflicts.ts:133`），继续不删 |

**非 K 保留项没有需要改变方案或估算的变化。** 尤其 VW-1／XX-8、N9 不能因为出现 `lookupAll` 就改接它：该助手使用等值索引、整窗水位一致性及最多四次重试，见 `src/core/work-graph/persistence/lookup-all.ts:37`；这与原来的预算、惰性停止、有序索引协议不同。

**三、七节的 `atLeastCursor` 仍未修复**

原结论成立，当前位置为：

- 参数声明：`src/core/work-graph/tasks/goal-decision-reader.ts:66`；实现入口：`:425`。到 `:445` 的返回路径仍没有消费 `input.atLeastCursor`。
- Goal 读取仍丢弃水位：同文件 `:118`；版本 pin 读取 `:134`、治理指针读取 `:398` 也没有把水位交回。
- Task graph 调用 `:210`、display 调用 `:266` 都没传最低水位；非 ready 的包装仍在 `:218`、`:267`。
- 可复用的比较／stamp 构造仍是 `src/core/work-graph/persistence/read-result-failures.ts:19`。

因此仍需让**实际参与原因计算的读取**携带并核对水位；不能末尾补空读，也不能用最大水位替较旧事实背书。保持 project→读取 Goal→workspace 的授权顺序（`goal-decision-reader.ts:426`），以及不带参数时的错误和结果。

这仍是独立行为修复，**不计 C1 项数或净减**。接口要求见 `docs/refactor/design/orchestration-2026-10/slices/slice-5-SPEC.md:817`。

**四、DSH 最终分组建议：改为五组**

不再保留“等 K3”的 G6。下面的目录归属仅涵盖**原 C1 接线表、本报告条目和注释清理命中的文件**，不是授权整目录重构。

公共接线简称 B：XX-1／2／5／6／7 和拒绝助手。所有组保持错误码、文字、检查顺序、字段存在性、列表顺序、读取次数和存储字节不变。

| 组 | 文件唯一归属 | 条目及组内先后 | 净减估算 | 新增＋删除估算 |
|---|---|---|---:|---:|
| **G1 公共基础** | `src/contracts/validation/common.ts`、`src/contracts/fingerprint.ts`；拟增 `src/contracts/core/rejections.ts`、`src/contracts/input-declaration-id.ts`；`src/core/work-graph/persistence/` **除 note-record-codecs.ts**；`materials/`、`evidence/`；另独占 `tasks/codec-fields.ts`、`tasks/codec-shape-checks.ts` | 先公共原语／JSON／结果形状，再事件外壳、带标签解析和失败映射，最后本组调用及 PE-1。公共实现只由此组修改 | **405–537** | 800–1,050 |
| **G2 Session／通信／配置** | `src/core/work-graph/sessions/`、`communication/`、`configuration/` 的 C1 文件；拟增 Session context／links、workspace-settings 助手 | SE 补充、SE-2、SE-3、SE-5、SE-7；先局部助手，再 B 接线，最后 SE-4 | **430–570** | 750–1,050 |
| **G3 视图／查询／注记／架构** | `src/core/work-graph/views/`、`queries/`、`notes/`、`architecture/` 的 C1 文件；另独占 `persistence/note-record-codecs.ts`；拟增活动读取、注记失败映射助手 | VW-1／XX-8、VW-3、VW-5 的 view 调用、VW-7、N1–N7、N9–N11；先本组助手，再调用及 B，最后注释 | **440–580** | 650–1,000 |
| **G4 原 task 服务和 Runtime 接线** | `src/core/work-graph/tasks/` 的 C1 文件，**排除 G1 两文件及下述 G5 集合**；另独占 `src/core/agent-runtime/context-assembler.ts`；拟增 trusted-context、task-phase-facts 助手 | TA-1、TA-4 的 task／Runtime 调用、TA-5、TA-10、VW-5 的 terminal helper；B、TA-2。先提供 helper，再切调用。`goal-decision-reader.ts` 也归此组，游标修复另列提交 | **400–530** | 800–1,150 |
| **G5 状态／类型／task codecs／K3 owner** | `src/core/work-graph/state/`、`model/` 的 C1 文件；tasks 下所有命中的 `*-codecs.ts`；另加下面的 K3 文件集合 | ST-1 及两补充、ST-4、ST-6、ST-7、ST-9、N8、N12；本组 B、TA-2／VW-2／ST-5。先类型别名、递归比较和 owner 读助手，再接线 | **352–476** | 600–900 |
| **合计** | 无文件交叉 | 含建议新增 N12 | **2,027–2,693** | **3,600–5,150** |

G5 的额外 K3 文件集合，均位于 `src/core/work-graph/tasks/`：

`command-rerun-request-service.ts`、`unknown-call-review-service.ts`、`unknown-call-review-answers.ts`、`receipt-replay.ts`、`decision-source-identity.ts`、`task-review-reader.ts`、`decision-answer-lookup.ts`、`revision-guard.ts`、`blocked-command-order.ts`、`command-expansion.ts`，以及拟增的 owner 单记录读取助手。

执行顺序：

1. **G1 先完成并冻结公共出口。**
2. **G2、G4、G5 可并行**，文件不相交。
3. **G3 等 G4 的终态候选助手完成后启动**；届时可以与尚未结束的 G2、G5 并行。
4. 每组的注释随该文件一起处理，不另开一个跨组注释任务。

`src/core/agent-runtime/execution-preparation.ts:49` 的 lead 合并修复不属于 C1 改点，不收入写入清单；assembler 只动 `:760` 内的编号调用。

这些是工作量估算，尚无施工 diff；600–1,200 的目标按**新增＋删除**衡量，不能拿净减量代替。

**五、决定 35：K3 增加了可裁短的施工注释**

按连续注释块计数；包含“只删除施工标签、保留规则正文”的块，**不是整块删除数**。下表只计能识别为 K3 施工说明的部分，不把旧 4C 返工注释重新算成 K3 新增。

| 区域 | 可裁短块数 | 对原净减估算的增量 |
|---|---:|---:|
| tasks | **27** | 25–35 行 |
| views／queries／相关 model | **4** | 3–5 行 |
| communication／configuration／sessions | **1** | 0 行；删句内施工尾注 |
| persistence／materials／evidence | **1** | 1–3 行 |
| state | **4** | 1–2 行 |
| notes | **0** | 0 |
| 合计 | **37** | **30–45 行** |

三个例子：

- `src/core/work-graph/tasks/codec-fields.ts:2`、`:5`：删返工编号和“CRR 将来会导入”的经过；CRR 当前已经导入，见 `src/core/work-graph/tasks/command-rerun-request-service.ts:44`。保留纯字段校验与业务规则的分界。
- `src/core/work-graph/model/command-rerun-request-contracts.ts:3`：删“group 1 只放类型、group 4 实现 owner”。保留 §2／L19a 映射，以及 `:18` 起“不写入不得伪造 committed cursor”的规则。
- `src/core/work-graph/state/task-failure.ts:734`：删“reader wiring is group 4”；保留 `:732` 的 U5、按 runId 选记录及 AV-2b／AV-4c 对应关系。

状态机规则说明仍受 `docs/refactor/HANDOFF.md:125` 保护。上面净减没有重复计算随函数合并消失的注释。

**C1 总数与 lead 待裁定项**

- 原 59 项：**保留 43、撤出 16**；K3 后净减估算 **2,017–2,677 行**。
- 建议加入独立 **N12** 后：**保留 44、撤出 16，净减 2,027–2,693 行**，即约 **2,030–2,690 行**。
- `atLeastCursor` 仍另列，以上不含它。

**需要 lead 裁定的是 N12 是否纳入：**推荐纳入本轮 G5，保持两次入口各自的读次数、错误模板及结果形状；也可留后续，届时采用 **43 项、2,017–2,677 行**的口径，并从 G5 扣除 10–16 行。其余 27 个 K 项无需重新作产品裁定，只需按本表冻结公共助手的位置和接线范围。