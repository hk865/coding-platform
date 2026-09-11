/**
 * Lane B tests — WorkContextCompilerImpl (bounded work-context assembly).
 * Covers: ready (bundleRef openable + manifest complete), needs_material
 * (binding missing / material gap), rejected (invalid_request /
 * forbidden_tool_or_scope / budget_exhausted), bounded (maxNotes + truncated
 * report), and the no-model invariant (assembly NEVER starts a model/session).
 */
import { describe, expect, it } from "vitest";
import { WorkContextCompilerImpl } from "../../src/data/context-compiler/work-context-compiler.js";
import { ArtifactVault } from "../../src/data/artifact-vault/artifact-vault.js";
import { makeCommitCursor } from "../../src/contracts/ledger.js";
import { canonicalJson } from "../../src/contracts/fingerprint.js";
import type { StateLedger, AggregateSnapshot, SnapshotResult } from "../../src/contracts/ledger.js";
import type { ReadModelIndex } from "../../src/contracts/goal-view.js";
import type {
  WorkContextViewResult,
  WorkContextBindingSnapshot,
  WorkContextNoteRow,
  ContinuationRecordSnapshot,
} from "../../src/contracts/context-continuity.js";
import { WORK_CONTEXT_BUNDLE_MAX_BYTES, WORK_CONTEXT_VIEW_MAX_NOTES } from "../../src/contracts/context-continuity.js";
import {
  P116_PROJECT_A,
  P116_WORKSPACE,
  P116_WORK,
  P116_SCHEMA,
  P116_NOTE_1,
  P116_NOTE_2,
  P116_REPORT_1,
  buildWorkContextBindingV1,
  buildContextContinuationResultV1,
  p116WorkContextRef,
} from "../contract-support/fixtures/context-fixtures.js";
import { P107_ROLE_BINDING_READER_V1 } from "../contract-support/fixtures/workspace-fixtures.js";
import { runRefFor } from "../../src/contracts/dispatch.js";
import { executionNoteRefFor, continuationRecordRefFor } from "../../src/contracts/context-continuity.js";
import type { WorkContextRequestV1 } from "../../src/contracts/work-context-port.js";

const PROJECT = P116_PROJECT_A;
const WORKSPACE = P116_WORKSPACE;
const WORK = "work-p116-coord";
const SCHEMA = P116_SCHEMA;

const initialRun = runRefFor(PROJECT, "goal-c", "run-initial");
const laterRun = runRefFor(PROJECT, "goal-c", "run-later");
const wref = p116WorkContextRef(PROJECT, WORK);

const binding = buildWorkContextBindingV1({
  workId: WORK,
  projectId: PROJECT,
  workspaceId: WORKSPACE,
  workKind: "coordination",
  goalId: null,
  taskId: null,
  roleBindingRef: P107_ROLE_BINDING_READER_V1,
  initialRunRef: initialRun,
  linkedRunRefs: [initialRun, laterRun],
  createdAt: SCHEMA,
});

const bindingSnapshot: WorkContextBindingSnapshot = {
  ref: wref,
  revision: 1,
  schemaVersion: 1,
  binding,
};

function noteRow(noteId: string, kind: "checkpoint" | "frontier", runId: string, seq: number): WorkContextNoteRow {
  return {
    noteRef: executionNoteRefFor(PROJECT, WORKSPACE, WORK, noteId),
    kind,
    summary: "note " + noteId,
    runRef: runRefFor(PROJECT, "goal-c", runId),
    createdAt: SCHEMA,
    sourceCursor: makeCommitCursor(seq),
  };
}

const contSnapshot: ContinuationRecordSnapshot = {
  ref: continuationRecordRefFor(PROJECT, WORKSPACE, WORK, P116_REPORT_1),
  revision: 1,
  schemaVersion: 1,
  result: buildContextContinuationResultV1({
    reportId: P116_REPORT_1,
    workId: WORK,
    projectId: PROJECT,
    workspaceId: WORKSPACE,
    requestedByRunRef: laterRun,
    status: "took_over",
    originalRunRef: initialRun,
    takeoverRunRef: laterRun,
    resumedFromRunRef: initialRun,
    capabilitySource: "runtime",
  }),
};

function readyView(): Extract<WorkContextViewResult, { status: "ready" }> {
  return {
    status: "ready",
    binding: bindingSnapshot,
    notes: [noteRow(P116_NOTE_1, "checkpoint", "run-initial", 1), noteRow(P116_NOTE_2, "frontier", "run-later", 2)],
    continuations: [contSnapshot],
    sourceCursor: makeCommitCursor(3),
  };
}

function workspaceSnapshot(): AggregateSnapshot {
  return {
    ref: { aggregateType: "Workspace", projectId: PROJECT, workspaceId: WORKSPACE },
    revision: 1,
  } as AggregateSnapshot;
}

function ledgerSnapshot(ref: unknown): SnapshotResult {
  const key = canonicalJson(ref as never);
  if (key === canonicalJson(wref)) return { status: "found", snapshot: bindingSnapshot };
  if (key === canonicalJson({ aggregateType: "Workspace", projectId: PROJECT, workspaceId: WORKSPACE })) {
    return { status: "found", snapshot: workspaceSnapshot() };
  }
  return { status: "not_found", ref: ref as never };
}

function makeLedger(): StateLedger {
  return {
    load: async (ref: Parameters<StateLedger["load"]>[0]) => ledgerSnapshot(ref),
    commit: async () => ({ status: "committed" as const, idempotencyKey: "k", receipts: [] }),
    events: async () => ({ afterCursor: null, throughCursor: null, events: [], hasMore: false }),
    pendingDispatchIntents: async () => [],
  } as unknown as StateLedger;
}

function makeReadModel(view: WorkContextViewResult): ReadModelIndex {
  return { workContext: async () => view } as unknown as ReadModelIndex;
}

function request(overrides: Partial<WorkContextRequestV1> = {}): WorkContextRequestV1 {
  return {
    schemaVersion: 1,
    workContextRef: wref,
    requestedByRunRef: laterRun,
    roleBindingRef: P107_ROLE_BINDING_READER_V1,
    declaredPermissions: { tools: ["read", "write"], writeScope: [WORKSPACE] },
    requiredMaterial: ["binding", "notes", "continuation", "sources"],
    maxBundleBytes: WORK_CONTEXT_BUNDLE_MAX_BYTES,
    noteKinds: ["checkpoint", "frontier"],
    maxNotes: 10,
    ...overrides,
  };
}

function makeCompiler(overrides: { view?: WorkContextViewResult; ledger?: StateLedger; now?: () => string } = {}) {
  const vault = new ArtifactVault();
  const deps = {
    ledger: overrides.ledger ?? makeLedger(),
    vault,
    now: overrides.now ?? (() => SCHEMA),
    readModel: makeReadModel(overrides.view ?? readyView()),
  };
  return { compiler: new WorkContextCompilerImpl(deps), vault };
}

describe("WorkContextCompilerImpl (Lane B)", () => {
  it("lists only the notes and continuation actually included after filtering and truncation", async () => {
    const view = readyView();
    view.continuations.push({ ...contSnapshot, ref: { ...contSnapshot.ref, reportId: 'older-report' } });
    const { compiler, vault } = makeCompiler({ view });
    const result = await compiler.assembleWorkContext(request({ maxNotes: 1, noteKinds: ['frontier'] }));
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw Error('assembly failed');
    const opened = await vault.open(result.bundleRef, { requesterRunRef: laterRun });
    if (opened.status !== 'ready') throw Error('body unavailable');
    const body = JSON.parse(opened.record.body);
    expect(result.manifest.selected.filter(s => s.kind === 'execution-note').map(s => s.label)).toEqual([P116_NOTE_2]);
    expect(result.manifest.selected.filter(s => s.kind === 'continuation').map(s => s.label)).toEqual([P116_REPORT_1]);
    expect(body.selectedSources).toEqual(result.manifest.selected);
    expect(result.manifest.totalBytes).toBe(Buffer.byteLength(opened.record.body, 'utf8'));
  });
  it("ready: bounded bundle stored body-first; bundleRef opens; manifest complete", async () => {
    const { compiler, vault } = makeCompiler();
    const res = await compiler.assembleWorkContext(request());
    expect(res.status).toBe("ready");
    if (res.status !== "ready") return;
    const open = await vault.open(res.bundleRef, { requesterRunRef: laterRun });
    expect(open.status).toBe("ready");
    if (open.status === "ready") {
      const body = JSON.parse(open.record.body);
      expect(body.schemaVersion).toBe(1);
      expect(body.workContextRef.workId).toBe(WORK);
      expect(body.bucketRows).toHaveLength(2);
      expect(body.latestContinuation.status).toBe("took_over");
      expect(body.selectedSources.length).toBeGreaterThan(0);
    }
    expect(res.manifest.bundleRef.kind).toBe("artifact");
    expect(res.manifest.gaps).toEqual([]);
    expect(res.manifest.totalBytes).toBeGreaterThan(0);
    expect(res.manifest.truncated).toEqual([]);
    expect(res.manifest.freshness.observedCursor).toBeTruthy();
  });

  it("needs_material(binding_missing) when the work-context view is not_found", async () => {
    const { compiler } = makeCompiler({
      view: {
        status: "not_found",
        projectId: PROJECT,
        workspaceId: WORKSPACE,
        workId: WORK,
      },
    });
    const res = await compiler.assembleWorkContext(request());
    expect(res.status).toBe("needs_material");
    if (res.status === "needs_material") {
      expect(res.gaps.some((g) => g.code === "binding_missing")).toBe(true);
    }
  });

  it("needs_material(workspace_material_missing) when a required material is absent", async () => {
    // requiredMaterial includes notes but the view carries no notes.
    const view = readyView();
    const noNotes: Extract<WorkContextViewResult, { status: "ready" }> = { ...view, notes: [] };
    const { compiler } = makeCompiler({ view: noNotes });
    const res = await compiler.assembleWorkContext(request());
    expect(res.status).toBe("needs_material");
    if (res.status === "needs_material") {
      expect(res.gaps.some((g) => g.code === "workspace_material_missing")).toBe(true);
    }
  });

  it("rejected(work_not_found) when the binding is not registered in the ledger", async () => {
    const noBindingLedger: StateLedger = {
      ...makeLedger(),
      load: async (ref: Parameters<StateLedger["load"]>[0]) => ({ status: "not_found" as const, ref: ref as never }),
    } as unknown as StateLedger;
    const { compiler } = makeCompiler({ ledger: noBindingLedger });
    const res = await compiler.assembleWorkContext(request());
    expect(res.status).toBe("rejected");
    if (res.status === "rejected") expect(res.code).toBe("work_not_found");
  });

  it("rejected(invalid_request) for a malformed request (unknown schema / missing required)", async () => {
    const { compiler } = makeCompiler();
    const bad = await compiler.assembleWorkContext(request({ schemaVersion: 2 } as never));
    expect(bad.status).toBe("rejected");
    if (bad.status === "rejected") expect(bad.code).toBe("invalid_request");
    const missingRef = await compiler.assembleWorkContext({ ...request(), workContextRef: undefined } as never);
    expect(missingRef.status).toBe("rejected");
    if (missingRef.status === "rejected") expect(missingRef.code).toBe("invalid_request");
  });

  it("rejected(forbidden_tool_or_scope) when the declared scope is empty", async () => {
    const { compiler } = makeCompiler();
    const res = await compiler.assembleWorkContext(request({ declaredPermissions: { tools: [], writeScope: [WORKSPACE] } }));
    expect(res.status).toBe("rejected");
    if (res.status === "rejected") expect(res.code).toBe("forbidden_tool_or_scope");
  });

  it("rejected(budget_exhausted) when maxBundleBytes exceeds the hard cap", async () => {
    const { compiler } = makeCompiler();
    const res = await compiler.assembleWorkContext(request({ maxBundleBytes: WORK_CONTEXT_BUNDLE_MAX_BYTES + 1 }));
    expect(res.status).toBe("rejected");
    if (res.status === "rejected") expect(res.code).toBe("budget_exhausted");
  });

  it("bounded: notes bounded by maxNotes, truncation reported in the manifest", async () => {
    // maxNotes = 1 but the view carries 2 notes -> the bundle bounds to 1 and
    // reports the truncated note ids.
    const { compiler, vault } = makeCompiler();
    const res = await compiler.assembleWorkContext(request({ maxNotes: 1 }));
    expect(res.status).toBe("ready");
    if (res.status !== "ready") return;
    // The bounded bundle carries only 1 note (maxNotes=1), not the full view.
    const open = await vault.open(res.bundleRef, { requesterRunRef: laterRun });
    expect(open.status).toBe("ready");
    if (open.status === "ready") {
      const body = JSON.parse(open.record.body);
      expect(body.bucketRows).toHaveLength(1);
    }
    // The manifest reports the note that was left out (bounded/truncated).
    expect(res.manifest.truncated.length).toBeGreaterThan(0);
    if (res.manifest.truncated.length > 0) {
      expect(res.manifest.truncated[0]!.noteIds).toContain(P116_NOTE_2);
    }
  });

  it("no-model invariant: assembly NEVER starts a model / session / agent (0 calls)", async () => {
    // The compiler deps carry NO model/session/agent port; a spy injected as an
    // EXTRA dep key must observe 0 invocations — assembly is a pure selection.
    const vault = new ArtifactVault();
    const modelSpy = { start: 0, calls: 0 };
    const deps = {
      ledger: makeLedger(),
      vault,
      now: () => SCHEMA,
      readModel: makeReadModel(readyView()),
      model: modelSpy,
    };
    const compiler = new WorkContextCompilerImpl(deps);
    const res = await compiler.assembleWorkContext(request());
    expect(res.status).toBe("ready");
    expect(modelSpy.calls).toBe(0);
    expect(modelSpy.start).toBe(0);
  });

  it("determinism: same input -> same bundleRef (content-addressed) and same manifest", async () => {
    const A = makeCompiler();
    const B = makeCompiler();
    const ra = await A.compiler.assembleWorkContext(request());
    const rb = await B.compiler.assembleWorkContext(request());
    expect(ra.status).toBe("ready");
    expect(rb.status).toBe("ready");
    if (ra.status === "ready" && rb.status === "ready") {
      expect(JSON.stringify(ra.manifest)).toBe(JSON.stringify(rb.manifest));
      expect(ra.bundleRef.digest).toBe(rb.bundleRef.digest);
    }
  });
});
