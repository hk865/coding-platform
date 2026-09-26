# Frozen Kernel R4a acceptance migration

These tests exercise only `next/vendor/coding-agent/dist/public-api.js`, temporary SQLite databases and local scripted models. They do not implement or claim platform Session support. No network provider is invoked; API-key strings and protected-file contents are synthetic fixtures.

All 17 test cases from the independently accepted R4a recovery review are retained. Two existing public integration cases add API version and completed-history coverage. Original files remain unchanged.

| Destination group | Original file under `vendor/coding-agent/tests/` | Migrated cases |
| --- | --- | --- |
| `frozen public: independent-r4a-session-recovery.test.ts` | `review/independent-r4a-session-recovery.test.ts` | All 6: old/latest identity replay; budget increase refusal; denied-path inheritance; unchanged paused recovery; older history boundary cannot bypass later paused Turn |
| `frozen public: R4a-recovery-contract.test.ts` | `review/R4a-recovery-contract.test.ts` | All 4: middle identity replay; budget refusal after restart; omitted sandbox restrictions; legacy schemaVersion=1 Turn and unchanged checksum |
| `frozen public: R4a-resume-environment.test.ts` | `review/R4a-resume-environment.test.ts` | All 7: changed model/root refusal; strict ordinary-file change; SQLite files excluded precisely; neighboring ordinary files still checked; unsupported checkpoint constraint version falls back to events; legacy checkpoint remains usable |
| `frozen public: version and completed history` | `integration/kernel-session-api.test.ts` | First 2: public API version=2/current_turn default; completed history with paired tool exchange enters the next model request exactly once |

Entry adaptations: every production import uses the frozen public entry; skill resources come from the target-owned frozen resource directory. The second integration case obtains its boundary from the final durable `run.completed` event returned by public `SqliteStores.read`, with an explicit completed-event assertion, instead of importing private `findLastCompletedTurnBoundary`. Its model-message, tool-pairing, current-input and skill assertions are preserved.

`R4a-legacy-fixtures.ts` carries the prior temporary-directory helper and only the completed old Turn branch needed from `helpers/session-record-fixtures.ts`. Its canonical JSON + SHA-256 writer is a test-local copy of the historical wire algorithm, deliberately independent of runtime private helpers. Types are inferred from public `SessionRecord`; raw inserts/checkpoint rewrites affect only temporary databases. No new production export was introduced.

Other private-history algorithm unit tests and old platform Host integration tests are outside this frozen-public subset; their former PASS is not claimed for next.
