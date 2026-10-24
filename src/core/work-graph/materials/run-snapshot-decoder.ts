/**
 * `decodeRun` and `Decoded` now live in `persistence/run-record-codecs.ts`.
 * This module exit stays because the Session directory, the mailbox and the
 * Task readers import them from here.
 */
export { decodeRun, type Decoded } from '../persistence/run-record-codecs.js';
