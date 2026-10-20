/**
 * K3-48 (三) / K3-35 (一) near-B capacity INPUT (pure): the 32 codec-legal
 * `process` items, the 200 x 512-byte changed-path capture body/ref and the
 * 32-entry `notVisible` list that put the owner record at the literal creation
 * budget B = 158,720 bytes (L7 M3).
 *
 * This is the padded builder that used to live in the deleted large-review
 * input helper. It is constructed input for a PURE / OWNER CODEC
 * capacity test, never a reachable scenario state: one Run can hold at most one
 * process call that needs review, so the 32-item extreme cannot be reached by a
 * real Run. K3-48 (三) feeds it to the real RUN-22 owner and measures the
 * committed record size; K3-35 (一)'s reachable owner row uses the one real item
 * the Kernel produces.
 *
 * The arithmetic at B is the spec's:
 *   skeleton (callIds, kernel refs, digests, capture ref/sample)  48,183
 *   32 summaries x 512 three-byte characters                     49,152
 *   notVisible 31 x 512 plus 4,589 characters x 3, plus 2         61,385
 *   total                                                       158,720
 */
import { Buffer } from 'node:buffer';
import type { ArtifactRef } from '../../src/contracts/artifact.js';
import { artifactBodyDigest } from '../../src/contracts/artifact.js';
import { sha256Hex } from '../../src/contracts/fingerprint.js';
import type {
  CapturedPathV1, UnknownCallReviewItemV1, WorkspaceCaptureV1,
} from '../../src/contracts/unknown-call-review.js';

const K3_PADDED_ITEM_COUNT = 32;
/** One changed path of exactly 512 ASCII bytes. */
const K3_PADDED_PATH_BYTES = 512;
/** 512 three-byte characters, i.e. 1,536 UTF-8 bytes, in every command summary. */
const K3_PADDED_COMMAND_CHARS = 512;
/** The L7 `notVisible` cap used by the padded record. */
const K3_PADDED_NOT_VISIBLE_COUNT = 32;
/** The first 31 `notVisible` entries' three-byte character count. */
const K3_PADDED_NOT_VISIBLE_CHARS = 512;
/** The last entry: 4,589 three-byte characters plus two ASCII bytes. */
const K3_PADDED_LAST_NOT_VISIBLE_CHARS = 4_589;
const K3_PADDED_LAST_NOT_VISIBLE_SUFFIX = 'vv';
/** The clock the capacity record was frozen with (any 24-byte ISO instant keeps the size). */
export const K3_PADDED_AT = '2026-10-16T00:00:00.000Z';

const KERNEL = {
  adapterId: 'k335-large-adapter', kernelSessionId: 'k335-large-kernel-session',
  kernelRunId: 'k335-large-kernel-run', turnId: 'k335-large-turn',
} as const;
const CAPTURE_CONTENT_TYPE = 'application/vnd.platform.workspace-change-capture+json';
const CAPTURE_REF_ID = 'k335-large-capture';

/** The padded variant's callIds: legal but short, so the budget is spent on summaries. */
export function k3PaddedCallIds(): string[] {
  return Array.from({ length: K3_PADDED_ITEM_COUNT },
    (_, index) => `k3-48-call-${String(index + 1).padStart(2, '0')}`);
}

/** One changed path of exactly 512 ASCII bytes. */
function k3PaddedPath(index: number): CapturedPathV1 {
  return { path: `k335-path-${String(index).padStart(3, '0')}-`.padEnd(K3_PADDED_PATH_BYTES, 'f'), change: 'modified' };
}

/** The full capture list: 200 changed paths of 512 ASCII bytes each. */
function k3PaddedFullChanges(): CapturedPathV1[] {
  return Array.from({ length: 200 }, (_, index) => k3PaddedPath(index));
}

/** The full capture body the production reader parses (`{ changed: [...] }`). */
function k3PaddedCaptureBody(): string {
  return JSON.stringify({ schemaVersion: 1, changed: k3PaddedFullChanges() });
}

/** The capture ArtifactRef the record's workspace points at. */
function k3PaddedCaptureRef(): ArtifactRef {
  const body = k3PaddedCaptureBody();
  return {
    kind: 'artifact', contentType: CAPTURE_CONTENT_TYPE, digest: artifactBodyDigest(body),
    sizeBytes: Buffer.byteLength(body, 'utf8'), source: { kind: 'artifact', refId: CAPTURE_REF_ID, revision: '1' },
  };
}

/** The 32 `notVisible` entries: 31 x 512 plus the 4,589-character last one + 2 ASCII bytes. */
function k3PaddedNotVisible(): string[] {
  return Array.from({ length: K3_PADDED_NOT_VISIBLE_COUNT }, (_, index) =>
    index === K3_PADDED_NOT_VISIBLE_COUNT - 1
      ? '视'.repeat(K3_PADDED_LAST_NOT_VISIBLE_CHARS) + K3_PADDED_LAST_NOT_VISIBLE_SUFFIX
      : '视'.repeat(K3_PADDED_NOT_VISIBLE_CHARS));
}

/** The 32 codec-legal `process` items, aliases 1..32, 512-character summaries. */
export function k3PaddedItems(
  callIds: readonly string[] = k3PaddedCallIds(),
): UnknownCallReviewItemV1[] {
  return callIds.map((callId, index) => {
    const alias = index + 1;
    return {
      alias, callId, toolName: 'shell', kind: 'process', contained: false,
      kernel: { ...KERNEL, callId, declaredPosition: 2, startedPosition: 3 },
      argumentsDigest: sha256Hex(`k335-large-arguments-${String(alias)}`),
      summary: { command: '核'.repeat(K3_PADDED_COMMAND_CHARS), cwd: '/w', mode: null, paths: [],
        pathsOmitted: 0, truncated: true },
      startedAt: K3_PADDED_AT,
      observed: { verdict: 'pending', by: null },
    };
  });
}

/** The captured workspace the record carries: 200 changed paths, 32 `notVisible`. */
export function k3PaddedWorkspace(): WorkspaceCaptureV1 {
  const full = k3PaddedFullChanges();
  return {
    status: 'captured', runBaselineKnown: true, baseCommit: 'k335-base', headNow: 'k335-head',
    captureRef: k3PaddedCaptureRef(), changedCount: full.length, sample: full.slice(0, 50),
    notVisible: k3PaddedNotVisible(), notVisibleOmitted: 0,
  };
}
