import { describe, expect, it } from "vitest";
import {
  compareCommitCursor,
  makeCommitCursor,
  seqOfCommitCursor,
} from "../../src/contracts/ledger.js";

describe("CommitCursor order semantics", () => {
  it("is numeric, NOT lexicographic", () => {
    const c9 = makeCommitCursor(9);
    const c10 = makeCommitCursor(10);
    expect(compareCommitCursor(c9, c10)).toBe(-1);
    expect(compareCommitCursor(c10, c9)).toBe(1);
    // note: zero-padded encoding would also sort lexicographically; that is an
  // implementation detail — consumers must still use compareCommitCursor.
  });

  it("round-trips sequence and rejects invalid cursors", () => {
    expect(seqOfCommitCursor(makeCommitCursor(42))).toBe(42);
    expect(() => makeCommitCursor(0)).toThrow();
    expect(() => seqOfCommitCursor("nope" as never)).toThrow();
  });

  it("is monotonic", () => {
    const seqs = [1, 2, 3, 9, 10, 100].map(makeCommitCursor);
    for (let i = 1; i < seqs.length; i += 1) {
      expect(compareCommitCursor(seqs[i - 1]!, seqs[i]!)).toBe(-1);
    }
  });
});