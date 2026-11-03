/**
 * `lines/pin` (slice-2C-SPEC L9, L13): every `sessionRef` in `add` and `remove`
 * is a complete SessionRef, exactly `projectId` and `sessionId`. A malformed one
 * is refused at the owner's entry as `invalid` (HTTP 400, like the other graph
 * writes' bad input), never as the record codec's `unavailable` (HTTP 503), and
 * nothing is written: `lines/list` still shows the line unpinned and
 * `workspaces/registration` keeps the Workspace revision.
 *
 * Through the real Host's HTTP route as its operator (the S6A request world);
 * the line is a Work Session made by `sessions/create`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { graphWrite, plain } from '../helpers/AG2b-collaboration-fixture.js';
import {
  openS6ARequestWorld, S6A_SCOPE, type S6ARequestWorld, type S6ASession,
} from '../helpers/S6A-request-fixture.js';

let world: S6ARequestWorld;
let line: S6ASession;

beforeAll(async () => {
  world = await openS6ARequestWorld({ backend: 'memory' });
  line = await world.createWorkSession('pin-shape-line');
}, 60_000);

afterAll(async () => { await world?.close(); });

type Registration = { workspace: { ref: unknown; revision: number } };

async function registration(): Promise<Registration> {
  const answer = await world.post('workspaces/registration', plain(S6A_SCOPE, S6A_SCOPE));
  const body = answer.body as { status: string; value: Registration };
  if (body.status !== 'ready') throw new Error(`registration not ready: ${JSON.stringify(body)}`);
  return body.value;
}

async function pinnedOfLine(): Promise<boolean | undefined> {
  const answer = await world.post('lines/list', plain(S6A_SCOPE, { workspace: S6A_SCOPE }));
  const body = answer.body as { status: string; value: { rows: { key: { sessionId: string }; pinned: boolean }[] } };
  if (body.status !== 'ready') throw new Error(`lines/list not ready: ${JSON.stringify(body)}`);
  return body.value.rows.find(row => row.key.sessionId === line.ref.sessionId)?.pinned;
}

describe('rejects: a malformed sessionRef in lines/pin', () => {
  it.each([
    ['add carries an extra workspaceId', 'extra-add',
      () => ({ add: [{ ...line.ref, workspaceId: S6A_SCOPE.workspaceId }], remove: [] })],
    ['remove carries an extra workspaceId', 'extra-remove',
      () => ({ add: [], remove: [{ ...line.ref, workspaceId: S6A_SCOPE.workspaceId }] })],
    ['remove misses sessionId', 'missing-remove',
      () => ({ add: [], remove: [{ projectId: line.ref.projectId }] })],
  ])('%s is invalid (400) and changes nothing', async (_name, requestId, refs) => {
    const before = await registration();
    expect(await pinnedOfLine()).toBe(false);
    const answer = await world.post('lines/pin', graphWrite(S6A_SCOPE, { workspace: S6A_SCOPE, ...refs() },
      `pin-shape-${requestId}`, [{ ref: before.workspace.ref, revision: before.workspace.revision }]));
    expect(answer.httpStatus).toBe(400);
    expect(answer.body).toMatchObject({ status: 'rejected', code: 'invalid' });
    expect((await registration()).workspace.revision).toBe(before.workspace.revision);
    expect(await pinnedOfLine()).toBe(false);
  });
});
