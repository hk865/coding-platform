# Continue: fix the 8D docs drafts (docs only; Chinese)

The lead read your drafts and had Codex check every fact: `./.dsh-ref/s8d-docs-facts.out.md` (Chinese; items 1–15
with the draft file:line, the evidence and the corrected sentence; **S** = the slice-8 spec, **E** = the evidence
folder, **R** = `.dsh-ref/`, **W** = `src/core/workspace/`, **A** = `src/core/work-graph/architecture/`). Same rules as
your book: drafts only, no code, no tests, no git writes. **Finish within 40 minutes** (the run stops at 50). Do not end
your turn while a subagent has not reported back.

1. Apply all of Codex's items 1–15, including the two suggestions (9, 15), as corrected there. Check each correction
   against the evidence it cites before you write it; if one is wrong, say so in the reply and keep your text.
2. The lead's own items:
   - STATUS: the "更新：" date is 2026-10-18.
   - STATUS next steps, the K3 bullet (~line 109, "B3（拦命令和请求重跑）施工完，按 Codex 审查的 12 条在返工"): B3 施工完，
     返工四轮（第 4 轮在做：K3/B2 的测试改走一条真实运行的共用路径，运行只由运行时结束，2026-10-18）；四段做完一起合入.
     The slices README item 3 says "B3 在返工 4（Codex 审查 12 条）" — the same correction there, and in STATUS's title
     line and AGENTS keep "K3 第 4 组 B3 在返工 4".
   - lead-acceptance: "没有调用真实模型" appears twice (known limits and the 模型 section); keep only the 模型 section.
   - README 规模: 8D after its three reworks, against `slice-setup` (src, scripts, runtime-assets.json):
     18 files +2,175/−127 (estimate 920–1,380 added plus about 200 removed). Use this number for item 10.
   - Keep the `【lead 填】` placeholders (the merge suite and the s8a-scale-r2 check numbers).

Reply under 250 words: what you changed per item, any Codex correction you did not take and why.
