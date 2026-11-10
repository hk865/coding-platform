# 001 数据分层：代码知识进仓库文件、文件为准、库做索引；项目库放主工作区的 git 目录

状态：采用（决定 121-64、121-67、121-68、121-72、121-74、121-75）
日期：2026-11-09

## 背景和约束

- 要解决的是“哪些数据放在哪、谁说了算”。平台有两类数据：代码知识（采用的架构图，以及挂在模块、接口、文件上的注记）和工作过程（目标、任务图、Run、Session、消息、决定卡）；此外还有观测、索引、核对结果这类能重算的缓存。三类的变化节奏不同，不能都用一种存法（[HANDOFF 121-68](../HANDOFF.md)）。
- 代码知识要跟代码版本走：切分支、合并、把仓库分家时，知识应该和代码一起走。工作过程要跟项目走：它不属于某一次检出，也不该随切分支消失。缓存可以丢，丢了能从文件和记录重建（[HANDOFF 121-68](../HANDOFF.md)、[HANDOFF 121-75](../HANDOFF.md)）。
- 规模前提和 002 相同：单机单用户，任务上千、Session 上万，界面约 600 个任务、约 2 万个文件，方向是 10 万–100 万行（[PRODUCT §1.4](../../PRODUCT.md)）。首版不迁移旧库（[HANDOFF 121-75](../HANDOFF.md)）。
- 这里的“工作区”是登记进项目的一个仓库文件夹；“线”是同一个仓库里的一条检出（一个文件夹加一个分支），细节见 005。“项目库”是平台给一个项目用的 SQLite 目录，里面至少有记录库、正文库、索引库和快照库；SQLite 是嵌入式关系数据库，一个库就是一个文件，不用另起服务。
- 决定 121-70 要求把当时考虑过的方案、没选的理由和重新考虑的条件固定下来，写成固定的七段；这一篇照这个要求写（[HANDOFF 121-70](../HANDOFF.md)）。

## 选项

五个选项和否掉的理由来自决定 121-68、121-72。`git notes` 是 git 给对象挂注释的机制，`ref` 是 git 的引用（分支、标签一类）。

| 选项 | 怎么做 | 好处 | 坏处 |
|---|---|---|---|
| 全中心库 | 代码知识也留在平台库里，分支复制和合并由平台自己做 | 查询快，一套事务 | 等于重做 git 的分支和合并；知识绑在机器上，换机器或删库就没了 |
| 全文件 | 连任务图、消息也写进仓库文件 | 版本和分享都交给 git | 没有事务和原子提交；工作状态随切分支消失；消息和模型输出不适合进仓库 |
| git notes / 单独 ref | 知识挂在 git notes 或一个单独的 ref 上 | 不占工作树 | 不随检出出现；托管平台常丢 notes；合并支持差 |
| 每个工作区一个库 | 每个工作区各开一个 SQLite | 隔离简单 | 跨工作区的写要挂几个库一起提交；lookup（平台给每类记录登记的查找索引）和索引也要跨库；项目级记录没有归属；以后改 WAL 就不原子（[HANDOFF 121-72](../HANDOFF.md)） |
| **文件为准、库做索引、按数据种类分流** | 代码知识写 `.workbench/`，工作过程留项目库，索引是缓存 | 合并、分家、分支交给 git；工作过程仍有事务 | 要维护对账、待核实和崩溃窗口 |

## 选了什么，为什么

- 选最后一行。代码知识写成仓库里的文本文件，文件是准（“准”指唯一可信的来源）；平台库只保存索引、观测和核对结果，索引坏了可以重建。工作过程留在项目库，因为它需要事务、分页和跨会话的稳定顺序（[HANDOFF 121-68](../HANDOFF.md)、[HANDOFF 121-75](../HANDOFF.md)）。
- 文件为准不等于“库没用”：模块、接口、路径、注记锚点和联系边仍然进索引表，界面和工具照旧从索引读；索引只是文件的投影，读不到文件时不能反过来把索引当正文。快照是恢复材料，不是第二个读源（[HANDOFF 121-75](../HANDOFF.md)）。
- 不选“每个工作区一个库”，因为项目里有跨工作区的写（秘书、参谋、书记线，区域 claim，项目级决定卡），一次写要挂几个库一起提交；lookup 和索引跨库；项目级记录没有归属。若按这个选项做，今天记录库是默认的回滚日志，ATTACH 跨库提交在该模式下是原子的；以后如果改成 WAL，这个原子性就没了，所以不能把“跨库提交”当长期前提（[HANDOFF 121-72](../HANDOFF.md)；`src/core/record-store/sqlite-record-store.ts:166` 只设 `busy_timeout`，没有改日志模式）。
- 不选全中心库，是因为那等于把 git 已经做好的分支、合并、分开重做一遍；不选全文件，是因为工作过程需要事务和原子提交，消息和模型输出也不适合进仓库；不选 git notes，是因为它不随检出出现，托管平台还常丢（[HANDOFF 121-68](../HANDOFF.md)）。
- 用户 11-09 明确不要本机中心目录，原话是：“默认位置存database，我觉得还不如gitignore呢。有些IDE被诟病就是清理困难，建议一开始就帮用户做git管理，之后加gitignore，或者检测gitignore之后加入”（[HANDOFF 121-68](../HANDOFF.md)）。所以默认把项目库放进仓库自己的 git 目录，不放进用户主目录（[HANDOFF 121-68](../HANDOFF.md)）。

### 库放哪，单独说清

- **默认丙：** 主工作区的 `<git-common-dir>/workbench/`，每个项目在其下按项目 id 分目录。`git-common-dir` 是仓库共用的 git 数据目录，几个 worktree 共用一份；放在这里，工作树里看不见，`git clean` 不碰，删仓库时一起删（[HANDOFF 121-68](../HANDOFF.md)、[HANDOFF 121-75](../HANDOFF.md)）。
- **不是 git 仓库时：** 建项目那一步问人要不要 `git init`；人同意才做，做完回到丙。人不同意才用乙：`<主工作区>/.workbench/local/`。乙靠 `.workbench/.gitignore` 里的 `local/` 忽略自己，不动用户根目录的 `.gitignore`（[HANDOFF 121-68](../HANDOFF.md)）。
- **先定位置，再查锁。** 候选位置定下后再看它所在的盘：网络盘、WSL 的 `/mnt/<盘>` 一类挂载盘上，SQLite 的锁不可靠；不可靠就退到甲——本机用户数据目录，并在项目清单里明示“库放在本机，因为仓库在网络盘或 WSL 挂载的盘上”。不能因为是 git 仓库就直接留在丙（[HANDOFF 121-68](../HANDOFF.md)、[HANDOFF 121-72](../HANDOFF.md)）。
- **Kernel 库和实例锁按项目。** Kernel 是平台底下的执行器，它的库今天放在全局 `storage.directory/kernel-stores`，按工作区的 scope 取哈希命名（`src/app/host.ts:1532`–`:1542`）；按本决定要搬进项目库目录，删仓库时清干净。实例锁是防止两个 Host 同时执行同一个库的锁文件，今天叫 `host-instance.lock`（`src/app/host-instance-lease.ts:37`），取得入口是 `acquireHostInstanceLease`（`src/app/host-instance-lease.ts:110`）；按本决定每个项目库目录一把，不再全局一把（[HANDOFF 121-72](../HANDOFF.md)、[HANDOFF 121-75](../HANDOFF.md)）。

## 代价，以及因此要守的规矩

- **知识写入每项目串行，事件先于文件。** 写之前先提交一条带正文的事件，作为平台的写入日志；再写文件；最后更新索引。这样崩溃后至少知道“本来要写什么”（[HANDOFF 121-72](../HANDOFF.md)、[HANDOFF 121-75](../HANDOFF.md)）。
- **崩溃后不自动补写。** 未确认的写一律以文件为准：文件等于写后版本才记完成；其他情况文件不动，发一条项目通知“平台有一次写没确认落盘”，带“恢复”，人点了才从事件正文恢复，恢复仍走写入队列（[HANDOFF 121-75](../HANDOFF.md)）。
- **对 `.workbench/`，Agent 只读。** 能读，不能写；Host 自己的文件保存也不把 `.workbench/` 放进可写白名单。项目库在 git 目录里，已经被 `.git` 的拒绝前缀挡住（[HANDOFF 121-72](../HANDOFF.md)、[HANDOFF 121-75](../HANDOFF.md)）。
- **“只留在本机”靠 `info/exclude`。** `info/exclude` 是仓库本地的忽略文件，不提交、不改用户的 `.gitignore`；这个设置按检出存，因为 `info/exclude` 是仓库共用的（[HANDOFF 121-74](../HANDOFF.md)、[HANDOFF 121-75](../HANDOFF.md)）。
- **「提交架构图和注记」只提交 `.workbench/`。** 按钮的提交命令带 `-- .workbench/`，即使索引里已经暂存了代码，也不会被带上；不推送、不改 git 配置、失败照原样报（[HANDOFF 121-74](../HANDOFF.md)、[HANDOFF 121-75](../HANDOFF.md)）。
- **快照存 `knowledge-snapshots.sqlite`，读一律读文件。** 每次对账把没提交的知识文件按内容哈希存进项目库，按“线 + 文件 + 时间”命名，每个文件留最近 20 份；提交后删。快照只在“恢复”时读，不是第二个“准”（[HANDOFF 121-74](../HANDOFF.md)、[HANDOFF 121-75](../HANDOFF.md)）。

## 什么情况变了要重新考虑

- 工作过程数据也要跨机器共享，或者要多人同时写同一个项目库：单机单用户的前提变了，库的位置和“一个项目一个库”都要重新选（[HANDOFF 121-68](../HANDOFF.md)；起草方推断：单文件 SQLite 不直接承担多机共享）。
- 代码知识的文本合并冲突频繁到撑不住：说明“交给 git 合并”的代价超过了收益，要重新看文件格式或分工（[HANDOFF 121-68](../HANDOFF.md)）。
- 项目数大到每个 runtime 的常驻内存不可接受：一个项目一个 runtime 的模型要重新量（[HANDOFF 121-75](../HANDOFF.md)）。
- 平台需要在不依赖 git 的版本管理（例如 Perforce）上工作：`git-common-dir`、`info/exclude` 和线模型都要一层适配，库的位置也要另定（[HANDOFF 121-69](../HANDOFF.md)）。

## 来源

- 用户原话（11-09）：“默认位置存database，我觉得还不如gitignore呢。有些IDE被诟病就是清理困难，建议一开始就帮用户做git管理，之后加gitignore，或者检测gitignore之后加入”（[HANDOFF 121-68](../HANDOFF.md)）。
- 决定 121-64、121-67：数据放哪的现状、方向和建议；用户 11-08 同意“不要全放进中心库，也不要全改成文件”（[HANDOFF 121-64](../HANDOFF.md)、[HANDOFF 121-67](../HANDOFF.md)）。
- 决定 121-68：三步改到 MVP 之前，默认丙，非 git 问 `git init`，不同意用乙，网络盘退甲（[HANDOFF 121-68](../HANDOFF.md)）。
- 决定 121-72、121-74、121-75：每个工作区一个库的否掉理由、提交按钮、快照、库位置和实例锁（[HANDOFF 121-72](../HANDOFF.md)、[HANDOFF 121-74](../HANDOFF.md)、[HANDOFF 121-75](../HANDOFF.md)）。
- 代码：`src/core/record-store/sqlite-body-store.ts:79`（正文库是 WAL）、`src/core/record-store/sqlite-record-store.ts:166`（记录库只设 `busy_timeout`）、`src/core/record-store/sqlite-record-store.ts:281`（`BEGIN IMMEDIATE`）、`src/app/host.ts:1532`–`:1542`（Kernel 库今天的位置）、`src/app/host-instance-lease.ts:37`、`:110`（实例锁）、`src/contracts/fingerprint.ts:72`（`sha256Hex`，项目目录名用哈希）。
