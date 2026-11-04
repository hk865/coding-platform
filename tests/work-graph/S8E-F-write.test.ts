/**
 * S8E F1 F-write (rulings §7.1, book :996): the flow's write acceptance and its
 * real write refusals through the frozen entry layers.
 *
 * E1 is the real scribe Work Run's `record_note` (the world's `writeAgent` for
 * both links and flows, `tests/helpers/S8E-semantic-world.ts`); E2 is the person
 * `notes/write` route. The accepted three-step flow uses three real E1 links
 * K1/K2/K3 and then E1 `writeAgent`, with the flow anchor equal to K1's `from`.
 * The lead answer `.dsh-scratch/ask/a-f1-world-flow-arm-lead.md` added the one
 * `flow` arm to `recordNoteArgs`, so the payload reaches the tool's `flow`
 * argument. E2 is kept only for the person's general note in the not_link case.
 * The refusals each build their own prior state through a public write, so
 * every row fails alone.
 *
 * DR-8E F1-04: the step-order readback and "the flow is not rewritten after a
 * later supersede" belong to F2's F-flow-read; this row adds no reader and no
 * store assertion.
 *
 * DR-8E F1-03: no capture-ban assertion is made. 8E-2 G (§4.3 :819): the E-47
 * link writes use the real anchor path while the working-tree reads of their
 * four end files and the second tier both fail.
 */
import { describe, expect, it } from 'vitest';
import type { NoteDraftAnchorV1, NoteDraftV1 } from '../../src/contracts/note.js';
import type {
  NoteCheckV1, WriteNoteEnvelopeV1, WriteNoteResult,
} from '../../src/core/work-graph/model/note-contracts.js';
import {
  openS8ESemanticWorld, s8eLinkDraft, S8E_LINKS, type S8ELinkName, type S8ESemanticWorld,
} from '../helpers/S8E-semantic-world.js';

type FlowDraft = Extract<NoteDraftV1, { kind: 'flow' }>;

const RUN_MODEL: NoteDraftAnchorV1 = {
  kind: 'file', path: 'src/runtime/run.ts',
  symbolRequest: { language: 'typescript', name: 'runModel' },
};
const AUTHORIZE: NoteDraftAnchorV1 = {
  kind: 'file', path: 'src/wg/permit.ts',
  symbolRequest: { language: 'typescript', name: 'authorize' },
};
const DISPATCH: NoteDraftAnchorV1 = {
  kind: 'file', path: 'src/runtime/run.ts',
  symbolRequest: { language: 'typescript', name: 'dispatch' },
};
const TELEOP: NoteDraftAnchorV1 = { kind: 'file', path: 'src/robot/teleop.py' };

/** A flow draft with only the fields the row varies; lists default to empty. */
function flowDraft(input: {
  topic: string; anchor: NoteDraftAnchorV1; steps: readonly string[];
  extraAnchors?: readonly NoteDraftAnchorV1[]; structural?: boolean;
}): FlowDraft {
  return {
    kind: 'flow', topic: input.topic, conclusion: `${input.topic} conclusion`,
    anchor: input.anchor, extraAnchors: [...(input.extraAnchors ?? [])],
    facts: [], basisFiles: [], structural: input.structural ?? false,
    replaces: [], contradicts: [], coexistWith: [], body: '',
    flow: { steps: input.steps.map(link => ({ link })) },
  };
}

/** A general note used as the one non-link flow step (the E2 person write). */
function generalDraft(topic: string, anchor: NoteDraftAnchorV1): NoteDraftV1 {
  return {
    kind: 'convention', topic, conclusion: `${topic} conclusion`, anchor,
    extraAnchors: [], facts: [], basisFiles: [], structural: false,
    replaces: [], contradicts: [], coexistWith: [], body: `${topic} body`,
  };
}

/** One real E1 link; returns the receipt id the next write names. */
async function acceptedAgentLink(world: S8ESemanticWorld, name: S8ELinkName, label: string): Promise<string> {
  const written = await world.writeAgentLink(S8E_LINKS[name], { label });
  const write = written.envelope?.write;
  if (write === undefined) throw new Error(`the ${name} agent write returned no {write, check}`);
  if (write.status !== 'accepted') {
    throw new Error(`the ${name} agent link was not accepted: ${JSON.stringify(write)}`);
  }
  return write.noteId;
}

/** One real E1 `record_note` write; returns the Kernel-delivered envelope. */
async function agentEnvelope(world: S8ESemanticWorld, note: NoteDraftV1,
  label: string): Promise<WriteNoteEnvelopeV1> {
  const written = await world.writeAgent(note, { label });
  if (written.envelope === null) throw new Error(`the ${label} agent write returned no {write, check}`);
  return written.envelope;
}

/** The person's general-note setup write; returns its receipt id. */
async function acceptedPersonId(world: S8ESemanticWorld, note: NoteDraftV1, label: string): Promise<string> {
  const write = await world.writePerson(note);
  if (write.status !== 'accepted') {
    throw new Error(`the ${label} person write was not accepted: ${JSON.stringify(write)}`);
  }
  return write.noteId;
}

/** The write refusal the row names. */
function expectRefusal(write: WriteNoteResult, reason: string): void {
  expect(write.status).toBe('rejected');
  if (write.status !== 'rejected') return;
  expect(write.code).toBe('invalid');
  expect(write.reason).toBe(reason);
}

/** The write envelope's check, narrowed past the owner's `unavailable` arm. */
function checkOf(envelope: WriteNoteEnvelopeV1): NoteCheckV1 {
  const check = envelope.check;
  if (!('noteId' in check)) throw new Error(`the write check is unavailable: ${check.reason}`);
  return check;
}

type WriteRow = { readonly name: string; readonly run: (world: S8ESemanticWorld) => Promise<void> };

const rows: readonly WriteRow[] = [
  {
    name: 'a three-step flow of current links is accepted, version 1',
    run: async world => {
      // K1/K2/K3 and the flow are real E1 writes; the flow anchor is K1's `from`.
      const k1 = await acceptedAgentLink(world, 'K1', 'F-write-accepted-K1');
      const k2 = await acceptedAgentLink(world, 'K2', 'F-write-accepted-K2');
      const k3 = await acceptedAgentLink(world, 'K3', 'F-write-accepted-K3');
      const envelope = await agentEnvelope(world, flowDraft({
        topic: 'F-write-accepted-flow', anchor: RUN_MODEL, steps: [k1, k2, k3],
      }), 'F-write-accepted-flow');
      expect(envelope.write.status).toBe('accepted');
      if (envelope.write.status !== 'accepted') return;
      expect(envelope.write.version).toBe(1);
    },
  },
  {
    name: 'structural:true is refused invalid/structural_not_allowed',
    run: async world => {
      const k1 = await acceptedAgentLink(world, 'K1', 'F-write-structural-K1');
      const k2 = await acceptedAgentLink(world, 'K2', 'F-write-structural-K2');
      const envelope = await agentEnvelope(world, flowDraft({
        topic: 'F-write-structural-flow', anchor: RUN_MODEL, steps: [k1, k2], structural: true,
      }), 'F-write-structural-flow');
      expectRefusal(envelope.write, 'structural_not_allowed');
    },
  },
  {
    name: 'a general note as a step is refused invalid/flow_step_not_link',
    run: async world => {
      const k1 = await acceptedAgentLink(world, 'K1', 'F-write-not-link-K1');
      // The one E2 person write in this row: the non-link step.
      const general = await acceptedPersonId(world,
        generalDraft('F-write-not-link-general', RUN_MODEL), 'not-link general');
      const envelope = await agentEnvelope(world, flowDraft({
        topic: 'F-write-not-link-flow', anchor: RUN_MODEL, steps: [k1, general],
      }), 'F-write-not-link-flow');
      expectRefusal(envelope.write, 'flow_step_not_link');
    },
  },
  {
    name: 'a pending_review step is refused invalid/flow_step_not_current',
    run: async world => {
      const k1 = await acceptedAgentLink(world, 'K1', 'F-write-pending-K1');
      // The non-user write that contradicts a current link lands pending_review
      // (note-machine's contradiction reason), so it is a real pending step.
      const pending = await world.writeAgent(s8eLinkDraft(S8E_LINKS.K2, {
        topic: 'F-write-pending-step', contradicts: [k1],
      }), { label: 'F-write-pending-step' });
      const pendingWrite = pending.envelope?.write;
      if (pendingWrite === undefined) throw new Error('the pending step write returned no {write, check}');
      if (pendingWrite.status !== 'pending_review') {
        throw new Error(`the contradicting agent link did not land pending: ${JSON.stringify(pendingWrite)}`);
      }
      const envelope = await agentEnvelope(world, flowDraft({
        topic: 'F-write-pending-flow', anchor: RUN_MODEL, steps: [k1, pendingWrite.noteId],
      }), 'F-write-pending-flow');
      expectRefusal(envelope.write, 'flow_step_not_current');
    },
  },
  {
    name: 'an anchor that is not the first step from is refused invalid/flow_anchor_mismatch',
    run: async world => {
      const k1 = await acceptedAgentLink(world, 'K1', 'F-write-anchor-K1');
      const k2 = await acceptedAgentLink(world, 'K2', 'F-write-anchor-K2');
      // K1's `to`, not K1's `from` (the first step's from).
      const envelope = await agentEnvelope(world, flowDraft({
        topic: 'F-write-anchor-flow', anchor: AUTHORIZE, steps: [k1, k2],
      }), 'F-write-anchor-flow');
      expectRefusal(envelope.write, 'flow_anchor_mismatch');
    },
  },
  {
    name: 'an extra anchor that is none of the steps ends is refused invalid/flow_anchor_mismatch',
    run: async world => {
      const k1 = await acceptedAgentLink(world, 'K1', 'F-write-extra-K1');
      const k2 = await acceptedAgentLink(world, 'K2', 'F-write-extra-K2');
      const envelope = await agentEnvelope(world, flowDraft({
        topic: 'F-write-extra-flow', anchor: RUN_MODEL, steps: [k1, k2], extraAnchors: [TELEOP],
      }), 'F-write-extra-flow');
      expectRefusal(envelope.write, 'flow_anchor_mismatch');
    },
  },
  {
    name: 'E-47: two flows over [K1,K3], the second anchored at dispatch is refused flow_anchor_mismatch',
    run: async world => {
      // The analyzer is unavailable at write (8E-2 :819): the working-tree reads of
      // the four end files fail above maxBytes 1 (the existence probe passes, F13),
      // and the second tier fails. K1/K3 and both flows go through the real E1
      // record_note.
      world.linkCheck.faultReads(request => request.version.kind === 'working_tree' && request.maxBytes > 1
        && ['src/runtime/run.ts', 'src/wg/permit.ts', 'src/wg/audit.ts', 'src/contracts/access.ts'].includes(request.path)
        ? { status: 'rejected', code: 'unavailable', reason: 'the working tree cannot be read' }
        : null);
      world.linkCheck.faultVerify(() => ({ status: 'rejected', code: 'unavailable', reason: 'the second tier is down' }));
      const writtenK1 = await world.writeAgentLink(S8E_LINKS.K1, { label: 'F-write-E47-K1' });
      const writtenK3 = await world.writeAgentLink(S8E_LINKS.K3, { label: 'F-write-E47-K3' });
      world.linkCheck.faultReads(null);
      world.linkCheck.faultVerify(null);
      const k1 = writtenK1.envelope;
      const k3 = writtenK3.envelope;
      if (k1 === null || k3 === null) throw new Error('the E-47 links returned no {write, check}');
      // The stored endpoints keep the raw requests, so [K1,K3] are two distinct
      // endpoints. An unreadable end is not a miss (G2 :434): both are stored
      // analyzer_unavailable (evidence_unverifiable), and the check after the
      // write, its gate reads still failing, is unchecked/unavailable (R5 :357).
      // Mutation (8E-2 :819): G2 reads a failed read as no hit → K1 is refused
      // link_end_unresolved: extraAnchors[0], and the first `accepted` below is red.
      for (const envelope of [k1, k3]) {
        expect(envelope.write.status).toBe('accepted');
        if (envelope.write.status !== 'accepted') return;
        expect(envelope.write.warnings).toEqual(['evidence_unverifiable']);
        expect(checkOf(envelope).linkVerification)
          .toEqual({ status: 'unchecked', reason: 'unavailable' });
      }
      if (k1.write.status !== 'accepted' || k3.write.status !== 'accepted') return;
      const steps = [k1.write.noteId, k3.write.noteId];
      const first = await agentEnvelope(world, flowDraft({
        topic: 'F-write-E47-flow', anchor: RUN_MODEL, steps,
      }), 'F-write-E47-flow');
      expect(first.write.status).toBe('accepted');
      const second = await agentEnvelope(world, flowDraft({
        topic: 'F-write-E47-flow-dispatch', anchor: DISPATCH, steps,
      }), 'F-write-E47-flow-dispatch');
      expect(second.write.status).toBe('rejected');
      if (second.write.status !== 'rejected') return;
      expect(second.write.code).toBe('invalid');
      expect(second.write.reason).toBe('flow_anchor_mismatch');
    },
  },
];

describe('S8E F1 F-write: the flow is accepted and its real write refusals are named', () => {
  it.each(rows)('$name', async row => {
    const world: S8ESemanticWorld = await openS8ESemanticWorld({});
    try {
      await row.run(world);
    } finally {
      await world.close();
    }
  }, 180_000);
});
