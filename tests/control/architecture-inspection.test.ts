/**
 * P1-12 lane B unit tests: the four record commands — RecordArchitectureInspection /
 * RecordArchitectureFinding / RecordArchitectureDecisionBrief /
 * RecordCandidateBaselineProposal — over a REAL InMemoryLedger via the
 * ControlEngineImpl handler.
 *
 * Frozen semantics under test:
 *   - happy path: ONE atomic commit per command (CAS@0), fold-equivalent to the
 *     shared fixture builder, snapshot persisted @1;
 *   - idempotent replay -> committed(replayed) with the SAME eventIds (no write);
 *   - a different identity on the SAME aggregate -> revision_conflict (zero write);
 *   - pinned baseline missing -> not_found (zero write);
 *   - pinned baseline digest mismatch -> baseline_mismatch (zero write);
 *   - candidate proposal digest recompute mismatch -> digest_mismatch (zero write);
 *   - NO remediation/gate/activation side effects anywhere.
 */
import { describe, expect, it } from "vitest";
import { createControlEngine } from "../../src/control/control-engine/control-engine.js";
import { InMemoryLedger } from "../../src/data/state-ledger/in-memory-ledger.js";
import type { StateLedger, LedgerCommit, LedgerCommitReceipt, ArchitectureInspectionRecordLedgerCommitV1, ArchitectureFindingRecordLedgerCommitV1, ArchitectureBriefRecordLedgerCommitV1, ArchitectureProposalRecordLedgerCommitV1 } from "../../src/contracts/ledger.js";
import { createDeterministicDeps, FIXED_ISO_2026_09_05 } from "../../src/testing/sequences.js";
import { buildBootstrapCommand } from "../../src/contracts/bootstrap.js";
import { WORKSPACE_BOOTSTRAP_FIXTURE_V1 } from "../contract-support/fixtures/bootstrap-fixture-v1.js";
import { ARCHITECTURE_BASELINE_FIXTURE_V1, buildInstallCommand } from "../../src/fixtures/governance-fixtures.js";
import { P112_PROJECT, P112_WORKSPACE, P112_INSPECTION, P112_INSPECTION_REPORT, P112_FINDING_DELTA, P112_FINDING_REPORT, P112_BRIEF, P112_PROPOSAL, p112BaselinePin, buildP112InspectionIntent, buildP112InspectionSnapshot, buildP112DeltaFinding, buildP112ReportFinding, buildP112Brief, buildP112Proposal, buildRecordArchitectureInspectionCommand, buildRecordArchitectureFindingCommand, buildRecordArchitectureDecisionBriefCommand, buildRecordCandidateBaselineProposalCommand } from "../../src/fixtures/architecture-fixtures.js";
import { buildArchitectureInspectionRecordLedgerCommit, buildArchitectureFindingRecordLedgerCommit, buildArchitectureBriefRecordLedgerCommit, buildArchitectureProposalRecordLedgerCommit } from "../../src/control/control-engine/records/architecture.js";
import { architectureInspectionRefFor, architectureFindingRefFor, architectureDecisionBriefRefFor, architectureCandidateProposalRefFor } from "../../src/contracts/architecture-inspection.js";
import type { ArchitectureBaselinePin } from "../../src/contracts/governance.js";

const FIXED = FIXED_ISO_2026_09_05;

class RecordingLedger extends InMemoryLedger {
  commits: LedgerCommit[] = [];
  override async commit(batch: LedgerCommit): Promise<LedgerCommitReceipt> {
    this.commits.push(batch);
    return super.commit(batch);
  }
}

function makeHarness() {
  const ledger = new RecordingLedger();
  const d = createDeterministicDeps();
  const engine = createControlEngine({ ledger, now: d.clock, eventId: d.eventId });
  return { ledger, engine };
}

/** Install the pinned baseline for P112_PROJECT so ledger.load(pin.ref) resolves.
 *  The pin digest is content-derived, so any install commandId yields the SAME
 *  ref+digest as p112BaselinePin(). */
async function setupBaseline() {
  const { ledger, engine } = makeHarness();
  await engine.bootstrap(
    buildBootstrapCommand(WORKSPACE_BOOTSTRAP_FIXTURE_V1, {
      commandId: "p112-cmd-bootstrap",
      correlationId: "p112-corr-bootstrap",
      submittedAt: FIXED,
    }),
  );
  const ab = buildInstallCommand(ARCHITECTURE_BASELINE_FIXTURE_V1, {
    commandId: "p112-cmd-install-baseline",
    correlationId: "p112-corr-install-baseline",
    submittedAt: FIXED,
    projectId: P112_PROJECT,
    idempotencyKey: "p112-install-baseline",
  });
  expect((await engine.install(ab)).status).toBe("committed");
  return { ledger, engine };
}

async function eventCount(ledger: StateLedger): Promise<number> {
  const page = await ledger.events({ afterCursor: null, limit: 2000 });
  return page.events.length;
}

describe("P1-12 record commands: happy path (atomic commit + fold-equality)", () => {
  it("inspection commits the exact fold and persists the snapshot (then idempotent replay)", async () => {
    const { ledger, engine } = await setupBaseline();
    const before = await eventCount(ledger);
    const intent = buildP112InspectionIntent({ inspectionId: P112_INSPECTION });
    const inspection = buildP112InspectionSnapshot(intent);
    const command = buildRecordArchitectureInspectionCommand(inspection, { commandId: "p112-cmd-insp" });

    const receipt = await engine.recordArchitectureInspection(command);
    expect(receipt.status).toBe("committed");
    if (receipt.status !== "committed") return;
    expect(receipt.inspectionRef).toEqual(architectureInspectionRefFor(P112_PROJECT, P112_WORKSPACE, P112_INSPECTION));

    const submitted = ledger.commits[ledger.commits.length - 1]! as ArchitectureInspectionRecordLedgerCommitV1;
    const evId = submitted.events[0]!.eventId;
    const expected = buildArchitectureInspectionRecordLedgerCommit(command, { eventId: evId, occurredAt: FIXED });
    expect(submitted).toEqual(expected);

    const loaded = await ledger.load(receipt.inspectionRef);
    expect(loaded.status).toBe("found");
    if (loaded.status === "found") expect(loaded.snapshot.revision).toBe(1);
    expect(await eventCount(ledger)).toBe(before + 1);

    // Idempotent replay -> committed(replayed), same eventIds, no extra write.
    const replay = await engine.recordArchitectureInspection(command);
    expect(replay.status).toBe("committed");
    if (replay.status === "committed") expect(replay.replayed).toBe(true);
    expect(await eventCount(ledger)).toBe(before + 1);
  });

  it("finding commits the exact fold and persists the snapshot (then idempotent replay)", async () => {
    const { ledger, engine } = await setupBaseline();
    const before = await eventCount(ledger);
    const finding = buildP112DeltaFinding();
    const command = buildRecordArchitectureFindingCommand(finding, { commandId: "p112-cmd-finding" });

    const receipt = await engine.recordArchitectureFinding(command);
    expect(receipt.status).toBe("committed");
    if (receipt.status !== "committed") return;
    expect(receipt.findingRef).toEqual(architectureFindingRefFor(P112_PROJECT, P112_WORKSPACE, P112_FINDING_DELTA));

    const submitted = ledger.commits[ledger.commits.length - 1]! as ArchitectureFindingRecordLedgerCommitV1;
    const evId = submitted.events[0]!.eventId;
    expect(submitted).toEqual(buildArchitectureFindingRecordLedgerCommit(command, { eventId: evId, occurredAt: FIXED }));

    const loaded = await ledger.load(receipt.findingRef);
    expect(loaded.status).toBe("found");
    if (loaded.status === "found") expect(loaded.snapshot.revision).toBe(1);
    expect(await eventCount(ledger)).toBe(before + 1);

    const replay = await engine.recordArchitectureFinding(command);
    expect(replay.status).toBe("committed");
    if (replay.status === "committed") expect(replay.replayed).toBe(true);
    expect(await eventCount(ledger)).toBe(before + 1);
  });

  it("decision brief commits the exact fold and persists the snapshot (then idempotent replay)", async () => {
    const { ledger, engine } = await setupBaseline();
    const before = await eventCount(ledger);
    const brief = buildP112Brief();
    const command = buildRecordArchitectureDecisionBriefCommand(brief, { commandId: "p112-cmd-brief" });

    const receipt = await engine.recordArchitectureDecisionBrief(command);
    expect(receipt.status).toBe("committed");
    if (receipt.status !== "committed") return;
    expect(receipt.briefRef).toEqual(architectureDecisionBriefRefFor(P112_PROJECT, P112_WORKSPACE, P112_BRIEF));

    const submitted = ledger.commits[ledger.commits.length - 1]! as ArchitectureBriefRecordLedgerCommitV1;
    const evId = submitted.events[0]!.eventId;
    expect(submitted).toEqual(buildArchitectureBriefRecordLedgerCommit(command, { eventId: evId, occurredAt: FIXED }));

    const loaded = await ledger.load(receipt.briefRef);
    expect(loaded.status).toBe("found");
    if (loaded.status === "found") expect(loaded.snapshot.revision).toBe(1);
    expect(await eventCount(ledger)).toBe(before + 1);

    const replay = await engine.recordArchitectureDecisionBrief(command);
    expect(replay.status).toBe("committed");
    if (replay.status === "committed") expect(replay.replayed).toBe(true);
    expect(await eventCount(ledger)).toBe(before + 1);
  });

  it("candidate proposal commits the exact fold and persists the snapshot (then idempotent replay)", async () => {
    const { ledger, engine } = await setupBaseline();
    const before = await eventCount(ledger);
    const proposal = buildP112Proposal();
    const command = buildRecordCandidateBaselineProposalCommand(proposal, { commandId: "p112-cmd-proposal" });

    const receipt = await engine.recordCandidateBaselineProposal(command);
    expect(receipt.status).toBe("committed");
    if (receipt.status !== "committed") return;
    expect(receipt.proposalRef).toEqual(architectureCandidateProposalRefFor(P112_PROJECT, P112_WORKSPACE, P112_PROPOSAL));

    const submitted = ledger.commits[ledger.commits.length - 1]! as ArchitectureProposalRecordLedgerCommitV1;
    const evId = submitted.events[0]!.eventId;
    expect(submitted).toEqual(buildArchitectureProposalRecordLedgerCommit(command, { eventId: evId, occurredAt: FIXED }));

    const loaded = await ledger.load(receipt.proposalRef);
    expect(loaded.status).toBe("found");
    if (loaded.status === "found") expect(loaded.snapshot.revision).toBe(1);
    expect(await eventCount(ledger)).toBe(before + 1);

    const replay = await engine.recordCandidateBaselineProposal(command);
    expect(replay.status).toBe("committed");
    if (replay.status === "committed") expect(replay.replayed).toBe(true);
    expect(await eventCount(ledger)).toBe(before + 1);
  });
});

describe("P1-12 record commands: zero-write rejections", () => {
  it("rejects an invalid inspection command -> invalid (zero write)", async () => {
    const { ledger, engine } = await setupBaseline();
    const before = await eventCount(ledger);
    const command = buildRecordArchitectureInspectionCommand(buildP112InspectionSnapshot(buildP112InspectionIntent({ inspectionId: P112_INSPECTION })), { commandId: "p112-cmd-insp-bad" });
    (command as unknown as Record<string, unknown>)["commandType"] = "WrongType";
    const receipt = await engine.recordArchitectureInspection(command as never);
    expect(receipt.status).toBe("rejected");
    if (receipt.status === "rejected") expect(receipt.code).toBe("invalid");
    expect(await eventCount(ledger)).toBe(before);
  });

  it("rejects not_found when the pinned baseline is not installed (zero write)", async () => {
    const { ledger, engine } = await setupBaseline();
    const before = await eventCount(ledger);
    const ghostPin: ArchitectureBaselinePin = {
      ref: { ...p112BaselinePin().ref, baselineId: "baseline-ghost" },
      digest: p112BaselinePin().digest,
    };
    const inspection = buildP112InspectionSnapshot(buildP112InspectionIntent({ inspectionId: P112_INSPECTION, baselinePin: ghostPin }));
    const receipt = await engine.recordArchitectureInspection(
      buildRecordArchitectureInspectionCommand(inspection, { commandId: "p112-cmd-insp-ghost" }),
    );
    expect(receipt.status).toBe("rejected");
    if (receipt.status === "rejected") expect(receipt.code).toBe("not_found");
    expect(await eventCount(ledger)).toBe(before);
  });

  it("rejects baseline_mismatch on a digest that differs from the installed baseline (zero write)", async () => {
    const { ledger, engine } = await setupBaseline();
    const before = await eventCount(ledger);
    const badPin: ArchitectureBaselinePin = { ref: p112BaselinePin().ref, digest: "deadbeef".padEnd(64, "0") };
    const inspection = buildP112InspectionSnapshot(buildP112InspectionIntent({ inspectionId: P112_INSPECTION, baselinePin: badPin }));
    const receipt = await engine.recordArchitectureInspection(
      buildRecordArchitectureInspectionCommand(inspection, { commandId: "p112-cmd-insp-digest" }),
    );
    expect(receipt.status).toBe("rejected");
    if (receipt.status === "rejected") expect(receipt.code).toBe("baseline_mismatch");
    expect(await eventCount(ledger)).toBe(before);
  });

  it("rejects digest_mismatch when the proposal digest is tampered (zero write)", async () => {
    const { ledger, engine } = await setupBaseline();
    const before = await eventCount(ledger);
    const proposal = buildP112Proposal();
    proposal.proposalDigest = "0".repeat(64);
    const receipt = await engine.recordCandidateBaselineProposal(
      buildRecordCandidateBaselineProposalCommand(proposal, { commandId: "p112-cmd-proposal-tamper" }),
    );
    expect(receipt.status).toBe("rejected");
    if (receipt.status === "rejected") expect(receipt.code).toBe("digest_mismatch");
    expect(await eventCount(ledger)).toBe(before);
  });

  it("does NOT accept a report-source finding without a baseline MUTATED into the ledger (no activation side effect)", async () => {
    const { ledger, engine } = await setupBaseline();
    const before = await eventCount(ledger);
    const finding = buildP112ReportFinding();
    const receipt = await engine.recordArchitectureFinding(
      buildRecordArchitectureFindingCommand(finding, { commandId: "p112-cmd-finding-report" }),
    );
    expect(receipt.status).toBe("committed");
    // The ledger holds exactly ONE event from this command — no activation/gate.
    expect(await eventCount(ledger)).toBe(before + 1);
  });
});

describe("P1-12 record commands: revision_conflict (different identity, same aggregate)", () => {
  it("a different identity recording the SAME aggregate -> revision_conflict (zero write)", async () => {
    const { ledger, engine } = await setupBaseline();
    const finding = buildP112DeltaFinding();
    const first = await engine.recordArchitectureFinding(
      buildRecordArchitectureFindingCommand(finding, { commandId: "p112-cmd-finding-a" }),
    );
    expect(first.status).toBe("committed");
    const before = await eventCount(ledger);
    // Same findingId aggregate, but a DIFFERENT identity (different actor) ->
    // the CAS@0 window is already taken -> revision_conflict, zero write.
    const second = await engine.recordArchitectureFinding(
      buildRecordArchitectureFindingCommand(finding, { commandId: "p112-cmd-finding-b", actor: { kind: "system", id: "other-reconciler" } }),
    );
    expect(second.status).toBe("rejected");
    if (second.status === "rejected") expect(second.code).toBe("revision_conflict");
    expect(await eventCount(ledger)).toBe(before);
  });
});
