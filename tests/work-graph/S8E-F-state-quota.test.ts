/**
 * S8E F1 F-state-quota (rulings §7.1, book :997): the flow's quota facts and
 * "accepted is a state, not verification".
 *
 * (i) 299 accepted links + 1 flow fill a goal's 300-note link/flow population;
 *     the 301st flow is still accepted on the human path and its receipt says
 *     `overQuota: true`.
 * (ii) 100 project flows fill the soft project-flow quota; the 101st flow is
 *     accepted and `overQuota: true`. DR-8E F1-05: the read-side "not a scan
 *     bound" half is F2's F-flow-read; this row adds no reader and no scan
 *     assertion.
 * (iii) an accepted link's write receipt and its stored verification are two
 *     separate facts: `accepted` is the state, `{status:'verified'}` is the
 *     link's write-time verification.
 * (iv) a write that replaces a current project flow counts against the
 *     population it replaces: a person's replacement at the quota is accepted
 *     with `overQuota: false`, and an agent's is accepted rather than
 *     `pending_review`.
 *
 * The populations are built by real public writes in the same world; the
 * replacement rows inject the world's existing small `projectFlowQuota` and no
 * second world helper is opened. The population rows carry an explicit generous
 * timeout and their durations are reported.
 */
import { describe, expect, it } from 'vitest';
import type { NoteDraftAnchorV1, NoteDraftV1 } from '../../src/contracts/note.js';
import type { NoteCheckV1, NoteItemV1, WriteNoteEnvelopeV1 } from '../../src/core/work-graph/model/note-contracts.js';
import {
  openS8ESemanticWorld, s8eLinkDraft, S8E_LINKS, type S8ESemanticWorld,
} from '../helpers/S8E-semantic-world.js';

type FlowDraft = Extract<NoteDraftV1, { kind: 'flow' }>;

const GOAL_ID = 's8e-goal';
// K5's plain file ends, range evidence and literal key open no capture, so the
// 299-link population is bounded; K1 would open a real TypeScript capture per link.
const K5_FROM: NoteDraftAnchorV1 = { kind: 'file', path: 'src/robot/teleop.py' };

/** A flow draft over the given step ids, anchored at the first step's `from` (K5). */
function flowDraft(topic: string, steps: readonly string[]): FlowDraft {
  return {
    kind: 'flow', topic, conclusion: `${topic} conclusion`, anchor: K5_FROM,
    extraAnchors: [], facts: [], basisFiles: [], structural: false,
    replaces: [], contradicts: [], coexistWith: [], body: '',
    flow: { steps: steps.map(link => ({ link })) },
  };
}

/** One person write expected to be accepted; returns the receipt's note id. */
async function acceptedId(world: S8ESemanticWorld, note: NoteDraftV1,
  goalId: string | null = null): Promise<string> {
  const write = await world.writePerson(note, { goalId });
  if (write.status !== 'accepted') {
    throw new Error(`expected accepted, got ${JSON.stringify(write)}`);
  }
  return write.noteId;
}

/** The public owner read of a note. */
async function itemOf(world: S8ESemanticWorld, noteId: string): Promise<NoteItemV1> {
  const read = await world.platform.notes.readNote(world.humanContext(), { noteId });
  if (read.status !== 'ready') throw new Error(`the note ${noteId} was not readable: ${read.status}`);
  return read.value;
}

/** The write envelope's check, narrowed past the owner's `unavailable` arm. */
function checkOf(envelope: WriteNoteEnvelopeV1): NoteCheckV1 {
  const check = envelope.check;
  if (!('noteId' in check)) throw new Error(`the write check is unavailable: ${check.reason}`);
  return check;
}

type QuotaRow = { readonly name: string; readonly run: (world: S8ESemanticWorld) => Promise<void> };

const rows: readonly QuotaRow[] = [
  {
    name: 'the 301st flow of a 300-note goal is accepted and over quota',
    run: async world => {
      // The goal population counts link + flow heads, so every population write
      // is goal-attached (writePerson defaults goalId to null). K5 is the
      // literal-only link: same anchors, topic is the only variation.
      const ids: string[] = [];
      for (let index = 0; index < 299; index += 1) {
        ids.push(await acceptedId(world,
          { ...s8eLinkDraft(S8E_LINKS.K5), topic: `t${String(index)}` }, GOAL_ID));
      }
      const steps = [ids[0]!, ids[1]!];
      await acceptedId(world, flowDraft('population-flow-300', steps), GOAL_ID);
      const write = await world.writePerson(flowDraft('population-flow-301', steps), { goalId: GOAL_ID });
      expect(write.status).toBe('accepted');
      if (write.status !== 'accepted') return;
      expect(write.overQuota).toBe(true);
    },
  },
  {
    name: 'the 101st project flow is accepted and over quota',
    run: async world => {
      // The same goal attachment as (i); 102 link/flow heads stay under the
      // goal's 300, so the project's 100-flow soft quota is the only one exceeded.
      const k1 = await acceptedId(world, { ...s8eLinkDraft(S8E_LINKS.K5), topic: 'project-flow-K1' }, GOAL_ID);
      const k2 = await acceptedId(world, { ...s8eLinkDraft(S8E_LINKS.K5), topic: 'project-flow-K2' }, GOAL_ID);
      const steps = [k1, k2];
      for (let index = 0; index < 100; index += 1) {
        await acceptedId(world, flowDraft(`project-flow-${String(index)}`, steps), GOAL_ID);
      }
      const write = await world.writePerson(flowDraft('project-flow-101', steps), { goalId: GOAL_ID });
      expect(write.status).toBe('accepted');
      if (write.status !== 'accepted') return;
      expect(write.overQuota).toBe(true);
    },
  },
  {
    name: 'accepted is a state, not verification: the link item and check stay verified',
    run: async world => {
      const envelope = await world.writePersonEnvelope(
        s8eLinkDraft(S8E_LINKS.K1, { topic: 'accepted-not-verified' }));
      expect(envelope.write.status).toBe('accepted');
      if (envelope.write.status !== 'accepted') return;
      // Two separate facts: the committed state and the link's verification.
      expect(checkOf(envelope).linkVerification).toEqual({ status: 'verified' });
      const item = await itemOf(world, envelope.write.noteId);
      expect(item.link?.verification).toEqual({ status: 'verified' });
    },
  },
];

/** The project's small soft flow quota the replacement rows fill. */
const REPLACEMENT_QUOTA = 2;

const replacementRows: readonly QuotaRow[] = [
  {
    name: 'a person replacing a current project flow at the quota is accepted and not over quota',
    run: async world => {
      const k1 = await acceptedId(world, { ...s8eLinkDraft(S8E_LINKS.K5), topic: 'replacement-link-1' });
      const k2 = await acceptedId(world, { ...s8eLinkDraft(S8E_LINKS.K5), topic: 'replacement-link-2' });
      const steps = [k1, k2];
      const replaced = await acceptedId(world, flowDraft('replacement-flow-1', steps));
      await acceptedId(world, flowDraft('replacement-flow-2', steps));
      const write = await world.writePerson({ ...flowDraft('replacement-flow-3', steps), replaces: [replaced] });
      expect(write.status).toBe('accepted');
      if (write.status !== 'accepted') return;
      expect(write.overQuota).toBe(false);
    },
  },
  {
    name: 'an agent replacing its current project flow at the quota is accepted, not pending',
    run: async world => {
      const k1 = await acceptedId(world, { ...s8eLinkDraft(S8E_LINKS.K5), topic: 'agent-replacement-link-1' });
      const k2 = await acceptedId(world, { ...s8eLinkDraft(S8E_LINKS.K5), topic: 'agent-replacement-link-2' });
      const steps = [k1, k2];
      await acceptedId(world, flowDraft('agent-replacement-flow-1', steps));
      // The replaced flow is the agent's own: replacing a person's current flow
      // adds the separate `user_note_replaced` review reason.
      const own = await world.writeAgent(flowDraft('agent-replacement-flow-2', steps),
        { label: 'agent-replacement-flow-2' });
      const ownWrite = own.envelope?.write;
      if (ownWrite === undefined) throw new Error('the agent flow write returned no {write, check}');
      expect(ownWrite.status).toBe('accepted');
      if (ownWrite.status !== 'accepted') return;
      const write = await world.writeAgent({ ...flowDraft('agent-replacement-flow-3', steps),
        replaces: [ownWrite.noteId] }, { label: 'agent-replacement-flow-3' });
      const replacement = write.envelope?.write;
      if (replacement === undefined) throw new Error('the replacing agent flow returned no {write, check}');
      expect(replacement.status).toBe('accepted');
    },
  },
];

describe('S8E F1 F-state-quota: a replacement counts against the population it replaces', () => {
  it.each(replacementRows)('$name', async row => {
    const world: S8ESemanticWorld = await openS8ESemanticWorld({
      noteLimits: { projectFlowQuota: REPLACEMENT_QUOTA },
    });
    try {
      await row.run(world);
    } finally {
      await world.close();
    }
  }, 120_000);
});

describe('S8E F1 F-state-quota: the flow quotas and accepted vs verified', () => {
  it.each(rows)('$name', async row => {
    const world: S8ESemanticWorld = await openS8ESemanticWorld({});
    try {
      await row.run(world);
    } finally {
      await world.close();
    }
  }, 180_000);
});
