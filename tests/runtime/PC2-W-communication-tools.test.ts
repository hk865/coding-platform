/** PC-2 row PC-24 (W): `createSessionMailboxTools` takes the platform tool texts. */
import { expect, it } from 'vitest';
import { toolSchema as z, type ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { PLATFORM_PROMPT_PACK_V1 } from '../../src/contracts/prompts/platform-pack.generated.js';
import { createSessionMailboxTools } from '../../src/core/agent-runtime/communication-tools.js';

type Texts = Readonly<Record<string, { description: string; parameters: Readonly<Record<string, string>> }>>;
type ToolSpecification = { name: string; description: string; inputSchema: unknown };

const definitions = (texts?: Texts): ToolDefinition[] =>
  createSessionMailboxTools({ mailbox: {} as never, decisionMessages: {} as never,
    context: { projectId: 'p', workspaceId: 'w', principal: {}, materialReader: {}, signal: new AbortController().signal } as never,
    sessionRef: { projectId: 'p', sessionId: 's' }, requestIdForCall: () => 'r', ...(texts === undefined ? {} : { texts }) }).create({} as never);
const specification = (tools: ToolDefinition[]) => tools.map(tool => ({ name: tool.name, description: tool.description, inputSchema: z.toJSONSchema(tool.inputSchema) }));

/**
 * The hand-written pc1-final tool specification, mechanically updated for
 * 6B-1 SR7 / L-02: decision sources carry the goal/project subject union.
 * Unchanged schemas and tool texts retain the pc1-final expectations copied
 * from communication-tools.ts and platform-pack.generated.ts at that tag.
 */
const DEFAULT_SPECIFICATION: readonly ToolSpecification[] = [
  {
    "name": "send_session_message",
    "description": "Session mailbox: send_session_message",
    "inputSchema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "recipient": {
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
        },
        "text": {
          "type": "string",
          "minLength": 1
        },
        "intent": {
          "type": "string",
          "enum": [
            "notify",
            "inquiry",
            "action_request"
          ]
        },
        "needsReply": {
          "type": "boolean"
        },
        "waitAfterSend": {
          "type": "boolean"
        },
        "expected": {
          "type": "object",
          "properties": {
            "planRevision": {
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
            },
            "pointerRevision": {
              "anyOf": [
                {
                  "type": "integer",
                  "minimum": 0,
                  "maximum": 9007199254740991
                },
                {
                  "type": "string",
                  "const": "none"
                }
              ]
            },
            "dispatchSequence": {
              "type": "integer",
              "minimum": 0,
              "maximum": 9007199254740991
            }
          },
          "required": [
            "planRevision",
            "pointerRevision",
            "dispatchSequence"
          ],
          "additionalProperties": false
        },
        "taskRef": {
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
        "followupOf": {
          "type": "object",
          "properties": {
            "aggregateType": {
              "type": "string",
              "const": "SessionMessage"
            },
            "projectId": {
              "type": "string",
              "minLength": 1
            },
            "workspaceId": {
              "type": "string",
              "minLength": 1
            },
            "messageId": {
              "type": "string",
              "minLength": 1
            }
          },
          "required": [
            "aggregateType",
            "projectId",
            "workspaceId",
            "messageId"
          ],
          "additionalProperties": false
        },
        "deadlineMs": {
          "type": "number",
          "exclusiveMinimum": 0
        }
      },
      "required": [
        "recipient",
        "text"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "read_session_inbox",
    "description": "Session mailbox: read_session_inbox",
    "inputSchema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "status": {
          "type": "string",
          "enum": [
            "pending",
            "read",
            "responded"
          ]
        },
        "page": {
          "type": "object",
          "properties": {
            "limit": {
              "type": "integer",
              "minimum": 1,
              "maximum": 100
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
        "page"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "read_session_message",
    "description": "Session mailbox: read_session_message",
    "inputSchema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "messageRef": {
          "type": "object",
          "properties": {
            "aggregateType": {
              "type": "string",
              "const": "SessionMessage"
            },
            "projectId": {
              "type": "string",
              "minLength": 1
            },
            "workspaceId": {
              "type": "string",
              "minLength": 1
            },
            "messageId": {
              "type": "string",
              "minLength": 1
            }
          },
          "required": [
            "aggregateType",
            "projectId",
            "workspaceId",
            "messageId"
          ],
          "additionalProperties": false
        }
      },
      "required": [
        "messageRef"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "read_session_message_body",
    "description": "Session mailbox: read_session_message_body",
    "inputSchema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "messageRef": {
          "type": "object",
          "properties": {
            "aggregateType": {
              "type": "string",
              "const": "SessionMessage"
            },
            "projectId": {
              "type": "string",
              "minLength": 1
            },
            "workspaceId": {
              "type": "string",
              "minLength": 1
            },
            "messageId": {
              "type": "string",
              "minLength": 1
            }
          },
          "required": [
            "aggregateType",
            "projectId",
            "workspaceId",
            "messageId"
          ],
          "additionalProperties": false
        },
        "part": {
          "type": "string",
          "enum": [
            "message",
            "response"
          ]
        }
      },
      "required": [
        "messageRef",
        "part"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "ack_session_message",
    "description": "Session mailbox: ack_session_message",
    "inputSchema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "messageRef": {
          "type": "object",
          "properties": {
            "aggregateType": {
              "type": "string",
              "const": "SessionMessage"
            },
            "projectId": {
              "type": "string",
              "minLength": 1
            },
            "workspaceId": {
              "type": "string",
              "minLength": 1
            },
            "messageId": {
              "type": "string",
              "minLength": 1
            }
          },
          "required": [
            "aggregateType",
            "projectId",
            "workspaceId",
            "messageId"
          ],
          "additionalProperties": false
        },
        "expectedRevision": {
          "type": "integer",
          "minimum": 1,
          "maximum": 9007199254740991
        }
      },
      "required": [
        "messageRef",
        "expectedRevision"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "respond_session_message",
    "description": "Session mailbox: respond_session_message",
    "inputSchema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "anyOf": [
        {
          "type": "object",
          "properties": {
            "messageRef": {
              "type": "object",
              "properties": {
                "aggregateType": {
                  "type": "string",
                  "const": "SessionMessage"
                },
                "projectId": {
                  "type": "string",
                  "minLength": 1
                },
                "workspaceId": {
                  "type": "string",
                  "minLength": 1
                },
                "messageId": {
                  "type": "string",
                  "minLength": 1
                }
              },
              "required": [
                "aggregateType",
                "projectId",
                "workspaceId",
                "messageId"
              ],
              "additionalProperties": false
            },
            "expectedRevision": {
              "type": "integer",
              "minimum": 1,
              "maximum": 9007199254740991
            },
            "text": {
              "type": "string",
              "minLength": 1
            }
          },
          "required": [
            "messageRef",
            "expectedRevision",
            "text"
          ],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "messageRef": {
              "type": "object",
              "properties": {
                "aggregateType": {
                  "type": "string",
                  "const": "SessionMessage"
                },
                "projectId": {
                  "type": "string",
                  "minLength": 1
                },
                "workspaceId": {
                  "type": "string",
                  "minLength": 1
                },
                "messageId": {
                  "type": "string",
                  "minLength": 1
                }
              },
              "required": [
                "aggregateType",
                "projectId",
                "workspaceId",
                "messageId"
              ],
              "additionalProperties": false
            },
            "expectedRevision": {
              "type": "integer",
              "minimum": 1,
              "maximum": 9007199254740991
            },
            "reject": {
              "type": "boolean",
              "const": true
            },
            "reason": {
              "type": "string",
              "minLength": 1
            }
          },
          "required": [
            "messageRef",
            "expectedRevision",
            "reject",
            "reason"
          ],
          "additionalProperties": false
        }
      ]
    }
  },
  {
    "name": "send_user_message",
    "description": "User decision: send_user_message",
    "inputSchema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "goalRef": {
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
        },
        "intent": {
          "type": "string",
          "enum": [
            "notify",
            "decision_request"
          ]
        },
        "text": {
          "type": "string"
        },
        "needsReply": {
          "type": "boolean"
        },
        "waitAfterSend": {
          "type": "boolean"
        },
        "options": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "id": {
                "type": "string",
                "minLength": 1
              },
              "label": {
                "type": "string"
              },
              "effect": {
                "type": "string",
                "enum": [
                  "apply",
                  "reject",
                  "defer"
                ]
              }
            },
            "required": [
              "id",
              "label",
              "effect"
            ],
            "additionalProperties": false
          }
        },
        "objects": {
          "type": "array",
          "items": {
            "oneOf": [
              {
                "type": "object",
                "properties": {
                  "kind": {
                    "type": "string",
                    "const": "aggregate"
                  },
                  "pin": {
                    "type": "object",
                    "properties": {
                      "ref": {
                        "oneOf": [
                          {
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
                          },
                          {
                            "type": "object",
                            "properties": {
                              "aggregateType": {
                                "type": "string",
                                "const": "Workspace"
                              },
                              "projectId": {
                                "type": "string",
                                "minLength": 1
                              },
                              "workspaceId": {
                                "type": "string",
                                "minLength": 1
                              }
                            },
                            "required": [
                              "aggregateType",
                              "projectId",
                              "workspaceId"
                            ],
                            "additionalProperties": false
                          },
                          {
                            "type": "object",
                            "properties": {
                              "aggregateType": {
                                "type": "string",
                                "const": "SessionMessage"
                              },
                              "projectId": {
                                "type": "string",
                                "minLength": 1
                              },
                              "workspaceId": {
                                "type": "string",
                                "minLength": 1
                              },
                              "messageId": {
                                "type": "string",
                                "minLength": 1
                              }
                            },
                            "required": [
                              "aggregateType",
                              "projectId",
                              "workspaceId",
                              "messageId"
                            ],
                            "additionalProperties": false
                          },
                          {
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
                          {
                            "type": "object",
                            "properties": {
                              "aggregateType": {
                                "type": "string",
                                "const": "PlanProposal"
                              },
                              "projectId": {
                                "type": "string",
                                "minLength": 1
                              },
                              "workspaceId": {
                                "type": "string",
                                "minLength": 1
                              },
                              "proposalId": {
                                "type": "string",
                                "minLength": 1
                              }
                            },
                            "required": [
                              "aggregateType",
                              "projectId",
                              "workspaceId",
                              "proposalId"
                            ],
                            "additionalProperties": false
                          },
                          {
                            "type": "object",
                            "properties": {
                              "aggregateType": {
                                "type": "string",
                                "const": "QueryJob"
                              },
                              "projectId": {
                                "type": "string",
                                "minLength": 1
                              },
                              "workspaceId": {
                                "type": "string",
                                "minLength": 1
                              },
                              "queryJobId": {
                                "type": "string",
                                "minLength": 1
                              }
                            },
                            "required": [
                              "aggregateType",
                              "projectId",
                              "workspaceId",
                              "queryJobId"
                            ],
                            "additionalProperties": false
                          },
                          {
                            "type": "object",
                            "properties": {
                              "aggregateType": {
                                "type": "string",
                                "const": "QueryRun"
                              },
                              "projectId": {
                                "type": "string",
                                "minLength": 1
                              },
                              "workspaceId": {
                                "type": "string",
                                "minLength": 1
                              },
                              "queryJobId": {
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
                              "workspaceId",
                              "queryJobId",
                              "runId"
                            ],
                            "additionalProperties": false
                          },
                          {
                            "type": "object",
                            "properties": {
                              "aggregateType": {
                                "type": "string",
                                "const": "QueryJobAnswer"
                              },
                              "projectId": {
                                "type": "string",
                                "minLength": 1
                              },
                              "workspaceId": {
                                "type": "string",
                                "minLength": 1
                              },
                              "queryJobId": {
                                "type": "string",
                                "minLength": 1
                              },
                              "answerId": {
                                "type": "string",
                                "minLength": 1
                              }
                            },
                            "required": [
                              "aggregateType",
                              "projectId",
                              "workspaceId",
                              "queryJobId",
                              "answerId"
                            ],
                            "additionalProperties": false
                          }
                        ]
                      },
                      "revision": {
                        "type": "integer",
                        "minimum": 0,
                        "maximum": 9007199254740991
                      }
                    },
                    "required": [
                      "ref",
                      "revision"
                    ],
                    "additionalProperties": false
                  },
                  "label": {
                    "type": "string"
                  }
                },
                "required": [
                  "kind",
                  "pin",
                  "label"
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
                  "workspace": {
                    "type": "object",
                    "properties": {
                      "projectId": {
                        "type": "string",
                        "minLength": 1
                      },
                      "workspaceId": {
                        "type": "string",
                        "minLength": 1
                      }
                    },
                    "required": [
                      "projectId",
                      "workspaceId"
                    ],
                    "additionalProperties": false
                  },
                  "path": {
                    "type": "string",
                    "minLength": 1
                  },
                  "digest": {
                    "anyOf": [
                      {
                        "type": "string"
                      },
                      {
                        "type": "null"
                      }
                    ]
                  },
                  "label": {
                    "type": "string"
                  }
                },
                "required": [
                  "kind",
                  "workspace",
                  "path",
                  "digest",
                  "label"
                ],
                "additionalProperties": false
              }
            ]
          }
        },
        "forwardedFrom": {
          "type": "object",
          "properties": {
            "aggregateType": {
              "type": "string",
              "const": "SessionMessage"
            },
            "projectId": {
              "type": "string",
              "minLength": 1
            },
            "workspaceId": {
              "type": "string",
              "minLength": 1
            },
            "messageId": {
              "type": "string",
              "minLength": 1
            }
          },
          "required": [
            "aggregateType",
            "projectId",
            "workspaceId",
            "messageId"
          ],
          "additionalProperties": false
        }
      },
      "required": [
        "goalRef",
        "intent",
        "text",
        "needsReply",
        "waitAfterSend",
        "options",
        "objects"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "read_user_decision",
    "description": "User decision: read_user_decision",
    "inputSchema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "source": {
          "type": "object",
          "properties": {
            "kind": {
              "type": "string",
              "enum": [
                "message",
                "goal_cause",
                "candidate",
                "note_review",
                "planning_question",
                "goal_conflict",
                "message_release"
              ]
            },
            "key": {
              "type": "string",
              "minLength": 1
            },
            "subject": {
              "oneOf": [
                {
                  "type": "object",
                  "properties": {
                    "kind": {
                      "type": "string",
                      "const": "goal"
                    },
                    "goalRef": {
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
                    "goalRef"
                  ],
                  "additionalProperties": false
                },
                {
                  "type": "object",
                  "properties": {
                    "kind": {
                      "type": "string",
                      "const": "project"
                    },
                    "projectRef": {
                      "type": "object",
                      "properties": {
                        "projectId": {
                          "type": "string",
                          "minLength": 1
                        }
                      },
                      "required": [
                        "projectId"
                      ],
                      "additionalProperties": false
                    }
                  },
                  "required": [
                    "kind",
                    "projectRef"
                  ],
                  "additionalProperties": false
                }
              ]
            },
            "pins": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "ref": {
                    "oneOf": [
                      {
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
                      },
                      {
                        "type": "object",
                        "properties": {
                          "aggregateType": {
                            "type": "string",
                            "const": "Workspace"
                          },
                          "projectId": {
                            "type": "string",
                            "minLength": 1
                          },
                          "workspaceId": {
                            "type": "string",
                            "minLength": 1
                          }
                        },
                        "required": [
                          "aggregateType",
                          "projectId",
                          "workspaceId"
                        ],
                        "additionalProperties": false
                      },
                      {
                        "type": "object",
                        "properties": {
                          "aggregateType": {
                            "type": "string",
                            "const": "SessionMessage"
                          },
                          "projectId": {
                            "type": "string",
                            "minLength": 1
                          },
                          "workspaceId": {
                            "type": "string",
                            "minLength": 1
                          },
                          "messageId": {
                            "type": "string",
                            "minLength": 1
                          }
                        },
                        "required": [
                          "aggregateType",
                          "projectId",
                          "workspaceId",
                          "messageId"
                        ],
                        "additionalProperties": false
                      },
                      {
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
                      {
                        "type": "object",
                        "properties": {
                          "aggregateType": {
                            "type": "string",
                            "const": "PlanProposal"
                          },
                          "projectId": {
                            "type": "string",
                            "minLength": 1
                          },
                          "workspaceId": {
                            "type": "string",
                            "minLength": 1
                          },
                          "proposalId": {
                            "type": "string",
                            "minLength": 1
                          }
                        },
                        "required": [
                          "aggregateType",
                          "projectId",
                          "workspaceId",
                          "proposalId"
                        ],
                        "additionalProperties": false
                      },
                      {
                        "type": "object",
                        "properties": {
                          "aggregateType": {
                            "type": "string",
                            "const": "QueryJob"
                          },
                          "projectId": {
                            "type": "string",
                            "minLength": 1
                          },
                          "workspaceId": {
                            "type": "string",
                            "minLength": 1
                          },
                          "queryJobId": {
                            "type": "string",
                            "minLength": 1
                          }
                        },
                        "required": [
                          "aggregateType",
                          "projectId",
                          "workspaceId",
                          "queryJobId"
                        ],
                        "additionalProperties": false
                      },
                      {
                        "type": "object",
                        "properties": {
                          "aggregateType": {
                            "type": "string",
                            "const": "QueryRun"
                          },
                          "projectId": {
                            "type": "string",
                            "minLength": 1
                          },
                          "workspaceId": {
                            "type": "string",
                            "minLength": 1
                          },
                          "queryJobId": {
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
                          "workspaceId",
                          "queryJobId",
                          "runId"
                        ],
                        "additionalProperties": false
                      },
                      {
                        "type": "object",
                        "properties": {
                          "aggregateType": {
                            "type": "string",
                            "const": "QueryJobAnswer"
                          },
                          "projectId": {
                            "type": "string",
                            "minLength": 1
                          },
                          "workspaceId": {
                            "type": "string",
                            "minLength": 1
                          },
                          "queryJobId": {
                            "type": "string",
                            "minLength": 1
                          },
                          "answerId": {
                            "type": "string",
                            "minLength": 1
                          }
                        },
                        "required": [
                          "aggregateType",
                          "projectId",
                          "workspaceId",
                          "queryJobId",
                          "answerId"
                        ],
                        "additionalProperties": false
                      }
                    ]
                  },
                  "revision": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 9007199254740991
                  }
                },
                "required": [
                  "ref",
                  "revision"
                ],
                "additionalProperties": false
              }
            },
            "goalBases": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "goalRef": {
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
                  },
                  "workspaceRef": {
                    "type": "object",
                    "properties": {
                      "aggregateType": {
                        "type": "string",
                        "const": "Workspace"
                      },
                      "projectId": {
                        "type": "string",
                        "minLength": 1
                      },
                      "workspaceId": {
                        "type": "string",
                        "minLength": 1
                      }
                    },
                    "required": [
                      "aggregateType",
                      "projectId",
                      "workspaceId"
                    ],
                    "additionalProperties": false
                  },
                  "objective": {
                    "type": "string"
                  },
                  "activePlanRef": {
                    "anyOf": [
                      {
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
                      {
                        "type": "null"
                      }
                    ]
                  },
                  "settings": {
                    "type": "object",
                    "properties": {
                      "schemaVersion": {
                        "type": "number",
                        "const": 1
                      },
                      "autonomy": {
                        "type": "string",
                        "enum": [
                          "every_step",
                          "after_plan_confirmation"
                        ]
                      },
                      "order": {
                        "type": "integer",
                        "minimum": -9007199254740991,
                        "maximum": 9007199254740991
                      },
                      "waitForGoalRef": {
                        "anyOf": [
                          {
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
                          },
                          {
                            "type": "null"
                          }
                        ]
                      },
                      "parallelRisks": {
                        "type": "array",
                        "items": {
                          "type": "object",
                          "properties": {
                            "otherGoalRef": {
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
                            },
                            "selfPlanRef": {
                              "anyOf": [
                                {
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
                                {
                                  "type": "null"
                                }
                              ]
                            },
                            "otherPlanRef": {
                              "anyOf": [
                                {
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
                                {
                                  "type": "null"
                                }
                              ]
                            }
                          },
                          "required": [
                            "otherGoalRef",
                            "selfPlanRef",
                            "otherPlanRef"
                          ],
                          "additionalProperties": false
                        }
                      }
                    },
                    "required": [
                      "schemaVersion",
                      "autonomy",
                      "order",
                      "waitForGoalRef",
                      "parallelRisks"
                    ],
                    "additionalProperties": false
                  }
                },
                "required": [
                  "goalRef",
                  "workspaceRef",
                  "objective",
                  "activePlanRef",
                  "settings"
                ],
                "additionalProperties": false
              }
            }
          },
          "required": [
            "kind",
            "key",
            "subject",
            "pins"
          ],
          "additionalProperties": false
        }
      },
      "required": [
        "source"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "record_decision_application",
    "description": "User decision: record_decision_application",
    "inputSchema": {
      "$schema": "https://json-schema.org/draft/2020-12/schema",
      "type": "object",
      "properties": {
        "messageRef": {
          "type": "object",
          "properties": {
            "aggregateType": {
              "type": "string",
              "const": "SessionMessage"
            },
            "projectId": {
              "type": "string",
              "minLength": 1
            },
            "workspaceId": {
              "type": "string",
              "minLength": 1
            },
            "messageId": {
              "type": "string",
              "minLength": 1
            }
          },
          "required": [
            "aggregateType",
            "projectId",
            "workspaceId",
            "messageId"
          ],
          "additionalProperties": false
        },
        "receipt": {
          "type": "object",
          "properties": {
            "identityKey": {
              "type": "string",
              "minLength": 1
            },
            "fingerprint": {
              "type": "string",
              "minLength": 1
            },
            "cursor": {
              "type": "string",
              "minLength": 1
            }
          },
          "required": [
            "identityKey",
            "fingerprint",
            "cursor"
          ],
          "additionalProperties": false
        }
      },
      "required": [
        "messageRef",
        "receipt"
      ],
      "additionalProperties": false
    }
  }
];

const changedDescriptions = {
  send_session_message: 'PC2-W changed send_session_message description',
  read_session_inbox: 'PC2-W changed read_session_inbox description',
  read_session_message: 'PC2-W changed read_session_message description',
  read_session_message_body: 'PC2-W changed read_session_message_body description',
  ack_session_message: 'PC2-W changed ack_session_message description',
  respond_session_message: 'PC2-W changed respond_session_message description',
  send_user_message: 'PC2-W changed send_user_message description',
  read_user_decision: 'PC2-W changed read_user_decision description',
  record_decision_application: 'PC2-W changed record_decision_application description',
} as const;
const changed: Texts = Object.fromEntries(
  Object.entries(changedDescriptions).map(([name, description]) => [name, { description, parameters: {} }]),
);

it('PC2-W-communication-tools carries all nine changed descriptions', () => {
  const tools = definitions(changed);
  expect(Object.fromEntries(tools.map(tool => [tool.name, tool.description]))).toEqual(changedDescriptions);
});

it('PC2-W-communication-tools falls back per tool to the hand-written platform specification', () => {
  const tools = definitions({ send_session_message: changed['send_session_message']! });
  expect(tools.find(tool => tool.name === 'send_session_message')?.description).toBe('PC2-W changed send_session_message description');
  for (const name of Object.keys(changedDescriptions)) {
    if (name === 'send_session_message') continue;
    const actual = specification(tools).find(tool => tool.name === name)!;
    const expected = DEFAULT_SPECIFICATION.find(tool => tool.name === name)!;
    expect(actual.description).toBe(expected.description);
    expect(JSON.stringify(actual)).toBe(JSON.stringify(expected));
  }
});

it('PC2-W-communication-tools default texts and explicit platform texts match the hand-written specification with the 6B-1 subject contract', () => {
  const baseline = JSON.stringify(DEFAULT_SPECIFICATION);
  expect(JSON.stringify(specification(definitions()))).toBe(baseline);
  expect(JSON.stringify(specification(definitions(PLATFORM_PROMPT_PACK_V1.tools)))).toBe(baseline);
  expect(specification(definitions())).toEqual(specification(definitions(PLATFORM_PROMPT_PACK_V1.tools)));
});
