Read-only refresh of the C1 cleanup list for the lead. Do not modify any file; you may run read-only commands (rg, reading files). No tests, builds, network or model calls. Answer in plain Chinese with file:line for every code fact.

This copy is the lead branch at `c7f7cb0` (exported, no .git). On 2026-10-16 an audit of `src/core/work-graph` (except the notes files) was made on `1e0b1383`; the lead's list is `./.lead-ref/2026-10-16-cleanup-list.md`, the six audit reports `./.lead-ref/{XX,TA,VW,SE,PE,ST}.clean.md`, the verification `./.lead-ref/verify.json`, the audit brief `./.lead-ref/common.md`, the decisions `./.lead-ref/decisions-35-70.md` (35: long comments that map state-machine rules stay; 70: the two cleanup rounds). Since then 4C-2, 8A, 8D and L8 merged, so line numbers moved and new code was added. K3 (not merged yet) will change the files in `./.lead-ref/k3-all-files.txt`.

**C1 is round 1 only: mechanical merging and comment removal, behaviour unchanged.** Error codes, error texts, check order, stored bytes, returned shapes and record formats stay exactly. Not C1: reducing repeated reads (C2), generated codecs, the RecordStore backend question, anything in the "不做的" list, test changes.

For every C1 item of the list (the shared small tools XX-1, XX-2/SE-1, XX-5, XX-6, XX-7/TA-7 and the refusal-result helpers; the copies within one area TA-1 and the SE addition, VW-1/XX-8, SE-2, SE-3, SE-5, PE-2/PE-3, TA-4/VW-4, TA-5, TA-10, ST-1 and its two additions, TA-8, ST-2–ST-9, VW-3, VW-5–VW-9, VW-11, SE-7, SE-9, SE-11–SE-13, PE-4, PE-8, PE-9, `graph-repository.ts`; the comments TA-2, VW-2, SE-4, PE-1, ST-5) and for the small fix `tasks/goal-decision-reader.ts` `atLeastCursor`:

1. Where it is now (file:line ranges on `c7f7cb0`); still present / changed / gone.
2. The one place to keep or create as the shared version (an existing file:line to reuse wherever one exists; never inside `src/core/record-store`), and the call sites to switch.
3. What must stay byte-for-byte (codes, texts, order) at each call site, where the copies differ today (a merge that would change one of them is not C1: say so and drop it).
4. Estimated lines removed.
5. Whether it touches a K3 file (then: "K3 合入后再核").

Then:
6. **New copies of the same C1 kinds added since `1e0b1383`** (4C-2, 8A, 8D, L8 code in `src/core/work-graph`, and the notes files now that 4C merged: `notes/`, `views/note-views.ts`, `model/note-contracts.ts`, `persistence/note-record-codecs.ts`, `state/note-machine.ts`). Same five fields. Only mechanical C1 kinds; other findings one line each under "不属于 C1".
7. **Grouping for the coding agent**: split the work into 3–6 groups that touch disjoint files, each with its items, files, estimated lines and the order inside the group (shared helper first, then call sites). Put the K3-touched items in their own group so it can wait for the K3 merge.
8. The comment part: per area, the estimated removable lines and three examples, following decision 35.

End with: total items, estimated lines (C1 only), how many wait for K3.
