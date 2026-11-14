#!/usr/bin/env node
// G6 acceptance driver (slice 9 group 6): the one final real-model run of the eight scenarios, the two 131072
// cells, the compaction scenario, the attached Goals (C-216, C-221, C-222) and the B06 cells, only through the
// real CLI (`node dist/app/main.js <workbench-config.json>`) and HTTP.
//   node scripts/acceptance/run.mjs <acceptance.config.json> [--only E05,A1,...] [--out <report dir>]
// `--only` is for the lead's dry run of a small scenario; only the final full run counts (slice-9-SPEC.md:798).
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { release, type } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Budget, BudgetStop } from './lib/budget.mjs';
import { broken, finalState, goalPhase, pauseGoal, projectSessions, Record, sessionHistory, sha256, sleep, TERMINAL,
  turnsOf } from './lib/flows.mjs';
import { startHost, workbenchConfig } from './lib/host.mjs';
import { Abort, Report } from './lib/report.mjs';
import a1 from './cells/a1.mjs';
import attached from './cells/attached.mjs';
import b06 from './cells/b06.mjs';
import b1 from './cells/b1.mjs';
import compaction from './cells/compaction.mjs';
import e05 from './scenarios/e05.mjs';
import e06 from './scenarios/e06.mjs';
import e08 from './scenarios/e08.mjs';
import e09 from './scenarios/e09.mjs';
import e12 from './scenarios/e12.mjs';
import intervention from './scenarios/int.mjs';
import iteration from './scenarios/iter.mjs';
import waiting from './scenarios/wait.mjs';

const TREE = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const SCENARIOS = [e05, e06, e08, e09, e12, iteration, intervention, waiting];
const AUTONOMY = ['after_plan_confirmation', 'every_step'];

function args(argv) {
  const out = { config: null, only: null, out: null };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--only') out.only = argv[++index].split(',');
    else if (argv[index] === '--out') out.out = argv[++index];
    else out.config = argv[index];
  }
  return out;
}

/** §5.2 item 1: every input the run needs, checked before any Host or model; a missing item stops here. */
function precheck(cfg, only) {
  const problems = [];
  if (!Array.isArray(cfg.scenarios) || cfg.scenarios.length === 0) problems.push('scenarios (the authorized list) is empty');
  const want = id => (cfg.scenarios ?? []).includes(id) && (only === null || only.includes(id));
  if (typeof cfg.authorization?.text !== 'string' || cfg.authorization.text.trim().length === 0) problems.push('authorization.text is empty');
  for (const name of ['total', 'perScenario']) {
    if (!Number.isSafeInteger(cfg.tokenCaps?.[name]) || cfg.tokenCaps[name] <= 0) problems.push(`tokenCaps.${name} is not a positive integer`);
  }
  const from = Date.parse(cfg.window?.from ?? '');
  const to = Date.parse(cfg.window?.to ?? '');
  if (Number.isNaN(from) || Number.isNaN(to) || from >= to) problems.push('window.from/window.to are not an ISO time range');
  else if (Date.now() < from || Date.now() > to) problems.push(`now is outside the window ${cfg.window.from} .. ${cfg.window.to}`);
  if (typeof cfg.runRoot !== 'string' || !isAbsolute(cfg.runRoot)) problems.push('runRoot is not an absolute path');
  for (const name of ['script', 'cdLine']) if (typeof cfg.host?.launcher?.[name] !== 'string') problems.push(`host.launcher.${name} is missing`);
  if (typeof cfg.host?.launcher?.script === 'string' && !existsSync(cfg.host.launcher.script)) problems.push(`no start script ${cfg.host.launcher.script}`);
  if (typeof cfg.host?.providerProbe !== 'string' || !existsSync(cfg.host.providerProbe)) problems.push('host.providerProbe is missing');
  if (!Array.isArray(cfg.host?.settingsModels) || cfg.host.settingsModels.length === 0) problems.push('host.settingsModels is empty');
  for (const cell of ['A1', 'B1']) if (want(cell) && typeof cfg.cells?.[cell]?.modelId !== 'string') problems.push(`cells.${cell}.modelId is not filled`);
  for (const id of [...SCENARIOS.map(scenario => scenario.id), 'attached', 'B06', 'compaction']) {
    if (want(id) && !AUTONOMY.includes(cfg.autonomy?.[id])) problems.push(`autonomy.${id} is not one of ${AUTONOMY.join('/')}`);
  }
  if (!existsSync(join(TREE, 'dist/app/main.js'))) problems.push('dist/app/main.js is missing (npm run build)');
  if (!existsSync(join(TREE, 'dist/app/public/workbench/Main.dc.html'))) problems.push('the built boards are missing (npm run build)');
  return problems;
}

function treeFacts() {
  const git = argv => execFileSync('git', argv, { cwd: TREE, encoding: 'utf8' }).trim();
  const diff = git(['diff', 'HEAD']);
  return {
    tree: git(['rev-parse', 'HEAD']), dirty: git(['status', '--porcelain']).length > 0,
    sourceDiffHash: diff.length === 0 ? null : sha256(diff).slice(0, 16),
    docsVersion: git(['log', '-1', '--format=%H', '--', 'docs']),
    kernelAdapter: `coding-agent ${JSON.parse(readFileSync(join(TREE, 'vendor/coding-agent/package.json'), 'utf8')).version}`,
    os: `${type()} ${release()}`, node: process.version,
  };
}

/** One `result.json` row: the spec's field groups only (`slice-9-SPEC.md:729-745`). */
function rowOf(ctx, def, rec, usage, final) {
  const model = rec.facts.model ?? {};
  const project = rec.facts.project ?? null;
  const goal = rec.chain.goal.at(-1) ?? null;
  const failure = rec.failure ?? {};
  return {
    scenario: def.id, checklistRows: def.rows, runId: ctx.runId, startedAt: rec.facts.startedAt, endedAt: rec.facts.endedAt,
    tree: ctx.facts.tree, sourceDiffHash: ctx.facts.sourceDiffHash, docsVersion: ctx.facts.docsVersion, promptPack: model.promptPack ?? null,
    os: ctx.facts.os, node: ctx.facts.node, kernelAdapter: ctx.facts.kernelAdapter, provider: model.provider ?? null,
    model: model.model ?? null, baseUrlHost: model.baseUrlHost ?? null, contextWindowTokens: model.contextWindowTokens ?? null,
    perResponseTokens: model.perResponseTokens ?? null, cumulativeTokenBudget: model.cumulativeTokenBudget ?? null,
    settingsHash: model.settingsHash ?? null, credentialConfigured: model.credentialConfigured ?? null,
    goalRef: goal?.ref ?? null, goalRevision: goal?.revision ?? null, autonomy: final?.autonomy ?? rec.autonomy,
    authorization: ctx.cfg.authorization.text, userCommand: rec.facts.userCommand ?? [],
    workspaceRoot: project?.root ?? null, gitHead: project?.initial.gitHead ?? null, dirty: project?.initial.dirty ?? null,
    snapshotHash: project?.initial.snapshotHash ?? null,
    cliConfigPath: rec.facts.cliConfigPath ?? null, httpSequence: rec.httpSequence,
    modelRequests: usage?.queryRequests ?? null, inputTokens: usage?.input ?? null, outputTokens: usage?.output ?? null,
    cachedInputTokens: usage?.cached ?? null, commandCalls: rec.httpSequence.filter(entry => entry.commandId !== null).length,
    reruns: 0,
    objectChain: rec.chain,
    artifactRefs: rec.facts.artifactRefs ?? [], checkRoundRef: rec.facts.checkRoundRef ?? null,
    roundOrdinal: rec.facts.roundOrdinal ?? null, checks: rec.checks(), evidenceRefs: rec.chain.evidence.map(entry => entry.ref),
    sourceVersions: rec.facts.sourceVersions ?? null,
    goalDisplay: final?.goalDisplay ?? null, taskPhase: final?.taskPhase ?? null, runOutcome: final?.runOutcome ?? null,
    lineState: final?.lineState ?? null, queueCounts: final?.queueCounts ?? null,
    failureClass: failure.failureClass ?? null, source: failure.source ?? null, kernelCode: failure.kernelCode ?? null,
    occurredAt: failure.occurredAt ?? null, autoRetry: failure.autoRetry ?? null, recoveryPath: failure.recoveryPath ?? null,
    uncovered: rec.uncovered(), verdict: rec.verdict(),
    logs: ['checks/http.jsonl', 'checks/model-calls.jsonl', 'checks/commands.txt', 'checks/notes.md'],
  };
}

const MINUTE = 60_000;
/** Lead ruling 11-14 on the drain bound: 30 min to settle, then cancel what is left, then 10 more minutes. */
const SETTLE_MS = 30 * MINUTE;
const AFTER_CANCEL_MS = 10 * MINUTE;

/** The Goals of every unit that live on this Host (each Goal with its own project: B06 has two). */
const goalsOn = (ctx, host) => [...ctx.units.values()].flatMap(rec => rec.goals.filter(goal => goal.project.host === host));

/** New work could not be shown stopped: no later unit runs; the Hosts still get their bounded last close. */
function unsettled(ctx, text, note) {
  note(text);
  if (ctx.stopAll === null) ctx.stopAll = new Abort('not-run', `new work could not be shown stopped: ${text}`);
  return false;
}

/** Read until the Goals read PAUSED or finished and nothing is running or pending in `where`, or the bound passes. */
async function settle(ctx, live, where, ms) {
  const deadline = Date.now() + ms;
  for (;;) {
    await ctx.budget.read();
    if (ctx.budget.stop?.cap === 'meter') return { ok: false, text: ctx.budget.stop.message, busy: null };
    const busy = ctx.budget.inFlight(where);
    const moving = [];
    for (const { project, ref } of live) {
      const phase = await goalPhase(project, ref);
      if (phase === null || !(TERMINAL.includes(phase) || phase === 'PAUSED')) moving.push(`${ref.goalId}:${phase ?? 'unreadable'}`);
    }
    if (busy.queries + busy.runs === 0 && moving.length === 0) return { ok: true, busy };
    if (Date.now() > deadline) {
      return { ok: false, busy, text: `after ${ms / MINUTE} min still Query ${busy.queries}, Work Run ${busy.runs}, Goals not paused ${moving.join(', ') || 'none'}` };
    }
    await sleep(15_000);
  }
}

/**
 * Cancel one in-flight item the way the person would: a Query with `queries/cancel`, a Work Run with a `cancel`
 * control (`controls/submit`, pinned to the Run, then `controls/deliver`). A refusal is also a wall row (http.mjs).
 */
async function cancelItem(item, why) {
  const client = item.host.client;
  if (item.kind === 'query') {
    const answer = await client.read('queries/cancel', item.scope, { queryRunRef: item.ref });
    return { ok: answer?.status === 'ready', text: `queries/cancel ${item.ref.queryJobId}: ${answer?.status} ${answer?.value?.stop ?? answer?.code ?? ''} ${answer?.reason ?? ''}` };
  }
  const submitted = await client.write('controls/submit', item.scope, { runRef: item.run.ref, kind: 'cancel', reason: `G6: ${why}` },
    [{ ref: item.run.ref, revision: item.run.revision }]);
  if (submitted?.status !== 'committed') return { ok: false, text: `controls/submit cancel ${item.run.ref.runId}: ${submitted?.status} ${submitted?.code ?? ''} ${submitted?.reason ?? ''}` };
  const delivered = await client.read('controls/deliver', item.scope, { intentRef: submitted.value.intent.ref });
  return { ok: delivered?.status !== 'rejected', text: `cancel ${item.run.ref.runId}: submit committed, deliver ${delivered?.status} ${delivered?.code ?? ''} ${delivered?.reason ?? ''}` };
}

/**
 * Stop new work (lead ruling 11-14 #5; second review #4; drain ruling): ask the Goals not finished to pause (the
 * pause takes effect at a safe point), wait up to 30 min until every such Goal reads PAUSED or finished and nothing
 * runs or is pending in `where`; if something still is, cancel it through the person's controls and wait up to 10
 * more minutes. A refused pause or cancel, an unreadable state, or work still there at the end means the work is not
 * shown stopped: `false`, and no later unit runs. Every cancel is noted. The caller then takes the full reading.
 */
async function drain(ctx, goals, where, why, note) {
  const live = goals.filter(({ project }) => ctx.hosts[project.host.name] === project.host);
  for (const { project, ref } of live) {
    const paused = await pauseGoal(project, ref, why);
    if (paused.text !== null) note(paused.text);
    if (!paused.ok) return unsettled(ctx, `${why}: ${paused.text}`, note);
  }
  const first = await settle(ctx, live, where, SETTLE_MS);
  if (first.ok) return true;
  if (first.busy === null) return unsettled(ctx, `${why}: ${first.text}`, note);
  note(`${why}: ${first.text}; cancelling what is left`);
  for (const item of first.busy.items) {
    const cancelled = await cancelItem(item, why);
    note(`${why}: ${cancelled.text}`);
    if (!cancelled.ok) return unsettled(ctx, `${why}: ${cancelled.text}`, note);
  }
  const second = await settle(ctx, live, where, AFTER_CANCEL_MS);
  return second.ok ? true : unsettled(ctx, `${why}: after the cancels, ${second.text}`, note);
}

/** Every tool refusal in the public histories of a unit's projects on open Hosts (second review #15). */
async function collectToolWalls(ctx, rec, host = null) {
  for (const project of rec.projects) {
    if (ctx.hosts[project.host.name] !== project.host || (host !== null && project.host !== host)) continue;
    for (const sessionRef of await projectSessions(project)) {
      for (const turn of turnsOf(await sessionHistory(project, sessionRef))) {
        for (const refusal of turn.refusals) ctx.report.toolWall(rec.id, refusal);
      }
    }
  }
}

/** Run one scenario or cell under its own budget slice; every stop becomes `uncovered (<code>)` on the rest. */
async function runUnit(ctx, def, body, { final = false } = {}) {
  const rec = new Record({ ...def, autonomy: def.autonomy ?? ctx.cfg.autonomy[def.group ?? def.id] ?? null });
  ctx.report.current = rec;
  ctx.units.set(def.id, rec);
  rec.facts.startedAt = new Date().toISOString();
  rec.facts.cliConfigPath = `${def.host ?? 'w-accept'}/workbench-config.json`;
  let stop;
  let begun = false;
  try {
    if (ctx.stopAll !== null) throw new Abort(ctx.stopAll.code, ctx.stopAll.message);
    if (Date.now() > Date.parse(ctx.cfg.window.to)) throw new Abort('not-run', 'the authorization window has ended');
    begun = true;
    await ctx.budget.begin(def.id);
    await body(rec);
  } catch (error) {
    stop = error instanceof Abort ? error : new Abort('not-run', `driver error: ${error.stack ?? error}`);
    rec.note(`stopped: ${stop.code}: ${stop.message}`);
  }
  // The row's end state is read before the unit's own Goals are paused below.
  const lastGoal = rec.goals.at(-1);
  let state = null;
  if (final && lastGoal !== undefined && ctx.hosts[lastGoal.project.host.name] === lastGoal.project.host) {
    state = await finalState(lastGoal.project, lastGoal.ref).catch(error => { rec.note(`final state read failed: ${error.message}`); return null; });
  }
  let usage = null;
  if (begun) {
    // Lead ruling 11-14 #2/#5: the unit's work stops with the unit and settles before the next unit starts.
    rec.facts.settled = await drain(ctx, rec.goals, { scopes: ctx.budget.scopesOf(def.id) }, `${def.id} ended`, text => rec.note(text));
    await collectToolWalls(ctx, rec);
    const ended = await ctx.budget.end();
    usage = ended.usage;
    if (ended.stop !== null && !(stop instanceof BudgetStop)) rec.note(`the budget stopped at this unit's final reading: ${ended.stop.message}`);
    // A meter stop counts as it stands after the final reading (a held one may have been lifted, 补充1); a total cap stays.
    const runStop = ended.stop?.cap === 'total' || ended.stop?.cap === 'meter' ? ended.stop : stop instanceof BudgetStop && stop.cap === 'total' ? stop : null;
    if (runStop !== null) ctx.stopAll = runStop;
  }
  rec.facts.endedAt = new Date().toISOString();
  rec.finish(stop);
  for (const host of Object.values(ctx.hosts)) host?.client.flush();
  ctx.report.current = null;
  return { rec, usage, final: state };
}

async function main() {
  const options = args(process.argv.slice(2));
  if (options.config === null) {
    console.error('usage: node scripts/acceptance/run.mjs <acceptance.config.json> [--only E05,A1,...] [--out <dir>]');
    process.exit(2);
  }
  const cfg = JSON.parse(readFileSync(options.config, 'utf8'));
  const problems = precheck(cfg, options.only);
  if (problems.length > 0) {
    console.error(`G6 precheck failed; no Host was started and no model was called:\n- ${problems.join('\n- ')}`);
    process.exit(2);
  }
  const date = new Date().toISOString().slice(0, 10);
  const outDir = resolve(options.out ?? cfg.reportDir ?? join(TREE, `docs/refactor/reviews/evidence/slice9-rerun-${date}`));
  const report = new Report(outDir);
  const ctx = {
    cfg, report, budget: new Budget(cfg.tokenCaps, report), runRoot: cfg.runRoot, tree: TREE, facts: treeFacts(),
    runId: `g6-${date}-${randomBytes(4).toString('hex')}`, hosts: {}, shared: {}, stopAll: null, units: new Map(),
    // The authorized list (config `scenarios`) and, for a dry run, `--only`.
    want: id => cfg.scenarios.includes(id) && (options.only === null || options.only.includes(id)),
  };
  mkdirSync(cfg.runRoot, { recursive: true });
  const startedAt = new Date().toISOString();
  report.command(`node scripts/acceptance/run.mjs ${options.config}${options.only ? ` --only ${options.only.join(',')}` : ''} (run ${ctx.runId})`);

  /** Start a world's Host and meter it. */
  ctx.start = async (name, config) => {
    const host = await startHost({ name, dir: join(cfg.runRoot, name), tree: TREE, launcher: cfg.host.launcher, report,
      config: config ?? workbenchConfig({ settingsModels: cfg.host.settingsModels }) });
    ctx.hosts[name] = host;
    ctx.budget.watch(host);
    return host;
  };
  /**
   * Normal close (SIGINT). A last close (no restart) first stops new work and drains (lead ruling 11-14 #5): pause the
   * Goals on this Host, wait (bounded) until nothing is in flight, take the full reading, then close. A restart is the
   * scenario's subject (a Run working, a wait open), so it only takes one full reading; the new Host over the same
   * ledger is metered on. `restart` brings the new Host up (after `downUntil`, if given); a close that did not end with
   * exit 0 fails `check` and stops the unit: never a second Host on that ledger (draft §8 row 1, :298).
   */
  ctx.close = async (name, { restart = false, downUntil = null, check } = {}) => {
    const host = ctx.hosts[name];
    if (!host) return { closed: null, host: null };
    if (restart) await ctx.budget.read();
    else {
      await drain(ctx, goalsOn(ctx, host), { host }, `${name} closes`, text => report.note(text));
      // The histories on this Host cannot be read after its last close: collect their tool refusals now.
      for (const rec of ctx.units.values()) await collectToolWalls(ctx, rec, host);
    }
    ctx.budget.unwatch(host);
    const closed = await host.close();
    ctx.hosts[name] = null;
    if (!closed.normal) {
      const text = `${name} did not close normally after SIGINT: ${closed.text}`;
      if (restart) throw broken(ctx, text, check);
      report.note(text);
    }
    if (!restart) return { closed: closed.text, host: null };
    while (downUntil !== null && Date.now() < downUntil) await sleep(5_000);
    return { closed: closed.text, host: await ctx.start(name) };
  };

  /** A/B, compaction, attached and B06 lines: each check, the recorded failure facts (spec :718) and the notes. */
  const cellOut = (def, rec) => {
    const failure = rec.failure === null ? [] : [`失败来源：failureClass=${rec.failure.failureClass}，source=${rec.failure.source}，kernelCode=${
      rec.failure.kernelCode}，occurredAt=${rec.failure.occurredAt}，autoRetry=${rec.failure.autoRetry}，recoveryPath=${rec.failure.recoveryPath}`];
    const lines = [...rec.checks().map(check => `${check.id}（${check.rows.join(', ')}）：${check.status}${check.code ? ` (${check.code})` : ''}。${check.note ?? ''}`),
      ...failure, ...rec.notes];
    return { id: def.id, verdict: rec.verdict(), lines };
  };

  try {
    // The two 131072 cells first: each on its own Host and ledger (WA/WB), small and independent of the others.
    for (const cell of [a1, b1]) {
      if (!ctx.want(cell.id)) continue;
      const { rec } = await runUnit(ctx, cell, rec => cell.run(ctx, rec));
      report.cells[cell.id] = cellOut(cell, rec);
    }
    // The eight scenarios on W-accept, in the spec's order; then the attached Goals and the B06 cells.
    const acceptNeeded = SCENARIOS.some(def => ctx.want(def.id)) || ctx.want('attached') || ctx.want('B06');
    if (acceptNeeded && ctx.stopAll === null) {
      try {
        await ctx.start('w-accept');
      } catch (error) {
        ctx.stopAll = error instanceof Abort ? error : new Abort('env-unavailable', `W-accept did not start: ${error.message}`);
      }
    }
    for (const def of SCENARIOS) {
      const autonomy = cfg.autonomy?.[def.id] ?? null;
      if (!ctx.want(def.id)) {
        const rec = new Record({ ...def, autonomy });
        rec.facts.startedAt = rec.facts.endedAt = new Date().toISOString();
        rec.finish(new Abort('not-run', 'not in the authorized scenario list, or not selected by --only'));
        report.rows.push(rowOf(ctx, def, rec, null, null));
        continue;
      }
      const { rec, usage, final } = await runUnit(ctx, { ...def, autonomy }, rec => def.run(ctx, rec), { final: true });
      report.rows.push(rowOf(ctx, def, rec, usage, final));
      report.rowNotes[def.id] = rec.notes;
    }
    if (ctx.want('attached')) {
      for (const cell of attached.cells) {
        const { rec } = await runUnit(ctx, cell, rec => cell.run(ctx, rec));
        report.attached.push(cellOut(cell, rec));
      }
    }
    if (ctx.want('B06')) {
      const { rec } = await runUnit(ctx, b06, rec => b06.run(ctx, rec));
      report.b06 = cellOut(b06, rec);
    }
    if (ctx.hosts['w-accept']) await ctx.close('w-accept');
    if (ctx.want('compaction')) {
      const { rec } = await runUnit(ctx, compaction, rec => compaction.run(ctx, rec));
      report.compaction = cellOut(compaction, rec);
    }
  } finally {
    for (const name of Object.keys(ctx.hosts)) {
      if (ctx.hosts[name]) await ctx.close(name).catch(error => report.note(`closing ${name} failed: ${error.message}`));
    }
    // Each row's usage is its unit's attributed total after every Host's last reading (lead ruling 11-14 #2).
    for (const row of report.rows) {
      const usage = ctx.budget.usedBy(row.scenario);
      if (usage === null) continue;
      Object.assign(row, { modelRequests: usage.queryRequests, inputTokens: usage.input, outputTokens: usage.output, cachedInputTokens: usage.cached });
    }
    report.budget = { lines: ctx.budget.lines() };
    if (ctx.stopAll !== null) report.note(`the run stopped early: ${ctx.stopAll.message}`);
    report.note('§6.2：Query 在“进入中”被中止由 qent 关成 not_entered（aborted_before_entry）；`queries/cancel` 在 entering 窗口仍回 not_running，本次不测、不判场景失败。');
    report.writeAll({ date, runId: ctx.runId, tree: ctx.facts.tree, dirty: ctx.facts.dirty, startedAt,
      endedAt: new Date().toISOString(), authorization: cfg.authorization.text });
    console.log(`G6 report: ${outDir}`);
  }
}

await main();
