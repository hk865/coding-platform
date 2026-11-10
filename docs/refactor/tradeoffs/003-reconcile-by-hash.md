# 003 文件监听只当提示，对错按内容哈希对账

状态：采用（决定 121-68、121-74、121-75）
日期：2026-11-09

## 背景和约束

- 第 2 步把代码知识放进仓库文件，文件是准，库只是索引。人手改、合并、pull、切分支都会在平台之外改这些文件，平台必须知道它们变了，否则图、注记和索引会指着旧内容（[HANDOFF 121-68](../HANDOFF.md)）。
- 这里的“对账”指：拿平台上次记下的文件内容和 blob 哈希，和磁盘上现在的内容比，找出新增、删除、修改的文件，再决定哪些图、注记和索引要重算。`blob` 是 git 对文件内容算出的哈希标识，同样内容给同样标识；它不是文件修改时间，也不是文件大小。
- 监听不可靠是日常情况：WSL 访问 `/mnt/<盘>` 时收不到 Windows 侧的改动；Windows 上一次改几千个文件（例如 `git checkout`）缓冲区满会丢事件；网络盘也不可靠。所以监听最多回答“该看一眼了”，不能回答“变成了什么”（[HANDOFF 121-68](../HANDOFF.md)）。
- 当时的规模前提和 002 相同：单机单用户，方向 10 万–100 万行；操作系统、游戏引擎这一级放在 MVP 之后（[PRODUCT §1.4](../../PRODUCT.md)；[HANDOFF 121-69](../HANDOFF.md)）。
- 这一篇只定“怎么知道文件变了、变了以后信谁”；数据分层和库的位置见 001，SQLite 选型见 002，注记全文见 006。

## 选项

三个选项和否掉的理由来自决定 121-68。

| 选项 | 怎么做 | 好处 | 坏处 |
|---|---|---|---|
| 只靠文件监听 | 用 `fs.watch` 或现成的监听库订阅文件系统事件，事件来了就更新 | 马上知道，界面可以立刻刷新 | 丢事件、重复、跨系统不可靠；错一次就长期错，且很难发现错在哪 |
| 只靠定期全量扫 | 按固定间隔扫一遍，比较内容 | 不漏，不依赖事件 | 慢一拍；扫得勤占 I/O，扫得稀晚知道，且仍要比较 |
| **监听只当提示 + 安全点对账** | 监听只排一次对账；Run 结束、采用计划前、Host 空闲时直接枚举 `.workbench/`，按 blob 比较 | 事实来自文件，监听只决定“什么时候看” | 不是实时；合并冲突要等下一个安全点 |

## 选了什么，为什么

- 选最后一行：权威在对账，监听只当提示。监听事件到了，排一次对账；没有事件，安全点也会排。对账的触发点是 Run 结束、采用计划前、Host 生命周期空闲；**没有“HEAD 变了”这一条**，存储设计的裁定已把 HEAD 从对账里拿掉，只留给钉版本（[HANDOFF 121-72](../HANDOFF.md)；[HANDOFF 121-75](../HANDOFF.md)）。
- 对账第一步是直接枚举 `<检出>/.workbench/`：递归列普通文件，跳过 `local/` 和 `*.tmp-*`，排序。这份清单就是完整路径清单，不靠 `git ls-files --exclude-standard`；人把 `.workbench/` 写进 `info/exclude` 后 git 看不见它，照 git 列会漏（[HANDOFF 121-75](../HANDOFF.md)）。
- git 只用来给“和 HEAD 一样的干净文件”复用 blob：`git status --porcelain=v1 -- .workbench` 取脏、未跟踪、删除的文件，`git ls-files -s -- .workbench` 取干净 tracked 文件的 `(path, blob)`。不再调 `git ls-files --others --exclude-standard`，也不需要 `git diff-tree`（[HANDOFF 121-75](../HANDOFF.md)；`src/core/workspace/workspace-change-capture.ts:78` 是统一的 git 执行口，`src/core/workspace/git-read.ts:484` 的现成 `ls-files` 只给路径，要加 `-s`）。
- 对每个文件：干净且 tracked 的用 `ls-files -s` 的 blob；脏的、未跟踪的用 `gitBlobId(bytes, objectFormat)` 按字节算 blob；不是 git 的文件夹用同一个函数、默认 `sha1` 算。和 `knowledge_file.blob_sha` 比，相同就跳过（[HANDOFF 121-75](../HANDOFF.md)；`src/core/workspace/workspace-change-capture.ts:110` 是 `gitBlobId`，`:131` 是 `pickObjectFormat`）。
- **同一内容只解析一次。** blob 相同就复用上一次的解析结果，不因为文件在另一个路径或另一条线就再解析一遍；索引以 blob 为键，同内容只有一份（[HANDOFF 121-75](../HANDOFF.md)）。
- **坏文件作废现行映射。** 解析失败的文件不能继续拿旧解析当现行：删掉它在索引里的现行映射，读回 `unavailable` 并带清单；旧解析最多留作缓存（[HANDOFF 121-75](../HANDOFF.md)）。
- **对账时存未提交文件的快照。** 对每个脏的、未跟踪的知识文件，按 `(线, 路径)` 和内容哈希写一份 `knowledge-snapshots.sqlite`（键是线 + 文件 + 时间）；同一个 `(线, 路径)` 的最新内容相同就不重复，每个键只留最近 20 份，文件在这条线上提交后删。第 2 步还没有“线”，键先用分支名，第 3 步起换成线。快照只在恢复时用，不参与任何读路径（[HANDOFF 121-74](../HANDOFF.md)、[HANDOFF 121-75](../HANDOFF.md)）。
- 为什么不信监听：这些失效不是小概率，是 WSL、Windows 大改、网络盘的日常情况；监听丢了事件，如果拿它当准，就会漏掉文件变更，图和注记不会重算。对账慢一点，但结果可复核（[HANDOFF 121-68](../HANDOFF.md)）。

## 代价，以及因此要守的规矩

- **监听事件不能直接改图、注记或索引**，它只能排一次对账。任何“看到事件就写”的捷径都要删掉，因为事件可能丢，而且事件不是权威（[HANDOFF 121-68](../HANDOFF.md)）。
- **比较只用内容哈希。** 权威输入是 blob 哈希和文件字节，不是 mtime（文件修改时间）、文件大小或“看起来没变”。mtime 不参与判定（[HANDOFF 121-75](../HANDOFF.md)）。
- **对账只在点名的安全点做：** Run 结束、采用计划前、Host 生命周期空闲；不在每个工具调用后全扫，也不再加 HEAD 比较（[HANDOFF 121-72](../HANDOFF.md)）。
- **git 只用只读命令。** 关掉可选锁、fsmonitor（git 的文件监视缓存）和外部 diff/过滤器；平台的读不能让 git 写索引或跑 hook（`src/core/workspace/workspace-change-capture.ts:78`）。
- **对账失败只记 `unavailable`，保留旧索引，不改文件。** 不要把失败当成“文件没变”，也不要把它升级成写入失败（[HANDOFF 121-75](../HANDOFF.md)）。
- **对账不改知识文件、不提交 git。** 发现变化后按规则更新索引和映射，索引仍然是缓存；写入队列和外部的提交才有权改文件、动 git（[HANDOFF 121-68](../HANDOFF.md)、[HANDOFF 121-75](../HANDOFF.md)）。
- **目录枚举只收普通文件，不跟随符号链接和特殊文件。** 平台自己只写普通文件；别的类型不是它创建的，遇到跳过（[HANDOFF 121-75](../HANDOFF.md)）。
- **`info/exclude` 忽略的知识文件仍在清单里。** 这是直接枚举而不是问 git 的目的；漏了它们，人以为“只留在本机”的改动就永远不会进索引（[HANDOFF 121-75](../HANDOFF.md)）。

## 什么情况变了要重新考虑

- 对账本身成了瓶颈：大仓库上目录枚举加 blob 比较慢到超过安全点允许的等待（当时没有记录具体阈值）。这时先量清楚是枚举慢还是哈希慢，再决定加触发点或换遍历方式（[HANDOFF 121-75](../HANDOFF.md)）。
- 有可靠的跨系统监听（WSL 能稳定收到 Windows 侧事件，网络盘也能可靠通知）时，可以把提示提前、让界面更实时；但对账仍然保留，因为监听仍可能丢（[HANDOFF 121-68](../HANDOFF.md)）。
- 代码库到操作系统、游戏引擎这一级（Windows 迁 git 时约 350 万个文件、约 300 GB；Linux 约 10.8 万个文件），全树对账的成本要重新量；这时更依赖 git 的稀疏检出、部分克隆和 fsmonitor，而不是自己扫目录（[PRODUCT §9](../../PRODUCT.md)；[HANDOFF 121-69](../HANDOFF.md)）。
- 版本管理不是 git（例如 Perforce）：内容哈希和线都要一层适配，适配之前只能按“只留在本机”模式做，对账规则要重新写（[HANDOFF 121-69](../HANDOFF.md)）。
- 安全点不够用（例如用户在平台外改了很久，界面一直不刷新），可以增加对账时机（打开界面、定时心跳变密），但不能改成“事件即真相”（[HANDOFF 121-68](../HANDOFF.md)）。

## 来源

- 用户当时的问法（11-09，决定 121-68 概括）：“心跳机制？还是事件触发？”；“感觉也是一个hash，类似分布式的bitcoin相关的”（[HANDOFF 121-68](../HANDOFF.md)）。
- 决定 121-68：代码知识进仓库文件、文件为准；文件监听只当“该对账了”的提示（[HANDOFF 121-68](../HANDOFF.md)）。
- 决定 121-72：存储设计的裁定把 HEAD 从对账里拿掉，只留给钉版本（[HANDOFF 121-72](../HANDOFF.md)）。
- 决定 121-74：每次对账把没提交的知识文件存快照，提交后删（[HANDOFF 121-74](../HANDOFF.md)）。
- 决定 121-75：直接枚举 `.workbench/`、按 blob 比较、复用解析结果、坏文件作废现行映射、快照和保留 20 份（[HANDOFF 121-75](../HANDOFF.md)）。
- 代码：`src/core/workspace/workspace-change-capture.ts:78`、`:91`、`:110`、`:114`、`:131`、`:211`；`src/core/workspace/git-read.ts:484`。
- 规格：[PRODUCT §1.4](../../PRODUCT.md)、[PRODUCT §9](../../PRODUCT.md)。
