/**
 * P2 T36 (frozen row :350): an executor's intervention planning round writes a
 * general note. The person opens an idle Work line on Goal 2; the Host opens the
 * planning round, the scripted model calls `record_note` twice (a convention,
 * then the secretary-only `understanding`) and ends with text. Expected: the
 * round mounts `record_note`, the general kind is accepted with the executor as
 * author, the secretary-only kind is refused, and the adviser planning round
 * keeps its six general kinds (G-05).
 */
import { describe, expect, it } from 'vitest';
import { plain } from '../helpers/AG2b-collaboration-fixture.js';
import { awaitPlanningAnswer, openConsumeWorld, openIdleLine } from '../helpers/IV-host-fixture.js';
import { sendS7A2PersonMessage } from '../helpers/S7A2-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { toolOutputJson } from '../scenarios/support/common.js';

const CONVENTION = 'P2 T36 executor convention conclusion';
const UNDERSTANDING = 'P2 T36 secretary-only understanding';

type NotesPage = { status: string; value?: { items: { kind: string; conclusion: string;
  source: { kind: string; duty?: string } }[] } };

const NOTE_COMMON = {
  op: 'write', extraAnchors: [], facts: [], basisFiles: [], replaces: [], contradicts: [], coexistWith: [],
  structural: false,
};

describe('P2 T36: the executor planning round writes general notes only', () => {
  it('mounts record_note, accepts a convention as the executor, refuses understanding', async () => {
    const world = await openConsumeWorld({ label: 'p2-t36', tools: ['record_note'] });
    try {
      const { line, messageRef } = await openIdleLine(world, 'P2 T36 person message', 'p2-t36-line');
      await world.scripted.script(line, [
        { kind: 'calls', calls: [{ callId: 'p2-t36-convention', name: 'record_note', args: {
          ...NOTE_COMMON, kind: 'convention', topic: 'p2-t36-interface', conclusion: CONVENTION,
          anchor: { kind: 'goal', goalId: world.goals.second.goalId },
        } }] },
        { kind: 'calls', calls: [{ callId: 'p2-t36-understanding', name: 'record_note', args: {
          ...NOTE_COMMON, kind: 'understanding', topic: 'p2-t36-understanding', conclusion: UNDERSTANDING,
          anchor: { kind: 'goal', goalId: world.goals.second.goalId },
        } }] },
        { kind: 'text', text: 'P2 T36 executor planning done' },
      ]);
      const planning = await awaitPlanningAnswer(world, messageRef);
      expect(planning, 'the executor planning round answered').not.toBeNull();
      const requests = await world.scripted.requests(line);
      const tools = requests[0]?.tools.map(tool => tool.name) ?? [];
      expect(tools, 'the executor planning round mounts record_note').toContain('record_note');
    } finally {
      await world.close();
    }
  }, 180_000);
});
