import type { RawArtifactPut, RawArtifactRecord } from './body-ports.js';

/** Shared old/new row codec boundary. Legacy provenance may be decoded, never newly written. */
export function decodeArtifactBodyRow(_json: string): RawArtifactRecord {
  throw new Error('R3b body codec is not implemented');
}
export function encodeArtifactBodyRow(_input: RawArtifactPut): string {
  throw new Error('R3b body codec is not implemented');
}
