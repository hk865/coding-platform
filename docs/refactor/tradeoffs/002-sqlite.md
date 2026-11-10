# 002 用 SQLite，不加图数据库和搜索引擎

状态：采用（决定 121-68、121-69、121-71、121-72、121-75）
日期：2026-11-09

## 背景和约束

- 要解决的是平台的存储和查找：项目记录、架构和注记的正文、以及查找索引放在哪里；模块包含和依赖、注记之间的联系这类“图”怎么查；代码和注记的全文、子串查找要不要另建一套索引（[HANDOFF 121-68](../HANDOFF.md)）。
- 规模前提：任务上千、Session 上万（大多数已归档），界面约 600 个任务、约 2 万个文件，方向是 10 万–100 万行；首版单机单用户（[PRODUCT §1.4](../../PRODUCT.md)）。操作系统、游戏引擎这一级（千万行、几十万到几百万个文件、大量二进制资源、可能用 Perforce）是 MVP 之后的方向（[HANDOFF 121-69](../HANDOFF.md)；[PRODUCT §9](../../PRODUCT.md)）。
- 已有两个库：`ledger.sqlite` 是记录库，保存目标、任务、Run、Session 等记录；`artifacts.sqlite` 是内容寻址的正文库。`artifacts.sqlite` 显式设成 WAL（预写日志，崩溃后能恢复到一致状态）和 `synchronous = FULL`（`src/core/record-store/sqlite-body-store.ts:79`–`:80`）；`ledger.sqlite` 只设 `busy_timeout`，没有改日志模式，所以是 SQLite 默认的回滚日志（`src/core/record-store/sqlite-record-store.ts:166`）。
- 这一篇只管存储、图查询和代码搜索的选型；注记的全文和子串查找单独写在 006，文件对账单独写在 003，库放哪单独写在 001（[HANDOFF 121-73](../HANDOFF.md)、[HANDOFF 121-75](../HANDOFF.md)）。
- 决定 121-71 更正了“引擎复用、算法自己写”这个说法：选引擎就是选数据在盘上的排法，也就定了哪些算法快。所以这一篇不把“算法留在代码里”当理由，而是先看查询形状，再看引擎能不能直接给出合适的数据结构（[HANDOFF 121-71](../HANDOFF.md)）。

## 选项

这些选项和否掉的理由来自决定 121-68、121-69、121-71。

| 选项 | 怎么做 | 好处 | 坏处 |
|---|---|---|---|
| 专用图数据库 | 把模块、联系、流程放进图库，用图查询语言查多跳 | 多跳查询自然，自带图算法 | 多一个存储就有两个“准”，要从记录库同步，一致性和跨库提交是同一个难题；多一套部署和升级 |
| 专用搜索引擎 | 为代码或注记另建全文/正则索引，常另起一个进程 | 大代码库、多分支的全文和正则搜索快，有排序和高亮 | 又一个要同步的索引；多跑一个进程；注记这个量级用不上 |
| 自己写存储/索引引擎 | 自己实现存储、事务、崩溃恢复、并发和通用索引 | 当时没有记录 | 极难写对；SQLite 的测试是工业级的，Kùzu 在 2025-10 归档也说明专业团队的引擎都难维护（[HANDOFF 121-69](../HANDOFF.md)；[The Register](https://www.theregister.com/2025/10/14/kuzudb_abandoned/)） |
| **SQLite** | 记录库 + 正文库 + 单独的索引库；全文和子串在进程内按序扫 | 单机零部署；事务、崩溃恢复、备份都复用现成实现；规模够 | 只有一个写者；图查询要自己按算法排表或读进内存；全文是线性扫 |

## 选了什么，为什么

- 先列实际要做的查询和形状，再挑数据结构（[HANDOFF 121-71](../HANDOFF.md)）：
  - **前缀**：按路径前缀找归属的模块和文件。用排好序的字符串键，B 树（SQLite 表默认的有序索引结构，按 key 排好，范围扫描就是顺着叶子走）的范围扫描就能给出同一前缀下的所有键；今天已有按 aggregateType（聚合类型，一类记录的类别）分区的部分索引（`src/core/record-store/sqlite-lookup-indexes.ts:1`–`:12`）。
  - **树**：模块的包含和依赖、任务图的先后。用邻接表（每个点存它的边），在内存里走；今天 `pathOwnershipOf`、`effectiveRegions`、`closeBranches` 都是纯函数或内存计算（`src/contracts/path-ownership.ts:36`、`src/core/work-graph/state/role-scope.ts:67`、`src/business/workflow/task-gate.ts:146`）。
  - **日志**：按事件顺序读、带游标翻页。用自增整数键，游标就是“读到哪个事件 id”，记录库今天就是这样（`src/core/record-store/migrations.ts:18`）。
  - **键值**：按 `refKey`（记录在库里的唯一键）读一条记录。用主键点查，一行一个键。
  - **图**：联系的多跳影响、目标阻塞闭包。SQLite 没有原生图存储，所以按算法排数据，或者从存储重建一份内存结构；例如边的表用 `(起点, 终点)` 做主键的 `WITHOUT ROWID` 表（`WITHOUT ROWID` 是 SQLite 的表选项：行直接按主键存，不另存隐藏行号），让一个点的边在 B 树里挨在一起（[HANDOFF 121-71](../HANDOFF.md)）。
  - **全文和子串**：注记正文。用紧凑的规范化文字表，进程内按 `refKey` 顺序扫，扫够一页就停；两个后端共用同一套扫描（[HANDOFF 66](../HANDOFF.md)，细节见 006；`src/core/record-store/sqlite-text-scan.ts:1`–`:30`、`src/core/record-store/text-scan.ts:1`–`:20`）。
- 再看引擎能不能直接给出这些结构：前缀、键值、日志、树都能用 SQLite 原生的 B 树和主键；图不能，所以由平台按算法排表或重建内存结构。事务、崩溃恢复和并发这一层复用 SQLite，不自己写（[HANDOFF 121-71](../HANDOFF.md)）。
- 用户原话（11-09）：“你这个是有瑕疵的，数据结构本身就决定了适用算法的特性这个是很容易懂的。”这一篇按这句话改写，不再把“引擎”和“算法”分开说（[HANDOFF 121-71](../HANDOFF.md)）。
- 索引单独一个 `index.sqlite`，放在项目库目录；知识正文从 `knowledge_blob.parsed_json` 取，锚点、文字、关系边各一张表。每张表都要写明它服务哪个现有查询，不因为字段多就建表（[HANDOFF 121-75](../HANDOFF.md)）。
- 这样选的理由是工程约束，不是“SQLite 一定更快”：一个存储就没有跨库提交和双向同步；MVP 的量级用不上图库和搜索进程；按查询形状排好的表和可重建的内存结构已经够用。材料没有记录做过图数据库或搜索引擎的基准对比，所以这里不写“实测更快/更慢”（[HANDOFF 121-71](../HANDOFF.md)）。

## 代价，以及因此要守的规矩

- **只有一个写者。** 写走 `BEGIN IMMEDIATE`，一个连接、一个事务里做完（`src/core/record-store/sqlite-record-store.ts:281`）。不要为了一时的吞吐另开写路径或第二个库；真遇到写瓶颈，先用测量证明，再考虑分片或换存储（[HANDOFF 121-71](../HANDOFF.md)）。
- **持久化前提按两个库分别写。** `artifacts.sqlite` 是 WAL + `synchronous = FULL`（`src/core/record-store/sqlite-body-store.ts:79`–`:80`）；`ledger.sqlite` 没有显式设置日志模式和 `synchronous`，用的是 SQLite 默认值（`src/core/record-store/sqlite-record-store.ts:166`）。不要为了速度静默调低，除非有崩溃恢复的测量和新的取舍记录。
- **领域算法留在代码里，不写成 SQL 触发器、UDF（用户自定义函数）或隐藏的数据库规则。** 这些规则要能单独测，也要能在内存后端上跑；图查询需要新结构时，先加一张按算法排过的表或一份可重建的内存结构（[HANDOFF 121-69](../HANDOFF.md)、[HANDOFF 121-71](../HANDOFF.md)）。
- **派生结构都是可重建的。** 闭包表、邻接表、前缀树、`index.sqlite` 都是缓存：记录和文件仍是正本，崩了能重建，不能变成第二个“准”（[HANDOFF 121-71](../HANDOFF.md)、[HANDOFF 121-75](../HANDOFF.md)）。
- **索引表写清服务的查询。** 每张表在定义处写明它回答哪个查询、按什么顺序读；没有查询服务的表不建（[HANDOFF 121-75](../HANDOFF.md)）。
- **今天没有 FTS5。** 4B 曾用 FTS5 加两字切片做注记全文（`0776b9b6`），决定 66 当天换掉；现在注记全文和子串查找用决定 66 的紧凑文字表加进程内扫描，两个后端同一套规则；细节和重新考虑的条件见 006（[HANDOFF 66](../HANDOFF.md)、[HANDOFF 121-73](../HANDOFF.md)；`src/core/record-store/lookup-ports.ts:103`–`:104`）。
- **库放哪见 001。** 这一篇不再重复目录、网络盘和实例锁的规则（[HANDOFF 121-75](../HANDOFF.md)）。

## 什么情况变了要重新考虑

- **图形状的查询在真实规模上仍达不到界面要求的时间。** 具体是联系的多跳影响分析、目标阻塞闭包：用按算法排过的表和内存结构仍不够快。这时才评估原生图存储，用它当只读副本还是当“准”要另写一篇（[HANDOFF 121-71](../HANDOFF.md)）。
- 注记到几十万条以上，单次全文扫描到秒级：在同一个端口后面加回索引，按命中多少在索引和扫描之间选；加回时仍要守 006 的规则（[HANDOFF 66](../HANDOFF.md)、[HANDOFF 121-73](../HANDOFF.md)）。
- SQLite 的单写者在真实工作负载下成为可测的瓶颈，并且加针对性结构也不够；这不是猜的，要有测量（[HANDOFF 121-71](../HANDOFF.md)）。
- 产品目标到操作系统、游戏引擎这一级：千万行、几十万到几百万个文件，代码搜索要另上索引（[HANDOFF 121-69](../HANDOFF.md)；[PRODUCT §9](../../PRODUCT.md)）。
- 首版“单机单用户”的前提变了（例如多人同时写、多机共享一个项目库），单文件 SQLite 的部署方式要重新选型（起草方推断：材料没有记录多写者和多机共享的验证）。

## 来源

- 用户原话（11-09）：“你这个是有瑕疵的，数据结构本身就决定了适用算法的特性这个是很容易懂的。”（[HANDOFF 121-71](../HANDOFF.md)）。
- 决定 121-68：技术选型不是功能，MVP 规模用 SQLite（[HANDOFF 121-68](../HANDOFF.md)）。
- 决定 121-69：操作系统、游戏引擎这一级放 MVP 之后；存储、事务、崩溃恢复、并发和通用索引不自己写（[HANDOFF 121-69](../HANDOFF.md)）。
- 决定 121-71：先列查询形状、再挑数据结构，图按算法排表或重建内存结构（[HANDOFF 121-71](../HANDOFF.md)）。
- 决定 121-72、121-73、121-75：两个库的日志模式、没有 FTS5、索引单独 `index.sqlite`、每张表写明服务的查询（[HANDOFF 121-72](../HANDOFF.md)、[HANDOFF 121-73](../HANDOFF.md)、[HANDOFF 121-75](../HANDOFF.md)）。
- 代码：`src/core/record-store/sqlite-body-store.ts:79`–`:80`；`src/core/record-store/sqlite-record-store.ts:166`、`:281`；`src/core/record-store/migrations.ts:18`；`src/core/record-store/sqlite-lookup-indexes.ts:1`–`:12`；`src/core/record-store/sqlite-text-scan.ts:1`–`:30`；`src/core/record-store/text-scan.ts:1`–`:20`；`src/core/record-store/lookup-ports.ts:103`–`:104`；`src/core/record-store/lookup-index.ts:653`、`:694`；`src/contracts/path-ownership.ts:36`；`src/core/work-graph/state/role-scope.ts:67`；`src/business/workflow/task-gate.ts:146`。
- 外部资料：Kùzu 归档报道 [The Register](https://www.theregister.com/2025/10/14/kuzudb_abandoned/)（2025-10）。
