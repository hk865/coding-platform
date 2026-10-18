# Task: slice 8 L8, rework 1 — triggers, order, failures, one mapping, public-step tests, the PASS rows; coordinator mode; test-driven

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session. The spec, the
books and the lead's rulings are binding; do not make design decisions; report anything undetermined under
UNSPECIFIED with the smallest options.

**This run is headless. When your turn ends, the whole run ends.** Work in coordinator mode
(`./.dsh-ref/coordinator-mode.md`; **read "How tests reach their state: no hand-written facts" (with "A name does not
change what it is") and "Before you build: what the reworks were about" first; both bind every brief**). Files disjoint
between subagents, every vitest command `--maxWorkers=2`, the close-out runs one vitest command at a time. **Do not end
your turn while a subagent has not reported back.** **Finish within 160 minutes** (the run stops at 170). Finish whole
items; an unfinished item is reported, not half-done. Delete `./.dsh-scratch/` (the directory too) before you end.

## 1. What this copy is

Tag `s8l8-1` (HEAD) = the L8 build (book `./.dsh-ref/l8-impl.md`, its rulings 1–12 still bind; your reply
`./.dsh-ref/l8-impl-final.md`). Codex's review: `./.dsh-ref/l8-review1.out.md` (Chinese; must-fix 1–7 with file:line
and the fix approach, then the UNSPECIFIED items and suggestions). Codex confirmed rulings 2–5, 7, 9, 10, 12 and the
WP2 re-count; the items below are what is left.

## 2. Items (binding; Codex's numbering in brackets)

1. **Trigger only on a new registration** [1]. Restoring an existing workspace at start-up goes through `openWorkspace`
   (`host-settings.ts` ~572) and still triggers (`host.ts` ~904, ~927). Trigger only after a non-replayed registration
   succeeded; an existing workspace restored at start-up is handled by the start-up retry alone. Test: a settings Host
   restart with a satisfied request starts no capture; with a pending one, it captures exactly once.
2. **Final order of the rows** [2]. The assembler sorts by key again (`context-assembler.ts` ~237), and a path inside
   the key puts `src/a/inner` before `src/a`. Sort by ruling 11 first, then key each row with a fixed-width sequence
   number; prove the final text through the public `prepare`.
3. **Failures are recorded** [3].
   - A catalog read that is rejected or throws at capture start (not a cancellation) goes to the same failure exit,
     guarded by the start snapshot's revision (`auto-capture-driver.ts` ~176, ~178; your UNSPECIFIED 8).
   - **Lead ruling on the reason's length:** the state constructor keeps the first 2,000 characters of the reason;
     the codec rejects anything longer. Test the cut in the pure state tests.
   - **Lead ruling (your UNSPECIFIED 10):** the `failed` event's `occurredAt` is the time the failure was written; the
     record keeps `requestedAt`.
4. **One mapping rule** [4; your UNSPECIFIED 4]. The browser UI may import only UI modules and the type-only HTTP DTO
   (`scripts/check-boundaries.mjs` ~446–462), so it cannot call `moduleMappingsOf`. **Lead ruling:** in
   `architecture/capture`, `mappings` becomes optional. When it is absent, the server builds the mappings from the
   active catalog with `moduleMappingsOf` (`[]` without a catalog). The UI's request (`ui/views/setup/requests.ts`
   ~200–209) stops sending them, and its own `map` is deleted. Callers that pass mappings keep working. Update the HTTP
   DTO (`core-http-types.ts`).
5. **Observation-state tests through public steps** [5]. `S8A-L8-observation-state.test.ts` ~84, ~99 build events and
   commit Project/Workspace directly; ~163 writes a made-up failure; ~145 writes a request without a real PASS.
   - Create the project and register the workspace publicly, and use real triggers.
   - Produce a failure by moving the root away.
   - Keep the existing capture gate, and prove that the driver uses its start snapshot (identity, watermark and failure
     guard).
6. **Coverage of book §3** [6].
   - **A-03 variants:** 12 → 10 with the omission line, `，不确定`, `还没有观测` and the empty case each run through the
     public `prepare` on both backends. The pure tests may stay as well.
   - **Failure after success:** a successful capture, then a failed one, then the root restored. A `prepare` before the
     retry shows the old observation's rows and its time.
   - **Backends:** the settings registration, the trigger during a running capture and the manual route run on memory
     and SQLite. **Lead ruling:** rows that need a Host restart (start-up retry, close then restart) run on SQLite only,
     because the memory backend does not survive a restart. Name each one.
   - **Concurrency and close** with a controllable gate on an injected dependency, not 900 files and `setImmediate`
     timing (`S8A-L8-auto-capture-host.test.ts` ~223, ~229, ~315, ~332). Prove that the second capture has not started
     before the close. Add: two workspaces captured one after the other (never both at once); a trigger merged while its
     workspace waits; a pending request of a workspace not bound in this Host is not retried.
   - **"Loads once":** count the reads outside the real preparation dependencies, with a previous observation and a
     file graph of more than one chunk (`S8A-L8-observation-state.test.ts` ~269, ~278). Report the read count as
     `8 + latest chunks + previous chunks`, or `6 + latest chunks` without a previous one, if that is what you measure.
7. **The three PASS rows** [7]. Write them, on both backends, with a real Run and real checks:
   - the Workflow's finalize;
   - the public `finalizeChecks`;
   - the same finalize replayed.

   Assertions, from Codex:
   - **The first PASS:** the original result is still a non-replayed success. `requestSeq` grows by exactly 1, with
     `trigger: 'check_passed'`; finally `pending: false`; `current` is new, and `previous` equals the old `current`.
   - **The replay:** it returns `replayed: true`, and `requestSeq`, `current` and `previous` are unchanged.

   These rows need bubblewrap, which this sandbox does not have (like A2 in `DSH-BASELINE.md`). Write them, run them
   once, and confirm that each fails only for the missing bubblewrap (quote the error); the lead runs them with
   bubblewrap. Do not skip them or mark them `.todo`.

8. **Production reach** (the lead's bubblewrap check of `s8l8-1`: 414 files, 2 failed).
   `tests/architecture/production-reach.test.ts` reports `src/core/agent-runtime/architecture-reminders.ts:197
   architectureReminderRows` as reached by no production entry. Delete it, or have production use it; never add new
   code to the allowlist.
9. **A background capture during a counted read** (the same check). In `tests/scenarios/WP2-wiring-scenario.test.ts`
   Z01 (~201), the real PASS now triggers an automatic capture. Its commit lands while the test counts the commits of
   a notices read, so it sees 45 where it expects 44.
   - Before taking `commitsBefore`, the test waits through the public `architecture/observation-state` until the
     automatic capture's request is satisfied (`pending: false`). Do not loosen the assertion.
   - Find every other test that counts commits, records or events around a step after a registration, adoption or PASS
     (grep `commitsBefore`, `commits.length`, event counts). Apply the same wait where the automatic capture is the
     cause, and list them.

## 3. Accepted suggestions (do them)

- **Previous ref at start** (your UNSPECIFIED 3): an automatic capture passes the start snapshot's current observation
  as `previous`, so its change counts are honest.
- **The persisted ref** (your UNSPECIFIED 5): `architecture/observation-state` also returns the persisted ref of
  `current` (and of `previous`), so a test or the UI can query without a replay.
- **A failed reminder read** (your UNSPECIFIED 9; lead ruling): a reminder read that fails for any reason except
  cancellation gives the single row `架构提醒不可用`, and the preparation continues. A cancellation still cancels.
- **Dead code:** delete the unused `signal`, the queue's `trigger` and `running.key` (`auto-capture-driver.ts` ~44,
  ~61, ~84).
- **Weak tests:** delete the random-ID inequality assertion (`S8A-L8-auto-capture-host.test.ts` ~213) and the
  duplicated old ownership test (`S8A-L8-reminders.test.ts` ~110).
- Your UNSPECIFIED 2, 6 and 7 are accepted as built.

## 4. Checks and reply

Checks: the changed and new test files (exact lists, one vitest command at a time, `--maxWorkers=2`), typecheck,
check:architecture, build. No real model calls, no git writes, never ports 3080/3099/44797.

Reply under 900 words:
- per item, RED → GREEN or how it was checked;
- the PASS rows' error messages in this sandbox;
- the measured read counts;
- the production lines added and removed this round;
- the checks, with numbers;
- UNSPECIFIED.
