import { describe, expect, it } from "vitest";
import { ArtifactVault } from "../../src/vault/artifact-vault.js";
import {
  ARTIFACT_MAX_SIZE_BYTES,
  artifactBodyDigest,
  artifactBodySize,
} from "../../src/contracts/artifact.js";
import type { ArtifactOpenQuery, ArtifactPutRecord, ArtifactRef } from "../../src/contracts/artifact.js";
import { runRefFor } from "../../src/contracts/dispatch.js";
import type { SourceRefV1 } from "../../src/contracts/dispatch.js";

const RUN = runRefFor("proj-alpha", "goal-1", "run-0001");

const PLAN_SOURCE: SourceRefV1 = {
  kind: "plan-revision",
  refId: "plan-dispatch-mvp",
  revision: "1",
  digest: "plan-dispatch-mvp",
};
const WS_SOURCE: SourceRefV1 = { kind: "workspace", refId: "ws-shared", revision: "2" };

function putRecord(overrides: Partial<ArtifactPutRecord> = {}): ArtifactPutRecord {
  return {
    contentType: "application/json",
    body: JSON.stringify({ hello: "world" }),
    sourceRefs: [PLAN_SOURCE, WS_SOURCE],
    ownerRef: RUN,
    requestedAt: "2026-09-05T12:00:00.000Z",
    ...overrides,
  };
}

async function open(vault: ArtifactVault, ref: ArtifactRef, requesterRunRef = RUN) {
  return vault.open(ref, { requesterRunRef } satisfies ArtifactOpenQuery);
}

describe("ArtifactVault.put", () => {
  it("stores a new artifact with a content-addressed ref and its source", async () => {
    const vault = new ArtifactVault();
    const record = putRecord();
    const result = await vault.put(record);
    expect(result.status).toBe("stored");
    if (result.status !== "stored") return;
    expect(result.replayed).toBe(false);
    expect(result.ref.kind).toBe("artifact");
    expect(result.ref.contentType).toBe("application/json");
    expect(result.ref.sizeBytes).toBe(artifactBodySize(record.body));
    expect(result.ref.digest).toBe(artifactBodyDigest(record.body));
    expect(result.ref.source).toEqual(PLAN_SOURCE);
  });

  it("replays the SAME ref for identical content + contentType (content addressing)", async () => {
    const vault = new ArtifactVault();
    const first = await vault.put(putRecord({ body: "SAME" }));
    const second = await vault.put(putRecord({ body: "SAME" }));
    expect(first.status).toBe("stored");
    expect(second.status).toBe("stored");
    if (first.status !== "stored" || second.status !== "stored") return;
    expect(second.replayed).toBe(true);
    expect(second.ref).toEqual(first.ref);
  });

  it("produces a distinct ref when the same body uses a different contentType", async () => {
    const vault = new ArtifactVault();
    const a = await vault.put(putRecord({ contentType: "application/json" }));
    const b = await vault.put(putRecord({ contentType: "text/plain" }));
    expect(a.status).toBe("stored");
    expect(b.status).toBe("stored");
    if (a.status !== "stored" || b.status !== "stored") return;
    expect(b.replayed).toBe(false);
    expect(b.ref.contentType).not.toEqual(a.ref.contentType);
  });

  it("rejects a body larger than the vault size cap", async () => {
    const vault = new ArtifactVault();
    const result = await vault.put(putRecord({ body: "x".repeat(ARTIFACT_MAX_SIZE_BYTES + 1) }));
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.code).toBe("size_exceeded");
  });

  it("rejects an empty sourceRefs list", async () => {
    const vault = new ArtifactVault();
    const result = await vault.put(putRecord({ sourceRefs: [] }));
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.code).toBe("missing_source");
  });

  it("rejects a record without an ownerRef", async () => {
    const vault = new ArtifactVault();
    const result = await vault.put(putRecord({ ownerRef: undefined as never }));
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.code).toBe("missing_source");
  });

  it("rejects a non-string body", async () => {
    const vault = new ArtifactVault();
    const result = await vault.put(putRecord({ body: 123 as unknown as string }));
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.code).toBe("invalid");
  });

  it("rejects an empty contentType", async () => {
    const vault = new ArtifactVault();
    const result = await vault.put(putRecord({ contentType: "" }));
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") return;
    expect(result.code).toBe("invalid");
  });
});

describe("ArtifactVault.open", () => {
  it("returns the record to the recorded owner run", async () => {
    const vault = new ArtifactVault();
    const put = await vault.put(putRecord());
    expect(put.status).toBe("stored");
    if (put.status !== "stored") return;
    const opened = await open(vault, put.ref);
    expect(opened.status).toBe("ready");
    if (opened.status !== "ready") return;
    expect(opened.record).toEqual({
      ref: put.ref,
      body: putRecord().body,
      sourceRefs: [PLAN_SOURCE, WS_SOURCE],
    });
  });

  it("rejects a cross-owner read", async () => {
    const vault = new ArtifactVault();
    const put = await vault.put(putRecord());
    expect(put.status).toBe("stored");
    if (put.status !== "stored") return;
    const opened = await open(vault, put.ref, runRefFor("proj-alpha", "goal-1", "run-9999"));
    expect(opened.status).toBe("rejected");
    if (opened.status !== "rejected") return;
    expect(opened.code).toBe("forbidden");
  });

  it("returns unavailable for an unknown ref", async () => {
    const vault = new ArtifactVault();
    const fake: ArtifactRef = {
      kind: "artifact",
      contentType: "application/json",
      digest: "cafe",
      sizeBytes: 42,
      source: PLAN_SOURCE,
    };
    const opened = await open(vault, fake);
    expect(opened.status).toBe("unavailable");
  });

  it("treats a corrupted digest as unavailable (content addressing)", async () => {
    const vault = new ArtifactVault();
    const put = await vault.put(putRecord());
    expect(put.status).toBe("stored");
    if (put.status !== "stored") return;
    const corrupted = { ...put.ref, digest: "0".repeat(64) };
    const opened = await open(vault, corrupted);
    expect(opened.status).toBe("unavailable");
  });

  it("rejects a malformed ref", async () => {
    const vault = new ArtifactVault();
    const bad = { kind: "artifact", contentType: "application/json", sizeBytes: 1, source: PLAN_SOURCE } as unknown as ArtifactRef;
    const opened = await open(vault, bad);
    expect(opened.status).toBe("rejected");
    if (opened.status !== "rejected") return;
    expect(opened.code).toBe("invalid");
  });
});
