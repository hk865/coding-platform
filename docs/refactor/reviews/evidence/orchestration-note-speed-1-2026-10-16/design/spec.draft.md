Decision 66: spec sentences it makes outdated in slice-4-SPEC.md, MEMORY-LOOKUP.md and DESIGN.md, with proposed post-notes, at HEAD ad2679f3 (code as merged in 0776b9b6). Nothing was modified and no tests were run.

All doc paths are under `D:/1.project/Software/agent-next-main/.claude/worktrees/claude-code-task-execution-f3cca6/docs/refactor/design/orchestration-2026-10/`. Code paths are under that worktree root (`src/`, `tests/`).

## 0. Points the lead must rule on before the replacement text can be final

Under the hard constraints, each of these is either a contract change or a choice that decides whether results stay identical.

**R-A. `'any'` and "one scan per query".**
- Today the port only does AND (P1, `src/core/record-store/lookup-ports.ts:102-114`).
- `'any'` opens one port stream per term and merges them (`src/core/work-graph/notes/note-read-model.ts:849-907`). With k terms that is k scans.
- Read strictly, "一次查询只扫一遍" needs an `'any'` mode in the port. That is a port contract change: `TextSearchRequest` gains `match?: 'all' | 'any'`, absent means `'all'`, so T-01–T-06 and T-08 stay as they are. It also amends P1's "照 §2 不加字段" (`slices/slice-4-SPEC.md:736`).
- The other option keeps P1, with one full pass per term instead of one per page. That contradicts the wording of decision 66 when there is more than one term.
- Read results are identical either way.

**R-B. `'all'` with an anchor or `pathPrefix`.**
- Today the port pages the whole project, and the anchor or path is a filter applied after the port (`note-read-model.ts:830-847`, `:844`, `:1490-1502`). Round-3 ruling 3(c) binds this cut: one port call per page.
- Option (i): keep 4B's cut. Scan the project's text in memory, stop after `limit` project-wide matches, and use the anchor/path head set only as a membership test. Every page stays identical.
- Option (ii): decision 66 literally. Candidates come only from the heads, and a page stops at `limit` filtered matches.
  - This is a contract change: pages are fuller, cursor positions differ and there are fewer pages. The full set and the order do not change.
  - Side effect: with an existing anchor that has no notes, `'all'` today can return empty pages with `complete: false` when project-wide matches exceed `limit` (`note-read-model.ts:1476-1485`, `:1490-1502`). Option (ii) returns `complete: true` at once, which is what L12 says (`slice-4-SPEC.md:186`).
  - No current test covers `'all'` with an anchor or path. The MF7a and R7 tests filter by `kind` (`tests/work-graph/S4B-memory-ranking.test.ts:154-203`).
- `'any'` gives the same result under both options. The set is the first `cap` filtered matches in noteId order (`note-read-model.ts:755-757`, `:902-903`), whichever source supplies them.

**R-C. What "candidate" means for the port's per-call cap of 1,000.**
- Today a candidate is a record whose text contains every two-code-point window of the terms. FTS5 produces these in `src/core/record-store/sqlite-text-search.ts:286-323`. The in-memory backend uses the same rule (`src/core/record-store/in-memory-record-store.ts:599-617`).
- (a) Recommended: keep that definition. In the scan it is a plain substring test of each 2-code-point string. That is equivalent, because terms contain no whitespace (`src/core/record-store/lookup-index.ts:632-642`, `:659-665`). Every page, `next` and `complete` stays identical.
- (b) Count verified matches instead. The T-05 cap cases still pass, but results differ on data with many false-positive windows.
- (c) Count scanned records. This breaks `tests/record-store/S4B-text-search.test.ts:703-752`: with 1,001 "other" records, `complete` becomes false and `next` is no longer null.

**R-D. Keeping the in-memory copy current.** Results only stay identical if two things hold:
- the in-memory copy changes only after a commit succeeds, so text from a rejected write is never found;
- the copy catches up with the table before scanning when another writer has advanced it. FTS reads the table directly today.

The R8 cursor already gives the check: `through` against the ledger maximum (`sqlite-text-search.ts:265-284`).

**R-E. Old files.** 4B database files already contain the FTS tables and `next_fts_meta`. Whether to drop them at open or ignore them is a construction-book item, not behaviour.

**R-F. Rule version.**
- The comparison rules do not change. So `readBasis.ruleVersion` and the rule version bound into cursors (`RULE_VERSION = 1`, `note-read-model.ts:444`, `:563`, `:577`) must not be bumped. Bumping it turns old cursors into `cursor_mismatch`.
- `TEXT_SEARCH_RULE_VERSION` (`sqlite-text-search.ts:35`) is only an internal part of the table code.

## 1. slices/slice-4-SPEC.md

**S0. `:3`, header post-note.**
- Current: "4A、4B 施工和验收中定下的读法在 §9、§10，对 4C 同样有效；和前面各节冲突时以它们为准。"
- Add one line after it: **后注（决定 66，lead 2026-10-16）：** SQLite 不再用 FTS5，全文改成在内存里按注记键的顺序扫。L10、§2、§4 第 11 条、§5、§7、§10 里说 FTS5 的句子按原文保留，后面各加了改法；改法和 §10 冲突时以改法为准。

**S1. `:164`, L10 "SQLite 候选".**
- Current: "**SQLite 候选**：FTS5 表（`tokenize = 'unicode61'`），给每条记录写进去重后的**比较文字里所有互相重叠、且不含空白的两个码点窗口**，每个窗口编成一个 ASCII token `b<hex1>_<hex2>`……再读出记录按上面的子串规则核对。两个后端结果相同。"
- Append: （决定 66，lead 2026-10-16）上一句作废。两个后端用同一套扫描：每条头记录有一份比较文字（规则同上），按 refKey 字节序逐条按子串规则核对；扫够一页就停，`next` 记下扫到的最后一条，下一页从它后面接着扫。结果和顺序同 4B。
- Code: the FTS table is built at `sqlite-text-search.ts:197-199` and queried at `:313-320`.

**S2. `:165`, in-memory backend.**
- Current: "**内存后端**：按前缀筛出候选，逐条按上面的子串规则核对（同一套规范化纯函数放在 `lookup-index.ts` 旁边）。"
- Append: （决定 66，lead 2026-10-16）两个后端不再各写一份：同一套扫描，内存后端扫它自己内存里的那一份比较文字。规范化和子串核对仍是 `lookup-index.ts` 的同一组纯函数。

**S3. `:166`, kept current with each commit.**
- Current: "**跟提交一起改**：SQLite 在写快照的同一个事务里改 FTS 表（写、改、删头记录时）；内存后端不用另存。"
- Append: （决定 66，lead 2026-10-16）SQLite 在写快照的同一个事务里把规范化以后的比较文字写进一张紧凑的表（写、改、删头记录时），不再写 FTS 表。进程把这张表读进内存，提交成功以后才改内存里的那一份。内存后端在提交时改它自己的那一份。
- Code: `src/core/record-store/sqlite-record-store.ts:487-495`. The "提交成功以后才改" clause is R-D.

**S4. `:167`, start-up.**
- Current: "**启动**：打开 SQLite 时检查 FTS5 可用（建一张临时表查一次中英文样本）；不可用就让全文端口报 `unsupported`（不退成全表扫描，MEMORY-LOOKUP §4.1）。FTS 表不存在或代号不对时，在打开时从头记录重建，重建完以前全文报 `unavailable`、原因 `index_not_ready`。"
- Append: （决定 66，lead 2026-10-16）不再检查 FTS5，也不再有“FTS5 不可用 → `unsupported`”。“不退成全表扫描”作废：现在就是在内存里扫。紧凑表照 §10 的做法带代号和维护到的账本游标：表不存在、代号或游标不对时，打开时在一个事务里从头记录重建；读的时候发现表落后于账本 → `unavailable`、原因 `index_not_ready`。内存里的那一份落后于表时，先补上再扫。
- Code: the probe is at `sqlite-text-search.ts:62-86`, `:138-152`; `index_not_ready` at `sqlite-record-store.ts:811-817`. The last sentence is R-D.

**S5. `:168`, bounds.**
- Current: "**上限**：一页最多 100 条；一次查找最多核对 1,000 个候选，没核完就返回已核到的、`complete: false` 和续读游标（不把部分当全部）。"
- Append: （决定 66，lead 2026-10-16）上限不变。“候选”照 4B 的意思：比较文字里含有词的全部两个码点窗口的记录（扫的时候按子串查这些窗口，不再查 FTS 表）；不含的记录不计数。这样每页在哪里停、`next`、`complete` 都和 4B 一样。
- This wording assumes option R-C (a).

**S6. `:414`, §2 error-code comment.**
- Current: "`unsupported`（只指 FTS5；语言不支持是成功结果里的警告 `symbol_unresolved`，不是错误）。"
- Append: （决定 66，lead 2026-10-16）SQLite 不用 FTS5 以后，没有“FTS5 不可用”这一种 `unsupported`；类型不改。全文端口对没登记、或不是全文的索引仍回 `unsupported`（同别的查找端口），`memoryFind` 原样传出。
- Code: `lookup-index.ts:702-705`; `note-read-model.ts:815`.

**S7. `:494-495`, §2 comment.**
- Current: "规范化纯函数 normalizeSearchText（…）和 bigramWindows（所有互相重叠、不含空白的两个码点窗口，编成 `b<hex1>_<hex2>`）导出给两个后端共用。"
- Append: （决定 66，lead 2026-10-16）`bigramWindows` 不再当 FTS5 的词用：它留给相近注记算 Jaccard（L22），并按 L10“上限”的后注判断哪些记录算候选。`normalizeSearchText` 照旧两个后端共用。
- Code: Jaccard uses it at `src/core/work-graph/views/note-views.ts:848`.
- If R-A takes the port `'any'` mode, add here: `TextSearchRequest` 加 `match?: 'all' | 'any'`，不给就是 `'all'`。

**S8. `:566`, §4 rule 11.**
- Current: "SQLite 候选必须是全部子串匹配的超集，读出后按子串规则核对；两个后端结果和排序相同"
- Append: （决定 66，lead 2026-10-16）“SQLite 候选必须是超集”一句作废：两个后端用同一套扫描，逐条按子串规则核对；其余照旧。

**S9. `:592`, NE2 "能抓到".**
- Current fragment: "窗口候选是全部匹配的超集、核对掉片段误中、…、重开和重建、FTS5 不可用报 `unsupported`、`'any'` 时候选是全部匹配的超集"
- Append: （决定 66，lead 2026-10-16）去掉“窗口候选是超集”“FTS5 不可用报 `unsupported`”“`'any'` 时候选是超集”三项；“重开和重建”指紧凑表；“核对掉片段误中”照旧。
- If R-A adds the port `'any'` mode, NE2 needs `'any'` cases. Not added here.

**S10. `:626`, T-01.**
- Current: "（两个窗口 `ab`、`bc` 都命中、子串不命中，被核对掉）"
- Append: （决定 66，lead 2026-10-16）括号改成：`ab`、`bc` 两个窗口都在、`abc` 不是子串，查不到。
- The expected result does not change.

**S11. `:631`, T-06.**
- Current: "（不改存储内部表；要造“FTS 表不存在或代号不对”的条件就用允许的存储迁移夹具）→ 重建以后结果相同；模拟 FTS5 不可用 → `unsupported`（保留既定替身）。"
- Append: （决定 66，lead 2026-10-16）“FTS 表”改成紧凑表；“模拟 FTS5 不可用 → `unsupported`”一例删掉（这种情况不会再有），`fullTextProbe` 也删掉。其余各例的期望不变。

**S12. `:688`, §6 4B files.**
- Current: "`lookup-index.ts`（`normalizeSearchText`、`bigramWindows`、全文登记）、…、`migrations.ts`（FTS 表）"
- Append: （决定 66，lead 2026-10-16）这一行是 4B 的范围（FTS 表照 P5 实际在 `sqlite-text-search.ts`，`migrations.ts` 没动）。提速第一轮去掉 FTS 表、加紧凑表，文件由 lead 在那一轮的说明书里列。

**S13. `:698`, §7 fixture exceptions.**
- Current: "例外只有：…、T-06 的 FTS5 不可用模拟、…"
- Append: （决定 66，lead 2026-10-16）“T-06 的 FTS5 不可用模拟”删掉。

**S14. `:736`, §10 "全文端口只做“与”（P1）", taken sentence by sentence.**
- (a) "`searchText` 的结果是每个词都是子串的记录，按 refKey 字节序；`TextSearchRequest`/`TextSearchPage` 照 §2 不加字段。"
  - Unchanged if R-A keeps P1.
  - Otherwise append: （决定 66，lead 2026-10-16）端口加 `match`（`'all' | 'any'`，不给就是 `'all'`），`'all'` 照这一句。
- (b) "`'any'`、分、`matchedTerms`、`ranking` 都在 `memoryFind` 里算：每个词各查一次端口再合并。"
  - Append: （决定 66，lead 2026-10-16）“每个词各查一次端口再合并”作废：一次查询只扫一遍，扫出至少含一个词的记录，按 refKey 序；分、`matchedTerms`、`ranking` 仍在 `memoryFind` 里算。带锚点或 `pathPrefix` 时不查端口，见 P7 的后注。
  - This wording assumes R-A takes the port `'any'` mode.
- (c) "`'all'` 的每一页只调一次端口（从游标里记的最后一个 refKey 往后），返回这一页里筛出来的，不足 `limit` 也行，端口没读完就 `complete: false` 带游标；" This sentence carries round-3 ruling 3(c).
  - Under R-B (ii), append: （决定 66，lead 2026-10-16）没有锚点和 `pathPrefix` 时照这一句。带锚点或 `pathPrefix` 时，`'all'` 在这些头里按 refKey 序收满 `limit` 条筛选后的匹配才停；翻完的集合和顺序同 4B，每页条数和游标位置不同。
  - Under R-B (i), append: 带锚点或 `pathPrefix` 时每页仍按全项目的扫描定在哪里停，这些头只用来筛。
- (d) "`'any'` 读到 `TEXT_SEARCH_CANDIDATE_MAX` 条已核对的匹配就停，部分集合是按 refKey 序的前 `cap` 条，两个后端一样。" This is "the cap counted after the scope filter" (`note-read-model.ts:902-903`).
  - Append: （决定 66，lead 2026-10-16）上限数的仍是筛选以后的匹配（同 4B）。带锚点或 `pathPrefix` 时候选直接来自这些头，不再为了凑满上限扫全项目；结果、`partial` 和顺序不变。
  - This also answers the open "4C 前定" item in `docs/refactor/reviews/evidence/orchestration-slice-4B-2026-10-16/lead-acceptance.md:39` and `docs/refactor/STATUS.md:183`: the cap's meaning does not change.
- (e) "`terms: []` 是 `invalid`。" (round-3 3(b)) and "`'all'` 的结果没有 `ranking` 字段" (3(a)) are unchanged.

**S15. `:737`, §10 FTS table (P5, R8).**
- Current: "建表、代号、重建放在 `record-store/sqlite-text-search.ts`，`migrations.ts` 不动。代号存在 `next_fts_meta` 表里……FTS5 不可用 → `unsupported`；SQLite 后端多一个可选的 `fullTextProbe`，只有 T-06 和 `memoryFind` 的 `unsupported` 一行用它。"
- Append: （决定 66，lead 2026-10-16）FTS 表、`next_fts_meta`、FTS5 探测和 `fullTextProbe` 都去掉。紧凑表照这一条的做法：代号（登记的摘要和规则版本）和维护到的账本游标跟写入在同一个事务里更新；打开时不对就在一个事务里从头记录重建；读的时候落后 → `unavailable`、`index_not_ready`。“FTS5 不可用 → `unsupported`”这一种没有了。
- Code: `sqlite-record-store.ts:46-51`, `:156-159`, `:181`; `sqlite-text-search.ts:154-246`.

**S16. `:738`, §10 P7 candidate sources.**
- Current: "**候选从哪来（P7）：** 有锚点读五个锚点索引；有 `pathPrefix` 读 `NoteHead` 上新加的五个有序索引……给了几个条件就都要满足。"
- Append: （决定 66，lead 2026-10-16）带词时也这样取候选：有锚点或 `pathPrefix` 时，候选就是这些头，在它们的比较文字上按 L10 核对，不再先扫全项目再筛；只有带词、又没有锚点和 `pathPrefix` 时才扫全项目。
- The anchor heads are already loaded and unused at `note-read-model.ts:1476-1480`.

**S17. `:752`, §10 test exceptions.**
- Current: "T-06 和 `memoryFind` 的 `unsupported` 用 `fullTextProbe`"
- Append: （决定 66，lead 2026-10-16）这一句作废：`fullTextProbe` 去掉，T-06 的 FTS5 一例和 `memoryFind` 的 `unsupported` 一行跟着删。

**Checked in slice-4-SPEC.md, no change needed:**
- `:23`, `:25`, `:280`: the port and two backends stay.
- `:38`: current text only.
- `:158`: the port and its registration stay. Decision 66 keeps "the same port".
- `:159-163`: comparison text, terms, `match`, score, ranking.
- `:183-186`: L12 cursors and anchors.
- `:561`: §4 rule 6.
- `:620`: N-19.
- `:705`.
- `:739-751`: R9, R1, R3, R4, R5, R10, R11, R12, R13, R14/P8, P3, R16.

## 2. MEMORY-LOOKUP.md

- `:178` already has a decision-66 post-note at `:180`, which ends "上一句按原文保留。" Lines `:183-187` are left uncovered.
  - Replace that last clause with: 上一句、下面 lead 的 FTS5 实测（第 183 行）和两段【提议】（第 185、187 行：2 字片段编成 ASCII token 写进 FTS5、部署时探测 FTS5、失败报 unsupported、不退成全库扫描）按原文保留，其中 FTS5 的部分由本条替换；第 187 行的“不引向量库或独立搜索进程”“端口不暴露查询表达式”“返回前仍读正式状态”照旧。第 189 行（可重建投影、和记录同事务更新、重建没完报 index_not_ready）对紧凑表照旧成立。（决定 66，lead 2026-10-16）
  - This file tags post-notes "【决定 66 修改，2026-10-16】"; the lead may prefer that form.
- `:183`: "lead 2026-10-10 … 所以中文要先切成 2 字片段再建索引。" Historical measurement, covered by the note above.
- `:185`: "连续中文生成 2 字片段后编码为 ASCII token，写入 FTS5；查询同样切分、AND 匹配…" Outdated, covered by the note above.
- `:187`: "部署时用 node:sqlite 建临时 FTS5 表…失败明确 unsupported，不静默把 SQLite 退成全库扫描。" Outdated, and reversed by decision 66. Covered by the note above.
- No change needed: `:35`, `:64`, `:176`, `:189`, `:234`, `:253`, `:297`, and `:320` (a historical drafting boundary).

## 3. DESIGN.md (§3.7, §8.2, appendix C)

**D1. `:729` (§3.7).**
- Current: "全文扩展 RecordStore 窄端口，两后端都做：内存子串扫描，SQLite FTS5，中文预切成 2 字片段；两后端遵守同一文本候选语义和固定顺序，FTS5 的中文片段命中再核对规范化原文子串，WorkGraph 复核权限及正式状态；"
- Replace that clause with: 全文扩展 RecordStore 窄端口，两后端用同一套扫描：写入时在同一个事务里存规范化以后的比较文字，进程读进内存，按注记键的顺序逐条核对子串，扫够一页就停，从书签接着扫；带锚点或路径前缀时只在那些注记里找；WorkGraph 复核权限及正式状态；（决定 66，lead 2026-10-16）
- The rest of the line stays.

**D2. `:1269` (§8.2, row 4).**
- Current: "全文窄端口及内存扫描、SQLite FTS5（中文 2 字片段）"
- Replace with: 全文窄端口（两个后端同一套内存扫描）（决定 66，lead 2026-10-16）

**D3. `:1642` (appendix C, index 15).**
- Current: "扩展 RecordStore 窄端口及两个后端，内存子串扫描，SQLite FTS5，中文预切成 2 字片段；"
- Replace with: 扩展 RecordStore 窄端口及两个后端，两个后端同一套扫描：写入时同一事务存规范化的比较文字，进程读进内存按注记键的顺序扫（决定 66，lead 2026-10-16）；
- The rest of the line stays.

**Checked in DESIGN.md, no change needed:**
- `:618`, `:655`: the bigram Jaccard for similar notes is not FTS.
- `:1422`.
- `:1426`: "冷首查不含建索引" now means building the compact table.
- `:1627`: still 15 indexes, since decision 66 keeps "只加一个全文索引".

## 4. Test rows

| Row | Wording depends on FTS? | Expected result changes? |
|---|---|---|
| T-01 (`spec:626`) | yes (windows) | no. Under R-C (b) the wording "被核对掉" still holds. Test name at `tests/record-store/S4B-text-search.test.ts:75-87` says "window candidates". |
| T-02, T-03 | no | no |
| T-04 (`:629`) | no ("全文只给候选" is generic) | no, provided the compact table changes in the same transaction (S3, R-D) |
| T-05 (`:630`) | not in the spec row; the code cap cases (`S4B-text-search.test.ts:697-800`) depend on R-C | no under (a) or (b); (c) breaks `:703-752` |
| T-06 (`:631`) | yes | The FTS5-unavailable case is removed (`:538-546`), and so is the trigger of "write while FTS5 was unavailable" (`:489-504`). The same rebuild path is covered by `:469-487`. The others are unchanged, including `index_not_ready` at `:506-519`. |
| T-07, T-08, T-09 | no | no. T-08 holds at the port as long as the default stays `'all'`. |
| N-19 | no | no |
| M-01 to M-16 | none depend on FTS. M-13 uses `bigramWindows` (Jaccard), which stays. | no. M-12 is still deferred to 4C. |

Tests outside the T/M rows:
- **Removed:** MF7b (`tests/work-graph/S4B-memory-unsupported.test.ts:19-36`) and its fixture option `fullTextUnavailable` (`tests/helpers/S4B-note-check-fixture.ts:105`).
- **Fixture options to delete:** `fullTextProbe` in `tests/helpers/S4B-text-search-support.ts:124`, `:148`.
- **Unchanged under either R-B option:** MF7a and R7 (`S4B-memory-ranking.test.ts:65-203`, which filter by `kind`) and MF9 (`tests/work-graph/S4B-memory-anchor-not-found.test.ts:104-127`, which is `'any'` with an anchor).

## 5. Outside the three files (for the speed-round merge)

These still describe FTS5: `docs/refactor/STATUS.md:11` ("FTS5 表和它的代号，打开时重建") and `:183` ("4C 前定"), `docs/refactor/IMPLEMENTED-CAPABILITIES.md:236` ("FTS5 表和代号…`unsupported`"), and the 4B `lead-acceptance.md:39`. They are history and progress records; update them when the speed round merges.