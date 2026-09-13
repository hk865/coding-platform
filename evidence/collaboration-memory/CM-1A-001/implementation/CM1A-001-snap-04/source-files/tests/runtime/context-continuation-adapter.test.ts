/**
 * Lane B tests — FakeContextContinuationRuntimeAdapter (explicit continuation
 * capability declaration + observable continuation check). The fake kernel
 * HONESTLY declares the FAKE capability set (sessionRestore=false,
 * contextResume=true, takeoverRun=true): it can resume with a bounded context
 * and take over in a new run, but it can NEVER restore an original session.
 * checkContinuation must never fabricate a restored_original.
 */
import { describe, expect, it } from "vitest";
import { FakeContextContinuationRuntimeAdapter } from "../../src/execution/worker-runtime/context-continuation-adapter.js";
import { createFakeRuntimeAdapter } from "../../src/execution/worker-runtime/fake-runtime-adapter.js";
import { FAKE_RUNTIME_SCRIPT_COMPLETED_V1 } from "../../src/fixtures/dispatch-fixtures.js";
import { runRefFor } from "../../src/contracts/dispatch.js";
import { p116WorkContextRef } from "../contract-support/fixtures/context-fixtures.js";
import { P116_PROJECT_A, P116_WORK } from "../contract-support/fixtures/context-fixtures.js";
import { P116_WORKSPACE } from "../contract-support/fixtures/context-fixtures.js";
import type { ContextContinuationCheckV1 } from "../../src/contracts/context-continuation-port.js";

const PROJECT = P116_PROJECT_A;
const GOAL = "goal-ctx-cont";
const WREF = p116WorkContextRef(PROJECT, P116_WORK);
const WORKSPACE = P116_WORKSPACE;

const originalRun = runRefFor(PROJECT, GOAL, "run-original");
const replacementRun = runRefFor(PROJECT, GOAL, "run-replacement");

function check(overrides: Partial<ContextContinuationCheckV1> = {}): ContextContinuationCheckV1 {
  return {
    schemaVersion: 1,
    workContextRef: WREF,
    requestedByRunRef: replacementRun,
    originalRunRef: null,
    workspaceRevision: 1,
    planRevision: null,
    ...overrides,
  };
}

function adapter() {
  return new FakeContextContinuationRuntimeAdapter(createFakeRuntimeAdapter(FAKE_RUNTIME_SCRIPT_COMPLETED_V1));
}

describe("FakeContextContinuationRuntimeAdapter (Lane B)", () => {
  it("declares capabilities honestly: no session restore, bounded resume, takeover ok", async () => {
    const c = adapter();
    const caps = await c.capabilities({ workContextRef: WREF, runRef: replacementRun });
    expect(caps.status).toBe("supported");
    if (caps.status === "supported") {
      expect(caps.capabilities.schemaVersion).toBe(1);
      expect(caps.capabilities.sessionRestore).toBe(false);
      expect(caps.capabilities.contextResume).toBe(true);
      expect(caps.capabilities.takeoverRun).toBe(true);
      expect(caps.capabilities.maxContextBytes).toBe(256 * 1024);
      // maxResumeBytes is 0 precisely because the fake cannot restore a session.
      expect(caps.capabilities.maxResumeBytes).toBe(0);
    }
  });

  it("observes took_over: a NEW run continues from durable facts", async () => {
    const c = adapter();
    const obs = await c.checkContinuation(check({ requestedByRunRef: replacementRun, originalRunRef: null }));
    expect(obs.schemaVersion).toBe(1);
    expect(obs.observed).toBe("took_over");
    expect(obs.rejectionCode).toBeNull();
    expect(obs.unsupportedCapabilities).toEqual([]);
    expect(obs.requestedByRunRef?.runId).toBe("run-replacement");
    expect(obs.originalRunRef).toBeNull();
    expect(obs.observedAt).toBeTruthy();
  });

  it("observes unsupported(session_restore) when the original session is requested — NEVER restored_original", async () => {
    const c = adapter();
    const obs = await c.checkContinuation(check({ requestedByRunRef: replacementRun, originalRunRef: originalRun }));
    expect(obs.observed).toBe("unsupported");
    expect(obs.unsupportedCapabilities).toEqual(["session_restore"]);
    expect(obs.rejectionCode).toBeNull();
    // The fake kernel never pretends the original process still exists.
    expect(obs.observed).not.toBe("restored_original");
    expect(JSON.stringify(obs)).not.toContain("restored_original");
  });

  it("observes rejected for an invalid schemaVersion (no fabricated result)", async () => {
    const c = adapter();
    const obs = await c.checkContinuation(check({ schemaVersion: 2 } as never));
    expect(obs.observed).toBe("rejected");
    expect(obs.rejectionCode).toBe("invalid");
  });

  it("observes rejected(run_not_found) when there is no run to continue on", async () => {
    const c = adapter();
    const obs = await c.checkContinuation(check({ requestedByRunRef: null, originalRunRef: null }));
    expect(obs.observed).toBe("rejected");
    expect(obs.rejectionCode).toBe("run_not_found");
    expect(obs.requestedByRunRef).toBeNull();
    expect(obs.originalRunRef).toBeNull();
  });

  it("observation result is deterministic across repeated calls and never fakes a restore", async () => {
    const c = adapter();
    const a = await c.checkContinuation(check({ requestedByRunRef: replacementRun, originalRunRef: originalRun }));
    const b = await c.checkContinuation(check({ requestedByRunRef: replacementRun, originalRunRef: originalRun }));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const never = await c.checkContinuation(check({ originalRunRef: originalRun }));
    expect(never.observed).not.toBe("restored_original");
  });
});
