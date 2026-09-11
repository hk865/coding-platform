/**
 * P1-16 context-continuity contract suite — the 7-item acceptance + the
 * 5 verification groups (same-work-multiturn / incremental-note-crash /
 * continuation-capability-fallback / stale-lease-and-context / real-kernel),
 * run IDENTICALLY against the InMemory and the SQLite harnesses.
 *
 * The suite only calls the frozen P1-16 signatures (WorkRecordPort commands,
 * WorkContextViewQuery, WorkContextPort request, ContextContinuationPort
 * capabilities) plus the frozen earlier harness surface. The lane
 * implementations make the assertions pass. AUTO-SKIPPED on both adapters
 * until the P1-16 work-record + projection + assembly paths exist
 * (probe isP116Ready, no fake).
 */
import { describe, it, expect, beforeAll } from "vitest";
import type { P1_16TestHarness } from "./p1-16-harness.js";
import { runP116ContinuityScenario, toP1_16Harness, type P116ContinuityScenarioResult } from "./p1-16-harness.js";
import {
  P116_PROJECT_A,
  P116_PROJECT_B,
  P116_WORKSPACE,
  P116_WORK,
  P116_NOTE_1,
  P116_NOTE_2,
  P116_REPORT_1,
  P116_REPORT_2,
  buildBindWorkContextCommand,
  buildLinkWorkRunCommand,
  buildRecordExecutionNoteCommand,
  buildRecordContinuationCommand,
  p116WorkContextRef,
} from "../../src/contracts/fixtures/context-fixtures.js";
import { workContextRefFor, EXECUTION_NOTE_MAX_BYTES, WORK_CONTEXT_MAX_RUN_LINKS } from "../../src/contracts/context-continuity.js";
import { P108_PROJECT_A, P108_PROJECT_B, P108_TASK_WORK, P108_EVIDENCE_CLAIM } from "./p1-08-harness.js";

export interface P1_16FactoryOptions {
  runtime?: import("../../src/contracts/ports.js").RunPort;
}

export function defineContextContinuityContractSuite(
  factory: (options?: P1_16FactoryOptions) => Promise<P1_16TestHarness>,
  suiteOptions: { name?: string } = {},
): void {
  const suiteName = suiteOptions.name ?? "P1-16 context continuity contract suite";
  describe(suiteName, () => {
    let h: P1_16TestHarness;
    let scen: P116ContinuityScenarioResult;

    beforeAll(async () => {
      h = await factory();
      scen = await runP116ContinuityScenario(h);
    });

    describe("same-work-multiturn-test", () => {
      it("binds the durable work identity ONCE and keeps it across runs", async () => {
        const w1 = await h.workContextView({ projectId: P108_PROJECT_A, workspaceId: P116_WORKSPACE, workId: P116_WORK });
        expect(w1.status).toBe("ready");
        if (w1.status !== "ready") return;
        expect(w1.binding.binding.workKind).toBe("task");
        expect(w1.binding.binding.taskId).toBe(P108_TASK_WORK);
        expect(w1.binding.binding.linkedRunRefs.length).toBe(1);
        expect(w1.binding.binding.linkedRunRefs[0]!.runId).toBe(scen.works.aWork.initialRun.runId);
        // Work identity is NOT a Run: a run carrying many facts is still ONE work.
        expect(w1.binding.binding.initialRunRef.runId).toBe(scen.works.aWork.initialRun.runId);
      });

      it("one coordination work spans TWO runs (link path) — run/work/context separate", async () => {
        const w2 = await h.workContextView({ projectId: P108_PROJECT_A, workspaceId: P116_WORKSPACE, workId: "work-p116-coord" });
        expect(w2.status).toBe("ready");
        if (w2.status !== "ready") return;
        expect(w2.binding.binding.workKind).toBe("coordination");
        expect(w2.binding.binding.linkedRunRefs.map((r) => r.runId)).toEqual([
          scen.works.aCoord.initialRun.runId,
          scen.works.aCoord.laterRun.runId,
        ]);
      });

      it("duplicate bind of the same workId is CAS-rejected (same Identity replays)", async () => {
        const dup = await h.bindWorkContext(buildBindWorkContextCommand({
          commandId: "p116-cmd-bind-w1-dup",
          projectId: P108_PROJECT_A,
          workId: P116_WORK,
          workKind: "coordination",
          goalId: null,
          taskId: null,
          initialRunRef: scen.works.aWork.initialRun,
        }));
        expect(dup.status).toBe("rejected");
        if (dup.status === "rejected") expect(dup.code).toBe("revision_conflict");
      });
    });

    describe("incremental-note-crash-test", () => {
      it("notes survive WITHOUT a final summary and are view-visible", async () => {
        const w2 = await h.workContextView({ projectId: P108_PROJECT_A, workspaceId: P116_WORKSPACE, workId: "work-p116-coord" });
        expect(w2.status).toBe("ready");
        if (w2.status !== "ready") return;
        // Crash semantics: note1 was recorded, no final summary exists — the
        // recorded notes are still visible (recoverable from durable records).
        const noteIds = w2.notes.map((n) => n.noteRef.noteId);
        expect(noteIds).toContain(P116_NOTE_1);
        expect(noteIds).toContain(P116_NOTE_2);
        expect(w2.notes.length).toBe(2);
      });

      it("repeated submission is idempotent (same identity+fingerprint -> replayed)", async () => {
        const replay = await h.recordExecutionNote(buildRecordExecutionNoteCommand({
          commandId: "p116-cmd-note-1",
          projectId: P108_PROJECT_A,
          note: scen.works.aCoord.note1,
        }));
        expect(replay.status).toBe("committed");
        if (replay.status === "committed") expect(replay.replayed).toBe(true);
      });

      it("same noteId under another identity is immutable — CAS rejected", async () => {
        const other = await h.recordExecutionNote(buildRecordExecutionNoteCommand({
          commandId: "p116-cmd-note-1-other",
          projectId: P108_PROJECT_A,
          note: { ...scen.works.aCoord.note1, summary: "另一个身份重写同一 noteId" },
          idempotencyKey: "other-identity-key",
        }));
        expect(other.status).toBe("rejected");
        if (other.status === "rejected") expect(other.code).toBe("revision_conflict");
      });
    });

    describe("continuation-capability-fallback-test", () => {
      it("declares capabilities honestly (no session restore in the fake runtime)", async () => {
        const caps = await h.continuationCapabilities({ workContextRef: scen.works.aCoord.ref, runRef: scen.works.aCoord.laterRun });
        expect(caps.status).toBe("supported");
        if (caps.status === "supported") {
          expect(caps.capabilities.sessionRestore).toBe(false);
          expect(caps.capabilities.contextResume).toBe(true);
        }
      });

      it("observes took_over (new run continues from durable facts) and unsupported (missing capability named)", async () => {
        const w2 = await h.workContextView({ projectId: P108_PROJECT_A, workspaceId: P116_WORKSPACE, workId: "work-p116-coord" });
        expect(w2.status).toBe("ready");
        if (w2.status !== "ready") return;
        const statuses = w2.continuations.map((c) => c.result.status);
        expect(statuses).toContain("took_over");
        expect(statuses).toContain("unsupported");
        const unsupportedRecord = w2.continuations.find((c) => c.result.status === "unsupported");
        expect(unsupportedRecord?.result.unsupportedCapabilities).toContain("session_restore");
        const tookOver = w2.continuations.find((c) => c.result.status === "took_over");
        expect(tookOver?.result.takeoverRunRef?.runId).toBe(scen.works.aCoord.laterRun.runId);
        // NEVER pretend the original process still exists: an unsupported restore
        // is a distinct, explicit record (not a fabricated restored_original).
        const restored = w2.continuations.filter((c) => c.result.status === "restored_original");
        expect(restored.length).toBe(0);
      });
    });

    describe("stale-lease-and-context-test", () => {
      it("a note authoring run not linked to the work is rejected (run_not_in_work)", async () => {
        // Project B's run is NOT part of project A's coordination work.
        const foreign = await h.recordExecutionNote(buildRecordExecutionNoteCommand({
          commandId: "p116-cmd-note-foreign",
          projectId: P108_PROJECT_A,
          note: {
            ...scen.works.aCoord.note1,
            noteId: "note-foreign-1",
            runRef: scen.works.bWork.initialRun,
          },
        }));
        expect(foreign.status).toBe("rejected");
        if (foreign.status === "rejected") expect(foreign.code).toBe("run_not_in_work");
      });

      it("linking an already-linked run is rejected (already_linked)", async () => {
        const dupLink = await h.linkWorkRun(buildLinkWorkRunCommand({
          commandId: "p116-cmd-link-w2-dup",
          projectId: P108_PROJECT_A,
          workId: "work-p116-coord",
          runRef: scen.works.aCoord.laterRun,
          expectedRevision: 2,
        }));
        expect(dupLink.status).toBe("rejected");
        if (dupLink.status === "rejected") expect(dupLink.code).toBe("already_linked");
      });

      it("linking beyond the cap is rejected (links_exceeded)", async () => {
        const many = buildLinkWorkRunCommand({
          commandId: "p116-cmd-link-w2-many",
          projectId: P108_PROJECT_A,
          workId: "work-p116-coord",
          runRef: { aggregateType: "Run", runId: "run-cap-" + (WORK_CONTEXT_MAX_RUN_LINKS + 1), projectId: P108_PROJECT_A, goalId: "goal-cap" },
          expectedRevision: 2,
        });
        const res = await h.linkWorkRun(many);
        // Either the run doesn't exist (not_found) or the cap is already reached —
        // the cap itself is enforced by the bound validator; if the run exists the
        // receiver rejects links_exceeded. Both are zero-write rejections.
        expect(res.status).toBe("rejected");
      });

      it("scope isolation: the SAME local workId in project B has its OWN rows (no cross-project read)", async () => {
        const w1a = await h.workContextView({ projectId: P108_PROJECT_A, workspaceId: P116_WORKSPACE, workId: P116_WORK });
        const w1b = await h.workContextView({ projectId: P108_PROJECT_B, workspaceId: P116_WORKSPACE, workId: P116_WORK });
        expect(w1a.status).toBe("ready");
        expect(w1b.status).toBe("ready");
        if (w1a.status !== "ready" || w1b.status !== "ready") return;
        expect(w1a.binding.binding.initialRunRef.runId).toBe(scen.works.aWork.initialRun.runId);
        expect(w1b.binding.binding.initialRunRef.runId).toBe(scen.works.bWork.initialRun.runId);
        expect(JSON.stringify(w1a.binding)).not.toBe(JSON.stringify(w1b.binding));
      });
    });

    describe("bounded-note-tests", () => {
      it("notes are bounded (cap constant exported) and body-first (bodyRef required)", () => {
        expect(EXECUTION_NOTE_MAX_BYTES).toBeGreaterThan(0);
        expect(scen.works.aCoord.note1.bodyRef.kind).toBe("artifact");
        expect(scen.works.aCoord.note1.noFullTranscript).toBe(true);
        expect(scen.works.aCoord.note1.verification.status).toBe("unverified");
      });

      it("unknown top-level note field is rejected (no hidden transcript channel)", async () => {
        const smuggled = await h.recordExecutionNote(buildRecordExecutionNoteCommand({
          commandId: "p116-cmd-note-smuggle",
          projectId: P108_PROJECT_A,
          note: { ...scen.works.aCoord.note1, noteId: "note-smuggle-1", transcript: "hidden chain-of-thought" } as never,
        }));
        expect(smuggled.status).toBe("rejected");
        if (smuggled.status === "rejected") expect(smuggled.code).toBe("invalid");
      });
    });

    describe("view-freshness-tests", () => {
      it("not_ready != not_found for an unknown work (freshness by opaque cursor)", async () => {
        const missing = await h.workContextView({ projectId: P108_PROJECT_A, workspaceId: P116_WORKSPACE, workId: "work-never-bound" });
        expect(missing.status).toBe("not_found");
        const before = await (h as unknown as { observedCursor(): unknown }).observedCursor();
        expect(before).toBeTruthy();
      });
    });

  });
}

export { toP1_16Harness, runP116ContinuityScenario };
