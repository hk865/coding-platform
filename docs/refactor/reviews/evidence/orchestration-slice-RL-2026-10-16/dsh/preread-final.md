# Slice-RL pre-build review (read-only)

Base facts: HEAD `057902c` (`slice-base`; parent `856e744` = tag `slice-setup`, content 7ad00938). `git diff 856e744 HEAD -- src tests` is empty; `bb924854` is not in the local object DB, so verdicts are against this tree. No `resourceCaps`/`resource-caps`/`resourceCapStatus` symbol exists in `src`, `tests` or `vendor/coding-agent/patches`; 2C is absent.

## 1. §0.2 on this base
- **F1 HOLDS** — PS:570‑575 exact; second spawn PS:117 (`bwrap --version`); dist:414‑419.
- **F2 HOLDS** — PS:576‑601 (`process.kill(-pid,"SIGTERM")`→250 ms SIGKILL), timeout from spawn PS:595, pre‑spawn abort PS:405‑407/564‑567, `#notStartedResult` PS:911‑923.
- **F3 HOLDS** — PS:767‑820.
- **F4 HOLDS** — PS:884‑895; guard 110‑113; exit 126→`invalid_arguments` 626‑633.
- **F5 HOLDS** — PS:618‑622, 402‑404, code union 80‑88.
- **F6 HOLDS** — PS:50‑64, 671‑680 (no resource field).
- **F7 HOLDS** — PS:319‑399, 333‑335, `test ! -e /proc/self/fd/3` 372/480, cache 268‑271, read‑only canary 477‑538.
- **F8 HOLDS** — PS:310‑317 (`Omit<…,"workspaceMode"|"ipcWalkMaxEntries">`, three fields); dist composition‑root.js:135‑148 (145‑147).
- **F8a HOLDS** — PS:542‑545, 562‑563, 687‑712, 826‑854.
- **F9 HOLDS** — dist composition‑root.js:60‑62/67/73‑80, resume‑composition.js:59‑61/66/232‑236; patch sources: option field `composition-root.ts:86`, passed at `:168` (`new` at 164); `resume-composition.ts:84`, passed at `:158` (`new` at 154).
- **F10 HOLDS** — readonly‑command‑tool.ts:238‑251 (probe 243, new 244, same object).
- **F11 HOLDS** — check‑execution.ts:161, 229.
- **F12 HOLDS** — workbench‑tools.ts:347‑353 (cached per workspace, no options), 500‑507 (`captureWorkspaceEffects:false`). Note: the prose “命令不拍快照” is misleading — a `WorkbenchCommandSnapshot` exists (:109‑121, F26/RL‑33).
- **F13 HOLDS** — execution‑driver.ts:845‑849/921; query‑execution.ts:366‑370/550; observed‑model‑run.ts:104/299.
- **F14 MOVED** — `processSandboxOptions` is now `execution-contracts.ts:139` (spec 138); execution‑preparation.ts:331‑334 and host.ts:264 hold.
- **F15 HOLDS** — host‑settings.ts:197‑205.
- **F16 HOLDS** — host‑settings.ts:50‑52, 120‑132, 265‑274, 392‑444 (file literal :399), 742‑770; host‑settings‑types.ts:23‑42, 74‑82.
- **F17 MOVED (create‑platform only)** — host.ts:651‑654/927 hold; create‑platform.ts:442‑445→461‑463, 1402‑1408→1453‑1460.
- **F18 HOLDS** — host‑settings.ts:154‑167 (`readCheckProposal?` :158), 696; A2‑settings‑automation.test.ts:47.
- **F19 HOLDS** — host.ts:389‑390 (only literal).
- **F20 MOVED (create‑platform only)** — host.ts:452/473/919‑927 hold; create‑platform.ts:744‑745→751 (`createEvidenceService`), 845→842/886 (runtime).
- **F21 HOLDS** — main.ts:209 (build Host), :222 (`listen`).
- **F22 HOLDS** — shell‑tool.js:39, 56‑76, 87‑88, 90‑91, 101‑104, 148; `tools/builtin/shell/shell-tool.ts` not in `relativeSources`.
- **F23 HOLDS** — tool‑dispatcher.js:137‑138 (only `output` bytes).
- **F23a HOLDS** — tool‑dispatcher.js:124‑127 `setTimeout`→`timedOut=true; controller.abort(...)` (abort only), await :130; rules :140‑145; catch :153; :173‑190.
- **F24 HOLDS** — readonly‑command‑tool.ts:24 (128 KiB), 44‑46, 105‑202 (order stderr→stdout→paths→non‑fixed msg), 253‑260, 266‑281, 311.
- **F25 HOLDS** — check‑execution.ts:243‑249; verification.ts:75‑94; evidence‑record‑codecs.ts:571‑598 (extra fields never rejected).
- **F26 HOLDS** — workbench‑tools.ts:109‑121.
- **F27 MOVED** — the frozen list in B2‑history‑public‑export.test.ts is **:94‑118**, not 94‑110 (list content otherwise as claimed; used at :242).
- **F28 HOLDS** — K‑readonly‑command.test.ts:50 (hoisted), :74 (`vi.mock('…/process-sandbox.js', …{...actual, ProcessSandbox})`).
- **F29 HOLDS** — PS:200 `export function planReadonlyMounts`; K‑readonly‑sandbox.test.ts:43‑45 imports from the dist path, used :674.
- **F30–F39 (measurements)** — not tree facts and not re‑verifiable here: no `bwrap`, no `/sys/fs/cgroup`, no `/run/user/1000/systemd/private`, so no RE1 row can run. F31 does match: `systemd-run --version` = `systemd 255 (255.4-1ubuntu8.17)`. F30/F32–F39 (including the F38 87 %/60 % and F39 30/30 numbers that justify the keeper) remain unverified.

## 2. Unclear
1. **Book §2** “a read‑only session re‑checked them on this base (section 6, P‑answers).” No P‑answers section exists in `rl-impl.md` or anywhere (`.dsh-ref/rl-preread.md` is this prompt). *Assume:* do the re‑check myself (this report).
2. **Book §2/A4** “run `--write` and `--check`, and show that `git diff … dist` is empty.” If it is **not** empty, no instruction. *Assume:* stop and report; never hand‑edit `dist`.
3. **Spec L4** “读 `/proc/<子进程 pid>/cgroup`” — which pid, given the keeper fork. *Assume:* Node’s direct spawn child (= the `sh`→`bwrap` pid).
4. **Spec L5 step 3** “取第一行的版本号” — format unspecified. *Assume:* first integer on line 1 of `systemd-run --version`.
5. **Spec L2** keeper identification: “`/proc/<pid>/cmdline` … 和 Host 起 systemd-run 时给的一样”. *Assume:* match the literal `agent-keeper` argv token (§5.2 says the tests do this).
6. **Spec RL‑30 (b)** message `shell 退出码 null（超出内存上限）` requires formatting the null exit code and appending text; the extracted `#error` currently takes the plain message. *Assume:* append inside the `exitCode!==0` branch only.
7. **Book §6** gives no test‑file directory per entry (only “name starts `RL-` under the fitting `tests/` dir”). *Assume:* RE0→`tests/kernel/`, RE1→`tests/kernel/`, RE2→`tests/runtime/`, RE3→`tests/app/`.
8. **Book §1** says “use `slice-setup`, not outside hashes”; the copy’s commit is `slice-base`. Git tags `slice-setup`→856e744 and `slice-base`→057902c exist, so the book is right; but the “own history” phrasing is confusing. *Assume:* diff `slice-setup..slice-base`.

## 3. Contradictions
1. **Book §6 order vs spec §7** — book: “G1 → G3 → G2 … one at a time”; spec §7: “顺序 G1 → G2、G3（G2、G3 可以并行）”. The book silently overrides the spec.
2. **Same file in two groups (book §6):** `vendor/coding-agent/patches/tools/builtin/shell/shell-tool.ts` is G1 (“the extracted … shell-tool.ts”) **and** G2 (“the `shell` mapping”).
3. `src/core/agent-runtime/check-execution.ts` is G3 (“(dependencies)”) **and** G2 (“(observation record)”).
4. `src/app/workbench-tools.ts` is G3 (“options and snapshot wiring”) **and** G2 (“the workbench command-page snapshot”).
5. **L‑scope vs L‑reach** — book §4 L‑scope allows only spec §6 files + new `RL-` tests + the A2 edit, but L‑reach requires adding entries to `tests/architecture/production-reach-allowlist.json` (an existing JSON, not an `RL-` test, not in §6). The builder is told to “stop and report” such a file, yet the same book requires the edit.
6. **RL‑34 (G3) depends on G2** — RL‑34 asserts the Query readonly‑command site reads `current()`, but `ReadonlyCommandToolInput.resourceCaps` is a G2 change (“readonly-command-tool.ts (input, JSON, tail note)”). With G1→G3→G2, G3 cannot build/test that site.
7. **Spec §0.2 baseline drift** — §0.2 header says facts were checked at `bb924854`, the spec header says the code base is `e8b3edae`, the book says `7ad00938`; F27’s cited range is also `:94‑110` vs actual `:94‑118`.
8. **F12 vs F26/RL‑33** — F12 says “命令不拍快照”, F26/§2/RL‑33 require `WorkbenchCommandSnapshot.resourceCaps`. (Probably means the sandbox construction snapshots no options, but the wording contradicts.)

## 4. Cannot build as written (and the two requested checks)
1. **shell map — OK.** `vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js.map` exists; `sourcesContent[0]` extracts (6023 chars/199 lines, complete `shell-tool.ts`; `sources[0]="../../../../src/tools/builtin/shell/shell-tool.ts"`, matching the script’s convention). **SHA‑256 `181b360030614bdba8ddfb6000de10f7febb9f43568e1ca7ac864d13112ae35f`.** `tools/builtin/shell/shell-tool.ts` is currently **not** in `relativeSources` (14 entries, build‑kernel‑patch.mjs:13‑25); README.md:5 records the sqlite‑stores extraction precedent. **Risk, unverifiable read‑only:** A4’s byte‑identical `--write` cannot be run here; if the compiled output is not byte‑identical the premise fails — the builder’s first action must be the A4 step.
2. **RL‑30 (g) / RL‑31 fake timers — works.** The frozen dispatcher creates `setTimeout(..., definition.defaultTimeoutMs)` at tool-dispatcher.js:124‑127; the callback only sets `timedOut` and aborts the internal `controller`. It `await`s the handler (:130) and returns the `timeout` error only after the handler settles (:142‑143). A test that starts the dispatch, advances fake timers, and has the double return on `controller.signal` abort gets exactly the specified result. Caveats: fake timers must be active when the timer is created; `timer.unref?.()` does not stop firing; a never‑settling double would hang. No stop condition.
3. **RE1 fixtures cannot be built/validated here at all** (no bwrap/cgroup/user session; §5.4/A3 already say write‑only). RE1’s identity/flags/`pgrep`/`systemctl --user` helpers can be written but never exercised in this copy.
4. **RL‑32b (L16)** is feasible but the triggered round is **not currently read**: `automatic-rework-notices.ts` has zero `afterRoundRef` hits; the requeue path uses `requeue.ref/task/automation` (:227‑247) and reverify uses `roundChainHead` (:273) + `round.chain.*` — L16’s new reads must be added (precedent `run-state-service.ts:860`). Not a blocker.
5. **Old tests under the required new field:** K‑readonly‑sandbox.test.ts builds `ProcessSandbox` without `resourceCaps` and asserts errors with `toMatchObject` (plans use `toEqual` on mount plans, not result objects); K‑readonly‑command.test.ts doubles lack the field but use `toMatchObject`. §5.3’s “不翻转” looks safe, but the real‑sandbox file must be re‑checked in WSL.

## 5. Missing
1. The promised **P‑answers** list (only this report replaces it).
2. Per‑row **test file paths/directories** and the single‑file vitest command (book says “its own test files only”, `--maxWorkers=4`, but not the exact invocation).
3. The **RE0 import specifier** for the new Kernel functions (F29 shows the dist‑path precedent, but neither book nor spec states it; tests must import `vendor/coding-agent/dist/sandbox/process/process-sandbox.js`).
4. Whether editing `tests/architecture/production-reach-allowlist.json` is in scope (see 3.5).
5. How the live `ResourceCapSource` object is threaded into `processSandboxOptions` without entering the serialized execution snapshot/authorization (L13/F14 say “not into any config”, but not the exact seam/type).
6. Nothing states what `.dsh-scratch/` is (gitignored?) although book §3 requires probes there and a clean `git status`.

## 6. Size (book §6)
- **G1 Kernel — large.** `process-sandbox.ts` (~950 lines) gains capability probing with a full canary, limit verification, counters parse/merge/attribution, the keeper fd protocol and a settlement state machine; plus extracting/editing `shell-tool.ts`, `public-api.ts`, build script; RL‑20 (16 cases), RL‑22 (a–t) and all RE1 rows (written, not run). Most code + most tests.
- **G3 settings/wiring — large.** New contract file; host‑settings persist/validate/route/snapshot; Host holder + literal + assembly + F19; workbench options; `main.ts` probe; `create-platform` option/default; threading through `execution-contracts`, `execution-driver`, `observed-model-run`, `query-execution`, `check-execution`. Broad, shallow edits.
- **G2 results — medium‑large.** ~8 files; RL‑30 (a–h), RL‑31 (a–h + 128 KiB), RL‑32/32b/33/35/36; L16 touches four WorkGraph files. Fewer production lines, heavy tests.

## 7. Grouping
The order is **not sound as written**. It creates the four file collisions in §3 (shell‑tool.ts, check‑execution.ts, workbench‑tools.ts; plus the allowlist) and makes RL‑34 depend on a later group. Cut I would use, assigning each file to exactly one group:
- **G1 (Kernel + contracts):** `process-sandbox.ts`, `shell-tool.ts` (extraction + both L10 edits), `public-api.ts`, build script; also create `src/contracts/resource-caps.ts` and freeze the shared report/reason types, so G2/G3 read them. RE0 RL‑20/RL‑22, all RE1.
- **G2 (WorkGraph L16):** `contracts/verification.ts` (both observation field and `RoundCheckSnapshot.resourceCapHit`), `evidence-record-codecs.ts`, `evidence-service.ts`, `verification-machine.ts`, `automatic-rework-notices.ts`; RL‑32b.
- **G3 (settings + all remaining result mapping):** host‑settings/host‑settings‑types/host/main/create‑platform, `execution-*`/`observed-model-run`/`query-execution`, `readonly-command-tool.ts`, `check-execution.ts` (dependency **and** observation), `workbench-tools.ts` (options **and** snapshot). Then no Runtime/result file is split.
Order **G1 → G3 → G2** still works with this cut (G3 reads G1’s frozen types; G2 only reads G1/G3), and the new allowlist entries should be an explicitly allowed file in L‑scope.

`git status --short` printed nothing (`[clean]`).