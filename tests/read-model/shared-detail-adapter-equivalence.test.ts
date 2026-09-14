import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { ControlPolicyExplanation } from '../../src/control/control-engine/policy-explanation.js';
import {
  buildCoordinationPolicyActivateRecordCommit,
  buildCoordinationPolicyInstallRecordCommit,
  buildInitialDesignDecisionRecordCommit,
  buildInitialDesignProposalRecordCommit,
} from '../../src/control/control-engine/records/human-role-collaboration.js';
import { makeCommitCursor, type EventPage, type PositionedEvent } from '../../src/contracts/ledger.js';
import { ReadModelIndexImpl } from '../../src/data/read-model-index/read-model-index.js';
import { createSqliteReadModelIndex } from '../../src/data/read-model-index/sqlite-read-model-index.js';
import {
  P115_PROJECT,
  P115_WORKSPACE,
  buildP115ActivateCommand,
  buildP115Decision,
  buildP115DecisionCommand,
  buildP115InstallCommand,
  buildP115Proposal,
  buildP115ProposalCommand,
} from '../contract-support/fixtures/human-role-collaboration-fixtures.js';

const AT = '2026-09-14T00:00:00.000Z';

function collaborationEvents(): PositionedEvent[] {
  const proposal = buildP115Proposal();
  const decision = buildP115Decision(proposal);
  const events = [
    buildInitialDesignProposalRecordCommit(buildP115ProposalCommand(proposal, { commandId: 'shared-proposal-command' }), { eventId: 'shared-proposal', occurredAt: AT }).events[0]!,
    buildInitialDesignDecisionRecordCommit(buildP115DecisionCommand(decision, { commandId: 'shared-decision-command' }), { eventId: 'shared-decision', occurredAt: AT }).events[0]!,
    buildCoordinationPolicyInstallRecordCommit(buildP115InstallCommand(P115_PROJECT, { commandId: 'shared-policy-command' }), { eventId: 'shared-policy', occurredAt: AT }).events[0]!,
    buildCoordinationPolicyActivateRecordCommit(buildP115ActivateCommand(P115_PROJECT, { commandId: 'shared-activation-command', expectedRevision: 1 }), {
      eventId: 'shared-activation',
      occurredAt: AT,
      activeAggregateRevision: 1,
      projectRevision: 1,
    }).events[0]!,
  ];
  return events.map((event, index) => ({ cursor: makeCommitCursor(index + 1), event }));
}

function page(events: PositionedEvent[]): EventPage {
  return { afterCursor: null, throughCursor: events[events.length - 1]!.cursor, events, hasMore: false };
}

describe('shared detail projection adapter equivalence', () => {
  it('produces the same view for one event sequence and preserves it across SQLite reopen', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'shared-detail-'));
    const path = join(dir, 'read-model.sqlite');
    const policy = new ControlPolicyExplanation();
    const memory = new ReadModelIndexImpl(policy);
    const sqlite = createSqliteReadModelIndex({ path, policyExplanation: policy });
    const events = collaborationEvents();
    try {
      await memory.advance(page(events));
      await sqlite.advance(page(events));
      const query = { projectId: P115_PROJECT, workspaceId: P115_WORKSPACE };
      const expected = await memory.unifiedStatusView(query);
      expect(await sqlite.unifiedStatusView(query)).toEqual(expected);
      await sqlite.close();

      const reopened = createSqliteReadModelIndex({ path, policyExplanation: policy });
      try {
        expect(await reopened.unifiedStatusView(query)).toEqual(expected);
        expect((await reopened.advance(page(events))).appliedEventIds).toEqual([]);
      } finally {
        await reopened.close();
      }
    } finally {
      await sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rolls back the whole SQLite page when a later projection write fails', async () => {
    const sqlite = createSqliteReadModelIndex({ path: ':memory:', policyExplanation: new ControlPolicyExplanation() });
    try {
      const db = (sqlite as unknown as { db: DatabaseSync }).db;
      db.exec("CREATE TRIGGER fail_decision_projection BEFORE INSERT ON p115_decision_rows BEGIN SELECT RAISE(ABORT, 'forced projection failure'); END");
      const events = collaborationEvents().slice(0, 2);
      await expect(sqlite.advance(page(events))).rejects.toThrow('forced projection failure');
      expect(await sqlite.unifiedStatusView({ projectId: P115_PROJECT, workspaceId: P115_WORKSPACE })).toEqual({ status: 'not_found' });
      expect((db.prepare('SELECT COUNT(*) AS count FROM p115_proposal_rows').get() as { count: number }).count).toBe(0);
    } finally {
      await sqlite.close();
    }
  });
});
