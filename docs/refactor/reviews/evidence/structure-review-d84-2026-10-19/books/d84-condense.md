# Task: condense the decision-84 structure review into one table (docs only; Chinese)

You are in a copy of the repository. NEW session, headless: when your turn ends, the run ends. **Finish within 40 minutes** (the run stops at 50). No code, no tests, no builds, no git writes, no network. Coordinator mode (`./.dsh-ref/coordinator-mode.md`); at most three subagents; do not end your turn while a subagent has not reported back.

## Material (`./.dsh-ref/d84/`)

HANDOFF decision 84 (`docs/refactor/HANDOFF.md`, item 84) asked Codex for one read-only structure review after cleanup C1, in four areas A–D (`d84-struct-X.prompt.md` / `.out.md`), and a second Codex pass that tried to refute every finding (`d84-refute-X.prompt.md` / `.out.md`). Class 1 = a remaining slice (6A–6C, 7A–7D2, 8B, 8C, the decision-83 section) will add code there, do it before that slice; class 2 = no remaining slice touches it, do it after the backend converges; class 3 = small gain, note only. The second pass's verdict and corrected class / lines **win** over the first pass.

## Write `./d84-condensed.md`

1. One table of every finding that the second pass did NOT mark 不成立, ordered: class 1 first (grouped by the slice that needs it, in build order 6A → 6B → 7A … → 6C), then class 2, then class 3. Columns: 编号（A1, B3 …）| 问题（一句，平白，带 file:line）| 哪一片会碰到（规格和节）| 改法（一句）| 动不动行为 | 估计行数（修正后）| 归类（修正后）| 第二轮结论（成立／部分成立，部分成立写改了什么）| 把握.
2. A short list of the findings marked 不成立, one line each with the reason.
3. The answers to the questions each area had to answer (`d84-struct-X.prompt.md` "Questions you must answer"), one or two lines each, after the second pass's corrections — especially: the three hand-written card sources (C), the codec-generation trial before or after 6A (B), one RecordStore backend (B), where decision 83's prompt code would go (D).
4. Totals per class (count, lines), and any behaviour bugs either pass reported (one line each, file:line).
5. Any place where the two passes or two areas contradict each other, and overlaps between areas (the same change counted twice).

Plain Chinese, short sentences, exact numbers; do not add findings or opinions of your own; cite the source file and row for every line.

## Reply

Under 150 words: what you wrote, and anything you could not settle.
