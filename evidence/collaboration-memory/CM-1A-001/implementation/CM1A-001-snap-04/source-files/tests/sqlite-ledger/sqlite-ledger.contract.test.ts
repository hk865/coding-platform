
import { describe, expect, it } from "vitest";
import { defineStateLedgerContractSuite } from "../contract-suite/state-ledger.contract.suite.js";
import { SqliteStateLedger } from "../../src/data/state-ledger/sqlite-ledger.js";
import type { StateLedger } from "../../src/contracts/ledger.js";

/**
 * Lane A: wire the shared StateLedger contract suite to the real SQLite
 * ledger. create uses a fresh :memory: connection per test (each instance is
 * its own empty ledger). createWithFault arms a beforeWrite crash that
 * simulates a commit crash after all validation/idempotency/CAS passes but
 * before any SQL write — the adapter must ROLLBACK the whole transaction and
 * reject.
 */
defineStateLedgerContractSuite({
  create: async (): Promise<StateLedger> => new SqliteStateLedger({ path: ":memory:" }),
  createWithFault: async () => {
    let armed = false;
    const ledger = new SqliteStateLedger({
      path: ":memory:",
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
