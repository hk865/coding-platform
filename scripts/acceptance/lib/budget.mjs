// The token budget (HANDOFF 113-8; 9-start-rulings.frozen.md:53-57): 400,000,000 for the whole window and
// 50,000,000 per scenario/cell, read from acceptance.config.json with no default. Usage is
// `inputTokens + outputTokens` (the Kernel's input already includes cache hits, `run-state.ts:215`;
// next1113c ruling 14:1x); `cachedInputTokens` is recorded beside it, never added again.
// The counts come only from public reads: every Session's QueryRun requests (`sessions/queries`) and every
// ended Work Run's totals (`activity/runs`). Each counted item belongs to the unit that owns its project (set when the
// unit opens or takes over the project), never to the unit that happened to be running when it was read.
// Known gap (lead ruling 11-14 #3): a Work Run's compaction summary request runs in its own Kernel Session
// (`compaction.ts:314`) and is not in `activity/runs`, so the meter undercounts those; recorded, not filled in.
// There is no budget abort entry, so a stop comes after the request that crossed the cap; in-flight requests are not
// aborted. A reading where any read does not answer is not used: the meter stops new work instead.
import { ready } from './http.mjs';
import { Abort } from './report.mjs';

const POLL_MS = 20_000;
const keyOf = value => JSON.stringify(value);
const scopeKey = scope => `${scope.projectId}/${scope.workspaceId}`;
const sessionRefOf = ref => ({ projectId: ref.projectId, sessionId: ref.sessionId });
const zero = () => ({ input: 0, output: 0, cached: 0, queryRequests: 0, unbilled: 0, runs: 0, runsWithoutUsage: 0 });

/** A stop from the budget: `total` or `scenario` cap crossed, or `meter` (the reading is incomplete). */
export class BudgetStop extends Abort {
  constructor(cap, detail) {
    super('not-run', detail);
    this.cap = cap;
  }
}

const unreadable = (route, body) => new BudgetStop('meter', `the budget meter could not read ${route} (${body?.status ?? 'no answer'} ${
  body?.code ?? ''} ${body?.reason ?? ''}); the last complete reading stands and no new work starts`);

class Meter {
  constructor(host, budget) {
    this.host = host;
    this.budget = budget;
    this.seen = new Set();
    /** scopeKey → { queries: running QueryRuns, runs: Work Runs not ended } at the last complete reading. */
    this.inFlight = new Map();
  }

  /** Every page of one paged read; any answer other than `ready` makes the whole reading unusable. */
  async #all(route, scope, inputAt) {
    const items = [];
    let cursor = null;
    do {
      const body = await this.host.client.quiet(route, scope, inputAt(cursor));
      const page = ready(body);
      if (page === null) throw unreadable(route, body);
      items.push(...page.items);
      cursor = page.nextCursor ?? null;
    } while (cursor !== null);
    return items;
  }

  /**
   * The Query has reached its terminal failure and that failure names the model service as its source
   * (`provider_request_failed`, `contracts/dispatch.ts:76-78`): a proven rejection, not unknown usage.
   */
  async #provenRejection(scope, snapshot) {
    if (snapshot.run?.status !== 'closed') return false;
    const ref = snapshot.ref;
    const body = await this.host.client.quiet('queries/read', scope,
      { aggregateType: 'QueryJob', projectId: ref.projectId, workspaceId: ref.workspaceId, queryJobId: ref.queryJobId });
    const job = ready(body);
    if (job === null) throw unreadable('queries/read', body);
    return job.job?.job?.closeReason?.code === 'failed' && JSON.stringify(job).includes('provider_request_failed');
  }

  /** One complete reading of this Host; nothing is counted unless every read answered. */
  async poll() {
    const client = this.host.client;
    const boot = await client.quietGet('/api/real/core/bootstrap');
    if (!Array.isArray(boot?.workspaces)) throw unreadable('core/bootstrap', boot);
    const found = [];
    const inFlight = new Map();
    for (const scope of boot.workspaces.map(entry => entry.scope).filter(scope => scope.projectId !== 'g6-placeholder')) {
      const busy = { queries: 0, runs: 0, queryRuns: [], workRuns: [], scope };
      inFlight.set(scopeKey(scope), busy);
      const cards = await this.#all('sessions/find', scope, cursor =>
        ({ workspace: scope, includeArchived: true, page: { limit: 200, ...(cursor === null ? {} : { cursor }) } }));
      for (const sessionRef of cards.map(card => sessionRefOf(card.record.ref))) {
        const snapshots = await this.#all('sessions/queries', scope, cursor =>
          ({ sessionRef, page: { limit: 100, ...(cursor === null ? {} : { cursor }) } }));
        for (const snapshot of snapshots) {
          // A pending QueryRun can still start, so it is in flight too (second review #4).
          if (snapshot.run?.status === 'running' || snapshot.run?.status === 'pending') { busy.queries += 1; busy.queryRuns.push(snapshot.ref); }
          for (const request of snapshot.run?.executionState?.requests ?? []) {
            const key = `${keyOf(snapshot.ref)}#${request.requestId}`;
            if (this.seen.has(key) || request.usageStatus === 'reserved') continue;
            if (request.usageStatus !== 'reported') {
              // A rejection the Query's own terminal failure proves (lead ruling 11-14 on A1/B1) is a known outcome: the
              // request is counted as unbilled, 0. Unknown usage with no such terminal fact is not zero: the meter stops.
              if (snapshot.run?.status !== 'closed') {
                // Held until its Query's terminal fact (quick check 补充1): new work stops meanwhile; if the Query then
                // closes with a proven rejection the request is counted 0 and only this stop is lifted (`read`).
                const held = new BudgetStop('meter', `request ${request.requestId} of ${snapshot.ref.queryJobId} has usage ${request.usageStatus} and its Query has not ended yet; new work waits for its terminal fact`);
                held.pendingKey = key;
                throw held;
              }
              if (!(await this.#provenRejection(scope, snapshot))) {
                throw new BudgetStop('meter', `request ${request.requestId} of ${snapshot.ref.queryJobId} has usage ${request.usageStatus} and its Query shows no terminal provider failure; the meter cannot count it, so no new work starts`);
              }
              found.push({ key, scope, kind: 'query', input: 0, output: 0, cached: 0, unbilled: true, detail: { queryRunRef: snapshot.ref, sessionRef,
                requestId: request.requestId, reservedOutput: request.reservedOutput, unbilled: 'provider rejection (model_service / provider_request_failed)' } });
              continue;
            }
            found.push({ key, scope, kind: 'query', input: request.inputTokens, output: request.outputTokens,
              cached: request.cachedInputTokens, detail: { queryRunRef: snapshot.ref, sessionRef, requestId: request.requestId,
                reservedOutput: request.reservedOutput } });
          }
        }
      }
      const goalsBody = await client.quiet('goals/list', scope, { workspace: scope });
      const goals = ready(goalsBody)?.goals;
      if (goals === undefined) throw unreadable('goals/list', goalsBody);
      const ended = [];
      for (const goal of goals) {
        const items = await this.#all('executions/list', scope, afterCursor => ({ goalRef: goal.ref, page: { afterCursor, limit: 100 } }));
        for (const item of items) {
          if (item.run.status !== 'ended') { busy.runs += 1; busy.workRuns.push(item.run); continue; }
          if (!this.seen.has(keyOf(item.run.ref))) ended.push(item.run.ref);
        }
      }
      for (let index = 0; index < ended.length; index += 200) {
        const body = await client.quiet('activity/runs', scope, { runRefs: ended.slice(index, index + 200) });
        const views = ready(body);
        if (!Array.isArray(views)) throw unreadable('activity/runs', body);
        for (const view of views) {
          // Only a complete reading counts, or the public proof of a zero (a Run that never entered the Kernel,
          // `activity-read-helpers.ts:367-375`); unknown or incomplete usage stops the meter and is read again later.
          const provenZero = view.usage === null && view.readings?.usage?.tokens === 0 && view.readings.usage.complete === true;
          if (!provenZero && view.usage?.complete !== true) {
            throw new BudgetStop('meter', `Run ${view.runRef.runId} ended with ${view.usage === null ? 'unknown' : 'incomplete'} usage (${
              view.readings?.usage?.reason ?? 'no reason'}); the meter cannot count it, so no new work starts`);
          }
          found.push({ key: keyOf(view.runRef), scope, kind: 'run', input: view.usage?.inputTokens ?? 0, output: view.usage?.outputTokens ?? 0,
            cached: view.usage?.cachedInputTokens ?? 0, noUsage: provenZero, detail: { runRef: view.runRef, complete: true } });
        }
      }
    }
    for (const item of found) {
      this.seen.add(item.key);
      this.budget.count(item, this.host.name);
    }
    this.inFlight = inFlight;
  }
}

export class Budget {
  /** @param {{ total: number, perScenario: number }} caps from acceptance.config.json `tokenCaps` (no default; run.mjs prechecks). */
  constructor(caps, report) {
    this.caps = caps;
    this.report = report;
    this.meters = new Map();
    this.owners = new Map();
    this.units = new Map();
    this.current = null;
    this.lastPoll = 0;
    /** The run-wide stop (`total` or `meter`) once seen; the unit stops once each unit's cap is crossed. */
    this.stop = null;
    this.unitStops = new Map();
  }

  /** Meter a Host; a restart over the same ledger keeps the counted refs (no double count). */
  watch(host) {
    const meter = this.meters.get(host.dir);
    if (meter === undefined) this.meters.set(host.dir, new Meter(host, this));
    else meter.host = host;
  }

  /** A closed Host keeps its counted totals; it is just not polled. */
  unwatch(host) {
    const meter = this.meters.get(host.dir);
    if (meter !== undefined && meter.host === host) meter.host = null;
  }

  /** The unit that owns everything counted from this project from now on. */
  own(scope, unit) {
    this.owners.set(scopeKey(scope), unit);
  }

  scopesOf(unit) {
    return [...this.owners.entries()].filter(([, owner]) => owner === unit).map(([key]) => key);
  }

  count(item, hostName) {
    const unit = this.owners.get(scopeKey(item.scope)) ?? '-';
    const totals = this.units.get(unit) ?? zero();
    this.units.set(unit, totals);
    totals.input += item.input ?? 0;
    totals.output += item.output ?? 0;
    totals.cached += item.cached ?? 0;
    if (item.kind === 'query') { totals.queryRequests += 1; if (item.unbilled) { totals.unbilled += 1; this.report.note(`${unit}: request ${item.detail.requestId} counted as unbilled 0 (${item.detail.unbilled})`); } }
    else { totals.runs += 1; if (item.noUsage) totals.runsWithoutUsage += 1; }
    this.report.modelCall({ at: new Date().toISOString(), host: hostName, unit, kind: item.kind, ...item.detail,
      inputTokens: item.input ?? null, outputTokens: item.output ?? null, cachedInputTokens: item.cached ?? null });
  }

  usedBy(unit) {
    const totals = this.units.get(unit);
    return totals === undefined ? null : { ...totals, spent: totals.input + totals.output };
  }

  used() {
    const sum = zero();
    for (const totals of this.units.values()) for (const key of Object.keys(sum)) sum[key] += totals[key];
    return { ...sum, spent: sum.input + sum.output };
  }

  /** In flight at the last complete reading, over the given project keys (all of a Host's when `host` is given). */
  inFlight({ scopes = null, host = null }) {
    const sum = { queries: 0, runs: 0, items: [] };
    for (const meter of this.meters.values()) {
      if (meter.host === null || (host !== null && meter.host !== host)) continue;
      for (const [key, busy] of meter.inFlight) {
        if (scopes !== null && !scopes.includes(key)) continue;
        sum.queries += busy.queries;
        sum.runs += busy.runs;
        sum.items.push(...busy.queryRuns.map(ref => ({ kind: 'query', scope: busy.scope, host: meter.host, ref })),
          ...busy.workRuns.map(run => ({ kind: 'run', scope: busy.scope, host: meter.host, run })));
      }
    }
    return sum;
  }

  /** One complete reading of every metered Host, then the caps; a failed reading becomes the run-wide `meter` stop. */
  async read() {
    this.lastPoll = Date.now();
    try {
      for (const meter of this.meters.values()) if (meter.host !== null) await meter.poll();
    } catch (error) {
      if (!(error instanceof BudgetStop)) throw error;
      // A held stop never replaces a final one; a final one replaces a held one.
      if (this.stop === null || (this.stop.pendingKey !== undefined && error.pendingKey === undefined)) {
        this.stop = error;
        this.report.note(error.message);
      }
      return;
    }
    // A complete reading: a stop held only for one request that has now been counted (its rejection proven, counted 0)
    // is lifted; nothing else is.
    const held = this.stop?.pendingKey;
    if (held !== undefined && [...this.meters.values()].some(meter => meter.seen.has(held))) {
      this.report.note(`the stop held for ${held} is lifted: its Query ended with a proven provider rejection, counted unbilled 0`);
      this.stop = null;
    }
    const used = this.used();
    if (this.stop === null && used.spent >= this.caps.total) {
      this.stop = new BudgetStop('total', `the window total ${used.spent} reached the cap ${this.caps.total}`);
      this.report.note(this.stop.message);
    }
    for (const [unit, totals] of this.units) {
      const spent = totals.input + totals.output;
      if (unit === '-' || this.unitStops.has(unit) || spent < this.caps.perScenario) continue;
      this.unitStops.set(unit, new BudgetStop('scenario', `${unit} used ${spent}, cap ${this.caps.perScenario}`));
      // A unit that already ended stopped its own Goals then; what settles later still counts to it.
      if (unit !== this.current) this.report.note(`${unit} crossed its cap after it ended (${spent}); its Goals were paused at its end`);
    }
  }

  #stopNow() {
    if (this.stop !== null) throw this.stop;
    const own = this.current === null ? undefined : this.unitStops.get(this.current);
    if (own !== undefined) throw own;
  }

  /** Called inside every wait loop: a stop already seen ends the wait at once; otherwise a reading at most every 20 s. */
  async tick(force = false) {
    this.#stopNow();
    if (!force && Date.now() - this.lastPoll < POLL_MS) return;
    await this.read();
    this.#stopNow();
  }

  async begin(id) {
    this.current = id;
    if (!this.units.has(id)) this.units.set(id, zero());
    await this.read();
    if (this.stop !== null) throw this.stop;
  }

  /** The unit's final reading (after its own drain); a crossing seen only here is still the unit's stop. */
  async end() {
    await this.read();
    const id = this.current;
    this.current = null;
    return { usage: this.usedBy(id), stop: this.stop ?? this.unitStops.get(id) ?? null };
  }

  lines() {
    const used = this.used();
    const inFlight = this.inFlight({});
    return [
      `上限：总量 ${this.caps.total}，每个场景/格 ${this.caps.perScenario}（acceptance.config.json \`tokenCaps\`）。`,
      `口径：用量 = inputTokens + outputTokens（Kernel 的 inputTokens 已含缓存命中，cachedInputTokens 另记、不再相加）；每条按它所在项目的归属场景/格计，不按读到的时间。`,
      `合计：用量 ${used.spent}（输入 ${used.input}，输出 ${used.output}；缓存命中 ${used.cached}）；Query 请求 ${used.queryRequests} 次（含 Query 的压缩摘要请求，公开记录分不出）；结束的 Work Run ${used.runs} 个，其中 ${used.runsWithoutUsage} 个是公开证明的零（没进入 Kernel）；未知或不完整的用量不算零，会让计量停下。`,
      '已知缺口：Work Run 的压缩摘要请求在另一个 Kernel Session 里跑，不在 `activity/runs` 里，计量少算了它们；驱动不读数据库补数（lead 裁定 11-14 #3）。400M/50M 上限远高于预期用量，这是记下的缺口，不是阻断。',
      `最后一次完整读数时在途：Query ${inFlight.queries}，Work Run ${inFlight.runs}（Work Run 的用量要等 Run 结束才在 \`activity/runs\` 出现，所以超限后的停止点是第一次能看到超出的读数）。`,
      ...(this.stop?.cap === 'meter' ? [`计量不可用：${this.stop.message}`] : []),
      ...[...this.units.entries()].map(([unit, item]) => `${unit}：用量 ${item.input + item.output}（输入 ${item.input}，输出 ${item.output}，缓存命中 ${item.cached}；Query 请求 ${item.queryRequests}（其中 provider 拒收、按未计费 0 计的 ${item.unbilled}），结束的 Run ${item.runs}）`),
    ];
  }
}
