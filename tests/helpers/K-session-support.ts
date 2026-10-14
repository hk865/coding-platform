/**
 * Group K (KE1) support: build real Kernel sessions only through the public
 * `SqliteStores.create/append/get/read` surface, and read them back through the
 * same public surface. It never touches sqlite directly and never imports a
 * private Kernel path.
 *
 * The fixture keeps its own reduced RunState so it can emit the next valid event
 * sequence; the assertions stay in the test files.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  agentEventSchema,
  createInitialRunState,
  reduceRunState,
  SqliteStores,
  type AgentEvent,
  type RunState,
  type SessionRecord,
  type SessionRecordDraft,
} from "../../vendor/coding-agent/dist/public-api.js";

export const K_AT = "2026-10-14T00:00:00.000Z";
export const K_AT_LATER = "2026-10-14T00:01:00.000Z";

export const K_CONFIG = {
  modelConfigId: "k-fixture:model",
  limits: {
    maxModelRequests: null,
    maxToolCalls: null,
    maxInputTokens: null,
    maxOutputTokens: null,
    maxTotalTokens: null,
    maxCostUsdMicros: null,
    deadlineMs: null,
  },
  enabledToolSchemaDigest: "a".repeat(64),
  policyVersion: "policy-v1",
  sandboxProfileVersion: "sandbox-v1",
  baseConfigDigest: "b".repeat(64),
};

export const K_WORKSPACE = {
  identity: "k-workspace-fixture",
  revision: "rev-1",
  reference: "workspace:current",
};

export const K_SIGNAL = new AbortController().signal;

export interface TempKernelStore {
  readonly root: string;
  readonly databasePath: string;
  readonly store: SqliteStores;
  cleanup(): Promise<void>;
}

export async function openTempKernelStore(
  prefix = "k-kernel-",
): Promise<TempKernelStore> {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  const databasePath = path.join(root, "session.sqlite");
  const store = await SqliteStores.open(databasePath);
  return {
    root,
    databasePath,
    store,
    cleanup: async () => {
      await store.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

export async function readAllRecords(
  store: SqliteStores,
  sessionId: string,
): Promise<SessionRecord[]> {
  const records: SessionRecord[] = [];
  let position = 0;
  for (;;) {
    const page = await store.read(sessionId, position, 256, { signal: K_SIGNAL });
    records.push(...page.records);
    position = page.records.at(-1)?.position ?? position;
    if (page.nextPosition === null) return records;
  }
}

export interface TurnSpec {
  readonly runId: string;
  readonly turnId: string;
  readonly input: string;
}

/**
 * Append-only session writer. `state` is the reducer's own view used only to
 * choose the next valid event identity; it is never used to compute an
 * expected assertion value.
 */
export class KernelSessionFixture {
  #revision: number;
  #state: RunState | null = null;
  #eventTick = 0;

  private constructor(
    readonly store: SqliteStores,
    readonly sessionId: string,
    revision: number,
  ) {
    this.#revision = revision;
  }

  static async create(
    store: SqliteStores,
    sessionId: string,
  ): Promise<KernelSessionFixture> {
    await store.create(
      { sessionId, recordId: `session:${sessionId}`, createdAt: K_AT },
      { signal: K_SIGNAL },
    );
    const header = await store.get(sessionId, { signal: K_SIGNAL });
    return new KernelSessionFixture(store, sessionId, header.revision);
  }

  get revision(): number {
    return this.#revision;
  }

  get state(): RunState {
    if (!this.#state) throw new Error("KernelSessionFixture: startTurn first");
    return this.#state;
  }

  async startTurn(spec: TurnSpec): Promise<void> {
    const run = {
      schemaVersion: 1 as const,
      runId: spec.runId,
      turn: {
        turnId: spec.turnId,
        userMessage: {
          schemaVersion: 1 as const,
          messageId: `msg-${spec.turnId}-user`,
          role: "user" as const,
          content: spec.input,
        },
      },
      createdAt: K_AT,
    };
    const result = await this.store.append(
      this.sessionId,
      this.#revision,
      [
        {
          recordId: `turn:${spec.turnId}`,
          recordType: "turn.started",
          schemaVersion: 1,
          recordedAt: K_AT,
          payload: { run, config: K_CONFIG, workspace: K_WORKSPACE },
        },
      ],
      { signal: K_SIGNAL },
    );
    this.#revision = result.revision;
    this.#state = createInitialRunState(run);
    this.#eventTick = 0;
  }

  async event(type: AgentEvent["type"], payload: unknown): Promise<void> {
    const state = this.state;
    this.#eventTick += 1;
    const event = agentEventSchema.parse({
      type,
      meta: {
        schemaVersion: 1,
        eventId: `evt-${state.turn.turnId}-${String(this.#eventTick)}`,
        runId: state.runId,
        turnId: state.turn.turnId,
        sequence: state.lastEventSequence + 1,
        occurredAt: K_AT,
        elapsedMs: this.#eventTick * 10,
      },
      payload,
    });
    this.#state = reduceRunState(state, event);
    const draft: SessionRecordDraft = {
      recordId: `agent-event:${event.meta.eventId}`,
      recordType: "agent.event",
      schemaVersion: 1,
      recordedAt: K_AT,
      payload: { event },
    };
    const result = await this.store.append(
      this.sessionId,
      this.#revision,
      [draft],
      { signal: K_SIGNAL },
    );
    this.#revision = result.revision;
  }
}
