/**
 * K3-06 (spec line 1413, ruling 1) test seam: a switchable blocking stand-in for
 * the builtin `edit` tool.
 *
 * Ruling 1 (`.dsh-ref/k3-g3-impl-4.md` ruling 1): a tool's effect class is never
 * changed to make calls run in parallel. The real `edit` is
 * `effectClass: 'workspace_write'`, `requiredCapabilities:
 * ['workspace_read','workspace_write']` and `independentReadOnly: false`
 * (`vendor/coding-agent/dist/tools/builtin/edit/edit-tool.js`), so a single-call
 * batch runs serially and the one call reaches `running` while the handler
 * blocks. This stand-in keeps the real name and the whole real class (never
 * `read_only` + independent) and only blocks inside its handler, exactly like
 * `tests/helpers/K3-tool-seams.ts`'s `shellSeam`. The `send_session_message`
 * blocker is `tests/helpers/K3-mailbox-seam.ts`; `shell` uses `shellSeam`.
 *
 * `vi.mock` is hoisted per test file, so the test file owns the module mock and
 * this module only owns the state and the swapped definition.
 */
import { toolSchema as z, type ToolCall, type ToolDefinition, type ToolResult } from '../../vendor/coding-agent/dist/public-api.js';

export type MixedSeamCall = { callId: string; arguments: unknown };

export class MixedSeam {
  /** When armed, the next `edit` handler blocks until `release()`. */
  private armed = false;
  private gate: Promise<void> = Promise.resolve();
  private openGate: (() => void) | null = null;
  private waiters: Array<() => void> = [];
  readonly calls: MixedSeamCall[] = [];

  get enabled(): boolean { return this.armed; }

  arm(): void {
    this.armed = true;
    this.calls.length = 0;
    this.gate = new Promise<void>((resolve) => { this.openGate = resolve; });
  }

  release(): void {
    this.armed = false;
    this.openGate?.();
    this.openGate = null;
  }

  /** Resolves once at least one `edit` call has entered the stand-in handler. */
  async waitForCall(): Promise<void> {
    if (this.calls.length > 0) return;
    await new Promise<void>((resolve) => { this.waiters.push(resolve); });
  }

  private async block(): Promise<void> { if (this.armed) await this.gate; }

  private stub(): ToolDefinition {
    return {
      name: 'edit',
      description: 'K3 stand-in edit (blocks until released)',
      inputSchema: z.object({ mode: z.string(), path: z.string() }).loose(),
      // The REAL edit class and capabilities (`edit-tool.js`), never read_only.
      effectClass: 'workspace_write',
      requiredCapabilities: ['workspace_read', 'workspace_write'],
      independentReadOnly: false,
      defaultTimeoutMs: 15_000,
      outputLimitBytes: 32 * 1024,
      summarize: () => ({ paths: [], cwd: null, commandPreview: 'K3 edit' }),
      handler: {
        execute: async (call: Readonly<ToolCall>): Promise<ToolResult> => {
          this.calls.push({ callId: call.callId, arguments: call.arguments });
          for (const waiter of this.waiters.splice(0)) waiter();
          await this.block();
          return { schemaVersion: 1, callId: call.callId, status: 'success', output: [],
            effects: { sideEffect: 'none', changedPaths: [], workspaceRevision: null, artifactRefs: [] } };
        },
      },
    } as ToolDefinition;
  }

  /** The mocked `createEditToolDefinition`: armed -> the stand-in, otherwise the real factory. */
  definition(actual: (workspace: never) => ToolDefinition, workspace: never): ToolDefinition {
    return this.armed ? this.stub() : actual(workspace);
  }
}

/** `edit` — the Kernel name of the authorized `write` (L3 file_edit). */
export const mixedEditSeam = new MixedSeam();

/** Release the edit stand-in and clear its armed state (call from `afterEach`). */
export function releaseMixedSeams(): void {
  mixedEditSeam.release();
}
