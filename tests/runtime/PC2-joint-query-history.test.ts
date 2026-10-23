/**
 * PC-2 joint step, PC-18: the real Query history path after a completed Work.
 *
 * `openPC2QueryHistoryFixture` captures the exact Runtime port the Workflow
 * factory receives, so `derived` (the isolated copy of the completed Work) and
 * `reused` (a standalone Query on the source Session) are the fixture's real
 * prepare/start handles. The source turn and the model replies are hand-written
 * literals in the test's personal pack and scripted model; the expected
 * manifest fields, reminder text and whole request texts are hand-written here too.
 *
 * The source Session has one completed Turn. A Query with a formal basis
 * (`derived`) follows that frozen basis; a Query without one (`reused`) follows
 * the source Session's real completed cursor. Neither Query carries a
 * continuation brief, so the history line is the Kernel message prefix checked
 * below.
 */
import { describe, expect, it } from 'vitest';
import type { ModelRequest } from '../../vendor/coding-agent/dist/public-api.js';
import {
  openPC2QueryHistoryFixture, pc2PackEntry, pc2ResolvedSource,
} from '../helpers/PC2-pack-fixture.js';
import { scriptedModel } from '../helpers/PC-platform-fixture.js';
import type { PreparedQueryManifestV1 } from '../../src/contracts/core/prepared-execution.js';

const SOURCE_INPUT_MARKER = 'PC2_QUERY_HISTORY_INPUT';
const SOURCE_REPLY = 'PC2_QUERY_HISTORY_REPLY';
const DERIVED_REPLY = 'PC2_DERIVED_REPLY';
const REUSED_REPLY = 'PC2_REUSED_REPLY';

// One completed source Turn: session.created through run.completed is 7.
const SOURCE_THROUGH_POSITION = 7;

// The platform reminder, as written by the frozen pack; not read from it here.
const REMINDER = '- 文件可能已经变化，编辑前先重新读取。';

const WORK_INPUT = `${SOURCE_INPUT_MARKER}\n{{prelude}}\n\n{{role}}{{goal}}{{task}}{{footprint}}`
  + '{{notes}}{{inputs}}{{continuation}}{{unknown_call_review}}{{reminders}}';

// The completed source Work's whole input: the hand-written marker line plus
// the WP2 platform work input as one literal (the same text PC2-joint-history's
// PC2_HISTORY_INPUT and PC-15's EXPECTED_INPUT_1 write by hand; copied here, not
// read from `manifest.input`, `preparedTexts()` or a captured request).
const SOURCE_INPUT = "PC2_QUERY_HISTORY_INPUT\n# Verified runtime task input\n\nThis is the current task context assembled from formal platform facts; it is not a transcript.\n\n## Runtime context\n## Runtime binding\nroleBinding: {\"policyRevision\":\"legacy-template\",\"tools\":[\"read\"],\"writeScope\":[]}\ntools: read\nwriteScope: (none)\n\n## Role specification\nrole: builder@1\nlabel: WP2 platform role\npurpose: WP2_PLATFORM_DUTY_PIN\nresponsibility: human_decision_support\nrequired materials: contract (Read the assigned Plan/Task)\nrequired outputs: answer-with-sources (Report the actual result)\nexit success: Report result\nexit stop: Stop on missing permission\nexit handoff: Keep references\n\nduty: secretary\n\ncontextResidentBytes: 4096\n\n## Goal\ngoal: r4c-claim-goal\nobjective: Exercise the atomic claim skeleton\nworkspace: r4c-claim-workspace@1\nautonomy: after_plan_confirmation\ncurrent understanding: 目标 r4c-claim-goal：还没有当前理解\n\n## Accepted task\ntask: Implement A (implement-a)\ninstruction: Implement A\nplan: r4c-claim-plan\nworkspace: r4c-claim-workspace@1\ndefinitionPlan: r4c-claim-plan@1\nstage: (未声明)\nmodule: (未声明)\nrequirementLevel: required\ndisposition: active\nphase: running\nobligations: [{\"obligationId\":\"obligation-1\",\"requirementLevel\":\"required\",\"taskIds\":[\"implement-a\",\"implement-b\",\"gate-goal\"],\"title\":\"Deliver implementation\",\"verificationRequirements\":[{\"description\":\"Tests pass\",\"kind\":\"test\",\"requirementId\":\"check-1\",\"requirementLevel\":\"required\"}]}]\nacceptance: [{\"description\":\"Tests pass\",\"kind\":\"test\",\"requirementId\":\"check-1\",\"requirementLevel\":\"required\"}]\nupstream: null\ndownstream: [{\"dependsOnId\":\"implement-a\",\"requires\":{\"kind\":\"output-contract\",\"label\":\"A output contract\"},\"taskId\":\"implement-b\"}]\nfailure: null\n\n## Reminders\n还没有观测\n{\"key\":\"decision:not_available:message_release\",\"node\":{\"kind\":\"goal\",\"ref\":{\"aggregateType\":\"Goal\",\"goalId\":\"r4c-claim-goal\",\"projectId\":\"r4c-claim-project\"}},\"sources\":[],\"text\":\"待决来源尚未接入：message_release\"}";

// The derived Query's whole current input: the Query prelude and role text, the
// stale-files reminder at the role end, the goal section and the inquiry
// Question; no task, notes, inputs or reminders section. Hand-written from the
// frozen platform literals; never assembled from a captured request.
const DERIVED_CURRENT_INPUT = "# Verified read-only Query input\n\nThis is the current bounded Query context assembled from formal platform facts; it is not a transcript.\n\n## Runtime context\n## Runtime binding\nroleBinding: {\"policyRevision\":\"wp2-query-host@1\",\"tools\":[\"read\"],\"writeScope\":[]}\ntools: read\nwriteScope: (none)\n\n## Role specification\nrole: builder@1\nlabel: WP2 platform role\npurpose: WP2_PLATFORM_DUTY_PIN\nresponsibility: human_decision_support\nrequired materials: contract (Read the assigned Plan/Task)\nrequired outputs: answer-with-sources (Report the actual result)\nexit success: Report result\nexit stop: Stop on missing permission\nexit handoff: Keep references\n\nduty: secretary\n\ncontextResidentBytes: 4096\n- 文件可能已经变化，编辑前先重新读取。\n\n## Goal\ngoal: r4c-claim-goal\nobjective: Exercise the atomic claim skeleton\nworkspace: r4c-claim-workspace@1\nautonomy: after_plan_confirmation\ncurrent understanding: 目标 r4c-claim-goal：还没有当前理解\n## Question\nPC2 inquiry.";

// The reused Query's whole current input, written independently of the derived
// one; the same role+goal sections and single reminder, with no history seed.
const REUSED_CURRENT_INPUT = "# Verified read-only Query input\n\nThis is the current bounded Query context assembled from formal platform facts; it is not a transcript.\n\n## Runtime context\n## Runtime binding\nroleBinding: {\"policyRevision\":\"wp2-query-host@1\",\"tools\":[\"read\"],\"writeScope\":[]}\ntools: read\nwriteScope: (none)\n\n## Role specification\nrole: builder@1\nlabel: WP2 platform role\npurpose: WP2_PLATFORM_DUTY_PIN\nresponsibility: human_decision_support\nrequired materials: contract (Read the assigned Plan/Task)\nrequired outputs: answer-with-sources (Report the actual result)\nexit success: Report result\nexit stop: Stop on missing permission\nexit handoff: Keep references\n\nduty: secretary\n\ncontextResidentBytes: 4096\n- 文件可能已经变化，编辑前先重新读取。\n\n## Goal\ngoal: r4c-claim-goal\nobjective: Exercise the atomic claim skeleton\nworkspace: r4c-claim-workspace@1\nautonomy: after_plan_confirmation\ncurrent understanding: 目标 r4c-claim-goal：还没有当前理解\n## Question\nPC2 ordinary Query.";

function count(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

function messageTexts(request: ModelRequest): string[] {
  return request.messages.map(message => ('content' in message ? message.content : ''));
}

function roleRange(manifest: PreparedQueryManifestV1) {
  const role = manifest.contextAssembly.sections.find(section => section.name === 'role');
  if (role === undefined) throw new Error('the Query input has no role section');
  return role;
}

function roleText(manifest: PreparedQueryManifestV1): string {
  const role = roleRange(manifest);
  return Buffer.from(manifest.input, 'utf8')
    .subarray(role.startByte ?? 0, role.endByte ?? 0).toString('utf8');
}

function openHistory() {
  const pack = pc2PackEntry('pc2-query-history', {
    templates: { 'work-input': WORK_INPUT },
  });
  return pc2ResolvedSource([pack]).then(source => openPC2QueryHistoryFixture({
    promptPacks: source,
    selection: { promptPack: pack.packId },
    model: scriptedModel([
      { text: SOURCE_REPLY },
      { text: DERIVED_REPLY },
      { text: REUSED_REPLY },
    ]),
  }));
}

describe('PC-18 a completed Work reaches the derived and reused Query history', () => {
  it('a derived Query freezes the source basis and seeds the source history once', async () => {
    const opened = await openHistory();
    try {
      const { derived } = opened;
      const manifest = derived.manifest;

      expect(manifest.takesSessionHistory).toBe(true);
      // The hand-written position is the source turn's public completed boundary.
      expect(opened.boundary.position).toBe(SOURCE_THROUGH_POSITION);
      // The Kernel Session id is the source Session's public identity created by
      // the fixture; the test supplies it rather than reading it from the manifest.
      expect(manifest.sessionBasis).toEqual({
        sourceKernelSessionId: opened.fixture.base.sessionRef.sessionId,
        throughPosition: SOURCE_THROUGH_POSITION,
      });
      // A Query has no continuation section: only the role and goal sections.
      expect(manifest.contextAssembly.sections.map(section => section.name)).toEqual(['role', 'goal']);
      // The role section ends with the whole reminder, once.
      expect(count(manifest.input, REMINDER)).toBe(1);
      expect(count(roleText(manifest), REMINDER)).toBe(1);
      expect(roleText(manifest).endsWith(`\n${REMINDER}`)).toBe(true);

      const started = await derived.start();
      expect(started.status, JSON.stringify(started)).toBe('ready');

      const requests = opened.fixture.model.requests;
      expect(requests).toHaveLength(2);
      const request = requests[1]!;
      expect(request.messages.map(message => message.role)).toEqual(['user', 'assistant', 'user']);
      const texts = messageTexts(request);
      // The whole source user input is the hand-written text; the source
      // assistant reply is the hand-written reply, not a captured request value.
      expect(texts[0]).toBe(SOURCE_INPUT);
      expect(count(texts[0]!, SOURCE_INPUT_MARKER)).toBe(1);
      expect(texts[1]).toBe(SOURCE_REPLY);
      // The current Query input carries the reminder at its role end, once; the
      // source history prefix does not carry it.
      expect(count(texts[2]!, REMINDER)).toBe(1);
      expect(count(texts[2]!, SOURCE_INPUT_MARKER)).toBe(0);
      expect(count(texts[0]!, REMINDER)).toBe(0);
      // The whole derived current input, reminder at the role end and no task.
      expect(texts[2]).toBe(DERIVED_CURRENT_INPUT);
      const currentRole = roleRange(manifest);
      const currentRoleText = Buffer.from(texts[2]!, 'utf8')
        .subarray(currentRole.startByte ?? 0, currentRole.endByte ?? 0).toString('utf8');
      expect(currentRoleText.endsWith(`\n${REMINDER}`)).toBe(true);
    } finally {
      await opened.close();
    }
  }, 60_000);

  it('a reused Query without a formal basis follows the source completed cursor', async () => {
    const opened = await openHistory();
    try {
      const { reused } = opened;
      const manifest = reused.manifest;

      // No formal basis: the source Session's real completed cursor decides.
      expect(manifest.sessionBasis).toBeUndefined();
      expect(manifest.takesSessionHistory).toBe(true);
      expect(manifest.contextAssembly.sections.map(section => section.name)).toEqual(['role', 'goal']);
      expect(count(manifest.input, REMINDER)).toBe(1);
      expect(count(roleText(manifest), REMINDER)).toBe(1);
      expect(roleText(manifest).endsWith(`\n${REMINDER}`)).toBe(true);

      const started = await reused.start();
      expect(started.status, JSON.stringify(started)).toBe('ready');

      const requests = opened.fixture.model.requests;
      expect(requests).toHaveLength(2);
      const request = requests[1]!;
      expect(request.messages.map(message => message.role)).toEqual(['user', 'assistant', 'user']);
      const texts = messageTexts(request);
      expect(texts[0]).toBe(SOURCE_INPUT);
      expect(count(texts[0]!, SOURCE_INPUT_MARKER)).toBe(1);
      expect(texts[1]).toBe(SOURCE_REPLY);
      expect(count(texts[2]!, REMINDER)).toBe(1);
      expect(count(texts[0]!, REMINDER)).toBe(0);
      // The whole reused current input, written independently of the derived one.
      expect(texts[2]).toBe(REUSED_CURRENT_INPUT);
    } finally {
      await opened.close();
    }
  }, 60_000);
});
