Read-only structure review for the lead (HANDOFF decision 84). Do not write any file, do not run tests or builds. Answer in Chinese with file:line. No word limit; be complete for your area.

This copy is the lead branch right after cleanup round C1 merged (commit `35b5f5b1`). C1 merged duplicated small helpers and trimmed construction-history comments in `src/core/work-graph` without changing behaviour; it did **not** change module structure. Decision 84 (`docs/refactor/HANDOFF.md`, item 84) asks for one structure review now, **look only**: each finding is sorted by whether the remaining slices will keep adding code there.

## Read first (in this order)

1. `docs/refactor/HANDOFF.md` decisions 70, 72 (its "结果"), 79, 83 and 84.
2. The frozen specs of the remaining slices, including the post-notes at their top: `docs/refactor/design/orchestration-2026-10/slices/slice-6-SPEC.md` (6A, 6B, 6C), `slice-7-SPEC.md` (7A–7D2), `slice-8-SPEC.md` (8B, 8C; 8A, 8D and L8 are merged). Know what each remaining slice adds and where (files, records, events, ports, cards, routes, prompts).
3. `./.lead-ref/c1-lead-rulings.md` §2 (C1's rulings; items 6 and 7 are open structure questions handed to you).

## Your area

`src/core/work-graph/views/`, `queries/`, `notes/`, `architecture/`, `sessions/`, `communication/` (together about 44,800 lines).

Look at other areas only to follow a dependency or to compare a duplicate; report findings in your area only (name the other area's file when a finding spans both).

## What counts as a finding

A place where the structure makes the code harder to read, change or reuse **in a way that costs something now or will cost the remaining slices something**. For example:
- a module boundary in the wrong place: a file or directory that mixes several jobs, a dependency in the wrong direction, a layer that is skipped, an owner whose rules live in another owner;
- a pattern every new record / event / card / route / tool must copy by hand (name how many copies exist today and how many the remaining slices will add, from the specs);
- duplicates C1 left on purpose because they differ slightly (C1 book §5 "look-alikes"; rulings item 7): would one shared helper with an explicit parameter be clearer, or are they different on purpose?
- a very large file whose parts change for different reasons;
- an extension point a remaining slice needs that today would mean editing several unrelated files.

**Not findings:** behaviour bugs (list them separately at the end, one line each, if you see any), naming taste, comment style, test code, anything C1 or T already covers (C1: the cleanup list; T: stale/duplicate/trivial tests, unused production code, code only for old data), anything that changes product behaviour.

## Questions you must answer for your area

1. C1 rulings item 6: slice-4 spec §14 item 10 says three card sources are still hand-written instead of using the generic card source (`createCollectionCardSource` in `views/decision-read-model.ts`). Find the three, say what migrating each costs and whether it changes any behaviour (paging, caching, key reads, close checks), and which remaining slices add card sources (spec and section). Should it be done before one of them, and which?
2. The read models (track, timeline, activity, decision, note views and the query services) share paging, cursors and capacity limits. Is that shared today or copied? What new views or queries do slices 6, 7 and 8 add, and would they copy it again?
3. `sessions/` and `communication/`: slice 6A adds request rounds and building lines through one shared entry, 6B a handoff primitive with a common operation identity, 7 the secretary. Does the current structure have the places these need, or would each slice spread over several unrelated files? Name the files each would have to touch today.
4. `notes/` and `architecture/`: after 4C and the note-speed rounds, is anything structurally left that the remaining slices will build on (memory branches of queries in 6A / 7D2, notifications without a goal in 7D2)?

## For each finding

| # | 问题（file:line，一两句） | 现在的代价（读、改、复用各难在哪；具体例子） | 剩下哪一片会碰到（spec 和章节；不碰写“无”） | 改法（一两句；只说结构） | 会不会动行为（不会 / 会：哪里） | 估计改多少行（新增＋删除） | 归类（1 片前做 / 2 合拢后做 / 3 只记下） | 把握（高 / 中 / 低） |

Class rules (decision 84-2): **1** if a remaining slice will add code at that place and the change makes that slice's work smaller or clearer — name the slice and say whether it should be done before that slice; **2** if no remaining slice touches it; **3** if the gain is small compared to the cost. A change that would alter behaviour is never class 1 or 2 as stated: say what it would alter.

End with: the number of findings per class, the total estimated lines per class, the behaviour bugs seen (if any), and the files you read in your area (one line each: path, "read" or "skimmed").
