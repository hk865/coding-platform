/**
 * RL-21: the pure default of the Host resource-cap settings
 * (spec §5.2 RL-21, §0.3 L13; decisions 53, 55).
 *
 * Builds: literal byte counts only — never `os.totalmem()`; the expected MiB
 * values are hand-computed from the L13 formula and frozen in the row.
 * Rows: RL-21 (one case per machine size).
 * Entry: `src/contracts/resource-caps.ts` (RE0 pure function).
 */
import { describe, expect, it } from "vitest";
import { defaultResourceCapSettings } from "../../src/contracts/resource-caps.js";

const MIB = 1_048_576;

describe("RL-21 defaultResourceCapSettings", () => {
  it.each<[string, number, number]>([
    ["1,000,000,000 bytes", 1_000_000_000, 476],
    ["2 GiB", 2 * 1024 * MIB, 1024],
    ["6 GiB", 6 * 1024 * MIB, 3072],
    ["7,999,999,999 bytes", 7_999_999_999, 3814],
    ["8 GiB", 8 * 1024 * MIB, 4096],
    ["12 GiB", 12 * 1024 * MIB, 6144],
    ["15,841 MiB (this WSL host)", 15_841 * MIB, 6144],
    ["64 GiB", 64 * 1024 * MIB, 6144],
  ])("RL-21 %s → memoryMaxMiB %i, tasksMax 512", (_label, totalMemoryBytes, expectedMiB) => {
    expect(defaultResourceCapSettings(totalMemoryBytes)).toEqual({ memoryMaxMiB: expectedMiB, tasksMax: 512 });
  });
});
