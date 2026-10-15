Implementation review of slice 4A (the note core) before merge. Read-only: do not edit files, do not run tests, do not
call any model. You may read any file in this repository and in D:/cc-lead-notes.

Repository: the current directory. HEAD is a local commit "2C merge candidate" (7ad00938 + slice 2C as it will be
merged). The index holds slice 4A as it will be merged on top (`git diff --cached HEAD`, 20 files). The lead resolved
six conflicts in `src/composition/create-platform.ts` as unions with 2C (record groups, the owner-key list, and ONE
hoisted `sessionDutyResolver` shared by the Workflow, the 2C line read and the notes service).

Frozen spec: `docs/refactor/design/orchestration-2026-10/slices/slice-4-SPEC.md` — the 4A parts: L1–L7 as they apply
to 4A, §2 contracts, §3 state machine rows, §5 rows N-01–N-22 (NE1–NE3), §6 "4A" file line, and the test rules.
Task book with the lead's binding answers P1–P14 (section 6): `D:/cc-lead-notes/impl/s4a/s4a-impl.md`. Builder's
report: `D:/cc-lead-notes/impl/s4a/final-1.md` (read its UNSPECIFIED list). Pre-read report:
`D:/cc-lead-notes/impl/s4a/s4a-preread-final.md`.

Verified by the lead on the merged tree (WSL, bwrap): typecheck, boundary check (`WorkGraph/notes` edges: architecture,
model, persistence, state, tasks), build, kernel-patch check; the four S4A test files plus `tests/architecture` and
`tests/composition/platform.test.ts`: 8 files, 147 tests passed. The full suite has not run yet.

Review, citing file:line:
1. Behaviour against the spec and P1–P14: the write path (caller → source, anchors and their resolution, limits,
   same-topic gate, relations, quota, contradiction/structural pending, current pointer CAS, withdraw, replay),
   dispositions (who may accept/review/reject what), scribe scope (P1 count, P6 derived facts, containment), the
   events and records, idempotency on replay, and failure handling (a read failure must never become a definite answer).
2. State writes go through `src/core/work-graph/state/` (repository rule 9); records and indexes match §2/L3.
3. Tests: business flows through public interfaces, literal expected values from the spec or hand computation, no
   database reads to verify, no product functions used as oracles; the storage-boundary interleave fixture is only
   where P11/W2 allowed it.
4. The builder's open points, each with your recommendation:
   (a) five `kept-for` entries added to `tests/architecture/production-reach-allowlist.json` (outside the book's scope);
   (b) write-side `symbolRequest` resolution not built — the spec's §6 4A line puts it in `note-service.ts`, but no N
       row tests it (4C G-01 does); 4B's read-side symbol location reads what 4A stores;
   (c) N-10's `SA1` archive sub-case not built (P14 said: use the public Workflow archive) — is it really unbuildable
       through public services, or can the Run be ended first and `archive-line` used?;
   (d) UNSPECIFIED items 7–11 (replay recomputes `overQuota`/`existingTopics`, `noteLimits` option, P1 enumeration via
       the Goal index, stage `planRevision` from the current accepted plan, index ids and wire `revision`).
5. Anything 4B/4C will trip over (interfaces they must extend, names the spec fixes that the code renamed).

Reply under 1,800 words: numbered must-fix items (each with the concrete change), then should-fix, then your answers to
4(a)–(d), then a one-line verdict ("merge", "merge after listed fixes" or "not ready").
