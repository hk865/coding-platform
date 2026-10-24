/**
 * Request histories for the secretary-round rows (the P6 history edges, R-05, the transfer rows, a selection on a
 * superseded answer), built on the SE2 world (tests/helpers/S6A-host-fixture.ts). Every round is made by the
 * person's public steps (`requests/submit`, `requests/route` manual or `dropped`, `requests/select-idea`) and run by
 * the Host's own request-round driver; its answer is the scripted model's final text in the owner Session's queue,
 * queued before the step that makes the round. A builder waits for the owner read (`requestFacts.readRequest`,
 * bounded polling) to show the state it needs; no sleep, no record written by hand, no store read. A follow-up's
 * `continues` names the request root (the submit route refuses any other round); a route or a selection names any
 * round of the request.
 *
 * The rounds answer in the strict secretary JSON (`secretaryAnswer`), so the project must have both pointers
 * (`initializeProject`: an active completion policy and an adopted architecture) or the round would run
 * `initial_coordination`. Expected texts (cut answers, the earlier-round entries) belong to the rows.
 *
 * What the builders return is what public steps answered: the request root, the round refs from the receipts,
 * the Sessions, and the model requests the scripted model was sent (the secretary input of the last round).
 */
import type { ModelRequest } from '../../vendor/coding-agent/dist/public-api.js';
import type { SessionRef } from '../../src/contracts/core/identity.js';
import type { QueryJobRef } from '../../src/contracts/query-job.js';
import type { RequestCoreViewV1, RequestRoundStatus } from '../../src/core/work-graph/model/request-contracts.js';
import { ensureProjectPointers, type S6AHostWorld, type S6ASubmitInput } from './S6A-host-fixture.js';
import type { S6AGovernance } from './S6A-memory-fixture.js';
import { S6A_GOAL_1, type S6ASession } from './S6A-request-fixture.js';

// ---------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------

export type S6AIdea = { title: string; detail: string };

/** The strict secretary answer of a `semantic_query` round: one JSON object, no fences. */
export function secretaryAnswer(input: { body: string; ideas?: readonly S6AIdea[]; goalCardDrafts?: readonly unknown[] }): string {
  return JSON.stringify({ schemaVersion: 1, body: input.body, ideas: [...(input.ideas ?? [])],
    goalCardDrafts: [...(input.goalCardDrafts ?? [])] });
}

/** Three ideas with one-line titles; `prefix` keeps them apart between requests. */
export function threeIdeas(prefix: string): S6AIdea[] {
  return [1, 2, 3].map(index => ({ title: `${prefix} idea ${index}`, detail: `${prefix} detail of idea ${index}` }));
}

/** A 2,049-byte ASCII answer body (one byte over the 2,048-byte history cut). */
export const S6A_ANSWER_ASCII_2049 = 'a'.repeat(2049);
/**
 * A multi-byte answer body whose 2,048-byte cut falls inside a code point: 2,046 ASCII bytes, then `中` (three
 * bytes, 2,046–2,048), then more text; the whole-code-point cut keeps the 2,046 ASCII bytes.
 */
export const S6A_ANSWER_MULTIBYTE = `${'m'.repeat(2046)}中${'n'.repeat(100)}`;

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

/** What `requests/submit` answered for a queued round. */
export type S6ARound = { requestRoot: QueryJobRef; round: QueryJobRef; secretary: SessionRef | null };

const sameJob = (left: QueryJobRef, right: QueryJobRef): boolean => left.queryJobId === right.queryJobId;

/**
 * The project gets both pointers (policy and architecture; `ensureProjectPointers`, with the test's own governance
 * when it seeded the memory fixture), so secretary rounds run `semantic_query`.
 */
export async function initializeProject(world: S6AHostWorld, governance?: S6AGovernance): Promise<S6AGovernance> {
  return await ensureProjectPointers(world, governance);
}

/** `requests/submit`; fails unless the round is queued. */
export async function submitRound(world: S6AHostWorld, input: S6ASubmitInput): Promise<S6ARound> {
  const result = await world.submit(input);
  if (result.status !== 'queued') throw new Error(`S6A history: the submit ${input.commandId} was refused: ${JSON.stringify(result)}`);
  return { requestRoot: result.requestRoot, round: result.round, secretary: result.secretary };
}

/** The round's current status in the owner read, or null when the request does not list it. */
export function roundStatus(view: RequestCoreViewV1, round: QueryJobRef): RequestRoundStatus | null {
  return view.rounds.find(entry => sameJob(entry.ref, round))?.status ?? null;
}

/** Polls the owner read until the round reads `status`. */
export async function waitForRound(world: S6AHostWorld, requestRoot: QueryJobRef, round: QueryJobRef,
  status: RequestRoundStatus): Promise<RequestCoreViewV1> {
  return await world.waitForRequest(requestRoot, view => roundStatus(view, round) === status,
    `round ${round.queryJobId} to read ${status}`);
}

/**
 * One answered round: the owner's answer is queued first, then the round is submitted (on `session` by `@` for a
 * new request; a follow-up lands on the request's owner), then the builder waits until it reads `ended` with an
 * answer, not absorbed, run on `session` (a failed or cancelled round stops the builder here).
 */
export async function answeredRound(world: S6AHostWorld, input: { session: S6ASession; submit: S6ASubmitInput;
  answer: string }): Promise<S6ARound> {
  await world.scripted.script(input.session, [{ kind: 'text', text: input.answer }]);
  const round = await submitRound(world, input.submit);
  if (round.secretary === null || round.secretary.sessionId !== input.session.ref.sessionId) {
    throw new Error(`S6A history: ${input.submit.commandId} landed on ${JSON.stringify(round.secretary)}, not ${input.session.label}`);
  }
  const view = await waitForRound(world, round.requestRoot, round.round, 'ended');
  const ended = view.rounds.find(entry => sameJob(entry.ref, round.round));
  if (ended === undefined || ended.answer === null || ended.absorbedInto !== null
    || ended.session?.projectId !== input.session.ref.projectId
    || ended.session?.sessionId !== input.session.ref.sessionId) {
    throw new Error(`S6A history: expected an answer on ${input.session.label}: ${JSON.stringify(ended)}`);
  }
  return round;
}

/** A follow-up of the request (`continues` names its root) with no goal and no recipient: it lands on the owner. */
export const followUp = (commandId: string, requestRoot: QueryJobRef, text: string): S6ASubmitInput =>
  ({ commandId, goalId: null, text, continues: requestRoot, recipient: null });

/** A new request on goal 1 sent to `session` by `@`. */
export const newRequest = (commandId: string, session: S6ASession, text: string): S6ASubmitInput =>
  ({ commandId, goalId: S6A_GOAL_1.goalId, text, continues: null, recipient: session });

/** The last model request the Session's queue served (the secretary input of its last round). */
async function lastRequest(world: S6AHostWorld, session: S6ASession): Promise<ModelRequest> {
  const requests = await world.scripted.requests(session);
  const last = requests.at(-1);
  if (last === undefined) throw new Error(`S6A history: ${session.label} served no model request`);
  return last;
}

/** Routes the request to `to` and runs one answered follow-up there; returns it with its model request. */
async function finalRoundOn(world: S6AHostWorld, tag: string, requestRoot: QueryJobRef, to: S6ASession | null,
  session: S6ASession): Promise<{ round: S6ARound; request: ModelRequest }> {
  if (to !== null) {
    const routed = await world.route({ commandId: `${tag}-route`, round: requestRoot, to });
    if (routed.status !== 'routed') throw new Error(`S6A history: the route to ${to.label} was refused: ${JSON.stringify(routed)}`);
  }
  const round = await answeredRound(world, { session, answer: secretaryAnswer({ body: `${tag} final answer` }),
    submit: followUp(`${tag}-final`, requestRoot, `${tag} final question`) });
  return { round, request: await lastRequest(world, session) };
}

// ---------------------------------------------------------------------------
// Histories
// ---------------------------------------------------------------------------

/**
 * One request across A and B: a new request and a follow-up answered on A, the request routed to B, a follow-up
 * answered on B. `request` is B's secretary input.
 */
export async function buildRequestAcrossSessions(world: S6AHostWorld, input: { a: S6ASession; b: S6ASession; tag?: string }):
Promise<{ requestRoot: QueryJobRef; onA: QueryJobRef[]; onB: S6ARound; request: ModelRequest }> {
  const tag = input.tag ?? 's6a-across';
  const first = await answeredRound(world, { session: input.a, answer: secretaryAnswer({ body: `${tag} answer 1 on A` }),
    submit: newRequest(`${tag}-1`, input.a, `${tag} question 1`) });
  const second = await answeredRound(world, { session: input.a, answer: secretaryAnswer({ body: `${tag} answer 2 on A` }),
    submit: followUp(`${tag}-2`, first.requestRoot, `${tag} question 2`) });
  const final = await finalRoundOn(world, tag, first.requestRoot, input.b, input.b);
  return { requestRoot: first.requestRoot, onA: [first.round, second.round], onB: final.round, request: final.request };
}

/**
 * The ten-round edge: `count` (default 12) answered rounds on A (answers `<tag> answer <i> on A`), the request routed
 * to B, `earlierOnB` (default 1) answered rounds on B, then a final answered round on B. `request` is the final
 * round's secretary input: its earlier entries are A's latest ten; B's own rounds are not entries.
 */
export async function buildTenRoundEdge(world: S6AHostWorld, input: { a: S6ASession; b: S6ASession; count?: number;
  earlierOnB?: number; tag?: string }):
Promise<{ requestRoot: QueryJobRef; onA: QueryJobRef[]; onB: QueryJobRef[]; final: S6ARound; request: ModelRequest }> {
  const tag = input.tag ?? 's6a-ten';
  const onA: QueryJobRef[] = [];
  let requestRoot: QueryJobRef | null = null;
  for (let index = 1; index <= (input.count ?? 12); index += 1) {
    const round = await answeredRound(world, { session: input.a, answer: secretaryAnswer({ body: `${tag} answer ${index} on A` }),
      submit: requestRoot === null ? newRequest(`${tag}-a${index}`, input.a, `${tag} question ${index}`)
        : followUp(`${tag}-a${index}`, requestRoot, `${tag} question ${index}`) });
    requestRoot ??= round.requestRoot;
    onA.push(round.round);
  }
  if (requestRoot === null) throw new Error('S6A history: the ten-round edge needs at least one round on A');
  const routed = await world.route({ commandId: `${tag}-route`, round: requestRoot, to: input.b });
  if (routed.status !== 'routed') throw new Error(`S6A history: the route to B was refused: ${JSON.stringify(routed)}`);
  const onB: QueryJobRef[] = [];
  for (let index = 1; index <= (input.earlierOnB ?? 1); index += 1) {
    const round = await answeredRound(world, { session: input.b, answer: secretaryAnswer({ body: `${tag} answer ${index} on B` }),
      submit: followUp(`${tag}-b${index}`, requestRoot, `${tag} B question ${index}`) });
    onB.push(round.round);
  }
  const final = await finalRoundOn(world, tag, requestRoot, null, input.b);
  return { requestRoot, onA, onB, final: final.round, request: final.request };
}

/**
 * Absorbed inputs with a selected idea, on A: a new request answered with three ideas; then A's next claim is held
 * (gate a) while three inputs queue on A — a follow-up (the executing round), the selection of idea `index`
 * (default 1) of the first answer, and another follow-up — so the executing round's batch holds the other two;
 * released, it runs once and answers. With `routeTo`, the request is then routed there and one more round
 * answered: `request` is that round's secretary input, whose earlier entry is the executing round with its
 * absorbed rounds.
 */
export async function buildAbsorbedSelection(world: S6AHostWorld, input: { a: S6ASession; routeTo?: S6ASession;
  index?: number; tag?: string }): Promise<{ requestRoot: QueryJobRef; answered: QueryJobRef; ideas: S6AIdea[];
  executing: QueryJobRef; selection: QueryJobRef; plain: QueryJobRef; executingRequest: ModelRequest;
  request: ModelRequest | null }> {
  const tag = input.tag ?? 's6a-absorbed';
  const ideas = threeIdeas(tag);
  const first = await answeredRound(world, { session: input.a, answer: secretaryAnswer({ body: `${tag} answer with ideas`, ideas }),
    submit: newRequest(`${tag}-1`, input.a, `${tag} question with ideas`) });
  await world.scripted.script(input.a, [{ kind: 'text', text: secretaryAnswer({ body: `${tag} batch answer` }) }]);
  const claim = world.gates.beforeClaim(input.a);
  const executing = await submitRound(world, followUp(`${tag}-2`, first.requestRoot, `${tag} the executing input`));
  await claim.reached;
  const selected = await world.selectIdea({ commandId: `${tag}-select`, round: first.round, index: input.index ?? 1 });
  if (selected.status !== 'queued') throw new Error(`S6A history: the selection was refused: ${JSON.stringify(selected)}`);
  const plain = await submitRound(world, followUp(`${tag}-3`, first.requestRoot, `${tag} another queued input`));
  claim.release();
  await waitForRound(world, first.requestRoot, executing.round, 'ended');
  const executingRequest = await lastRequest(world, input.a);
  const final = input.routeTo === undefined ? null
    : await finalRoundOn(world, tag, first.requestRoot, input.routeTo, input.routeTo);
  return { requestRoot: first.requestRoot, answered: first.round, ideas, executing: executing.round,
    selection: selected.followupRound, plain: plain.round, executingRequest, request: final?.request ?? null };
}

/**
 * A round a drop ended on A: a new request answered on A; a follow-up on A whose next step is held — its claim
 * (`at: 'claim'`, gate a, the default) or its start after claim and prepare (`at: 'start'`, gate c); the request
 * dropped (the drop ends every unstarted round: the follow-up ends with close detail `dropped`, never entered); the
 * held step released (its guard finds the round ended); then a new follow-up sent to B by `@` and answered.
 * `request` is B's secretary input: the answered round on A is an earlier entry, the dropped one is not.
 */
export async function buildDropEndedRound(world: S6AHostWorld, input: { a: S6ASession; b: S6ASession;
  at?: 'claim' | 'start'; tag?: string }):
Promise<{ requestRoot: QueryJobRef; answered: QueryJobRef; dropped: QueryJobRef; onB: S6ARound; request: ModelRequest }> {
  const tag = input.tag ?? 's6a-dropped';
  const first = await answeredRound(world, { session: input.a, answer: secretaryAnswer({ body: `${tag} answer on A` }),
    submit: newRequest(`${tag}-1`, input.a, `${tag} question 1`) });
  const held = input.at === 'start' ? world.gates.beforeStart(input.a) : world.gates.beforeClaim(input.a);
  const pending = await submitRound(world, followUp(`${tag}-2`, first.requestRoot, `${tag} the input a drop ends`));
  await held.reached;
  const dropped = await world.drop({ commandId: `${tag}-drop`, round: pending.round });
  if (dropped.status !== 'routed') throw new Error(`S6A history: the drop was refused: ${JSON.stringify(dropped)}`);
  await waitForRound(world, first.requestRoot, pending.round, 'ended');
  held.release();
  await world.scripted.script(input.b, [{ kind: 'text', text: secretaryAnswer({ body: `${tag} answer on B` }) }]);
  const onB = await submitRound(world, { commandId: `${tag}-3`, goalId: null, text: `${tag} after the drop`,
    continues: first.requestRoot, recipient: input.b });
  await waitForRound(world, first.requestRoot, onB.round, 'ended');
  return { requestRoot: first.requestRoot, answered: first.round, dropped: pending.round, onB,
    request: await lastRequest(world, input.b) };
}

/**
 * Long UTF-8 answers on A — `S6A_ANSWER_ASCII_2049` then `S6A_ANSWER_MULTIBYTE` as the answer bodies — then the
 * request routed to B and one round answered there. `request` is B's secretary input with both earlier entries.
 */
export async function buildLongAnswers(world: S6AHostWorld, input: { a: S6ASession; b: S6ASession; tag?: string }):
Promise<{ requestRoot: QueryJobRef; ascii: QueryJobRef; multibyte: QueryJobRef; onB: S6ARound; request: ModelRequest }> {
  const tag = input.tag ?? 's6a-long';
  const ascii = await answeredRound(world, { session: input.a, answer: secretaryAnswer({ body: S6A_ANSWER_ASCII_2049 }),
    submit: newRequest(`${tag}-1`, input.a, `${tag} question 1`) });
  const multibyte = await answeredRound(world, { session: input.a, answer: secretaryAnswer({ body: S6A_ANSWER_MULTIBYTE }),
    submit: followUp(`${tag}-2`, ascii.requestRoot, `${tag} question 2`) });
  const final = await finalRoundOn(world, tag, ascii.requestRoot, input.b, input.b);
  return { requestRoot: ascii.requestRoot, ascii: ascii.round, multibyte: multibyte.round, onB: final.round,
    request: final.request };
}

/**
 * SQLite: a round still running on A reads not ended — A's round calls `list_files`, whose handler is held (the
 * call started, no result), the Host crashes and the new Host's reconcile leaves the round `unknown`; then the
 * request is routed to B and a round answered there. `request` is B's secretary input. The world grants the
 * secretary `list_files` (`secretaryTools: ['read', 'list_files']`): the tool gate wraps a platform tool, and the
 * held call stays unreleased (the abandoned Host never gets its result).
 */
export async function buildUnknownOnA(world: S6AHostWorld, input: { a: S6ASession; b: S6ASession; tag?: string }):
Promise<{ requestRoot: QueryJobRef; unknown: QueryJobRef; onB: S6ARound; request: ModelRequest }> {
  const tag = input.tag ?? 's6a-unknown';
  await world.scripted.script(input.a, [
    { kind: 'calls', calls: [{ callId: `${tag}-list`, name: 'list_files', args: {} }] },
    { kind: 'text', text: secretaryAnswer({ body: `${tag} never sent` }) },
  ]);
  const tool = await world.gates.toolCall(input.a, 'list_files');
  const first = await submitRound(world, newRequest(`${tag}-1`, input.a, `${tag} question on A`));
  await tool.reached;
  await world.crash();
  await waitForRound(world, first.requestRoot, first.round, 'unknown');
  const final = await finalRoundOn(world, tag, first.requestRoot, input.b, input.b);
  return { requestRoot: first.requestRoot, unknown: first.round, onB: final.round, request: final.request };
}

/**
 * A selection on a superseded answer: an answer with ideas and a later answered round of the same request (both
 * on A). Selecting an idea of `answered` is then a `revision_conflict`.
 */
export async function buildLaterAnswer(world: S6AHostWorld, input: { a: S6ASession; tag?: string }):
Promise<{ requestRoot: QueryJobRef; answered: QueryJobRef; ideas: S6AIdea[]; later: QueryJobRef }> {
  const tag = input.tag ?? 's6a-later';
  const ideas = threeIdeas(tag);
  const first = await answeredRound(world, { session: input.a, answer: secretaryAnswer({ body: `${tag} answer with ideas`, ideas }),
    submit: newRequest(`${tag}-1`, input.a, `${tag} question 1`) });
  const later = await answeredRound(world, { session: input.a, answer: secretaryAnswer({ body: `${tag} later answer` }),
    submit: followUp(`${tag}-2`, first.requestRoot, `${tag} question 2`) });
  return { requestRoot: first.requestRoot, answered: first.round, ideas, later: later.round };
}
