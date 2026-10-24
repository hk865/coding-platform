/** `Error.message` verbatim, else `String(error)`; a throw inside that conversion is not swallowed. */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
