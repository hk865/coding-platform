/**
 * Group Q (slice 2A) QA-16 stable-window fixture (L-fixtures exception 2).
 *
 * `midReadCommit` wraps the real records port and commits exactly once, right
 * after a named window attempt's first data read. Attempts are delimited by the
 * read model's own end-of-attempt horizon read (`readMany([])`); the injected
 * ports (conflicts, card sources, notices) are wired on the UNWRAPPED records,
 * so only the read model's direct reads move the attempt counter.
 */
import type { CoreCallContext } from '../../src/contracts/core/call-context.js';
import type { GoalRef } from '../../src/contracts/ledger.js';
import { createArchitectureCatalogService } from '../../src/core/work-graph/architecture/catalog-service.js';
import type { DecisionReadPort } from '../../src/core/work-graph/model/decision-contracts.js';
import { createMaterialService } from '../../src/core/work-graph/materials/material-service.js';
import { createMaterialRecordReaders } from '../../src/core/work-graph/materials/record-readers.js';
import { createPlanningQuestionReader } from '../../src/core/work-graph/tasks/planning-question-reader.js';
import { createGoalDecisionCauseReader } from '../../src/core/work-graph/tasks/goal-decision-reader.js';
import { createPlanService } from '../../src/core/work-graph/tasks/plan-service.js';
import { createExecutedFilesStub } from './executed-files-stub.js';
import { createAutomaticReworkNoticeSource } from '../../src/core/work-graph/views/automatic-rework-notices.js';
import {
  createDecisionReadModel, createGoalCauseCardSource, createPlanningQuestionCardSource,
} from '../../src/core/work-graph/views/decision-read-model.js';
import { createGoalConflictAssembler } from '../../src/core/work-graph/views/goal-conflicts.js';
import { createNoticeDisplayToken } from '../../src/core/work-graph/views/notice-display-token.js';
import { createNoticePositionComparator } from '../../src/core/work-graph/views/notice-position.js';
import type { S5DecisionFixture, S5Records } from './S5-decision-fixture.js';
import { GOAL_C, PLAN_C1 } from './S5-decision-fixture.js';
import { startRun, sendUserDecision } from './S2A-queue-fixture.js';
import { workContext } from './S5-user-message-support.js';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';

/**
 * A read model whose OWN `records` is wrapped; every injected port keeps the
 * real records so its internal `readMany([])` never looks like an attempt end.
 */
export function windowReadModel(f: S5DecisionFixture, records: S5Records): DecisionReadPort {
  const inner = f.records;
  const materials = createMaterialService({ bodies: f.bodies,
    authority: createMaterialRecordReaders(inner).authority, now: f.now });
  const plans = createPlanService({ records: inner, materials, initialPlanning: { bodies: f.bodies }, now: f.now, eventId: f.newId });
  const causes = createGoalDecisionCauseReader({ records: inner, plans });
  return createDecisionReadModel({ records,
    cardSources: [createGoalCauseCardSource(causes),
      createPlanningQuestionCardSource(createPlanningQuestionReader({ records: inner, plans }))],
    noticeSources: [createAutomaticReworkNoticeSource({ records: inner })],
    conflicts: createGoalConflictAssembler({ records: inner,
      catalog: createArchitectureCatalogService({ records: inner }), executedFiles: createExecutedFilesStub() }),
    positions: createNoticePositionComparator(), displayTokens: createNoticeDisplayToken(new Uint8Array(32)) });
}

/**
 * The storage-port double: after a named attempt's first data read, it commits
 * one new user decision request on Goal C. `readMany([])` marks the end of the
 * attempt, so the next data read belongs to the next attempt.
 */
export function midReadCommit(
  inner: S5Records,
  interrupted: ReadonlySet<number>,
  commit: (attempt: number) => Promise<void>,
): S5Records {
  let attempt = 1;
  let committedThisAttempt = false;
  const maybeCommit = async (): Promise<void> => {
    if (committedThisAttempt || !interrupted.has(attempt)) return;
    committedThisAttempt = true;
    await commit(attempt);
  };
  return {
    ...inner,
    async readMany(keys) {
      const result = await inner.readMany(keys);
      if (keys.length === 0) { attempt += 1; committedThisAttempt = false; }
      else await maybeCommit();
      return result;
    },
    async lookup(request) {
      const result = await inner.lookup(request);
      await maybeCommit();
      return result;
    },
    // The queue path does not read in order today; keep the port complete.
    async lookupOrdered(request: unknown) {
      const ordered = (inner as unknown as {
        lookupOrdered(input: unknown): Promise<unknown>;
      }).lookupOrdered;
      const result = await ordered(request);
      await maybeCommit();
      return result;
    },
  } as S5Records;
}

/** A committed waiting user decision on Goal C, through the real public mailbox. */
export async function commitGoalCCard(
  f: S5DecisionFixture, ctx: CoreCallContext, goalRef: GoalRef, requestId: string,
): Promise<SessionMessage> {
  return sendUserDecision(f, ctx, goalRef, requestId);
}

/** Goal C's entered Run context, created once through the real claim service. */
export async function goalCRunContext(f: S5DecisionFixture): Promise<CoreCallContext> {
  const run = (await startRun(f, 's2a-window-c', GOAL_C, PLAN_C1, 'c-work')).run;
  return workContext(f, run);
}
