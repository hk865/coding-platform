/** Only an explicit unfinished-lane sentinel may turn a restart suite into SKIP. */
export function isUnimplementedRestartCapability(error: unknown): boolean {
  return error instanceof Error && /^P1-\d+(?: lane)?[^\r\n]*not implemented yet$/i.test(error.message.trim());
}

export function classifyRestartProbeError(error: unknown): false {
  if (isUnimplementedRestartCapability(error)) return false;
  throw error;
}
