// The driver's only way into the Host: the two public prefixes (`src/app/core-http-types.ts:173`,
// `src/app/host-settings-types.ts:17`) and the `x-platform-token` header (`core-http-types.ts:168`).
// The token lives in this object's private field only: it is never logged, written, put in a URL or argv.
import { createHash } from 'node:crypto';

export const CORE = '/api/real/core/';
export const SETTINGS = '/api/real/settings/';

/** A run-unique, readable request/command id. */
let counter = 0;
export function newId(prefix) {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

const digest = value => createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex').slice(0, 16);

/** The refs worth keeping from an answer: enough to walk the object chain, never a body. */
function refsOf(body) {
  if (body === null || typeof body !== 'object') return undefined;
  const value = body.value ?? body;
  const picked = {};
  for (const key of ['ref', 'requestRoot', 'round', 'followupRound', 'secretary', 'operationRef', 'sendStatus']) {
    if (value?.[key] !== undefined) picked[key] = value[key];
  }
  if (body.receipt?.plan !== undefined) picked.plan = body.receipt.plan;
  if (value?.binding?.goalRef !== undefined) picked.goalRef = value.binding.goalRef;
  if (value?.goal?.ref !== undefined) picked.goal = { ref: value.goal.ref, revision: value.goal.revision };
  return Object.keys(picked).length === 0 ? undefined : picked;
}

export class Client {
  #token;

  /** @param {{ base: string, token: string, label: string, log: { http(entry: object): void } }} options */
  constructor({ base, token, label, log }) {
    this.base = base;
    this.#token = token;
    this.label = label;
    this.log = log;
    this.quietCalls = 0;
    this.held = new Map();
  }

  async #send(method, path, body, meta) {
    const started = Date.now();
    let http = 0;
    let parsed = null;
    try {
      const response = await fetch(this.base + path, {
        method,
        headers: { 'content-type': 'application/json', 'x-platform-token': this.#token },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      http = response.status;
      const text = await response.text();
      try { parsed = text.length === 0 ? null : JSON.parse(text); } catch { parsed = { status: 'unparsed', text: text.slice(0, 400) }; }
    } catch (error) {
      parsed = { status: 'rejected', code: 'unavailable', reason: `transport: ${error.message}` };
    }
    const route = path.replace(/^\/api\/real\//, '');
    // A refusal the platform answered (spec §3 wall table, draft :238-240): its own line and its own wall row at once,
    // code and reason verbatim, also for the meter's quiet reads; a refusal the step expects is flagged, not dropped.
    const refused = http > 0 && parsed?.status === 'rejected';
    if (refused) {
      const at = new Date(started).toISOString();
      const expected = (meta.expect ?? []).includes(parsed.code);
      this.log.http({ at, ms: Date.now() - started, host: this.label, method, route, commandId: meta.commandId, http,
        status: parsed.status, code: parsed.code, reason: parsed.reason, expected, quiet: meta.quiet === true });
      this.log.wall({ at, route, commandId: meta.commandId ?? null, code: parsed.code, reason: parsed.reason, expected });
    } else if (meta.quiet) {
      this.quietCalls += 1;
    } else {
      this.#record({ at: new Date(started).toISOString(), ms: Date.now() - started, host: this.label, method,
        route, commandId: meta.commandId, http, status: parsed?.status, code: parsed?.code, reason: parsed?.reason,
        refs: refsOf(parsed), digest: meta.read ? digest(parsed) : undefined, input: meta.read ? digest(body) : undefined });
    }
    return { http, body: parsed };
  }

  /**
   * Successful polled reads (same route and input, same answer as the previous time) collapse into one line with a
   * repeat count and `lastAt`; the line is written when that read's answer changes or at `flush()`. Writes and every
   * refusal go out at once.
   */
  #record(entry) {
    if (entry.digest === undefined) { this.log.http(entry); return; }
    const key = `${entry.route}#${entry.input}`;
    const held = this.held.get(key);
    if (held !== undefined && held.digest === entry.digest) {
      held.repeat = (held.repeat ?? 1) + 1;
      held.lastAt = entry.at;
      return;
    }
    if (held !== undefined) this.log.http(held);
    this.held.set(key, entry);
  }

  flush() {
    for (const entry of this.held.values()) this.log.http(entry);
    this.held.clear();
  }

  /** POST /api/real/settings/<route>; the body is the input (`host-settings.ts`). */
  async settings(route, input, meta = {}) {
    return (await this.#send('POST', SETTINGS + route, input, { ...meta, read: route === 'snapshot' })).body;
  }

  /** A plain core read: `{scope, input}` (`core-routes.ts:925`). */
  async read(route, scope, input, meta = {}) {
    return (await this.#send('POST', CORE + route, { scope, input }, { ...meta, read: true })).body;
  }

  /** A plain core command (a write the route table marks `plain`, e.g. `requests/submit`). */
  async command(route, scope, input, meta = {}) {
    return (await this.#send('POST', CORE + route, { scope, input },
      { ...meta, commandId: input?.commandId ?? meta.commandId })).body;
  }

  /**
   * A `graph_write` route: `{scope, request:{input, meta:{requestId, expected}}}`. A `revision_conflict`
   * answer names the current revisions; the person's way is to re-read and send again, so one retry takes
   * them (the pins of `goals/control`, policy pointers and GoalPhase have no read route).
   */
  async write(route, scope, input, expected = [], meta = {}) {
    const requestId = meta.requestId ?? newId(route.replace(/\W+/g, '-'));
    let pins = expected;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { http, body } = await this.#send('POST', CORE + route,
        { scope, request: { input, meta: { requestId, expected: pins } } }, { ...meta, commandId: requestId });
      const current = body?.current;
      if (attempt === 0 && body?.code === 'revision_conflict' && Array.isArray(current) && current.length > 0) {
        pins = pins.map(pin => current.find(entry => JSON.stringify(entry.ref) === JSON.stringify(pin.ref)) ?? pin);
        continue;
      }
      return { ...body, http };
    }
  }

  /** GET (only `core/bootstrap` and the boards). */
  async get(path, meta = {}) {
    return (await this.#send('GET', path, undefined, { ...meta, read: true })).body;
  }

  /** Bookkeeping reads (the budget meter): counted, not logged line by line; a refusal is still its own line and row. */
  async quiet(route, scope, input) {
    return (await this.#send('POST', CORE + route, { scope, input }, { quiet: true })).body;
  }

  async quietGet(path) {
    return (await this.#send('GET', path, undefined, { quiet: true })).body;
  }
}

/** `{status:'ready', value}` → value; anything else → null. */
export const ready = body => (body?.status === 'ready' ? body.value : null);
export const committed = body => (body?.status === 'committed' ? body.value : null);
