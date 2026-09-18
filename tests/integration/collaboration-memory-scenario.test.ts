import { architectureReviewView } from '../../src/data/read-model-index/architecture-review-view.js';
import { expect, it } from 'vitest';
import { architectureServiceScenario } from '../app/architecture-review-service-fixture.js';
import type { ModelClientPort, ModelRequest } from '../../vendor/coding-agent/dist/public-api.js';
import { join } from 'node:path';
import { SqliteStateLedger } from '../../src/data/state-ledger/sqlite-ledger.js';
import { QuerySourceContextCompiler } from '../../src/data/context-compiler/query-execution-context.js';
import { QueryWorkspaceSourceReader } from '../../src/data/workspace-reader/query-workspace-source-reader.js';

// One HTTP host, Goal, accepted plan and focused Task throughout this scenario.
// Only model responses are deterministic; requests, memory, decisions and dispatch are real.
for (const outcome of ['accept', 'modify', 'reject', 'defer'] as const) {
  it(`same planned work combines memory correction, ${outcome}, restart and next response`, async () => {
    const inputs: ModelRequest[] = [];
    const queryClient: ModelClientPort = { async *stream(request) {
      inputs.push(structuredClone(request));
      const text = JSON.stringify(request.messages);
      const answer = text.includes('ONE_REPLY_EXCEPTION') ? 'One detailed exception.' : text.includes('ARCHITECTURE_DETAIL') ? 'Detailed architecture: purpose, boundary, alternative and impact.' : 'Brief: progress, blocker, next step.';
      yield { schemaVersion: 1, requestId: request.requestId, sequence: 1, type: 'text_delta', delta: JSON.stringify({ schemaVersion: 1, language: 'en', blocks: [{ kind: 'explanation', text: answer, basis: [] }] }) };
      yield { schemaVersion: 1, requestId: request.requestId, sequence: 2, type: 'completed', reason: 'final_answer' };
    } };
    let serial = 0;
    let beforeDecisionRun: any;
    const query = async (context: any, purpose: string, question = 'Explain the current work and its decision.') => {
      const requestId = 'integrated-query-' + ++serial, before = inputs.length;
      expect(await context.post('/api/real/queries', { ...context.scope, requestId, ...(context.withoutFocus ? {} : { focusTaskId: 'reader-a' }), responsePurpose: purpose, question })).toMatchObject({ status: 200 });
      let run: any;
      await expect.poll(async () => {
        run = (await context.post('/api/real/queries/runs', context.scope)).body.runs.find((row: any) => row.runRef.runId === 'real-query-' + requestId);
        return run?.status;
      }, { timeout: 20000 }).toBe('completed');
      expect(inputs.length).toBe(before + 1);
      expect(run.result.outcome).toBe('answered');
      return { run, input: JSON.stringify(inputs.at(-1)!.messages), compiled: JSON.parse(run.input) };
    };
    await architectureServiceScenario(outcome, {
      readSharedSource: true,
      queryClient,
      afterReported: async context => {
        // The base scenario saved profile revision 1 through the same HTTP host.
        expect((await context.post('/api/real/memory/profile/maintain', { requestId: 'integrated-general', expectedRevision: 1,
          edits: [{ operation: 'correct', entryId: 'style', expectedEntryRevision: 1, content: 'ALL_BRIEF: Keep every reply concise.' }] })).body).toMatchObject({ status: 'committed', revision: 2 });
        for (const purpose of ['reply', 'architecture', 'progress']) {
          const reply = await query(context, purpose);
          beforeDecisionRun = reply.run;
          expect(reply.input).toContain('ALL_BRIEF');
          expect(reply.compiled.maintainedPreferences.profileRevision).toBe(2);
        }
        expect((await context.post('/api/real/memory/profile/maintain', { requestId: 'integrated-correction', expectedRevision: 2, edits: [
          { operation: 'correct', entryId: 'style', expectedEntryRevision: 2, content: 'ARCHITECTURE_DETAIL: Explain architecture purpose, boundaries, alternatives and impacts in detail.', conditions: { purposes: ['architecture'], expiresAt: null } },
          { operation: 'remember', entryId: 'progress-style', content: 'PROGRESS_BRIEF: Progress replies state changes, blockers and next step concisely.', conditions: { purposes: ['progress'], expiresAt: null } },
        ] })).body).toMatchObject({ status: 'committed', revision: 3 });
        const state = await context.state();
        const run = state.liveRuns.find((row: any) => row.spec.taskId === 'reader-a' && row.status === 'completed');
        expect(run).toBeDefined();
        expect((await context.post('/api/real/memory/project/record-experience', { ...context.scope, requestId: 'integrated-experience', expectedRevision: 0,
          runId: run.spec.runId, summary: 'PROJECT_PROTOCOL: During interface review, report affected consumers and unresolved ID semantics before implementation.', reason: 'The current pair of readers disagreed about Record.id; this experience applies only while the pinned source and governance remain current.' })).body).toMatchObject({ status: 'committed' });
      },
      afterRestart: async context => {
        const ledger = new SqliteStateLedger({ path: join(context.root, '../data/ledger.sqlite') });
        try {
          const observations = { all: () => [beforeDecisionRun] };
          const sources = new QuerySourceContextCompiler({ ledger: () => ledger, observations, source: new QueryWorkspaceSourceReader(() => context.root), architectureReviews: scope => architectureReviewView(ledger, scope) });
          expect((await sources.currentness(context.scope.projectId, context.scope.workspaceId)).get(beforeDecisionRun.runRef.queryJobId)).toBe(false);
          const currentRecord = { ...beforeDecisionRun, input: JSON.stringify({ ...JSON.parse(beforeDecisionRun.input), material: { ...JSON.parse(beforeDecisionRun.input).material, dynamicFactVersions: [], dynamicFactSet: undefined } }) };
          const oldBasis = new QuerySourceContextCompiler({ ledger: () => ledger, observations: { all: () => [currentRecord] }, source: new QueryWorkspaceSourceReader(() => context.root), architectureReviews: scope => architectureReviewView(ledger, scope) });
          expect((await oldBasis.currentness(context.scope.projectId, context.scope.workspaceId)).get(beforeDecisionRun.runRef.queryJobId)).toBe(true);
        } finally { await ledger.close(); }
        for (const purpose of ['reply', 'architecture', 'progress']) {
          const reply = await query(context, purpose);
          expect(reply.compiled.maintainedPreferences.profileRevision).toBe(3);
          expect(reply.compiled.material.collaborationWork.find((work: any) => work.taskId === 'reader-a').latestRun).toMatchObject({ status: 'ended', outcome: 'completed', matchesCurrentPlan: true });
          expect(reply.compiled.material.architectureReviews.status).toBe('ready');
          expect(reply.compiled.material.architectureReviews.rows[0]).toMatchObject({ status: outcome === 'accept' || outcome === 'modify' ? 'accepted' : outcome === 'reject' ? 'rejected' : 'deferred', allNotified: true, allRequiredAttempted: true });
          expect(reply.input).not.toContain('ALL_BRIEF');
          expect(reply.input.includes('ARCHITECTURE_DETAIL')).toBe(purpose === 'architecture');
          if (purpose === 'architecture') expect(reply.run.result.answer).toContain('purpose, boundary, alternative and impact');
          if (purpose === 'progress') expect(reply.input).toContain('PROJECT_PROTOCOL');
        }
        expect((await query(context, 'reply', 'ONE_REPLY_EXCEPTION: explain this response in detail without saving it.')).run.result.answer).toBe('Explanation：One detailed exception.');
        expect((await query(context, 'reply')).input).not.toContain('ONE_REPLY_EXCEPTION');
        expect((await context.post('/api/real/memory/profile/view', {})).body.snapshot.revision).toBe(3);
        const other = { projectId: 'acceptance-beta', workspaceId: context.scope.workspaceId, goalId: 'integrated-other-project' };
        expect(await context.post('/api/goals', { ...other, requestId: other.goalId, objective: 'Check portable preference and isolated project habit.' })).toMatchObject({ status: 200 });
        expect((await context.post('/api/real/memory/project/view', other)).body.snapshot.entries).toEqual([]);
        const portable = await query({ ...context, scope: other, withoutFocus: true }, 'architecture');
        expect(portable.compiled.maintainedPreferences.profileRevision).toBe(3);
        expect(portable.input).toContain('ARCHITECTURE_DETAIL');
        expect(portable.input).not.toContain('PROJECT_PROTOCOL');
        // Delete through the public maintenance path; next same-Task response must not resubmit it.
        expect((await context.post('/api/real/memory/profile/maintain', { requestId: 'integrated-delete', expectedRevision: 3,
          edits: [{ operation: 'remove', entryId: 'style', expectedEntryRevision: 3 }] })).body).toMatchObject({ status: 'committed', revision: 4 });
        expect((await query(context, 'architecture')).input).not.toContain('ARCHITECTURE_DETAIL');
        expect(inputs.every(request => request.tools.every(tool => !['edit', 'shell'].includes(tool.name)))).toBe(true);
      },
    });
  }, 180000);
}

