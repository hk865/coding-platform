# Second full review of a spec draft: prompts and context for slices 6 and 7 (decision 83)

**Read only:** do not modify, create or delete any file; no tests, no builds, no git, no network. Answer in plain
Chinese, with `file:line` for every fact.

Your first review is `./.lead-ref/review1.out.md` (23 findings) on `./.lead-ref/spec.v1.md`. The lead revised the
draft into `./.lead-ref/slice-6-7-PROMPTS-SPEC.md` (diff: `./.lead-ref/spec.v1-v2.diff`); §7 of the draft says how
each finding was handled. Code is unchanged (`4d874f0b`). Frozen specs: `docs/refactor/design/orchestration-2026-10/
slices/slice-6-SPEC.md`, `slice-7-SPEC.md`; decisions 83 and 85 in `docs/refactor/HANDOFF.md`.

## Check

1. For each of D83-01…D83-23: is the handling in the second draft right and complete on this code? Say "已解决",
   "部分解决（缺什么）" or "没解决（为什么）".
2. **New problems the revision introduced**, against this tree's code. In particular:
   - P3: can the runner take a platform estimate over the Kernel-built request plus the platform's outer changes
     (`responseFormat`, output limit) and a per-request budget, given how `observed-model-run.ts` and
     `model-budget.ts` compute them (the output reservation depends on cumulative totals)? Is anything in the
     selection or the hook re-check (`runtime-runner.ts:715`) left on the old estimator?
   - P5: can `bodies.put` store the base prompt and Skill bodies before the manifest on both the Work and the Query
     preparation paths? Can the Work permit record and the QueryRun request record take the new fields (codecs,
     replay, idempotency fingerprints)? Is `toolSpecsRef` storable before the first `beforeCall` on both paths?
   - P6: does putting the secretary request content in the guard's `task` section fit `context-input.ts` (required
     sections, budget sections) for the `secretary` call kind?
   - P8: can a line be appended to the role section for every call kind without failing the state guard or a
     rendering check?
   - P2: what is the existing refusal when the configuration revision differs at start and at resume?
3. **Tests (§3):** a behaviour that cannot be tested through its named entry; an old test that will break and is
   not in §3.3.
4. **Anything a literal implementer (DSH) will get wrong.**

Do not report style or anything already accepted unless the handling is wrong.

## Answer

Part 1: a table `D83-xx | 结论 | 依据（file:line） | 还要改什么`.
Part 2: a table `编号 | 类别（会出错/冲突/事实错/不清楚/建议） | 位置 | 问题 | 依据（file:line） | 改法`, rows N-01, N-02, ….
End with one line: `已解决 N，部分 N，没解决 N；新：会出错 N，冲突 N，事实错 N，不清楚 N，建议 N`.
