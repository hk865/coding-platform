/**
 * P2 T23 (frozen `p2-frozen.md` line 337): the message record codec round-trips `wake`, `answeredBy`
 * and `entry`, no longer carries `intent`/`release`/`approvedAt`/`pins`, and a `query_run` reply
 * carries no `answerRef`. The record is built through the real owner path (the Host `messages/send`
 * route and the record constructors the owner uses), never a hand-made JSON record.
 *
 * `wake` has a real public writer (`messages/send`), and the `query_run` sender/reply shape is built
 * by `createSessionMessageRecord`/`nextSessionMessageRecord`. `answeredBy:'copy'` and `entry` have no
 * public writer in this tree (`ask_copy` absent; `entry` only from the UI boot), so they are
 * attempted through the frozen JSON entry and reported red at “入口还没有”.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { ArtifactRef } from '../../src/contracts/artifact.js';
import type { SourceRefV1 } from '../../src/contracts/dispatch.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import type { MessageQueryRoundSenderRecord, SessionMessageReadV1, SessionMessageRecord } from '../../src/contracts/mailbox.js';
import {
  bindMessageResponseCursor, createSessionMessageRecord, nextSessionMessageRecord,
} from '../../src/core/work-graph/state/message-machine.js';
import { makeCommitCursor } from '../../src/contracts/ledger.js';
import {
  decodeSessionMessageRecord, encodeSessionMessageRecord,
} from '../../src/core/work-graph/sessions/message-record-codecs.js';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import { s6aCardsWorkspace } from '../helpers/S6A-cards-fixture.js';
import { S6A_SCOPE, S6A_WORK_ROLE } from '../helpers/S6A-request-fixture.js';
import { adoptS6BPlan, createS6BLine } from '../helpers/S6B1-fixture.js';
import { s7aRecordInput } from '../helpers/S7A-message-fixtures.js';
import { ready, sessionOf } from '../helpers/S7A-fixture.js';
import { openS7BWorld } from '../helpers/S7B-fixture.js';
import type { S6AHostWorld } from '../helpers/S6A-host-fixture.js';

const PROJECT = 'P2T23';
const WORKSPACE = 'p2-t23-w';
const AT = '2026-11-21T00:00:00.000Z';
const SOURCE: SourceRefV1 = { kind: 'workspace', refId: WORKSPACE, revision: '1' };
const BODY: ArtifactRef = { kind: 'artifact', contentType: 'text/plain', digest: 'd', sizeBytes: 1, source: SOURCE };
function fieldsOf(value: object): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value)) out[key] = field;
  return out;
}
function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}
function sentRefOf(body: unknown): SessionMessageRecord['ref'] {
  const value = recordOf(recordOf(body)['value']);
  const ref = recordOf(value['ref']);
  const candidate = ref['aggregateType'] === 'SessionMessage' ? ref : value;
  const projectId = candidate['projectId'];
  const workspaceId = candidate['workspaceId'];
  const messageId = candidate['messageId'];
  if (candidate['aggregateType'] !== 'SessionMessage'
    || typeof projectId !== 'string' || typeof workspaceId !== 'string' || typeof messageId !== 'string') {
    throw new Error(`P2 T23: the send receipt carries no SessionMessageRef: ${JSON.stringify(body)}`);
  }
  return { aggregateType: 'SessionMessage', projectId, workspaceId, messageId };
}

const QUERY_ROUND: MessageQueryRoundSenderRecord = {
  kind: 'query_run',
  sessionRef: { projectId: PROJECT, sessionId: 'p2-t23-line' },
  queryRunRef: { aggregateType: 'QueryRun', projectId: PROJECT, workspaceId: WORKSPACE, queryJobId: 'p2-t23-q', runId: 'p2-t23-r' },
  generation: 1,
};

const worlds: S6AHostWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.close().catch(() => undefined); });

async function lineWorld(label: string): Promise<{ world: S6AHostWorld; goal: GoalRef; line: Awaited<ReturnType<typeof sessionOf>> }> {
  const opened = await openS7BWorld({ backend: 'memory' });
  worlds.push(opened.world);
  const ws = s6aCardsWorkspace(opened.world, S6A_SCOPE);
  const goal = (await (ws.createGoal(`p2-${label}-goal`, `P2 ${label} goal`))).ref;
  const { tasks } = await adoptS6BPlan(ws, goal, {
    label: `p2-${label}`, taskIds: [`p2-${label}-a`], role: S6A_WORK_ROLE.templateId,
  });
  const line = await sessionOf(opened.world, await createS6BLine(ws, {
    label: `p2-${label}-line`, role: S6A_WORK_ROLE, tasks,
  }));
  return { world: opened.world, goal, line };
}

describe('P2 T23: message codec fields', () => {
  it('round-trips wake through the owner path, and drops intent/release/approvedAt/pins', async () => {
    const { world, line } = await lineWorld('t23');
    // The frozen P2 entry accepts the three new fields on the person's send. This tree rejects each
    // unknown field, so the row is red at “入口还没有”, never at a hand-built record.
    const wakeBody = await world.post('messages/send', graphWrite(S6A_SCOPE, {
      recipient: line.ref, text: 'P2 T23 wake false', wake: false,
    }, 'p2-t23-wake', []));
    expect(wakeBody.body, 'T23: the send entry accepts wake').toMatchObject({ status: 'committed' });
    const answeredBody = await world.post('messages/send', graphWrite(S6A_SCOPE, {
      recipient: line.ref, text: 'P2 T23 copy question', answeredBy: 'copy',
    }, 'p2-t23-answered', []));
    expect(answeredBody.body, 'T23: the send entry accepts answeredBy').toMatchObject({ status: 'committed' });
    const enteredBody = await world.post('messages/send', graphWrite(S6A_SCOPE, {
      recipient: line.ref, text: 'P2 T23 direct intervention', entry: 'person_intervention',
    }, 'p2-t23-entry', []));
    expect(enteredBody.body, 'T23: the direct-intervention entry stores entry').toMatchObject({ status: 'committed' });

    // Each field is asserted on the message that carries it, never on one send standing in for the others.
    const readSent = async (body: unknown, label: string) => {
      const view = ready<SessionMessageReadV1>(await world.post('messages/view', plain(S6A_SCOPE, sentRefOf(body))),
        `the T23 ${label} message`);
      return view.message;
    };
    const roundTrip = (value: SessionMessageRecord) => {
      const decoded = decodeSessionMessageRecord(encodeSessionMessageRecord(value));
      expect(decoded.status, 'T23: the record decodes').toBe('decoded');
      if (decoded.status !== 'decoded') throw new Error('T23: the record did not decode');
      return decoded.value;
    };
    const noOldKeys = (value: object, where: string) => {
      const keys = Object.keys(value);
      for (const key of ['intent', 'release', 'approvedAt', 'pins']) {
        expect(keys, `T23: the ${where} record has no ${key} key`).not.toContain(key);
      }
    };

    const wakeStored = await readSent(wakeBody.body, 'wake');
    expect(fieldsOf(wakeStored)['wake'], 'T23: wake false survives the send').toBe(false);
    noOldKeys(wakeStored, 'wake');
    expect(fieldsOf(roundTrip(wakeStored))['wake'], 'T23: wake false round-trips').toBe(false);

    const answeredStored = await readSent(answeredBody.body, 'answeredBy');
    expect(fieldsOf(answeredStored)['answeredBy'], 'T23: answeredBy copy survives the send').toBe('copy');
    noOldKeys(answeredStored, 'answeredBy');
    expect(fieldsOf(roundTrip(answeredStored))['answeredBy'], 'T23: answeredBy copy round-trips').toBe('copy');

    const enteredStored = await readSent(enteredBody.body, 'entry');
    expect(fieldsOf(enteredStored)['entry'], 'T23: the person entry survives the send').toBe('person_intervention');
    noOldKeys(enteredStored, 'entry');
    expect(fieldsOf(roundTrip(enteredStored))['entry'], 'T23: entry round-trips').toBe('person_intervention');
  }, 120_000);

  it('round-trips a query_run sender and reply with no answerRef (the record constructors)', () => {
    const created = createSessionMessageRecord(s7aRecordInput({ sender: QUERY_ROUND, needsReply: true }));
    const replied = nextSessionMessageRecord(created, {
      kind: 'responded',
      response: { sender: QUERY_ROUND, bodyRef: BODY, sourceRef: SOURCE, respondedAt: AT },
      rejectedAt: null,
    });
    // The record constructors leave `responseSince` as an explicit pending null;
    // the codec expects the cursor the commit binds (ruling 11).
    const bound = bindMessageResponseCursor(replied, makeCommitCursor(1));
    const encoded = encodeSessionMessageRecord(bound);
    const decoded = decodeSessionMessageRecord(encoded);
    expect(decoded.status, 'T23: the query_run record decodes').toBe('decoded');
    if (decoded.status !== 'decoded') return;
    expect(decoded.value.sender, 'T23: the query_run sender round-trips').toEqual({
      kind: 'query_run',
      sessionRef: { projectId: PROJECT, sessionId: 'p2-t23-line' },
      queryRunRef: { aggregateType: 'QueryRun', projectId: PROJECT, workspaceId: WORKSPACE, queryJobId: 'p2-t23-q', runId: 'p2-t23-r' },
      generation: 1,
    });
    const response = decoded.value.response;
    expect(response, 'T23: the reply is stored').not.toBeNull();
    if (response === null) return;
    expect(response.sender.kind, 'T23: the replier is a query_run').toBe('query_run');
    expect(Object.keys(response.sender), 'T23: the reply sender has no answerRef key').not.toContain('answerRef');
    expect(response.sender, 'T23: the reply sender has no answerRef property').not.toHaveProperty('answerRef');
    const sentJson = (JSON.parse(encoded.json) as { response?: { sender?: Record<string, unknown> } }).response?.sender;
    expect(sentJson === undefined ? {} : Object.keys(sentJson), 'T23: the encoded reply sender has no answerRef')
      .not.toContain('answerRef');
  });
});
