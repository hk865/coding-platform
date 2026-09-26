import { validateToolDefinition } from "../schemas/tool-schemas.js";
const OMITTED_MODEL_SCHEMA_KEYS = new Set(["$schema", "minLength", "maxLength"]);
function schemaRecord(value) {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value
        : null;
}
function compatibleModelSchema(value) {
    if (Array.isArray(value))
        return value.map((item) => compatibleModelSchema(item));
    if (!value || typeof value !== "object")
        return value;
    const result = {};
    for (const [key, child] of Object.entries(value)) {
        if (OMITTED_MODEL_SCHEMA_KEYS.has(key))
            continue;
        if (key === "oneOf") {
            result["anyOf"] = compatibleModelSchema(child);
        }
        else if (key === "const") {
            result["enum"] = [compatibleModelSchema(child)];
        }
        else {
            result[key] = compatibleModelSchema(child);
        }
    }
    return result;
}
function mergePropertySchemas(variants) {
    const unique = [...new Map(variants.map((value) => [JSON.stringify(value), value])).values()];
    if (unique.length === 1)
        return unique[0];
    const records = unique.map((value) => schemaRecord(value));
    if (records.every((record) => record?.["type"] === "string" && Array.isArray(record["enum"]))) {
        return {
            type: "string",
            enum: [...new Set(records.flatMap((record) => record?.["enum"]))],
        };
    }
    return { anyOf: unique };
}
function objectRootModelSchema(value) {
    const schema = schemaRecord(value);
    const variants = schema?.["anyOf"];
    if (!Array.isArray(variants) || variants.length === 0)
        return value;
    const records = variants.map((variant) => schemaRecord(variant));
    if (records.some((record) => record?.["type"] !== "object"))
        return value;
    const propertiesByName = new Map();
    for (const record of records) {
        const properties = schemaRecord(record?.["properties"]);
        if (!properties)
            return value;
        for (const [name, propertySchema] of Object.entries(properties)) {
            propertiesByName.set(name, [...(propertiesByName.get(name) ?? []), propertySchema]);
        }
    }
    const requiredLists = records.map((record) => Array.isArray(record?.["required"]) ? record["required"] : []);
    const required = requiredLists[0]?.filter((name) => typeof name === "string" && requiredLists.every((names) => names.includes(name)));
    return {
        type: "object",
        properties: Object.fromEntries([...propertiesByName].map(([name, propertySchemas]) => [
            name,
            mergePropertySchemas(propertySchemas),
        ])),
        ...(required && required.length > 0 ? { required } : {}),
        additionalProperties: false,
    };
}
function schemaForModel(definition) {
    const candidate = definition.inputSchema;
    if (typeof candidate.toJSONSchema === "function") {
        const generated = candidate.toJSONSchema();
        if (generated && typeof generated === "object" && !Array.isArray(generated)) {
            return objectRootModelSchema(compatibleModelSchema(generated));
        }
    }
    return { type: "object", additionalProperties: false };
}
export class ToolRegistrySnapshot {
    #definitions;
    constructor(definitions) {
        this.#definitions = new Map(definitions.map((definition) => [definition.name, definition]));
    }
    resolve(name) {
        return this.#definitions.get(name);
    }
    list() {
        return [...this.#definitions.values()];
    }
    modelToolSpecs() {
        return this.list()
            .map((definition) => ({
            name: definition.name,
            description: definition.description,
            inputSchema: schemaForModel(definition),
        }))
            .sort((left, right) => left.name.localeCompare(right.name));
    }
}
export class ToolRegistry {
    #definitions = new Map();
    #frozen = false;
    register(definition) {
        if (this.#frozen)
            throw new Error("ToolRegistry 冻结后不能继续注册");
        validateToolDefinition(definition);
        if (this.#definitions.has(definition.name))
            throw new Error(`工具 ${definition.name} 重复注册`);
        this.#definitions.set(definition.name, definition);
    }
    freeze(enabledNames) {
        if (this.#frozen)
            throw new Error("ToolRegistry 只能冻结一次");
        this.#frozen = true;
        const names = new Set(enabledNames);
        if (names.size !== enabledNames.length)
            throw new Error("enabled tool name 不能重复");
        const definitions = enabledNames.map((name) => {
            const definition = this.#definitions.get(name);
            if (!definition)
                throw new Error(`无法启用未注册工具 ${name}`);
            return definition;
        });
        return new ToolRegistrySnapshot(definitions);
    }
}
export class RegistryToolBatchPolicy {
    snapshot;
    constructor(snapshot) {
        this.snapshot = snapshot;
    }
    plan(calls) {
        const allIndependentReadOnly = calls.every((call) => {
            const definition = this.snapshot.resolve(call.name);
            return definition?.effectClass === "read_only" && definition.independentReadOnly;
        });
        if (allIndependentReadOnly && calls.length > 1) {
            return [{ mode: "parallel_read_only", callIds: calls.map((call) => call.callId) }];
        }
        return calls.map((call) => ({ mode: "serial", callIds: [call.callId] }));
    }
}
//# sourceMappingURL=tool-registry.js.map