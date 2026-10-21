# B1 static byte proof — old decode vs new factory path

Base: tag `s85-base` = `e94d7b9` (s85 base = lead 20f64821).
Old line numbers are from `git show s85-base:<file>`; new line numbers are the
current working tree.

Shared new path: `src/core/work-graph/persistence/event-codec-factory.ts:42-78`.
All three named decoders call `codec.decodeBody(event)` and then only adapt the
success value; the failure object is returned unchanged.

Factory pipeline (`event-codec-factory.ts:49-59`), in order:

```ts
const problem = eventEnvelopeProblem(event, format.eventType, format.schemaVersion);
if (problem !== null) return invalid(problem);                       // early return 1
const parsed = parseTaggedObject(event.json, format.jsonLabel);
if (typeof parsed === 'string') return invalid(parsed);              // early return 2
const bindingProblem = eventBodyEnvelopeProblem(parsed, event, format.eventType);
if (bindingProblem !== null) return invalid(bindingProblem);         // early return 3
const bodyProblem = format.bodyProblem(parsed);
if (bodyProblem !== null) return invalid(bodyProblem);               // early return 4
return { status: 'decoded', value: parsed };
```

## 1. `GoalSettingsChanged@1`

Old: `decision-record-codecs.ts:60-72` (base). New wrapper:
`decision-record-codecs.ts:76-83`; format `:54-59`; codec `:68`.

OLD (base `decision-record-codecs.ts:63-71`):

```ts
const problem = eventEnvelopeProblem(event, GOAL_SETTINGS_CHANGED_EVENT, DECISION_EVENT_SCHEMA_VERSION);
if (problem !== null) return invalid(problem);
const parsed = parseTaggedObject(event.json, 'GoalSettingsChanged event');
if (typeof parsed === 'string') return invalid(parsed);
const bindingProblem = eventBodyEnvelopeProblem(parsed, event, GOAL_SETTINGS_CHANGED_EVENT);
if (bindingProblem !== null) return invalid(bindingProblem);
const bodyProblem = goalSettingsChangedEventProblem(parsed);
if (bodyProblem !== null) return invalid(bodyProblem);
return { status: 'decoded', value: parsed as unknown as GoalSettingsChangedEventV1 };
```

NEW (wrapper `:79-82`, factory `:50-58`):

```ts
const decoded = goalSettingsChangedCodec.decodeBody(event);
return decoded.status === 'decoded'
  ? { status: 'decoded', value: decoded.value as unknown as GoalSettingsChangedEventV1 }
  : decoded;
```

The format supplies exactly the old arguments: `eventType:
GOAL_SETTINGS_CHANGED_EVENT`, `schemaVersion: DECISION_EVENT_SCHEMA_VERSION`
(`1`), `jsonLabel: 'GoalSettingsChanged event'`, `bodyProblem:
goalSettingsChangedEventProblem`.

| Stage | OLD call / argument | NEW call / argument |
|---|---|---|
| 1 | `eventEnvelopeProblem(event, GOAL_SETTINGS_CHANGED_EVENT, DECISION_EVENT_SCHEMA_VERSION)` | `eventEnvelopeProblem(event, format.eventType, format.schemaVersion)` = same constant values |
| 2 | `parseTaggedObject(event.json, 'GoalSettingsChanged event')` | `parseTaggedObject(event.json, format.jsonLabel)` = same literal |
| 3 | `eventBodyEnvelopeProblem(parsed, event, GOAL_SETTINGS_CHANGED_EVENT)` | `eventBodyEnvelopeProblem(parsed, event, format.eventType)` = same value |
| 4 | `goalSettingsChangedEventProblem(parsed)` | `format.bodyProblem(parsed)` = the same exported function reference |

Returns 1–4: `invalid(problem)`, `invalid(parsed)`, `invalid(bindingProblem)`,
`invalid(bodyProblem)` — identical text and identical `{status:'invalid', reason}`
shape. The old inline success cast moved verbatim into the named wrapper.

## 2. `WorkspaceNoticeSeenChanged@1`

Old: `decision-record-codecs.ts:80-92` (base). New wrapper:
`decision-record-codecs.ts:91-98`; format `:61-66`; codec `:69-70`.

OLD (base `decision-record-codecs.ts:83-91`):

```ts
const problem = eventEnvelopeProblem(event, WORKSPACE_NOTICE_SEEN_CHANGED_EVENT, DECISION_EVENT_SCHEMA_VERSION);
if (problem !== null) return invalid(problem);
const parsed = parseTaggedObject(event.json, 'WorkspaceNoticeSeenChanged event');
if (typeof parsed === 'string') return invalid(parsed);
const bindingProblem = eventBodyEnvelopeProblem(parsed, event, WORKSPACE_NOTICE_SEEN_CHANGED_EVENT);
if (bindingProblem !== null) return invalid(bindingProblem);
const bodyProblem = workspaceNoticeSeenChangedEventProblem(parsed);
if (bodyProblem !== null) return invalid(bodyProblem);
return { status: 'decoded', value: parsed as unknown as WorkspaceNoticeSeenChangedEventV1 };
```

NEW (wrapper `:94-97`, factory `:50-58`):

```ts
const decoded = workspaceNoticeSeenChangedCodec.decodeBody(event);
return decoded.status === 'decoded'
  ? { status: 'decoded', value: decoded.value as unknown as WorkspaceNoticeSeenChangedEventV1 }
  : decoded;
```

| Stage | OLD call / argument | NEW call / argument |
|---|---|---|
| 1 | `eventEnvelopeProblem(event, WORKSPACE_NOTICE_SEEN_CHANGED_EVENT, DECISION_EVENT_SCHEMA_VERSION)` | `eventEnvelopeProblem(event, format.eventType, format.schemaVersion)` |
| 2 | `parseTaggedObject(event.json, 'WorkspaceNoticeSeenChanged event')` | `parseTaggedObject(event.json, format.jsonLabel)` = same literal |
| 3 | `eventBodyEnvelopeProblem(parsed, event, WORKSPACE_NOTICE_SEEN_CHANGED_EVENT)` | `eventBodyEnvelopeProblem(parsed, event, format.eventType)` |
| 4 | `workspaceNoticeSeenChangedEventProblem(parsed)` | `format.bodyProblem(parsed)` = same exported function reference |

Returns 1–4 are the same four early returns with the same text.

## 3. `WorkspaceLinePinsChanged@1`

Old: `line-settings-codecs.ts:56-70` (base). New wrapper:
`line-settings-codecs.ts:66-73`; format `:52-57`; codec `:59-60`.
The old checker was and remains file-private (`:85`); it is passed as the hook.

OLD (base `line-settings-codecs.ts:59-69`):

```ts
const problem = eventEnvelopeProblem(
  event, WORKSPACE_LINE_PINS_CHANGED_EVENT, LINE_SETTINGS_EVENT_SCHEMA_VERSION,
);
if (problem !== null) return invalid(problem);
const parsed = parseTaggedObject(event.json, 'WorkspaceLinePinsChanged event');
if (typeof parsed === 'string') return invalid(parsed);
const bindingProblem = eventBodyEnvelopeProblem(parsed, event, WORKSPACE_LINE_PINS_CHANGED_EVENT);
if (bindingProblem !== null) return invalid(bindingProblem);
const bodyProblem = workspaceLinePinsChangedEventProblem(parsed);
if (bodyProblem !== null) return invalid(bodyProblem);
return { status: 'decoded', value: parsed as unknown as WorkspaceLinePinsChangedEventV1 };
```

NEW (wrapper `:69-72`, factory `:50-58`):

```ts
const decoded = workspaceLinePinsChangedCodec.decodeBody(event);
return decoded.status === 'decoded'
  ? { status: 'decoded', value: decoded.value as unknown as WorkspaceLinePinsChangedEventV1 }
  : decoded;
```

| Stage | OLD call / argument | NEW call / argument |
|---|---|---|
| 1 | `eventEnvelopeProblem(event, WORKSPACE_LINE_PINS_CHANGED_EVENT, LINE_SETTINGS_EVENT_SCHEMA_VERSION)` | `eventEnvelopeProblem(event, format.eventType, format.schemaVersion)` |
| 2 | `parseTaggedObject(event.json, 'WorkspaceLinePinsChanged event')` | `parseTaggedObject(event.json, format.jsonLabel)` = same literal |
| 3 | `eventBodyEnvelopeProblem(parsed, event, WORKSPACE_LINE_PINS_CHANGED_EVENT)` | `eventBodyEnvelopeProblem(parsed, event, format.eventType)` |
| 4 | `workspaceLinePinsChangedEventProblem(parsed)` | `format.bodyProblem(parsed)` = same file-private function |

Returns 1–4 are the same four early returns with the same text. The old
two-line call layout collapsed to one line inside the factory; the argument
order is unchanged.

## Three JSON labels

| Event | Label in old decoder | Label in new format |
|---|---|---|
| `GoalSettingsChanged@1` | `'GoalSettingsChanged event'` | `jsonLabel: 'GoalSettingsChanged event'` |
| `WorkspaceNoticeSeenChanged@1` | `'WorkspaceNoticeSeenChanged event'` | `jsonLabel: 'WorkspaceNoticeSeenChanged event'` |
| `WorkspaceLinePinsChanged@1` | `'WorkspaceLinePinsChanged event'` | `jsonLabel: 'WorkspaceLinePinsChanged event'` |

## Body checkers unchanged

`goalSettingsChangedEventProblem` (old `decision-record-codecs.ts:354`,
new `:360`), `workspaceNoticeSeenChangedEventProblem` (old `:363`, new `:369`)
and `workspaceLinePinsChangedEventProblem` (old and new `line-settings-codecs.ts`
`:82` → `:85`) are the same function bodies, with the same `eventBodyProblem`
call and the same `the event body must be an object` direct-call behaviour.
Only the surrounding wiring moved.
