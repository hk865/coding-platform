/**
 * P1-18 ArtifactVault cross-principal read authorization.
 *
 * REAL ArtifactVault (content addressing, digest/size integrity) over a shared
 * store with a stub resolver, so each rule is observable on its own:
 *   - no resolver  -> the P1-03 owner-only rule is unchanged (fail-closed);
 *   - recorded grant, same basis            -> ready (non-owner reader);
 *   - grant for ANOTHER reader              -> forbidden;
 *   - grant bound to a different basis      -> stale (inherited material is not
 *                                              silently reused under a new version);
 *   - conditional grant without a declared basis -> stale;
 *   - unconditional grant                   -> ready under any basis;
 *   - grant issued by an unrelated run      -> forbidden (issuer authority);
 *   - grant issued by the recorded owner    -> ready;
 *   - corrupted body                        -> invalid even with a grant;
 *   - content-addressed replay keeps the FIRST owner, so the second producer
 *     needs a grant to read the body it also produced.
 */
import { describe, expect, it } from "vitest";
import { ArtifactVault, type StoredRecord } from "../../src/data/artifact-vault/artifact-vault.js";
import type { MaterialAccessGrantV1, MaterialAccessResolver } from "../../src/contracts/material-access.js";
import { buildMaterialAccessGrantV1 } from "../contract-support/fixtures/material-access-fixtures.js";
import type { ArtifactOwnerRunRef, ArtifactRef } from "../../src/contracts/artifact.js";
import type { RunRef, SourceRefV1 } from "../../src/contracts/dispatch.js";

const PROJECT = "proj-alpha";
const GOAL = "goal-1";
const WORKSPACE = "ws-shared";
const AT = "2026-09-08T00:00:00.000Z";
const BODY = "前驱报告正文";
const run = (runId: string): RunRef => ({ aggregateType: "Run", projectId: PROJECT, goalId: GOAL, runId });
const SOURCE: SourceRefV1[] = [{ kind: "workspace", refId: WORKSPACE, revision: "3" }];
const BASIS = { planRef: null, workspaceRevision: 3, sourceDigest: null };

function resolverOf(grants: MaterialAccessGrantV1[]): MaterialAccessResolver {
  return { grantsFor: async () => grants };
}

/** One shared store: the writer puts the body; every reader vault reuses it. */
async function material(owner: ArtifactOwnerRunRef = run("writer")): Promise<{ store: Map<string, StoredRecord>; ref: ArtifactRef }> {
  const store = new Map<string, StoredRecord>();
  const put = await new ArtifactVault(store).put({ contentType: "text/plain", body: BODY, sourceRefs: SOURCE, ownerRef: owner, requestedAt: AT });
  if (put.status !== "stored") throw new Error("put failed: " + JSON.stringify(put));
  return { store, ref: put.ref };
}

const vaultWith = (store: Map<string, StoredRecord>, grants: MaterialAccessGrantV1[]): ArtifactVault =>
  new ArtifactVault(store, { grants: resolverOf(grants) });

function grantFor(ref: ArtifactRef, reader: ArtifactOwnerRunRef, overrides: Partial<MaterialAccessGrantV1> = {}): MaterialAccessGrantV1 {
  return buildMaterialAccessGrantV1({
    grantId: "grant-1",
    scope: { projectId: PROJECT, workspaceId: WORKSPACE, goalId: GOAL },
    materials: [ref],
    reader,
    issuedBy: { aggregateType: "Control", projectId: PROJECT, goalId: GOAL },
    purpose: "reviewer/consumer reads another run's material",
    basis: BASIS,
    grantedAt: AT,
    ...overrides,
  });
}

describe("ArtifactVault material access grants", () => {
  it('does not let scoped Control authorize another project or goal owner, including identical local IDs', async () => {
    for (const owner of [ { ...run('writer'), projectId: 'proj-beta' }, { ...run('writer'), goalId: 'other-goal' },
      { aggregateType: 'QueryRun' as const, projectId: PROJECT, workspaceId: 'other-workspace', queryJobId: 'q', runId: 'writer' } ]) {
      const { store, ref } = await material(owner);
      const reader = run('reader');
      expect(await vaultWith(store, [grantFor(ref, reader)]).open(ref, { requesterRunRef: reader, currentBasis: BASIS }))
        .toMatchObject({ status: 'rejected', code: 'forbidden' });
    }
  });
  it("stays owner-only when no resolver is injected (P1-03 unchanged)", async () => {
    const { store, ref } = await material();
    const vault = new ArtifactVault(store);
    expect(await vault.open(ref, { requesterRunRef: run("writer") })).toMatchObject({ status: "ready" });
    expect(await vault.open(ref, { requesterRunRef: run("reader") })).toMatchObject({ status: "rejected", code: "forbidden" });
  });

  it("authorizes a non-owner reader only through a recorded grant for that exact reader and material", async () => {
    const { store, ref } = await material();
    const reader = run("reader");

    expect(await vaultWith(store, []).open(ref, { requesterRunRef: reader, currentBasis: BASIS }))
      .toMatchObject({ status: "rejected", code: "forbidden" });
    expect(await vaultWith(store, [grantFor(ref, run("someone-else"))]).open(ref, { requesterRunRef: reader, currentBasis: BASIS }))
      .toMatchObject({ status: "rejected", code: "forbidden" });
    expect(await vaultWith(store, [grantFor({ ...ref, digest: "a".repeat(64) }, reader)]).open(ref, { requesterRunRef: reader, currentBasis: BASIS }))
      .toMatchObject({ status: "rejected", code: "forbidden" });
    expect(await vaultWith(store, [grantFor(ref, reader)]).open(ref, { requesterRunRef: reader, currentBasis: BASIS }))
      .toMatchObject({ status: "ready", record: { ref, body: BODY } });
  });

  it("refuses inherited material when the reader's basis changed (stale, not silently reused)", async () => {
    const { store, ref } = await material();
    const reader = run("reader");
    const vault = vaultWith(store, [grantFor(ref, reader)]);
    expect(await vault.open(ref, { requesterRunRef: reader, currentBasis: { ...BASIS, workspaceRevision: 4 } }))
      .toMatchObject({ status: "rejected", code: "stale" });
    expect(await vault.open(ref, { requesterRunRef: reader, currentBasis: { ...BASIS, sourceDigest: "d".repeat(64) } }))
      .toMatchObject({ status: "rejected", code: "stale" });
    expect(await vault.open(ref, { requesterRunRef: reader, currentBasis: { ...BASIS, planRef: { aggregateType: "PlanRevision", projectId: PROJECT, planId: "plan-2" } } }))
      .toMatchObject({ status: "rejected", code: "stale" });
    expect(await vault.open(ref, { requesterRunRef: reader, currentBasis: BASIS })).toMatchObject({ status: "ready" });
  });

  it("never applies a conditional grant to a reader that declares no basis, but honours an unconditional one", async () => {
    const { store, ref } = await material();
    const reader = run("reader");
    expect(await vaultWith(store, [grantFor(ref, reader)]).open(ref, { requesterRunRef: reader }))
      .toMatchObject({ status: "rejected", code: "stale" });
    const unconditional = vaultWith(store, [grantFor(ref, reader, { basis: { planRef: null, workspaceRevision: null, sourceDigest: null } })]);
    expect(await unconditional.open(ref, { requesterRunRef: reader })).toMatchObject({ status: "ready" });
    expect(await unconditional.open(ref, { requesterRunRef: reader, currentBasis: { ...BASIS, workspaceRevision: 9 } }))
      .toMatchObject({ status: "ready" });
  });

  it("ignores a grant issued by a run that is not the material owner or Control", async () => {
    const { store, ref } = await material();
    const reader = run("reader");
    expect(await vaultWith(store, [grantFor(ref, reader, { issuedBy: run("unrelated") })]).open(ref, { requesterRunRef: reader, currentBasis: BASIS }))
      .toMatchObject({ status: "rejected", code: "forbidden" });
    expect(await vaultWith(store, [grantFor(ref, reader, { issuedBy: run("writer") })]).open(ref, { requesterRunRef: reader, currentBasis: BASIS }))
      .toMatchObject({ status: "ready" });
  });

  it("still rejects a corrupted body even when a grant authorizes the reader", async () => {
    const { store, ref } = await material();
    const reader = run("reader");
    const key = [...store.keys()][0]!;
    store.set(key, { ...store.get(key)!, body: "corrupted" });
    expect(await vaultWith(store, [grantFor(ref, reader)]).open(ref, { requesterRunRef: reader, currentBasis: BASIS }))
      .toMatchObject({ status: "rejected", code: "invalid" });
  });

  it("lets a second producer read a replayed body through a grant (content addressing keeps the FIRST owner)", async () => {
    const first = run("first");
    const second = run("second");
    const { store, ref } = await material(first);
    const replayed = await new ArtifactVault(store).put({ contentType: "text/plain", body: BODY, sourceRefs: SOURCE, ownerRef: second, requestedAt: AT });
    expect(replayed).toMatchObject({ status: "stored", replayed: true });
    expect(await new ArtifactVault(store).open(ref, { requesterRunRef: second })).toMatchObject({ status: "rejected", code: "forbidden" });
    expect(await vaultWith(store, [grantFor(ref, second)]).open(ref, { requesterRunRef: second, currentBasis: BASIS }))
      .toMatchObject({ status: "ready" });
  });
});
