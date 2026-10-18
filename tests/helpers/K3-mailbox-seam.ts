/**
 * K3 group 2 part 3, K3-02 seam: a switchable blocking stand-in for the
 * `send_session_message` platform tool's handler (community-tools factory).
 *
 * The frozen Kernel's `RegistryToolBatchPolicy` runs non-read-only calls
 * serially and commits `tool.started` immediately before the handler runs
 * (`runtime-runner.js#executeTools`). Blocking inside the handler therefore
 * leaves the Kernel with the send declared and started, the message NOT
 * committed and the Kernel result NOT recorded — exactly K3-02's crash point.
 * The documented `lockLedgerAfter('ModelRequestEvidenceRecorded',
 * { kernelStore: true })` recipe locks the Kernel before the assistant message,
 * so the Kernel holds no unresolved call and the reconcile answers W-11.
 *
 * `vi.mock` is hoisted per test file, so the test file owns the module mock
 * (see tests/scenarios/K3-R1-restart-flows.test.ts) and this module only owns
 * the state and the handler wrapper.
 */
import type { ToolCall, ToolDefinition, ToolResult } from '../../vendor/coding-agent/dist/public-api.js';

export type MailboxSeamCall = { callId: string; arguments: unknown };

export class MailboxSeam {
  /** When armed, the next `send_session_message` handler blocks until `release()`. */
  private armed = false;
  private gate: Promise<void> = Promise.resolve();
  private openGate: (() => void) | null = null;
  private waiters: Array<() => void> = [];
  readonly calls: MailboxSeamCall[] = [];

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

  /** Resolves once at least one `send_session_message` call has entered the stand-in handler. */
  async waitForCall(): Promise<void> {
    if (this.calls.length > 0) return;
    await new Promise<void>((resolve) => { this.waiters.push(resolve); });
  }

  /** Run the real handler when disarmed; block before any mailbox write when armed. */
  async run(real: ToolDefinition['handler'], call: Readonly<ToolCall>,
    options: Parameters<ToolDefinition['handler']['execute']>[1]): Promise<ToolResult> {
    if (!this.armed) return real.execute(call, options);
    this.calls.push({ callId: call.callId, arguments: call.arguments });
    for (const waiter of this.waiters.splice(0)) waiter();
    await this.gate;
    return { schemaVersion: 1, callId: call.callId, status: 'success',
      output: [{ kind: 'text', text: 'K3 mailbox stand-in (the message was never committed)' }],
      effects: { sideEffect: 'none', changedPaths: [], workspaceRevision: null, artifactRefs: [] } };
  }
}

export const mailboxSeam = new MailboxSeam();
