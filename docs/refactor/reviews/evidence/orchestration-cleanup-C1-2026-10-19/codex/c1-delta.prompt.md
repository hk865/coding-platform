Read-only. Do not write any file, do not run tests. Answer in Chinese with file:line (paths relative to this copy).

This copy is now the lead branch WITH K3 merged (K3 groups 1–4 on top of lead `c7f7cb0`, plus the lead's merge fix in `src/core/agent-runtime/context-assembler.ts` and `execution-preparation.ts`). Your earlier C1 refresh was done on lead `c7f7cb0` before K3: `./.lead-ref/c1/c1-refresh.out.md` (its inputs are in `./.lead-ref/c1/`). It marked 27 items **K = "K3 合入后再核"**, put them in group G6, and said the `atLeastCursor` fix (section 七) also waits for K3. Also ignore `./.lead-ref/*.diff` and the other files in `./.lead-ref/` (they belong to the merge check).

Now K3 is in. For the C1 book the lead needs, on this tree:
1. **Every K item** (sections 一、二、四、五 rows marked K, and G6's list): still valid? Give the current location (file:line), whether K3 already added a shared helper that the item should reuse instead of creating one (you named `persistence/lookup-all.ts` and `tasks/codec-fields.ts` as K3 files; check what they contain now), the changed net line estimate, and anything K3 added that is a NEW duplicate of the same kind inside `src/core/work-graph/` (list only clear duplicates, with both locations).
2. **The 16 withdrawn items** and the non-K items: does K3 change any of them (a file K3 touched)? Only list changes.
3. **Section 七 `atLeastCursor`**: still as described? Current file:line.
4. **Re-group** for DSH: keep "one file belongs to one group; shared helper first; error codes, texts, order and stored bytes unchanged". Give the final group table (group, files, items, net lines) for the whole C1 (G1–G6 or a new split if K3 makes G6 too large: target 600–1,200 changed lines per group), with the order the groups should run in and which groups can run in parallel (disjoint files).
5. **Comments (decision 35)**: does K3 add comment blocks in the C1 areas that the same rules would trim? Give a count per area and three examples, no full list.

End with: the C1 totals (items kept, withdrawn, net lines) after K3, and any item that now needs a lead ruling (with options).
