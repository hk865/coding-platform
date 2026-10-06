# DSH ladder: run protocol and run matrix

The ladder measures how far the local DSH (DeepSeek Harness CLI 0.1.7-rc.2, headless profile, default model deepseek-flash) gets on this repository, and how a task book should be written and split so that it works best, before task D (the WorkGraph file move) is handed to it. The levels are defined here (Windows scratchpad, the source of truth) and mirrored to WSL by `_tools/sync.sh`.

| level | what it measures | checker | runtime |
|---|---|---|---|
| LD | doc lookup: 10 places (4 in Chinese docs, 6 in code), answered as file:line(:value) | `check-lookup.mjs`, score = right / 10 | seconds |
| L2 | small mechanical move: 4 files, 35 files to change (39 specifiers, 5 path strings) | `check-move.mjs`, score = files right / 35 | ~6 min |
| L3a | middle move: 8 files (L2 ⊂ L3a ⊂ L3), 76 files to change (114 specifiers incl. 3 inline `import()` types, 7 path strings) | same, / 76 | ~6 min |
| L3 | the whole task D as a pure move: 17 files, 157 files to change (358 specifiers, 15 path strings); variants: no hint, three batches | same, / 157 (batches: `--table b1`, `--table b12`) | ~6 min |
| L4 | implement a pure 79-line fold to a frozen interface + own tests | `check-hidden.mjs`, score = 15 hidden targets; own tests gated three ways and scored on 5 mutants | ~1.5 min |
| L5 | write 14 tests from a case list with every expected value | `check-mutants.mjs`, score = 8 mutants killed | ~1 min |
| L5b | the same 14 cases as situations only: expected values and reason texts derived from the code | same | ~1 min |
| L6 | implement a 94-line owner-service write from spec §2 plus whatever the repository holds | `check-hidden.mjs`, score = 16 hidden targets; helper reuse reported separately | ~1 min |

Each level's `ORACLE.md` holds the proof of its checker (the real solution passes, a fresh copy fails, and the probes of the 2026-10-06 review).

## 1. Isolation (why a run can be trusted)

- **Sandbox.** DSH runs only through `node ~/dsh-work/ladder/_common/run-dsh.mjs run …` (bubblewrap 0.9 from `~/.local/opt/bubblewrap`, no unsandboxed fallback). Inside, the run sees only: `/usr` (with the `/bin`, `/lib` links), `/etc` and WSL's `resolv.conf` read-only, a private empty `/tmp`, `/proc`, `/dev`, node and the DSH install read-only (plus the one `node_modules` directory the profile's links point into), the copy read-write, and a DSH home made of the read-only settings and credentials plus private state for this copy (`_runs/_state/<copy>`: sessions, storages, cache, llm-deepseek, attachments, a copy of `profiles/headless`). Not visible: `/mnt` (the Windows worktree, the scratchpad), `~/dsh-work/base`, the ladder definitions, records, check clones and other copies, `~/cc-work`, other DSH sessions, the shared `/tmp` (which still holds files of other workflows: `vm-orig.ts`, `l6diff.txt`, `dshcfg.yml`). Proof (2026-10-07): `ls ../../base`, `ls ~/cc-work` fail inside; the config dump inside is byte-identical to the unsandboxed one (sha256 4bf70389…, model deepseek-flash); the full suite inside gives the same 5203 ids and the same 60 environment failures as the baseline; typecheck and architecture pass.
- **Scan of every run** (`scan-run.mjs`, written by the runner as `scan.json`): tool calls whose arguments name a path outside the copy (a `..` segment, `~`, `$HOME`, `/home/` other than the copy, `/tmp`, `/mnt/`, `/root`) are listed as attempts (inside the sandbox they reach nothing; `/tmp` use is counted separately because it is private); a tool result that contains a canary of the level (text of the hidden tests or of the removed body, checked to be absent from a set-up copy by `canary-check.mjs`) before the agent wrote that text itself makes the run **contaminated**. A contaminated run is discarded, not scored.
- **Checks never touch the copy.** Every checker builds a throwaway clone (pristine `node_modules` from base + the agent's files + the `.git` recorded at setup), judges it and deletes it. So a killed checker leaves nothing behind, hidden tests and Vitest caches never land in the copy, and DSH may be resumed in a checked copy. Feedback to DSH is only the output of the book's own checks (`visible-check.mjs`), never hidden results or the verdict.
- **Trust anchors outside the copy.** `setup.sh` writes `_records/<copy>/` (setup commit SHA, a backup of the set-up `.git`, ignored files at setup); checkers compare against that SHA, not the tag in the copy, and report `agentGit.agentCommits` / `tagMoved`. `sync.sh` writes a sha256 manifest of base and of the ladder definitions (`_records/golden.json`, copy in the scratchpad `_records/`) and makes base and the definitions read-only; a checker that finds any difference answers `verdict: "invalid"` instead of a score.
- **Copies only via `<level>/setup.sh`**, directly under `~/dsh-work/ladder/`, with a `-` in the name (`L2-flash-1`). Delete with `. ~/dsh-work/ladder/_common/env.sh; drop_copy <copy>` (copy, record, private DSH state).
- One DSH run at a time (the machine is shared). Never edit `~/.dsh`; overlays only as files in `~/dsh-work/patches/`, checked with `--dump-config` inside the sandbox (`run-dsh.mjs exec <copy> -- node <bin.js> --profile headless --patch <file> --dump-config`, print only a hash and the model lines).

## 2. Commands

```
L=~/dsh-work/ladder; . $L/_common/env.sh
bash $L/L2/setup.sh $L/L2-flash-1                                          # copy + record
node $COMMON/run-dsh.mjs run $L/L2-flash-1 $L/L2/task.md L2-flash-1 --level $L/L2          # flash
node $COMMON/run-dsh.mjs run $L/L6-pro-1 $L/L6/task.md L6-pro-1 --level $L/L6 --overlay ~/dsh-work/patches/pro.yml
bash $L/L2/check.sh $L/L2-flash-1 > <scorecard dir>/L2-flash-1.check.json
node $COMMON/visible-check.mjs $L/L2-flash-1 $L/L2 > $RUNS/L2-flash-1/feedback-raw.md   # raw feedback text
node $COMMON/run-dsh.mjs run $L/L2-flash-1 $RUNS/L2-flash-1/feedback-raw.md L2-flash-1-fb --level $L/L2 \
     --session-id <run.json sessionId>                                     # feedback round, same Session, same copy
bash $L/L3/check.sh $L/L3-batch-1 --table b1                               # batched L3 after batch 1 (b12 after batch 2)
drop_copy $L/L2-flash-1
```

The runner was tested without any model call (`_tools/runner-test.sh`: fake event scripts run in the real sandbox; results in `_results/runner-test/`): a normal run summed 21,300 tokens over 2 steps and 5 tool calls, saw `ls ../../base` fail and an empty `/tmp`, listed the `..`, `~` and `/tmp` arguments, and marked the run contaminated for a tool result carrying a hidden test title, while a canary string the agent had written itself first was not counted; a 0.1-minute limit stopped a hanging run after 7 s, and a 10M token limit stopped a run at 12M.

The runner writes `_runs/<runName>/`: `run.json` (wall time, exit, `stoppedBy`, tokens, tool calls, steps, contamination, model, session), `events.jsonl` (all DSH events), `final.md` (the report), `scan.json`, `git-status.txt`, `stderr.txt` (local only). Limits: `--max-minutes` (default 20) and `--max-tokens` (default 10,000,000 total tokens, summed from the `step_end` usage events); the defaults follow the user's correction of 2026-10-06 22:10 (DSH streams 250–300 tokens/s; 2–3 hard runs fit in 30 min). A run over a limit is killed (its own process group only) and recorded as `stopped: limit:time` / `stopped: limit:tokens`.

## 3. What to record per run (one scorecard row)

| field | from |
|---|---|
| level, variant, model, repeat | the run name |
| wall time, exit, stoppedBy | `run.json` |
| tool calls (by tool), steps | `run.json`, `scan.json.byTool` |
| tokens: fresh input, cache read, output, total | `run.json.tokens` (`input`, `cacheRead`, `output`, `total`) |
| verdict, score, failing gates | `check.sh` JSON |
| scope: stayed in its write scope | gates `scope` / `noExtraChanges` / `onlySpecifierChanges`; lists `outOfScope`, `extraChanges` |
| changed frozen or hidden tests | `outOfScope` (any test file other than the allowed one), `hiddenRecreated` |
| read outside the copy | `scan.json.contamination` (`none` / `attempted-outside` / `contaminated`), `pathHits`, `canaryHits` |
| doc lookup signal (L6, LD, L4) | `scan.json.lookups` (L6: whether it read spec §15 row 5.5 or `completion.ts`) |
| L4 own tests | `details.ownTests` (on real code, on the stub, `mutantScore`) |
| L6 reuse | `details.reportOnly[metric=reuse]` |
| report quality | `scan.json.report` (sections present) plus a short human note: are the CHECKS claims true (compare with the checker), does UNSPECIFIED list real gaps, did it invent behaviour |

## 4. Run matrix

Rules: flash first; every cell on its own fresh copy unless it is a feedback round or a later batch; one feedback round at most per run, in the same Session (`--session-id`), fed with the visible check output only. "Raw" feedback = `visible-check.mjs` output unchanged; "guided" = the same output plus a location and a line of thought written by the lead (still no hidden results, no verdict). The user's corrections of 2026-10-06 22:10 apply: three baseline repeats per level (flash is uneven run to run), a role-framing variant, raw vs guided feedback compared, and the pro model only as one L6 data point (the review suggested pro after every non-pass; the user expects pro not to help, so it is not used elsewhere).

| level | baseline (flash) | variants | feedback on a non-pass |
|---|---|---|---|
| LD | ×3 | role framing ×1 | none (a lookup has nothing to feed back without the key) |
| L5 | ×3 | role framing ×1 | raw ×1 / guided ×1 (on two different failed repeats) |
| L5b | ×3 | — | raw / guided as L5 |
| L2 | ×3 | role framing ×1 | raw / guided |
| L4 | ×3 | role framing ×1 | raw / guided |
| L3a | ×3 | — | raw / guided |
| L3 | ×2 (full book) | no hint ×1; batched ×1 (b1 → b2 → b3 in one copy, three Sessions, `check.sh --table b1`, `--table b12`, then plain) | raw / guided on the full book |
| L6 | ×3 | role framing ×1; pro ×1 | raw / guided |

Batched L3: start batch k+1 only when the check of batch k (`--table b1`, then `--table b12`) passes, after at most one feedback round; otherwise the batched cell stops there and records how far it got (the later books state that the earlier batches are finished). The reference move applied batch by batch ends byte-identical to the one-shot move (L3 `ORACLE.md`, run 4).

Order: cheap and short first (LD, L5, L5b, L2, L4), then L3a, L3, L6. Stop going up when a level fails all baseline repeats and its feedback rounds: that level and the levels above it mark the upper limit; still run L3a if L3 fails and L2 passes, since it sits between them.

## 5. Reading a checker result

`verdict`: `pass` (score 1 and every gate), `partial` (some score, or score 1 with a failed gate), `fail` (score 0, or for move levels a failed typecheck), `invalid` (the ladder or base changed since the sync: no judgement, rerun after `sync.sh`). Scores are behaviour only; gates are discipline (scope, no commits, typecheck, architecture, tests unchanged, canonical specifiers, own-test quality). For move levels `details.files.missing` names each file left unchanged with the specifiers it still lacks.
