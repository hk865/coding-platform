# WorkGraph 搬移的执行证据（任务 D，2026-10-07）

**是什么。** 任务 D 把 WorkGraph 拆成子模块目录：18 个文件搬进目标目录（M1–M18，7 个改名），其余 83 个不动，导出名不变。这是纯搬移，只改文件位置和指向它们的 import 路径（决定 32、34、40）。方案和搬移表在 [workgraph-split-2026-10-07](../workgraph-split-2026-10-07/README.md)（`moves.json`），执行做法在 [TASK-D-PLAN](../dsh-ladder-2026-10-07/TASK-D-PLAN.md)。本目录按 TASK-D-PLAN §8.5 收集执行的证据：两段任务书、DSH 的报告和用量、检查结果、和参考搬移的对照、lead 的旧路径清单，以及之后子模块声明那一步的笔记和 Codex 审查。

**提交**（都在 `feat/reliability-and-structure`，没有推送）：

| 步 | 提交 | 内容 |
| --- | --- | --- |
| X2 | d91208e3 | 证据服务的两个依赖类型从 `evidence/contracts.ts` 挪进 `evidence/evidence-service.ts` |
| X1 | 58ea2fdc | `decodeRun` 拆到新文件 `materials/run-snapshot-decoder.ts`；这个提交就是搬移的起点 H |
| 搬移 | 0cd45508 | 165 个文件 +392/−392：18 个改名，158 个文件里 380 处 import 路径，两个架构数据文件里 12 处路径字符串 |
| 记录 | df97cec7 | STATUS、HANDOFF、AGENTS.md 记下任务 D 完成 |
| 子模块声明 | 002e7b28、3f933f51、d8488a80 | `module-target.json` 写入 13 个子模块和 41 条允许的依赖；module-dag §6 等文档；Codex 审查后的修正 |
| 文档旧路径 | 585f1ac0 | 当前文档里的旧路径按搬移表改成新路径（见下文“旧路径”） |

## 结论

- DSH（本地，deepseek-flash）分两段做完：第一段只列出每一处要改的地方后停下，392 行和预期逐行一致；第二段在同一 Session 里照做。没用到带指导的返工轮。
- DSH 的结果和 lead 的参考搬移**逐字节一致**：两边 `git diff -M --binary HEAD` 的 sha256 都是 `adbc8a45…41c0`（228,299 字节），副本里 2800 个文件的 sha256 全部相同。带回本分支后，暂存区的 diff、提交 0cd45508 的 diff 也是同一个 sha256（2026-10-08 用 `git -c core.abbrev=7 diff -M --binary 0cd45508^ 0cd45508 | sha256sum` 复核过）。
- 本分支上：类型检查、模块边界检查、构建通过；全量测试 216 个文件、5245 项全部通过，逐文件的测试数和搬移前相同；568 个模块的 3600 个导出名搬移前后相同。
- 按 [DSH-WORKFLOW](../../../DSH-WORKFLOW.md) §7，纯搬移靠和参考脚本逐字节对照来审，没有另请审查者，也没有让 Codex 审搬移本身。Codex 审了搬移前的 X1、X2 和搬移后的子模块声明，两次都没有要改的代码问题（声明那次有 1 条文档措辞问题，已改）。

## 怎么做的

按 TASK-D-PLAN 的顺序。笔记原文在 `notes/`，下面只摘要点。

1. **准备**（§1–§4，`notes/prepare.md`）。在 H = 58ea2fdc 上重算一切：搬移表和计数、新的基础副本、基线、预期改动、参考搬移和“必过/必不过”的一对检查、任务书。
   - 精确计数（`prepare/counts.md`）：380 处 import 路径在 158 个文件里，其中搬走的 13 个文件里 23 处、其它 145 个文件里 357 处；另加 12 处路径字符串（允许清单 5 处、state-writes 测试 7 处）。和方案在 4404f4dc 上的总数相同，只是 X2 让 3 处从搬走的文件挪到了不搬的 `evidence-service.ts`（方案里是 26 和 354）。
   - 参考搬移在新副本上通过检查器（满分，8 道门全过，5245 个测试 id 无回退），没搬的新副本不通过（`prepare/oracle-pair/`）。
   - 查出一个新陷阱：仓库里方案的证据目录带着参考脚本和答案清单，DSH 的副本会看到。`setup.sh` 在建副本时删掉这两个证据目录再提交；删与不删，参考补丁逐字节相同（`prepare/oracle-pair/unstripped-LTd-canary.json` 是删之前的金丝雀检查）。
   - 基线（`prepare/baseline.md`）：普通 WSL 下全量 216 个文件、5245 项里 127 项失败，全是缺检查沙箱 `/usr/bin/bwrap` 的环境失败，五次全量结果相同；任务书里给 DSH 的可见命令是 `Test Files 3 failed | 68 passed (71)`、`Tests 9 failed | 4202 passed | 29 skipped (4240)`。
   - lead 自己的旧名清单（`prepare/stale-list.md`）：`src/`、`tests/` 里 38 处注释和测试标题，14 处写旧目录，24 处只写文件名。
2. **DSH 第一段**（`books/part1.md`）：读、量搬移前的数字、写脚本、出清单，然后停下。清单和预期对照：`{"expected":392,"got":392,"match":true}`（`dsh/p1-listing-compare.txt`）。第一段除了 `./.dsh-scratch/` 没碰任何文件（`dsh/run-p1-git-status.txt`）。
3. **DSH 第二段**（`books/part2.md`）：同一 Session，`git mv`、按清单改、核对、跑检查、清理、报告。
4. **lead 的核对**（§6，`notes/dsh.md`）：见下面“检查结果”。
5. **带回本分支**（§8，`notes/bringin.md`）：`git apply --index` 补丁，暂存区 diff 和补丁逐字节相同；574 个 `src/`、`tests/` 文件的 blob id 和 DSH 副本相同；跑全量检查后提交 0cd45508。
6. **子模块声明**（`notes/module-target.md`）：把方案 `target.json` 的 13 个子模块、41 条依赖写进 `module-target.json`（002e7b28），文档补注（3f933f51）。在副本里埋了 5 条反向依赖，检查器都报出了文件和行。Codex（high）审过，1 条低级别问题已改（d8488a80）。
7. **记录**（`notes/closeout.md`）：df97cec7。

## 检查结果

| 检查 | 结果 | 文件 |
| --- | --- | --- |
| 检查器 `LTd/check.sh`（DSH 的副本） | 通过，满分：165/165 个文件对，且和参考搬移相同；18/18 个搬移是 git 改名（相似度至少 96）；8 道门全过（搬移、类型检查、边界检查、没有多余改动、只改路径、路径写法规范、没有提交、测试不变）；216/216 个文件、5245/5245 个测试 id，0 回退 | `dsh/check.json` |
| 和参考搬移逐字节对照 | 补丁 sha256 相同；两边建副本的树相同（a1554d40）；2800 个文件 sha256 全同；没改的 166 个测试文件保持原 blob | `dsh/tree-compare.txt`、`dsh/tree-compare.sh` |
| git 状态的形状 | 5 个 `R`、13 个 `RM`、147 个 ` M`，没有未跟踪文件；numstat 165 项，每项增删行数相等，共 392 行，5 个没改内容的搬移是 `0 0` | `dsh/tree-compare.txt` |
| 任务书里的可见检查（DSH 的副本） | 类型检查、边界检查 exit 0；vitest 两行和基线相同 | `dsh/visible-LTd-1.md` |
| 搬移后的导入图（§6.5） | DSH 副本上的五个输出和参考副本上的逐字节相同：按 `target.json` 0 条违规、子模块之间无环；按 10-02 的严格声明只有 `model/plan-contracts.ts:19` 的 model → state 一条（决定 40 修法 B 声明的那条） | `prepare/ref-graph/` |
| scan.json | 第一段 1 处“越界”是已知误报（它自己 grep 命令里的 `../../../`）；第二段无。两段 `/tmp` 都是 0，禁止的 git 命令都是 0，金丝雀 0 | `dsh/run-p1-scan.json`、`dsh/run-p2-scan.json` |
| 本分支：改了哪些文件 | 165 = 18 个改名 + 145 个改 import 的 + 2 个数据文件，和预期数据一致；`src/`、`tests/` 以外 0 个 | `bringin/verify-real.mjs`；`git show --name-status -M 0cd45508` 可复现 |
| 本分支：导出名 | TypeScript 检查器读两个 tsconfig 的程序，搬移前后 568 个模块、3600 个导出名（含值/类型种类）相同；搬走的 18 个模块的 210 个名字按旧路径对照也相同 | `bringin/exports.mjs`（输出 JSON 没入库：前 `bf6ca23e…c0d6`，后 `f5b877ff…b515`） |
| 本分支：类型检查、边界检查、构建 | 通过 | `notes/bringin.md` |
| 本分支：全量测试 | `Test Files 216 passed (216)`、`Tests 5245 passed (5245)`，996 秒，exit 0；逐文件测试数和第 7 步（2ba9b46b）相同 | `bringin/full-suite-tail.txt` |

本分支的全量测试用的是带 `/usr/bin/node` 和检查沙箱的包装脚本，所以全部通过；准备阶段的基线在普通 WSL 下跑，有 127 项环境失败。两者比的是“同一环境下搬移前后相同”，不是两个数字互比。

`verify:isolated` 当时没跑（TASK-D-PLAN §8.3 写了，BringIn 阶段的任务没点名），留给收尾。

## DSH 的报告，逐条核对

报告原文：`dsh/run-p1-final.md`、`dsh/run-p2-final.md`。

- **DRY RUN 和 CHECKS 的数字**全对：392 行 = 380 处 import 路径（搬走的 13 个文件 23 处 + 其它 145 个文件 357 处）+ 12 处路径字符串。
- **FILES CHANGED**：18 个搬移加 147 个其它文件，和 `git status` 的 147 个 ` M` 完全相同。
- **旧名清单（UNSPECIFIED）**：两段都列了 38 处，和 lead 的 38 处相同（`dsh/p1-stale-lines.txt`、`dsh/p2-stale-lines.txt`、`dsh/lead-stale-38.txt` 三个排序后的 file:line 列表相同）。ladder 的 L3 原样任务书只列出 14/38，这次任务书给了列举方法，就全了（DSH-WORKFLOW §6.3 第 7 条）。
- **否定说法**：8 条“没找到”和 1 条“只有数据行”，lead 用 `git grep` 逐条核实，全对。
- **一处位置写错**：报告说 `tests/architecture/boundaries.test.ts:354` 有一个 `.mjs` 路径，实际在第 6 行；354 是字符偏移。内容本身对（这个路径两端都不搬，按规则 (c) 不动），不影响结果。TASK-D-PLAN §10 预计报告里至少有一处这类错误。
- **流程**：没用 `/tmp`，没用禁止的 git 命令，`.dsh-scratch/` 已删，没有提交，标签没动。

## 用量（决定 36）

**DSH**（`dsh/run-p1.json`、`dsh/run-p2.json`）：

| 段 | 墙钟 | 实际运行 | token（输入 / 读缓存 / 输出） | 工具调用 |
| --- | ---: | ---: | --- | ---: |
| 第一段：读、量、写脚本、出清单、查旧名 | 183 秒 | 183 秒 | 1,000,540（31,431 / 932,736 / 36,373） | 26 |
| 第二段：搬、改、核对、检查、清理、报告 | 292 秒 | 约 205 秒 | 1,172,794（7,372 / 1,147,648 / 17,774） | 14 |
| 合计 | 475 秒 | 约 6.5 分钟 | **2,173,334** | 40 |

- 第二段里主机睡眠了 87 秒（`dsh/host-sleep.txt`：Windows 系统日志的睡眠记录，WSL 跟着暂停），所以实际运行约 205 秒。检查器那段也睡了三次，共 1312 秒，墙钟 1818 秒里实际约 506 秒。睡眠前后没有测试失败或时好时坏，逐字节对照也不受时间影响。
- 在计划估计（6–10 分钟、200–380 万 token）之内；比 ladder L3 单次跑完整个任务（352 秒、188 万 token）多约 30 万 token、36 秒。

**lead**（笔记里记下的；token 数没记）：

| 阶段 | 工具调用 | 时间 | 其中 |
| --- | ---: | ---: | --- |
| DSH 阶段（启动两段、对照、核对） | 约 56 次 | 约 47 分钟 | 约 37 分钟在等（第一段 3 分钟、第二段 5 分钟、检查器 30 分钟，其中 22 分钟是主机睡眠）；读和查约 10–15 分钟 |
| 带回本分支 | 约 47 次 | 约 25 分钟 | 全量测试约 17 分钟；应用、逐字节和 blob 对照、导出名、旧名扫描和提交约 8 分钟 |
| 记录（df97cec7） | 约 25 次 | 约 15 分钟 | 全是读和写 |
| 准备、X1/X2、子模块声明 | 没记 | 没记 | 准备阶段的机器时间主要是五次全量测试（每次约 6–7 分钟） |

**Codex**（只读审查，`review/`）：

| 审什么 | 推理强度 | 时间 | token（输入 / 其中缓存 / 输出） | 结论 |
| --- | --- | ---: | --- | --- |
| X2、X1（d91208e3、58ea2fdc） | xhigh | 约 10 分钟 | 1,455,854 / 1,326,336 / 17,087（推理 8,288） | 没有问题 |
| 子模块声明（002e7b28、3f933f51） | high | 约 5 分钟 | 855,259 / 792,576 / 5,992（推理 679） | 1 条低级别：STATUS 把规格已采纳的 `pure: true` 写成“换不换由 lead 定”；已在 d8488a80 改 |

两次的 stderr 都有一行 `collab spawn failed`（Codex 想开子线程没开成），运行都是 exit 0、结论完整。事件日志（60–90 万字节）没入库。

## 旧路径（TASK-D-PLAN §8.6 的后续）

搬移不改注释和文档。lead 在带回阶段列了清单（`stale-paths.md`）：

- `src/`、`tests/` 里 38 处注释和测试标题：24 处已经不对（14 处写旧目录，10 处写的文件名改了），14 处写的文件名没变，仍然对。这些由收尾另一步处理，不在本目录。
- 当前文档 13 份共 82 行。2026-10-08（585f1ac0）改了其中 11 份的 71 行，另把规格里 6 行只写旧文件名、而文件已改名的地方（`coverage.ts`、邮件那节的 `contracts.ts`）一起改了；这些行里引用的搬走文件的行号，按现在的代码逐个核对过，漂了的改正。没改的：D-PLACEMENT 第 121、122 行（有意写搬移前的样子）；`modules/core/work-graph.md` §2 那张 2026-09-23 的目标文件表里 8 行（那张表按原样保留，表上方加了一条补注写出这 8 行的新位置）；STATUS 和 HANDOFF 由收尾的最后一步写。
- 旧报告、旧任务书和冻结的原型副本里的旧路径是历史，不改。

## 还没做的

- `verify:isolated`（收尾做）。
- 规格 §14.4 定了把 state 的 `pureDirectories` 换成子模块上的 `pure: true`；检查器还不认这个字段，先要改检查器（见 STATUS“剩余”）。
- WSL 里的副本 `~/dsh-work/ladder/LTd-1`、`LTd-ref` 在写这份证据时还留着，可以删（`drop_copy`）。

## 文件

笔记写于各阶段当时，里面的路径指 lead 的临时目录：`P/`、`prepare/` 是准备阶段的输出，`D/`、`dsh/` 是 DSH 阶段，`B/`、`bringin/` 是带回阶段；`taskd/` 是它们的上一级。对应文件凡是入库的，都在本目录同名的子目录里。

| 路径 | 内容 |
| --- | --- |
| `notes/prepare.md` | 准备阶段：前提、重算、基线、预期改动、检查器的对照、任务书清单 |
| `notes/x12.md` | X2、X1 两步代码改动和它们的 Codex 审查 |
| `notes/dsh.md` | DSH 阶段：§6 每项检查的结果、DSH 用量、报告核对、主机睡眠、lead 用量 |
| `notes/bringin.md` | 带回本分支：应用补丁、逐字节和 blob 对照、导出名、全量测试、lead 用量 |
| `notes/closeout.md` | 记录任务 D 的文档提交 df97cec7 |
| `notes/module-target.md` | 子模块声明：写法、检查、埋反向依赖、Codex 审查 |
| `books/part1.md`、`books/part2.md` | 给 DSH 的两段任务书（第一段 1,899 词，第二段 504 词） |
| `dsh/run-p*.json`、`dsh/run-p*-scan.json` | 两段的运行记录（时间、token、工具调用）和过程扫描 |
| `dsh/run-p*-final.md` | DSH 两段的报告原文 |
| `dsh/run-p1-git-status.txt` | 第一段结束时副本的 `git status`（只有 `.dsh-scratch/`） |
| `dsh/p1-listing-compare.txt` | 第一段清单和预期的对照 |
| `dsh/check.json` | 检查器对 DSH 副本的结论 |
| `dsh/visible-LTd-1.md` | 任务书里的可见检查，在 DSH 的副本上重跑 |
| `dsh/tree-compare.sh`、`dsh/tree-compare.txt` | 和参考副本逐文件对照 |
| `dsh/*-stale-*.txt`、`dsh/p1-stale-search.log` | DSH 两段和 lead 的旧名清单（排序后的 file:line），DSH 的查找日志 |
| `dsh/host-sleep.txt` | 主机睡眠的时间段 |
| `dsh/run-p1.sh`、`dsh/run-p2.sh`、`dsh/graph-ltd1.sh` | 启动两段和跑导入图的脚本 |
| `prepare/baseline.md`、`counts.md`、`counts.txt`、`move-table.md` | 基线、精确计数、在 H 上重算的搬移表 |
| `prepare/stale-list.md` | lead 在 H 上的 38 处旧名清单 |
| `prepare/oracle-pair/` | 参考搬移通过、没搬的副本不通过、金丝雀检查 |
| `prepare/ref-graph/` | 参考副本上搬移后的导入图和边界检查；DSH 副本上的同样五个输出与之逐字节相同，所以没另存 |
| `prepare/ltd/` | 这一级的 `setup.sh`、`check.sh` 和数据（`data/moves.json` 和方案目录的 `moves.json` 逐字节相同） |
| `prepare/tools/` | 准备阶段 lead 用的脚本（计数、基线、对照、旧名扫描） |
| `prepare/new-base.log` | 新基础副本的建立记录 |
| `bringin/verify-real.mjs`、`bringin/exports.mjs` | 本分支上核对改动文件和导出名的脚本 |
| `bringin/full-suite-tail.txt` | 本分支全量测试输出的最后 61 行（去掉了颜色控制符） |
| `stale-paths.md` | 搬移后 lead 的旧路径清单：38 处注释和测试标题、82 行当前文档、历史文档的范围、查找命令 |
| `review/x12-codex.*`、`review/mt-codex.*` | 两次 Codex 审查的说明和结论 |

没有入库的（都能复现或已有哈希）：补丁本身（= 提交 0cd45508 的 diff，sha256 `adbc8a45…41c0`）；`expected.json`（sha256 `5580dd6f…3c32`，用 `_tools/mk-move-data.sh LTd` 生成）；逐文件 sha256 列表；导出名 JSON；`git status`、`name-status`、`numstat` 的原始输出（`git show --stat`/`--name-status -M 0cd45508` 可复现）；Codex 事件日志；基线的完整 JSON。
