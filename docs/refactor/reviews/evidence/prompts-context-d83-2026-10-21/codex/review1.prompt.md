# Review of a spec draft: prompts and context for slices 6 and 7 (decision 83)

**Read only:** do not modify, create or delete any file; no tests, no builds, no git, no network. Answer in plain
Chinese, with `file:line` for every fact.

This tree is the lead branch (code at `4d874f0b`). The lead wrote the first draft
`./.lead-ref/slice-6-7-PROMPTS-SPEC.md`: a supplement to the frozen slice 6 and 7 specs
(`docs/refactor/design/orchestration-2026-10/slices/slice-6-SPEC.md`, `slice-7-SPEC.md`), required by decision 83 in
`docs/refactor/HANDOFF.md` (search "83. **第 6、7 片补一节"); decision 85 in the same file sets the structure round
(D3 splits the context assembler before 6A). Your own earlier survey is `./.lead-ref/context-layout.out.md` (10-18;
some paths moved since, `src/ui` was deleted). The frozen Kernel is `vendor/coding-agent/dist`; managed patches are in
`vendor/coding-agent/patches` and built only by `scripts/build-kernel-patch.mjs`.

## Check, against this tree's code

1. **§0.2 facts:** is each fact true at the cited place? Anything important missing that changes a choice?
2. **Each choice P1-P11:** can it be built as written on this code? Name what breaks, what it contradicts in the
   frozen slice 6/7 specs or decisions 83/85, and any behaviour it changes that the draft does not say. In particular:
   - P3: can the runner mark "this Run's task input" from the history/current split it already has? Does keeping
     instruction Skills and stubbing old tool results keep every provider's tool-call pairing valid?
   - P4: does stripping earlier Runs' reasoning break DeepSeek's tool loop as the adapter sends it today?
   - P5: can composition-root take the base prompt and Skill bodies in memory without breaking resume, the
     `onConfiguration` shape, or the Skill header bytes? Is writing `PromptTextV1` in the permit commit possible?
   - P6: does `current_turn` for secretary rounds conflict with slice 6 (L5 batching, L10 handoff threshold) or the
     Query observation code?
   - P10: what else depends on the brief being the input's suffix?
   - P11: are the eight steps real owner calls reachable from one server-side action today?
3. **D3 boundary (§0.4):** is "move today's texts verbatim, same bytes" feasible for the listed texts? Which listed
   text cannot move without changing bytes, and which hard-coded prompt text is missing from the list?
4. **Tests (§3):** a behaviour that cannot be tested through the named entry; an expected value that cannot be
   hand-computed; an old test that will break and is not listed in §3.3.
5. **Anything a literal implementer (DSH) will get wrong:** ambiguous, contradictory or impossible wording.

Do not report style. Report only what you can prove from this tree.

## Answer

A table: `编号 | 类别（会出错/与冻结规格或决定冲突/事实错/不清楚/建议） | 位置（§ 或 P 号） | 问题 | 依据（file:line） | 改法`.
Number the rows D83-01, D83-02, …. End with one line: `会出错 N，冲突 N，事实错 N，不清楚 N，建议 N`.
