import type { PromptTextsV1 } from "./prompt-set.js";

/** One fixed string of the resolved pack; a missing key is a pack bug, never a fallback. */
export function packString(texts: PromptTextsV1, key: string): string {
  const value = texts.strings[key];
  if (value === undefined) throw new Error(`the resolved prompt pack has no string "${key}"`);
  return value;
}
