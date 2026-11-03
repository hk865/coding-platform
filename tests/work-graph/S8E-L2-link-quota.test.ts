/**
 * S8E L2 W-family-quota (sheet §6.2): the four families' `replaces_kind_mismatch`
 * rule and the three new quotas, by the post-commit receipt's `overQuota`.
 *
 * Both frozen entry layers run the same quota arithmetic: E1 is the real Work
 * Run's `record_note` (the world's `writeAgentLink`, a scripted model inside
 * `driveWorkflow`), E2 is the person `notes/write` route. Person writes are the
 * user path, so they never refuse on quota (book :449–450) and their receipts
 * carry the committed population (book :444–454); an agent link at a full
 * projection lands pending, so its receipt reports `overQuota` for that
 * admission (state/reason belong to C-state and are not asserted here). IDs
 * come only from receipts; the old note's public item comes from the E5 owner
 * `readNote`. Small quotas are the world's `noteLimits` wrapper around the real
 * platform factory (DR-8E L2-04).
 */
import { describe, expect, it } from 'vitest';
import type { NoteDraftV1, NoteSectionsV1 } from '../../src/contracts/note.js';
import type { NoteItemV1 } from '../../src/core/work-graph/model/note-contracts.js';
import {
  openS8ESemanticWorld, s8eLinkDraft, S8E_LINKS, type S8ELinkName, type S8ESemanticWorld,
} from '../helpers/S8E-semantic-world.js';

const GOAL_ID = 's8e-goal';
const GOAL_ANCHOR = { kind: 'goal' as const, goalId: GOAL_ID };
const RUN_FILE = 'src/runtime/run.ts';

const SECTIONS: NoteSectionsV1 = { status: '现状', decided: '已定', open: '未决', next: '下一步', risks: '风险' };

function generalDraft(topic: string): NoteDraftV1 {
  return {
    kind: 'pitfall', topic, conclusion: `${topic} conclusion`,
    anchor: { kind: 'file', path: RUN_FILE },
    extraAnchors: [], facts: [], basisFiles: [], structural: false,
    replaces: [], contradicts: [], coexistWith: [], body: `${topic} body`,
  };
}

/** A goal understanding with the shared file extra anchor the link also names. */
function understandingDraft(topic: string): NoteDraftV1 {
  return {
    kind: 'understanding', topic, conclusion: `${topic} conclusion`,
    anchor: GOAL_ANCHOR, extraAnchors: [{ kind: 'file', path: RUN_FILE }],
    facts: [], basisFiles: [], structural: false,
    replaces: [], contradicts: [], coexistWith: [], sections: { ...SECTIONS },
  };
}

async function acceptedId(world: S8ESemanticWorld, note: NoteDraftV1,
  options: { goalId?: string | null; expectedPointerRevision?: number | null } = {}): Promise<string> {
  const write = await world.writePerson(note, options);
  if (write.status !== 'accepted') {
    throw new Error(`S8E quota setup expected accepted, got ${JSON.stringify(write)}`);
  }
  return write.noteId;
}

/** One link through the real Run's `record_note`; returns the committed/queued write receipt. */
async function agentLink(world: S8ESemanticWorld, name: S8ELinkName, label: string) {
  const written = await world.writeAgentLink(S8E_LINKS[name], { label });
  const write = written.envelope?.write;
  if (write === undefined || write.status === 'rejected') {
    throw new Error(`S8E quota agent link ${label} was refused: ${JSON.stringify(write)}`);
  }
  return write;
}

async function readNote(world: S8ESemanticWorld, noteId: string): Promise<NoteItemV1> {
  const read = await world.platform.notes.readNote(world.humanContext(), { noteId });
  if (read.status !== 'ready') throw new Error(`S8E readNote(${noteId}) is not ready: ${JSON.stringify(read)}`);
  return read.value;
}

describe('S8E L2 W-family-quota: families and quotas', () => {
  /**
   * One row per family rule: link may replace only a link; general, understanding
   * and repair keep their own families (book :430–434).
   */
  const familyRows: { name: string; run: (world: S8ESemanticWorld) => Promise<void> }[] = [
    {
      name: 'link replacing a general note on the same topic is replaces_kind_mismatch',
      run: async world => {
        const generalId = await acceptedId(world, generalDraft('family-general'));
        const draft = s8eLinkDraft(S8E_LINKS.K1, { topic: 'family-general', replaces: [generalId] });
        const write = await world.writePerson(draft);
        expect(write).toMatchObject({ status: 'rejected', code: 'invalid', reason: 'replaces_kind_mismatch' });
      },
    },
    {
      name: 'link replacing a link is accepted and supersedes the old item',
      run: async world => {
        const oldId = await acceptedId(world, s8eLinkDraft(S8E_LINKS.K1, { topic: 'family-link-old' }));
        const draft = s8eLinkDraft(S8E_LINKS.K1, {
          topic: 'family-link-new', replaces: [oldId],
        });
        const write = await world.writePerson(draft);
        expect(write.status).toBe('accepted');
        if (write.status !== 'accepted') return;
        expect(write.overQuota).toBe(false);
        expect((await readNote(world, oldId)).storedState).toBe('superseded');
      },
    },
    {
      name: 'link replacing a goal understanding with the same file anchor is replaces_kind_mismatch',
      run: async world => {
        const understandingId = await acceptedId(world, understandingDraft('family-understanding'),
          { goalId: GOAL_ID });
        const draft = s8eLinkDraft(S8E_LINKS.K1, {
          topic: 'family-understanding', replaces: [understandingId],
        });
        const write = await world.writePerson(draft);
        expect(write).toMatchObject({ status: 'rejected', code: 'invalid', reason: 'replaces_kind_mismatch' });
      },
    },
  ];

  it.each(familyRows)('$name', async ({ run }) => {
    const world = await openS8ESemanticWorld({ scribeTasks: 1 });
    try {
      await run(world);
    } finally {
      await world.close();
    }
  }, 180_000);

  /**
   * The quota table: each row proves one quota by the receipt's `overQuota`.
   * The two anchor quotas and the two goal quotas are independent.
   */
  const quotaRows: {
    name: string; noteLimits: { anchorLinkQuota?: number; anchorQuota?: number; goalQuota?: number;
      goalLinkQuota?: number };
    run: (world: S8ESemanticWorld) => Promise<void>;
  }[] = [
    {
      name: 'anchorLinkQuota:1 — one current link, the person link is accepted and over quota',
      noteLimits: { anchorLinkQuota: 1 },
      run: async world => {
        await acceptedId(world, s8eLinkDraft(S8E_LINKS.K1, { topic: 'anchor-link-one' }));
        const write = await world.writePerson(s8eLinkDraft(S8E_LINKS.K2, { topic: 'anchor-link-two' }));
        expect(write.status).toBe('accepted');
        if (write.status !== 'accepted') return;
        expect(write.overQuota).toBe(true);
      },
    },
    {
      name: 'anchorQuota:2 — two general notes on the anchor, the first link is not over quota',
      noteLimits: { anchorQuota: 2 },
      run: async world => {
        await acceptedId(world, generalDraft('anchor-general-one'));
        await acceptedId(world, generalDraft('anchor-general-two'));
        const write = await world.writePerson(s8eLinkDraft(S8E_LINKS.K1, { topic: 'anchor-general-link' }));
        expect(write.status).toBe('accepted');
        if (write.status !== 'accepted') return;
        expect(write.overQuota).toBe(false);
      },
    },
    {
      name: 'goalQuota:1 — one general note in the goal, the later link is not over quota',
      noteLimits: { goalQuota: 1 },
      run: async world => {
        await acceptedId(world, generalDraft('goal-general-one'), { goalId: GOAL_ID });
        const write = await world.writePerson(s8eLinkDraft(S8E_LINKS.K1, { topic: 'goal-general-link' }),
          { goalId: GOAL_ID });
        expect(write.status).toBe('accepted');
        if (write.status !== 'accepted') return;
        expect(write.overQuota).toBe(false);
      },
    },
    {
      name: 'goalLinkQuota:2 — two current links in the goal, the third link is over quota',
      noteLimits: { goalLinkQuota: 2 },
      run: async world => {
        await acceptedId(world, s8eLinkDraft(S8E_LINKS.K1, { topic: 'goal-link-one' }), { goalId: GOAL_ID });
        await acceptedId(world, s8eLinkDraft(S8E_LINKS.K2, { topic: 'goal-link-two' }), { goalId: GOAL_ID });
        const write = await world.writePerson(s8eLinkDraft(S8E_LINKS.K3, { topic: 'goal-link-three' }),
          { goalId: GOAL_ID });
        expect(write.status).toBe('accepted');
        if (write.status !== 'accepted') return;
        expect(write.overQuota).toBe(true);
      },
    },
    {
      name: 'anchorLinkQuota:1 — after one current link the agent link is not over quota, the person link is',
      noteLimits: { anchorLinkQuota: 1 },
      run: async world => {
        await acceptedId(world, s8eLinkDraft(S8E_LINKS.K1, { topic: 'agent-anchor-link-one' }));
        // The agent lands pending (quota_full's state is C-state), and the
        // receipt reports the projection it was admitted in: not over quota.
        const agent = await agentLink(world, 'K4', 'agent-anchor-link');
        expect(agent.overQuota).toBe(false);
        const person = await world.writePerson(s8eLinkDraft(S8E_LINKS.K3, { topic: 'agent-anchor-link-person' }));
        expect(person.status).toBe('accepted');
        if (person.status !== 'accepted') return;
        expect(person.overQuota).toBe(true);
      },
    },
    {
      name: 'anchorQuota:2 — two general notes fill the anchor, the agent link is not over quota',
      noteLimits: { anchorQuota: 2 },
      run: async world => {
        await acceptedId(world, generalDraft('agent-anchor-general-one'));
        await acceptedId(world, generalDraft('agent-anchor-general-two'));
        const agent = await agentLink(world, 'K1', 'agent-anchor-general-link');
        expect(agent.overQuota).toBe(false);
      },
    },
    {
      name: 'goalQuota:1 — one general note in the goal, the agent link is not over quota',
      noteLimits: { goalQuota: 1 },
      run: async world => {
        await acceptedId(world, generalDraft('agent-goal-general-one'), { goalId: GOAL_ID });
        const agent = await agentLink(world, 'K1', 'agent-goal-general-link');
        expect(agent.overQuota).toBe(false);
      },
    },
    {
      name: 'goalLinkQuota:2 — two current links in the goal, the agent third link is over quota',
      noteLimits: { goalLinkQuota: 2 },
      run: async world => {
        await acceptedId(world, s8eLinkDraft(S8E_LINKS.K1, { topic: 'agent-goal-link-one' }), { goalId: GOAL_ID });
        await acceptedId(world, s8eLinkDraft(S8E_LINKS.K2, { topic: 'agent-goal-link-two' }), { goalId: GOAL_ID });
        const agent = await agentLink(world, 'K3', 'agent-goal-link-three');
        expect(agent.overQuota).toBe(true);
      },
    },
  ];

  it.each(quotaRows)('$name', async ({ noteLimits, run }) => {
    const world = await openS8ESemanticWorld({ scribeTasks: 1, noteLimits });
    try {
      await run(world);
    } finally {
      await world.close();
    }
  }, 180_000);

  /**
   * The read side of the anchor-link and goal quotas: the committed
   * receipt's `overQuota` and the public `readNote` must agree (book :193–195,
   * :453). Both links in A sit on K1's own anchor, so only the link anchor
   * population can make the second one over quota.
   */
  it('read side A: anchorLinkQuota:1 — the second current link on one anchor is over quota on the receipt and the read', async () => {
    const world = await openS8ESemanticWorld({ scribeTasks: 1, noteLimits: { anchorLinkQuota: 1 } });
    try {
      await acceptedId(world, s8eLinkDraft(S8E_LINKS.K1, { topic: 'read-anchor-link-one' }));
      const write = await world.writePerson(s8eLinkDraft(S8E_LINKS.K1, { topic: 'read-anchor-link-two' }));
      expect(write.status).toBe('accepted');
      if (write.status !== 'accepted') return;
      expect(write.overQuota).toBe(true);
      expect((await readNote(world, write.noteId)).overQuota).toBe(true);
    } finally {
      await world.close();
    }
  }, 180_000);

  it('read side B: goalQuota:1 — the link after two general notes in the goal is not over quota on the receipt and the read', async () => {
    const world = await openS8ESemanticWorld({ scribeTasks: 1, noteLimits: { goalQuota: 1 } });
    try {
      await acceptedId(world, generalDraft('read-goal-general-one'), { goalId: GOAL_ID });
      await acceptedId(world, generalDraft('read-goal-general-two'), { goalId: GOAL_ID });
      const write = await world.writePerson(s8eLinkDraft(S8E_LINKS.K1, { topic: 'read-goal-link' }),
        { goalId: GOAL_ID });
      expect(write.status).toBe('accepted');
      if (write.status !== 'accepted') return;
      expect(write.overQuota).toBe(false);
      expect((await readNote(world, write.noteId)).overQuota).toBe(false);
    } finally {
      await world.close();
    }
  }, 180_000);

  it('E-44: the person link contradicting a user-confirmed note is accepted and over quota', async () => {
    const world = await openS8ESemanticWorld({ scribeTasks: 1, noteLimits: { anchorLinkQuota: 1 } });
    try {
      const confirmedId = await acceptedId(world, s8eLinkDraft(S8E_LINKS.K1, { topic: 'e44-confirmed' }));
      const confirmed = await readNote(world, confirmedId);
      expect(confirmed.confirmedByUser).toBe(true);
      const write = await world.writePerson(s8eLinkDraft(S8E_LINKS.K2, {
        topic: 'e44-contradiction', contradicts: [confirmedId],
      }));
      expect(write.status).toBe('accepted');
      if (write.status !== 'accepted') return;
      expect(write.overQuota).toBe(true);
    } finally {
      await world.close();
    }
  }, 180_000);
});
