/**
 * B2-11 / L19a / rework 9 F-037: `blockedCommandsBytes` as a PURE function.
 *
 * The measure serialises exactly `{ reviewRunId, actions, expansions,
 * truncated }` per entry. Every example below changes ONE field of the same
 * entry and asserts the exact hand-computed byte difference (never
 * `toBeGreaterThan`). Arithmetic for each number is in the comment beside it.
 */
import { describe, expect, it } from 'vitest';
import { blockedCommandsBytes } from '../../src/core/work-graph/tasks/unknown-call-review-service.js';
import type { UnknownCallBlockedCommandV1 } from '../../src/contracts/unknown-call-review.js';

function entry(): UnknownCallBlockedCommandV1 {
  return {
    reviewRunId: 'r1', alias: 1, commandSha256: 'c'.repeat(64),
    kernelCallRef: {
      adapterId: 'a', kernelSessionId: 'ks', kernelRunId: 'kr', turnId: 't', callId: 'c-1',
      declaredPosition: 1, startedPosition: 1,
    },
    actions: [], expansions: [], truncated: false,
  };
}

const action = { text: 'tool a', sha256: 'b'.repeat(64) };
const expansion = {
  action: 'npm run build', scriptName: 'build', scriptText: 'tsc -p app',
  actions: [{ text: 'tsc', sha256: 'a'.repeat(64) }],
  basis: { path: 'app/package.json', digest: 'b'.repeat(64) },
} satisfies UnknownCallBlockedCommandV1['expansions'][number];

describe('B2-11 pure: the blockedCommands measure counts every mapped field', () => {
  it('B2-11: the empty entry serialises the four mapped fields only', () => {
    // [{"reviewRunId":"r1","actions":[],"expansions":[],"truncated":false}] = 69 bytes.
    expect(blockedCommandsBytes([entry()])).toBe(69);
  });

  it('B2-11: reviewRunId is measured: 2,000 characters instead of 2 adds 1,998 bytes', () => {
    const long = { ...entry(), reviewRunId: 'r'.repeat(2_000) };
    expect(blockedCommandsBytes([long]) - blockedCommandsBytes([entry()])).toBe(1998);
  });

  it('B2-11: truncated is measured: "false" is 5 bytes and "true" is 4', () => {
    const truncated = { ...entry(), truncated: true };
    expect(blockedCommandsBytes([truncated]) - blockedCommandsBytes([entry()])).toBe(-1);
  });

  it('B2-11: actions is measured: one action object is 93 bytes', () => {
    // {"text":"tool a","sha256":"<64 hex>"} = 1+7+8+1+9+66+1 = 93.
    const withAction = { ...entry(), actions: [action] };
    expect(blockedCommandsBytes([withAction]) - blockedCommandsBytes([entry()])).toBe(93);
  });

  it('B2-11: expansions is measured: one expansion object is 288 bytes', () => {
    // The object's keys/bodies: 1 + (9+15) + 1 + (13+7) + 1 + (13+12) + 1
    // + (10+92) + 1 + (8+103) + 1 = 288.
    const withExpansion = { ...entry(), expansions: [expansion] };
    expect(blockedCommandsBytes([withExpansion]) - blockedCommandsBytes([entry()])).toBe(288);
  });

  it('B2-11: an expansion basis is measured: the unavailable form is 33 bytes longer', () => {
    // {"path":"app/package.json","digest":"<64 hex>"} = 103 bytes;
    // {"status":"unavailable","reason":"<100 x>"} = 1+9+13+1+9+102+1 = 136; 136-103 = 33.
    const unavailable = {
      ...entry(),
      expansions: [{
        ...expansion,
        basis: { status: 'unavailable' as const, reason: 'x'.repeat(100) },
      }],
    };
    const onDisk = { ...entry(), expansions: [expansion] };
    expect(blockedCommandsBytes([unavailable]) - blockedCommandsBytes([onDisk])).toBe(33);
  });
});
