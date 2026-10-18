All rows A–K are complete; **BLOCKED: none**. Environment-only limits are called out below.

**A — production cancellation (`B-1`/`B-2`/`B-3`, `C-1`, `P05`–`P09`).** RED→GREEN on memory+SQLite: an injected lookup/read/commit throw with the signal set rejected the promise (now `cancelled`); a non-committed commit mapped failure or retried (now `cancelled`, request reads 1 not 2); a `committed,replayed` late restore was overwritten as cancelled (now keeps the restored committed result; restore failure kept, throw kept); a body-put business failure mapped `unavailable` (now `cancelled`, nothing published). `C-1` explicit-cancelled upstream facts returned ready (now `cancelled`). `captureSourceChanges` checks the signal after all 15 awaits before its commit; request/fail/read/state already did. `capture-start` 52/52; `reminders-public` 34/34.

**B — `K4-03`–`K4-09`, `Obs:606`, `:847`.** Deleted all nine hand `driver.projectChanged` calls; the fixture fires the sink only after a real `committed && !replayed` adoption/revision, and every driver is wired to it. RED: L8-4 memory+sqlite timed out at requestSeq 1; GREEN: 40/40.

**C — `K4-17`–`K4-23`.** Counts read calls, not keys: 5 record + 7 body = 12; 6 record + 15 body = 21. Restored the seven facts checks through public `readReminderFacts` outside the window: ready/previous null/12 nodes, then ready/previous non-null/13 and 12 nodes. No RED was obtainable (restoration; the corrected call counter gave 12/21 first run).

**D — `T18`/`T19`.** New memory+SQLite scenario: first Host registers B, B really enters `captureObservation` (gate entry), close; second Host binds only A, waits A’s completed startup retry; public read shows B seq1/requested/pending/current null and entry count unchanged. Memory A4 wrapper shares one real backend whose physical close runs last; Host logical close still runs. RED (A4 off): B state null; GREEN: host-close-restart 4/4. Existing SQLite K5 row kept.

**E — `K4-24`/`T15`/`T28`.** H4 now uses the passed Host context, `platform.materials.openArtifact(ctx,{ref,usage:'historical_explanation'})`; no Run identity. Host branch accepted (no refusal); green.

**F — `K5-01`/`K5-02`, `T20`, `T22`.** Timed entry/abort polls replaced by the gate’s `entered` Promise and a pre-close `abort` listener (with `signal.aborted` first). T20 uses a real adoption completion barrier; T22 counts the one trigger sink (control +1, replay unchanged) before the read. No behavioural RED.

**G — `T24`.** A3 wrapper counts the whole real `captureObservation` enter-to-return; `maxActive=1` asserted only after B has entered. 7/7.

**H — V§3 1/2/3.** Deleted the internal-command replay rows (request/fail/automatic capture); kept the manual `architecture/capture` replay at old `Obs:1034–1057`. Listed in D1 below.

**I — V§3 8/9.** `http-watermark` refusal and `chunk-scope` cross-project ref now live in `describe('rejects: …')`, one error per row with a public read showing nothing changed; the success rows stay separate/kept.

**J — `Pub:504`/`505`.** Restored the reminder reader answering `cancelled` with the signal NOT set: `rejected`/`cancelled`, no input, 0 prepared-material puts. Green at once (existing `context-assembler.ts:1056`), as the book says.

**K — host-restart `:55`, `:116`.** Timed non-event loops replaced by the awaited Host close (drains tracked startup work) plus one public read; 2/2.

**Read calls.** Records 5 then 6; bodies 7 then 15; totals 12 and 21.

**Production lines this round: +199 / −41** — `architecture-service.ts` +76/−4; `context-assembler.ts` +79/−21; `continuation-brief-assembly.ts` +16/−1; `session-anomaly-facts.ts` +22/−11; `execution-preparation.ts` +6/−4.

**D1.** Round (`s8l8-r2..WORKTREE`): **21** lines — **H 11**: `Obs:417,:443,:445,:449,:450,:617` (automatic replay); `Obs:881/test P05,:889,:909,:944/test P06,:983` (internal request/fail replay). **G 2**: `gate:243,:254`. **K 5**: `host-restart:58,:60,:61,:114,:115`. **F 1**: `auto-capture-host:51` (T20 barrier). **I 2**: `chunk-scope:498`; `http-watermark:26/test` (split into rejects/commit rows). Cumulative (`slice-base`): **15** removed assertions, all rework-2 row A/`K1-01`/`K1-06` scope re-spellings; 0 deleted files. **D3: 0 hits.**

**Checks (one command at a time, `--maxWorkers=2`).** capture-start 52, observation-state 40, read-counts 2, reminders-public 34, chunk-scope 10, gate 7, host-close-restart 4, host-restart 2, auto-capture-host 11, http-watermark 4, adoption-capture 2, S1-archive 6, S3-context-assembler 15, C3-brief 3 = **192 passed**. pass-capture 6/6 fail only: `AssertionError: ENOENT: no such file or directory, access '/usr/bin/bwrap': expected 'rejected' to be 'ready'` (`:296`). typecheck exit 0; check:architecture exit 0 (7/8 allowed, 56 submodule edges); build exit 0. No `.dsh-scratch/`.

**FOUND.** `A2-requeue-platform` 0/5 is baseline Section A (no bubblewrap), so the continuation-helper regression is covered only by S1/S3/C3 here. `host.ts:183` NUL key remains per ruling 7. The old key counter coincidentally gave 12/21; corrected to call counts.

**UNSPECIFIED.** (1) Helper shape: discriminated unions `{status:'ready';value}|{status:'cancelled'}`, signal required; option accept, or add a cancelled field. (2) Requeue-only awaits (continuation basis, Turn window, workspace `resolveRoot`, session basis) are not reached by the public prepare fixture; production implemented; smallest option: accept, or add a public requeue fixture (A2-requeue needs bubblewrap here). (3) Late-restore rows use an A2 lookup-miss once so the real store returns `replayed:true`; F2 reading; option accept as a directed named-point miss. (4) Fail’s late-restore override removal is untested because the snapshot guard returns `revision_conflict` before any replayed commit; option accept as T-list. (5) Obs’s fixture copies the composition trigger wrapper because it builds the catalog owner directly; the notification still follows the real commit result; option accept, or move those rows to a platform fixture.