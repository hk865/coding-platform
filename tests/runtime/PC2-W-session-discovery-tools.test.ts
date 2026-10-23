/** PC-2 row PC-24 (W): `createSessionDiscoveryTools` takes the platform tool texts. */
import { expect, it } from 'vitest';
import { toolSchema as z, type ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { PLATFORM_PROMPT_PACK_V1 } from '../../src/contracts/prompts/platform-pack.generated.js';
import { createSessionDiscoveryTools } from '../../src/core/agent-runtime/session-discovery-tools.js';

type Texts = Readonly<Record<string, { description: string; parameters: Readonly<Record<string, string>> }>>;
type ToolSpecification = { name: string; description: string; inputSchema: unknown };

const definitions = (texts?: Texts): ToolDefinition[] =>
  createSessionDiscoveryTools({ sessions: {} as never, context: { projectId: 'p', workspaceId: 'w', principal: {}, materialReader: {}, signal: new AbortController().signal } as never,
    ...(texts === undefined ? {} : { texts }) }).create({} as never);
const specification = (tools: ToolDefinition[]) => tools.map(tool => ({ name: tool.name, description: tool.description, inputSchema: z.toJSONSchema(tool.inputSchema) }));

/**
 * The `pc1-final` specification, one hand-written JSON literal. Copied by hand
 * from `git show pc1-final:src/core/agent-runtime/session-discovery-tools.ts` (schema shape,
 * key order, constraints) and
 * `git show pc1-final:src/contracts/prompts/platform-pack.generated.ts`
 * (every description and parameter text).
 */
const DEFAULT_SPECIFICATION: readonly ToolSpecification[] = [
  {
    "name": "find_related_sessions",
    "description": "List the current Session cards linked to a required Task/Module/WorkContext target. Only open links and active Sessions are returned; archived Sessions are excluded. Read-only discovery: it starts no Run, loads no history and wakes no Session.",
    "inputSchema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "target": {
          "oneOf": [
            {
              "type": "object",
              "properties": {
                "kind": {
                  "type": "string",
                  "const": "task"
                },
                "ref": {
                  "type": "object",
                  "properties": {
                    "projectId": {
                      "type": "string",
                      "minLength": 1
                    },
                    "goalId": {
                      "type": "string",
                      "minLength": 1
                    },
                    "taskId": {
                      "type": "string",
                      "minLength": 1
                    }
                  },
                  "required": [
                    "projectId",
                    "goalId",
                    "taskId"
                  ],
                  "additionalProperties": false
                }
              },
              "required": [
                "kind",
                "ref"
              ],
              "additionalProperties": false
            },
            {
              "type": "object",
              "properties": {
                "kind": {
                  "type": "string",
                  "const": "module"
                },
                "ref": {
                  "type": "object",
                  "properties": {
                    "projectId": {
                      "type": "string",
                      "minLength": 1
                    },
                    "moduleId": {
                      "type": "string",
                      "minLength": 1
                    }
                  },
                  "required": [
                    "projectId",
                    "moduleId"
                  ],
                  "additionalProperties": false
                }
              },
              "required": [
                "kind",
                "ref"
              ],
              "additionalProperties": false
            },
            {
              "type": "object",
              "properties": {
                "kind": {
                  "type": "string",
                  "const": "work"
                },
                "ref": {
                  "type": "object",
                  "properties": {
                    "aggregateType": {
                      "type": "string",
                      "const": "WorkContextBinding"
                    },
                    "projectId": {
                      "type": "string",
                      "minLength": 1
                    },
                    "workspaceId": {
                      "type": "string",
                      "minLength": 1
                    },
                    "workId": {
                      "type": "string",
                      "minLength": 1
                    }
                  },
                  "required": [
                    "aggregateType",
                    "projectId",
                    "workspaceId",
                    "workId"
                  ],
                  "additionalProperties": false
                }
              },
              "required": [
                "kind",
                "ref"
              ],
              "additionalProperties": false
            }
          ]
        },
        "page": {
          "type": "object",
          "properties": {
            "limit": {
              "type": "integer",
              "minimum": 1,
              "maximum": 200
            },
            "cursor": {
              "type": "string",
              "minLength": 1
            },
            "atLeastCursor": {
              "type": "string",
              "minLength": 1
            }
          },
          "required": [
            "limit"
          ],
          "additionalProperties": false
        }
      },
      "required": [
        "target",
        "page"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "read_session_card",
    "description": "Read the current Session card (record, availability and work links) for one exact SessionRef. Read-only: it does not wake the Session, change occupancy, start a Run or load history.",
    "inputSchema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "sessionRef": {
          "type": "object",
          "properties": {
            "projectId": {
              "type": "string",
              "minLength": 1
            },
            "sessionId": {
              "type": "string",
              "minLength": 1
            }
          },
          "required": [
            "projectId",
            "sessionId"
          ],
          "additionalProperties": false
        }
      },
      "required": [
        "sessionRef"
      ],
      "additionalProperties": false
    }
  }
];

const changedDescriptions = {
  find_related_sessions: 'PC2-W changed find_related_sessions description',
  read_session_card: 'PC2-W changed read_session_card description',
} as const;
const changed: Texts = {
  find_related_sessions: { description: changedDescriptions.find_related_sessions, parameters: {} },
  read_session_card: { description: changedDescriptions.read_session_card, parameters: {} },
};

it('PC2-W-session-discovery-tools carries both changed descriptions', () => {
  const tools = definitions(changed);
  expect(Object.fromEntries(tools.map(tool => [tool.name, tool.description]))).toEqual(changedDescriptions);
});

it('PC2-W-session-discovery-tools falls back per tool to the hand-written platform specification', () => {
  const tools = definitions({ find_related_sessions: changed['find_related_sessions']! });
  expect(tools.find(tool => tool.name === 'find_related_sessions')?.description).toBe('PC2-W changed find_related_sessions description');
  const actual = specification(tools).find(tool => tool.name === 'read_session_card')!;
  const expected = DEFAULT_SPECIFICATION.find(tool => tool.name === 'read_session_card')!;
  expect(actual.description).toBe(expected.description);
  expect(JSON.stringify(actual)).toBe(JSON.stringify(expected));
});

it('PC2-W-session-discovery-tools default texts and explicit platform texts match the hand-written pc1-final specification', () => {
  const baseline = JSON.stringify(DEFAULT_SPECIFICATION);
  expect(JSON.stringify(specification(definitions()))).toBe(baseline);
  expect(JSON.stringify(specification(definitions(PLATFORM_PROMPT_PACK_V1.tools)))).toBe(baseline);
  expect(specification(definitions())).toEqual(specification(definitions(PLATFORM_PROMPT_PACK_V1.tools)));
});
