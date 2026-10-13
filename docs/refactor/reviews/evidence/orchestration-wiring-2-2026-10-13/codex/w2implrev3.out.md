**The test-evidence round is not fully closed.** No files changed; no tests run. The reported execution results are taken as supplied.

References: **C** = [composition/WP2-wiring.test.ts](/D:/cxt/w2-review3/tests/composition/WP2-wiring.test.ts); **U** = [WP2-undelivered-notices.test.ts](/D:/cxt/w2-review3/tests/work-graph/WP2-undelivered-notices.test.ts); **X** = [WP2-context-extensions.test.ts](/D:/cxt/w2-review3/tests/work-graph/WP2-context-extensions.test.ts); **D** = [WP2-message-duties.test.ts](/D:/cxt/w2-review3/tests/work-graph/WP2-message-duties.test.ts); **H** = [WP2-platform-support.ts](/D:/cxt/w2-review3/tests/helpers/WP2-platform-support.ts).

**Must-fix 1–6 disposition**

1. **E2 evidence — partially fixed.**  
   `F05 a changed autonomy level…` **C:346**, particularly **C:394**, now checks a newly prepared Run containing `every_step`. `F08 real Work preparation…` **C:569/635** now rejects installed settings/decisions read failures.  
   **Must fix before merge:** `F06 [budget] a real continuation…` **C:473** creates the required continuation, but **C:509–519** checks headings/prefixes and one absent hint. Truncated continuation content could pass. Assert the expected continuation content through its tail and the complete omitted-row outcome.

2. **Independent expectations — partially fixed.**  
   `M06` **U:351** and `M08 same-position items…` **U:392** now use creating-command identities and explicit page sequences.  
   **Must fix before merge:** `F06` **C:458** still builds expected reminder text from queue readback; `F07` **C:550/555/566** similarly derives expected keys/text from the returned card. Use captured creating-command results or observed commits. `F11 marking one displayed notice…` **C:648** now rejects wrong ordering, but **C:720–722** still calculates the order from IDs rather than supplying the lead-required predetermined sequence. Pin the example and write that sequence explicitly.

3. **F14 replay/content — partially fixed.**  
   Work **C:1049** and user-answer **C:1377** now reissue requests after SQLite reopening; user notices at R and Query notices at P are present.  
   **Must fix before merge:** Query `F14 … (Query Answer)` **C:1491** retries `consumeConsultation` at **C:1606/1618**. Existing responses return early in [consultation.ts:152](/D:/cxt/w2-review3/src/business/workflow/consultation.ts:152), bypassing `respondFromQueryAnswer`. This does not test writer receipt replay. Reissue the actual writer request and compare complete first/retry/reopened values and cursors. Also verify literal reply bodies through `readMessageBody` for all three writers; currently none does. Use complete equality for Work values rather than recursive subset matching at **C:1118/1146**.

4. **Other E3 writers — partially fixed.**  
   `F10 (Work reconcile)` **C:1232** and `F10 (Work recognition)` **C:1725** now exercise real writers on both backends with positive notices.  
   **Must fix before merge:** `F10 (Query recovery)` **C:1632** retires a fresh derived Session that authored no message. Empty notices are correct **for that history**, but do not satisfy the positive recovery-to-notice evidence. Memory does not even read notices after recovery; **C:1687** is before it. See the UNSPECIFIED assessment below.

5. **Observation brackets — Work fixed; Query unresolved.**  
   **H:186/870**, **C:38**, and the direct Work preparations observe commits and both model counters.  
   **Note:** Query preparation remains embedded in consultation at **C:614**, without an isolated bracket. Query preparation intentionally commits its binding ([query-preparation.ts:390](/D:/cxt/w2-review3/src/core/agent-runtime/query-preparation.ts:390)). Clarify that the zero-write assertion covers its read/assembly stage; do not impose zero commits around the complete Query operation.

6. **Capacity/retry boundaries — partially fixed.**  
   `M10 a window that stabilizes on attempt four…` **U:681** now distinguishes attempt four from attempt five. `M07 exactly 5000…` **U:536** genuinely checks all 5,000 identities/positions.  
   **Must fix before merge:** **U:578** reaches the per-Session 50-page limit, leaving the separate aggregate 5,000-item guard untested. Use two real unavailable Sessions, each below its page limit, totaling 5,000 then 5,001 replies. In `F07 exactly 5,000 real waiting cards…` **X:339**, also check the four seed-card identities and four hint identities; **X:355/359** currently checks only newly created cards plus total length.

**Should-fix disposition and new problems**

- **DTO source identity: fixed.** [undelivered-reply-notices.ts:352](/D:/cxt/w2-review3/src/core/work-graph/views/undelivered-reply-notices.ts:352) compares both Session identity fields against the directory source and retains the stable-window mismatch handling. `M09 a DTO that names another source Session…` **U:782** is a sound isolated fault case. The round-three/four patch comparison confirms this is the sole production delta. The report records the expected RED failure; chronology is not independently evidenced by the final tree. No regression is apparent statically.
- **Successful mocks: partially fixed.** The named runtime/F06/M02 replacements were removed, but `F07 follows a predetermined page boundary…` **X:311/320** still fabricates successful queue pages. **Must fix before merge:** replace with real pagination; the accepted assembled-input omission does not authorize this mock.
- **New weakened assertion:** `M02 … one complete guard set…` **D:250/264–268** now checks only the Session guard and uniqueness. Dropping every resolver guard would pass. **Must fix before merge:** restore an independently specified complete guard set and cover—or explicitly disposition—the identical-guard merge case.
- **W231: fixed.** [WP2-notice-cursors.test.ts:61](/D:/cxt/w2-review3/tests/record-store/WP2-notice-cursors.test.ts:61) and :78 retain public boundary checks without private binder assertions or store readback.
- **Malformed empty-source envelope: fixed**, `M08` **U:440/452**. **F07 comment narrowing: fixed**, **C:529**.

**Four UNSPECIFIED items**

- **Query recovery:** unacceptable as closure. Public standalone semantic Queries can claim ordinary idle Sessions; consultation is optional ([query-execution.ts:910](/D:/cxt/w2-review3/src/core/work-graph/queries/query-execution.ts:910)). Save a Work-origin reply, finish that Work, run/recover a Query on the same Session, then assert the notice at observed R on both backends. The claimed need for production changes is not established.
- **Prefix:** **should fix the spec wording.** DTO-versus-directory disagreement should say `undelivered_reply_source_mismatch:` and take precedence; retain `identity_conflict:` for conflicting duplicate projections that pass individual validation.
- **M07 bound:** valid page-limit evidence, insufficient aggregate-limit evidence; fix described above.
- **Deleted runtime file:** deletion is acceptable, but replacement coverage is partial. No row disappeared entirely; nevertheless **C:618** only excludes one hint, losing explicit Query mode/extensions checks. Restore those through the real E2 path, alongside the budget correction.

**Verdict: merge after listed fixes.**