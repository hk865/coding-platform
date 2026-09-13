/**
 * P1-12 lane A unit tests — CodeGraphPortImpl.codeGraph (VerificationEngine
 * seam). Registry convention: revision 0 = pinned baseline graph, revision
 * 2 = current graph (currentRevision = 2). Verifies supported (snapshotRef +
 * capabilityNote), stale, unsupported, and rejected branches.
 */
import { describe, expect, it } from "vitest";
import { CodeGraphPortImpl } from "../../src/control/verification-engine/code-graph-port.js";
import type { CodeGraphQueryV1 } from "../../src/contracts/architecture-reconciler.js";
import type { CodeGraphSnapshotV1 } from "../../src/contracts/architecture-inspection.js";
import {
  buildP112BaselineGraph,
  buildP112CurrentGraph,
  P112_PROJECT,
  P112_WORKSPACE,
  p112PlanRef,
  p112BaselinePin,
} from "../../src/fixtures/architecture-fixtures.js";

function makeQuery(overrides: Partial<CodeGraphQueryV1> = {}): CodeGraphQueryV1 {
  return {
    schemaVersion: 1,
    projectId: P112_PROJECT,
    workspaceId: P112_WORKSPACE,
    workspaceRevision: 2,
    planRef: p112PlanRef(),
    baselinePin: p112BaselinePin(),
    ...overrides,
  };
}

function fixturePort(): CodeGraphPortImpl {
  return new CodeGraphPortImpl({ graphs: new Map([[0, buildP112BaselineGraph()], [2, buildP112CurrentGraph()]]), currentRevision: 2 });
}

describe("CodeGraphPortImpl.codeGraph", () => {
  it("declares the current revision supported with the graph bodyRef", async () => {
    const port = fixturePort();
    const res = await port.codeGraph(makeQuery());
    expect(res.status).toBe("supported");
    if (res.status !== "supported") return;
    expect(res.snapshotRef).toEqual(buildP112CurrentGraph().bodyRef);
    expect(res.capabilityNote).toBe("configured-registry");
  });

  it("declares the baseline revision 0 supported", async () => {
    const port = fixturePort();
    const res = await port.codeGraph(makeQuery({ workspaceRevision: 0 }));
    expect(res.status).toBe("supported");
    if (res.status !== "supported") return;
    expect(res.snapshotRef).toEqual(buildP112BaselineGraph().bodyRef);
  });

  it("reports stale when the revision is not in the registry", async () => {
    const port = fixturePort();
    const res = await port.codeGraph(makeQuery({ workspaceRevision: 1 }));
    expect(res.status).toBe("stale");
    if (res.status !== "stale") return;
    expect(res.expectedRevision).toBe(2);
    expect(res.observedRevision).toBe(1);
  });

  it("reports unsupported when the revision has no code-graph capability", async () => {
    const graphs = new Map<number, CodeGraphSnapshotV1>([[0, {
      ...buildP112BaselineGraph(),
      indexCapabilities: { hasCodeGraph: false, degradesToText: false, graphRevision: null },
    }]]);
    const port = new CodeGraphPortImpl({ graphs, currentRevision: 0 });
    const res = await port.codeGraph(makeQuery({ workspaceRevision: 0 }));
    expect(res.status).toBe("unsupported");
  });

  it("rejects an invalid request", async () => {
    const port = new CodeGraphPortImpl();
    const res = await port.codeGraph({ ...makeQuery(), schemaVersion: 2 } as unknown as CodeGraphQueryV1);
    expect(res.status).toBe("rejected");
    if (res.status !== "rejected") return;
    expect(res.code).toBe("invalid_request");
  });

  it("is explicitly unsupported when no registry is configured", async () => {
    expect(await new CodeGraphPortImpl().codeGraph(makeQuery())).toEqual({
      status: "unsupported",
      message: "no graph registry configured for this workspace",
    });
  });

  it("rejects an out-of-scope project", async () => {
    const port = fixturePort();
    const res = await port.codeGraph(makeQuery({ projectId: "proj-other" }));
    expect(res.status).toBe("rejected");
    if (res.status !== "rejected") return;
    expect(res.code).toBe("scope_forbidden");
  });
});
