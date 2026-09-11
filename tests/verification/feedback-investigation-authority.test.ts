import { expect, it } from 'vitest';
import { FeedbackMaterialCompiler } from '../../src/data/context-compiler/feedback-materials.js';
import type { TaskEnvelopeV1 } from '../../src/contracts/task-envelope.js';

function fixture(options: { action?: string; availability?: string; witnessed?: boolean; current?: string } = {}) {
  const sourceRun = { aggregateType: 'Run', projectId: 'p', goalId: 'g', runId: 'original' };
  const queryRun = { aggregateType: 'QueryRun', projectId: 'p', workspaceId: 'w', queryJobId: 'q', runId: 'q-run' };
  const envelope = { projectId: 'p', workspaceId: 'w', goalId: 'g', runRef: { ...sourceRun, runId: 'successor' }, planRef: { aggregateType: 'PlanRevision', projectId: 'p', planId: 'new-plan' }, workspaceSnapshot: { revision: 1 } } as TaskEnvelopeV1;
  const answer = { stale: false, bodyRef: { digest: 'a'.repeat(64) }, runRef: queryRun,
    answer: JSON.stringify({ kind: 'feedback_resolution', action: options.action ?? 'supplement', availability: options.availability ?? 'proven_empty', summary: 'Investigation result', material: 'A concrete rule or decision proposal.', sourcePaths: ['rule.md'] }),
    sources: [{ kind: 'workspace_source', version: 'same-source' }, ...(options.witnessed ? [{ kind: 'workspace_read', refKey: 'rule.md', version: 'a'.repeat(64) }] : [])],
  };
  const compiler = new FeedbackMaterialCompiler({
    ledger: { load: async (ref: { aggregateType: string }) => ref.aggregateType === 'WorkContextBinding'
      ? { status: 'found', snapshot: { binding: { linkedRunRefs: [sourceRun] } } }
      : { status: 'found', snapshot: { answer } } },
    catalog: { jobs: async () => [{ job: { status: 'answered', runRef: queryRun, intent: { execution: { feedback: { runRef: sourceRun } } }, answerRefs: [{ aggregateType: 'QueryJobAnswer' }] } }] },
    source: { sourceRevision: async () => options.current ?? 'same-source' },
    applicability: { capture: async () => ({ status: 'sourced', pin: { manifestDigest: 'b'.repeat(64) } }) },
    vault: {},
  } as never);
  return { compiler, envelope };
}

it('does not admit model-declared proven absence without an actual source investigation witness', async () => {
  const f = fixture();
  await expect(f.compiler.select(f.envelope, 'same-work')).rejects.toThrow('source-read witnesses');
});

it('keeps a decision proposal out of successor model materials even when source reads are witnessed', async () => {
  const f = fixture({ action: 'needs_decision', availability: 'available', witnessed: true });
  await expect(f.compiler.select(f.envelope, 'same-work')).rejects.toThrow('requires needs_decision');
});

it('rejects a formerly witnessed supplement when the current workspace source has changed', async () => {
  const f = fixture({ availability: 'available', witnessed: true, current: 'new-source' });
  await expect(f.compiler.select(f.envelope, 'same-work')).rejects.toThrow('source changed');
});

it('does not consume an adjust_plan answer before its exact formal plan acceptance is available', async () => {
  const f = fixture({ action: 'adjust_plan', availability: 'available', witnessed: true });
  await expect(f.compiler.select(f.envelope, 'same-work')).rejects.toThrow('matching accepted plan');
});
