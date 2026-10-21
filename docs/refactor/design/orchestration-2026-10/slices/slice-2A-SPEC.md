# 2A 片规格：决定队列只读相关的条目，不再拒绝，完整分页

**后注（决定 86-6，lead 2026-10-21）：** QA-04、QA-05、QA-06（`tests/work-graph/S2A-queue-bounds`）、QA-07 和 QA-09（一）（`S2A-queue-derived-cards`）、QA-09（二）（`S2A-queue-request-candidates`）、QA-10（二）（`S2A-notices-overbound`）、QA-14（一）（`tests/app/S2A-decision-routes`）和 L11 的 201 次自动返工（`S2A-notices-attempt`）在规模批里核：原规模的用例原样挪进同名的 `.scale.test.ts`（两种后端、原数量、原断言、原超时，不注入页宽，所以也核了生产的默认页宽），`npm run test:scale` 每片合入前和全量一起跑；日常套件（`npm test`，CI 也只跑它）的同名文件里是同一组断言的小版本：测试经 owner 的依赖传入小页宽，每层读取至少跨两页，决定那一条在最后一页，每层的顺序和分页手算写在注释里。正文原样保留，只加此注。拆分经过见 [证据](../../../reviews/evidence/scale-split-sc-2026-10-21/README.md)。QA-14（二）是读失败，不需要规模，只在日常文件里；QA-17 没拆（不做接缝 H）。

**后注（决定 60、62）：** 后来的决定改写了本规格的这几处：
- L6（约 140 行）、L8（约 148 行）：决定 60-8/62-2 的项目级卡源（上限 `role_capacity`、角色线变动 `role_line_change`、结构修订提议）和决定 62 的规则记录，要沿本规格已接管的单卡/队列完整读取（分页、计数、历史、水位）接入，不另起一套读取；由第 7 片 7D 改。
- 正文原样保留，只加此注。

> **已合入（2026-10-15）。** 施工四轮，经过和验收见[证据目录](../../../reviews/evidence/orchestration-slice-2A-2026-10-14/README.md)；施工和验收中定下的读法见 §10，和正文同等有效，有冲突时以 §10 为准。下面的状态说明保留作记录。

> **状态：lead 起草，2026-10-13；按 Codex 审查（`D:/cc-lead-notes/codex2/s2arev.out.md`，结论“不能冻结”，15 条）重写一轮。测试入口用户已同意（决定 51）。2026-10-14 lead 把按顺序查找挪到单独的端口（L1、§2），合入顺序改成接线包 2 → K 片 B → K 片 A → 2A。2026-10-14 按 Codex 第二轮审查（`D:/cc-lead-notes/codex2/s2a-spec2.out.md`，7 条）改了一轮，同日按 2C 的审查加了整数排序（D8）；怎么处理的见 §9。lead 2026-10-14 逐行审过；Codex 第三次复核（改完后冻结）的四条和附注已照改（§9）。2026-10-14 冻结。**
> - 代码基线：ee9e7a33 的工作树，第 5 片已合入。第二轮审查对的是 5893c271，代码相同。
> - 接线包 2 的代码不在这个基线里。§0.4 表里接线包 2 的几行按它的规格行号写；接线包 2 合入以后、施工以前，在合入后的基线上重核文件和行号。
> - 依据：
>   - HANDOFF 决定 42、48、49（第 28 项选 (a)）、50（第 2 片拆成 2A/2B/2C）、51（测试入口）；
>   - DESIGN §1.4、§6“第 2 片补齐决定队列的规模读取”；
>   - [lead 答复页第 28 项](../model/REVIEW-SLICES-2-4-6-7-LEAD-ANSWERS.md)；
>   - [接线包 2 规格](wiring-2-SPEC.md) L6、L7（它加的临时防护，写明第 2 片要撤）；
>   - 代码事实：`D:/cc-lead-notes/codex2/s2facts.out.md` 第 15 项；2026-10-13 的决定队列读取图（子任务只读整理）；Codex 两轮审查对字段路径和两个后端的核对；
>   - lead 2026-10-14 的 D1–D8（第二轮审查和 2C 审查之后）。
> - 2B（执行计数、日历）要用本片的“按顺序查找”，所以 2A 先做。2C 也用它，包括整数排序（D8）。

## 0. 冻结说明（lead）

### 0.1 要用户定的

- **已定：** 第 28 项选 (a)。具体是：
  - 缩窄读取范围，完整分页；
  - 待答和已答待落实不因时间久而丢弃；
  - 请知悉按类别的已看位置往后读；
  - 200 个目标的上限一并处理；
  - 读取故障仍报故障，局部数不当总数。
- **已定（决定 51）：** §5.1 的四个测试入口，用户 2026-10-13 同意。
- **第一稿里“历史改成最新在前”撤回。** 审查指出：记录上能排序的位置是“卡出现的时候”，不是“最后处理的时候”。按它排出来的“最新”会误导人；要按处理时间排，得另存一个位置。这不是第 28 项要解决的事，本片不改历史的顺序。

### 0.2 今天的问题（代码事实）

- **读得太宽。**
  - 消息按“工作区 + 状态”整批读，`pending`、`read`、`responded` 各一遍，成员之间的消息也在里面。
  - 自动返工的通知要读工作区里所有已结束的 Run、所有检查轮次。
- **到上限就整个拒绝。**
  - 每个来源最多 5,000 条、25 页，超了整个队列报 `capacity`；
  - 没按目标筛选、目标超过 200 个，也整个拒绝；
  - 候选计划、规划问题自己的读取超过 25 页报 `incomplete`；
  - **共用的读取也有上限。** 目标原因卡经 `queryTaskGraph`（`tasks/goal-decision-reader.ts:210`）和 `queryGoalDisplay`（`:266`）读任务事实，两者都走 `readCanonicalTaskFacts`。它按目标读执行用的 `readLookupKeys` 超过 25 页报 `incomplete`（`tasks/plan-readers.ts:481–510、1431–1434`）。一个目标的执行超过 5,000 个，原因卡就算不出来，整个队列失败。
  - **接线包 2 加的临时防护。** 待答卡进上下文提醒的读取，最多 50 页/5,000 张；未送达回复来源的目录、每条线、输出各有上限。超了都报 `capacity`。接线包 2 自己写明第 2 片要撤（wiring-2-SPEC.md:55）。
- **一个会丢通知的缺陷。** 归档时处置等待的那条写入（`mailbox-service.ts` 的 `writeArchiveWaitDisposal`）重新编码消息时丢了提交位置 `since`。那条消息从此按“旧式位置”排，可能被已看位置挡掉。

### 0.3 lead 定的技术选择

**总的做法：** 卡片怎么拼、怎么合并、最终状态怎么定、怎么分节、怎么在内存里分页，这条现有的流水线**一点不改**（`readDecisionQueueWindow` 里的 `messageCard`、`syntheticAnswerCard`、`candidateCard`、`mergeCards`、`finalizeCard`、`sortCards`，游标格式 `v: 1`）。本片只改两件事：
- 喂给它的数据只取相关的；
- 去掉所有让整个队列拒绝的“到上限就拒绝”（§0.4 的表）。领域上限不动。

这样卡片的语义、合并和历史都保持今天的样子。审查指出的“答过的卡重新冒出来”“候选链选错”“取消目标的历史丢失”都不会发生。

- **L1 RecordStore 加“按顺序查找”，两个后端行为一致。**（lead 2026-10-14 按 D3、D4、D8 补全）
  - **登记：** `{ name, aggregateType, paths, orderBy?: { path, valueType?: 'text' | 'integer' } }`。
    - `orderBy.path` 用等值路径的同一套安全路径规则校验（`record-store/lookup-index.ts:44–50`），登记后和 `paths` 一起留在登记表里（同 `:83–85` 的复制）。不合法照今天报登记错误。
    - `valueType` 缺省是 `'text'`，2A、2B 的索引都用它。只能是 `'text'` 或 `'integer'`，别的报登记错误（D8）。
  - **哪些行是候选**（看排序值，D4、D8）：
    - `text` 索引：排序值是非空文字。缺失、`null`、不是文字、空字符串 `""` 的行都不是候选。`since` 是定长的 `c` 加 10 位数字（`contracts/ledger.ts:87–92`），文字序就是提交序；ISO 时间也是文字。
    - `integer` 索引：排序值是 JSON 整数（SQLite 里 `json_type = 'integer'`），并且是安全整数（±(2^53−1) 以内）。`real` 的行（如 `2.5`）、数字样子的文字（如 `"10"`）、`null`、缺失都不是候选。记录都由编码器的 `JSON.stringify` 写出，整数不会写成 `2.0`，两个后端判得一样。
    - 这样排序时不出现空值。不是候选的行另用普通等值查找读（L4 的旧式组）。2C 的计数用同一条候选规则（2C L3）。
  - **等值部分只用文字**（D3）：
    - 请求的 `values` 每一个都必须是非空文字；`null`、数字、布尔、`""` 都报 `invalid`。
    - SQLite 对每个等值路径比 `json_type = 'text'` 和相等。这样每个请求只约束一段连续的索引前缀，排序那一列在这段里是连续的。
    - 原因：今天数字等值的谓词是 `json_type IN ('integer','real')`（`sqlite-record-store.ts:111–115`），而索引把 `json_type` 放在排序列前面（`:86–95`）。一个数字等值会跨两段各自排好序的范围。
    - 普通 `lookup` 不变。
    - lead 2026-10-14 核过 2A、2B（L14）、2C（L4）要登记的按顺序索引：等值路径都是文字（各种 id、`lifecycle`、`relation`、`target.kind`、`chain.reverify.actorClass`）。以后要非文字的等值路径，另议，不放宽这一条。
    - 2C 的 `s2c-work-claim-by-session-at` 改成按领取的 `generation`（整数）排序的 `integer` 索引，2C 会改名（D8；`tasks/claim-service.ts:1061–1089`；今天 `tasks/session-facts.ts:240` 取最大的 generation）。
  - 放在单独的端口 `RecordOrderedLookupPort` 上，`RecordLookupPort` 不变（§2，lead 2026-10-14）。
  - **请求** `lookupOrdered`：
    - `values`：等值部分，每个路径一个非空文字。
    - `direction`：`'asc' | 'desc'`。
    - `bound?: { value, inclusive }`：正序时是下界，倒序时是上界。
    - `after?: { order, refKey }`：上一页最后一条，不含。
    - `bound.value`、`after.order` 的类型跟着索引：`text` 索引是非空文字，`integer` 索引是安全整数。
    - `limit`：1–200 的整数。
  - **请求不合法报 `invalid`，不抛异常**（D4）：
    - 请求不是对象；`index` 不是非空文字；
    - 索引登记了但没有排序；
    - `values` 不是数组、个数不对、有一个不是非空文字；
    - `direction` 不是 `'asc'` 也不是 `'desc'`；
    - `limit` 不是 1–200 的整数（`0`、`201`、`1.5`、`"10"` 都不行）；
    - 给了 `bound`，但它不是对象，或 `inclusive` 不是布尔，或 `value` 的类型和索引不符；
    - 给了 `after`，但它不是对象，或 `order` 的类型和索引不符，或 `refKey` 不是同一个聚合类型的规范 refKey。
    - 索引不存在：`unsupported`。
  - **返回哪些、什么顺序：**
    - 只返回候选。
    - 先按排序值，再按完整规范 refKey。`text` 的排序值按 UTF-8 字节序（SQLite 的 BINARY；内存后端用 `Buffer.compare`，不用 JS 字符串比较）。`integer` 的排序值按数值比。refKey 总是按 UTF-8 字节序。倒序时两者都倒过来。
    - `bound` 和 `after` 一起给，两个条件都要满足（取交集）。`after` 在下界之前时，结果从下界开始。
    - `next`：这一页最后一条之后，这个请求再没有候选，`next` 为 `null`；否则是最后一条的 `{ order, refKey }`。所以不足 `limit` 条的页、空页，`next` 一定是 `null`；正好 `limit` 条而后面没有了，也是 `null`。做法同今天的 `lookup` 多取一条来判断（`sqlite-record-store.ts:553–563`）。
    - 每页返回 `readThrough`。
  - **续读：**
    - 续读带同一个 `index`、`values`、`direction`、`bound`，只换 `after`。调用方（决定队列、2B、2C）翻页时自己保持这四项不变。
    - 存储不记上一次请求。能从请求本身看出来的错（`after` 的类型或聚合类型不对）报 `invalid`。看不出来的（换了 `values` 或 `bound` 又带着旧的 `after`），按一次新的读取回答：结果就是新请求的候选里满足 `bound`、排在 `after` 之后的那些，不保证是旧请求的下一页。
  - **SQLite：**
    - 索引列依次是：aggregateType、各等值路径（`json_type`、`json_extract`）、`json_extract(排序路径)`、`ref_key`；
    - 索引名的指纹把 `orderBy.path` 和 `valueType` 都算进去（缺省按 `'text'` 算）；
    - 查询：
      - 等值：每个路径 `json_type = 'text'` 加相等；
      - 候选：`text` 是 `json_type(排序路径) = 'text'` 且不等于 `''`；`integer` 是 `json_type(排序路径) = 'integer'` 且在安全整数范围内；
      - 下/上界只比排序值：正序 `排序值 >= bound`（不含时 `>`），倒序 `排序值 <= bound`（不含时 `<`）；
      - 续读用 `(排序值, ref_key)` 的行值比较：正序 `> (after.order, after.refKey)`，倒序 `<`（两边都非空，不受 NULL 影响）；
      - 两个条件都给时用 `AND` 连起来（lead 2026-10-14，第三次复核第 2 条）；
      - `ORDER BY 排序值, ref_key`，方向一致。
    - 等值前缀固定，排序值在这段里连续，一段扫下来就是顺序，不另排序。
    - 新索引在打开数据库时建在已有的行上（今天的做法）。
  - 内存后端可以每次调用时排序，语义必须和 SQLite 逐条相同（整数按数值，文字按 `Buffer.compare`）。每页仍返回 `readThrough`。
  - **验收时 lead 另做一项**（D3）：用 `EXPLAIN QUERY PLAN` 看 2A 的每个按顺序查询（正序、倒序、带 `bound` 和 `after`）：走这个索引，按前缀范围查找，**没有** `USE TEMP B-TREE FOR ORDER BY`。只看到索引名不算。2A 自己的索引都是文字的，所以再在 QE1 的测试库上登记一个 `integer` 索引，同样看正序、倒序、带 `bound` 和 `after` 的四种计划（第三次复核第 3 条）。这不进单元测试。
  - 今天的 `lookup` 不变。
- **L2 消息只读发给你的。**
  - 新等值索引 `s2a-user-messages`：`ref.projectId`、`ref.workspaceId`、`recipient.kind` → `user`。按页读到底，没有条数上限。
  - 它代替今天按状态读三遍的 `loadWorkspaceMessages`。读出来以后的过滤、拼卡、成员请知悉，和今天一模一样。
  - 成员之间的消息不再读。发给你的消息由人的处理速度和成员发请知悉的速度决定。规模测试放 5,000 条以上，记下耗时。
  - 按目标筛选时照今天在内存里过滤。今天就登记了、但没用上的 `s5-user-message-by-goal` 本片不用。
- **L3 目标、候选、规划问题、冲突：分页读到底，不拒绝；计算范围和今天一样。**
  - 目标列表（`listWorkspaceGoals`）按页读到底。删掉 `GOAL_LIMIT` 和 5,000 条的拒绝。
  - 目标原因卡、规划问题、目标冲突仍对列出的**所有**目标算，和今天一样。这样取消、完成的目标上的卡，照今天进历史或留在原处，不改语义。目标冲突读自己的目标列表时，今天不检查截断，改成同样读到底。
  - 候选（`enumerateGoalCandidates`、`enumerateClosedGoalCandidates`）的 25 页上限在共用的 `readLookupKeys` 里，按 L10 改成读到底，不再报 `incomplete`。目标原因卡读任务事实也靠它（L10）。
  - 规划问题（`planning-question-reader.ts:57–58、101–120`）自己的 25 页上限去掉，按页读到底，不再报 `incomplete`。
  - **代价如实写明：** 每次读队列，对每个目标都要算一遍。
    - **计时数据集**（lead 量）：300 个目标，250 个已结束。**记下耗时，不设断言。**
    - 它和 QA-06 的**验收数据集**（201 个目标）是两套，不混用。
    - 真慢了，另提“目标上记终态、只算未结束的”。那会改取消目标的历史，要先定语义，不在本片。
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
    | 自动返工的重新检查 | 按顺序索引 `s2a-round-reverify`：等值 `ref.projectId`、`ref.workspaceId`、`chain.reverify.actorClass`（`system`、`agent` 各一次），按 `since`；旧式组用等值索引 `s2a-round-reverify-legacy`，同样三个路径再加 `since` 取 `null` | **索引只用来找出有新轮次的检查主体**（主体 = 轮次 ref 去掉 `roundId`，同 `roundChainHead` 的判断）。每个主体再经已有的主体索引 `VerificationRoundBySubject`（`persistence/evidence-record-codecs.ts:674–677`，同 `readRunRoundChain`）把整条链读一次，照今天用 `roundChainHead`（`state/verification-machine.ts:479–519`）核对，同 `automatic-rework-notices.ts:118–153`；链出错照今天报。链里更早的轮次、人发起的重新检查，只用来核对，**从不作为通知出现**；出通知的只有索引找出的、系统或成员发起的那些轮次（lead 2026-10-14，D2） |

  - 不再读所有已结束的 Run。决定 49 写的是“已结束执行按时间窗口读”，这里用提交位置作窗口：重排和检查轮次自己带 `since`，从已看位置往后读，只读新的，也不会漏掉迟写的记录。
  - **代价如实写明：**
    - 你一直不标“已看”，读的量就一直涨。这和今天一样，今天还要先读全部已结束的 Run。本片不加计数上限。
    - 每个有新轮次的主体，多读一次整条链。链长有合法上限（`ROUND_CHAIN_MAX`），这是领域上限，照旧。
    - 一次稳定尝试里每个来源只拼一次（L11）。
- **L5 修掉丢 `since` 的写入。** `writeArchiveWaitDisposal` 改成保留原来的提交位置，和其它更新一样经 `preservedNoticeOrigin`。再查一遍所有重新编码消息、重排、检查轮次、候选的写入，都要保留 `since`。
- **L6 单张卡的读取（`readDecisionCard`）一并去掉上限。**
  - 答复索引（`findAnswerMessage`，`decision-read-model.ts:1068–1094`）、请求的候选（`findCandidateProposal`，`:1117–1148`）按页读到底，不再报 `capacity`。
  - 注入来源（规划问题等）按页读到底（`:823–843`）。读完了还找不到，才是没有这张卡；不再因超量报 `unavailable`。
- **L7 稳定窗口照旧：一共读 4 次。**（lead 2026-10-14，D5）
  - 读取中途账本有新提交，整窗重读。一共 4 次：第一次加最多 3 次重读，同今天（`decision-read-model.ts:111–112、244–251`）。
  - 4 次都被打断：报 `unavailable`。不返回混在一起的计数，不发展示令牌。
  - 2B 已按“一共 4 次”对齐（2B L17）。
  - 跨页没有快照：两页之间有人答了卡，卡可能换到别的节。这是今天就有的“边翻边变”，本片不改，也不承诺跨页一致。
- **L8 队列里不再有 `capacity` 拒绝，也不再因超量报 `incomplete`。**
  - 包括接线包 2 的 `decision_index_page_limit`、`undelivered_reply_page_limit`。
  - 存储故障、窗口一直不稳、来源不可用，照今天报。领域上限（检查链长度）造成的拒绝照旧。
  - 计数的含义全照今天。
- **L9 不改的：**
  - 卡片内容、合并、最终状态、分节、排序、游标（`v: 1`）；
  - 计数和 `countsComplete`；
  - 请知悉的已看位置和令牌；
  - 各来源的可用性报告；
  - 路由的形状。
- **L10 队列读取依赖的共用读取也读到底；领域上限不动。**（lead 2026-10-14，D1）
  - **总规矩：** 决定队列（含单张卡、请知悉、接线包 2 接的两处）的推导依赖哪个共用的读取，那个读取就按页读到底，没有页数、条数上限。真正的领域上限（检查链的合法长度、写入大小）留着。每页的大小也留着。
  - **`readLookupKeys`**（`tasks/plan-readers.ts:96–97、481–510`）去掉 25 页的上限，读到底。
    - 它是共用的。除了候选、目标原因卡，还被 `findPendingProposal`、`readRequestCandidateHead`、`readGoalRunsForCount`、`readCanonicalTaskFacts`、`readFutureChangeTaskFacts` 用。
    - 行为只在今天超过 5,000 个键、报 `incomplete` 的读上变：不再因量大拒绝。数据坏、窗口不稳、领域检查照旧报。其余读取的结果和今天相同。
  - **`queryTaskGraph` 的其他调用方**，结果和今天相同；只有今天超上限而失败的目标，改成成功：
    - `app/attention-observer.ts:674`、`app/startup-reconcile.ts:385`、`app/core-routes.ts` 的 `tasks/query` 路由（`:286`、`:734`）；
    - `business/workflow/workflow.ts:1241、1265、1601、1663、1998`，`session-archive.ts:259、278`，`session-maintenance.ts:245`；
    - `core/agent-runtime/whiteboard-tools.ts:300`；
    - `views/graph-context-reader.ts:740、833`。
    - `queryGoalDisplay`，以及直接调 `readCanonicalTaskFacts` 的读写路径（`claim-service.ts:974`、`completion.ts:341、558`、`context-input-service.ts:565`）同理。
  - **`lookupAll`**（`views/goal-conflicts.ts:139–178`）去掉 5,000 的 `cap`，读到底，不再给 `truncated`；它的 4 次稳定窗口留着。它的调用方都在队列路径上（目标列表、答复索引、请求的候选；旧的消息和返工读取由 L2、L4 换掉）。
  - **接线包 2 的两处临时防护撤掉**（§0.4）。
  - 已有的 `capacity` 断言不成批翻转：写入大小的上限仍然有效（§5.3）。
- **L11 一次稳定尝试里，每个来源只拼一次。**（lead 2026-10-14，D7）
  - 今天有的来源每读一页，就把整个集合重拼一遍：
    - 成员请知悉每页都把合格的消息逐条重读一遍（`decision-read-model.ts:998–1034`）；
    - 规划问题每页都重开一遍答复（`planning-question-reader.ts:137–159、201–208`）。
    - 上限去掉以后，内部翻 n 页就是 n 遍。
  - 改成：一次稳定尝试里，每个来源的集合只拼一次，内部翻页复用它；整窗重读时重新拼。不跨尝试、不跨调用缓存。
  - 无界的展开追加改成循环或 `concat`，免得条数大时撞上引擎的参数个数上限。例如 `messages.push(...loaded.messages)`（`:344`）、`allNotices.push(...)`（`:517`）、`orderedCards.push(...)`（`:527–529`），以及 `readLookupKeys` 一带的 `tasks/plan-readers.ts:745`、`:1728`（去掉上限以后它们的展开参数也没有上限）。
  - 卡片、通知的内容、顺序、计数都不变。
  - 外层每翻一页（下一页队列）仍要整窗重读一遍，这是今天就有的，本片不改（L7）。所以计时量的是完整翻页，不是一次请求（§5.2）。

### 0.4 2A 去掉哪些上限（lead 2026-10-14，D1）

**分法：** 超了就让整个队列（或整个请知悉来源、整次上下文准备）拒绝的上限，2A 去掉，改成按页读到底。单条记录的领域上限（检查链的合法长度、写入大小）和每页的大小留着。

接线包 2 的代码还没合入。它那几行按它的规格行号写；合入以后、施工以前，在合入后的基线上重核文件和行号。下表 WorkGraph 路径省略 `src/core/work-graph/`，RecordStore 路径省略 `src/core/`。

| 文件（位置） | 上限 | 留/去 | 理由 |
| --- | --- | --- | --- |
| 接线包 2：`views/context-extensions.ts` 的待答卡提醒（wiring-2-SPEC.md:55 L6；:235 §4.3 第 1 条） | 每页 100，最多 50 页/5,000 张；还有下一页报 `capacity/decision_index_page_limit:` | 去 | 超了整次上下文准备失败；接线包 2 自己写明第 2 片要撤 |
| 接线包 2：`views/undelivered-reply-notices.ts` 的 Session 目录（wiring-2-SPEC.md:56 L7；:250 §4.4 第 7 条） | 每页 100，最多 50 页 | 去 | 超了整个来源报 `capacity/undelivered_reply_page_limit:`，队列跟着拒绝 |
| 同上，每条不可用的线的回复来源 | 每页 100，最多 50 页 | 去 | 同上 |
| 同上，去重后的输出 | 最多 5,000 条 | 去 | 同上 |
| 同上，列 Session 时经 `findSessions`（`sessions/session-directory.ts:1675`）给每个 Session 读全部负责链接，单个 Session 超过 2,000 条报 `capacity`（`:1199`） | 每个 Session 2,000 条链接 | 不在队列路径上（lead 2026-10-14，第三次复核第 1 条） | 未送达回复的来源改成按 Session 索引列 Session、只看 Session 记录上的健康，不读链接；`findSessions` 和它的上限照旧，留给它别的调用方。`findSessions` 的 `MAX_DIRECTORY_SCAN` 给续读游标、不整个拒绝，也不在这条路径上 |
| 同上，整窗尝试 | 最多 4 次 | 留 | 稳定窗口，不是量的上限（L7） |
| 同上，来源请求的 `page.limit` | 1–200 | 留 | 每页大小，请求校验 |
| `views/decision-read-model.ts:104–107`，用在 `:421–438`（卡来源）、`:495–513`（请知悉类别）、`:823–843`（单张卡的派生来源） | 每个来源 25 页/5,000 条 | 去 | 超了整个队列 `capacity`，单张卡 `unavailable`。`SOURCE_PAGE_LIMIT`（200）留作每页大小 |
| `decision-read-model.ts:108–109、300–302` | 不筛目标时最多 200 个目标 | 去 | 整个队列 `capacity` |
| `decision-read-model.ts:297–299` | 目标列表截断就 `capacity` | 去 | 同上；`listWorkspaceGoals` 读到底 |
| `decision-read-model.ts:338–343` | 消息窗口截断就 `capacity` | 去 | 同上；L2 换掉 `loadWorkspaceMessages` |
| `decision-read-model.ts:1087–1092` | 答复索引截断就 `capacity` | 去 | 单张卡整个拒绝（L6） |
| `decision-read-model.ts:1143–1148` | 请求的候选索引截断就 `capacity` | 去 | 同上 |
| `views/goal-conflicts.ts:139–178`（`lookupAll`） | `cap = 5000` | 去 | 共用，调用方都在队列路径上（L10）。它的 4 次稳定窗口留着 |
| `tasks/plan-readers.ts:96–97、481–510`（`readLookupKeys`） | 25 页，超了 `incomplete` | 去 | 共用。候选、目标原因卡（经 `queryTaskGraph`、`queryGoalDisplay` → `readCanonicalTaskFacts`，`:1431–1434`）都靠它（L10） |
| `tasks/planning-question-reader.ts:57–58、101–120` | 25 页，超了 `incomplete` | 去 | 整个来源失败，队列跟着失败 |
| `views/automatic-rework-notices.ts:72–78、121–124` | 已结束 Run、检查轮次的窗口超了 `capacity` | 去 | 连宽读一起换掉（L4） |
| `decision-read-model.ts:270–271` | 队列每页 1–100 | 留 | 每页大小 |
| `record-store/lookup-index.ts:136–139`，以及 L1 的按顺序查找 | 每页 1–200 | 留 | 每页大小 |
| `persistence/evidence-record-codecs.ts:656`；`tasks/plan-readers.ts:1164–1190` | 一条检查链最多 `ROUND_CHAIN_MAX` 轮 | 留 | 合法链长，领域上限 |
| 写入大小，例如 `communication/mailbox-service.ts:474`、`communication/decision-service.ts:593–596、702` | 文本、注解的字节数 | 留 | 写入上限；已有的 `capacity` 断言照旧 |
| `decision-read-model.ts:111–112、244–251`；`goal-conflicts.ts:70–71` | 稳定窗口 4 次 | 留 | L7 |

不在队列读取路径上的上限，本片不动。例如 `tasks/goal-settings-service.ts:211–239`（排序写入时的目标列表）、`tasks/reconcile-reads.ts:43–70`、会话异常的读取（`tasks/session-anomaly-service.ts:80–85`、`tasks/run-state-service.ts:405–439`）。

## 1. 范围

### 1.1 交付

1. RecordStore：按顺序查找（登记含 `valueType`、请求校验、两个后端）。
2. 新索引：
   - `s2a-user-messages`；
   - `s2a-requeue-by-project`（按顺序）、`s2a-requeue-legacy`；
   - `s2a-round-reverify`（按顺序）、`s2a-round-reverify-legacy`。
   - 各自登记在 codec 里。
3. 决定队列：L2–L4、L6、L8、L11，去掉 §0.4 表里标“去”的上限。
4. 共用读取读到底（L10）：`readLookupKeys`、`lookupAll`。
5. 撤掉接线包 2 的两处临时防护（§0.4）。
6. 修 `since` 丢失（L5）。

### 1.2 不在本片

- 改历史的顺序（§0.1 撤回）。
- 只对未结束的目标计算（L3，另提）。
- 执行计数、日历（2B）；工作线、状态词（2C）。
- 未接上的来源：仍报不可用。
- 跨页一致（L7）。
- 领域上限，以及不在队列读取路径上的上限（§0.4 表下）。
- 界面（E3）。

## 2. 接口

```ts
// src/core/record-store/lookup-ports.ts
export type RecordLookupIndex = {
  readonly name: string; readonly aggregateType: string; readonly paths: readonly string[];
  readonly orderBy?: { readonly path: string; readonly valueType?: 'text' | 'integer' };   // 缺省 'text'（D8）
};
export type OrderedLookupValue = string | number;        // text 索引：非空文字；integer 索引：安全整数
export type OrderedLookupRequest = {
  index: string;
  values: readonly string[];                             // 等值部分：每个都是非空文字（D3）
  direction: 'asc' | 'desc';
  bound?: { value: OrderedLookupValue; inclusive: boolean };
  after?: { order: OrderedLookupValue; refKey: string };
  limit: number;                                         // 1..200 的整数
};
export type RecordOrderedLookupPage = {
  records: EncodedRecord[];
  next: { order: OrderedLookupValue; refKey: string } | null;   // 后面再没有候选时为 null（L1）
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

// src/core/record-store/lookup-index.ts
//   RegisteredLookupIndex 加 orderBy?: { path: string; valueType: 'text' | 'integer' }，
//   登记时校验并保留（L1）；请求的运行时校验和 decodeLookupRequest 放在一处，两个后端共用。
```

运行时的类型不可信：上面的类型只是约定，`lookupOrdered` 收到什么都按 L1 的清单校验，不合法报 `invalid`，不抛异常。

决定队列的公开契约不变。

## 3. 流程（只读，不新增状态行）

| 行 | 读什么 | 结果 |
| --- | --- | --- |
| QA1 | 队列任意一页 | 发给你的消息、所有目标及其派生来源读全；请知悉从已看位置往后读全；拼卡、分节、分页同今天 |
| QA2 | 读取中途有别的提交 | 整窗重读；一共 4 次，都被打断报 `unavailable`（L7） |

## 4. 规则

1. 待答、已答待落实的条目，不论多旧、多少，都在队列里，计数准确。
2. 成员之间的消息、已看位置之前的返工和检查，不再进入每次读取（检查链只作核对时例外，L4）。
3. 队列里没有“容量不足”。真实的故障照实报；领域上限（检查链长度、写入大小）照旧。
4. 卡片和历史的语义与今天逐条相同；只是不再因量大而拒绝。
5. 两个后端对同一组数据、同一个按顺序查找，返回逐条相同的结果和游标（文字和整数排序都是）。
6. 读取不写任何东西，不调用模型。

## 5. 测试（TDD，测试由 DSH 一条一条写）

做法同 K 片 §5：
- 用 `.dsh-ref/tdd/` 的 TDD skill，在确认过的入口上一条一条先写失败测试，再写实现；
- 不读数据库核对；
- 期望值来自规格或手算例子。**期望的标识、顺序、计数都在夹具或测试里写成字面值，不用产品的比较函数算**（包括 `compareNoticePositions` 和 L1 的排序）。“同今天”只是保留的指引，不当期望的来源；
- 测试名以行号开头；
- 服务层的例子在内存和 SQLite 两个后端各跑一次。
- **跨过旧上限的例子**（5,001、201），两个后端都要真的跨过去。别的例子在 SQLite 上可以用小一点的量。
- 替身只用在系统边界：QA-16 的存储端口替身（中途提交），QA-14 的存储端口包装（让读失败）。路由和业务读取都是真的。

### 5.1 测试入口（用户 2026-10-13 已同意，决定 51）

| 入口 | 是什么 | 能抓到 | 抓不到 |
| --- | --- | --- | --- |
| QE1 | RecordStore 的公开 `lookupOrdered`，两个后端各一份 | 文字排序（含非 ASCII 和同值）、整数排序、候选规则、上下界、续读游标、不合法请求、登记校验、建在已有行上的新索引；两个后端逐条一致 | 决定队列的业务规则；SQLite 是否真走索引、有没有另排序（lead 另查） |
| QE2 | 业务流程：用真实的 WorkGraph 服务造数据，用公开的 `queryDecisionQueue` / `readDecisionCard` 读 | 不再拒绝；成员之间的消息不影响；翻页不重不漏；卡片和历史与今天相同；稳定窗口（存储边界的提交替身） | 路由的序列化 |
| QE3 | 请知悉流程：真实的自动返工、重新检查、成员请知悉、归档时的等待处置、未送达回复（接线包 2），加 `markNoticesSeen`，再读 | 每类从已看位置往后；旧式位置；检查链的核对；两个工作区不串；`since` 不再丢 | 界面的“已看”交互 |
| QE4 | HTTP 路由（`CORE_ROUTE_SPECS` 里的决定队列路由），背后是真实的读取，不打桩 | 跨过旧上限的结果原样传出；故障如实传出 | 浏览器 |

### 5.2 验收行为

| 行 | 入口 | 行为 | 期望值来源 |
| --- | --- | --- | --- |
| QA-01 | QE1 | 手写数据集（`text` 索引）：<br>- 非 ASCII：排序值和 refKey 里有 `'\u{E000}'` 和 `'\u{10000}'`。JS 的 UTF-16 比较里后者在前（`D800` 小于 `E000`），UTF-8 字节序里前者在前（`EE` 小于 `F0`）；期望按字节序；<br>- 同值跨页：三条同一个排序值，`limit: 2`，第二页按 refKey 接着，不重不漏；<br>- 不是候选的行：缺排序值、`null`、数字、布尔、`""`。<br>正序、倒序各读到底：每页的标识序列和 `next` 写成字面值（手算）；不是候选的行不出现；最后一页（含正好 `limit` 条的那种）`next` 为 `null`；两个后端相同 | L1 |
| QA-02 | QE1 | - 下界、上界的含与不含；<br>- `bound` 和 `after` 一起给（取交集，手算）：正序、下界 `"b"` 含、`after` 在 `"c"` 的那条上，结果从它之后开始；`after` 在下界之前，结果从下界开始；<br>- 不合法请求逐条报 `invalid`、不抛：`direction` 错；`limit` 为 `0`、`201`、`1.5`、`"10"`；`values` 个数不对或含 `null`、数字、布尔、`""`；`bound` 缺 `inclusive` 或值的类型不对；`after` 缺 `refKey`、refKey 是别的聚合类型或 `order` 的类型不对；索引没登记排序；<br>- 索引不存在报 `unsupported`；<br>- 登记时 `orderBy.path` 不是安全路径、`valueType` 不是两种之一，报登记错误 | L1 |
| QA-03 | QE1 | 已有数据的 SQLite 库关掉、再用登记了新索引的定义打开，按顺序查找查得到旧行 | L1 |
| QA-04 | QE2 | 工作区有 5,001 条以上成员之间的消息，加 3 张待答卡、2 张已答待落实：队列返回这 5 张，计数 3 和 2，不拒绝 | L2、规则 2、3 |
| QA-05 | QE2 | 5,001 张待答卡，`limit: 50` 翻到底：张数 5,001，不重不漏；计数 5,001 | L2、L8 |
| QA-06 | QE2 | 201 个目标（验收数据集，不是 L3 的 300 个目标的计时数据集）、未按目标筛选：不拒绝；每个目标的原因卡和今天的规则算出的一致（用其中几个目标手算，写成字面值） | L3 |
| QA-07 | QE2 | 规划问题：一个目标有 5,001 个查询任务，**两个后端都跑**：规划问题卡照常出来，张数是字面值，不报 `incomplete` | L3、L10 |
| QA-08 | QE2 | 卡片语义回归：取消目标的待答卡、规划问题、冲突都进历史，只读（同 DQ07）；答过并落实的合成答复不再出现在待答 | L9、规则 4 |
| QA-09 | QE2 | （一）派生的卡在旧来源窗口之外：一个目标的规划问题卡超过 5,000 张，`readDecisionCard` 读排在第 5,001 张之后的那一张（旧的 25 页×200 之外，`decision-read-model.ts:823–842`）：内容和夹具写的一样，不报 `unavailable`。<br>（二）请求的候选翻页：同一个请求有 5,001 个以上候选记录（旧的 `findCandidateProposal` 上限之外，`:1117–1148`）：`readDecisionCard` 读这个请求的卡，得到夹具里写明的那个候选；队列里同一张卡一样；都不报 `capacity`、`incomplete` | L6、L10 |
| QA-10 | QE3 | （一）自动返工 30 次、重新检查 10 次（真正由系统或成员发起）、成员请知悉 20 条，标记已看到中间某处：再读只出现之后的，每类从自己的位置接着；期望的标识序列在夹具里写成字面值。不标已看、用小的 `limit` 翻完：每一页的 `counts.notices` 都等于夹具写的字面总数，翻页不改计数。<br>（二）超过 5,000：未看的成员请知悉 5,001 条；接线包 2 的未送达回复：工作区 5,001 个 Session，按目录顺序排在 5,000 个之后的那条不可用，上面有 5,001 条未送达回复（越过目录 50 页、每线 50 页、输出 5,000 三个旧上限）；另有一个**可用的** Session 带 2,001 条负责链接（越过 `findSessions` 每个 Session 2,000 条的上限）。队列翻到底：每类的条数和计数是字面值，不报 `capacity` | L4、L8、L10；§0.4 |
| QA-11 | QE3 | 已看位置是旧式的。Codex 夹具经存储边界提交合法的历史记录：没有 `since`，今天的编解码读得出；断言只经公开读取，不读数据库。三条旧式的自动返工，`occurredAt` 的先后和 refKey 的先后正好相反；已看位置在 `occurredAt` 最早的那条上。再读：先出另外两条旧式的（按 `occurredAt`，字面顺序），再接按提交位置的。没有已看位置时，三条旧式的都排在最前。不标已看翻页，计数不变 | L4 |
| QA-12 | QE3 | 同一项目两个工作区，各有自动返工；其中一个目标在通知被看之前就取消、另一个已完成：每个工作区只看到自己的，取消和完成的目标的通知都还在 | L4 |
| QA-13 | QE3 | 一条在等回复的消息经归档时的等待处置之后：提交位置不变，仍按提交位置出现在请知悉里，没有被已看位置挡掉 | L5 |
| QA-14 | QE4 | 经路由读 QA-05 的数据：返回第一页和游标，翻到底与 QA-05 相同；把存储设成读失败，路由报故障，不报空队列 | L8 |
| QA-15 | QE1 | 整数排序（`valueType: 'integer'`）：排序值有负数、`0`、大的安全整数（如 `9007199254740991`），还有文字序和数值序不同的 `2`、`10`；期望按数值（`2` 在 `10` 前）。同值按 refKey 的 UTF-8 字节序。`real` 的行（`2.5`）、数字样子的文字（`"10"`）不是候选。`integer` 索引上 `bound.value`、`after.order` 给文字，`text` 索引上给数字，都报 `invalid`。正序、倒序各读，期望写成字面值；两个后端逐条相同。<br>另外（第三次复核第 3 条）：合法的整数上下界，含与不含各一例（手算）；三条同一个整数排序值、`limit: 2`，第二页按 refKey 接着，不重不漏；请求里的 `bound.value`、`after.order` 是不安全的整数（`2^53`）、小数（`1.5`）、`NaN`、`Infinity` 都报 `invalid`；库里存的不安全整数（如 `9007199254740993`）不是候选 | L1（D8） |
| QA-16 | QE2 | 稳定窗口。Codex 写一个存储端口的测试替身：包住真实存储，在某次读的中途确定地提交一次（加一张待答卡）。<br>（一）只在第 1 次尝试中途提交：结果是第 2 次的，含这张新卡；卡片和计数按新数据手算，不混旧的；<br>（二）第 1–3 次尝试都被打断、第 4 次不打断：成功，卡片和计数手算；<br>（三）4 次都被打断：`unavailable`，没有卡片、计数、展示令牌 | L7（D5） |
| QA-17 | QE2 | 一个目标有 5,001 个以上执行（越过 `readLookupKeys` 的旧上限 25 页×200）：目标原因卡照常算出，其中夹具点名的一张和手算的一致，不报 `incomplete`；两个后端 | L10（D1） |
| QA-18 | QE3 | 一个检查主体：第 1 轮，第 2 轮由人发起重新检查；标记已看到第 2 轮之后的某条通知；再由系统发起第 3 轮。再读：自动返工这一类恰好多 1 条，就是第 3 轮；整条链照今天的规则核对通过；第 1、2 轮不出现 | L4（D2） |

另由 lead 在验收时核对，不进测试：
- 代码里不再有读所有已结束 Run 的路径；§0.4 表里标“去”的每一行都核到（`SOURCE_MAX_PAGES`、`SOURCE_MAX_ITEMS`、`GOAL_LIMIT`、`lookupAll` 的 `cap`、`readLookupKeys` 和规划问题的 25 页都不在了）；
- SQLite 的 `EXPLAIN QUERY PLAN`：2A 的每个按顺序查询走自己的索引、按前缀范围查找、没有 `USE TEMP B-TREE FOR ORDER BY`（L1）；
- 计时，记进证据，不设断言（L3、L11）：
  - 300 个目标（250 个已结束）的计时数据集，读一页；
  - QA-05 的 5,001 张待答卡，`limit: 50` 翻完整个队列，记总耗时和页数；
  - QA-10（二）的请知悉翻完，同样记；
  - QA-07 的规划问题卡翻完，同样记。

### 5.3 要改断言的旧测试（lead 写出前后断言，DSH 不自行翻转）

| 测试 | 怎么改 |
| --- | --- |
| `tests/work-graph/S5R2-queue-history.test.ts` R2A07 | 201 个目标不再拒绝，改成返回结果 |
| 同文件 R2A09 | 5,001 条待答请求不再拒绝；它用 `limit: 50`，改成翻页拿到全部 5,001 条 |
| 同文件 R2A01–06、R2A08 | **不翻转** |
| `tests/work-graph/S5-decision-queue.test.ts`、`S5-notices.test.ts`、`tests/app/S5-decision-routes.test.ts` | **不翻转**；DSH 跑一遍确认 |
| 写入大小的 `capacity` 断言，例如 `tests/work-graph/S5-user-messages.test.ts` UM09 | **不翻转**：写入上限仍然有效。不成批翻转 `capacity` 断言 |
| 接线包 2 合入的测试 | **占位：** 接线包 2 合入以后，lead 读它合入的测试，写出要改的断言的前后对照，主要是它临时上限的期望（例如 F07 里“容量不足的结果被拒”、M07 的 50 页/5,000 条边界）。M10 的四次整窗尝试不翻转。撤掉的 I-6 提醒上限由翻转后的 F07 覆盖 |

## 6. 文件（影响面；施工时以实际为准，超出要报）

- **RecordStore：** `src/core/record-store/lookup-ports.ts`、`lookup-index.ts`、`in-memory-record-store.ts`、`sqlite-record-store.ts`。
- **索引登记：**
  - `src/core/work-graph/sessions/message-record-codecs.ts`；
  - `src/core/work-graph/tasks/claim-record-codecs.ts`（重排）；
  - `src/core/work-graph/persistence/evidence-record-codecs.ts`（检查轮次，两个索引）。
- **决定队列：**
  - `src/core/work-graph/views/decision-read-model.ts`（只改数据来源、上限和 L11）；
  - `goal-conflicts.ts`（`lookupAll`、`listWorkspaceGoals`）、`automatic-rework-notices.ts`；
  - `src/core/work-graph/tasks/plan-readers.ts`（共用的 `readLookupKeys`）；
  - `planning-question-reader.ts`。
- **接线包 2 的防护：** `src/core/work-graph/views/context-extensions.ts`、`views/undelivered-reply-notices.ts`（文件名和行号以合入后的为准）。
- **`since` 修复：** `src/core/work-graph/communication/mailbox-service.ts`，以及审计中发现的其它写入。
- **测试：** 新测试由 DSH 写；夹具和替身由 Codex 写；旧测试按 §5.3。

## 7. 施工

- 一个副本、一个新的 DSH Session。按 QE1 → QE2 → QE3 → QE4 分组。
- 在接线包 2、K 片 B、K 片 A 合入以后的基线上施工；先重核 §0.4 表里接线包 2 的几行。
- **大数据集的夹具由 Codex 写**，用真实服务造，lead 核对后冻结：
  - 5,001 条成员之间的消息、5,001 张待答卡、201 个目标、300 个目标（计时，250 个已结束）；
  - 5,001 个查询任务、5,000 张以上规划问题卡、一个请求 5,001 个候选、一个目标 5,001 个执行；
  - 5,001 条成员请知悉、5,001 个 Session 加一条线上 5,001 条未送达回复。
- 两个例外，也由 Codex 写、lead 核对：
  - QA-11 的历史记录经存储边界提交（今天的写者都会写 `since`，造不出没有它的记录）；
  - QA-16 的存储端口替身。
- 其余同 K 片 §7：每组派一个只读复查子任务；之后 lead 核对、Codex 审；全量测试；合入。

## 8. 不做的事

- 不把 5,000 调大了事；
- 不改卡片的拼法、合并、状态和顺序；
- 不改已看位置的写入；
- 不改稳定窗口（一共 4 次）；
- 不动领域上限（检查链长度、写入大小）；
- 不接新的来源；
- 不调用真实模型。

## 9. 第二轮审查怎么处理的

依据 `D:/cc-lead-notes/codex2/s2a-spec2.out.md`（结论“列出的问题改完后冻结”）和 lead 2026-10-14 的决定 D1–D8。第一轮审查已解决的各条保留不动。

| 条 | 审查的问题 | 怎么改的 | 在哪 |
| --- | --- | --- | --- |
| 1 | 去上限的清单没覆盖实际的合入基线 | D1：列出接线包 2 的两处防护，以及共用的 `readLookupKeys`、`lookupAll`；逐条分“去/留”；写明总规矩；列出 `queryTaskGraph` 的其他调用方；新增 QA-17 | §0.2、L3、L8、L10、§0.4、§1.1、§5.2、§5.3、§6、§7 |
| 2 | 筛出来的重新检查轮次自己过不了 `roundChainHead` | D2：新索引只找主体；每个主体经主体索引读整条链一次，用今天的规则核对；旧轮次和人发起的只作核对，不出通知；新增 QA-18 | L4 的表、规则 2、QA-18 |
| 3 | 数字等值跨两段排好序的范围 | D3：等值只用非空文字，按 `json_type = 'text'` 比；普通 `lookup` 不变；核过 2A、2B、2C 的按顺序索引；验收看执行计划没有另排序 | L1、§2、§5.2 lead 核对 |
| 4 | 可复用的契约没写完 | D4：运行时校验逐条写出；`orderBy.path` 登记时校验并保留；`""` 不是候选；`bound` 和 `after` 取交集；续读的要求；`next` 何时为 `null` | L1、§2、QA-01、QA-02 |
| 5 | 稳定窗口的次数含糊，也没有验收 | D5：一共 4 次（第一次加 3 次重读），4 次都被打断报 `unavailable`；新增 QA-16（存储边界的提交替身）；2B 已对齐 | L7、§3、QA-16 |
| 6 | 几行测试证明不了要保护的东西 | D6：QA-07 两个后端都跑；QA-09 换成旧窗口外的派生卡和请求候选翻页；QA-10 加超过 5,000 的来源（含接线包 2 的未送达回复）；QA-11 用经存储边界提交的历史记录；QA-01、02、10、11 给具体的期望；期望一律写成字面值；§5.3 加接线包 2 的占位和“写入上限不翻转” | §5、§5.2、§5.3、§7 |
| 7 | 代价没算上反复整体物化 | D7：计时量完整翻页；一次稳定尝试里每个来源只拼一次；无界的展开追加改成循环或 `concat` | L11、§5.2 lead 核对 |
| 附注 | 两处还写着入口“待确认”；两套目标数据集没分开 | 改成决定 51 已同意；分开写 300 个目标的计时数据集和 QA-06 的 201 个目标验收数据集 | §0.1、§5.1、L3、QA-06 |
| 第三次复核（`D:/cc-lead-notes/codex2/s2arev3.out.md`，结论“改完后冻结”） | 1. 漏了 `findSessions` 每个 Session 2,000 条链接的上限；2. 上下界写成了行值比较；3. 整数排序的验收不全；4. QA-14 的故障注入和“替身只在 QA-16”冲突；附注：`plan-readers.ts:745`、`:1728` 的展开参数，“改成成功”的含义 | 1. 未送达回复的来源改成按 Session 索引列、不读链接，`findSessions` 照旧（§0.4 加一行，QA-10 加 2,001 条链接的可用 Session）；2. 上下界只比排序值，续读才比 `(排序值, ref_key)`，两者 `AND`；3. QA-15 加合法整数上下界、同值跨页、不合法的数值请求、库里的不安全整数，lead 另看一个整数索引的计划；4. 允许 QA-14 的存储读失败包装；附注照改 | L1、L10、L11、§0.4、§5、QA-10、QA-15 |
| D8（来自 2C 审查） | 2C 要按整数的 `generation` 取一个 Session 最近的领取 | 登记加 `valueType`（缺省 `'text'`）；整数的候选、顺序、请求里的类型；指纹带 `valueType`；新增 QA-15；2C 的 `s2c-work-claim-by-session-at` 改成整数索引 | L1、§2、QA-15 |

## 10. 施工和验收中的限定（lead，2026-10-15）

施工四轮、Codex 一次实现审查和 lead 的验收里定下的读法，和 §0–§9 同等有效；有冲突时以本节为准。经过见证据目录 `reviews/evidence/orchestration-slice-2A-2026-10-14/`。

- **L1 SQLite 的续读要能在索引上定位（改 L1 “SQLite” 一段的续读写法）。** lead 按 D3 查查询计划时发现：SQLite 不会拿 `(排序值, ref_key)` 的行值比较在表达式索引上定位；同一列上有两个下界时，只用写在前面的那个。20 万行里翻到深处一页，只靠行值比较要扫完整段前缀（约 14 毫秒），加一个普通的范围条件后只读这一页（约 0.05 毫秒）。所以改成：排序列上**只放一个下界和至多一个上界**，由存储在代码里算出来（正序）：
  - 只有 `bound`：照旧；
  - 有 `after`，没有 `bound` 或 `after.order` 在 `bound` 之后：下界是 `排序值 >= after.order`，再加行值比较处理同值的行；`bound` 已被蕴含，不写；
  - `after.order` 在 `bound` 之前：只写 `bound`，行值比较已被蕴含，不写；
  - 相等：`bound` 不含时只写 `排序值 > value`；含时写 `排序值 >= value` 加行值比较；
  - `integer` 索引：安全整数范围拆成两边，算出来的下界替换 `-(2^53−1)` 那一边。
  - 倒序对称。比较用和索引相同的顺序（文字按 UTF-8 字节，整数按数值）。结果和原写法逐条相同；内存后端不变。
- **L1 查询计划的结果。** 2A 的两个文字排序查询（`s2a-requeue-by-project`、`s2a-round-reverify`），SQLite 选的是同一聚合上“旧式组”的等值索引：它的列是等值前缀、`json_type(since)`、`json_extract(since)`、`ref_key`，正好覆盖候选条件和排序，按前缀查找、不另排序。接受。所以这两个专门的排序索引在 2A 里用不上，多一份写入开销；这两类记录写得少，不改。2B、2C 没有旧式组的排序索引用自己的索引（lead 用一个 `integer` 测试索引核过）。
- **L1 普通索引的名字不变。** 没有排序的索引，名字的指纹照 2A 以前的写法算，已有数据库不会多出一套重复索引；只有排序索引把排序路径和类型算进指纹（Codex S1）。
- **L4 旧式组也要解码来历。** 从旧式组读出的记录先解来历；持久化的 `since: null` 报“不可用”，只有确实没有 `since` 的才算旧位置。这种记录只有数据库坏了才会出现，按 AGENTS.md 第 4 条不另写测试（Codex M1）。
- **commit-observer 的类型。** `src/composition/commit-observer.ts` 改成泛型：最低要求仍是 2A 以前的 `GoalRecordTransactionPort & RecordLookupPort`，调用方传进什么类型就拿回什么类型（含按顺序查找）。这是 §6 以外唯一改动的生产文件，只改类型（Codex S2）。
- **测试的例外**（§5 只列了四个，下面是验收时接受的）：
  - 例外 3、4：QA-09(二) 的已关闭候选和 QA-17 的 Run 记录，经存储的正常提交写入，记录都是今天的编解码能解开、公开写入方也写得出的样子（已关闭候选按公开替换写成 `revision: 2`、`replacedBy` 指向下一个）。走公开服务是平方级，放不进时限。
  - 治理检查点（完成策略）照冻结的 S5 夹具 `noticeWork` 的写法直接写入；第二个工作区（QA-12）的工作区登记和治理检查点也直接写入：冻结的 S5 夹具没有注册项目引导的编解码，公开的登记走不通。目标、计划、Session、领取和返工都走公开服务。
  - QA-18 的“标记已看”标的是第 2 轮之后送达的一条成员通知；自动返工这一类从已看位置读的窗口由 S2A-notices-since 和 S2A-notices-counts 覆盖。
  - QA-10(二) 不含“2,001 条负责关系”的情况（P11）：新的列 Session 不读负责关系，lead 在代码里核过。
  - 测试里用 `decisionSourceKey` 只拼来源的身份、比集合，和冻结的 R2A09 改动同一写法；不用它算顺序或格式。
- **R2：** `WP2-undelivered-notices.test.ts` 的 M04、M05、M10 只把注入点改到 `records.lookup(SESSION_BY_WORKSPACE_LOOKUP)`，断言逐字不变；重新冻结的 sha256 是 `ff6cf385…`。
- **时限：** 5,001 条规模的测试和建这种数据的钩子统一用 `S2A_SCALE_TIMEOUT_MS = 1_800_000`。全量并行时（24 核）这些文件一个最长 1,434 秒，是单独跑的 4–6 倍。
