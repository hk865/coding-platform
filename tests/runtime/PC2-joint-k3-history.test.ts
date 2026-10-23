/**
 * PC-2 joint step, J-06 (A3-01): a K3 review Run whose source Turn completed
 * seeds the WHOLE completed source history through the frozen fixture's
 * `completed_turn` path. The source user message is the S5 PLAN_B2 / GOAL_B work
 * input hand-written from the fixture facts and the platform work-input
 * template; the assistant reply is the fixture's scripted literal. The stale
 * reminder must appear exactly once, at the review input's role end, and the
 * review item must be the real one the fixture produced.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ModelRequest, ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { shellSeam } from '../helpers/K3-tool-seams.js';
import type { PreparedTaskManifestV1 } from '../../src/contracts/core/prepared-execution.js';
import * as k3RuntimeFixture from '../helpers/K3-35-runtime.js';
import { openPCK3ReviewFixture, scriptedModel } from '../helpers/PC-platform-fixture.js';

// §5.1's stand-in `shell`: the fixture's real blocked Kernel call needs the same
// seam the K3 tests install.
const seams = vi.hoisted(() => ({ shellSeam: undefined as unknown }));
vi.mock('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../vendor/coding-agent/dist/tools/builtin/shell/shell-tool.js')>();
  return { ...actual, createShellToolDefinition: (sandboxArg: Parameters<typeof actual.createShellToolDefinition>[0]): ToolDefinition =>
    (seams.shellSeam as typeof shellSeam).definition(actual.createShellToolDefinition, sandboxArg) };
});
seams.shellSeam = shellSeam;

const REMINDER = '- 文件可能已经变化，编辑前先重新读取。';

// The completed source Turn's own user message, hand-written from the frozen
// S5 facts (GOAL_B / the adopted PLAN_B2, claimed Task `k3-20-a`, role
// `builder@1` absent because this world has no coordination policy) and the
// platform work-input template. The K3-35 prepare path wires no graph-context
// reader, so the Goal and the note/anomaly projections render their
// "not loaded"/"not connected" strings. Never read from the manifest, the
// generated pack or a captured request.
const SOURCE_USER_INPUT = `# Verified runtime task input

This is the current task context assembled from formal platform facts; it is not a transcript.

## Runtime context
## Runtime binding
roleBinding: {"policyRevision":"legacy-template","tools":["read"],"writeScope":[]}
tools: read
writeScope: (none)

## Role specification
role: builder (absent)
the project has no active coordination policy, so there is no role matrix
label: Executor
purpose: Execute the assigned task.
responsibility: execution

duty: executor

contextResidentBytes: 4096

## Goal
目标上下文未加载

## Accepted task
task: K3 review work k3-20-a (k3-20-a)
instruction: Execute k3-20-a
plan: PB2
workspace: W@3
definitionPlan: PB2@2
stage: (未声明)
module: (未声明)
requirementLevel: required
disposition: active
phase: pending
obligations: [{"obligationId":"PB1-obligation","requirementLevel":"required","taskIds":["b-work","b-work-2","b-gate","k3-20-a","k3-20-b","k3-20-c","k3-20-d","k3-20-e"],"title":"Deliver PB1","verificationRequirements":[{"description":"Tests pass","kind":"test","requirementId":"PB1-check","requirementLevel":"required"}]}]
acceptance: [{"description":"Tests pass","kind":"test","requirementId":"PB1-check","requirementLevel":"required"}]
upstream: null
downstream: null
failure: null

## Reminders
异常锚点投影尚未接入
注记索引尚未接入`;
const SOURCE_ASSISTANT_REPLY = 'PC completed source history.';

function startedText(request: ModelRequest): string {
  return request.messages.map(message => ('content' in message ? message.content : '')).join('\n');
}

describe('PC-2 J-06: a K3 review seeds the completed source Turn', () => {
  it('starts ready with the whole source prefix and one reminder at the review role end', async () => {
    const capture = vi.spyOn(k3RuntimeFixture, 'createK3_35Runtime');
    let opened: Awaited<ReturnType<typeof openPCK3ReviewFixture>> | undefined;
    try {
      const fixture = await openPCK3ReviewFixture({
        sourceHistory: 'completed_turn',
        model: scriptedModel([{ text: 'PC review answer' }]),
      });
      opened = fixture;
      const wired = capture.mock.results.find(result =>
        result.type === 'return' && result.value.runtime.port === fixture.runtime);
      if (wired === undefined || wired.type !== 'return') {
        throw new Error('J-06 the review Runtime wiring was not captured');
      }
      const materials = wired.value.deps.materials;
      capture.mockRestore();
      // The one real review record the frozen fixture's blocked Run left behind.
      expect(fixture.review.status).toBe('pending_review');
      expect(fixture.review.items).toHaveLength(1);
      expect(fixture.review.items[0]).toMatchObject({
        callId: 'pc-pending-call', toolName: 'shell', summary: { command: 'printf PC' },
      });
      expect(fixture.review.task).toEqual(fixture.claim.task);

      const prepared = await fixture.work.prepare();
      const loaded = await materials.openArtifact(fixture.world.fixture.ctx, {
        ref: prepared.envelope.bundleRef,
        usage: 'historical_explanation',
      });
      if (loaded.status !== 'ready') throw new Error(JSON.stringify(loaded));
      const manifest = JSON.parse(loaded.value.body) as PreparedTaskManifestV1;

      const started = await fixture.work.start();
      expect(started.status, JSON.stringify(started)).toBe('ready');
      const request = fixture.model.requests.at(-1)!;
      // The whole history prefix: the completed source Turn's user message and
      // the fixture's scripted reply, both scenario literals. This Turn's own
      // user message follows.
      expect(request.messages.slice(0, 2)).toEqual([
        { role: 'user', messageId: expect.any(String), content: SOURCE_USER_INPUT },
        { role: 'assistant', messageId: expect.any(String), content: SOURCE_ASSISTANT_REPLY, toolCalls: [] },
      ]);
      expect(request.messages).toHaveLength(3);
      expect(request.messages[2]).toMatchObject({ role: 'user' });
      expect(startedText(request).split(REMINDER).length - 1).toBe(1);

      expect(manifest.takesSessionHistory).toBe(true);
      expect(typeof manifest.sessionBasis?.throughPosition).toBe('number');

      // The review round is the real record the claim was built from.
      expect(manifest.unknownCallReview).toMatchObject({
        reviewRef: fixture.review.ref, phase: 'review', round: 1,
        items: [{ alias: 1, toolName: 'shell',
          command: { text: 'printf PC', truncated: false } }],
      });

      // Exactly one reminder, and it is the last line of the review input's role.
      expect(manifest.input.split(REMINDER).length - 1).toBe(1);
      const role = manifest.contextAssembly.sections.find(section => section.name === 'role');
      if (role === undefined) throw new Error('J-06 the review input has no role section');
      const roleText = Buffer.from(manifest.input, 'utf8')
        .subarray(role.startByte ?? 0, role.endByte ?? 0).toString('utf8');
      expect(roleText.endsWith(`\n${REMINDER}`)).toBe(true);
      expect(roleText.split(REMINDER).length - 1).toBe(1);
    } finally {
      capture.mockRestore();
      await opened?.close();
    }
  }, 60_000);
});
