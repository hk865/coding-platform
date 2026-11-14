# G6 acceptance driver

The driver for slice 9's one final real-model acceptance run (G6): the eight scenarios (E05, E06, E08, E09, E12,
plan iteration, direct intervention, waiting), the two 131072 cells (A1, B1), the compaction scenario, the attached
Goals C-216/C-221/C-222 and the B06 closing cells. It goes only through the real CLI
(`node dist/app/main.js <workbench-config.json>`) and HTTP (`/api/real/core/`, `/api/real/settings/`, header
`x-platform-token`). It imports no `tests/` fixture, reads no SQLite and never uses `runtimeProvider`.
Spec: `slice-9-SPEC.md` §5; rulings: `9-start-rulings` G6 and the G6 start rulings (2026-11-14).

## Run

```sh
npm run build                                   # dist/ and the boards the token is read from
node scripts/acceptance/run.mjs scripts/acceptance/acceptance.config.json
node scripts/acceptance/run.mjs <config> --only A1,E12 --out /tmp/g6-dry   # a dry run; it does not count
```

Before the real run the lead fills in `acceptance.config.json`: `authorization.text` (the approved text, recorded
verbatim in every result row), `window.from`/`window.to` (ISO times with offset), `runRoot` (an empty directory
outside the tree for the Hosts' data and the project folders), `cells.A1.modelId` and `cells.B1.modelId`
(`smoke-deepseek`), optionally `cells.compaction.modelId`. Token caps are in tokens only (`inputTokens + outputTokens`);
nothing has a default: the precheck refuses to start a Host while any of these is missing or the time is outside
the window.

## What it does

- **Hosts.** W-accept (the eight scenarios, the attached Goals, B06), WA (A1), WB (B1), the compaction Host; each its
  own folder and ledger under `runRoot`. A Host is started through the existing smoke start script
  (`host.launcher`), copied per folder with its `cd` line pointed there (as `impl/smoke/srr/host-ctl.sh` does); that
  script reads the provider keys in place inside the Host's own process. Normal close is SIGINT; E06, E12 and waiting
  restart over the same ledger.
- **Token.** Read from `<meta name="platform-token">` of `/workbench/Main.dc.html` into the driver's memory only;
  never written, logged, put in argv or a URL. The report says "已取得令牌" or `uncovered (entry-missing)`.
- **Provider.** Chosen once at each scenario's start with the existing probe (`host.providerProbe`, which prints only
  the answering model id), or fixed for A1/B1; then `settings/models/save` (re-saving the seeded entry) and
  `settings/models/select`. Never switched inside a scenario.
- **Budget.** `lib/budget.mjs` sums `inputTokens + outputTokens` from public reads (`sessions/queries` request rows,
  `activity/runs` for ended Work Runs), records `cachedInputTokens` beside it, and stops after the request that
  crossed the window total or a 50M scenario/cell cap; the rest of that unit is `uncovered (not-run)`. Each item
  belongs to the unit that owns its project, not to whichever unit was running when it was read; E06 takes E05's
  project over only when E05's work was shown stopped, otherwise E06 is `not-run`. A stop once seen ends every later
  wait at once. A reading is used only when every read answered `ready` and every usage is known: a request with
  `unknown` usage, or an ended Run whose usage is unknown or incomplete, stops the meter (only the public proof of a
  zero, a Run that never entered the Kernel, counts as zero). A request whose Query reached its terminal failure from
  the model service (`provider_request_failed`) is a proven rejection: it counts as unbilled 0 (noted), A1/B1 judge it
  `fail` with that source, and the run goes on. **Known gap:** a Work Run's compaction summary request runs in its
  own Kernel Session and is not in `activity/runs`, so the meter undercounts those; the driver does not read the
  database to fill it in (the caps are far above the expected use).
- **Unit end and last close.** When a unit ends, and before a Host's last close, the driver asks the Goals not
  finished to pause, then waits up to 30 minutes until each reads PAUSED or finished and no Query (running or still
  pending) or Run is in flight. What is still there is cancelled the way the person would (`queries/cancel`; a
  `cancel` control on the Run through `controls/submit` + `controls/deliver`), each cancel noted, then up to 10 more
  minutes; then the full reading. A refused pause or cancel, an unreadable state, or work still there after that
  means new work was not shown stopped: no later unit runs, and the Hosts get their bounded last close. A restart
  (E06, E12, waiting) is the scenario's subject, so it only takes one reading; a close that does not end with exit 0
  fails that restart's check and no second Host is started on that ledger.
- **Node review.** Under `every_step` (E08) the person reviews each finished node from `goals/delivery` and commits
  it with `nodes/commit`, as the product requires before the next node.
- **Check rounds.** A work Task's rounds are read by each of its Runs (`subjectRunRef`); a gate's by the Task.
- **Waiting.** The wait lives where the product allows it: the member's Work Run asks the secretary line through
  `send_session_message` with `waitAfterSend` (a Query round is refused that combination). The chain is followed until
  each event came, the chain is over (its Task done, every wait settled), or the window ends.
- **Lag probe.** `lib/lag.mjs` is preloaded into each Host (`NODE_OPTIONS=--import`), samples
  `perf_hooks.monitorEventLoopDelay` and writes p50/p95/p99/max; recorded only, no threshold.
- **Seed Goals.** A settings-opened workspace gets its trusted checks, policy and architecture only from a cold-start
  adoption (`src/app/host-settings-types.ts:170-182`), which is the real product path. So E05 and B06 (and B06-W5's
  non-Git project) first run one small cold-start Goal, then the explicit `goals/create` → `plans/propose/apply` Goal.
- **Planning rounds are slow by design.** The Host's idle consume pass runs once a minute per workspace, and an
  `intervention_planning` Query moves one stage per pass (submit, claim, prepare + start). So the first planning
  request comes about 3 minutes after the `refine:` round is sent (A1/B1 wait up to 30).
- **Verdicts.** Three words only: a failed check → `fail`; none failed but one not run → `uncovered` with one of the
  seven reason codes; all ran and passed → `pass`. An existing capability that ran and did the wrong thing, or did not
  happen in time (a refused route, no Goal card draft, a failed adoption, a wait that runs out), judges its check
  `fail` with the platform's words; a missing entry or an environment cause with evidence is `uncovered`; the checks
  after a stop are `uncovered (not-run)`.
- **What a check reads.** Histories are split by turn identity (Kernel `runId` + `turnId`): a turn's actual input,
  its successful tool results, its final answer (and an accepted submit's arguments, e.g. `submit_exec_review`). Each
  check reads only the part it is about; what the public reads cannot show is `uncovered`, never a pass.
- **Wall table.** Every refusal is its own row: each HTTP refusal when it happens (refusals the step expects too,
  flagged `expected`), and each tool refusal in the public histories (one row per call, at its own time, collected
  at each unit's end and before each last close). Only successful polled reads fold. Category only from a named
  basis: 协调 (busy, version, idempotency, stale source, capacity), 安全 (the reason names an irreversible, external or
  secret basis), 产品规则 (the reason names a rule), otherwise 无理由.

## Output (`docs/refactor/reviews/evidence/slice9-rerun-<date>/` unless `--out`)

- `result.json` — the eight scenario rows, the spec's fields (`slice-9-SPEC.md:729-745`).
- `README.md` — `total=8 / pass / fail / uncovered`, A/B, compaction, attached, B06, wall-hit count, budget, lag.
- `checks/http.jsonl`, `checks/model-calls.jsonl`, `checks/commands.txt`, `checks/notes.md` (every check with its
  note, the wall-hit table, the budget lines, the lag summaries).

## Files

| File | What |
|---|---|
| `run.mjs` | CLI: precheck, Hosts, the order (A1, B1, the eight, attached, B06, compaction), rows, report |
| `lib/http.mjs` | the two prefixes, the token header, `graph_write` envelopes, the call log |
| `lib/host.mjs` | start/close/restart a Host, the token read |
| `lib/flows.mjs` | the person's shared steps (open project, provider, cold start, explicit plan, cards, waits) and the scenario record |
| `lib/budget.mjs` | the token meter and the caps |
| `lib/lag.mjs` | the event-loop lag probe |
| `lib/report.mjs` | result.json, README, checks/* and the seven reason codes |
| `scenarios/*.mjs` | one module per scenario |
| `cells/*.mjs` | A1, B1, compaction, the attached Goals, B06 |
