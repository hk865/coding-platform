# 2A 片规格：决定队列只读相关的条目，不再拒绝，完整分页

> **状态：lead 起草，2026-10-13；按 Codex 审查（`D:/cc-lead-notes/codex2/s2arev.out.md`，结论“不能冻结”，15 条）重写一轮。测试入口用户已同意（决定 51）。2026-10-14 lead 把按顺序查找挪到单独的端口（L1、§2），合入顺序改成接线包 2 → K 片 B → K 片 A → 2A；再审一轮后冻结。**
> - 代码基线：ee9e7a33 的工作树，第 5 片已合入。
> - 依据：
>   - HANDOFF 决定 42、48、49（第 28 项选 (a)）、50（第 2 片拆成 2A/2B/2C）；
>   - DESIGN §1.4、§6“第 2 片补齐决定队列的规模读取”；
>   - [lead 答复页第 28 项](../model/REVIEW-SLICES-2-4-6-7-LEAD-ANSWERS.md)；
>   - 代码事实：`D:/cc-lead-notes/codex2/s2facts.out.md` 第 15 项；2026-10-13 的决定队列读取图（子任务只读整理）；Codex 审查对字段路径和两个后端的核对。
> - 2B（执行计数、日历）要用本片的“按顺序查找”，所以 2A 先做。

## 0. 冻结说明（lead）

### 0.1 要用户定的

- **已定：** 第 28 项选 (a)。具体是：
  - 缩窄读取范围，完整分页；
  - 待答和已答待落实不因时间久而丢弃；
  - 请知悉按类别的已看位置往后读；
  - 200 个目标的上限一并处理；
  - 读取故障仍报故障，局部数不当总数。
- **待确认：** §5.1 的测试入口。
- **第一稿里“历史改成最新在前”撤回。** 审查指出：记录上能排序的位置是“卡出现的时候”，不是“最后处理的时候”。按它排出来的“最新”会误导人；要按处理时间排，得另存一个位置。这不是第 28 项要解决的事，本片不改历史的顺序。

### 0.2 今天的问题（代码事实）

- **读得太宽。**
  - 消息按“工作区 + 状态”整批读，`pending`、`read`、`responded` 各一遍，成员之间的消息也在里面。
  - 自动返工的通知要读工作区里所有已结束的 Run、所有检查轮次。
- **到上限就整个拒绝。**
  - 每个来源最多 5,000 条、25 页，超了整个队列报 `capacity`；
  - 没按目标筛选、目标超过 200 个，也整个拒绝；
  - 候选计划、规划问题自己的读取超过 25 页报 `incomplete`。
- **一个会丢通知的缺陷。** 归档时处置等待的那条写入（`mailbox-service.ts` 的 `writeArchiveWaitDisposal`）重新编码消息时丢了提交位置 `since`。那条消息从此按“旧式位置”排，可能被已看位置挡掉。

### 0.3 lead 定的技术选择

**总的做法：** 卡片怎么拼、怎么合并、最终状态怎么定、怎么分节、怎么在内存里分页，这条现有的流水线**一点不改**（`readDecisionQueueWindow` 里的 `messageCard`、`syntheticAnswerCard`、`candidateCard`、`mergeCards`、`finalizeCard`、`sortCards`，游标格式 `v: 1`）。本片只改两件事：
- 喂给它的数据只取相关的；
- 去掉所有“到上限就拒绝”。

这样卡片的语义、合并和历史都保持今天的样子。审查指出的“答过的卡重新冒出来”“候选链选错”“取消目标的历史丢失”都不会发生。

- **L1 RecordStore 加“按顺序查找”，两个后端行为一致。**
  - 索引登记可以多带一个排序路径：`{ name, aggregateType, paths, orderBy?: { path } }`。排序值只用文字（`since` 和 ISO 时间都是文字）。
  - **哪些行是候选：**
    - 排序值必须是文字。缺失、为空或不是文字的行，不是这个按顺序索引的候选。
    - 这样排序时不出现空值，空值行另用普通等值查找读（L4 的旧式组）。
  - 放在单独的端口 `RecordOrderedLookupPort` 上，`RecordLookupPort` 不变（§2，lead 2026-10-14）。
  - **请求** `lookupOrdered`：
    - `values`：等值部分，每个路径一个值，**必须是非空标量**；有空值报 `invalid`。这样索引前缀全部被等值约束，排序那一列才能连续扫。
    - `direction`：`'asc' | 'desc'`。
    - `bound?: { value: string, inclusive: boolean }`：正序时是下界，倒序时是上界。
    - `after?: { order: string, refKey: string }`：上一页最后一条，不含。
    - `limit`：1–200。
  - **顺序：**
    - 先按排序值，再按完整规范 refKey，两者都按 UTF-8 字节序（SQLite 的 BINARY）；
    - 内存后端用 `Buffer.compare`，不用 JS 字符串比较。
  - **请求不合法报 `invalid`：**
    - 索引没登记排序；
    - 值的个数不对，或有空值；
    - `limit` 越界；
    - `after.refKey` 不是同一个聚合类型的规范 refKey；
    - `after.order` 或 `bound.value` 不是文字。
  - 索引不存在：`unsupported`。都不抛异常。
  - **SQLite：**
    - 索引列依次是：aggregateType、各等值路径（`json_type`、`json_extract`）、`json_extract(排序路径)`、`ref_key`；
    - 索引名的指纹把 `orderBy` 算进去；
    - 查询：等值谓词同今天，加 `json_type(排序路径) = 'text'`；续读用 `(排序值, ref_key)` 的行值比较（两边都非空，不受 NULL 影响）；`ORDER BY 排序值, ref_key`，方向一致。
    - 新索引在打开数据库时建在已有的行上（今天的做法）。
  - 内存后端可以每次调用时排序，语义必须和 SQLite 逐条相同。每页仍返回 `readThrough`。
  - **验收时 lead 另做一项：** 用 `EXPLAIN QUERY PLAN` 确认 SQLite 走的是这个索引。这不进单元测试。
  - 今天的 `lookup` 不变。
- **L2 消息只读发给你的。**
  - 新等值索引 `s2a-user-messages`：`ref.projectId`、`ref.workspaceId`、`recipient.kind` → `user`。按页读到底，没有条数上限。
  - 它代替今天按状态读三遍的 `loadWorkspaceMessages`。读出来以后的过滤、拼卡、成员请知悉，和今天一模一样。
  - 成员之间的消息不再读。发给你的消息由人的处理速度和成员发请知悉的速度决定。规模测试放 5,000 条以上，记下耗时。
  - 按目标筛选时照今天在内存里过滤。今天就登记了、但没用上的 `s5-user-message-by-goal` 本片不用。
- **L3 目标、候选、规划问题、冲突：分页读到底，不拒绝；计算范围和今天一样。**
  - 目标列表（`listWorkspaceGoals`）按页读到底。删掉 `GOAL_LIMIT` 和 5,000 条的拒绝。
  - 目标原因卡、规划问题、目标冲突仍对列出的**所有**目标算，和今天一样。这样取消、完成的目标上的卡，照今天进历史或留在原处，不改语义。目标冲突读自己的目标列表时，今天不检查截断，改成同样读到底。
  - 候选（`enumerateGoalCandidates`、`enumerateClosedGoalCandidates`）和规划问题（`planning-question-reader.ts`）自己的 25 页上限去掉，按页读到底，不再报 `incomplete`。
  - **代价如实写明：** 每次读队列，对每个目标都要算一遍。规模测试放 300 个目标（250 个已结束），**记下耗时，不设断言**。真慢了，另提“目标上记终态、只算未结束的”。那会改取消目标的历史，要先定语义，不在本片。
- **L4 请知悉：每一类从已看位置往后读，读全，再按今天的比较规则排序和分页。**
  - **起点：**
    - 已看位置是提交位置 `c`：用按顺序查找、下界 `c`（含），读到底；再用今天的 `compareNoticePositions` 去掉不大于已看位置的。旧式组整个跳过，因为旧式位置都排在提交位置之前。
    - 没有已看位置，或已看位置是旧式的：先读整个旧式组（`since` 为空的行，用普通等值查找、路径末位是 `since` 取 `null`），再从头读按顺序的部分。
  - 读到的条目合在一起，用今天的比较规则排序、在内存里分页。游标、计数、`markNoticesSeen`、展示令牌**全照今天**。因为“已看之后”的全读了，存储顺序和比较规则不一致也不会漏。
  - **各类的来源：**

    | 类别 | 读法 | 读出来以后 |
    | --- | --- | --- |
    | 成员请知悉（`member_notice`） | L2 读到的发给你的消息 | 照今天 |
    | 自动返工的重排 | 按顺序索引 `s2a-requeue-by-project`：等值 `ref.projectId`，按 `since`；旧式组用等值索引 `s2a-requeue-legacy`：`ref.projectId`、`since` | 去掉人发起的；**按重排所属目标的工作区归属**：用 `ref.goalId` 直接读那个目标，不论它现在是什么状态；不在本工作区的去掉。同一个项目的两个工作区互不串 |
    | 自动返工的重新检查 | 按顺序索引 `s2a-round-reverify`：等值 `ref.projectId`、`ref.workspaceId`、`chain.reverify.actorClass`（`system`、`agent` 各一次），按 `since`；旧式组同理 | 每一轮照今天用 `roundChainHead` 核对链，链出错照今天报。不只看“不是第一轮” |

  - 不再读所有已结束的 Run。决定 49 写的是“已结束执行按时间窗口读”，这里用提交位置作窗口：重排和检查轮次自己带 `since`，从已看位置往后读，只读新的，也不会漏掉迟写的记录。
  - **代价如实写明：** 你一直不标“已看”，读的量就一直涨。这和今天一样，今天还要先读全部已结束的 Run。本片不加计数上限。
- **L5 修掉丢 `since` 的写入。** `writeArchiveWaitDisposal` 改成保留原来的提交位置，和其它更新一样经 `preservedNoticeOrigin`。再查一遍所有重新编码消息、重排、检查轮次、候选的写入，都要保留 `since`。
- **L6 单张卡的读取（`readDecisionCard`）一并去掉上限。** 答复索引和注入来源都按页读到底，不再报 `capacity` 或因超量报 `unavailable`。
- **L7 稳定窗口照旧。**
  - 读取中途账本有新提交就整窗重读，最多 4 次，之后报 `unavailable`。
  - 跨页没有快照：两页之间有人答了卡，卡可能换到别的节。这是今天就有的“边翻边变”，本片不改，也不承诺跨页一致。
- **L8 队列里不再有 `capacity` 拒绝，也不再因超量报 `incomplete`。** 存储故障、窗口一直不稳、来源不可用，照今天报。计数的含义全照今天。
- **L9 不改的：**
  - 卡片内容、合并、最终状态、分节、排序、游标（`v: 1`）；
  - 计数和 `countsComplete`；
  - 请知悉的已看位置和令牌；
  - 各来源的可用性报告；
  - 路由的形状。

## 1. 范围

### 1.1 交付

1. RecordStore：按顺序查找（登记、请求校验、两个后端）。
2. 新索引：
   - `s2a-user-messages`；
   - `s2a-requeue-by-project`（按顺序）、`s2a-requeue-legacy`；
   - `s2a-round-reverify`（按顺序）和它的旧式组索引。
   - 各自登记在 codec 里。
3. 决定队列：L2–L4、L6、L8，去掉所有上限。
4. 修 `since` 丢失（L5）。

### 1.2 不在本片

- 改历史的顺序（§0.1 撤回）。
- 只对未结束的目标计算（L3，另提）。
- 执行计数、日历（2B）；工作线、状态词（2C）。
- 未接上的来源：仍报不可用。
- 跨页一致（L7）。
- 界面（E3）。

## 2. 接口

```ts
// src/core/record-store/lookup-ports.ts
export type RecordLookupIndex = {
  readonly name: string; readonly aggregateType: string; readonly paths: readonly string[];
  readonly orderBy?: { readonly path: string };          // 排序值只用文字
};
export type OrderedLookupRequest = {
  index: string;
  values: readonly (string | number | boolean)[];        // 非空标量
  direction: 'asc' | 'desc';
  bound?: { value: string; inclusive: boolean };
  after?: { order: string; refKey: string };
  limit: number;                                          // 1..200
};
export type RecordOrderedLookupPage = {
  records: EncodedRecord[];
  next: { order: string; refKey: string } | null;
  readThrough: CommitCursor | null;
};
export interface RecordLookupPort {
  lookup(request: RecordLookupRequest): Promise<StoreResult<RecordLookupPage>>;              // 不变
}
export interface RecordOrderedLookupPort {                // 单独一个端口（lead，2026-10-14）
  lookupOrdered(request: OrderedLookupRequest): Promise<StoreResult<RecordOrderedLookupPage>>;
}
//   两个后端都实现它；只有要按顺序读的地方拿 RecordLookupPort & RecordOrderedLookupPort。
//   不加进 RecordLookupPort：测试里十几个夹具对象类型写成 `… & RecordLookupPort`、只实现了 `lookup`
//   （例如 tests/helpers/graph-session-fixture.ts:80、tests/helpers/task-claim-fixture.ts:68），
//   `npm run typecheck` 包括 tests，加进去它们全要改。2C 的计数端口同样处理（2C 规格 L3）。
```

决定队列的公开契约不变。

## 3. 流程（只读，不新增状态行）

| 行 | 读什么 | 结果 |
| --- | --- | --- |
| QA1 | 队列任意一页 | 发给你的消息、所有目标及其派生来源读全；请知悉从已看位置往后读全；拼卡、分节、分页同今天 |
| QA2 | 读取中途有别的提交 | 整窗重读（L7） |

## 4. 规则

1. 待答、已答待落实的条目，不论多旧、多少，都在队列里，计数准确。
2. 成员之间的消息、已看位置之前的返工和检查，不再进入每次读取。
3. 队列里没有“容量不足”。真实的故障照实报。
4. 卡片和历史的语义与今天逐条相同；只是不再因量大而拒绝。
5. 两个后端对同一组数据、同一个按顺序查找，返回逐条相同的结果和游标。
6. 读取不写任何东西，不调用模型。

## 5. 测试（TDD，测试由 DSH 一条一条写）

做法同 K 片 §5：
- 用 `.dsh-ref/tdd/` 的 TDD skill，在确认过的入口上一条一条先写失败测试，再写实现；
- 不读数据库核对；
- 期望值来自规格或手算例子；
- 测试名以行号开头；
- 服务层的例子在内存和 SQLite 两个后端各跑一次。
- **跨过旧上限的例子**（5,001、201），两个后端都要真的跨过去。别的例子在 SQLite 上可以用小一点的量。

### 5.1 测试入口（**待用户确认**）

| 入口 | 是什么 | 能抓到 | 抓不到 |
| --- | --- | --- | --- |
| QE1 | RecordStore 的公开 `lookupOrdered`，两个后端各一份 | 排序（含非 ASCII 和同值）、候选规则、上下界、续读游标、不合法请求、建在已有行上的新索引；两个后端逐条一致 | 决定队列的业务规则；SQLite 是否真走索引（lead 另查） |
| QE2 | 业务流程：用真实的 WorkGraph 服务造数据，用公开的 `queryDecisionQueue` / `readDecisionCard` 读 | 不再拒绝；成员之间的消息不影响；翻页不重不漏；卡片和历史与今天相同 | 路由的序列化 |
| QE3 | 请知悉流程：真实的自动返工、重新检查、成员请知悉、归档时的等待处置，加 `markNoticesSeen`，再读 | 每类从已看位置往后；旧式位置；两个工作区不串；`since` 不再丢 | 界面的“已看”交互 |
| QE4 | HTTP 路由（`CORE_ROUTE_SPECS` 里的决定队列路由），背后是真实的读取，不打桩 | 跨过旧上限的结果原样传出；故障如实传出 | 浏览器 |

### 5.2 验收行为

| 行 | 入口 | 行为 | 期望值来源 |
| --- | --- | --- | --- |
| QA-01 | QE1 | 手写数据集，含非 ASCII 的 refKey、同一排序值的多条、缺排序值的行、排序值不是文字的行。正序、倒序各读：顺序、每页边界、续读游标与手算的一致；不是候选的行不出现；两个后端相同 | L1 |
| QA-02 | QE1 | 上下界含与不含；五种不合法请求各报 `invalid`；索引不存在报 `unsupported` | L1 |
| QA-03 | QE1 | 已有数据的 SQLite 库关掉、再用登记了新索引的定义打开，按顺序查找查得到旧行 | L1 |
| QA-04 | QE2 | 工作区有 5,001 条以上成员之间的消息，加 3 张待答卡、2 张已答待落实：队列返回这 5 张，计数 3 和 2，不拒绝 | L2、规则 2、3 |
| QA-05 | QE2 | 5,001 张待答卡，`limit: 50` 翻到底：张数 5,001，不重不漏；计数 5,001 | L2、L8 |
| QA-06 | QE2 | 201 个目标、未按目标筛选：不拒绝；每个目标的原因卡和今天的规则算出的一致（用其中几个目标手算） | L3 |
| QA-07 | QE2 | 规划问题：一个目标有超过 5,000 个查询任务（内存后端）时，规划问题卡照常出来，不报 `incomplete` | L3 |
| QA-08 | QE2 | 卡片语义回归：取消目标的待答卡、规划问题、冲突都进历史，只读（同 DQ07）；答过并落实的合成答复不再出现在待答 | L9、规则 4 |
| QA-09 | QE2 | `readDecisionCard` 在 5,001 条以上发给你的消息中读一张卡：内容正确，不拒绝 | L6 |
| QA-10 | QE3 | 自动返工 30 次、重新检查 10 次（真正由系统或成员发起的重新检查）、成员请知悉 20 条，标记已看到中间某处：再读只出现之后的，每类从自己的位置接着，顺序同今天的比较规则 | L4 |
| QA-11 | QE3 | 已看位置是旧式的：先出旧式组（按今天的旧式比较规则），再接按提交位置的 | L4 |
| QA-12 | QE3 | 同一项目两个工作区，各有自动返工；其中一个目标在通知被看之前就取消、另一个已完成：每个工作区只看到自己的，取消和完成的目标的通知都还在 | L4 |
| QA-13 | QE3 | 一条在等回复的消息经归档时的等待处置之后：提交位置不变，仍按提交位置出现在请知悉里，没有被已看位置挡掉 | L5 |
| QA-14 | QE4 | 经路由读 QA-05 的数据：返回第一页和游标，翻到底与 QA-05 相同；把存储设成读失败，路由报故障，不报空队列 | L8 |

另由 lead 在验收时核对，不进测试：
- 代码里不再有读所有已结束 Run 的路径；
- SQLite 的 `EXPLAIN QUERY PLAN`；
- QA-06 的规模用例的耗时，记进证据。

### 5.3 要改断言的旧测试（lead 写出前后断言，DSH 不自行翻转）

| 测试 | 怎么改 |
| --- | --- |
| `tests/work-graph/S5R2-queue-history.test.ts` R2A07 | 201 个目标不再拒绝，改成返回结果 |
| 同文件 R2A09 | 5,001 条待答请求不再拒绝；它用 `limit: 50`，改成翻页拿到全部 5,001 条 |
| 同文件 R2A01–06、R2A08 | **不翻转** |
| `tests/work-graph/S5-decision-queue.test.ts`、`S5-notices.test.ts`、`tests/app/S5-decision-routes.test.ts` | **不翻转**；DSH 跑一遍确认 |

## 6. 文件（影响面；施工时以实际为准，超出要报）

- **RecordStore：** `src/core/record-store/lookup-ports.ts`、`lookup-index.ts`、`in-memory-record-store.ts`、`sqlite-record-store.ts`。
- **索引登记：**
  - `src/core/work-graph/sessions/message-record-codecs.ts`；
  - `src/core/work-graph/tasks/claim-record-codecs.ts`（重排）；
  - `src/core/work-graph/persistence/evidence-record-codecs.ts`（检查轮次）。
- **决定队列：**
  - `src/core/work-graph/views/decision-read-model.ts`（只改数据来源和上限）；
  - `goal-conflicts.ts`、`automatic-rework-notices.ts`；
  - `src/core/work-graph/tasks/plan-readers.ts`（候选读取的上限）；
  - `planning-question-reader.ts`。
- **`since` 修复：** `src/core/work-graph/communication/mailbox-service.ts`，以及审计中发现的其它写入。
- **测试：** 新测试由 DSH 写；旧测试按 §5.3。

## 7. 施工

- 一个副本、一个新的 DSH Session。按 QE1 → QE2 → QE3 → QE4 分组。
- **大数据集的夹具由 Codex 写**，用真实服务造：5,001 条成员消息、5,001 张待答卡、201 个目标、5,001 个查询任务。lead 核对后冻结。
- 其余同 K 片 §7：每组派一个只读复查子任务；之后 lead 核对、Codex 审；全量测试；合入。

## 8. 不做的事

- 不把 5,000 调大了事；
- 不改卡片的拼法、合并、状态和顺序；
- 不改已看位置的写入；
- 不改稳定窗口；
- 不接新的来源；
- 不调用真实模型。
