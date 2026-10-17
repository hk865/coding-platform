# 8D 和 §10 段的执行证据（2026-10-18）：多语言轻型扫描和观测规模

**是什么。** [第 8 片规格](../../../design/orchestration-2026-10/slices/slice-8-SPEC.md)的 8D 和 §10 段，按决定 77、78、79 一起施工、一起合入。
- **8D（决定 78）：** 观测改用轻型扫描读引用。C/C++ 用只读 `#include` 的 libclang，Python 只用标准库的语法树；两者经同一个 NDJSON 执行器，从冻结材料抽引用，模块层照旧只用 TS/JS。8D 原来那套逐语言提供者也在这条线里：8A 的提供者接口、按语言的覆盖、逐文件结果、C/C++ 和 Python 的配置选择。
- **§10 段（决定 77）：** 观测的规模修正。观测有自己的文件清单（git 或固定跳过名单）；TS/JS 的轻型扫描替掉观测里的分析器；一次扫描、模块层和文件层共用；模块正文 v2 和紧凑快照；文件层 v2 的块（边存节点序号、没解析的引用带原因）；被 git 忽略的编译数据库只当配置冻结。
- **决定 79：** 发布前不兼容旧数据。§10 段返工时删掉只读之前格式的路径，包括 v1 正文、`notCaptured`、缺字段的默认值、A-16 和它的夹具，以及整项 `null` 的 `inventory`。
- 验收行 A-06、A-07–A-09、A-11–A-15、A-17–A-28 和查源码的回归行；施工中定下的读法见规格 §12。

**结果。** 已合入（2026-10-18，4041c305）。没有调用真实模型。

## 经过

用量只计 DSH 主会话，子 agent 的没有单独统计。行数是生产代码的增减（`src/`、`scripts/`、`runtime-assets.json`），按各轮的回报。

| 轮 | 说明书 | 报告 | 用时、DSH 主会话用量 | 要点 |
| --- | --- | --- | --- | --- |
| 8D 通读 | `books/s8d-preread.md` | `dsh/preread-final.md` | 243 秒，400 万 token，上下文最高 125,075 | Codex 只读核对代码事实 `codex/facts.*`；lead 的答复写进 `books/s8d-impl.md` 第 8 节；环境里 libclang 18、Python 3.12 和分析器包都在 |
| 8D 施工 | `books/s8d-impl.md` | `dsh/final-1.md` | 2,588 秒，805 万 token，上下文最高 165,518 | 协调者模式，5 个子 agent，+355/−42；Codex 6 条必须改、1 条建议；Claude 子 agent 核实 `books/verify-s8d.md` → `checks/verify-s8d.out.md`（5 条成立、1 条部分成立，另找出 1 条）；lead 的 bwrap 检查 89 个文件、594 项全过 |
| 决定 78 和 §11 | — | `codex/scale-recheck.*` | — | 第六稿冻结（13551ac9）；C/C++ 的实测 `checks/measure-cpp/report.md`，运行时依赖的实测 `checks/measure-runtime/report.md` |
| §10 规格 | — | `checks/measure-8a-report.md`、`checks/measure-8a-scale-cost.md`、`codex/scale-recheck.*`、`codex/scale-spec-review.*`、`codex/scale-spec-review2.*` | — | 两次 8A 实测和两次规格审查后写成 §10（f15f25a4）；决定 79 之后又在返工里删掉旧格式的读法 |
| 8D 返工通读 | `books/s8d-rework-preread.md` | `dsh/rework-preread-final.md` | 244 秒，608 万 token，上下文最高 149,411 | 确认 `notes` 的解码位置、`skipped` 的传法、工作区根和时间参数的接法；原型 32 例过 31 例（唯一不符的是 colcon 汇总那一份，规格已改） |
| 8D 返工 1 | `books/s8d-rework-impl.md` | `dsh/rework-1-final.md` | 1,834 秒，663 万 token，上下文最高 192,821 | §11.1 的拿掉、Python 和 C/C++ 的 `import_graph`、共用的执行器、覆盖的约定；+2,079/−442；Codex 12 条；bwrap 82 个文件、528 项全过 |
| 8D 返工 2 | `books/s8d-rework2.md` | `dsh/rework-2-final.md` | 2,000 秒，1,473 万 token，上下文最高 243,869 | 12 条都改；测试改到共享平台夹具、双后端；+580/−495；Codex 快检 3 条必须改、3 条建议；bwrap 308 个文件、3,168 项过、5 项跳过 |
| 8D 返工 3 | `books/s8d-rework3.md` | `dsh/rework-3-final.md` | 1,372 秒，291 万 token，上下文最高 105,935 | 一个说明符提取器、A-11(2) 的挂住、恢复 RUN-01 守的两条合并规则；+36/−23；Codex 快检第 1 项必须改、第 2 项应改，都并进 §10 段；bwrap 47 个文件、468 项全过 |
| §10 通读 | `books/s8a-scale-preread.md` | `dsh/scale-preread-final.md` | 296 秒，913 万 token，上下文最高 165,898 | 确认清单的接缝、git 的复用方式、v2 的形状、A-16 夹具能从旧代码生成；列出要改的旧断言 |
| §10 施工 | `books/s8a-scale-impl.md`，续 `books/s8a-scale-impl-resume.md` | `dsh/scale-final.md`；Codex `codex/scale-review.*` | 5,314 秒，2,305 万 token，上下文最高 310,550；续 2,165 秒，843 万 token，上下文最高 334,233 | 施工中模型 API 报了一次无效密钥，同一 Session 续做；lead 在续做说明里定 A-06 的 `os（标准库）`，并给出两处要修的问题（production-reach 的三个声明、A-06 的期望）；Codex 7 条必须改、1 条建议；+1,704/−348；本仓库实测 4,290 个文件能抓 |
| §10 返工 1 | `books/s8a-scale-rework-1.md` | `dsh/scale-rework-1-final.md` | 3,507 秒，1,487 万 token，上下文最高 229,144 | 严格捕获恢复、模块层的来源、TS 的三处、块的契约、git 的分类、决定 79 的删除；+435/−630（决定 79 净 −307）；Codex 8 条；bwrap 330 个文件、3,276 项过、5 项跳过 |
| §10 返工 2 | `books/s8a-scale-rework-2.md` | `dsh/scale-rework-2-final.md` | 1,506 秒，438 万 token，上下文最高 138,689 | 模式必填、A-27 经公开入口、`inventory` 不接受整项 null、A-18 的文件层；+16/−13；Codex 快检“可以合入”；bwrap 330 个文件、3,279 项过、5 项跳过 |
| 决定 79 | `checks/decision-79.md` | — | — | 发布前不兼容旧数据；§10 段返工时删掉旧格式的读法；C1 等 K3 第 4 组和 8D 都合入后再开始 |
| 合并全量 | — | `checks/merge-full-suite-summary.txt` | — | 575 个文件全过，8,552 项里 8,547 项过、5 项跳过，2,455 秒，测试的内存峰值 4.67 GB；类型检查、模块边界检查、构建通过 |

合计：生产代码 28 个文件，+3,867/−655；测试 47 个文件，+6,405/−180。

有 bwrap 的分轮检查（`checks/round-checks.txt`）：8D 施工 89 个文件 594 项；8D 返工 1 82 个文件 528 项；8D 返工 2 308 个文件 3,168 项过、5 项跳过；8D 返工 3 47 个文件 468 项；§10 施工 325 个文件 3,241 项过、5 项跳过；§10 返工 1 330 个文件 3,276 项过、5 项跳过。§10 返工 2 330 个文件 3,279 项过、5 项跳过。

## 规模

- **8D 返工**估新增 920–1,380 行、另删约 200 行。三轮返工之后按 `slice-setup` 的口径是 **18 个文件 +2,175/−127**；返工 2 时累计 +2,160/−125，返工 3 本轮另有 +36/−23（分轮数字和最终总数不是同一口径，最终数按同一基线重算）。仍超上限。
- **§10 段**估 820–1,290 行新增，实际 +1,757，超上限 467 行。构成见 `dsh/scale-rework-2-final.md` 第 5 项：414 行在施工那一轮就有（TS 扫描器、观测接线、块的记录路径），返工 1 加 50 行（严格／观测的分开、块的契约、git 的分类、去重），返工 2 加 3 行。不按预算删必需逻辑。

## lead 的验收判断和已知限制

见 `lead-acceptance.md`。
