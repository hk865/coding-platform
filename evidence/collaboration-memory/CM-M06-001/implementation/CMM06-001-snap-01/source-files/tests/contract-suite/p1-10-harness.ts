/**
 * Shared P1-10 contract-suite harness: lifecycle control scenario over the
 * P1-08 world + helpers. FROZEN surface; lane fills submit/ack + timeline.
 */
import { expect } from "vitest";
import type { P1_08HarnessLike, P1_08TestHarness } from "./p1-08-harness.js";
import { runP108TwoProjectScenario, type P108TwoProjectScenarioResult } from "./p1-08-harness.js";
import type { LifecycleControlPort, ControlTimelineViewQuery, ControlTimelineViewResult, SubmitControlCommand, SubmitControlReceipt, RecordSafePointAckCommand, RecordSafePointAckReceipt, ControlIntentV1 } from "../../src/contracts/control-intent.js";
import { buildP110Intent, buildP110SubmitControlCommand, buildP110Ack, buildP110RecordAckCommand, P110_PROJECT, P110_WORKSPACE, p110RunRef, p110IntentId } from "../contract-support/fixtures/control-fixtures.js";
import { P108_PROJECT_A, P108_TASK_WORK } from "./p1-08-harness.js";

export interface P1_10TestHarness extends P1_08TestHarness {
  lifecycleControl: LifecycleControlPort;
  submitControl(command: SubmitControlCommand): Promise<SubmitControlReceipt>;
  recordSafePointAck(command: RecordSafePointAckCommand): Promise<RecordSafePointAckReceipt>;
  controlTimelineView(query: ControlTimelineViewQuery): Promise<ControlTimelineViewResult>;
  lifecycleCapabilities(request: { runRef: import("../../src/contracts/dispatch.js").RunRef | null }): { safePointDelivery: boolean; pause: boolean; cancel: boolean; steer: boolean; maxSteerPayloadBytes: number };
}

export type P1_10HarnessLike = P1_08HarnessLike & {
  lifecycleControl: LifecycleControlPort;
  submitControl: (command: SubmitControlCommand) => Promise<SubmitControlReceipt>;
  recordSafePointAck: (command: RecordSafePointAckCommand) => Promise<RecordSafePointAckReceipt>;
  controlTimelineView: (query: ControlTimelineViewQuery) => Promise<ControlTimelineViewResult>;
  lifecycleCapabilities: (request: { runRef: import("../../src/contracts/dispatch.js").RunRef | null }) => { safePointDelivery: boolean; pause: boolean; cancel: boolean; steer: boolean; maxSteerPayloadBytes: number };
};

export function toP1_10Harness(h: P1_10HarnessLike): P1_10TestHarness {
  return h as unknown as P1_10TestHarness;
}

export type P110ControlScenarioResult = {
  world: P108TwoProjectScenarioResult;
  pause: ControlIntentV1;
  pauseAck: ReturnType<typeof buildP110Ack>;
  resume: ControlIntentV1;
  resumeAck: ReturnType<typeof buildP110Ack>;
  steer: ControlIntentV1;
  steerAck: ReturnType<typeof buildP110Ack>;
  cancel: ControlIntentV1;
  timeline: ControlTimelineViewResult;
};

/**
 * Drives the P1-10 lifecycle scenario over the P1-08 world (project A work
 * run): pause → safe-point ack (applied) → resume (original) → steer →
 * cancel (applied at safe point). Desired vs current separated in the
 * timeline view. Idempotency + late-ack covered by the suite.
 */
export async function runP110ControlScenario(h: P1_10HarnessLike): Promise<P110ControlScenarioResult> {
  const world = await runP108TwoProjectScenario(h);
  const goalId = world.previews.find((p) => p.projectId === P108_PROJECT_A)!.goalId;
  const runRef = p110RunRef(world.projectA.workRun.runId, goalId);

  const pause = buildP110Intent({ intentId: p110IntentId("pause", 1), kind: "pause", scope: { projectId: P108_PROJECT_A, workspaceId: P110_WORKSPACE, goalId, taskId: P108_TASK_WORK, runRef } });
  const submitPause = await h.submitControl(buildP110SubmitControlCommand(pause, { commandId: "p110-cmd-pause" }));
  expect(submitPause.status).toBe("committed");
  const pauseAck = buildP110Ack({ ackId: "ack-pause-1", intentRef: pause.scope ? { aggregateType: "ControlIntent", projectId: P108_PROJECT_A, workspaceId: P110_WORKSPACE, intentId: pause.intentId } : { aggregateType: "ControlIntent", projectId: P108_PROJECT_A, workspaceId: P110_WORKSPACE, intentId: pause.intentId }, runRef, applied: true });
  const ackPause = await h.recordSafePointAck(buildP110RecordAckCommand(pauseAck, 1, { commandId: "p110-cmd-ack-pause" }));
  expect(ackPause.status).toBe("committed");

  const resume = buildP110Intent({ intentId: p110IntentId("resume", 2), kind: "resume", scope: { projectId: P108_PROJECT_A, workspaceId: P110_WORKSPACE, goalId, taskId: P108_TASK_WORK, runRef } });
  const submitResume = await h.submitControl(buildP110SubmitControlCommand(resume, { commandId: "p110-cmd-resume" }));
  expect(submitResume.status).toBe("committed");
  const resumeAck = buildP110Ack({ ackId: "ack-resume-1", intentRef: { aggregateType: "ControlIntent", projectId: P108_PROJECT_A, workspaceId: P110_WORKSPACE, intentId: resume.intentId }, runRef, applied: true, resumeOutcome: { status: "original", detail: "kernel resumed the original session" } });
  await h.recordSafePointAck(buildP110RecordAckCommand(resumeAck, 1, { commandId: "p110-cmd-ack-resume" }));

  const steer = buildP110Intent({ intentId: p110IntentId("steer", 3), kind: "steer", scope: { projectId: P108_PROJECT_A, workspaceId: P110_WORKSPACE, goalId, taskId: P108_TASK_WORK, runRef }, steer: { directive: "先补一个复现用例再继续实现", payloadDigest: "sha256:fixture", safePointOnly: true, expectedRunRef: runRef } });
  await h.submitControl(buildP110SubmitControlCommand(steer, { commandId: "p110-cmd-steer" }));
  const steerAck = buildP110Ack({ ackId: "ack-steer-1", intentRef: { aggregateType: "ControlIntent", projectId: P108_PROJECT_A, workspaceId: P110_WORKSPACE, intentId: steer.intentId }, runRef, applied: true });
  await h.recordSafePointAck(buildP110RecordAckCommand(steerAck, 1, { commandId: "p110-cmd-ack-steer" }));

  const cancel = buildP110Intent({ intentId: p110IntentId("cancel", 4), kind: "cancel", scope: { projectId: P108_PROJECT_A, workspaceId: P110_WORKSPACE, goalId, taskId: P108_TASK_WORK, runRef } });
  await h.submitControl(buildP110SubmitControlCommand(cancel, { commandId: "p110-cmd-cancel" }));
  await h.recordSafePointAck(buildP110RecordAckCommand(buildP110Ack({ ackId: "ack-cancel-1", intentRef: { aggregateType: "ControlIntent", projectId: P108_PROJECT_A, workspaceId: P110_WORKSPACE, intentId: cancel.intentId }, runRef, applied: true }), 1, { commandId: "p110-cmd-ack-cancel" }));

  await h.advanceProjection();
  const timeline = await h.controlTimelineView({ projectId: P108_PROJECT_A, workspaceId: P110_WORKSPACE });
  return { world, pause, pauseAck, resume, resumeAck, steer, steerAck, cancel, timeline };
}
