/** R-notify-supply: a request round's supply offers the queued notify and not the late reply. */
import { describe, expect, it } from 'vitest';
import type { SessionMessage } from '../../src/core/work-graph/model/communication-contracts.js';
import { graphWrite } from '../helpers/AG2b-collaboration-fixture.js';
import { S6A_SCOPE } from '../helpers/S6A-request-fixture.js';
import { committed } from '../helpers/S7A-fixture.js';
import { notifyDeliveryText } from '../helpers/S7B-delivery-samples.js';
import { requestUserText } from '../helpers/S7B2-secretary-rounds.js';
import { notifyOnlyS7B2Supply, openS7B2RoundWorld, runS7B2Round } from '../helpers/S7B2-secretary-rounds.js';

/** The frozen platform pack's sender string for a Host system sender (`delivery.sender.platform`). */
const PLATFORM_SENDER = '平台';

describe('S7B-2 R notify-only supply', () => {
  it('offers the queued notify and not the late reply in a request round\'s supply', async () => {
    const { world } = await openS7B2RoundWorld({ backend: 'memory', extraHostOptions: { requestDriver: 'off' } });
    const label = 'r-notify';
    const sent = await runS7B2Round(world, { label });
    // The person's notify is a public send; it stays on the person list and the
    // notify-only supply skips that list, so it is never offered to the round.
    committed<SessionMessage>(await world.post('messages/send', graphWrite(S6A_SCOPE, {
      recipient: sent.round.secretary.ref, text: `S7B2 person notify ${label}`, intent: 'notify',
    }, `s7b2-person-notify-${label}`)), 'the person notify');
    const supply = await notifyOnlyS7B2Supply(world, { sent, label });
    const input = requestUserText(supply.requests.at(-1)!);

    expect(input.split(notifyDeliveryText({ messageId: supply.notify.ref.messageId,
      sender: PLATFORM_SENDER, body: `S7B2 notify ${label}` }))).toHaveLength(2);
    expect(input).not.toContain(`S7B ${label}-late reply`);
    expect(input).not.toContain(`S7B2 person notify ${label}`);
  }, 180_000);
});
