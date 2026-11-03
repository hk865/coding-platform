/** PC-2 row PC-24 (W): `createNoteTools` takes the platform tool texts as input. */
import { expect, it } from 'vitest';
import { toolSchema as z, type ToolDefinition } from '../../vendor/coding-agent/dist/public-api.js';
import { PLATFORM_PROMPT_PACK_V1 } from '../../src/contracts/prompts/platform-pack.generated.js';
import { createNoteTools } from '../../src/core/agent-runtime/note-tool.js';

type Texts = Readonly<Record<string, { description: string; parameters: Readonly<Record<string, string>> }>>;
type ToolSpecification = { name: string; description: string; inputSchema: unknown };
const context = { projectId: 'p', workspaceId: 'w', principal: {}, materialReader: {}, signal: new AbortController().signal } as never;
const definition = (texts?: Texts): ToolDefinition =>
  createNoteTools({ context, notes: {} as never, check: {} as never, requestIdForCall: () => 'r',
    kinds: ['convention', 'pitfall', 'tradeoff', 'open_question', 'preference', 'decision', 'understanding', 'repair', 'link', 'flow'],
    withdraw: true, ...(texts === undefined ? {} : { texts }) })
    .create({} as never)[0]!;
const specification = (tool: ToolDefinition) => ({ name: tool.name, description: tool.description, inputSchema: z.toJSONSchema(tool.inputSchema) });

/**
 * The current `record_note` specification, one JSON literal. The description is
 * the byte content of `resources/prompts/platform/tools/record_note.json`; the
 * input schema shape, key order and constraints come from
 * `src/core/agent-runtime/note-tool.ts`; `parameters` stays empty.
 */
const DEFAULT_SPECIFICATION: ToolSpecification = {
  "name": "record_note",
  "description": "Record a note: `{ op: \"write\" | \"review\" | \"withdraw\", ... }`. Write at task end, rework, plan adoption or archive (MVP B09). Before writing, look first: use the memory `lookup` branch for the existing `topics` of the anchor and the `find` branch, and reuse an existing topic. Anchor so the note still holds if this task is cancelled tomorrow (otherwise anchor on architecture). Pick one of the ten kinds: `convention`, `pitfall`, `tradeoff`, `open_question`, `preference`, `decision`, `understanding`, `repair`, `link`, `flow`. An `understanding` gives `sections` (`status`, `decided`, `open`, `next`, `risks`, each non-empty) and no `body`, and hangs only on a goal or a stage (only the project scribe writes the project's understanding); every other kind gives `body`. A `link` records a relation the scan cannot see: `anchor` is the `from` end, `extraAnchors` is `[to, via?]` (`via` is required for `injects` and `callback`, optional otherwise), and the direction is from → to. `injects`: `from` uses the slot `via`, which is filled at runtime with `to`'s implementation; `callback`: `to` hands its function to `from`, and `from` calls back through `via`. `data`/`message`: `from` emits/sends and `to` receives; `spawns`: `from` launches the `to` entry. Give function-level ends where possible. The relation is one of `calls`, `injects`, `callback`, `data`, `message` or `spawns`. Give at least one evidence item for each role the relation requires, and no role outside the table: `injects`/`callback` use `use` and `wire`; `calls` uses `register` and `use`; `data`/`message` use `emit` and `receive`; `spawns` uses `launch` and `entry`. Each item gives `at.path` and at most one of `at.range` or `at.symbolRequest` (its declaration ranges; lines count from 1), never both; the platform looks only there, and with neither it uses the whole file. Each role must find: `injects.use` references `via`, `injects.wire` references `to` and `via`; `callback.wire` references `to` and `via`, `callback.use` references `via`; `calls.register` has the `key` and references `to`, `calls.use` has the `key`; `data`/`message` both roles have the `key` (`emit` writes/sends, `receive` reads/receives); `spawns` both roles have the `key` (`entry` is `to`'s entry declaration). `use`, `emit` and `launch` must fall in the `from` end, `receive` in the `to` end, `entry` in the `to` end's module; `wire` and `register` may be anywhere. Give the shared name as `key` (a literal or symbol request; omit it for `injects` and `callback`; `spawns` takes a literal or `null`; use `null` when the name is built at runtime). Evidence is co-occurrence inside the given range, not proof of wiring; a runtime branch or a configuration choice is not proved. A missing or outside evidence item is refused with `evidenceIndexes`; correct exactly those items and retry. A `flow` records ordered steps by `noteId`: write the steps first, then the flow; give 2–20 distinct steps that are current (`accepted` or `reviewed`) links of this project and a first step whose `from` is the flow's anchor; a superseded step reads `not_current` and the flow is not rewritten. Keep the conclusion to one line; facts are pointers only, never copied text. A fact is `{ kind: \"file\", path, digest }` (`digest` is the `revision` your `read` result gave for that file; after you edit the file, use the `newRevision` from the `edit` result), `{ kind: \"note\", noteId, version }`, `{ kind: \"commit\", sha }`, or a `record`, `artifact` or `kernel_history` source copied unchanged from your context. When the note only rests on some files, list their paths in `basisFiles` instead. Close an `open_question` with the `decision` that points at it via `replaces`. `write` stores your draft (the platform resolves plan/catalog revisions, the stage anchor plan revision, file symbol locators and basis-file digests from this execution; never send them) and returns `{ write, check }`; read the `check` result and fix what it reports. `review` (the scribe) reviews/accepts/rejects, with an optional `resolution: \"supersede\" | \"coexist\"` when resolving live contradictions; `withdraw` withdraws a note you may withdraw. Only items with `currentEligible: true` are current conclusions. Authority is enforced by the note service. For `kind: \"repair\"`, `repair` takes `{ pin, ops, responsibilityMoves }`; the platform computes `structural` and resolves the anchor facts, so send only the pin, the ordered ops and the moves — never a derived `structural`.",
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
              "repair",
              "link",
              "flow"
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
              "oneOf": [
                {
                  "type": "object",
                  "properties": {
                    "kind": {
                      "type": "string",
                      "const": "record"
                    }
                  },
                  "required": [
                    "kind"
                  ],
                  "additionalProperties": {}
                },
                {
                  "type": "object",
                  "properties": {
                    "kind": {
                      "type": "string",
                      "const": "artifact"
                    }
                  },
                  "required": [
                    "kind"
                  ],
                  "additionalProperties": {}
                },
                {
                  "type": "object",
                  "properties": {
                    "kind": {
                      "type": "string",
                      "const": "kernel_history"
                    }
                  },
                  "required": [
                    "kind"
                  ],
                  "additionalProperties": {}
                },
                {
                  "type": "object",
                  "properties": {
                    "kind": {
                      "type": "string",
                      "const": "note"
                    },
                    "noteId": {
                      "type": "string",
                      "minLength": 1
                    },
                    "version": {
                      "type": "integer",
                      "minimum": 1,
                      "maximum": 9007199254740991
                    }
                  },
                  "required": [
                    "kind",
                    "noteId",
                    "version"
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
                    "digest": {
                      "type": "string"
                    }
                  },
                  "required": [
                    "kind",
                    "path",
                    "digest"
                  ],
                  "additionalProperties": false
                },
                {
                  "type": "object",
                  "properties": {
                    "kind": {
                      "type": "string",
                      "const": "commit"
                    },
                    "sha": {
                      "type": "string"
                    }
                  },
                  "required": [
                    "kind",
                    "sha"
                  ],
                  "additionalProperties": false
                }
              ]
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
          "repair": {
            "type": "object",
            "properties": {
              "pin": {
                "type": "object",
                "properties": {
                  "catalogRef": {
                    "type": "object",
                    "properties": {
                      "aggregateType": {
                        "type": "string",
                        "const": "ArchitectureCatalog"
                      },
                      "projectId": {
                        "type": "string",
                        "minLength": 1
                      },
                      "baselineId": {
                        "type": "string",
                        "minLength": 1
                      },
                      "revision": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": 9007199254740991
                      }
                    },
                    "required": [
                      "aggregateType",
                      "projectId",
                      "baselineId",
                      "revision"
                    ],
                    "additionalProperties": false
                  },
                  "baseline": {
                    "type": "object",
                    "properties": {
                      "ref": {
                        "type": "object",
                        "properties": {
                          "aggregateType": {
                            "type": "string",
                            "const": "ArchitectureBaselineRevision"
                          },
                          "projectId": {
                            "type": "string",
                            "minLength": 1
                          },
                          "baselineId": {
                            "type": "string",
                            "minLength": 1
                          },
                          "revision": {
                            "type": "integer",
                            "minimum": 1,
                            "maximum": 9007199254740991
                          }
                        },
                        "required": [
                          "aggregateType",
                          "projectId",
                          "baselineId",
                          "revision"
                        ],
                        "additionalProperties": false
                      },
                      "digest": {
                        "type": "string",
                        "minLength": 1
                      }
                    },
                    "required": [
                      "ref",
                      "digest"
                    ],
                    "additionalProperties": false
                  }
                },
                "required": [
                  "catalogRef",
                  "baseline"
                ],
                "additionalProperties": false
              },
              "ops": {
                "minItems": 1,
                "maxItems": 20,
                "type": "array",
                "items": {
                  "type": "object",
                  "propertyNames": {
                    "type": "string"
                  },
                  "additionalProperties": {}
                }
              },
              "responsibilityMoves": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "link": {
                      "type": "object",
                      "propertyNames": {
                        "type": "string"
                      },
                      "additionalProperties": {}
                    },
                    "to": {
                      "oneOf": [
                        {
                          "type": "object",
                          "properties": {
                            "kind": {
                              "type": "string",
                              "const": "standby"
                            }
                          },
                          "required": [
                            "kind"
                          ],
                          "additionalProperties": false
                        },
                        {
                          "type": "object",
                          "properties": {
                            "kind": {
                              "type": "string",
                              "const": "modules"
                            },
                            "destinations": {
                              "type": "array",
                              "items": {
                                "type": "object",
                                "propertyNames": {
                                  "type": "string"
                                },
                                "additionalProperties": {}
                              }
                            }
                          },
                          "required": [
                            "kind",
                            "destinations"
                          ],
                          "additionalProperties": false
                        }
                      ]
                    }
                  },
                  "required": [
                    "link",
                    "to"
                  ],
                  "additionalProperties": false
                }
              }
            },
            "required": [
              "pin",
              "ops",
              "responsibilityMoves"
            ],
            "additionalProperties": false
          },
          "link": {
            "type": "object",
            "properties": {
              "relation": {
                "type": "string",
                "enum": [
                  "calls",
                  "injects",
                  "callback",
                  "data",
                  "message",
                  "spawns"
                ]
              },
              "key": {
                "anyOf": [
                  {
                    "anyOf": [
                      {
                        "type": "object",
                        "properties": {
                          "kind": {
                            "type": "string",
                            "const": "symbol"
                          },
                          "anchor": {
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
                              }
                            },
                            "required": [
                              "kind",
                              "path",
                              "symbolRequest"
                            ],
                            "additionalProperties": false
                          }
                        },
                        "required": [
                          "kind",
                          "anchor"
                        ],
                        "additionalProperties": false
                      },
                      {
                        "type": "object",
                        "properties": {
                          "kind": {
                            "type": "string",
                            "const": "literal"
                          },
                          "text": {
                            "type": "string",
                            "minLength": 1
                          }
                        },
                        "required": [
                          "kind",
                          "text"
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
              "evidence": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "role": {
                      "type": "string",
                      "enum": [
                        "use",
                        "wire",
                        "register",
                        "emit",
                        "receive",
                        "launch",
                        "entry"
                      ]
                    },
                    "at": {
                      "type": "object",
                      "properties": {
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
                        "path"
                      ],
                      "additionalProperties": false
                    }
                  },
                  "required": [
                    "role",
                    "at"
                  ],
                  "additionalProperties": false
                }
              }
            },
            "required": [
              "relation",
              "evidence"
            ],
            "additionalProperties": false
          },
          "flow": {
            "type": "object",
            "properties": {
              "steps": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "link": {
                      "type": "string",
                      "minLength": 1
                    }
                  },
                  "required": [
                    "link"
                  ],
                  "additionalProperties": false
                }
              }
            },
            "required": [
              "steps"
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
