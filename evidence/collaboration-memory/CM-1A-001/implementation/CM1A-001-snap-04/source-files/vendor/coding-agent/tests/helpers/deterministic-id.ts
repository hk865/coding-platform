export interface IdGenerator {
  next(): string;
}

export function createDeterministicIdGenerator(prefix = "test-id"): IdGenerator {
  let sequence = 0;

  return {
    next: () => `${prefix}-${String(sequence++).padStart(4, "0")}`,
  };
}
