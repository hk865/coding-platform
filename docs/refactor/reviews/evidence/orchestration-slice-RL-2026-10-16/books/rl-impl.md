# Task: slice RL — memory and process caps on sandboxed commands; test-driven

You are working in a copy of a TypeScript repository (the current directory). This is a NEW session: you have not seen
this copy before. Everything you need is in this message and in files of this copy. The spec is frozen; do not make
design decisions. Where the spec and this message do not determine something, do not invent behaviour: list it under
UNSPECIFIED in your reply.

**This run is headless. When your turn ends, the whole run ends, and every subagent that is still running is killed.**
- After starting subagents, stay in your turn until every one of them has finished and reported.
- Wait with a blocking shell command (`sleep 300`), then check with `list_agents`; repeat.
- End your turn only after the checks of section 8 and the reply of section 9.

**Work with subagents; keep your own context small** (an earlier session ran out of its 360K context). Do not read the
spec, the code or the tests yourself beyond what you need to coordinate; use `grep -n` and `sed -n a,bp`, never whole
large files. At most **2 subagents at once**, and at most **one building subagent at a time** (section 6). Each
subagent's message contains sections 1–5 of this message verbatim, the answers P1–P10 of section 6 verbatim, its own
group block verbatim, and: read
`./.dsh-ref/tdd/SKILL.md`, `tests.md`, `mocking.md`; read the spec sections its block names, always including §0.3 (the
L-rules its rows cite), §4, §5 (the head of §5, §5.1, the RE1 conventions at the top of §5.2, its rows), §7, §8; work
through its rows test-first; run `npm run typecheck` and its own test files only; reply with FILES, per row the test
name(s) and the implementation file:symbol, the RED/GREEN log, and UNSPECIFIED items (short).

## 1. What this copy is

- **Base:** commit `slice-setup` holds the content of commit 7ad00938 of the lead's branch (slices 0, 1, 3, 5, wiring 1
  and 2, K parts A and B, 2A and 2B merged; slices 4, 6, 7, 8 and RL frozen). Slice 2C is **not** in this copy (it is
  being merged separately; RL shares only `src/composition/create-platform.ts` with it, and the lead merges that). This
  copy has its own history; use `slice-setup`, not outside hashes.
- **Commit `slice-base`** adds `DSH-BASELINE.md`, the baseline of this sandbox.
- **The TDD skill** is in `./.dsh-ref/tdd/` (not committed, excluded from `git status`).
- **What you do:** implement **slice RL** of `docs/refactor/design/orchestration-2026-10/slices/slice-RL-SPEC.md`
  **test-driven**: for each row of spec §5.2 (entries RE0–RE3; the user confirmed them), write one failing test at the
  entry, see it fail for the right reason, write just enough production code to make it pass, go to the next row.
- **This sandbox has no bubblewrap and no systemd user session.** `DSH-BASELINE.md` lists the tests that fail here only
  for the missing bubblewrap. RE1 needs both (spec §5.4): see amendment A3. Never instrument a harness to fake a
  sandbox or a systemd session.

## 2. Where the rules are (all inside this copy)

The frozen spec, slice RL (Chinese prose, English identifiers): all of it. §0.2's code facts were checked at bb924854;
a read-only session re-checked them on this base (section 6, P1). Find the symbol if a line moved.

Lead amendments to the spec, binding (decision 56 of `docs/refactor/HANDOFF.md`):
- **A1 — you write the fixtures.** Spec §7 says Codex writes them first; since slice 2A the practice (decision 56) is
  that Codex only reviews read-only during a build and DSH writes the fixtures. Build each fixture exactly as §7
  describes (the Kernel sandbox double for RE2, the fake `systemd-run` bash script, the python3 memory/fork/thread
  fixtures, the RE1 command fragments and helpers, the child-Node script for Host death, the RE3 fake assembly). Each
  fixture file starts with a comment listing what it builds and for which rows. Production code never knows the fake
  `systemd-run` exists (it comes in only through `CODING_AGENT_SYSTEMD_RUN_PATH`).
- **A2 — §5.3:** the only existing-test edit is `tests/kernel/B2-history-public-export.test.ts`'s frozen export list
  (add the three value exports `probeResourceCaps`, `resourceCapStatus`, `RESOURCE_CAP_NONE_TEXT`). Every other §5.3
  line says "do not flip": keep those tests unchanged; if one fails, report it (test id, assertion, spec line).
- **A3 — RE1 cannot run here.** Write every RE1 row test-first as far as this sandbox allows: write the test, make it
  typecheck, run it once and record how it fails here (it must fail for the missing environment, e.g. no bubblewrap,
  no user session — never pass by accident); then write the implementation the row needs, guided by the RE0 rows that
  pin the same rules. Do not add skip guards: the lead runs RE1 in WSL (real bubblewrap, systemd 255 user session,
  python3) and needs those tests to run there. In the reply mark each RE1 row "written, not run here" with the failure
  line you saw.
- **A4 — the Kernel patch.** Sources are under `vendor/coding-agent/patches/`; `vendor/coding-agent/dist` changes only
  through `node scripts/build-kernel-patch.mjs --write`, never by hand. First, as its own step before any change:
  extract `tools/builtin/shell/shell-tool.ts` verbatim from `dist/tools/builtin/shell/shell-tool.js.map`'s
  `sourcesContent[0]`, add it to the script's `relativeSources`, run `--write` and `--check`, and show that
  `git diff --stat -- vendor/coding-agent/dist` is empty (byte-identical output). Report the SHA-256 of the extracted
  file. Only then change it. `vendor/coding-agent/patches/README.md` is the lead's: do not edit it.
- **A5 — L16 is binding as written ("读法").** `RoundCheckSnapshot.resourceCapHit` is written by `recordCheckResult` in
  the same commit as the check result, through the verification machine's check-result step; the notices read the
  round named by `TaskRequeue.afterRoundRef` (requeue) or the round the reverify continues from. Codex checks this in
  the implementation review.
- **A6 — the measurements at the end of spec §5.2** (cost per command, observation-complete ratio) are the lead's, in
  WSL. You do not run them.

## 3. Frozen files (never change them, not even temporarily)

`DSH-BASELINE.md`, `docs/refactor/design/orchestration-2026-10/slices/slice-RL-SPEC.md`,
`vendor/coding-agent/patches/README.md`, and `vendor/coding-agent/dist/**` except through `--write` (A4). **No existing
test file changes except A2.** Throw-away probes go under `./.dsh-scratch/` and are deleted at the end; never use
`/tmp`. If the spec seems to contradict an existing test, keep the test, report it under UNSPECIFIED (test id,
assertion, spec line, minimal counter-example) and go on.

## 4. Lead decisions for this round (binding)

- **L-scope.** Only the files of spec §6 may change (the Kernel patch sources it names, `scripts/build-kernel-patch.mjs`
  `relativeSources`, the contracts, Runtime, Host, composition and WorkGraph files it lists, and `dist` through
  `--write`), plus new test files whose names start with `RL-` under the fitting `tests/` directory, new helpers and
  fixtures `tests/helpers/RL-<name>` (`.ts`, `.sh`, `.py`, `.mjs`), the A2 edit, and **added entries only** in
  `tests/architecture/production-reach-allowlist.json` (L-reach). No lock files, no `docs/`, no RecordStore files. A
  file outside this list that you believe must change: stop and report it.
- **L-tdd.** One row → one failing test → minimal code → next row; tests at the row's entry (RE0 pure functions; RE1
  `probeResourceCaps` / `ProcessSandbox.execute`; RE2 the scripted-model Work, Query, registered check and workbench
  route with the Kernel sandbox double; RE3 `createHostSettings` with a fake assembly and the real Host settings route);
  **no reading the database or record store to verify** (the user's standing rule) — assertions go through public
  results and reads; expected values are literal, from the spec's rows or hand-computed, never computed with the
  product's own functions; each test name starts with the row id (`RL-20 (3) …`); a row with several cases has one
  assertion per case; no tests whose answer is obvious from the code.
- **L-fixtures.** Datasets for RE2 (goals, plans, tasks, Sessions, Runs, checks, rework) only through the real public
  services, as the 2A/2B tests do; machine conditions only through real programs, environment variables
  (`CODING_AGENT_SYSTEMD_RUN_PATH`, `CODING_AGENT_BWRAP_PATH`) and the Kernel-module double (spec §5 head).
- **L-reach.** `tests/architecture/production-reach.test.ts` must pass: every new exported declaration is reached from
  production code; a new Host route's Body/Response aliases go into the allowlist the way earlier routes did — report
  each entry you add.
- **L-interfaces.** Names, signatures and types exactly as spec §2 and L1–L16 give them.
- **L-nothing-else.** Spec §8 holds in full: no change to the uncapped path or to bwrap's arguments, no retry without
  caps, no new error codes, no `prlimit`, no `systemctl` calls from production code, no UI.

## 5. Rules for every group

1. Test-first, one row at a time; keep the RED/GREEN log per row for the reply.
2. Spec §4 rules and §8 hold, and L1–L16.
3. Read failures and refusals are returned, never turned into success, zero or an empty result; "uncertain" and
   "unknown" are never reported as "none".
4. No real model calls, no network; do not touch ports 3080, 3099 or 44797.
5. No git write commands.
6. One vitest command at a time per agent, `--maxWorkers=4`; the full suite only once at the end (section 8).

## 6. Lead answers to the read-through, and the groups (binding)

A read-only session read this book and the spec before you. The lead's answers:

**P1 — §0.2 on this base (its re-check, adopted).** Facts F1–F13, F15, F16, F18, F19, F21–F26, F28, F29 hold. These
moved:
- F14: `processSandboxOptions` → `execution-contracts.ts:139`;
- F17: `create-platform.ts` 442-445 → 461-463 and 1402-1408 → 1453-1460;
- F20: `create-platform.ts` 744-745 → 751, and 845 → 842/886;
- F27: the frozen export list is `B2-history-public-export.test.ts:94-118`.

F30–F39 are the lead's WSL measurements; you cannot re-run them here and need not. **F12's "命令不拍快照"** means the
workbench command takes no workspace-effects capture (`captureWorkspaceEffects: false`). The command page's result
snapshot `WorkbenchCommandSnapshot` (F26) is a different thing and gains `resourceCaps` (RL-33).

**P2 — A4 if the `dist` diff is not empty:** stop, report the diff summary, and do not hand-edit `dist`; the lead
decides. The read-through measured the extracted file's SHA-256 as `181b3600…ae35f`; check yours against it.

**P3 — L2/L4 "子进程 pid"** = the pid Node's `spawn` returns. `systemd-run --scope` execs in place, and so does the `sh`
that then execs bwrap, so it is one process throughout.

**P4 — L5 step 3 version:** the first decimal integer on line 1 of `systemd-run --version` (`systemd 255 (…)` → 255). No
integer there → neither option (the spec's "读不出版本就两样都不带").

**P5 — L2 keeper identification (production):**
- the keeper is the one pid in the scope's `cgroup.procs`, other than the Node child pid (P3), whose NUL-split
  `/proc/<pid>/cmdline` equals exactly the argv the Host passed after `--`: `/bin/sh`, `-c`, the keeper script,
  `agent-keeper`, the bwrap path and its arguments;
- none, or more than one → `keeper_not_identified`;
- only tests identify it by the `agent-keeper` token alone (§5.2).

**P6 — L10 tail notes**, for `shell` and `run_readonly_command` alike, exactly as the L10 table says:
- they are appended to the non-zero-exit message (`null` counts as non-zero) and to the handler's own timeout message:
  "（超出内存上限）" when `memory` is `cap_hit`, "（有新进程或线程被任务数上限拒绝）" when `processes` is `cap_hit`, both
  when both;
- nothing on success or cancel, and nothing on M10's fixed message.

**P7 — Test directories:**
- Kernel functions and RE1 → `tests/kernel/`;
- `defaultResourceCapSettings` → `tests/contracts/`;
- `shell`, read-only command and check results → `tests/runtime/`;
- the notices (RL-32b) → `tests/work-graph/`;
- Host settings, routes, workbench and wiring (RL-33, RL-34, RE3) → `tests/app/`.

Run one file with `npx vitest run <file> --maxWorkers=4`. RE0 tests import the Kernel functions from the `dist` path
after `--write` (precedent F29: `vendor/coding-agent/dist/sandbox/process/process-sandbox.js`).

**P8 — L13's live source** (read-through item 5.5): exactly the L13 table:
- the Runtime merges `resourceCaps` into `processSandboxOptions` at the last hop, where `observed-model-run.ts` calls
  the Kernel (F13);
- `execution-preparation.ts` is not changed (F14), and `effectiveOptions` excludes `resourceCaps`;
- it enters no authorization, configuration version, prepared execution, digest or resume constraint.

**P9 — The allowlist edit is in scope** (section 4 now says so): add entries only, for the new route
`resource-caps/save` and any new wire-format alias, the way earlier routes did. Report each entry.

**P10 — `.dsh-scratch/`** is excluded in `.git/info/exclude`, as `.dsh-ref/` is; delete it at the end anyway.

**P11 — Groups: your cut, every file in exactly one group, run one at a time in the order G1 → G3 → G2.** This replaces
spec §7's "G2、G3 可以并行": with this cut G2's row (RL-32b) needs G3's check observation. After each building group,
start its **read-only review subagent** (spec §7: "每组派一个只读复查子任务"). It may run alongside the next building
group. It reads that group's diff against the spec rows and L-rules and reports findings; the next building subagent or
you fix confirmed findings before the end.

*G1 — Kernel and shared types.*
- Files:
  - `vendor/coding-agent/patches/sandbox/process/process-sandbox.ts`;
  - the extracted `tools/builtin/shell/shell-tool.ts` (the A4 step first, then both L10 edits);
  - `public-api.ts` and `scripts/build-kernel-patch.mjs` `relativeSources`;
  - new `src/contracts/resource-caps.ts` (settings, defaults and report types; `defaultResourceCapSettings`);
  - type-only additions in `src/contracts/verification.ts` (the optional `resourceCaps` on the `executed` observation
    and `RoundCheckSnapshot.resourceCapHit?`; the codecs and writers are G2's);
  - the A2 edit.
- Rows: RE0 RL-20, RL-21, RL-22; RE1 RL-01…RL-15 (written, not run here, A3).
- Spec: L1–L12, L14, L15, §2's Kernel and contract parts, §5.4.

*G3 — settings, wiring and every Runtime/Host result.*
- Files:
  - `src/app/host.ts`, `host-settings.ts`, `host-settings-types.ts`, `main.ts` and `src/composition/create-platform.ts`;
  - `execution-contracts.ts`, `observed-model-run.ts`, `execution-driver.ts` and `query-execution.ts`;
  - `readonly-command-tool.ts` (input, JSON, tail note);
  - `check-execution.ts` (the dependency **and** the observation record);
  - `workbench-tools.ts` (options **and** snapshot);
  - the allowlist entries (P9).
- Rows: RL-30, RL-31, RL-32, RL-33, RL-34, RL-35, RL-36 (RE2); RL-40…RL-44 (RE3).
- Spec: L10, L11, L13, L15, §2's settings and Runtime parts.
- Before RL-30 (g) and RL-31's dispatcher timeout: the read-through found that fake timers can push the frozen
  dispatcher's timeout (`tool-dispatcher.js:124-127`). Make the fake timers active before the dispatch starts, and have
  the double settle on abort, never hang. If it still does not work, stop on those cases and report (spec §7).

*G2 — the rework notice (L16).*
- Files: `persistence/evidence-record-codecs.ts`, `evidence/evidence-service.ts` (`recordCheckResult` writes
  `resourceCapHit`), `state/verification-machine.ts` and `views/automatic-rework-notices.ts` (the new round reads of A5;
  today it reads no `afterRoundRef`).
- Row: RL-32b.
- Spec: L16, A5.

## 7. Size and time

Finish within 240 minutes. If you run short, finish whole rows rather than half of many, and say which rows are left.

## 8. Checks

`npm run typecheck`, `npm run check:architecture`, `npm run build`, `node scripts/build-kernel-patch.mjs --check`; the
RL test files (RE0, RE2, RE3 must pass; RE1 fail here for the environment only, A3); the full suite once
(`--maxWorkers=4`) compared with `DSH-BASELINE.md` §A — list every failure outside it, separating the RE1 files. `git
status --short` must show only the files of L-scope.

## 9. Reply

FILES CHANGED; the A4 extraction step (SHA-256, the empty `dist` diff); per row the test name(s), the implementation
file:symbol and RED/GREEN in one line each (RE1: "written, not run here" and the failure line); the rows or cases not
built and why; the review subagents' findings and what was fixed; CHECKS (each command and its result, the full-suite
numbers and the failures outside the baseline); UNSPECIFIED; NOTES (regrouping, size).
