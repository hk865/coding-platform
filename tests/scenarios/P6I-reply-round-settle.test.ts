/**
 * P6I T1–T5 and T8 (p6i-rulings.md "分工和测试", p6i-rework-rulings.md "写测试方"; the real run is diagnosis.md §1–§4).
 *
 * T1/T2 (R1): a secretary request round asks the person one card with two options and one annotatable
 * object (`ask_person`); the person answers on the card path the way the page does (`decisions/answer`; a bare
 * option sends `text: ''`). The reply round on the request root must prepare, enter and answer. One secretary input
 * carries the decision body (the option, the person's exact text, the annotations), and the same input keeps the
 * question and the message id. The Work path's one composer renders the body as canonical JSON (Slice 5 §4.6), so the
 * expected text is the body written out by hand.
 * T3 (R2): the person's selected prompt pack folder is gone, a proven lasting refusal; the claimed round closes
 * `not_entered` with the refusal code and reason on `requests/read`, and the line takes the next request.
 * T4 (R3): `queries/cancel` of a round that is claimed (or prepared) and has not entered answers `stopped`.
 * T5 (R2): a refusal that clears by itself (one failed bind commit, read as `unavailable`) leaves the round waiting;
 * the same attempt (the same `runRef`) then runs and answers.
 * T8 (R2): a configuration refusal (the selected model has no key) is not settled; once the driver's own preparation
 * of the Run has answered `unsupported` and the person then saves the key, the same round runs.
 *
 * Real S6A Host, memory backend (no row is about storage), scripted secretary model; public routes and reads only.
 */
import { mkdtemp, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { roundOf } from '../helpers/FA-forms.js';
import { commitBarrier } from '../helpers/S6A-commit-barrier.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import {
  answeredRound, initializeProject, secretaryAnswer, submitRound, waitForRound, type S6ARound,
} from '../helpers/S6A-history-fixture.js';
import {
  openS6AHostWorld, queryStepCommitOn, type S6AHostWorld, type S6AReply,
} from '../helpers/S6A-host-fixture.js';
import { S6A_GOAL_1, S6A_SCOPE, type S6ASession } from '../helpers/S6A-request-fixture.js';
import { requestUserText } from '../helpers/S7B2-secretary-rounds.js';
import { ready } from '../helpers/S7A-fixture.js';
import { listed } from '../helpers/S7B-fixture.js';
import { claimWithSecretaryProfile, prepareAttempt, start } from '../helpers/request-claim-steps.js';
import { waitFor } from './harness.js';

vi.mock('../../src/core/record-store/in-memory-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).inMemoryBarrierModule(importOriginal));
vi.mock('../../src/core/record-store/sqlite-record-store.js', async (importOriginal) =>
  (await import('../helpers/S6A-commit-barrier.js')).sqliteBarrierModule(importOriginal));

/**
 * A3: the Runtime's real Query preparation, wrapped to note each refusal it answers (Run id and code) and return it
 * unchanged. T8 waits on it for the driver's own preparation; every other row ignores it.
 */
const preparationRefusals = vi.hoisted(() => [] as { runId: string; code: string }[]);
vi.mock('../../src/core/agent-runtime/query-preparation.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/agent-runtime/query-preparation.js')>();
  return { ...actual, createQueryPreparation: (...args: Parameters<typeof actual.createQueryPreparation>) => {
    const real = actual.createQueryPreparation(...args);
    return { ...real, async prepare(...call: Parameters<typeof real.prepare>) {
      const result = await real.prepare(...call);
      if (result.status === 'rejected') {
        preparationRefusals.push({ runId: call[1].queryRunRef.runId, code: result.code });
      }
      return result;
    } };
  } };
});

const LONG = 180_000;
const worlds: S6AHostWorld[] = [];
const folders: string[] = [];
afterEach(async () => {
  preparationRefusals.splice(0);
  commitBarrier.reset();
  for (const world of worlds.splice(0)) await world.close().catch(() => undefined);
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

const OPTION = 'p6i-rewrite-gate';
const OPTIONS = [
  { id: OPTION, label: 'rewrite the gate', effect: 'apply' },
  { id: 'p6i-keep-old', label: 'keep the old gate', effect: 'defer' },
];
/** The card's one annotatable object (goal 1 as seeded, revision 1) and its key: the object as canonical JSON. */
const OBJECT = { kind: 'aggregate', pin: { ref: S6A_GOAL_1, revision: 1 }, label: 'P6I the goal' };
const OBJECT_KEY = '{"kind":"aggregate","label":"P6I the goal","pin":{"ref":{"aggregateType":"Goal",'
  + '"goalId":"ag2b-goal","projectId":"ag2b-collab-project"},"revision":1}}';
const QUESTION = 'p6i-t12: which gate should the change take?';

type Annotation = { objectKey: string; text: string };

/** The decision body as canonical JSON (keys sorted, no spaces), written out by hand for the selected option. */
const decisionJson = (text: string, annotations: readonly Annotation[]): string => '{"annotations":['
  + annotations.map(note => `{"objectKey":${JSON.stringify(note.objectKey)},"text":${JSON.stringify(note.text)}}`)
    .join(',')
  + `],"kind":"user_decision_response","schemaVersion":1,"selection":{"kind":"option","optionId":"${OPTION}"},`
  + `"text":${JSON.stringify(text)}}`;

/** One scripted secretary model reply: the answer form with this body. */
const scriptedAnswer = (body: string): S6AReply => ({ kind: 'text', text: secretaryAnswer({ body }) });

/** A person's request on goal 1, sent to this secretary line. */
const requestTo = (label: string, secretary: S6ASession) =>
  ({ commandId: label, goalId: S6A_GOAL_1.goalId, text: `${label} request`, continues: null, recipient: secretary });

async function openSecretaryWorld(extraHostOptions: Record<string, unknown> = {}) {
  const world = await openS6AHostWorld({ backend: 'memory', extraHostOptions: { requestDriver: 'on', ...extraHostOptions } });
  worlds.push(world);
  await initializeProject(world);
  return { world, secretary: await world.createSecretary('p6i-secretary') };
}

/** A request round that asks the person one card (two options, one object), then answers the request. */
async function askThePerson(world: S6AHostWorld, secretary: S6ASession): Promise<S6ARound> {
  await world.scripted.script(secretary, [
    { kind: 'calls', calls: [{ callId: 'p6i-t12-ask', name: 'ask_person',
      args: { text: QUESTION, options: OPTIONS, objects: [OBJECT] } }] },
    scriptedAnswer('p6i-t12 asked the person'),
  ]);
  const round = await submitRound(world, requestTo('p6i-t12', secretary));
  await waitForRound(world, round.requestRoot, round.round, 'ended');
  return round;
}

/**
 * The person answers the secretary's waiting card on the card path: the option, the text and the annotations, pinned
 * at the card message's own revision plus the card's captured source pins (a message card accepts exactly those).
 * Answers the card message's id.
 */
async function answerTheCard(world: S6AHostWorld, secretary: S6ASession, text: string,
  annotations: readonly Annotation[]): Promise<string> {
  const asked = (await listed(world, 'outbox', secretary)).find(message => message.decision !== undefined);
  const card = (await s6aCardsWorkspace(world, S6A_SCOPE).readCards(S6A_GOAL_1)).find(candidate =>
    candidate.state === 'waiting_answer' && candidate.source.key === asked?.decision?.source.key);
  if (asked === undefined || card === undefined) throw new Error('P6I: the secretary\'s card is not waiting');
  ready((await world.post('decisions/answer', graphWrite(S6A_SCOPE, { source: card.source,
    selection: { kind: 'option', optionId: OPTION }, text, annotations }, 'p6i-t12-answer',
  [{ ref: asked.ref, revision: asked.revision }, ...card.source.pins]))).body, 'the card answer');
  return asked.ref.messageId;
}

describe('P6I R1: the reply round on a card answer', () => {
  it.each([
    ['T1 option only (the page sends text \'\')', '', []],
    ['T2 option, one sentence and one annotation', 'P6I also keep the old check',
      [{ objectKey: OBJECT_KEY, text: 'P6I look at the gate first' }]],
  ] as const)('%s: the reply round prepares and enters; one input carries the decision, the question and the message',
    async (_row, text, annotations) => {
      const { world, secretary } = await openSecretaryWorld();
      const asked = await askThePerson(world, secretary);
      await world.scripted.script(secretary, [scriptedAnswer('P6I reply round answer')]);
      const messageId = await answerTheCard(world, secretary, text, annotations);
      // A reply round whose preparation fails stays `running` with no close code and holds the line (diagnosis §3).
      const view = await world.waitForRequest(asked.requestRoot, current =>
        current.rounds.some(round => round.kind === 'reply' && round.status === 'ended'), 'the reply round to end');
      expect(view.rounds.find(round => round.kind === 'reply'))
        .toMatchObject({ answer: 'P6I reply round answer', closeCode: null });
      const inputs = (await world.scripted.requests(secretary)).map(requestUserText);
      const delivered = inputs.filter(input => input.includes(decisionJson(text, annotations)));
      expect(delivered, 'the decision body in one secretary input').toHaveLength(1);
      // The decision is delivered as the reply body, so the question and the message id stay beside it: a successor
      // line sees the question, and `record_decision_application` has the message.
      expect(delivered[0]).toContain(QUESTION);
      expect(delivered[0]).toContain(messageId);
    }, LONG);
});

describe('P6I R2: a claimed round whose preparation is refused', () => {
  it('T3: a lasting refusal (the selected prompt pack is gone) closes the round not_entered with the refusal; the line takes the next request', async () => {
    const settingsDirectory = await mkdtemp(join(tmpdir(), 'p6i-t3-settings-'));
    folders.push(settingsDirectory);
    const { world, secretary } = await openSecretaryWorld({ settings: { settingsDirectory } });
    const pack = 'p6i-person-pack';
    expect((await world.packs.create(pack)).status).toBe('ready');
    await world.packs.select(pack);
    // A person's pack lives in `<settings>/prompts/<packId>/`; with the folder moved away no preparation can resolve it.
    const folder = join(settingsDirectory, 'prompts', pack);
    const away = join(settingsDirectory, 'p6i-pack-away');
    await rename(folder, away);
    const refused = await submitRound(world, requestTo('p6i-t3-refused', secretary));
    const view = await world.waitForRequest(refused.requestRoot,
      current => roundOf(current, refused.round).status === 'ended', 'the refused round to be closed');
    const closed = roundOf(view, refused.round);
    expect(closed.answer).toBeNull();
    expect(closed.closeCode).toBe('not_entered');
    // The close message names the refusal code and its reason, the disk pack source's own sentence for a pack
    // folder that is not there (another fault of the same pack would read differently).
    expect(closed.closeMessage).toContain('invalid');
    expect(closed.closeMessage).toContain(`prompt pack ${pack} is not available`);
    // The line was released: with the folder back, the next request to the same line is queued (a held line refuses
    // it `busy`), claimed and answered.
    await rename(away, folder);
    await answeredRound(world, { session: secretary, answer: secretaryAnswer({ body: 'P6I T3 next answer' }),
      submit: requestTo('p6i-t3-next', secretary) });
  }, LONG);

  it('T5: a refusal that clears by itself (one failed bind commit) is not settled; the same attempt then runs', async () => {
    const { world, secretary } = await openSecretaryWorld();
    // A2: the first prepared-bind commit on the line fails once before the store; the counter proves it fired.
    const bind = queryStepCommitOn('prepared', secretary.ref);
    let failed = 0;
    commitBarrier.failCommitOnce(commit => { const hit = bind(commit); if (hit) failed += 1; return hit; });
    await world.scripted.script(secretary, [scriptedAnswer('P6I T5 answer')]);
    const claim = world.gates.beforeClaim(secretary);
    const round = await submitRound(world, requestTo('p6i-t5', secretary));
    await claim.reached;
    // The attempt before the fault: the Run the request read names while its claim waits.
    const before = roundOf(await world.readRequest(round.requestRoot), round.round).runRef;
    expect(before).not.toBeNull();
    claim.release();
    const view = await waitForRound(world, round.requestRoot, round.round, 'ended');
    expect(failed, 'the injected failure fired').toBe(1);
    expect(roundOf(view, round.round)).toMatchObject({ runRef: before, answer: 'P6I T5 answer', closeCode: null });
  }, LONG);

  it('T8: a configuration refusal (the selected model has no key) is not settled; once the key is saved the same round runs', async () => {
    const { world, secretary } = await openSecretaryWorld();
    // The person adds a model with no key and selects it for the workspace: no preparation finds a secret.
    const model = { label: 'P6I model without a key', provider: 'deepseek' as const, model: 'p6i-no-key-model' };
    const saved = await world.settings('models/save', model);
    const id = saved.status === 'ready' ? saved.value.models.find(entry => entry.label === model.label)?.id : undefined;
    if (id === undefined) throw new Error(`P6I T8: the model was not saved: ${JSON.stringify(saved)}`);
    expect((await world.settings('models/select', { scope: S6A_SCOPE, modelId: id })).status).toBe('ready');
    await world.scripted.script(secretary, [scriptedAnswer('P6I T8 answer')]);
    const round = await submitRound(world, requestTo('p6i-t8', secretary));
    const runRef = roundOf(await world.readRequest(round.requestRoot), round.round).runRef;
    // The sync point is the driver's own call: its real preparation of this Run answered `unsupported` (no key).
    await waitFor(async () => preparationRefusals.filter(seen => seen.runId === runRef?.runId),
      seen => seen.some(refusal => refusal.code === 'unsupported'), 'the driver\'s preparation to answer unsupported');
    // Only the setting changes: the person saves the key, and nothing else is written.
    expect((await world.settings('models/save', { id, ...model, apiKey: 'p6i-test-key' })).status).toBe('ready');
    const view = await waitForRound(world, round.requestRoot, round.round, 'ended');
    expect(roundOf(view, round.round)).toMatchObject({ runRef, answer: 'P6I T8 answer', closeCode: null });
  }, LONG);
});

describe('P6I R3: queries/cancel of a round that has not entered', () => {
  it.each(['claimed', 'prepared'] as const)('T4 (%s): the receipt says stopped, the round is closed, the line takes the next claim',
    async phase => {
      // The request driver is off, so nothing but the row moves the round: it stays claimed or prepared.
      const { world, secretary } = await openSecretaryWorld({ requestDriver: 'off' });
      const held = await submitRound(world, requestTo(`p6i-t4-${phase}`, secretary));
      expect((await claimWithSecretaryProfile(world, held.round, secretary, `p6i-t4-${phase}-claim`))['status'])
        .toBe('committed');
      if (phase === 'prepared') await prepareAttempt(world, held.round, `p6i-t4-${phase}-prepare`);
      const runRef = roundOf(await world.readRequest(held.requestRoot), held.round).runRef;
      expect((await world.post('queries/cancel', plain(S6A_SCOPE, { queryRunRef: runRef }))).body)
        .toMatchObject({ status: 'ready', value: { stop: 'stopped' } });
      const view = await world.waitForRequest(held.requestRoot,
        current => roundOf(current, held.round).status === 'ended', 'the cancelled round to be closed');
      expect(roundOf(view, held.round)).toMatchObject({ answer: null, closeCode: expect.any(String) });
      // The line is free: the next request to it is queued, its claim on the line commits, and the round answers.
      await world.scripted.script(secretary, [scriptedAnswer('P6I T4 next answer')]);
      const next = await submitRound(world, requestTo(`p6i-t4-${phase}-next`, secretary));
      expect((await claimWithSecretaryProfile(world, next.round, secretary, `p6i-t4-${phase}-next-claim`))['status'])
        .toBe('committed');
      await start(world, await prepareAttempt(world, next.round, `p6i-t4-${phase}-next-prepare`),
        `p6i-t4-${phase}-next-start`);
      const answered = await waitForRound(world, next.requestRoot, next.round, 'ended');
      expect(roundOf(answered, next.round).answer).toBe('P6I T4 next answer');
    }, LONG);
});
