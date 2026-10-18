**Applied (17 must-fix + 7 suggestions).** Files: spec §13, evidence README, `lead-acceptance.md`, STATUS, WG59, slices/README, AGENTS.

- **1:** split `requestAutoCapture` (unreachable; fresh controller never aborted) from `failAutoCapture` (reachable; running-round signal, P06 at `observation-state.test.ts:849`); remaining rows on T; recorded the lead’s correction once in spec §13 and once in acceptance.
- **2:** counts are reminder-dependency reads in the stated fixture (12 files/6 chunks; 13th file, 7+6 chunks), window ends when the reader returns, not at put.
- **3–5:** previous is the replaced observation (no `observedAt` ordering); added top-level `previousPersistedRef` and separated `architecture/capture`’s `requestSeq` rejection; fixed `，不确定` placement.
- **6–12:** no automatic fixture exemption; separated pure vs public reminder coverage; `occurredAt` is static-checked; corrected review history, ledger weakenings, old-test claim, P3’s actual check levels.
- **13–17:** full A gap and corrected evidence citations; accurate start-read exception; corrected UNSPECIFIED numbering; removed unsupported “5 subagents.”
- **Suggestions 1–7** and lead items 1–5 applied; “s8l8-r4 的数字【lead 填】” kept; T list only in spec §13.12 and acceptance §T.

**Correction not taken verbatim:** item 14 says observation-state `not_found`/`not_ready` always become `unavailable`. Driver code keeps a rejected code; only non-rejected/throw becomes `unavailable`. I wrote “按失败处理，rejected 保留原代码，非 rejected 和 throw 记 unavailable.”

**HANDOFF**
- **Done:** all draft edits; `git diff --check` clean.
- **Half done:** none.
- **Not started:** none.
- **Next must know:** typecheck could not run (`tsc: not found`; no `node_modules`). Commit and merge-suite places remain `【lead 填】`. Do not edit HANDOFF.