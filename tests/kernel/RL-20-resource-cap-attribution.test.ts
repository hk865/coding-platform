/**
 * RL-20: attribution and counter rules of the resource-cap observation
 * (spec §5.2 RL-20, §0.3 L7/L9).
 *
 * Builds: hand-written counter inputs only — no process, no cgroup, no file
 * system. Every expected value is a literal from the spec row.
 * Rows: RL-20 cases (1)–(16).
 * Entry: the built Kernel module `dist/sandbox/process/process-sandbox.js` (RE0).
 */
import { describe, expect, it } from "vitest";
import {
  attributeResourceCapEvents,
  mergeResourceCapCounters,
  parseResourceCapCounters,
  type ResourceCapCounters,
} from "../../vendor/coding-agent/dist/sandbox/process/process-sandbox.js";

/** A full counter object; omitted fields are 0. */
function counters(overrides: {
  readonly max?: number;
  readonly oom?: number;
  readonly oomKill?: number;
  readonly oomGroupKill?: number;
  readonly pidsMax?: number;
} = {}): ResourceCapCounters {
  return {
    memory: {
      max: overrides.max ?? 0,
      oom: overrides.oom ?? 0,
      oomKill: overrides.oomKill ?? 0,
      oomGroupKill: overrides.oomGroupKill ?? 0,
    },
    pids: { max: overrides.pidsMax ?? 0 },
  };
}

const ZERO = counters();

describe("RL-20 attributeResourceCapEvents", () => {
  it("RL-20 (1) a memory.max hit with Δoom > 0 attributes cap_hit", () => {
    expect(attributeResourceCapEvents({
      baseline: ZERO,
      maxSeen: counters({ max: 3, oom: 1, oomKill: 1 }),
      observationComplete: true,
    })).toEqual({ memory: "cap_hit", processes: "none_observed" });
  });

  it("RL-20 (2) an OOM invocation that killed nothing (Δoom 1, Δoom_kill 0) is still cap_hit", () => {
    expect(attributeResourceCapEvents({
      baseline: ZERO,
      maxSeen: counters({ oom: 1, oomKill: 0 }),
      observationComplete: true,
    })).toEqual({ memory: "cap_hit", processes: "none_observed" });
  });

  it("RL-20 (3) pressure plus a kill with Δoom 0 is uncertain, not cap_hit", () => {
    expect(attributeResourceCapEvents({
      baseline: ZERO,
      maxSeen: counters({ max: 1, oom: 0, oomKill: 1 }),
      observationComplete: true,
    })).toEqual({ memory: "uncertain", processes: "none_observed" });
  });

  it("RL-20 (4) an oom_group_kill with Δoom 0 is uncertain", () => {
    expect(attributeResourceCapEvents({
      baseline: ZERO,
      maxSeen: counters({ oom: 0, oomGroupKill: 1 }),
      observationComplete: true,
    })).toEqual({ memory: "uncertain", processes: "none_observed" });
  });

  it("RL-20 (5) memory.max alone is pressure only: none_observed", () => {
    expect(attributeResourceCapEvents({
      baseline: ZERO,
      maxSeen: counters({ max: 5 }),
      observationComplete: true,
    })).toEqual({ memory: "none_observed", processes: "none_observed" });
  });

  it("RL-20 (6) all-zero counters with a complete read observe nothing", () => {
    expect(attributeResourceCapEvents({ baseline: ZERO, maxSeen: ZERO, observationComplete: true }))
      .toEqual({ memory: "none_observed", processes: "none_observed" });
  });

  it("RL-20 (7) an incomplete read with no events says uncertain/unknown", () => {
    expect(attributeResourceCapEvents({ baseline: ZERO, maxSeen: ZERO, observationComplete: false }))
      .toEqual({ memory: "uncertain", processes: "unknown" });
  });

  it("RL-20 (8) a seen Δoom survives an incomplete read; processes stays unknown", () => {
    expect(attributeResourceCapEvents({
      baseline: ZERO,
      maxSeen: counters({ oom: 1 }),
      observationComplete: false,
    })).toEqual({ memory: "cap_hit", processes: "unknown" });
  });

  it("RL-20 (9) a seen pids.max survives an incomplete read; memory stays uncertain", () => {
    expect(attributeResourceCapEvents({
      baseline: ZERO,
      maxSeen: counters({ pidsMax: 2 }),
      observationComplete: false,
    })).toEqual({ memory: "uncertain", processes: "cap_hit" });
  });

  it("RL-20 (10) a seen pids.max with a complete read is cap_hit/none_observed", () => {
    expect(attributeResourceCapEvents({
      baseline: ZERO,
      maxSeen: counters({ pidsMax: 2 }),
      observationComplete: true,
    })).toEqual({ memory: "none_observed", processes: "cap_hit" });
  });

  it("RL-20 (11) a non-zero baseline that did not move observes nothing (absolute values would misjudge)", () => {
    const baseline = counters({ max: 7, oom: 2, oomKill: 2, pidsMax: 3 });
    const maxSeen = counters({ max: 7, oom: 2, oomKill: 2, pidsMax: 3 });
    expect(attributeResourceCapEvents({ baseline, maxSeen, observationComplete: true }))
      .toEqual({ memory: "none_observed", processes: "none_observed" });
  });

  it("RL-20 (12) a non-zero baseline that moved attributes the delta", () => {
    const baseline = counters({ max: 7, oom: 2, oomKill: 2, pidsMax: 3 });
    const maxSeen = counters({ max: 9, oom: 3, oomKill: 3, pidsMax: 3 });
    expect(attributeResourceCapEvents({ baseline, maxSeen, observationComplete: true }))
      .toEqual({ memory: "cap_hit", processes: "none_observed" });
  });

  it("RL-20 (13) Δoom 0 with Δoom_kill 1 against a non-zero baseline is uncertain", () => {
    const baseline = counters({ max: 7, oom: 2, oomKill: 2, pidsMax: 3 });
    const maxSeen = counters({ max: 7, oom: 2, oomKill: 3, pidsMax: 3 });
    expect(attributeResourceCapEvents({ baseline, maxSeen, observationComplete: true }))
      .toEqual({ memory: "uncertain", processes: "none_observed" });
  });

  it("RL-20 (14) a missing oom_group_kill line parses as 0 like an explicit 0", () => {
    const withoutGroup = ["max 1", "oom 0", "oom_kill 0", "low 0"].join("\n");
    const withGroup = ["max 1", "oom 0", "oom_kill 0", "oom_group_kill 0", "low 0"].join("\n");
    expect(parseResourceCapCounters(withoutGroup, "max 0\n"))
      .toEqual({ memory: { max: 1, oom: 0, oomKill: 0, oomGroupKill: 0 }, pids: { max: 0 } });
    expect(parseResourceCapCounters(withoutGroup, "max 0\n"))
      .toEqual(parseResourceCapCounters(withGroup, "max 0\n"));
  });

  it("RL-20 (15) a polling Δoom survives a final read that failed", () => {
    expect(attributeResourceCapEvents({
      baseline: ZERO,
      maxSeen: counters({ oom: 1 }),
      observationComplete: false,
    })).toEqual({ memory: "cap_hit", processes: "unknown" });
  });

  it("RL-20 (16) merging is monotonic and order independent", () => {
    const seen = counters({ oom: 2, pidsMax: 3 });
    const lateOld = counters({ oom: 1, pidsMax: 1 });
    expect(mergeResourceCapCounters(seen, lateOld)).toEqual({ memory: { max: 0, oom: 2, oomKill: 0, oomGroupKill: 0 }, pids: { max: 3 } });
    expect(mergeResourceCapCounters(lateOld, seen)).toEqual({ memory: { max: 0, oom: 2, oomKill: 0, oomGroupKill: 0 }, pids: { max: 3 } });
    // An empty (failed) read leaves every value unchanged.
    expect(mergeResourceCapCounters(seen, ZERO)).toEqual({ memory: { max: 0, oom: 2, oomKill: 0, oomGroupKill: 0 }, pids: { max: 3 } });
  });
});

describe("RL-20 parseResourceCapCounters", () => {
  it("RL-20 (14b) reads every memory field and defaults absent keys to 0", () => {
    const text = ["max 4", "oom 5", "oom_kill 6", "oom_group_kill 7"].join("\n");
    expect(parseResourceCapCounters(text, "max 9\n"))
      .toEqual({ memory: { max: 4, oom: 5, oomKill: 6, oomGroupKill: 7 }, pids: { max: 9 } });
  });
});
