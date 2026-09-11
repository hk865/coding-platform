import { describe, expect, it } from "vitest";
import { defineStateLedgerContractSuite } from "../contract-suite/state-ledger.contract.suite.js";
import { InMemoryLedger } from "../../src/data/state-ledger/in-memory-ledger.js";
import type { StateLedger } from "../../src/contracts/ledger.js";

/**
 * Lane A: wire the shared StateLedger contract suite to the real InMemory
 * ledger. The fault-injection factory arms a beforeWrite crash that simulates
 * a commit crash after all validation passes but before any state is written.
 */
defineStateLedgerContractSuite({
  create: async (): Promise<StateLedger> => new InMemoryLedger(),
  createWithFault: async () => {
    let armed = false;
    const ledger = new InMemoryLedger({
      beforeWrite: () => {
        if (armed) throw new Error("simulated crash before write");
      },
    });
    return {
      ledger,
      triggerFault: () => {
        armed = true;
      },
    };
  },
});
