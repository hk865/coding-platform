# Driver final bounded review — 2026-09-28

Reviewed MAIN working tree after import; no production changes in this review.

- `runWithPump` normal completion/yield sets a drain flag, awaits the in-flight consultation and one final saved-outbox pass. Only explicit stop/close abort the shared controller; the original pump promise is awaited. No orphan background promise or additional scheduler was introduced.
- A yielded continuation now remains `waiting_for_reply` while `wakeWaiting` is true. The UI/poller no longer mistakes that live wait for a settled `waiting` receipt. Saved reply still cannot override the existing pause/cancel fence.
- Bounded review found no additional blocker in these two changes. This does not establish all orchestration behaviors or model semantic correctness.

## Verification

Node 24: `vitest run tests/app/AG2b-collaboration.test.ts --configLoader runner` — **3 passed**, duration 8.77s, start 2026-09-28 19:01:57 local. Existing normal two-round case now delays each consultation provider response 150ms and checks the signal was not aborted. Existing stop and reopen checks remain.

Subsequent `node --run typecheck` and `node --run build` both exited 0. No broader tests were run for this review.

## Live error classification

Source: `live/live.json`, second run, 17 model streams. The exported toolErrors array repeats errors carried forward in later transcripts; there are three unique failing call IDs.

- `call_00_XBfM9eDbjnTKSG4U4ikG3007`: `query_task_graph` supplied `planRef.projectId=ag2b-work`, while the actual project is `ag2b-collab-project` (`ag2b-work` is the task/module identity). The tool exposes optional `planRef`; omitting it reads the bound Goal. The foreign-project rejection is a model argument/identity error, not missing schema support.
- `call_00_Q0JvAgKaT8MYaEWEFjr47273`: `edit(mode=replace)` omitted required `expectedRevision`. The builtin schema explicitly requires the 64-character revision from the latest read. This is a model argument error; no production schema relaxation is justified.
- `call_01_tMDW1HLjXpYmKoYEUQFZ5415`: `search(prefix=contract.md)` returned ENOTDIR. Separate source-tool investigation owns this error; this review does not classify it as model-only.

## Reviewed file hashes

- `src/app/collaboration-driver.ts`: `233bfe7910633388ec6260448350a4fccfef5a985c3fe89a7e69b71bbd35cefb`
- `tests/app/AG2b-collaboration.test.ts`: `80cfcd183303ea2ed56d7097f5f2dcfc3b0401a39f717cc8f33c1448bd8efe28`
