/** PC-2 row PC-24 (W): `createNoteTools` takes the platform tool texts as input. */
import { expect, it } from 'vitest';
import { toolSchema as z, type ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { PLATFORM_PROMPT_PACK_V1 } from '../../src/contracts/prompts/platform-pack.generated.js';
import { createNoteTools } from '../../src/core/agent-runtime/note-tool.js';

type Texts = Readonly<Record<string, { description: string; parameters: Readonly<Record<string, string>> }>>;
type ToolSpecification = { name: string; description: string; inputSchema: unknown };
const context = { projectId: 'p', workspaceId: 'w', principal: {}, materialReader: {}, signal: new AbortController().signal } as never;
const definition = (texts?: Texts): ToolDefinition =>
  createNoteTools({ context, notes: {} as never, check: {} as never, requestIdForCall: () => 'r', ...(texts === undefined ? {} : { texts }) })
    .create({} as never)[0]!;
const specification = (tool: ToolDefinition) => ({ name: tool.name, description: tool.description, inputSchema: z.toJSONSchema(tool.inputSchema) });

/**
 * The `pc1-final` specification, one hand-written JSON literal. Copied by hand
 * from `git show pc1-final:src/core/agent-runtime/note-tool.ts` (schema shape,
 * key order, constraints) and
 * `git show pc1-final:src/contracts/prompts/platform-pack.generated.ts`
 * (every description and parameter text).
 */
const DEFAULT_SPECIFICATION: ToolSpecification = {
  "name": "record_note",
  "description": "Record a note: `{ op: \"write\" | \"review\" | \"withdraw\", ... }`. Write at task end, rework, plan adoption or archive (MVP B09). Before writing, look first: use the memory `lookup` branch for the existing `topics` of the anchor and the `find` branch, and reuse an existing topic. Anchor so the note still holds if this task is cancelled tomorrow (otherwise anchor on architecture). Pick one of the eight kinds: `convention`, `pitfall`, `tradeoff`, `open_question`, `preference`, `decision`, `understanding`, `repair`. Keep the conclusion to one line; facts are pointers only, never copied text. Close an `open_question` with the `decision` that points at it via `replaces`. `write` stores your draft (the platform resolves plan/catalog revisions, the stage anchor plan revision, file symbol locators and basis-file digests from this execution; never send them) and returns `{ write, check }`; read the `check` result and fix what it reports. `review` (the scribe) reviews/accepts/rejects, with an optional `resolution: \"supersede\" | \"coexist\"` when resolving live contradictions; `withdraw` withdraws a note you may withdraw. Only items with `currentEligible: true` are current conclusions. Authority is enforced by the note service.",
  "inputSchema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "oneOf": [
      {
        "type": "object",
        "properties": {
          "op": {
            "type": "string",
            "const": "write"
          },
          "kind": {
            "type": "string",
            "enum": [
              "convention",
              "pitfall",
              "tradeoff",
              "open_question",
              "preference",
              "decision",
              "understanding",
              "repair"
            ]
          },
          "topic": {
            "type": "string",
            "minLength": 1
          },
          "conclusion": {
            "type": "string",
            "minLength": 1
          },
          "anchor": {
            "oneOf": [
              {
                "type": "object",
                "properties": {
                  "kind": {
                    "type": "string",
                    "const": "module"
                  },
                  "moduleId": {
                    "type": "string",
                    "minLength": 1
                  }
                },
                "required": [
                  "kind",
                  "moduleId"
                ],
                "additionalProperties": false
              },
              {
                "type": "object",
                "properties": {
                  "kind": {
                    "type": "string",
                    "const": "interface"
                  },
                  "moduleId": {
                    "type": "string",
                    "minLength": 1
                  },
                  "interfaceId": {
                    "type": "string",
                    "minLength": 1
                  }
                },
                "required": [
                  "kind",
                  "moduleId",
                  "interfaceId"
                ],
                "additionalProperties": false
              },
              {
                "type": "object",
                "properties": {
                  "kind": {
                    "type": "string",
                    "const": "file"
                  },
                  "path": {
                    "type": "string",
                    "minLength": 1
                  },
                  "symbolRequest": {
                    "type": "object",
                    "properties": {
                      "language": {
                        "type": "string",
                        "minLength": 1
                      },
                      "name": {
                        "type": "string",
                        "minLength": 1
                      },
                      "range": {
                        "type": "object",
                        "properties": {
                          "startLine": {
                            "type": "integer",
                            "minimum": 0,
                            "maximum": 9007199254740991
                          },
                          "endLine": {
                            "type": "integer",
                            "minimum": 0,
                            "maximum": 9007199254740991
                          }
                        },
                        "required": [
                          "startLine",
                          "endLine"
                        ],
                        "additionalProperties": false
                      }
                    },
                    "required": [
                      "language",
                      "name"
                    ],
                    "additionalProperties": false
                  },
                  "deleted": {
                    "type": "boolean",
                    "const": true
                  }
                },
                "required": [
                  "kind",
                  "path"
                ],
                "additionalProperties": false
              },
              {
                "type": "object",
                "properties": {
                  "kind": {
                    "type": "string",
                    "const": "goal"
                  },
                  "goalId": {
                    "type": "string",
                    "minLength": 1
                  }
                },
                "required": [
                  "kind",
                  "goalId"
                ],
                "additionalProperties": false
              },
              {
                "type": "object",
                "properties": {
                  "kind": {
                    "type": "string",
                    "const": "stage"
                  },
                  "goalId": {
                    "type": "string",
                    "minLength": 1
                  },
                  "stageId": {
                    "type": "string",
                    "minLength": 1
                  }
                },
                "required": [
                  "kind",
                  "goalId",
                  "stageId"
                ],
                "additionalProperties": false
              },
              {
                "type": "object",
                "properties": {
                  "kind": {
                    "type": "string",
                    "const": "task"
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
                  "kind",
                  "goalId",
                  "taskId"
                ],
                "additionalProperties": false
              },
              {
                "type": "object",
                "properties": {
                  "kind": {
                    "type": "string",
                    "const": "project"
                  }
                },
                "required": [
                  "kind"
                ],
                "additionalProperties": false
              }
            ]
          },
          "extraAnchors": {
            "maxItems": 4,
            "type": "array",
            "items": {
              "oneOf": [
                {
                  "type": "object",
                  "properties": {
                    "kind": {
                      "type": "string",
                      "const": "module"
                    },
                    "moduleId": {
                      "type": "string",
                      "minLength": 1
                    }
                  },
                  "required": [
                    "kind",
                    "moduleId"
                  ],
                  "additionalProperties": false
                },
                {
                  "type": "object",
                  "properties": {
                    "kind": {
                      "type": "string",
                      "const": "interface"
                    },
                    "moduleId": {
                      "type": "string",
                      "minLength": 1
                    },
                    "interfaceId": {
                      "type": "string",
                      "minLength": 1
                    }
                  },
                  "required": [
                    "kind",
                    "moduleId",
                    "interfaceId"
                  ],
                  "additionalProperties": false
                },
                {
                  "type": "object",
                  "properties": {
                    "kind": {
                      "type": "string",
                      "const": "file"
                    },
                    "path": {
                      "type": "string",
                      "minLength": 1
                    },
                    "symbolRequest": {
                      "type": "object",
                      "properties": {
                        "language": {
                          "type": "string",
                          "minLength": 1
                        },
                        "name": {
                          "type": "string",
                          "minLength": 1
                        },
                        "range": {
                          "type": "object",
                          "properties": {
                            "startLine": {
                              "type": "integer",
                              "minimum": 0,
                              "maximum": 9007199254740991
                            },
                            "endLine": {
                              "type": "integer",
                              "minimum": 0,
                              "maximum": 9007199254740991
                            }
                          },
                          "required": [
                            "startLine",
                            "endLine"
                          ],
                          "additionalProperties": false
                        }
                      },
                      "required": [
                        "language",
                        "name"
                      ],
                      "additionalProperties": false
                    },
                    "deleted": {
                      "type": "boolean",
                      "const": true
                    }
                  },
                  "required": [
                    "kind",
                    "path"
                  ],
                  "additionalProperties": false
                },
                {
                  "type": "object",
                  "properties": {
                    "kind": {
                      "type": "string",
                      "const": "goal"
                    },
                    "goalId": {
                      "type": "string",
                      "minLength": 1
                    }
                  },
                  "required": [
                    "kind",
                    "goalId"
                  ],
                  "additionalProperties": false
                },
                {
                  "type": "object",
                  "properties": {
                    "kind": {
                      "type": "string",
                      "const": "stage"
                    },
                    "goalId": {
                      "type": "string",
                      "minLength": 1
                    },
                    "stageId": {
                      "type": "string",
                      "minLength": 1
                    }
                  },
                  "required": [
                    "kind",
                    "goalId",
                    "stageId"
                  ],
                  "additionalProperties": false
                },
                {
                  "type": "object",
                  "properties": {
                    "kind": {
                      "type": "string",
                      "const": "task"
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
                    "kind",
                    "goalId",
                    "taskId"
                  ],
                  "additionalProperties": false
                },
                {
                  "type": "object",
                  "properties": {
                    "kind": {
                      "type": "string",
                      "const": "project"
                    }
                  },
                  "required": [
                    "kind"
                  ],
                  "additionalProperties": false
                }
              ]
            }
          },
          "facts": {
            "type": "array",
            "items": {
              "type": "object",
              "propertyNames": {
                "type": "string"
              },
              "additionalProperties": {}
            }
          },
          "basisFiles": {
            "type": "array",
            "items": {
              "type": "string",
              "minLength": 1
            }
          },
          "replaces": {
            "type": "array",
            "items": {
              "type": "string",
              "minLength": 1
            }
          },
          "contradicts": {
            "type": "array",
            "items": {
              "type": "string",
              "minLength": 1
            }
          },
          "coexistWith": {
            "type": "array",
            "items": {
              "type": "string",
              "minLength": 1
            }
          },
          "structural": {
            "type": "boolean"
          },
          "body": {
            "type": "string"
          },
          "sections": {
            "type": "object",
            "properties": {
              "status": {
                "type": "string",
                "minLength": 1
              },
              "decided": {
                "type": "string",
                "minLength": 1
              },
              "open": {
                "type": "string",
                "minLength": 1
              },
              "next": {
                "type": "string",
                "minLength": 1
              },
              "risks": {
                "type": "string",
                "minLength": 1
              }
            },
            "required": [
              "status",
              "decided",
              "open",
              "next",
              "risks"
            ],
            "additionalProperties": false
          },
          "expectedPointerRevision": {
            "anyOf": [
              {
                "type": "integer",
                "minimum": 0,
                "maximum": 9007199254740991
              },
              {
                "type": "null"
              }
            ]
          }
        },
        "required": [
          "op",
          "kind",
          "topic",
          "conclusion",
          "anchor"
        ],
        "additionalProperties": false
      },
      {
        "type": "object",
        "properties": {
          "op": {
            "type": "string",
            "const": "review"
          },
          "noteId": {
            "type": "string",
            "minLength": 1
          },
          "expectedVersion": {
            "type": "integer",
            "minimum": 1,
            "maximum": 9007199254740991
          },
          "verdict": {
            "type": "string",
            "enum": [
              "review",
              "accept",
              "reject"
            ]
          },
          "resolution": {
            "type": "string",
            "enum": [
              "supersede",
              "coexist"
            ]
          },
          "reason": {
            "anyOf": [
              {
                "type": "string",
                "minLength": 1
              },
              {
                "type": "null"
              }
            ]
          },
          "expectedPointerRevision": {
            "anyOf": [
              {
                "type": "integer",
                "minimum": 0,
                "maximum": 9007199254740991
              },
              {
                "type": "null"
              }
            ]
          }
        },
        "required": [
          "op",
          "noteId",
          "expectedVersion",
          "verdict"
        ],
        "additionalProperties": false
      },
      {
        "type": "object",
        "properties": {
          "op": {
            "type": "string",
            "const": "withdraw"
          },
          "noteId": {
            "type": "string",
            "minLength": 1
          },
          "expectedVersion": {
            "type": "integer",
            "minimum": 1,
            "maximum": 9007199254740991
          },
          "reason": {
            "anyOf": [
              {
                "type": "string",
                "minLength": 1
              },
              {
                "type": "null"
              }
            ]
          }
        },
        "required": [
          "op",
          "noteId",
          "expectedVersion"
        ],
        "additionalProperties": false
      }
    ]
  }
};

it('PC2-W-note-tool carries the changed record_note description', () => {
  const tool = definition({ record_note: { description: 'PC2-W changed record_note description', parameters: {} } });
  expect(tool.description).toBe('PC2-W changed record_note description');
  expect(JSON.stringify(specification(tool))).toContain('PC2-W changed record_note description');
});

it('PC2-W-note-tool default texts and explicit platform texts match the hand-written pc1-final specification', () => {
  const baseline = JSON.stringify(DEFAULT_SPECIFICATION);
  expect(JSON.stringify(specification(definition()))).toBe(baseline);
  expect(JSON.stringify(specification(definition(PLATFORM_PROMPT_PACK_V1.tools)))).toBe(baseline);
  expect(specification(definition())).toEqual(specification(definition(PLATFORM_PROMPT_PACK_V1.tools)));
});
