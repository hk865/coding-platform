/**
 * S8 L8 rework 1, item 3 (lead ruling on the reason's length): the
 * `ArchitectureAutoCapture@1` state constructors and the real record codec.
 *
 * - `newArchitectureCaptureFailureRecord` keeps the FIRST 2,000 characters of a
 *   failure reason, keeps the start record's `requestSeq`/`trigger`/
 *   `requestedAt`, increments `revision` and sets `status: 'failed'`; a
 *   2,000-character reason is kept unchanged.
 * - `newArchitectureCaptureRequestRecord` increments `requestSeq`/`revision`
 *   and clears the failure; the requested time is the input's, no clock.
 * - The exported codec pair accepts a 2,000-character reason and rejects a
 *   2,001-character one at the record boundary with a reason naming 2000.
 *
 * Pure: the real exported state constructors and codec functions, input ->
 * output only; no store, host or clock.
 */
import { describe, expect, it } from 'vitest';
import type { ArchitectureAutoCaptureRecordV1 } from '../../src/contracts/architecture-observation.js';
import {
  decodeArchitectureAutoCapture, encodeArchitectureAutoCapture,
} from '../../src/core/work-graph/architecture/architecture-record-codecs.js';
import {
  newArchitectureCaptureFailureRecord, newArchitectureCaptureRequestRecord,
} from '../../src/core/work-graph/state/architecture-capture.js';

const WORKSPACE = { projectId: 'project-1', workspaceId: 'workspace-1' };
const REQUESTED_AT = '2026-10-18T00:00:00.000Z';
const FAILURE_CODE = 'catalog_read_failed';

function requestedRecord(): ArchitectureAutoCaptureRecordV1 {
  return newArchitectureCaptureRequestRecord({
    current: null, workspace: WORKSPACE, trigger: 'workspace_registered', requestedAt: REQUESTED_AT,
  });
}

function failedRecord(reason: string): ArchitectureAutoCaptureRecordV1 {
  return newArchitectureCaptureFailureRecord({
    current: requestedRecord(), failure: { code: FAILURE_CODE, reason },
  });
}

describe('newArchitectureCaptureFailureRecord', () => {
  it('keeps the first 2000 characters of a 2500-character reason and the start record fields', () => {
    // Index 1999 is the last kept character, 2000 the first dropped one.
    const reason = 'x'.repeat(1999) + 'y' + 'z'.repeat(500);
    expect(reason).toHaveLength(2500);
    const start = requestedRecord();

    const failed = newArchitectureCaptureFailureRecord({
      current: start, failure: { code: FAILURE_CODE, reason },
    });

    expect(failed.failure).toEqual({ code: FAILURE_CODE, reason: reason.slice(0, 2000) });
    expect(failed.failure?.reason).toHaveLength(2000);
    expect(failed.failure?.reason.endsWith('y')).toBe(true);
    expect(failed.requestSeq).toBe(start.requestSeq);
    expect(failed.trigger).toBe(start.trigger);
    expect(failed.requestedAt).toBe(start.requestedAt);
    expect(failed.ref).toEqual(start.ref);
    expect(failed.workspace).toEqual(start.workspace);
    expect(failed.revision).toBe(start.revision + 1);
    expect(failed.status).toBe('failed');
    // Input only: the start snapshot is not rewritten into a failed record.
    expect(start.status).toBe('requested');
    expect(start.failure).toBeNull();
  });

  it('keeps a 2000-character reason unchanged', () => {
    const reason = 'x'.repeat(2000);

    const failed = failedRecord(reason);

    expect(failed.failure).toEqual({ code: FAILURE_CODE, reason });
    expect(failed.failure?.reason).toBe(reason);
  });
});

describe('newArchitectureCaptureRequestRecord', () => {
  it('increments requestSeq and revision and clears the failure, taking requestedAt from the input', () => {
    const failed = failedRecord('the catalog was unreadable');
    const nextRequestedAt = '2026-10-18T00:00:05.000Z';

    const next = newArchitectureCaptureRequestRecord({
      current: failed, workspace: WORKSPACE, trigger: 'check_passed', requestedAt: nextRequestedAt,
    });

    expect(next.requestSeq).toBe(failed.requestSeq + 1);
    expect(next.revision).toBe(failed.revision + 1);
    expect(next.failure).toBeNull();
    expect(next.status).toBe('requested');
    expect(next.trigger).toBe('check_passed');
    expect(next.requestedAt).toBe(nextRequestedAt);
    expect(next.ref).toEqual(failed.ref);
    expect(next.workspace).toEqual(failed.workspace);
    // The failed input stays a failed record.
    expect(failed.status).toBe('failed');
    expect(failed.failure?.reason).toBe('the catalog was unreadable');
  });
});

describe('ArchitectureAutoCapture codec failure-reason boundary', () => {
  it('decodes a failed record whose reason is 2000 characters', () => {
    const record = failedRecord('x'.repeat(2000));

    const decoded = decodeArchitectureAutoCapture(encodeArchitectureAutoCapture(record));

    expect(decoded.status).toBe('decoded');
    if (decoded.status !== 'decoded') return;
    expect(decoded.value).toEqual(record);
    expect(decoded.value.status).toBe('failed');
    expect(decoded.value.failure?.reason).toHaveLength(2000);
  });

  it('rejects a 2001-character reason at the codec boundary with a reason naming 2000', () => {
    // The state constructor truncates, so the boundary record is built directly:
    // it is input to the real codec pair, not a hand-written stored fact.
    const base = failedRecord('x'.repeat(2000));
    const tooLong: ArchitectureAutoCaptureRecordV1 = {
      ...base, failure: { code: FAILURE_CODE, reason: 'x'.repeat(2001) },
    };
    const encoded = encodeArchitectureAutoCapture(tooLong);

    const decoded = decodeArchitectureAutoCapture(encoded);

    expect(decoded.status).toBe('invalid');
    if (decoded.status !== 'invalid') return;
    expect(decoded.reason).toContain('2000');
  });
});
