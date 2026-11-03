/**
 * S8E F1 F-shape (rulings §7.1, book :995): the flow's shape rules through the
 * person `notes/write` route. Shape is the first step and reads no workspace,
 * so the anchor is a module anchor and the step ids are placeholders: a
 * one-step flow, a twenty-one-step flow and a repeated step are each refused
 * with the flow's own shape code before any relation read.
 *
 * Each row is wrong in exactly one place. The named mutation (book :1141)
 * deletes `writeInputProblem`'s duplicate-step set, so the repeated-step row no
 * longer returns `flow_step_duplicate`. The last row builds two real current
 * links and gives the second step a `version`, so only its key set is wrong;
 * the mutation deletes `flowShapeProblem`'s `hasOnlyKeys` check and the flow is
 * accepted.
 */
import { describe, expect, it } from 'vitest';
import type { NoteDraftAnchorV1, NoteDraftV1 } from '../../src/contracts/note.js';
import {
  openS8ESemanticWorld, s8eLinkDraft, S8E_LINKS, type S8ESemanticWorld,
} from '../helpers/S8E-semantic-world.js';

type FlowDraft = Extract<NoteDraftV1, { kind: 'flow' }>;

/** A flow draft wrong only in `steps`; a module anchor keeps shape ahead of the relation step. */
function draftWithSteps(topic: string, steps: readonly string[]): FlowDraft {
  return {
    kind: 'flow', topic, conclusion: `${topic} conclusion`,
    anchor: { kind: 'module', moduleId: 'runtime' },
    extraAnchors: [], facts: [], basisFiles: [], structural: false,
    replaces: [], contradicts: [], coexistWith: [], body: '',
    flow: { steps: steps.map(link => ({ link })) },
  };
}

type ShapeRow = { readonly name: string; readonly steps: readonly string[]; readonly reason: string };

const rows: readonly ShapeRow[] = [
  {
    name: 'one step', steps: ['s8e-flow-step'], reason: 'flow_step_count',
  },
  {
    name: 'twenty-one steps',
    steps: Array.from({ length: 21 }, (_, index) => `s8e-flow-step-${String(index)}`),
    reason: 'flow_step_count',
  },
  {
    name: 'the same link twice', steps: ['s8e-flow-step', 's8e-flow-step'],
    reason: 'flow_step_duplicate',
  },
];

describe('S8E F1 F-shape: a flow wrong only in its steps is refused by shape', () => {
  it.each(rows)('$name is rejected invalid/$reason', async row => {
    const world: S8ESemanticWorld = await openS8ESemanticWorld({});
    try {
      const topic = `shape-${row.reason}-${String(row.steps.length)}`;
      const write = await world.writePerson(draftWithSteps(topic, row.steps));
      expect(write.status).toBe('rejected');
      if (write.status !== 'rejected') return;
      expect(write.code).toBe('invalid');
      expect(write.reason).toBe(row.reason);
    } finally {
      await world.close();
    }
  }, 120_000);
});

const GOAL_ID = 's8e-goal';
const K5_FROM: NoteDraftAnchorV1 = { kind: 'file', path: 'src/robot/teleop.py' };

describe('S8E F1 F-shape: a step carries only its link', () => {
  it('a step with version is rejected invalid/flow_step_count and writes no note', async () => {
    const world: S8ESemanticWorld = await openS8ESemanticWorld({});
    try {
      // Two real current links, so only the extra key on the second step is wrong.
      const first = await world.writePerson({ ...s8eLinkDraft(S8E_LINKS.K5),
        topic: 'shape-extra-key-link-1' }, { goalId: GOAL_ID });
      if (first.status !== 'accepted') throw new Error(`the first link was not accepted: ${JSON.stringify(first)}`);
      const second = await world.writePerson({ ...s8eLinkDraft(S8E_LINKS.K5),
        topic: 'shape-extra-key-link-2' }, { goalId: GOAL_ID });
      if (second.status !== 'accepted') throw new Error(`the second link was not accepted: ${JSON.stringify(second)}`);
      const topic = 'shape-extra-key-flow';
      const draft = {
        kind: 'flow', topic, conclusion: `${topic} conclusion`, anchor: K5_FROM,
        extraAnchors: [], facts: [], basisFiles: [], structural: false,
        replaces: [], contradicts: [], coexistWith: [], body: '',
        flow: { steps: [{ link: first.noteId }, { link: second.noteId, version: 1 }] },
      };
      const write = await world.writePerson(draft as unknown as NoteDraftV1);
      expect(write.status).toBe('rejected');
      if (write.status !== 'rejected') return;
      expect(write.code).toBe('invalid');
      expect(write.reason).toBe('flow_step_count');
      // The refused flow left no note at its anchor.
      const listed = await world.platform.notes.listNotes(world.humanContext(),
        { anchor: K5_FROM, state: 'accepted', limit: 50, cursor: null });
      expect(listed.status).toBe('ready');
      if (listed.status !== 'ready') return;
      expect(listed.value.items.map(item => item.topic)).not.toContain(topic);
    } finally {
      await world.close();
    }
  }, 120_000);
});
