// The person's public steps every scenario shares: open a project directory, pick the provider once per
// scenario, the cold start (request -> Goal card -> confirm -> adopt), a new Goal in an initialized project
// (card -> confirm -> select an idea -> request candidate -> apply), the explicit Goal/plan path, answering
// cards, starting the driver and waiting. Only CLI + HTTP: no TS fixture, no SQLite, no `runtimeProvider`.
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { scopeKey } from './budget.mjs';
import { committed, newId, ready } from './http.mjs';
import { Abort } from './report.mjs';

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export const sha256 = text => createHash('sha256').update(text).digest('hex');
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
export const TERMINAL = ['COMPLETED', 'FAILED', 'CANCELLED', 'ACCEPTED_PARTIAL'];
const MINUTE = 60_000;
/**
 * The Task stops only a person continues: the UI's 要决定 set (`src/ui/adapters/goals.ts:185` TASK_DECIDE_STOPS),
 * copied here because the driver never imports UI code.
 */
const TASK_DECIDE_STOPS = new Set(['gate_needs_fix', 'auto_rework_cap_reached', 'no_new_basis', 'verification_uncovered',
  'unknown_outcome']);
/** G7 W3(b): above the longest wait a scenario sets (`wait.mjs` LONG_DEADLINE_MS, 30 min) plus one Host heartbeat. */
const STALL_MS = 32 * MINUTE;

/** A wait that ran out or ended early: its check is already judged `fail`; the unit stops unless the caller takes it (`orNull`). */
class WaitTimeout extends Abort {
  constructor(text) {
    super('not-run', text);
  }
}

/** An optional wait: only its own timeout becomes null; a budget stop, the window or anything else goes on up. */
export const orNull = promise => promise.catch(error => {
  if (error instanceof WaitTimeout) return null;
  throw error;
});

/**
 * An existing capability that ran and did the wrong thing, or did not happen in time (lead rulings Q1, 11-14 #6/#12):
 * the check it was for (`check`, else the unit's next unjudged one) is `fail` with the platform's own words; the
 * returned stop leaves the checks after it `uncovered (not-run)`. A missing entry or an environment cause with
 * evidence stays an `Abort` with its own code.
 */
export function broken(ctx, text, check) {
  const rec = ctx.report.current;
  const target = check ?? rec?.planned.find(entry => !rec.results.has(entry.id))?.id;
  if (rec !== null && target !== undefined) rec.fail(target, `the platform did not do it: ${text}`);
  return new Abort('not-run', text);
}

const said = body => `${body?.status ?? 'no answer'} ${body?.code ?? ''} ${body?.reason ?? ''}`.trim();

/** One scenario's (or cell's) record: planned checks, their three-word results, the object chain and notes. */
export class Record {
  constructor({ id, rows, checks, autonomy }) {
    this.id = id;
    this.rows = rows;
    this.autonomy = autonomy ?? null;
    this.planned = checks;
    this.results = new Map();
    this.httpSequence = [];
    this.notes = [];
    this.facts = {};
    this.failure = null;
    this.chain = { goal: [], plan: [], task: [], run: [], attempt: [], session: [], message: [], card: [], evidence: [] };
    /** Every Goal this unit created, with the project it lives in (a unit may have two, B06). */
    this.goals = [];
    /** Every project this unit worked in (their histories feed the wall table). */
    this.projects = [];
  }

  /** A check judged `fail` stays failed; a later judgement only adds to the notes. */
  set(id, status, note, code) {
    if (!this.planned.some(check => check.id === id)) throw new Error(`${this.id}: unplanned check ${id}`);
    if (this.results.get(id)?.status === 'fail') { this.notes.push(`${id}: later read ${status}: ${note}`); return; }
    this.results.set(id, { status, note, ...(code === undefined ? {} : { code }) });
  }

  ownGoal(project, ref, revision = null) {
    this.link('goal', ref, revision);
    if (!this.goals.some(entry => same(entry.ref, ref))) this.goals.push({ project, ref });
  }
  pass(id, note) { this.set(id, 'pass', note); }
  fail(id, note) { this.set(id, 'fail', note); }
  uncover(id, code, note) { this.set(id, 'uncovered', note, code); }
  /** true → pass, false → fail; the note says what was read. */
  check(id, ok, note) { this.set(id, ok ? 'pass' : 'fail', note); }
  note(text) { this.notes.push(text); }

  link(kind, ref, revision = null) {
    if (ref === null || ref === undefined) return;
    if (!this.chain[kind].some(entry => same(entry.ref, ref))) this.chain[kind].push({ ref, revision });
  }

  /** Every planned check not reached gets the stop's reason code (`not-run` when the scenario simply ended). */
  finish(stop) {
    for (const check of this.planned) {
      if (!this.results.has(check.id)) {
        this.results.set(check.id, { status: 'uncovered', code: stop?.code ?? 'not-run',
          note: stop === undefined ? 'not reached: an earlier check of this unit failed or returned first'
            : `stopped before this check: ${stop.message}` });
      }
    }
  }

  checks() {
    return this.planned.map(check => ({ id: check.id, rows: check.rows, text: check.text, ...this.results.get(check.id) }));
  }

  /** required failed → fail; none failed but one not run → uncovered; all ran and passed → pass (spec :727). */
  verdict() {
    const statuses = this.checks().map(check => check.status);
    if (statuses.includes('fail')) return 'fail';
    if (statuses.includes('uncovered')) return 'uncovered';
    return 'pass';
  }

  uncovered() {
    return this.checks().filter(check => check.status === 'uncovered')
      .map(check => ({ item: `${check.id}: ${check.text}`, code: check.code, entry: check.note ?? null }));
  }
}

// ---------------------------------------------------------------------------- projects and the provider

function git(ctx, cwd, args) {
  const out = execFileSync('git', args, { cwd, encoding: 'utf8' });
  ctx.report.command(`git ${args.join(' ')} (in ${cwd}) -> 0`);
  return out.trim();
}

export function writeFiles(root, files) {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
}

/** The project's initial files version (spec §5.6 "初始文件"): head, dirty and a snapshot hash. */
export function gitFacts(ctx, root) {
  const head = git(ctx, root, ['rev-parse', 'HEAD']);
  const status = git(ctx, root, ['status', '--porcelain']);
  return { gitHead: head, dirty: status.length > 0, snapshotHash: sha256(`${git(ctx, root, ['ls-files', '-s'])}\n${status}`) };
}

/** A new project directory with the scenario's seed files (a Git repository unless `git:false`, for B06-W5),
 *  opened through settings `workspaces/open`. */
export async function openProject(ctx, host, name, files, { git: useGit = true } = {}) {
  const root = join(host.dir, 'projects', name);
  mkdirSync(root, { recursive: true });
  writeFiles(root, files);
  let initial = { gitHead: null, dirty: null, snapshotHash: sha256(JSON.stringify(files)) };
  if (useGit) {
    git(ctx, root, ['init', '-q', '-b', 'main']);
    git(ctx, root, ['config', 'user.email', 'g6@example.invalid']);
    git(ctx, root, ['config', 'user.name', 'g6']);
    git(ctx, root, ['add', '-A']);
    git(ctx, root, ['commit', '-q', '-m', `${name}: initial files`]);
    initial = gitFacts(ctx, root);
  }
  const opened = await host.client.settings('workspaces/open', { path: root, name: `g6-${name}`, writeAllowed: true, commandsAllowed: true });
  if (opened?.status !== 'ready') throw broken(ctx, `settings/workspaces/open: ${said(opened)}`);
  // Everything counted from this project belongs to the unit that opened it (lead ruling 11-14 #2).
  ctx.budget.own(opened.value.scope, ctx.report.current?.id ?? '-');
  const project = { name, root, scope: opened.value.scope, initial, host };
  ctx.report.current?.projects.push(project);
  return project;
}

/**
 * The provider for one scenario, chosen once at its start and never switched (next1113c 14:0x §9.6): a fixed
 * model id (A1/B1) or the existing probe (`impl/smoke/srr/smoke-route.sh`, which reads keys in its own process
 * and prints only the model id). Then the settings pair `models/save` (re-saving the seeded entry with its own
 * fields, so its key variable is kept, `host-settings.ts:1089`) and `models/select`.
 */
export async function chooseModel(ctx, host, project, fixedModelId = null) {
  let modelId = fixedModelId;
  if (modelId === null) {
    const probe = spawnSync('bash', [ctx.cfg.host.providerProbe], { encoding: 'utf8', timeout: 5 * MINUTE });
    modelId = (probe.stdout ?? '').trim().split('\n').pop() ?? '';
    // Only the exit code and the chosen id: the probe's stderr can quote a provider error body (smoke-route.sh:20).
    ctx.report.command(`bash ${ctx.cfg.host.providerProbe} -> ${probe.status} (${modelId || 'no model'})`);
    if (probe.status !== 0 || modelId.length === 0) throw new Abort('env-unavailable', 'the provider probe found no answering model');
  }
  const snapshot = ready(await host.client.settings('snapshot', {}));
  const entry = snapshot?.models.find(model => model.id === modelId);
  if (entry === undefined) throw new Abort('entry-missing', `the Host settings have no model ${modelId}`);
  if (!entry.credentialConfigured) throw new Abort('env-unavailable', `${modelId} has no key in the Host environment`);
  const resave = { id: entry.id, label: entry.label, provider: entry.provider, model: entry.model };
  // The snapshot shows a missing baseUrl as '' (`host-settings.ts:925`), which `models/save` refuses; send only set fields.
  for (const field of ['baseUrl', 'thinking', 'reasoningEffort', 'promptPack', 'reasoningReplay']) {
    if (typeof entry[field] === 'string' && entry[field].length > 0) resave[field] = entry[field];
  }
  const saved = await host.client.settings('models/save', resave);
  if (saved?.status !== 'ready') throw broken(ctx, `settings/models/save: ${said(saved)}`);
  const selected = await host.client.settings('models/select', { scope: project.scope, modelId });
  if (selected?.status !== 'ready') throw broken(ctx, `settings/models/select: ${said(selected)}`);
  const profiles = await profilesOf(host, project.scope);
  const work = profiles.find(profile => profile.sessionRole?.templateId === 'local-workbench') ?? profiles[0];
  return {
    modelId, provider: entry.provider, model: entry.model,
    baseUrlHost: resave.baseUrl === undefined ? null : new URL(resave.baseUrl).host,
    credentialConfigured: entry.credentialConfigured, promptPack: entry.promptPack ?? null,
    contextWindowTokens: work?.runtimeBudget?.contextWindowTokens ?? null,
    perResponseTokens: work?.runtimeBudget?.perResponseTokens ?? null,
    cumulativeTokenBudget: work === undefined ? null : (work.runtimeBudget.outputTokens ?? 'null = 不设上限'),
    settingsHash: sha256(JSON.stringify(selected.value)).slice(0, 16),
  };
}

async function profilesOf(host, scope) {
  const boot = await host.client.get('/api/real/core/bootstrap');
  return (boot?.execution?.queryProfiles ?? []).filter(profile => same(profile.scope, scope));
}

// ---------------------------------------------------------------------------- waiting, cards and the driver

/**
 * Poll `read` until `done(value)`; every pass ticks the budget, so a crossed cap stops the wait. A wait that runs out
 * was waiting for the platform to do something, so it judges the waited-for check `fail` (lead ruling Q1, 121-111:
 * nothing waits forever): `check` names it, else the unit's next unjudged check in plan order. The note names what
 * was waited for and how long; the unit then stops and the checks after it are `uncovered (not-run)`. Environment
 * causes (provider unreachable or refusing, the window ending) stay `uncovered` through their own `Abort`.
 * `ended(value)` (G7 W3) names a reason the platform can no longer finish by itself; the wait then ends at once and is
 * judged the same way, with that reason as the note.
 */
export async function waitFor(ctx, what, read, done, { timeoutMs, everyMs = 10_000, check, ended = () => null }) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await ctx.budget.tick();
    const value = await read();
    if (done(value)) return value;
    const early = ended(value);
    if (early !== null || Date.now() > deadline) {
      const text = early ?? `timed out after ${Math.round(timeoutMs / MINUTE)} min waiting for ${what}`;
      broken(ctx, text, check);
      throw new WaitTimeout(text);
    }
    await sleep(everyMs);
  }
}

/** The person approves: the option whose effect is `apply`, else the first option. */
export const approve = card => {
  const option = card.options.find(entry => entry.effect === 'apply') ?? card.options[0];
  return option === undefined ? null : { kind: 'option', optionId: option.id };
};

/** `decisions/answer` with exactly the card's pins (plus the message pin for a message card). */
export async function answerCard(ctx, project, card, selection, text = '', rec = null) {
  let pins = card.source.pins;
  if (card.source.kind === 'message') {
    // A message card names its message in `source.key` (`goal-decisions.ts:106-112`); its pin is read, not guessed.
    const messageRef = JSON.parse(card.source.key).messageRef;
    const message = ready(await project.host.client.read('messages/read', project.scope, messageRef));
    if (message === null) return false;
    pins = [{ ref: messageRef, revision: message.revision }, ...pins];
  }
  const answer = await project.host.client.write('decisions/answer', project.scope,
    { source: card.source, selection, text, annotations: [] }, pins);
  rec?.link('card', card.source, null);
  // The committed receipt itself (truthy), so a caller can follow what the decision adopted; false otherwise.
  return answer?.status === 'ready' && answer.value?.answer?.status === 'committed' ? answer.value : false;
}

export async function waitingCards(project, goalRef = null) {
  const queue = ready(await project.host.client.read('decisions/queue', project.scope, {
    workspace: project.scope, ...(goalRef === null ? {} : { goalRef }), sections: ['waiting_answer'], page: { limit: 50 } }));
  return queue?.waitingAnswer ?? [];
}

/**
 * Wait for the Goal to reach one of `until` (default: the terminal phases), answering waiting cards the way
 * `answer(card)` says (default: approve). `onPoll(display)` lets a scenario read what it watches meanwhile. The wait
 * ends early (G7 W3, `endedEarly`) when the platform shows it cannot go on by itself.
 */
export async function waitGoal(ctx, project, goalRef, { until = TERMINAL, timeoutMs, answer = approve, onPoll, rec = null, check, committedAnswers = [] }) {
  const answered = new Set();
  const quiet = { seen: null, since: Date.now() };
  let ended = null;
  return waitFor(ctx, `${goalRef.goalId} to reach ${until.join('/')}`, async () => {
    const display = ready(await project.host.client.read('goals/display', project.scope, { goalRef }));
    const queue = ready(await project.host.client.read('decisions/queue', project.scope, { workspace: project.scope, goalRef,
      sections: ['waiting_answer', 'answered_pending_application'], page: { limit: 50 } }));
    // The cards the person still has in hand: answered and not yet applied, or waiting and taken by `answer`.
    let open = queue?.answeredPendingApplication?.length ?? 0;
    for (const card of queue?.waitingAnswer ?? []) {
      if (answered.has(card.cardKey)) { open += 1; continue; }
      const selection = answer(card);
      if (selection === null) continue;
      open += 1;
      // Only a committed answer counts as the person's decision (`committedAnswers` collects them with the time).
      const receipt = await answerCard(ctx, project, card, selection, '', rec);
      if (receipt) {
        answered.add(card.cardKey);
        committedAnswers.push({ card, at: new Date().toISOString(), answer: receipt });
      }
    }
    if (rec?.autonomy === 'every_step') await reviewNodes(project, goalRef, rec);
    if (onPoll !== undefined) await onPoll(display);
    ended = await endedEarly(ctx, project, goalRef, { display, queue, open, quiet });
    return display;
  }, display => display !== null && until.includes(display.display.phase), { timeoutMs, check, ended: () => ended });
}

/**
 * G7 W3: the reason a Goal wait ends before its deadline, or null. Judged like a wait that ran out (G6F R1: the
 * complete record proves the step was not reached; the checks after it are `uncovered (not-run)`). A poll whose
 * display or queue did not answer is no evidence either way.
 * (a) The Goal's own headline says a person decides on a Task stop of the UI's 要决定 set (the GOAL-23/GOAL-30 row:
 *     phase NEEDS_DECISION, a required Task, no live Run, no automatic rework pending, `goal-machine.ts:1176-1194`),
 *     and the queue holds no card the person still has in hand.
 * (b) Nothing public changed (display, cards) for STALL_MS and the meter's last complete reading has no Query and no
 *     Work Run in flight in the project. The display's `sourceCursor` is the ledger-wide watermark (any commit in the
 *     project moves it), so it is not compared. The reason names the last phase, cause and driver wait reason seen.
 */
async function endedEarly(ctx, project, goalRef, { display, queue, open, quiet }) {
  if (display === null || queue === null) return null;
  const { phase, cause } = display.display;
  if (phase === 'NEEDS_DECISION' && TASK_DECIDE_STOPS.has(cause?.code) && open === 0) {
    return `the platform stopped: ${cause.code} on ${cause.taskId}`;
  }
  const { sourceCursor: _watermark, ...goalFacts } = display;
  const seen = JSON.stringify({ display: goalFacts, cards: [...queue.waitingAnswer, ...queue.answeredPendingApplication]
    .map(card => [card.cardKey, card.state]) });
  if (seen !== quiet.seen) {
    quiet.seen = seen;
    quiet.since = Date.now();
    return null;
  }
  if (Date.now() - quiet.since < STALL_MS) return null;
  const busy = ctx.budget.inFlight({ scopes: [scopeKey(project.scope)] });
  if (busy.queries > 0 || busy.runs > 0) return null;
  const driver = ready(await project.host.client.read('workflow/driver-read', project.scope, { goalRef }));
  return `stalled: no change for ${Math.floor((Date.now() - quiet.since) / MINUTE)} min, nothing in flight (last seen: goal phase ${
    phase}, cause ${cause?.code ?? 'none'}; driver ${driver?.state ?? 'unread'}, wait reason ${driver?.reason ?? 'none'})`;
}

/**
 * Node-level review under `every_step` (decision 121-45; `workflow.ts:2733-2741`): a completed node waits for the
 * person's `nodes/commit` before the Goal takes the next one. The person reviews what `goals/delivery` shows
 * (`delivery-read.ts:72-85`: the node's files and blobs) and commits them, or acknowledges a node without files.
 */
export async function reviewNodes(project, goalRef, rec = null) {
  const delivery = ready(await project.host.client.read('goals/delivery', project.scope, { goalRef }));
  for (const row of (delivery?.nodes ?? []).filter(entry => entry.pending)) {
    const goal = ready(await project.host.client.read('goals/read', project.scope, goalRef));
    if (goal === null) return;
    const withFiles = row.files.length > 0;
    const committedNode = await project.host.client.write('nodes/commit', project.scope, {
      goalRef, taskRef: { projectId: goalRef.projectId, goalId: goalRef.goalId, taskId: row.task.taskId },
      decision: withFiles ? 'commit' : 'acknowledge', message: withFiles ? `G6: ${row.task.title}` : null,
      reviewed: row.files.map(file => ({ path: file.path, blob: file.blob })),
    }, [{ ref: goalRef, revision: goal.goal.revision },
      { ref: { aggregateType: 'TaskReduction', projectId: goalRef.projectId, goalId: goalRef.goalId, taskId: row.task.taskId },
        revision: row.reduction?.revision ?? 0 }]);
    rec?.note(`node review ${row.task.taskId} (${row.files.map(file => file.path).join(', ') || 'no files'}): ${said(committedNode)}`);
  }
}

/** `workflow/driver-start` with this workspace's Query profiles (`collaboration-driver.ts:100-103`). */
export async function driverStart(ctx, project, goalRef, { flowId, taskId, sessionHint = null }) {
  const ids = (await profilesOf(project.host, project.scope)).map(profile => profile.id);
  return project.host.client.read('workflow/driver-start', project.scope, {
    advance: { schemaVersion: 1, goalRef, flowId, sessionHint, kind: 'select_work', ...(taskId === undefined ? {} : { taskId }) },
    queryProfileIds: ids,
  });
}

// ---------------------------------------------------------------------------- the cold start

export async function submitRequest(project, text, extra = {}) {
  return project.host.client.command('requests/submit', project.scope,
    { commandId: newId('submit'), goalId: null, text, continues: null, recipient: null, ...extra });
}

export async function readRequest(project, requestRoot) {
  return ready(await project.host.client.read('requests/read', project.scope, { requestRoot }));
}

const settled = round => round.status === 'ended' || round.status === 'unknown';

/** Wait until every round of the request has settled; returns the request view. */
export async function waitRequest(ctx, project, requestRoot, timeoutMs = 30 * MINUTE) {
  return waitFor(ctx, 'the request rounds to settle', () => readRequest(project, requestRoot),
    view => view !== null && view.rounds.length > 0 && view.rounds.every(settled), { timeoutMs });
}

/**
 * The cold start (the smoke's proven path, `impl/smoke/srr/r04-r07`): `requests/submit` → the secretary's
 * Goal card draft → `goals/confirm-draft` → `initialization/adopt` (architecture, policy, checks and the first
 * Plan in one adoption; the Host starts the Goal driver itself, `host.ts:4094-4101`). A round that answers with
 * ideas gets `requests/select-idea` of the first idea; a round without a draft gets one plain follow-up.
 */
export async function coldStart(ctx, project, text, rec) {
  const submitted = await submitRequest(project, text);
  if (submitted?.status !== 'queued') throw broken(ctx, `requests/submit: ${said(submitted)}`);
  const requestRoot = submitted.requestRoot;
  rec.link('session', submitted.secretary);
  let view = await waitRequest(ctx, project, requestRoot);
  for (let turn = 0; turn < 3; turn += 1) {
    const latest = view.rounds.at(-1);
    if (latest.goalCardDrafts.length > 0) break;
    if (latest.closeCode !== null && latest.closeCode !== undefined) {
      rec.failure = { failureClass: 'query_closed', source: 'model_service', kernelCode: latest.closeCode,
        occurredAt: latest.since ?? null, autoRetry: false, recoveryPath: 'follow-up request' };
    }
    const next = latest.ideas.length >= 2
      ? await project.host.client.command('requests/select-idea', project.scope, { commandId: newId('idea'), round: latest.ref, index: 0 })
      : await submitRequest(project, '按你的判断直接给出目标卡和首个方案，不用再问我。', { continues: requestRoot });
    if (next?.status !== 'queued') throw broken(ctx, `request follow-up: ${said(next)}`);
    view = await waitRequest(ctx, project, requestRoot);
  }
  const round = [...view.rounds].reverse().find(entry => entry.goalCardDrafts.length > 0);
  if (round === undefined) {
    throw broken(ctx, `the secretary gave no Goal card draft after three rounds (closes: ${view.rounds.map(entry => entry.closeCode ?? 'ok').join(', ')})`);
  }
  const { draft, binding, goalsBeforeConfirm } = await confirmCard(ctx, project, round, rec);
  const adopted = await adoptBinding(ctx, project, binding);
  rec.link('plan', adopted.receipt.plan, null);
  await settleAutonomy(ctx, project, binding.goalRef, rec);
  return { goalRef: binding.goalRef, requestRoot, round, draft, binding, plan: adopted.receipt.plan, goalsBeforeConfirm };
}

/** The person confirms the round's first Goal card draft (`goals/confirm-draft`); a refusal is the platform's on `check`. */
async function confirmCard(ctx, project, round, rec, check) {
  const draft = round.goalCardDrafts[0];
  // What existed before the person's confirm: the draft must not have become a Goal by itself (C-46).
  const goalsBeforeConfirm = (ready(await project.host.client.read('goals/list', project.scope, { workspace: project.scope }))?.goals ?? [])
    .map(goal => goal.ref.goalId);
  const confirmed = await project.host.client.command('goals/confirm-draft', project.scope,
    { commandId: newId('confirm'), round: round.ref, index: draft.index });
  const binding = committed(confirmed)?.binding;
  if (binding === undefined) throw broken(ctx, `goals/confirm-draft: ${said(confirmed)}`, check);
  rec.ownGoal(project, binding.goalRef, binding.goalRevision);
  return { draft, binding, goalsBeforeConfirm };
}

/** `initialization/adopt` from a confirmed binding; a `pending` answer is retried with the same command (`:55`). */
export async function adoptBinding(ctx, project, binding) {
  const input = { commandId: newId('adopt'), source: { kind: 'binding', answerRef: binding.answerRef, draftIndex: binding.draftIndex },
    expectedAnswerDigest: binding.answerDigest, expectedGoal: { ref: binding.goalRef, revision: binding.goalRevision } };
  let adopted = null;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    adopted = await project.host.client.command('initialization/adopt', project.scope, input);
    if (adopted?.status !== 'pending' || adopted.retryable === false) break;
    await ctx.budget.tick();
    await sleep(10_000);
  }
  if (adopted?.status !== 'committed') {
    throw broken(ctx, `initialization/adopt: ${adopted?.status} ${adopted?.code ?? adopted?.stage ?? ''} ${adopted?.reason ?? JSON.stringify(adopted?.failure ?? null)}`);
  }
  return adopted;
}

/**
 * The scenario's ruled autonomy (next1113c 14:0x §9.1). A confirmed Goal is born with the draft's level (C-133a,
 * `goal-confirm.ts:54`), and setting it between confirm and adopt makes the binding stale (C-133a), so it is set
 * right after the adoption when the draft chose otherwise; that change applies to later actions only (C-126).
 */
export async function settleAutonomy(ctx, project, goalRef, rec) {
  const goal = ready(await project.host.client.read('goals/read', project.scope, goalRef));
  rec.facts.draftAutonomy = goal?.goal?.settings?.autonomy ?? null;
  if (rec.autonomy === null || goal === null || goal.goal.settings.autonomy === rec.autonomy) return;
  const set = await project.host.client.write('goals/settings/set', project.scope,
    { goalRef, autonomy: rec.autonomy, waitForGoalRef: null }, [{ ref: goalRef, revision: goal.goal.revision }]);
  rec.note(`${goalRef.goalId}: the draft chose ${goal.goal.settings.autonomy}; set to ${rec.autonomy} after adoption (${set?.status} ${set?.code ?? ''})`);
}

// ---------------------------------------------------------------------------- a new Goal in an initialized project

const CARD_ASK = '这是一项新工作：请先给出它的目标卡（单独成一个新目标），再给 2–3 个做法思路。';
const IDEAS_ASK = '目标卡我确认了。请给 2–3 个做法思路，我来选一个。';
/** G7 W5: the person's fixed answer to a plan round's questions. */
export const PLAN_QUESTIONS_ANSWER = '按你推荐的做法；没提到的按最简单的处理';
/** The request's latest answered round; confirm and select-idea only take that one (`request-service.ts:780-783`). */
const latestAnswered = view => [...view.rounds].reverse().find(round => round.answer !== null);
/** The round's saved answer is the plan round's questions (`needs_decision`, `answer-tools.ts:262-266`). */
const askedQuestions = round => {
  try { return JSON.parse(round?.answer ?? 'null')?.kind === 'needs_decision'; } catch { return false; }
};

/**
 * The person's follow-ups on one request while `needed(view)` holds, at most `max`: each is `text` on the same
 * request (`continues`, plus `extra`), then the rounds settle. Returns the last view and how many were sent; a refused
 * follow-up is the platform's failure on `check`.
 */
async function followUps(ctx, project, requestRoot, view, { needed, text, max, extra = {}, what, check, onSent }) {
  let asks = 0;
  for (; asks < max && needed(view); asks += 1) {
    const sent = await submitRequest(project, text, { continues: requestRoot, ...extra });
    if (sent?.status !== 'queued') throw broken(ctx, `request follow-up ${what}: ${said(sent)}`, check);
    onSent?.();
    view = await waitRequest(ctx, project, requestRoot);
  }
  return { view, asks };
}

/**
 * G7 W5: a plan round that asked the person questions (instead of writing the candidate) is answered the way the
 * request thread takes it, at most `max` times (default 2): one follow-up with `PLAN_QUESTIONS_ANSWER`, recorded in
 * `userCommand`. A request round's question cards resume nothing (`plan-readers.ts:2729`: only intervention rounds
 * form a group), so the person's channel is the request itself. Returns the request view after the last answer.
 */
export async function answerPlanQuestions(ctx, project, requestRoot, view, rec, { max = 2, extra = {}, check } = {}) {
  const answered = await followUps(ctx, project, requestRoot, view, { needed: current => askedQuestions(current.rounds.at(-1)),
    text: PLAN_QUESTIONS_ANSWER, max, extra, what: "answering the plan round's questions", check,
    onSent: () => { rec.facts.userCommand.push(PLAN_QUESTIONS_ANSWER); } });
  if (answered.asks > 0) rec.note(`the plan round asked questions; the person answered ${answered.asks} time(s) (cap ${max})`);
  return answered.view;
}

/**
 * The confirmed Goal card of a no-goal request in an initialized project (MVP-BEHAVIOR.md:343; G6F F3, F4 E12): the
 * latest answered round's card, after at most `maxCardFollowups` follow-ups asking for one (default 3, the cold start's
 * count; E12 passes 1, G6F R3), without the cold start's idea selection (an idea selected before the card is confirmed
 * makes every later round of the request a plan round with no goal), then `goals/confirm-draft`. No card or a refused
 * confirm is the platform's failure on `check`.
 */
export async function confirmNewGoal(ctx, project, requestRoot, rec, check, maxCardFollowups = 3) {
  const { view, asks } = await followUps(ctx, project, requestRoot, await waitRequest(ctx, project, requestRoot), {
    needed: current => !(latestAnswered(current)?.goalCardDrafts.length > 0), text: CARD_ASK, max: maxCardFollowups,
    what: 'asking for a Goal card', check });
  const round = latestAnswered(view);
  if (round === undefined || round.goalCardDrafts.length === 0) {
    throw broken(ctx, `the secretary gave no Goal card draft after ${asks} follow-up(s) asking for one (cap ${maxCardFollowups}; closes: ${
      view.rounds.map(entry => entry.closeCode ?? 'ok').join(', ')})`, check);
  }
  const { draft, binding, goalsBeforeConfirm } = await confirmCard(ctx, project, round, rec, check);
  return { goalRef: binding.goalRef, requestRoot, view, round, draft, binding, goalsBeforeConfirm };
}

/**
 * A new Goal in an initialized project, on the same request (MVP-BEHAVIOR.md:343; G6F F3): the confirmed card
 * (`confirmNewGoal`) → `requests/select-idea` of the first idea (one follow-up asks for ideas when the card round has
 * none) → the plan round writes the new Goal's request candidate (F3a) → the person's `plans/apply`. Never
 * `initialization/adopt` (an initialized project's rounds are `semantic_query`, `initial-planning-parse.ts:26` refuses
 * their answer) and never `plans/propose`. Starting the Goal is the caller's `workflow/driver-start`.
 */
export async function newGoalInProject(ctx, project, requestRoot, rec, check, maxCardFollowups = 3) {
  const confirmed = await confirmNewGoal(ctx, project, requestRoot, rec, check, maxCardFollowups);
  const goalRef = confirmed.goalRef;
  let view = confirmed.view;
  if (latestAnswered(view).ideas.length === 0) {
    const asked = await submitRequest(project, IDEAS_ASK, { continues: requestRoot });
    if (asked?.status !== 'queued') throw broken(ctx, `request follow-up asking for ideas: ${said(asked)}`, check);
    view = await waitRequest(ctx, project, requestRoot);
  }
  const ideasRound = latestAnswered(view);
  if (ideasRound === undefined || ideasRound.ideas.length === 0) {
    throw broken(ctx, `the secretary gave no idea to select after ${goalRef.goalId} was confirmed`, check);
  }
  const picked = await project.host.client.command('requests/select-idea', project.scope,
    { commandId: newId('idea'), round: ideasRound.ref, index: 0 });
  if (picked?.status !== 'queued') throw broken(ctx, `requests/select-idea: ${said(picked)}`, check);
  rec.note(`${goalRef.goalId}: the person selected idea 1 of ${ideasRound.ideas.length} (${ideasRound.ideas[0].title})`);
  await waitRequest(ctx, project, requestRoot);
  const candidate = await waitFor(ctx, `the request candidate of ${goalRef.goalId}`, async () =>
    ready(await project.host.client.read('plans/request-candidate', project.scope, { goalRef, requestRef: requestRoot })),
  value => value?.head !== null && value?.head !== undefined && value.status === 'candidate', { timeoutMs: 30 * MINUTE, check });
  const goal = ready(await project.host.client.read('goals/read', project.scope, goalRef));
  if (goal === null) throw broken(ctx, `goals/read of ${goalRef.goalId} did not answer before plans/apply`, check);
  const applied = await project.host.client.write('plans/apply', project.scope,
    { proposalRef: candidate.head.ref, expectedProposalRevision: candidate.head.revision, decisionRefs: [] },
    [{ ref: goalRef, revision: goal.goal.revision }]);
  const plan = committed(applied);
  if (plan === null) throw broken(ctx, `plans/apply of ${goalRef.goalId}'s request candidate: ${said(applied)}`, check);
  rec.link('plan', plan.ref, plan.revision);
  await settleAutonomy(ctx, project, goalRef, rec);
  return { ...confirmed, plan: plan.ref, applied };
}

// ---------------------------------------------------------------------------- the explicit Goal and Plan path

export async function registration(ctx, project) {
  const body = await project.host.client.read('workspaces/registration', project.scope, project.scope);
  if (ready(body) === null) throw broken(ctx, `workspaces/registration: ${said(body)}`);
  return body.value;
}

async function projectPins(ctx, project) {
  const value = await registration(ctx, project);
  return [{ ref: value.project.ref, revision: value.project.revision }, { ref: value.workspace.ref, revision: value.workspace.revision }];
}

export async function createGoal(ctx, project, goalId, objective, rec) {
  const created = await project.host.client.write('goals/create', project.scope,
    { goalId, workspace: project.scope, objective }, await projectPins(ctx, project));
  const goal = committed(created);
  if (goal === null) throw broken(ctx, `goals/create: ${said(created)}`);
  rec.ownGoal(project, goal.ref, goal.revision);
  return goal;
}

export async function adoptArchitecture(ctx, project, catalog) {
  const adopted = await project.host.client.write('architecture/adopt-initial', project.scope,
    { baselineId: `g6-${project.name}-baseline`, description: `G6 ${project.name} architecture`, constraints: [], catalog },
    await projectPins(ctx, project));
  if (adopted?.status !== 'committed') throw broken(ctx, `architecture/adopt-initial: ${said(adopted)}`);
  return adopted.value;
}

/** Make sure the active completion policy admits `kinds`; installs and activates a new one when it does not. */
export async function ensurePolicy(ctx, project, kinds) {
  const current = ready(await project.host.client.read('completion-policies/read', project.scope,
    { projectId: project.scope.projectId }, { expect: ['not_found'] }));
  const content = current?.policy?.content ?? null;
  const have = content?.requirementKinds ?? [];
  if (kinds.every(kind => have.includes(kind))) return content;
  const next = { schemaVersion: 1, requirementKinds: [...new Set([...have, ...kinds])],
    minimumRequiredRequirementsPerObligation: content?.minimumRequiredRequirementsPerObligation ?? 1 };
  const policyId = `g6-${project.name}-${Date.now().toString(36)}`;
  const [projectPin] = await projectPins(ctx, project);
  const installed = await project.host.client.write('completion-policies/install', project.scope,
    { policyId, contentRevision: 1, content: next },
    [projectPin, { ref: { aggregateType: 'CompletionPolicyRevision', projectId: project.scope.projectId, policyId, revision: 1 }, revision: 0 }]);
  if (installed?.status !== 'committed') throw broken(ctx, `completion-policies/install: ${said(installed)}`);
  const [projectAfter] = await projectPins(ctx, project);
  const activated = await project.host.client.write('completion-policies/activate', project.scope,
    { target: { ref: installed.value.ref, digest: installed.value.contentDigest } },
    [projectAfter, { ref: { aggregateType: 'ProjectCompletionPolicyActive', projectId: project.scope.projectId }, revision: current?.active?.revision ?? 0 }]);
  if (activated?.status !== 'committed') throw broken(ctx, `completion-policies/activate: ${said(activated)}`);
  return next;
}

/** `plans/propose` then `plans/apply` (two routes, `core-routes.ts:683-684`); a plan with issues stops here. */
export async function proposeAndApply(ctx, project, goalRef, draft, reasonText, rec) {
  const proposed = await project.host.client.write('plans/propose', project.scope,
    { goalRef, basedOn: null, draft, reason: { text: reasonText, sources: [] } }, []);
  const proposal = committed(proposed);
  if (proposal === null) throw broken(ctx, `plans/propose: ${said(proposed)}`);
  if (proposal.issues.length > 0) throw broken(ctx, `plans/propose issues: ${JSON.stringify(proposal.issues)}`);
  const applied = await project.host.client.write('plans/apply', project.scope,
    { proposalRef: proposal.ref, expectedProposalRevision: proposal.revision, decisionRefs: [] }, []);
  const plan = committed(applied);
  if (plan === null) throw broken(ctx, `plans/apply: ${said(applied)}`);
  rec.link('plan', plan.ref, plan.revision);
  return plan;
}

/** `role-lines/open` (`core-routes.ts:867`); a line that waits on a card gets the person's approval, then one retry. */
export async function openRoleLine(ctx, project, duty, scope, rec) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const opened = committed(await project.host.client.write('role-lines/open', project.scope, { duty, scope }, []));
    if (opened?.session !== null && opened?.session !== undefined) {
      rec.link('session', opened.session);
      return opened.session;
    }
    for (const card of await waitingCards(project)) {
      const selection = approve(card);
      if (selection !== null) await answerCard(ctx, project, card, selection, '', rec);
    }
  }
  throw broken(ctx, `role-lines/open ${duty}: no line opened after the person approved its cards`);
}

// ---------------------------------------------------------------------------- reads

export async function sessionQueries(project, sessionRef) {
  const items = [];
  let cursor = null;
  do {
    const page = ready(await project.host.client.read('sessions/queries', project.scope,
      { sessionRef, page: { limit: 100, ...(cursor === null ? {} : { cursor }) } }));
    if (page === null) break;
    items.push(...page.items);
    cursor = page.nextCursor ?? null;
  } while (cursor !== null);
  return items;
}

/** Every page of a line's raw history; a page that does not answer ends the read and, given `gaps`, is named there. */
export async function sessionHistory(project, sessionRef, gaps = null) {
  const items = [];
  let afterCursor = null;
  do {
    const body = await project.host.client.read('sessions/history', project.scope,
      { sessionRef, afterCursor, throughCursor: null, limit: 200 });
    const page = ready(body);
    if (page === null) {
      gaps?.push(`sessions/history ${sessionRef.sessionId}: ${said(body)}`);
      break;
    }
    items.push(...page.items);
    afterCursor = page.nextCursor ?? null;
  } while (afterCursor !== null);
  return items;
}

/** A Run's saved graph history (`executions/history`, the same Kernel entries as `sessions/history`), every page. */
export async function runHistory(project, runRef) {
  const items = [];
  let afterCursor = null;
  do {
    const page = ready(await project.host.client.read('executions/history', project.scope, { runRef, afterCursor, limit: 200 }));
    if (page === null) break;
    items.push(...page.items);
    afterCursor = page.nextCursor ?? null;
  } while (afterCursor !== null);
  return items;
}

/** A tool output's values: each `json` part's value and each `text` part that is JSON. */
function outputValues(output) {
  return (Array.isArray(output) ? output : []).flatMap(part => {
    if (part?.kind === 'json') return [part.value];
    if (part?.kind !== 'text') return [];
    try { return [JSON.parse(part.text)]; } catch { return []; }
  });
}

const partsText = value => (typeof value === 'string' ? value : Array.isArray(value)
  ? value.map(part => (typeof part === 'string' ? part : part?.text ?? (part?.value === undefined ? JSON.stringify(part) : JSON.stringify(part.value)))).join('\n')
  : JSON.stringify(value ?? ''));

/**
 * Raw history entries split by turn identity (Kernel `runId` + `turnId`, `kernel-turn-facts.ts:36-80`), so each
 * criterion is judged only on the part it is about (lead ruling 11-14 #9):
 * - `input`: what the turn actually received (`turn.started` user message, `run.input_accepted` / `run.yielded`);
 * - `calls`: the model's tool calls with their arguments and, once settled, their status;
 * - `results`: the successful tool results only (`tool.completed`, output text and `effects.changedPaths`);
 * - `final`: the final assistant message named by `run.completed` (null when the turn did not complete).
 */
export function turnsOf(entries) {
  const turns = new Map();
  const turn = (runId, turnId) => {
    const key = `${runId}#${turnId}`;
    if (!turns.has(key)) turns.set(key, { runId, turnId, input: [], calls: new Map(), results: [], refusals: [], messages: new Map(), final: null, finalId: null });
    return turns.get(key);
  };
  for (const entry of entries) {
    let record = null;
    try { record = JSON.parse(entry.body?.text ?? 'null'); } catch { record = null; }
    if (record?.recordType === 'turn.started' && record.payload?.run !== undefined) {
      const run = record.payload.run;
      turn(run.runId, run.turn.turnId).input.push(partsText(run.turn.userMessage?.content));
    } else if (record?.recordType === 'agent.event') {
      const event = record.payload?.event;
      if (event?.meta === undefined) continue;
      const current = turn(event.meta.runId, event.meta.turnId);
      if ((event.type === 'run.input_accepted' || event.type === 'run.yielded') && typeof event.payload?.input?.text === 'string') {
        current.input.push(event.payload.input.text);
      } else if (event.type === 'assistant.message_completed') {
        current.messages.set(event.payload.message.messageId, partsText(event.payload.message.content));
        for (const call of event.payload.toolCalls ?? []) current.calls.set(call.callId, { name: call.name, args: call.arguments, status: null, at: event.meta.occurredAt ?? entry.recordedAt });
      } else if (event.type.startsWith('tool.') && event.type !== 'tool.started') {
        const call = current.calls.get(event.payload.callId);
        if (call !== undefined) call.status = event.type;
        const result = event.type === 'tool.outcome_unknown' ? event.payload.synthesizedResult : event.payload.result;
        const values = outputValues(result?.output);
        // A refusal inside the history (second review #15): a failed tool result (its JSON output keeps the domain
        // code and reason, `communication-tools.ts:141-147`), or a successful one whose own answer is `rejected`
        // (`project-source-tool.ts:312-334`). The identity is the Kernel record's, so a re-scan never adds it twice.
        const rejectedValue = values.find(value => value?.status === 'rejected');
        if (result?.status === 'error' || rejectedValue !== undefined) {
          current.refusals.push({ key: `${record.sessionId}#${event.meta.runId}#${event.meta.turnId}#${event.payload.callId}`,
            at: event.meta.occurredAt ?? entry.recordedAt, tool: call?.name ?? null, callId: event.payload.callId,
            code: rejectedValue?.code ?? result?.error?.code ?? null, reason: rejectedValue?.reason ?? result?.error?.message ?? '' });
        }
        if (event.type === 'tool.completed' && result?.status === 'success') {
          current.results.push({ callId: event.payload.callId, name: call?.name ?? null, args: call?.args ?? null, values,
            text: partsText(result.output), changedPaths: result.effects?.changedPaths ?? [] });
        }
      } else if (event.type === 'run.completed') {
        current.finalId = event.payload.finalMessageId;
      }
    }
  }
  return [...turns.values()].map(entry => ({ ...entry, input: entry.input.join('\n'),
    final: entry.finalId === null ? null : entry.messages.get(entry.finalId) ?? null }));
}

/** Every line of the project, archived ones included (`sessions/find`). */
export async function projectSessions(project) {
  const refs = [];
  let cursor = null;
  do {
    const page = ready(await project.host.client.read('sessions/find', project.scope,
      { workspace: project.scope, includeArchived: true, page: { limit: 200, ...(cursor === null ? {} : { cursor }) } }));
    if (page === null) break;
    refs.push(...page.items.map(card => ({ projectId: card.record.ref.projectId, sessionId: card.record.ref.sessionId })));
    cursor = page.nextCursor ?? null;
  } while (cursor !== null);
  return refs;
}

export async function sessionTurns(project, sessionRef, gaps = null) {
  return turnsOf(await sessionHistory(project, sessionRef, gaps));
}

/** The Goal's display phase, or null when the read did not answer. */
export async function goalPhase(project, goalRef) {
  return ready(await project.host.client.read('goals/display', project.scope, { goalRef }))?.display?.phase ?? null;
}

/**
 * Ask one Goal that is not finished or paused to pause (lead ruling 11-14 #5, second review #4). `ok` is false when
 * the state cannot be read or the pause is not committed; a sent pause is not yet a stopped Goal, so the caller
 * still reads the phase until it shows PAUSED.
 */
export async function pauseGoal(project, goalRef, why) {
  const client = project.host.client;
  const phase = await goalPhase(project, goalRef);
  if (phase === null) return { ok: false, text: `${goalRef.goalId}: goals/display did not answer before the pause` };
  if (TERMINAL.includes(phase) || phase === 'PAUSED') return { ok: true, text: null };
  const goal = ready(await client.read('goals/read', project.scope, goalRef));
  if (goal === null) return { ok: false, text: `${goalRef.goalId}: goals/read did not answer before the pause` };
  const paused = await client.write('goals/control', project.scope, { goalRef, control: 'pause', reason: `G6: ${why}` },
    [{ ref: goalRef, revision: goal.goal.revision }, { ref: { aggregateType: 'GoalPhase', projectId: goalRef.projectId, goalId: goalRef.goalId }, revision: 0 }]);
  return { ok: paused?.status === 'committed', text: `${goalRef.goalId} (${phase}): pause because ${why}: ${said(paused)}` };
}

/**
 * Every check round of one work Task, read the way the product requires (second review #1): a work chain is read by
 * its subject Run (`verification-round-read.ts:405-410`), one chain per Run; each round of each chain comes with the
 * Run it judged. Newest Run last.
 */
export async function taskRounds(project, goalRef, taskId) {
  const runs = (await executions(project, goalRef)).filter(item => item.run.task.taskId === taskId)
    .sort((left, right) => Date.parse(left.run.startedAt) - Date.parse(right.run.startedAt));
  const out = [];
  for (const item of runs) {
    const head = ready(await project.host.client.read('verification/round', project.scope, { subjectRunRef: item.run.ref }, { expect: ['not_found'] }));
    if (head === null) { out.push({ item, head: null, rounds: [] }); continue; }
    const rounds = [];
    for (const entry of head.chain.rounds) {
      const round = JSON.stringify(entry.roundRef) === JSON.stringify(head.roundRef) ? head
        : ready(await project.host.client.read('verification/round', project.scope, { roundRef: entry.roundRef }));
      if (round !== null) rounds.push(round);
    }
    out.push({ item, head, rounds });
  }
  return out;
}

/** Every value inside a JSON-ish tree that `test` accepts (tool outputs, queue sections). */
export function findAll(value, test) {
  const found = [];
  const walk = node => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node !== null && typeof node === 'object') {
      if (test(node)) found.push(node);
      Object.values(node).forEach(walk);
    }
  };
  walk(value);
  return found;
}


export async function executions(project, goalRef) {
  const items = [];
  let afterCursor = null;
  do {
    const page = ready(await project.host.client.read('executions/list', project.scope, { goalRef, page: { afterCursor, limit: 100 } }));
    if (page === null) break;
    items.push(...page.items);
    afterCursor = page.nextCursor ?? null;
  } while (afterCursor !== null);
  return items;
}

/** The project's lines; a read that does not answer gives none and, given `gaps`, is named there. */
export async function lines(project, gaps = null) {
  const body = await project.host.client.read('lines/list', project.scope, { workspace: project.scope });
  const rows = ready(body)?.rows;
  if (rows === undefined) gaps?.push(`lines/list: ${said(body)}`);
  return rows ?? [];
}

export const textOf = value => JSON.stringify(value ?? null);

/** The end state of one Goal (spec §5.6 "终态"). */
export async function finalState(project, goalRef) {
  const display = ready(await project.host.client.read('goals/display', project.scope, { goalRef }));
  const goal = ready(await project.host.client.read('goals/read', project.scope, goalRef));
  const tasks = ready(await project.host.client.read('tasks/query', project.scope, { goalRef }));
  const runs = await executions(project, goalRef);
  const queue = ready(await project.host.client.read('decisions/queue', project.scope,
    { workspace: project.scope, goalRef, sections: ['waiting_answer', 'answered_pending_application'], page: { limit: 50 } }));
  return {
    autonomy: goal?.goal?.settings?.autonomy ?? null,
    goalDisplay: display === null ? null : { phase: display.display.phase, row: display.display.row },
    taskPhase: Object.fromEntries((tasks?.tasks ?? []).map(task => [task.ref.taskId, task.effectivePhase])),
    runOutcome: Object.fromEntries(runs.map(item => [item.run.ref.runId, item.run.outcome ?? item.run.status])),
    lineState: (await lines(project)).map(row => ({ session: row.key.sessionId, duty: row.duty, status: row.status?.own ?? row.status })),
    queueCounts: queue?.counts ?? null,
  };
}
