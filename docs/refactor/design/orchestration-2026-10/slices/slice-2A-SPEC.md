# 2A 片规格：决定队列只读相关的条目，完整分页

> **状态：lead 起草，2026-10-13；测试入口待用户确认（§5.1），确认后交 Codex 审查，再冻结。**
> - 代码基线：ee9e7a33 的工作树，第 5 片已合入。
> - 依据：
>   - HANDOFF 决定 42、48、49（第 28 项选 (a)）、50（第 2 片拆成 2A/2B/2C）；
>   - DESIGN §1.4、§6“第 2 片补齐决定队列的规模读取”；
>   - [lead 答复页第 28 项](../model/REVIEW-SLICES-2-4-6-7-LEAD-ANSWERS.md)；
>   - 代码事实：`D:/cc-lead-notes/codex2/s2facts.out.md` 第 15 项，以及 2026-10-13 的决定队列读取图（子任务只读整理，lead 抽查过索引注册、两个后端的查找实现和字段路径）。
> - 2B（执行计数、日历）要用本片的“按顺序查找”，所以 2A 先做。

## 0. 冻结说明（lead）

### 0.1 要用户定的

- **已定：** 第 28 项选 (a)。缩窄索引、完整分页；待答和已答待落实不因时间久而丢弃；请知悉按类别的已看位置往后读；200 个目标的上限一并处理；读取故障仍报故障，局部结果写明“不是全部”，局部数不当总数。
- **待确认：** §5.1 的测试入口。
- **lead 定、用户可改的一处可见变化：** “历史”一栏改成最新的在前，往下翻看更早的。今天是按目标、来源种类、来源键排序，和时间无关；历史一多，按这个顺序翻页找不到最近的事。

### 0.2 今天的问题（代码事实）

- **读得太宽。**
  - 消息按“工作区 + 状态”整批读，`pending`、`read`、`responded` 各一遍，成员之间的消息也在里面。
  - 自动返工的通知要读工作区里所有已结束的 Run、所有检查轮次。
  - 候选计划每个目标读两遍全部候选。
  - 每个来源最多 5,000 条、25 页；超了就整个队列拒绝（`capacity`）。
- **目标上限。** 没按目标筛选、目标超过 200 个时，整个队列拒绝。目标冲突对所有目标两两比较。
- **假分页。** 所有来源先读全，再在内存里切一页。“下一页”不代表上游能分页。
- **两种超量码。** 消息和注入的来源报 `capacity`；候选和规划问题报 `incomplete`。

### 0.3 lead 定的技术选择

- **L1 RecordStore 加“按顺序查找”，两个后端行为一致。**
  - 索引登记可以多带一个排序路径：`{ name, aggregateType, paths, orderBy?: { path, type: 'text' | 'number' } }`。
  - 新请求 `lookupOrdered`：
    - 等值部分和今天一样：每个路径一个标量值；
    - 加 `direction: 'asc' | 'desc'`；
    - 加可选的下界或上界 `{ value, inclusive }`；
    - 加续读游标 `after: { order: 值或 null, refKey }`；
    - 加 `limit`（1–200）。
  - **排序：**
    - 先按排序值，再按完整规范 refKey（UTF-8 字节序）；
    - `asc` 时排序值为空的在前，`desc` 时在后；
    - 排序值的类型和登记的不符：不是候选（和今天“复合值不是候选”同一规则）。
  - **SQLite：**
    - 表达式索引的列是：aggregateType、各等值路径（`json_type` 和 `json_extract`）、排序路径、`ref_key`；
    - 查询用 `ORDER BY` 排序值、`ref_key`，再加行值比较做续读；
    - 新索引在打开数据库时建在已有的行上（今天的做法），不加迁移步骤。
  - **内存后端：** 可以每次调用时排序；语义必须和 SQLite 逐条相同。
  - 每页仍返回 `readThrough`，和今天的 `lookup` 一样。
  - **排序值是提交位置 `since` 时：** `CommitCursor` 是 `c` 加 10 位补零的序号，文字顺序就是提交顺序。2B 的 ISO 时间（UTC，固定格式）也用文字顺序。
  - 今天的 `lookup` 不变。
- **L2 “还要你处理的”只从窄索引读，读全，不设条数上限。**

  | 来源 | 新索引（等值路径 → 查的值） | 读出来以后 |
  | --- | --- | --- |
  | 待答的请你决定 | `s2a-user-decision-open`：`ref.projectId`、`ref.workspaceId`、`recipient.kind`、`intent`、`status` → `user`、`decision_request`，`pending` 和 `read` 各查一次 | 照今天的 `messageCard` |
  | 已答待落实（含合成答复） | `s2a-user-decision-unapplied`：`ref.projectId`、`ref.workspaceId`、`recipient.kind`、`status`、`response.decision.requiresApplication`、`application` → `user`、`responded`、`true`、`null` | 照今天的 `messageCard`、`syntheticAnswerCard` |
  | 待采用的候选 | `s2a-open-candidates`：`ref.projectId`、`ref.workspaceId`、`kind`、`status` → `candidate_v2`、`candidate` | 照今天的 `candidateCard` |
  | 目标原因卡、规划问题、目标冲突 | 只对**未结束的目标**算，见 L3 | 照今天 |

  - `application` 这一列靠的是现有规则：已落实时它是对象（复合值），不是候选；没有或为空时是 `null`。两个后端今天已经一致：内存后端把复合值排除；SQLite 对对象的 `json_extract` 不是 NULL。本片要在两个后端上各加一个测试锁住。
  - 这些索引是新加的，打开数据库时建在已有行上，旧记录不用补写。
  - 读法：按页读到底（每页 ≤200），没有 5,000 条或 25 页的上限，超量不再拒绝。这些是要人处理的事，条数由人的处理速度限制；规模测试里放到 2,000 条。
  - 按目标筛选时，读同一组索引，在内存里按目标过滤（这些条目本来就少）。
  - 结果和今天一样经 `finalizeCard` 定最终状态。目标已取消的，变成“已关闭”，归到历史（L4）。
- **L3 目标：分页读完，只对未结束的目标做重的计算。**
  - 新索引 `s2a-goal-by-workspace-desired`：`ref.projectId`、`workspaceRef.workspaceId`、`desiredState`。分别查 `active` 和 `paused`，按页读到底，没有 200 个目标的上限。已取消的目标不读。
  - 对读到的目标，用今天的 `readGoalTerminalState` 判断是否已完成（一次批量读），已完成的不算。
  - 目标原因卡、规划问题、目标冲突只对剩下的“未结束目标”算；冲突也只在未结束的目标之间两两比较。
  - 这样，已结束目标上没答过的冲突卡不再出现在历史里，因为它们本来就是“已关闭”，从没被答过。答过的冲突卡照常经答复消息进历史（L4）。
  - 已完成的目标在 `active` 里会越积越多，每次多读一条目标记录和一次完成状态。规模测试放 300 个目标（其中 250 个已结束），记下耗时；不够快再另提“目标上记终态”的写法。
  - 删掉 `GOAL_LIMIT` 的拒绝。目标冲突读取自己的目标列表时，今天不检查截断（`goal-conflicts.ts`），改成同样分页读到底。
- **L4 历史：最新的在前，从上游一页一页读。**
  - 三条来源按（提交位置 `since` 倒序，refKey 倒序）合并：
    1. 已答复的给你的决定消息：新的按顺序查找索引 `s2a-user-responded`，等值 `ref.projectId`、`ref.workspaceId`、`recipient.kind`、`status` → `user`、`responded`，按 `since` 倒序。读出来以后只留带 `decision` 的，去掉已在“已答待落实”里的。
    2. 已结束的候选：按顺序查找索引 `s2a-candidates-by-since`，等值 `ref.projectId`、`ref.workspaceId`、`kind` → `candidate_v2`，按 `since` 倒序。只留 `accepted`、`not_adopted`、`rejected`。
    3. L2 读出来、但最终状态是“已关闭”的条目（目标已取消），在内存里按同样的键插进来。
  - 没有 `since` 的旧记录排在最后，彼此按 refKey 倒序。
  - 一页取够 `limit` 条就停。被过滤掉的记录也算读过，游标跳过它们。合并规则是确定的，所以不存在“这页漏了一条”。
  - 历史仍不给总数（和今天一样）。
- **L5 请知悉：每一类从它的已看位置往后读，只读新的。**

  | 类别 | 按顺序查找索引（按 `since` 正序） | 读出来以后 |
  | --- | --- | --- |
  | 成员发来的请知悉（`member_notice`） | `s2a-user-notice`：`ref.projectId`、`ref.workspaceId`、`recipient.kind`、`intent` → `user`、`notify` | 去掉合成答复；按目标筛选；位置照今天的 `decodeNoticeOrigin` |
  | 自动返工（`automatic_rework`）的重排 | `s2a-requeue-by-project`：`ref.projectId` | 去掉人发起的；目标不在这个工作区的去掉（工作区由 L3 的目标列表确定）；位置照今天 |
  | 自动返工的重新检查 | `s2a-round-reverify`：`ref.projectId`、`ref.workspaceId`、`reverify.actorClass` → `system` 和 `agent` 各查一次 | 只留不是第一轮的；位置照今天 |

  - **起点：**
    - 已看位置是提交位置时，下界就是它（含等于，再按今天的 `compareNoticePositions` 去掉不大于已看位置的）。
    - 没有已看位置，或已看位置是旧式的（`legacy`）：从头读，空 `since` 的旧记录先读，在内存里照今天的旧式位置排序。旧记录不会再增加。
  - **不再读所有已结束的 Run。** 决定 49 写的是“已结束执行按时间窗口读”。这里用提交位置作窗口：重排和检查轮次自己带 `since`，从已看位置往后读，就只读新的。这和时间窗口目的相同，而且不会漏掉迟写的记录。
  - **计数：** 每类最多数到 1,000 条。超过时，计数写 1,000，这一类放进新字段 `countsCapped`，`countsComplete` 为假。界面显示“1000+”。
  - 已看位置的写入（`markNoticesSeen`）和展示令牌不变。
- **L6 公开的游标改版，计数照实。**
  - 游标 `v: 2`：
    - 待答、已答待落实：照今天的（排名、目标、来源种类、来源键）；
    - 历史：（`since`，refKey）；
    - 请知悉：每类一个位置，同今天。
  - 收到 `v: 1` 的游标报 `invalid`，调用方从第一页重来。
  - **计数：**
    - 待答、已答待落实：总数，准确，因为 L2 读全了；
    - 请知悉：按 L5，最多 1,000，超了标出来；
    - 历史：不给。
    - `countsComplete` 的其余含义不变：有没接上的来源时仍为假。
  - 队列里不再有 `capacity` 拒绝；存储故障、窗口一直不稳等真实故障照今天的码。来源不可用仍按来源报（`capabilities`）。
- **L7 稳定窗口照旧。**
  - 读取过程中账本有新提交，就整窗重读，最多 4 次，之后报 `unavailable`。这个协议不改。
  - 本片读得更窄，重读的机会比今天少。规模测试里加一个“读取中途有别的提交”的例子，确认能重读成功。
- **L8 单张卡的读取（`readDecisionCard`）一并去掉上限。** 按来源键的答复索引按页读到底，不再报 `capacity`；注入来源的窗口超量今天报 `unavailable`，改成读到底。
- **L9 不改的：** 卡片的内容、状态判定（`finalizeCard`）、合并（`mergeCards`）、请知悉的已看位置和令牌、各来源的可用性报告、路由的形状（只多出 `countsCapped`，并改游标版本）。

## 1. 范围

### 1.1 交付

1. RecordStore：按顺序查找（登记、请求校验、两个后端）。
2. 新索引：L2 的 3 个、L3 的 1 个、L4 的 2 个、L5 的 3 个，共 9 个，登记在各自的 codec 里。
3. 决定队列读取：L2–L8。
4. 路由：游标 v2、`countsCapped`。

### 1.2 不在本片

- 执行计数、日历、按时间读任务状态（2B）。
- 工作线、状态词、置顶、悬停卡（2C）。
- 未接上的来源（注记审阅、待放行、二次到期、交接、未送达、接续的请知悉）：仍报不可用，各由自己的片接上。
- 目标上记终态（L3 只记下耗时，需要时另提）。
- 改稳定窗口的协议（L7）。
- 界面（E3）。

## 2. 接口（新名字以此为准）

```ts
// src/core/record-store/lookup-ports.ts
export type RecordLookupIndex = {
  readonly name: string; readonly aggregateType: string; readonly paths: readonly string[];
  readonly orderBy?: { readonly path: string; readonly type: 'text' | 'number' };
};
export type OrderedLookupRequest = {
  index: string;                       // 必须是登记了 orderBy 的索引
  values: readonly LookupValue[];
  direction: 'asc' | 'desc';
  bound?: { value: string | number; inclusive: boolean };   // asc 时是下界，desc 时是上界
  after?: { order: string | number | null; refKey: string };
  limit: number;                       // 1..200
};
export interface RecordLookupPort {
  lookup(request: RecordLookupRequest): Promise<StoreResult<RecordLookupPage>>;              // 不变
  lookupOrdered(request: OrderedLookupRequest): Promise<StoreResult<RecordOrderedLookupPage>>;
}
export type RecordOrderedLookupPage = {
  records: EncodedRecord[];
  next: { order: string | number | null; refKey: string } | null;
  readThrough: CommitCursor | null;
};

// src/core/work-graph/model/decision-contracts.ts（DecisionQueueReadV1 新增一项）
countsCapped: NoticeCategoryV1[];      // 计数到了 1,000 上限的请知悉类别
```

- 请求不合法（索引没登记排序、值的个数不对、`limit` 越界、游标的 refKey 不是同一个聚合类型、`bound` 的类型和登记的不符）：`invalid`；索引不存在：`unsupported`。和今天的 `lookup` 一样，不抛异常。

## 3. 流程（只读，不新增状态行）

| 行 | 读什么 | 结果 |
| --- | --- | --- |
| QA1 | 队列第一页 | 待答、已答待落实读全，按今天的顺序排；历史从最新的开始；请知悉从各类的已看位置往后 |
| QA2 | 带 v2 游标的下一页 | 从游标处接着读；历史和请知悉从上游接着读，不重读已经翻过的 |
| QA3 | 按目标筛选 | 同一组索引，内存里按目标过滤；未结束目标的计算只对这个目标 |
| QA4 | 读取中途有别的提交 | 整窗重读（L7） |

## 4. 规则

1. 待答、已答待落实的条目，不论多旧、多少，都在队列里，计数准确。
2. 别人之间的消息、旧的已结束执行、已结束目标的候选，不再进入每次读取。
3. 队列里没有“容量不足”。真实的故障照实报；读不全的计数标出来，不当总数。
4. 历史最新的在前；翻页从上游接着读，同一份数据翻页得到的条目不重不漏。
5. 两个后端对同一组数据、同一个请求，返回逐条相同的结果和游标。
6. 读取不写任何东西，不调用模型。

## 5. 测试（TDD，测试由 DSH 一条一条写）

做法同 K 片 §5：
- 用 `.dsh-ref/tdd/` 的 TDD skill，在确认过的入口上一条一条先写失败测试，再写实现；
- 不读数据库核对；
- 期望值来自规格或手算例子；
- 测试名以行号开头；
- 服务层的例子在内存和 SQLite 两个后端各跑一次。规模例子（QA-05、06、07、08、16）在内存后端用全量，在 SQLite 用十分之一的量，断言按各自的量手算。

### 5.1 测试入口（**待用户确认**）

| 入口 | 是什么 | 能抓到 | 抓不到 |
| --- | --- | --- | --- |
| QE1 | RecordStore 的公开 `lookupOrdered`，两个后端各一份 | 排序、空值、类型不符、上下界、续读游标、建在已有行上的新索引；两个后端逐条一致 | 决定队列的业务规则 |
| QE2 | 业务流程：用真实的 WorkGraph 服务造数据（成员发请你决定、你答复、落实、目标取消和完成、成员之间大量消息、大量历史），用公开的 `queryDecisionQueue` / `readDecisionCard` 读 | 只读相关的；不再拒绝；翻页不重不漏；历史最新在前；计数 | 路由的序列化 |
| QE3 | 请知悉流程：真实的自动返工、重新检查、成员请知悉，加上 `markNoticesSeen`，再读队列 | 每类从已看位置往后；旧式位置；计数到 1,000 的标记；不再读所有已结束的 Run | 界面的“已看”交互 |
| QE4 | HTTP 路由（`CORE_ROUTE_SPECS` 里的决定队列路由） | 游标 v2、旧游标报 `invalid`、`countsCapped`、故障如实传出 | 浏览器 |

### 5.2 验收行为

| 行 | 入口 | 行为 | 期望值来源 |
| --- | --- | --- | --- |
| QA-01 | QE1 | 按 `since` 正序和倒序各读一个手写的数据集（含空值、类型不符、同一 `since` 的多条）：顺序、每页边界、续读游标与手算的一致；两个后端相同 | L1 |
| QA-02 | QE1 | 上下界含与不含；请求不合法的五种情况报 `invalid`，索引不存在报 `unsupported` | L1、§2 |
| QA-03 | QE1 | 已有数据的 SQLite 库重新打开，加了新索引以后，按顺序查找能查到旧行 | L1 |
| QA-04 | QE1 | `application` 列的三种情况：没有、为空、是对象。前两种是候选，对象不是。两个后端相同 | L2 |
| QA-05 | QE2 | 工作区里有 20,000 条成员之间的消息、3 张待答卡、2 张已答待落实的卡：队列返回这 5 张，计数 3 和 2，不拒绝 | L2、规则 1–3 |
| QA-06 | QE2 | 2,000 张待答卡，按 `limit: 50` 翻到底：张数 2,000，不重不漏，顺序和今天的规则相同 | L2、L6、规则 4 |
| QA-07 | QE2 | 300 个目标，其中 250 个已完成或已取消，未按目标筛选：不拒绝；目标原因卡和冲突只出现在未结束的目标上 | L3 |
| QA-08 | QE2 | 历史有 1,500 条（答复过的卡和已结束的候选交错），按 `limit: 100` 翻：最新的在前，交错顺序和手写的一致，不重不漏；没有 `since` 的旧记录在最后 | L4 |
| QA-09 | QE2 | 目标取消以后，它的待答卡出现在历史、位置按它自己的 `since`，不再算待答 | L2、L4 |
| QA-10 | QE2 | 按目标筛选时，只出现这个目标的卡，计数也只算这个目标 | L2、L3 |
| QA-11 | QE2 | 读取中途插入一次别的提交：这次读取重读后成功，结果与提交后的数据一致 | L7 |
| QA-12 | QE2 | `readDecisionCard` 读一张答复索引里有 300 条记录的卡：不拒绝，内容正确 | L8 |
| QA-13 | QE3 | 自动返工 30 次、重新检查 10 次、成员请知悉 20 条，标记已看到中间某处：再读只出现之后的，每类从自己的位置接着 | L5 |
| QA-14 | QE3 | 已看位置是旧式的：旧记录按旧式位置排在前，之后接新的 | L5 |
| QA-15 | QE3 | 一类有 1,200 条未看：计数 1,000，`countsCapped` 含这一类，`countsComplete` 为假；翻页仍能看到全部 1,200 条 | L5、L6 |
| QA-16 | QE3 | 工作区有 10,000 个已结束的 Run，只有 2 次自动返工在已看位置之后：结果是这 2 条 | L5 |
| QA-17 | QE4 | 第一页拿 v2 游标翻第二页，结果同 QE2；拿 v1 游标报 `invalid`；`countsCapped` 原样传出；存储故障报对应的码，不报空队列 | L6 |

### 5.3 要改断言的旧测试（lead 写出前后断言，DSH 不自行翻转）

| 测试 | 怎么改 |
| --- | --- |
| `tests/work-graph/S5R2-queue-history.test.ts` R2A07 | 201 个目标不再拒绝，改成返回结果 |
| 同文件 R2A08 | 不变（200 个目标仍正常） |
| 同文件 R2A09 | 5,001 条待答请求不再拒绝，改成返回全部、计数 5,001 |
| 同文件 R2A01–06 | 候选历史的顺序改成最新在前 |
| `tests/work-graph/S5-decision-queue.test.ts` DQ09 | 游标改版；`limit: 1` 翻到底、来源游标稳定、不写，这些断言保留 |
| `tests/work-graph/S5-notices.test.ts`、`tests/app/S5-decision-routes.test.ts` | 逐条核对：游标版本、多出的 `countsCapped`；其余断言保留 |

## 6. 文件（影响面；施工时以实际为准，超出要报）

- **RecordStore：** `src/core/record-store/lookup-ports.ts`、`lookup-index.ts`、`in-memory-record-store.ts`、`sqlite-record-store.ts`。
- **索引登记：**
  - `src/core/work-graph/sessions/message-record-codecs.ts`（L2 的两个、L4 的一个、L5 的一个）；
  - `src/core/work-graph/persistence/plan-record-codecs.ts`（L2、L4 各一个）；
  - `src/core/work-graph/tasks/plan-readers.ts`（L3）；
  - `src/core/work-graph/tasks/claim-record-codecs.ts`（L5 重排）；
  - `src/core/work-graph/persistence/evidence-record-codecs.ts`（L5 重新检查）。
- **决定队列：**
  - `src/core/work-graph/views/decision-read-model.ts`、`goal-conflicts.ts`、`automatic-rework-notices.ts`；
  - `src/core/work-graph/model/decision-contracts.ts`。
- **路由：** `src/app/core-routes.ts` 里决定队列的部分（如果游标或计数在那里有校验）。
- **测试：** 新测试由 DSH 写；旧测试按 §5.3。

## 7. 施工

- 一个副本、一个新的 DSH Session。按 QE1 → QE2 → QE3 → QE4 分组。
- 先冻结规格和夹具。“大数据集”的夹具由 Codex 写：用真实服务造 20,000 条消息、300 个目标、1,500 条历史；lead 核对后冻结。
- 其余同 K 片 §7：每组派一个只读复查子任务；之后 lead 核对、Codex 审；全量测试；合入。

## 8. 不做的事

- 不把 5,000 调大了事；
- 不改卡片内容和状态规则；
- 不改已看位置的写入；
- 不改稳定窗口的协议；
- 不接新的来源；
- 不调用真实模型。
