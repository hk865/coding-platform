# Quick check of the third draft: prompts and context for slices 6 and 7 (decision 83)

**Read only:** do not modify, create or delete any file; no tests, no builds, no git, no network. Answer in plain
Chinese, with `file:line` for every fact.

This is the last check allowed before freezing. The draft is `./.lead-ref/slice-6-7-PROMPTS-SPEC.md` (third draft);
your two full reviews are `./.lead-ref/review1.out.md` and `./.lead-ref/review2.out.md`; the change from the second
draft is `./.lead-ref/spec.v2-v3.diff`. The user decided five things on 10-21 (§0.1): the secretary keeps its full
Session history; handoff gets a per-duty brief plus memory pointers and a per-duty "write your understanding"
template; the user can pick a pack per model in settings and edit templates (packs in the Host data directory);
the section order is done this round (reminders last, order per pack, retention order unchanged); no
secretary-initiated transfer. Do not argue with these decisions; check that the draft implements them correctly.

Check only:
1. Did §7's handling of your second-review items (partial ones and N-01..N-09) land correctly in P1-P11, §2, §3?
2. New errors introduced by the third draft, against this tree's code: especially P1 (pack storage, editing routes,
   resolution per preparation), P2 (the two settings fields and the refusal codes), P6 (history slot only for rounds
   on other Sessions), P10 (guard and entry by frozen order and byte ranges; retention order kept; the binding's
   new `sectionOrder`), and anything in §3 that cannot be tested through its named entry.
3. Anything a literal implementer (DSH) will get wrong.

Report only what you can prove. A table `编号 | 类别（会出错/冲突/事实错/不清楚） | 位置 | 问题 | 依据（file:line） | 改法`,
rows Q-01, Q-02, …; end with one line `会出错 N，冲突 N，事实错 N，不清楚 N`.
