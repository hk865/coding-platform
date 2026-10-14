## 1. Unclear

1. **Spec L11 (book §4 L-tdd)** — “一次稳定尝试里，每个来源的集合只拼一次…不跨尝试、不跨调用缓存.” The card/notice sources are injected ports whose `readPage` is invoked once per page by `decision-read-model.ts:410–430` and `:495–513`. How the assembled collection survives those per-page calls within one attempt without being cached across calls is not stated (built-in `builtInMemberNoticeSource` at `:998–1034` rebuilds per page; injected sources like `planning-question-reader` are shared objects). I would assume the model assembles each source once per window attempt and pages it in memory.
2. **Book §4 L-fixtures** — “Exception 1 (QA-11): one valid historical record without `since`.” Spec QA-11 builds **three** legacy requeues. I would assume three.
3. **Spec §0.4 row 5 / QA-10(二)** — “未送达回复的来源改成按 Session 索引列 Session.” No index, order, or pagination is named; “按目录顺序” disappears once `findSessions` is dropped. I would assume `session-by-workspace` (`session-record-codecs.ts:948`), refKey order.
4. **Book §4 L-fixtures, QA-16** — “commits exactly once in the middle of a named read.” Neither the read nor “middle” is defined. I would assume the Nth `readMany`/`lookup` call inside one window attempt.
5. **Book §1** — base “commit `a9de6822`”, but that object does not exist here (`git cat-file` fails); `slice-setup` = `070f24e`. I would use `slice-setup`.
6. **Spec L10** — “`lookupAll` … 不再给 `truncated`”, yet `LookupBatch.truncated` is read by `decision-read-model.ts:297,341,1088,1144` and tests. I would keep the field, always `false`.

## 2. Contradictions

1. **Book §8 vs `DSH-BASELINE.md:160,167`.** F07 (`WP2-context-extensions.test.ts`) is listed in §A as a sandbox-kind failure that fails “before and after 2A”, and in §B as a frozen 2A flip that must pass. If §A holds, the targeted run in §8 cannot be all-green.
2. **Book §6 Q/N + §4 L-scope vs `tests/work-graph/S5-notices.test.ts:78–90,205`.** L4 requires `automatic-rework-notices.ts` to discover requeues/rounds via `lookupOrdered`, but `DecisionReadRecordsPort` (`goal-conflicts.ts:41` = `Pick<S5RecordPort,'readMany'|'lookup'>`) has no such method. Adding it makes `corruptOrigin` (returns only `readMany`/`lookup`) fail `typecheck`; calling it at runtime makes NR05 throw. That file is unchangeable (book §3) and must pass (book §6 Q). No fallback is specified.
3. **Spec §0.4 row 5 vs `undelivered-reply-notices.ts:33–37` / `tests/helpers/WP2-notices-fixture.ts:43–44` / frozen M07.** These require and construct `sessions.findSessions`, which §0.4 row 5 says the source must stop using (and must not read links). The `sessions` field must remain declared but unused; that is never stated.
4. **Book §7** starts a review subagent “per group O, Q, N” only; spec §7/book §6 define five groups (H, I unreviewed).
5. **Spec §0.4 row 1** marks the whole context-extension waiting-card row 去, including “每页 100”; book L-caps and L10 keep the page size (`DECISION_PAGE_LIMIT`). I would keep the page size.

## 3. Cannot build as written

1. **NR05** (`tests/work-graph/S5-notices.test.ts:205`) — as in §2.2: the unchanged test injects a `DecisionReadRecordsPort` double and asserts `unavailable` for a corrupted fresh requeue, while L4 changes requeue discovery to `lookupOrdered`. Either typecheck breaks or the read succeeds where the test demands rejection.
2. **QA-10(二)** — it requires a 5,001st **unavailable** Session plus an **available** Session with 2,001 responsibility links, all built through public services (L-fixtures). The path that creates 2,001 links through public services is not shown, and the same 300 s test must also build 5,001 Sessions and 5,001 replies; `MAX_LINKS_PER_SESSION` (`session-directory.ts:1199`) still refuses at the boundary the fixture is meant to cross.
3. **QA-14** — book §6 group H says “production: none expected,” but “把存储设成读失败” through the real route has no named composition seam. I would wrap the `decisions` object handed to `createPlatformCoreRouteBindings`, not the platform.
4. **Book L-caps location check** — the claimed bounds do exist where stated (`context-extensions.ts:36,45–46,305–307`; `undelivered-reply-notices.ts:38–41,184–195,383`; `decision-read-model.ts:105–107,109,298,342,1089,1145`; `goal-conflicts.ts:139–178`; `plan-readers.ts:97,481–510`; `planning-question-reader.ts:57–58,101–120`), but spec §0.4’s `plan-readers.ts:1431–1434` is the caller, not the cap; the cap is `:509`. §0.4 rows for `s2a-round-reverify` do not state whether `chain.reverify.actorClass` requires the record’s `chain` to exist (legacy rounds have `chain: null`) — no candidate row would match, which is correct, but it is not written.

## 4. Missing

1. Which in-scope type gains `lookupOrdered`: `model/decision-contracts.ts` (`S5RecordPort`) is **not** in L-scope, yet it is the source of `DecisionReadRecordsPort`. No rule says how `decision-read-model.ts`/`automatic-rework-notices.ts` reach the new port.
2. Export/location rule for the five new index-name constants (only the literal names are given).
3. `readThrough` semantics for `lookupOrdered` (§2 returns it; nothing says read watermark vs last page).
4. Whether the legacy indexes (`s2a-requeue-legacy`, `s2a-round-reverify-legacy`) may carry `orderBy` (they must not).
5. A test timeout for the new S2A tests; L-fixtures offers 300 s, but QA-10(二) plausibly exceeds it, and the book’s §8 expectations depend on it.
6. The L5 audit list (“any other write the L5 audit finds”) — no starting list of re-encoding writes is given; the builder must search blind.

## 5. Size (book §6 groups)

- **O — large.** New port, registration validation with `valueType`, two backends with UTF-8/integer ordering, candidate/bound/after/`next` rules, four rows (QA-01/02/03/15).
- **Q — large.** Eight rows across five files; removal of the goal/message/candidate bounds, L11 per-attempt assembly, and many 5,001-item fixtures on both backends.
- **N — large.** Five rows; Session listing rewrite, `since` fix plus audit, two ordered indexes and whole-chain correlation, and the heavy 5,001-Session QA-10 fixture.
- **H — small.** One row (QA-14) reusing QA-05’s dataset through the existing route.
- **I — medium.** Integration: three frozen files plus every `S2A-` file, then full suite vs `DSH-BASELINE.md`.

`git status --short` prints nothing.