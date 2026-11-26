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
// A request of a closed Query whose usage stayed unknown (e.g. a Host close cut it) is counted at its reservation,
// `reservedInput + reservedOutput`, the platform's own rule (`model-budget.ts:85-91`; G6F F1): an upper bound, so
// "stop once over the cap" still holds; only an unreadable reservation stops the meter.
import { ready } from './http.mjs';
import { Abort } from './report.mjs';

const POLL_MS = 20_000;
// 补充 1 的“等它结束”最多等多久（lead 11-17，G6 第六次之后）：和收尾的 30 分钟上限一样；到时还没结束才成为整轮的停止。
const HOLD_MS = 30 * 60_000;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const keyOf = value => JSON.stringify(value);
/**
 * P6I r3: a QueryRunRef's key, its five fields in one fixed order. A claim keeps the ref its caller sent
 * (`query-execution.ts:1311`), so a Session's occupancy can name the same Run with its fields in another order, and
 * `JSON.stringify` of the two refs would then differ.
 */
const QUERY_RUN_FIELDS = ['aggregateType', 'projectId', 'workspaceId', 'queryJobId', 'runId'];
export const queryRunKey = ref => JSON.stringify(QUERY_RUN_FIELDS.map(field => ref?.[field] ?? null));
/** A cancelled ref's key: a QueryRun's by `queryRunKey`, a Work Run's as read. */
const cancelKey = ref => (ref?.aggregateType === 'QueryRun' ? queryRunKey(ref) : keyOf(ref));
/** The meter's key of one project scope (`inFlight({ scopes })` takes these). */
export const scopeKey = scope => `${scope.projectId}/${scope.workspaceId}`;
const sessionRefOf = ref => ({ projectId: ref.projectId, sessionId: ref.sessionId });
// `reportedInput` (P6, design-frozen.md:838 "实报输入 token"): the input of counted items whose usage the platform
// reported, i.e. neither a reservation upper bound (`bounded`) nor an unbilled 0 / cut part (`unbilled`).
const zero = () => ({ input: 0, output: 0, cached: 0, reportedInput: 0, queryRequests: 0, unbilled: 0, bounded: 0, runs: 0, runsWithoutUsage: 0 });

/** A stop from the budget: `total` or `scenario` cap crossed, or `meter` (the reading is incomplete). */
export class BudgetStop extends Abort {
  constructor(cap, detail) {
    super('not-run', detail);
    this.cap = cap;
  }
}

const unreadable = (route, body) => new BudgetStop('meter', `the budget meter could not read ${route} (${body?.status ?? 'no answer'} ${
  body?.code ?? ''} ${body?.reason ?? ''}); the last complete reading stands and no new work starts`);
const CUT = "cut by the driver's cancel; usage not reported, at most one request";

class Meter {
  constructor(host, budget) {
    this.host = host;
    this.budget = budget;
    this.seen = new Set();
    /**
     * scopeKey of a Session's workspace → `{ queryRuns, workRuns, scope }`: its QueryRuns running or pending (also those
     * that run in another workspace) and Work Runs not ended, at the last complete reading.
     */
    this.inFlight = new Map();
    /** P6I D1: queryRunKey → that in-flight QueryRun's state at the last complete reading (`#queryState`). */
    this.queryStates = new Map();
    /**
     * P6I r3: queryRunKey → `{ ref, session, last }` of each QueryRun a Session ran in another workspace, kept until its
     * terminal usage is counted (`#elsewhere`, `#dropCounted`); a Host restart keeps them (same ledger).
     */
    this.elsewhere = new Map();
  }

  /**
   * P6I D1: one in-flight QueryRun: its phase (null before a claim), whether it waits for a running slot, since when
   * its `(revision, phase)` has not changed and when this reading saw it (`seenAt`). `since` carries over from the last
   * complete reading while both stay. `runScope` is the workspace the Run executes in, which a project-level line's
   * Query may not share with its Session.
   */
  #queryState(snapshot, states, seenAt) {
    const key = queryRunKey(snapshot.ref);
    const execution = snapshot.run?.executionState;
    const phase = execution?.phase ?? null;
    const before = this.queryStates.get(key);
    const since = before?.revision === snapshot.revision && before.phase === phase ? before.since : seenAt;
    const state = { ref: snapshot.ref, runScope: { projectId: snapshot.ref.projectId, workspaceId: snapshot.ref.workspaceId },
      revision: snapshot.revision, phase, since, seenAt, waitsForSlot: (execution?.admissionWait ?? null) !== null };
    states.set(key, state);
    return state;
  }

  /**
   * Every page of one paged read, each with the time it came back (P6I D1: a Query is seen when its page returns, not
   * when the whole reading began); any answer other than `ready` makes the whole reading unusable.
   */
  async #pages(route, scope, inputAt) {
    const pages = [];
    let cursor = null;
    do {
      const body = await this.host.client.quiet(route, scope, inputAt(cursor));
      const page = ready(body);
      if (page === null) throw unreadable(route, body);
      pages.push({ items: page.items, at: Date.now() });
      cursor = page.nextCursor ?? null;
    } while (cursor !== null);
    return pages;
  }

  async #all(route, scope, inputAt) {
    return (await this.#pages(route, scope, inputAt)).flatMap(page => page.items);
  }

  /**
   * P6I D1, r3: the QueryRuns this Session ran in another workspace. `sessions/queries` lists Queries by the Run's own
   * workspace, and only the Session's occupancy names such a Run, only while it runs. So the ref is kept from the first
   * reading that sees it until its terminal usage is counted (`#dropCounted`), and read by its full ref in the Run's
   * workspace on every reading, also after the occupancy moved on. Losing it with the occupancy left a request held for
   * its Query's end uncounted: the meter waited the full 30 minutes and stopped the run (P6I r3 #2).
   */
  async #elsewhere(card, scope) {
    const session = keyOf(sessionRefOf(card.record.ref));
    const occupancy = card.record.occupancy;
    const occupying = occupancy?.kind === 'execution' ? occupancy.executionRef : null;
    if (occupying?.aggregateType === 'QueryRun' && occupying.workspaceId !== scope.workspaceId
      && !this.elsewhere.has(queryRunKey(occupying))) {
      this.elsewhere.set(queryRunKey(occupying), { ref: occupying, session, last: null });
    }
    const taken = [];
    for (const [key, entry] of this.elsewhere) {
      if (entry.session !== session) continue;
      const { ref } = entry;
      const body = await this.host.client.quiet('queries/read', { projectId: ref.projectId, workspaceId: ref.workspaceId },
        { aggregateType: 'QueryJob', projectId: ref.projectId, workspaceId: ref.workspaceId, queryJobId: ref.queryJobId });
      const read = ready(body);
      if (read === null) throw unreadable('queries/read', body);
      // `queries/read` shows only the Job's current attempt: a Run a newer attempt replaced has no public read left from
      // here, so what it used cannot be counted (the meter's rule for unreadable usage).
      if (queryRunKey(read.run?.ref) !== key) {
        throw new BudgetStop('meter', `QueryRun ${ref.queryJobId}/${ref.runId} in workspace ${ref.workspaceId} was replaced by a new attempt before its terminal usage could be read there; the meter cannot count it, so no new work starts`);
      }
      entry.last = read.run;
      taken.push({ snapshot: read.run, seenAt: Date.now() });
    }
    return taken;
  }

  /** P6I r3: a Run read in another workspace is let go once it reads ended and each of its requests is counted. */
  #dropCounted() {
    for (const [key, entry] of this.elsewhere) {
      const run = entry.last?.run;
      if (!['answered', 'closed'].includes(run?.status)) continue;
      if ((run.executionState?.requests ?? []).every(request => this.seen.has(`${key}#${request.requestId}`))) this.elsewhere.delete(key);
    }
  }

  /**
   * The known end of an unknown-usage request in a closed Query, or null: a terminal failure from the model service
   * (`provider_request_failed`, `contracts/dispatch.ts:76-78`), or a terminal `cancelled` of a Query the driver itself
   * cancelled (lead ruling 11-14 after the real run: at most one in-flight request cut, usage not reported).
   */
  async #knownEnd(scope, snapshot) {
    if (snapshot.run?.status !== 'closed') return null;
    const ref = snapshot.ref;
    // Read in the Run's own workspace, which a project-level line's Query may not share with its Session.
    const body = await this.host.client.quiet('queries/read', { projectId: ref.projectId, workspaceId: ref.workspaceId },
      { aggregateType: 'QueryJob', projectId: ref.projectId, workspaceId: ref.workspaceId, queryJobId: ref.queryJobId });
    const job = ready(body);
    if (job === null) throw unreadable('queries/read', body);
    const close = job.job?.job?.closeReason?.code;
    if (close === 'failed' && JSON.stringify(job).includes('provider_request_failed')) return 'provider rejection (model_service / provider_request_failed)';
    if (close === 'cancelled' && this.budget.cancelled.has(cancelKey(ref))) return CUT;
    return null;
  }
  /** One complete reading of this Host; nothing is counted unless every read answered. */
  async poll() {
    const client = this.host.client;
    const boot = await client.quietGet('/api/real/core/bootstrap');
    if (!Array.isArray(boot?.workspaces)) throw unreadable('core/bootstrap', boot);
    const found = [];
    const inFlight = new Map();
    const queryStates = new Map();
    for (const scope of boot.workspaces.map(entry => entry.scope).filter(scope => scope.projectId !== 'g6-placeholder')) {
      const busy = { queryRuns: [], workRuns: [], scope };
      inFlight.set(scopeKey(scope), busy);
      const cards = await this.#all('sessions/find', scope, cursor =>
        ({ workspace: scope, includeArchived: true, page: { limit: 200, ...(cursor === null ? {} : { cursor }) } }));
      for (const card of cards) {
        const sessionRef = sessionRefOf(card.record.ref);
        const listed = (await this.#pages('sessions/queries', scope, cursor =>
          ({ sessionRef, page: { limit: 100, ...(cursor === null ? {} : { cursor }) } })))
          .flatMap(page => page.items.map(snapshot => ({ snapshot, seenAt: page.at })));
        for (const { snapshot, seenAt } of [...listed, ...await this.#elsewhere(card, scope)]) {
          // A pending QueryRun can still start, so it is in flight too (second review #4).
          if (snapshot.run?.status === 'running' || snapshot.run?.status === 'pending') {
            busy.queryRuns.push(this.#queryState(snapshot, queryStates, seenAt));
          }
          for (const request of snapshot.run?.executionState?.requests ?? []) {
            const key = `${queryRunKey(snapshot.ref)}#${request.requestId}`;
            if (this.seen.has(key) || request.usageStatus === 'reserved') continue;
            if (request.usageStatus !== 'reported') {
              // A rejection the Query's own terminal failure proves (lead ruling 11-14 on A1/B1) is a known outcome: the
              // request is counted as unbilled, 0. Unknown usage with no such terminal fact is not zero: it is counted
              // at its reservation (G6F F1).
              // lead 11-17（G6 第八次）：查询的终态有 answered 和 closed 两种（`contracts/query-job.ts:177`）。原先只认
              // closed，已作答的查询里一个重试过的请求让暂停解不开，空等 30 分钟后停了整轮。
              if (!['answered', 'closed'].includes(snapshot.run?.status)) {
                // Held until its Query's terminal fact (quick check 补充1): new work stops meanwhile; once the Query
                // closes the request is counted (0 or its reservation) and only this stop is lifted (`read`).
                const held = new BudgetStop('meter', `request ${request.requestId} of ${snapshot.ref.queryJobId} has usage ${request.usageStatus} and its Query has not ended yet; new work waits for its terminal fact`);
                held.pendingKey = key;
                throw held;
              }
              const known = await this.#knownEnd(scope, snapshot);
              if (known === null) {
                if (!Number.isSafeInteger(request.reservedInput) || !Number.isSafeInteger(request.reservedOutput)) {
                  throw new BudgetStop('meter', `request ${request.requestId} of ${snapshot.ref.queryJobId} has usage ${request.usageStatus}, its Query ended with neither a provider failure nor the driver's own cancel, and its reservation cannot be read; the meter cannot count it, so no new work starts`);
                }
                found.push({ key, scope, kind: 'query', input: request.reservedInput, output: request.reservedOutput, cached: 0, bounded: true,
                  detail: { queryRunRef: snapshot.ref, sessionRef, requestId: request.requestId, reservedOutput: request.reservedOutput,
                    bounded: `usage ${request.usageStatus}; Query closed ${snapshot.run?.outcome ?? '?'}; counted at the reservation (upper bound)` } });
                continue;
              }
              found.push({ key, scope, kind: 'query', input: 0, output: 0, cached: 0, unbilled: true, detail: { queryRunRef: snapshot.ref, sessionRef,
                requestId: request.requestId, reservedOutput: request.reservedOutput, unbilled: known } });
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
      const outcomes = new Map();
      for (const goal of goals) {
        const items = await this.#all('executions/list', scope, afterCursor => ({ goalRef: goal.ref, page: { afterCursor, limit: 100 } }));
        for (const item of items) {
          if (item.run.status !== 'ended') { busy.workRuns.push(item.run); continue; }
          if (!this.seen.has(keyOf(item.run.ref))) { ended.push(item.run.ref); outcomes.set(keyOf(item.run.ref), item.run.outcome ?? null); }
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
          // A Run the driver itself cancelled that ended `cancelled`: what it reported counts, and the request its cancel
          // cut counts 0 (lead ruling after the real run).
          const cut = this.budget.cancelled.has(cancelKey(view.runRef)) && outcomes.get(keyOf(view.runRef)) === 'cancelled';
          if (!provenZero && view.usage?.complete !== true && !cut) {
            throw new BudgetStop('meter', `Run ${view.runRef.runId} ended with ${view.usage === null ? 'unknown' : 'incomplete'} usage (${
              view.readings?.usage?.reason ?? 'no reason'}); the meter cannot count it, so no new work starts`);
          }
          const partial = cut && view.usage?.complete !== true;
          found.push({ key: keyOf(view.runRef), scope, kind: 'run', input: view.usage?.inputTokens ?? 0, output: view.usage?.outputTokens ?? 0,
            cached: view.usage?.cachedInputTokens ?? 0, noUsage: provenZero, unbilled: partial,
            detail: { runRef: view.runRef, complete: !partial, ...(partial ? { unbilled: CUT } : {}) } });
        }
      }
    }
    for (const item of found) {
      this.seen.add(item.key);
      this.budget.count(item, this.host.name);
    }
    this.#dropCounted();
    this.inFlight = inFlight;
    this.queryStates = queryStates;
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
    /** Query and Run refs the driver itself cancelled (A/B cells, the drain): their cut request is a known outcome. */
    this.cancelled = new Set();
  }

  /** Meter a Host; a restart over the same ledger keeps the counted refs (no double count). */
  watch(host) {
    const meter = this.meters.get(host.dir);
    if (meter === undefined) this.meters.set(host.dir, new Meter(host, this));
    else {
      meter.host = host;
      // P6I D1 (S5): a restarted Host's Queries are timed from its own first reading, not across the down time, and the
      // down Host's in-flight snapshot is dropped, so nothing is judged before the new Host's first complete reading.
      meter.queryStates = new Map();
      meter.inFlight = new Map();
    }
  }

  /** A closed Host keeps its counted totals; it is just not polled. */
  unwatch(host) {
    const meter = this.meters.get(host.dir);
    if (meter !== undefined && meter.host === host) meter.host = null;
  }

  /** The unit that owns everything counted from this project from now on. */
  /** Record a cancel the driver itself sends (before it is sent), so its cut request is read as a known outcome. */
  markCancelled(ref) {
    this.cancelled.add(cancelKey(ref));
  }

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
    if (!item.bounded && !item.unbilled) totals.reportedInput += item.input ?? 0;
    if (item.kind === 'query') {
      totals.queryRequests += 1;
      if (item.unbilled) { totals.unbilled += 1; this.report.note(`${unit}: request ${item.detail.requestId} counted as unbilled 0 (${item.detail.unbilled})`); }
      if (item.bounded) { totals.bounded += 1; this.report.note(`${unit}: request ${item.detail.requestId} counted at its reservation ${item.input}+${item.output} (${item.detail.bounded})`); }
    }
    else { totals.runs += 1; if (item.noUsage) totals.runsWithoutUsage += 1; if (item.unbilled) { totals.unbilled += 1; this.report.note(`${unit}: Run ${item.detail.runRef.runId} counted with its reported part only, the rest 0 (${item.detail.unbilled})`); } }
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

  /**
   * In flight at the last complete reading, over the given project keys (all of a Host's when `host` is given). P6I r3:
   * a Query is in range by its Session's workspace or its Run's, whichever the caller names (a line's round may run in
   * another workspace), and is taken once by its `queryRunKey`; the counts are those of the items taken, so a drain of
   * the Run's workspace never reads zero while that Query runs.
   */
  inFlight({ scopes = null, host = null }) {
    const inRange = key => scopes === null || scopes.includes(key);
    const queries = new Map();
    const runs = [];
    for (const meter of this.meters.values()) {
      if (meter.host === null || (host !== null && meter.host !== host)) continue;
      for (const [key, busy] of meter.inFlight) {
        for (const query of busy.queryRuns) {
          if (inRange(key) || inRange(scopeKey(query.runScope))) {
            queries.set(queryRunKey(query.ref), { kind: 'query', scope: busy.scope, host: meter.host, ...query });
          }
        }
        if (inRange(key)) runs.push(...busy.workRuns.map(run => ({ kind: 'run', scope: busy.scope, host: meter.host, run })));
      }
    }
    return { queries: queries.size, runs: runs.length, items: [...queries.values(), ...runs] };
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
        // 暂停从第一次看到时算起；同一个暂停之后再读到不重设时间（上面的条件不会用新的暂停替换旧的）。
        if (error.pendingKey !== undefined) error.heldSince = Date.now();
        this.stop = error;
        this.report.note(error.message);
      }
      return;
    }
    // A complete reading: a stop held only for one request that has now been counted (its rejection proven, counted 0)
    // is lifted; nothing else is.
    const held = this.stop?.pendingKey;
    if (held !== undefined && [...this.meters.values()].some(meter => meter.seen.has(held))) {
      this.report.note(`the stop held for ${held} is lifted: its Query ended and the request is counted (unbilled 0 for a proven provider rejection or the driver's own cancel, else at its reservation)`);
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

  /** 只读：现在的停止是不是“等一个查询结束”的暂停（还能解除），不是最终的停止。 */
  get held() {
    return this.stop?.pendingKey !== undefined;
  }

  /**
   * 补充 1（G6 第六次之后补上的等待）：只因一个查询还没结束而暂停时，就在这里等，每 20 秒读一次，直到它结束、
   * 暂停解除；这期间场景停在原地，不开新工作。等满 HOLD_MS 还没结束，才换成最终的停止。第六次时这里不等，
   * 驱动约 1 秒后就结束了整轮。
   */
  async #waitHeld() {
    while (this.held) {
      if (Date.now() - this.stop.heldSince >= HOLD_MS) {
        this.stop = new BudgetStop('meter', `${this.stop.message}; it did not end within ${HOLD_MS / 60_000} min`);
        this.report.note(this.stop.message);
        return;
      }
      await sleep(POLL_MS);
      await this.read();
    }
  }

  /** Called inside every wait loop: a stop already seen ends the wait at once; otherwise a reading at most every 20 s. */
  async tick(force = false) {
    await this.#waitHeld();
    this.#stopNow();
    if (!force && Date.now() - this.lastPoll < POLL_MS) return;
    await this.read();
    await this.#waitHeld();
    this.#stopNow();
  }

  async begin(id) {
    this.current = id;
    if (!this.units.has(id)) this.units.set(id, zero());
    await this.read();
    await this.#waitHeld();
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
      `合计：用量 ${used.spent}（输入 ${used.input}，输出 ${used.output}；缓存命中 ${used.cached}）；Query 请求 ${used.queryRequests} 次（含 Query 的压缩摘要请求，公开记录分不出）；结束的 Work Run ${used.runs} 个，其中 ${used.runsWithoutUsage} 个是公开证明的零（没进入 Kernel）；未知或不完整的用量不算零：已关闭 Query 里用量未知的请求按预留上限（输入预留 + 输出预留）计，只会多算；Work Run 的用量未知或不完整、或请求的预留读不到时，计量停下。`,
      '已知缺口：Work Run 的压缩摘要请求在另一个 Kernel Session 里跑，不在 `activity/runs` 里，计量少算了它们；驱动不读数据库补数（lead 裁定 11-14 #3）。400M/50M 上限远高于预期用量，这是记下的缺口，不是阻断。',
      `最后一次完整读数时在途：Query ${inFlight.queries}，Work Run ${inFlight.runs}（Work Run 的用量要等 Run 结束才在 \`activity/runs\` 出现，所以超限后的停止点是第一次能看到超出的读数）。`,
      ...(this.stop?.cap === 'meter' ? [`计量不可用：${this.stop.message}`] : []),
      // P6（design-frozen.md:838）：实报输入和超预算退出原因各单列一行。
      `实报输入（平台报了用量的部分，不含按预留上限计的和未计费 0）：${used.reportedInput}；估算部分 ${used.input - used.reportedInput}。`,
      `超预算退出：整轮 ${this.stop === null ? '没有' : `${this.stop.cap}：${this.stop.message}`}；按场景/格 ${
        this.unitStops.size === 0 ? '没有' : [...this.unitStops.entries()].map(([unit, stop]) => `${unit}（${stop.message}）`).join('；')}。`,
      ...[...this.units.entries()].map(([unit, item]) => `${unit}：用量 ${item.input + item.output}（输入 ${item.input}，输出 ${item.output}，缓存命中 ${item.cached}；Query 请求 ${item.queryRequests}（其中按未计费 0 计的 ${item.unbilled}：provider 拒收，或驱动自己取消截断的请求；按预留上限计的 ${item.bounded}：Query 已关闭、用量未知），结束的 Run ${item.runs}；实报输入 ${item.reportedInput}）`),
    ];
  }
}
