# B1 static byte proof — encode forwarding and validate identity

## 1. `encode` only forwards to `encodeEventEnvelope(event)`

The shared encoder is untouched: `git diff s85-base -- src/core/work-graph/persistence/event-envelope.ts`
is empty (also empty for `event-validation.ts` and `record-codecs.ts`).

`event-envelope.ts:4-13` (unchanged):

```ts
export function encodeEventEnvelope<
  E extends { eventId: string; eventType: string; schemaVersion: number; occurredAt: string },
>(event: E): EncodedDomainEvent {
  return {
    eventId: event.eventId,
    eventType: event.eventType,
    schemaVersion: event.schemaVersion,
    occurredAt: event.occurredAt,
    json: JSON.stringify(event),
  };
}
```

Old named encoder (all three identical; e.g. base `decision-record-codecs.ts:56-58`):

```ts
export function encodeGoalSettingsChangedEvent(event: GoalSettingsChangedEventV1): EncodedDomainEvent {
  return encodeEventEnvelope(event);
}
```

New named encoder (`decision-record-codecs.ts:72-74`; notice `:85-89`; pins
`line-settings-codecs.ts:62-64`):

```ts
export function encodeGoalSettingsChangedEvent(event: GoalSettingsChangedEventV1): EncodedDomainEvent {
  return goalSettingsChangedCodec.encode(event);
}
```

Factory member (`event-codec-factory.ts:63-65`):

```ts
encode(event: T): EncodedDomainEvent {
  return encodeEventEnvelope(event);
},
```

There is no rebuild, no key sort, no default fill, no unknown-field strip and no
validation before encoding: the caller's object reference is passed straight
through to `JSON.stringify`, so key order, array order, explicit `null` and
missing keys keep the old bytes. The generic `T` is the same envelope constraint
as `encodeEventEnvelope`; the public named signatures are unchanged.

## 2. `registration.validate` returns the same outer `event` object

Old (`s85-base` `decision-record-codecs.ts:411-419`;
`line-settings-codecs.ts:94-97`), e.g.:

```ts
function validateGoalSettingsChangedEvent(event: EncodedDomainEvent): DecodeResult<EncodedDomainEvent> {
  const decoded = decodeGoalSettingsChangedEvent(event);
  return decoded.status === 'decoded' ? { status: 'decoded', value: event } : decoded;
}
```

New factory (`event-codec-factory.ts:72-75`):

```ts
validate(event: EncodedDomainEvent): DecodeResult<EncodedDomainEvent> {
  const decoded = decodeBody(event);
  return decoded.status === 'decoded' ? { status: 'decoded', value: event } : decoded;
},
```

`event` is the same parameter object that entered `validate`; there is no
spread, clone or re-encode. On failure the `decodeBody` result (the original
`{status:'invalid', reason}` object) is returned unchanged. The three old
per-event `validate*` functions were removed and the registrations now point at
the factory members, so each of the three registrations has this one identity
behaviour.

## 3. Registration entries: same values, same order

| Schema | Old entry (base) | New entry | Order |
|---|---|---|---|
| `DECISION_RECORD_SCHEMAS` | `{eventType: GOAL_SETTINGS_CHANGED_EVENT, schemaVersion: DECISION_EVENT_SCHEMA_VERSION, validate: validateGoalSettingsChangedEvent}` | `goalSettingsChangedCodec.registration` = `{eventType: format.eventType, schemaVersion: format.schemaVersion, validate: …}` | 1st (unchanged) |
| `DECISION_RECORD_SCHEMAS` | `{eventType: WORKSPACE_NOTICE_SEEN_CHANGED_EVENT, schemaVersion: DECISION_EVENT_SCHEMA_VERSION, validate: validateWorkspaceNoticeSeenChangedEvent}` | `workspaceNoticeSeenChangedCodec.registration` | 2nd (unchanged) |
| `LINE_SETTINGS_RECORD_SCHEMAS` | `{eventType: WORKSPACE_LINE_PINS_CHANGED_EVENT, schemaVersion: LINE_SETTINGS_EVENT_SCHEMA_VERSION, validate: validateWorkspaceLinePinsChangedEvent}` | `workspaceLinePinsChangedCodec.registration` | only entry (unchanged) |

The format literals bind `eventType` and `schemaVersion` to the same constants
(`GOAL_SETTINGS_CHANGED_EVENT`, `WORKSPACE_NOTICE_SEEN_CHANGED_EVENT`,
`WORKSPACE_LINE_PINS_CHANGED_EVENT`; all version `1`), so the runtime values and
the entry order are identical. `records: []` and `lookups: []` are unchanged in
both schema objects.

New line numbers: `DECISION_RECORD_SCHEMAS` `decision-record-codecs.ts:423-431`;
`LINE_SETTINGS_RECORD_SCHEMAS` `line-settings-codecs.ts:101-107`.
