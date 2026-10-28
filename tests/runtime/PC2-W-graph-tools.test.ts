/** PC-2 row PC-24 (W): `createGraphTools` takes the platform tool texts. */
import { expect, it } from 'vitest';
import { toolSchema as z, type ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { PLATFORM_PROMPT_PACK_V1 } from '../../src/contracts/prompts/platform-pack.generated.js';
import { createGraphTools } from '../../src/core/agent-runtime/graph-tools.js';

type Texts = Readonly<Record<string, { description: string; parameters: Readonly<Record<string, string>> }>>;
type ToolSpecification = { name: string; description: string; inputSchema: unknown };

const definitions = (texts?: Texts): ToolDefinition[] =>
  createGraphTools({ context: { projectId: 'p', workspaceId: 'w', principal: {}, materialReader: {}, signal: new AbortController().signal } as never,
    goalRef: { aggregateType: 'Goal', projectId: 'p', goalId: 'g' }, graph: {} as never, inputs: {} as never, history: {} as never,
    ...(texts === undefined ? {} : { texts }) }).create({} as never);
const specification = (tools: ToolDefinition[]) => tools.map(tool => ({ name: tool.name, description: tool.description, inputSchema: z.toJSONSchema(tool.inputSchema) }));

/**
 * The `pc1-final` specification, one hand-written JSON literal. Copied by hand
 * from `git show pc1-final:src/core/agent-runtime/graph-tools.ts` (schema shape,
 * key order, constraints) and
 * `git show pc1-final:src/contracts/prompts/platform-pack.generated.ts`
 * (every description and parameter text).
 */
const DEFAULT_SPECIFICATION: readonly ToolSpecification[] = [
  {
    "name": "look_graph",
    "description": "Read one graph node/path card or page (relation card/children/neighbours/executions/checks), the original execution history of one Run, or the exact declared task input body by page. Or read notes: `{ memory: { v: 1, op: lookup|neighbors|history|conflicts, ... } }`. The Goal, scope and identity are bound by the platform; do not send them.",
    "inputSchema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "anyOf": [
            {
              "type": "object",
              "properties": {
                "mode": {
                  "type": "string",
                  "const": "node"
                },
                "target": {
                  "oneOf": [
                    {
                      "type": "object",
                      "properties": {
                        "kind": {
                          "type": "string",
                          "const": "goal"
                        },
                        "ref": {
                          "type": "object",
                          "properties": {
                            "aggregateType": {
                              "type": "string",
                              "const": "Goal"
                            },
                            "projectId": {
                              "type": "string",
                              "minLength": 1
                            },
                            "goalId": {
                              "type": "string",
                              "minLength": 1
                            }
                          },
                          "required": [
                            "aggregateType",
                            "projectId",
                            "goalId"
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
                          "const": "stage"
                        },
                        "planRef": {
                          "type": "object",
                          "properties": {
                            "aggregateType": {
                              "type": "string",
                              "const": "PlanRevision"
                            },
                            "projectId": {
                              "type": "string",
                              "minLength": 1
                            },
                            "planId": {
                              "type": "string",
                              "minLength": 1
                            }
                          },
                          "required": [
                            "aggregateType",
                            "projectId",
                            "planId"
                          ],
                          "additionalProperties": false
                        },
                        "stageId": {
                          "type": "string",
                          "minLength": 1
                        }
                      },
                      "required": [
                        "kind",
                        "planRef",
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
                        },
                        "planRef": {
                          "type": "object",
                          "properties": {
                            "aggregateType": {
                              "type": "string",
                              "const": "PlanRevision"
                            },
                            "projectId": {
                              "type": "string",
                              "minLength": 1
                            },
                            "planId": {
                              "type": "string",
                              "minLength": 1
                            }
                          },
                          "required": [
                            "aggregateType",
                            "projectId",
                            "planId"
                          ],
                          "additionalProperties": false
                        }
                      },
                      "required": [
                        "kind",
                        "ref",
                        "planRef"
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
                          "const": "session"
                        },
                        "ref": {
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
                          "const": "run"
                        },
                        "ref": {
                          "type": "object",
                          "properties": {
                            "aggregateType": {
                              "type": "string",
                              "const": "Run"
                            },
                            "projectId": {
                              "type": "string",
                              "minLength": 1
                            },
                            "goalId": {
                              "type": "string",
                              "minLength": 1
                            },
                            "runId": {
                              "type": "string",
                              "minLength": 1
                            }
                          },
                          "required": [
                            "aggregateType",
                            "projectId",
                            "goalId",
                            "runId"
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
                          "const": "round"
                        },
                        "ref": {
                          "type": "object",
                          "properties": {
                            "aggregateType": {
                              "type": "string",
                              "const": "VerificationRound"
                            },
                            "projectId": {
                              "type": "string",
                              "minLength": 1
                            },
                            "workspaceId": {
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
                            },
                            "runId": {
                              "type": "string",
                              "minLength": 1
                            },
                            "roundId": {
                              "type": "string",
                              "minLength": 1
                            }
                          },
                          "required": [
                            "aggregateType",
                            "projectId",
                            "workspaceId",
                            "goalId",
                            "taskId",
                            "runId",
                            "roundId"
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
                "relation": {
                  "type": "string",
                  "enum": [
                    "card",
                    "children",
                    "neighbours",
                    "executions",
                    "checks"
                  ]
                },
                "page": {
                  "type": "object",
                  "properties": {
                    "afterCursor": {
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
                    "limit": {
                      "type": "integer",
                      "minimum": 1,
                      "maximum": 100
                    }
                  },
                  "additionalProperties": false
                }
              },
              "required": [
                "mode",
                "target"
              ],
              "additionalProperties": false
            },
            {
              "type": "object",
              "properties": {
                "mode": {
                  "type": "string",
                  "const": "path"
                },
                "path": {
                  "type": "string",
                  "minLength": 1
                },
                "relation": {
                  "type": "string",
                  "enum": [
                    "card",
                    "children",
                    "neighbours",
                    "executions",
                    "checks"
                  ]
                },
                "page": {
                  "type": "object",
                  "properties": {
                    "afterCursor": {
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
                    "limit": {
                      "type": "integer",
                      "minimum": 1,
                      "maximum": 100
                    }
                  },
                  "additionalProperties": false
                }
              },
              "required": [
                "mode",
                "path"
              ],
              "additionalProperties": false
            },
            {
              "type": "object",
              "properties": {
                "mode": {
                  "type": "string",
                  "const": "history"
                },
                "runRef": {
                  "type": "object",
                  "properties": {
                    "aggregateType": {
                      "type": "string",
                      "const": "Run"
                    },
                    "projectId": {
                      "type": "string",
                      "minLength": 1
                    },
                    "goalId": {
                      "type": "string",
                      "minLength": 1
                    },
                    "runId": {
                      "type": "string",
                      "minLength": 1
                    }
                  },
                  "required": [
                    "aggregateType",
                    "projectId",
                    "goalId",
                    "runId"
                  ],
                  "additionalProperties": false
                },
                "afterCursor": {
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
                "limit": {
                  "type": "integer",
                  "minimum": 1,
                  "maximum": 200
                }
              },
              "required": [
                "mode",
                "runRef"
              ],
              "additionalProperties": false
            },
            {
              "type": "object",
              "properties": {
                "mode": {
                  "type": "string",
                  "const": "input"
                },
                "consumer": {
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
                },
                "planRef": {
                  "type": "object",
                  "properties": {
                    "aggregateType": {
                      "type": "string",
                      "const": "PlanRevision"
                    },
                    "projectId": {
                      "type": "string",
                      "minLength": 1
                    },
                    "planId": {
                      "type": "string",
                      "minLength": 1
                    }
                  },
                  "required": [
                    "aggregateType",
                    "projectId",
                    "planId"
                  ],
                  "additionalProperties": false
                },
                "declarationId": {
                  "type": "string",
                  "minLength": 1
                },
                "candidateKey": {
                  "type": "string",
                  "minLength": 1
                },
                "afterCursor": {
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
                "maxBytes": {
                  "type": "integer",
                  "minimum": 1,
                  "maximum": 4096
                }
              },
              "required": [
                "mode",
                "consumer",
                "planRef",
                "declarationId"
              ],
              "additionalProperties": false
            },
        {
          "type": "object",
          "properties": {
            "memory": {
              "oneOf": [
                {
                  "type": "object",
                  "properties": {
                    "v": {
                      "type": "number",
                      "const": 1
                    },
                    "op": {
                      "type": "string",
                      "const": "lookup"
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
                            "symbol": {
                              "type": "object",
                              "properties": {
                                "language": {
                                  "type": "string",
                                  "minLength": 1
                                },
                                "qualifiedName": {
                                  "type": "string",
                                  "minLength": 1
                                },
                                "signatureDigest": {
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
                                },
                                "fileDigest": {
                                  "type": "string",
                                  "minLength": 1
                                }
                              },
                              "required": [
                                "language",
                                "qualifiedName",
                                "signatureDigest",
                                "range",
                                "fileDigest"
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
                            "planRevision": {
                              "type": "integer",
                              "minimum": -9007199254740991,
                              "maximum": 9007199254740991
                            },
                            "stageId": {
                              "type": "string",
                              "minLength": 1
                            }
                          },
                          "required": [
                            "kind",
                            "goalId",
                            "planRevision",
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
                    "body": {
                      "type": "object",
                      "properties": {
                        "noteId": {
                          "type": "string",
                          "minLength": 1
                        },
                        "version": {
                          "type": "integer",
                          "minimum": 1,
                          "maximum": 9007199254740991
                        },
                        "cursor": {
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
                        "noteId"
                      ],
                      "additionalProperties": false
                    },
                    "limit": {
                      "type": "integer",
                      "minimum": 1,
                      "maximum": 100
                    },
                    "cursor": {
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
                    "v",
                    "op",
                    "anchor"
                  ],
                  "additionalProperties": false
                },
                {
                  "type": "object",
                  "properties": {
                    "v": {
                      "type": "number",
                      "const": 1
                    },
                    "op": {
                      "type": "string",
                      "const": "neighbors"
                    },
                    "noteId": {
                      "type": "string",
                      "minLength": 1
                    },
                    "version": {
                      "type": "integer",
                      "minimum": 1,
                      "maximum": 9007199254740991
                    },
                    "limit": {
                      "type": "integer",
                      "minimum": 1,
                      "maximum": 100
                    },
                    "cursor": {
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
                    "v",
                    "op",
                    "noteId"
                  ],
                  "additionalProperties": false
                },
                {
                  "type": "object",
                  "properties": {
                    "v": {
                      "type": "number",
                      "const": 1
                    },
                    "op": {
                      "type": "string",
                      "const": "history"
                    },
                    "noteId": {
                      "type": "string",
                      "minLength": 1
                    },
                    "body": {
                      "type": "object",
                      "properties": {
                        "noteId": {
                          "type": "string",
                          "minLength": 1
                        },
                        "version": {
                          "type": "integer",
                          "minimum": 1,
                          "maximum": 9007199254740991
                        },
                        "cursor": {
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
                        "noteId"
                      ],
                      "additionalProperties": false
                    },
                    "limit": {
                      "type": "integer",
                      "minimum": 1,
                      "maximum": 100
                    },
                    "cursor": {
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
                    "v",
                    "op",
                    "noteId"
                  ],
                  "additionalProperties": false
                },
                {
                  "type": "object",
                  "properties": {
                    "v": {
                      "type": "number",
                      "const": 1
                    },
                    "op": {
                      "type": "string",
                      "const": "conflicts"
                    },
                    "noteId": {
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
                            "symbol": {
                              "type": "object",
                              "properties": {
                                "language": {
                                  "type": "string",
                                  "minLength": 1
                                },
                                "qualifiedName": {
                                  "type": "string",
                                  "minLength": 1
                                },
                                "signatureDigest": {
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
                                },
                                "fileDigest": {
                                  "type": "string",
                                  "minLength": 1
                                }
                              },
                              "required": [
                                "language",
                                "qualifiedName",
                                "signatureDigest",
                                "range",
                                "fileDigest"
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
                            "planRevision": {
                              "type": "integer",
                              "minimum": -9007199254740991,
                              "maximum": 9007199254740991
                            },
                            "stageId": {
                              "type": "string",
                              "minLength": 1
                            }
                          },
                          "required": [
                            "kind",
                            "goalId",
                            "planRevision",
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
                    "limit": {
                      "type": "integer",
                      "minimum": 1,
                      "maximum": 100
                    },
                    "cursor": {
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
                    "v",
                    "op"
                  ],
                  "additionalProperties": false
                }
              ]
            }
          },
          "required": [
            "memory"
          ],
          "additionalProperties": false
        }
      ]
    }
  },
  {
    "name": "find_graph",
    "description": "Search the bound Goal graph case-insensitively (NFC + ASCII-lowercased): node names and summaries by substring; module paths when the path equals the query, is the query's longest directory-boundary owner, or lies under `query + '/'`. Or search notes: `{ memory: { v: 1, op: find|stale, ... } }`. The Goal, scope and identity are bound by the platform; do not send them.",
    "inputSchema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "anyOf": [
        {
          "type": "object",
          "properties": {
            "needle": {
              "type": "string",
              "minLength": 1
            },
            "page": {
              "type": "object",
              "properties": {
                "afterCursor": {
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
                "limit": {
                  "type": "integer",
                  "minimum": 1,
                  "maximum": 100
                }
              },
              "additionalProperties": false
            }
          },
          "required": [
            "needle"
          ],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "memory": {
              "oneOf": [
                {
                  "type": "object",
                  "properties": {
                    "v": {
                      "type": "number",
                      "const": 1
                    },
                    "op": {
                      "type": "string",
                      "const": "find"
                    },
                    "terms": {
                      "maxItems": 8,
                      "type": "array",
                      "items": {
                        "type": "string",
                        "minLength": 1
                      }
                    },
                    "match": {
                      "type": "string",
                      "enum": [
                        "any",
                        "all"
                      ]
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
                            "symbol": {
                              "type": "object",
                              "properties": {
                                "language": {
                                  "type": "string",
                                  "minLength": 1
                                },
                                "qualifiedName": {
                                  "type": "string",
                                  "minLength": 1
                                },
                                "signatureDigest": {
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
                                },
                                "fileDigest": {
                                  "type": "string",
                                  "minLength": 1
                                }
                              },
                              "required": [
                                "language",
                                "qualifiedName",
                                "signatureDigest",
                                "range",
                                "fileDigest"
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
                            "planRevision": {
                              "type": "integer",
                              "minimum": -9007199254740991,
                              "maximum": 9007199254740991
                            },
                            "stageId": {
                              "type": "string",
                              "minLength": 1
                            }
                          },
                          "required": [
                            "kind",
                            "goalId",
                            "planRevision",
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
                    "pathPrefix": {
                      "type": "string",
                      "minLength": 1
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
                        "repair",
                        "general"
                      ]
                    },
                    "topic": {
                      "type": "string",
                      "minLength": 1
                    },
                    "state": {
                      "type": "string",
                      "enum": [
                        "staged",
                        "accepted",
                        "reviewed",
                        "pending_review",
                        "rejected",
                        "superseded",
                        "withdrawn"
                      ]
                    },
                    "related": {
                      "anyOf": [
                        {
                          "anyOf": [
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
                            }
                          ]
                        },
                        {
                          "type": "null"
                        }
                      ]
                    },
                    "limit": {
                      "type": "integer",
                      "minimum": 1,
                      "maximum": 100
                    },
                    "cursor": {
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
                    "v",
                    "op"
                  ],
                  "additionalProperties": false
                },
                {
                  "type": "object",
                  "properties": {
                    "v": {
                      "type": "number",
                      "const": 1
                    },
                    "op": {
                      "type": "string",
                      "const": "stale"
                    },
                    "goalId": {
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
                            "symbol": {
                              "type": "object",
                              "properties": {
                                "language": {
                                  "type": "string",
                                  "minLength": 1
                                },
                                "qualifiedName": {
                                  "type": "string",
                                  "minLength": 1
                                },
                                "signatureDigest": {
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
                                },
                                "fileDigest": {
                                  "type": "string",
                                  "minLength": 1
                                }
                              },
                              "required": [
                                "language",
                                "qualifiedName",
                                "signatureDigest",
                                "range",
                                "fileDigest"
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
                            "planRevision": {
                              "type": "integer",
                              "minimum": -9007199254740991,
                              "maximum": 9007199254740991
                            },
                            "stageId": {
                              "type": "string",
                              "minLength": 1
                            }
                          },
                          "required": [
                            "kind",
                            "goalId",
                            "planRevision",
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
                    "limit": {
                      "type": "integer",
                      "minimum": 1,
                      "maximum": 100
                    },
                    "cursor": {
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
                    "v",
                    "op"
                  ],
                  "additionalProperties": false
                }
              ]
            }
          },
          "required": [
            "memory"
          ],
          "additionalProperties": false
        }
      ]
    }
  }
];

const changedDescriptions = {
  look_graph: 'PC2-W changed look_graph description',
  find_graph: 'PC2-W changed find_graph description',
} as const;
const changed: Texts = {
  look_graph: { description: changedDescriptions.look_graph, parameters: {} },
  find_graph: { description: changedDescriptions.find_graph, parameters: {} },
};

it('PC2-W-graph-tools carries both changed descriptions', () => {
  const tools = definitions(changed);
  expect(Object.fromEntries(tools.map(tool => [tool.name, tool.description]))).toEqual(changedDescriptions);
});

it('PC2-W-graph-tools falls back per tool to the hand-written platform specification', () => {
  const tools = definitions({ look_graph: changed['look_graph']! });
  expect(tools.find(tool => tool.name === 'look_graph')?.description).toBe('PC2-W changed look_graph description');
  const actual = specification(tools).find(tool => tool.name === 'find_graph')!;
  const expected = DEFAULT_SPECIFICATION.find(tool => tool.name === 'find_graph')!;
  expect(actual.description).toBe(expected.description);
  expect(JSON.stringify(actual)).toBe(JSON.stringify(expected));
});

it('PC2-W-graph-tools default texts and explicit platform texts match the hand-written pc1-final specification', () => {
  const baseline = JSON.stringify(DEFAULT_SPECIFICATION);
  expect(JSON.stringify(specification(definitions()))).toBe(baseline);
  expect(JSON.stringify(specification(definitions(PLATFORM_PROMPT_PACK_V1.tools)))).toBe(baseline);
  expect(specification(definitions())).toEqual(specification(definitions(PLATFORM_PROMPT_PACK_V1.tools)));
});
