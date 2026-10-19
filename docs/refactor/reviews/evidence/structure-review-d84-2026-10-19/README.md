# 决定 84 的结构审查（2026-10-19）

**是什么。** C1 合入（`35b5f5b1`）之后的一次只读结构审查（HANDOFF 决定 84）：只看、不改代码。每条发现按“剩下的片会不会接着在那里加代码”分类：

- **第 1 类：** 剩下某一片（6A–6C、7A–7D2、8B、8C、决定 83 那一节）会在那里加代码，在那一片之前单独做一轮，行为不变，每条要用户点头。
- **第 2 类：** 剩下的片不碰，等后端各片合拢后、用真实模型重跑之前做。
- **第 3 类：** 收益小，只记下。

结论和用户的决定见 [HANDOFF 决定 85](../../../HANDOFF.md)。

## 经过

1. **第一轮：Codex 分四路只读审查**（10-19 03:15–03:37，审查副本是 C1 合入后的代码）。每一路先读 HANDOFF 决定 70、72、79、83、84，第 6、7、8 片的冻结规格，以及 C1 验收裁定第 2 节，再看自己的区。提示由模板 `codex/d84-struct.prompt.tmpl.md` 和 `codex/d84-struct-areas.json` 拼成：
   - **A 区：** `src/core/work-graph/` 的 `tasks/`、`evidence/`、`materials/`、`configuration/`（约 38,700 行）；
   - **B 区：** `state/`、`persistence/`、`model/`、`src/contracts/`、`src/core/record-store/`（约 45,400 行）；
   - **C 区：** `views/`、`queries/`、`notes/`、`architecture/`、`sessions/`、`communication/`（约 44,800 行）；
   - **D 区：** `src/app/`、`src/business/`、`src/composition/`、`src/core/agent-runtime/`、`src/core/workspace/`（约 44,400 行）。`src/ui/` 剩下的片不碰，没审。

   每条要写清：问题（文件和行）、现在的代价、剩下哪一片会碰到、改了动不动行为、估计改多少行、归哪一类。每区还要回答几个必答问题，例如三个手写卡源、编解码生成试点放在 6A 前还是后、能不能只留一个 RecordStore 后端、决定 83 的代码落在哪。结果在 `codex/d84-struct-X.out.md`。

2. **第二轮：Codex 逐条反驳**（03:37–03:46）。四路各拿自己区第一轮的结论，逐条找理由推翻，改正归类和行数，结果在 `codex/d84-refute-X.out.md`。两轮说法不同时，以第二轮为准。

3. **DSH 合表**（03:47–03:51，说明书 `books/d84-condense.md`）。DSH 把两轮结果合成一张表 `dsh/d84-condensed.md`：
   - 表里每行注明来源；
   - 另列不成立的条目、各区必答问题的答案、每类合计、两个行为缺陷，以及两轮之间的矛盾和区与区的重叠。

   DSH 的回复在 `dsh/d84-condense-final.md`。这次运行用了 253 秒、3,007,146 token，上下文峰值 164,748（`checks/d84-condense-run.json`）。

4. **lead 整理成一页**给用户：`one-page.md`，第 1 类每条附 lead 的建议。用户看后回复：“提交，按照你的建议去做。”（决定 85）

Codex 两轮都是只读的，不跑测试，不写文件。结论和 DSH 的合表一样只是输入，lead 对着代码核过 `ledger.ts:103` 的游标位数；第 1 类各条在动手那一轮的任务书里再逐条核对位置。

## 结果

| | 条数 | 估计行数（新增＋删除） |
| --- | ---: | --- |
| 第一轮报出 | 38 | — |
| 第二轮推翻 | 7 | — |
| 留下 | 31 | 其中 22 条部分成立（第二轮改了说法、归类或行数），9 条成立 |
| 第 1 类 | 13 | 按片见下 |
| 第 2 类 | 6 | 2,290–2,580 |
| 第 3 类 | 12 | 只记下 |

**按决定 85 落实：**

- **第 1 类 13 条里做 12 条：**
  - 6A 之前一轮：D3、D2、B1、C2、C1、A6，约 4,400–5,600 行；
  - 6B 之前：C3、A1，约 1,500–1,800 行；
  - 7B 之前：A2，以及 D5 的任务门；
  - 7C 之前：D5 的挑人，以及 B4；
  - 7D1 之前：B8。
- **D1“路由按业务域拆”**（2,200–3,000 行，把握中）推迟，改记第 2 类。
- **两个行为缺陷一起作为一条小修：**
  - `tasks/goal-decision-reader.ts` 里的 `atLeastCursor` 收了却没用；
  - `src/contracts/ledger.ts:103` 的序号到 100 亿时会生成 11 位游标，而同文件 `:109` 的解析器只认 10 位。

## 文件

- `one-page.md`：给用户的一页（lead）。
- `books/d84-condense.md`：给 DSH 的合表说明书。
- `dsh/d84-condensed.md`：合表，31 条，加上不成立的条目、问答、合计、缺陷、矛盾和重叠。
- `dsh/d84-condense-final.md`：DSH 的回复。
- `codex/d84-struct.prompt.tmpl.md`、`codex/d84-struct-areas.json`：第一轮的提示模板和四个区的范围与必答问题。
- `codex/d84-struct-{A,B,C,D}.prompt.md` / `.out.md`：第一轮的提示和结论。
- `codex/d84-refute.prompt.tmpl.md`、`codex/d84-refute-{A,B,C,D}.prompt.md` / `.out.md`：第二轮的提示和结论。
- `checks/d84-condense-run.json`：DSH 合表那次运行的记录。
