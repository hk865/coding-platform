# 006 注记全文查找：进程内按序扫描、SQLite 只存规范化文字，不用 FTS5

状态：采用（决定 49、66）
日期：2026-11-09

## 背景和约束

- 注记是“指针 + 语义状态”：它挂在架构图或任务图的锚点上，正文、话题、结论是给人看的文字。查找工具只能按固定字段和确定规则读，同样的输入、数据、规则版本给同样的结果，工具里不调模型（[HANDOFF 49](../HANDOFF.md)）。
- 中文没有空格。决定 49（10-10）当时的方案是“只加一个全文索引”，SQLite 后端用 FTS5（SQLite 的全文检索扩展，虚拟表加分词），中文先切成两个字一段再建索引，这样“架构图”“锚点”这类两字词也能查到（[HANDOFF 49](../HANDOFF.md)；[MEMORY-LOOKUP](../design/orchestration-2026-10/MEMORY-LOOKUP.md)）。
- “两个字切片”指 bigram：把连续文字切成重叠的两码点窗口，例如“架构图”切成“架构”“构图”；FTS5 里再把每个窗口编码成一个 ASCII token（只用 ASCII 字符表示的词元）写进索引，查询也按同样规则切，再按 AND 匹配（`src/core/record-store/lookup-index.ts:662`）。
- 当时的实测（lead 2026-10-10，WSL，Node v24.18.0）：FTS5 可用；trigram 分词器（按三个字符切）能查到三个字以上的中文（如“架构图”）和代码路径（如“graph-context”）；两个字的中文（如“锚点”）用 trigram 和 unicode61（SQLite 的另一种分词器）都查不到，`LIKE`（SQL 的子串匹配）能查到。所以中文要先切成两个字再建索引（[MEMORY-LOOKUP](../design/orchestration-2026-10/MEMORY-LOOKUP.md)）。
- 决定 66（10-16）改了 SQLite 后端的做法：不再用 FTS5，改成紧凑比较表加进程内按序扫描。4B 合入后在 2 万条注记的 SQLite 数据上实测，常见词查找 1.35 秒、再加一个锚点 15 秒、全文端口一页页翻到底 19 秒；同样的文字用 grep 扫一遍 6–8 毫秒，进程内存里扫一遍 1.2–3.2 毫秒。慢不在“找”，在每翻一页重查重排、一次调用里同一组注记反复读、同一条记录反复解析（[HANDOFF 66](../HANDOFF.md)）。
- 这一篇只定注记的全文和子串查找；代码文件的搜索不在这一篇，文件对账见 003。FTS5 加两字切片在 4B 实现过（`0776b9b6`，10-16），决定 66 的第一轮（`269a9748`）当天就换成了进程内扫描，今天树上没有 FTS5；决定 49 的“两字切片”今天只用于写注记时的相似提示，不要把它当全文查找的现状（[HANDOFF 121-73](../HANDOFF.md)）。

## 选项

四个选项和否掉的理由来自决定 49、66。

| 选项 | 怎么做 | 好处 | 坏处 |
|---|---|---|---|
| FTS5 + trigram/unicode61，不切片 | 直接用 SQLite 自带的分词器建全文索引 | 英文、代码路径和三个字以上的中文能查（10-10 实测） | 两个字的中文查不到；“锚点”这类常见词正好是两个字的 |
| FTS5 + 两个字切片（决定 49 当时选的，4B 实现过，决定 66 换掉） | 连续中文生成两码点窗口，编码成 ASCII token 写入 FTS5；查询同样切分、AND，再核对原文子串 | 两个字的中文能查；只加一个全文索引，不另起搜索进程 | 要做切片、编码、AND 和原文核对；片段可能误中，必须再核对子串；英文标识符还要另保留整词并拆驼峰命名/下划线 |
| `LIKE` | 直接在正文列上做 SQL 子串匹配 | 实现最短，两个字也能查到 | 每次查询全表扫，结果顺序和分页要另做；SQL 方言漏到上层，两个后端难一致 |
| **紧凑表 + 进程内按序扫描（决定 66，选了）** | 写入时在同一个事务里把规范化后的比较文字存进一张紧凑表；进程读进内存，按注记键顺序扫，扫够一页就停，书签记住位置；两个后端用同一套扫描 | 比较规则就是子串，语义直接；两个后端结果一致；2 万条实测比“每页重查重排”快很多 | 扫描成本随注记数增长；要有书签/翻页和紧凑表维护；注记到几十万条以上可能要在同一个端口后面加回索引 |

## 选了什么，为什么

- 选最后一行（[HANDOFF 66](../HANDOFF.md)）。今天 SQLite 只存规范化后的比较文字：每个注册的文字索引一张普通表，一行一个头记录，形状是 `(ref_key PRIMARY KEY, prefix_key, text, seq)`；`text` 用 `JSON.stringify` 存、读回时 `JSON.parse`，让孤立代理项（不能成对编码的 Unicode 码点）也能穿过 node:sqlite（Node 自带的 SQLite 接口）的 TEXT 处理，两个后端结果一致（`src/core/record-store/sqlite-text-scan.ts:1`–`:30`）。
- 两个后端共用同一套扫描：`scanEntries` 按 `refKey` 的字节序读，`textMatches` 做子串匹配，`compareRefKeysFast` 定顺序（`src/core/record-store/text-scan.ts:78`、`:67`、`:46`）。SQLite 后端只负责把表读出来，不另写一套匹配规则；内存后端和 SQLite 后端“stay in parity”是这份实现的注释里写明的目标（`src/core/record-store/sqlite-text-scan.ts:1`–`:30`、`src/core/record-store/text-scan.ts:1`–`:20`）。
- 比较规则是：先 NFC（Unicode 规范化，把不同写法的同一字符统一），再把 ASCII 字母小写，然后按子串匹配；每个词 2–64 个码点（Unicode 字符的编号单位），一次最多 8 个词，`match` 缺省是全部命中，也可以是任意一个命中（`src/core/record-store/lookup-index.ts:653`、`:694`；`src/core/record-store/lookup-ports.ts:103`–`:104`）。
- 全文只是候选：`searchPage` 拿到的是一页候选，返回前仍读正式注记状态、权限和可用性；RecordStore（记录存储层）不承担业务授权（[HANDOFF 49](../HANDOFF.md)；`src/core/work-graph/notes/note-read-model.ts:1181`–`:1183`）。
- 端口不暴露 SQL 或 `MATCH`（FTS5 的匹配表达式）。调用方只给索引名、前缀值、词项、匹配方式、页大小和书签；SQL 方言留在 RecordStore 里（`src/core/record-store/lookup-ports.ts:129`）。
- 决定 49 的“两个字切片”今天只用在写注记时的相似提示（[HANDOFF 49](../HANDOFF.md)）：`similarNotes` 对“话题 + 结论”的 bigram 窗口算 Jaccard 相似度（交集除以并集），不承担全文查找（`src/core/work-graph/views/note-views.ts:1558`、`:1583`）。`bigramWindows` 还在（`src/core/record-store/lookup-index.ts:662`），但它的用途就是这个相似提示。
- 决定 49 当时为什么切两字：不是“两字一定最好”，而是实测 trigram/unicode61 查不到两个字的汉语词；两个字切片能让“锚点”这类词进索引，同时仍然保持子串语义（[MEMORY-LOOKUP](../design/orchestration-2026-10/MEMORY-LOOKUP.md)）。
- 决定 66 为什么改：2 万条时每翻一页重查重排、一次调用里反复读同一组注记、反复解析同一条记录，1.35 秒、15 秒、19 秒就是这么来的；改成紧凑表加一次按序扫描后，同样的查询降到 1.2–3.2 毫秒的量级（[HANDOFF 66](../HANDOFF.md)）。

## 代价，以及因此要守的规矩

- **两个后端同一套扫描和结果顺序。** 内存后端和 SQLite 后端给相同的候选语义和顺序；SQLite 后端不能因为换实现就改顺序，也不能改成“每页重查重排”（[HANDOFF 66](../HANDOFF.md)；`src/core/record-store/text-scan.ts:1`–`:20`）。
- **比较规则只有一套：** NFC、ASCII 字母小写、子串、每个词 2–64 个码点。不要在这条规则外另加分词、大小写折叠或“只匹配整词”的规则（`src/core/record-store/lookup-index.ts:653`、`:694`）。
- **全文只是候选。** 返回前仍读正式注记状态、权限和可用性；不能拿扫描结果直接当注记的当前状态（[HANDOFF 49](../HANDOFF.md)；`src/core/work-graph/notes/note-read-model.ts:1181`–`:1183`）。
- **表是同事务写的可重建投影。** 写入时和记录在同一个事务里更新紧凑表；索引删了能从记录重建，它不是第二份正文，也不能在恢复时当正文读（[HANDOFF 66](../HANDOFF.md)；`src/core/record-store/sqlite-text-scan.ts:1`–`:30`）。
- **端口不漏 SQL。** 上层只看见索引名、词项和书签，不看见 `MATCH`、表名或 SQLite 方言；换实现不能改调用方的形状（`src/core/record-store/lookup-ports.ts:129`）。

## 什么情况变了要重新考虑

- **注记到几十万条以上，紧凑表扫描超过界面要求的时间。** 在同一个端口后面加回索引，按命中多少在索引和扫描之间选；决定 66 只留了“加回索引”的口子，没有替未来定切片规则（[HANDOFF 66](../HANDOFF.md)、[HANDOFF 121-73](../HANDOFF.md)）。
- **以后加回 FTS5 时要守的：** 切片要编码成 ASCII token、查询按 AND 匹配，再核对原文的规范化子串，不能只信片段命中（[MEMORY-LOOKUP](../design/orchestration-2026-10/MEMORY-LOOKUP.md)）。
- **FTS5 不可用时明确报 `unsupported`，不要静默把 SQLite 退成全库扫描。** 这是“以后加回索引”的规则，不是今天的实现；今天本来就没有 FTS5（[MEMORY-LOOKUP](../design/orchestration-2026-10/MEMORY-LOOKUP.md)）。
- **不要用 trigram 单独查两个字的中文。** 10-10 实测查不到；以后加回索引也要先解决两个字的问题（[MEMORY-LOOKUP](../design/orchestration-2026-10/MEMORY-LOOKUP.md)）。
- **用户要求单字查询。** 今天的词项规则是 2–64 个码点，两个字切片本身也匹配不了单字；要改词项规则和索引规则（`src/core/record-store/lookup-index.ts:694`；起草方推断：窗口至少两个码点）。
- **产品要求语义检索（近义、跨语言）。** 这是新的取舍，决定 49 的“工具不调模型”不覆盖；要另写一篇，不能把它塞进这个全文查找（[HANDOFF 49](../HANDOFF.md)）。
- 注记主要变成英文或代码，两个字的规则可能不再是瓶颈；这时按实际查询样本重估，不要因为历史选择保留用不上的预处理（起草方推断：材料没有记录这种语言分布的变化）。

## 来源

- 用户原话（10-10，决定 49）：“我希望我们的双图的记忆，语义层一定要做好，可以被工具给快速查找得到。这个跟规范和工具选取有关，可以的话，工具本身尽量不要涉及模型要结构化。”（[HANDOFF 49](../HANDOFF.md)）。
- 决定 49：注记只加一个全文索引；内存后端做子串扫描，SQLite 后端用 FTS5，中文先切成 2 字片段再建索引；标签、时间/版本、关系邻接这三类不加（[HANDOFF 49](../HANDOFF.md)）。
- 决定 66：SQLite 后端不再用 FTS5，改成紧凑比较表 + 内存子串扫描；2 万条实测和“去掉重复扫描”的理由；比较规则和结果顺序不变；以后几十万条以上再加回索引（[HANDOFF 66](../HANDOFF.md)）。
- 决定 121-73：注记全文查找不是两字切片索引；两字切片今天只用于相似提示（[HANDOFF 121-73](../HANDOFF.md)）。
- 设计说明：[MEMORY-LOOKUP](../design/orchestration-2026-10/MEMORY-LOOKUP.md)。
- 代码：`src/core/record-store/sqlite-text-scan.ts:1`–`:30`；`src/core/record-store/text-scan.ts:1`–`:20`、`:46`、`:67`、`:78`；`src/core/record-store/lookup-index.ts:653`、`:662`、`:694`；`src/core/record-store/lookup-ports.ts:103`–`:104`、`:129`；`src/core/work-graph/notes/note-read-model.ts:1181`–`:1183`；`src/core/work-graph/views/note-views.ts:1558`、`:1583`。
- 外部资料：SQLite FTS5 文档 [https://www.sqlite.org/fts5.html](https://www.sqlite.org/fts5.html)。
