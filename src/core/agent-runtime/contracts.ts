/** Exact capability vocabulary from the selected AgentRuntime design. A
 * reported `supported` value is never fabricated by this N0 skeleton. */
export type RuntimeCapability = { supported: boolean; reason: string };
export type RuntimeCapabilities = {
  adapterId: string; kernelSessionApiVersion: 1 | 2;
  createSession: RuntimeCapability; readHistory: RuntimeCapability;
  continueHistory: RuntimeCapability; recoverRun: RuntimeCapability;
  safePointPause: RuntimeCapability; cancel: RuntimeCapability;
  nativeCompact: RuntimeCapability; scopedWorkspaceWrites: RuntimeCapability;
};
