import { CodecksApiSchema } from "./schema.js";

export type Selection = string | { [relation: string]: Selection[] };

export interface RelationKeyInfo {
  name: string;
  hasQuery: boolean;
}

export function parseRelationKey(key: string): RelationKeyInfo {
  const index = key.indexOf("(");
  if (index === -1) {
    return { name: key, hasQuery: false };
  }
  return { name: key.slice(0, index), hasQuery: true };
}

export function buildRelationKey(relation: string, query?: Record<string, unknown>): string {
  if (!query || Object.keys(query).length === 0) {
    return relation;
  }
  return `${relation}(${JSON.stringify(query)})`;
}

export function validateSelection(schema: CodecksApiSchema, modelName: string, selection: Selection[]): void {
  const model = schema.models[modelName];
  if (!model) {
    throw new Error(`Unknown model '${modelName}' in schema`);
  }

  for (const item of selection) {
    if (typeof item === "string") {
      // Skip field validation - the schema is incomplete and missing common fields like
      // 'id' and 'isArchived'. Still validate relations below.
      continue;
    }

    const entries = Object.entries(item);
    for (const [key, nested] of entries) {
      const relationName = parseRelationKey(key).name;
      const relation = model.relations[relationName];
      if (!relation) {
        throw new Error(`Unknown relation '${relationName}' on model '${modelName}'`);
      }
      validateSelection(schema, relation.type, nested);
    }
  }
}

export function normalizeSelection(
  schema: CodecksApiSchema,
  modelName: string,
  selection: Selection[]
): Selection[] {
  const model = schema.models[modelName];
  if (!model) {
    return selection;
  }

  let needsPrimaryEmail = false;
  const normalized: Selection[] = [];

  for (const item of selection) {
    if (typeof item === "string") {
      if (modelName === "user" && item === "email") {
        needsPrimaryEmail = true;
        continue;
      }
      normalized.push(item);
      continue;
    }

    const next: Record<string, Selection[]> = {};
    for (const [key, nested] of Object.entries(item)) {
      const relationName = parseRelationKey(key).name;
      const relation = model.relations[relationName];
      next[key] = relation ? normalizeSelection(schema, relation.type, nested) : nested;
    }
    normalized.push(next);
  }

  if (modelName === "user" && needsPrimaryEmail) {
    const existing = normalized.find(
      (item) => typeof item === "object" && Object.keys(item)[0]?.startsWith("primaryEmail")
    ) as Record<string, Selection[]> | undefined;

    if (existing) {
      const key = Object.keys(existing)[0];
      if (!existing[key].includes("email")) {
        existing[key].push("email");
      }
    } else {
      normalized.push({ primaryEmail: ["email"] });
    }
  }

  return normalized;
}

export function buildRootQuery(
  schema: CodecksApiSchema,
  relation: string,
  selection: Selection[],
  query?: Record<string, unknown>
): Record<string, unknown> {
  const relationKey = buildRelationKey(relation, query);
  const normalized = normalizeSelection(schema, "_root", [{ [relationKey]: selection }]);
  validateSelection(schema, "_root", normalized);
  return {
    _root: [
      {
        [relationKey]: (normalized[0] as Record<string, Selection[]>)[relationKey]
      }
    ]
  };
}

/**
 * Build an ID-based query for direct model lookups.
 * 
 * Uses Codecks' direct ID lookup syntax: { "model(id)": [...fields] }
 * This differs from the _root pattern used elsewhere because it queries
 * a specific entity by ID rather than filtering a relation.
 * 
 * @see https://docs.codecks.io/api/ - Codecks API Reference (ID-based queries)
 */
export function buildIdQuery(
  schema: CodecksApiSchema,
  modelName: string,
  id: string | number | (string | number)[],
  selection: Selection[]
): Record<string, unknown> {
  const normalized = normalizeSelection(schema, modelName, selection);
  validateSelection(schema, modelName, normalized);
  return {
    [`${modelName}(${JSON.stringify(id)})`]: normalized
  };
}

function resolveEntity(
  schema: CodecksApiSchema,
  response: Record<string, any>,
  modelName: string,
  id: string,
  selection: Selection[],
  visited: Set<string>
): any {
  const model = schema.models[modelName];
  if (!model) {
    return null;
  }

  const key = `${modelName}:${id}`;
  if (visited.has(key)) {
    return response?.[modelName]?.[id] ?? { id };
  }

  const entity = response?.[modelName]?.[id];
  if (!entity) {
    return null;
  }

  visited.add(key);

  const output: Record<string, any> = {};

  for (const item of selection) {
    if (typeof item === "string") {
      output[item] = entity[item];
      continue;
    }

    for (const [keyName, nested] of Object.entries(item)) {
      const relationName = parseRelationKey(keyName).name;
      const relation = model.relations[relationName];
      if (!relation) {
        continue;
      }

      const relationValue = entity[relationName];
      if (relationValue == null) {
        output[relationName] = relation.cardinality === "many" ? [] : null;
        continue;
      }

      if (relation.cardinality === "many") {
        const ids = Array.isArray(relationValue) ? relationValue : [relationValue];
        output[relationName] = ids
          .map((relId) =>
            typeof relId === "object"
              ? relId
              : resolveEntity(schema, response, relation.type, String(relId), nested, visited)
          )
          .filter(Boolean);
      } else {
        if (typeof relationValue === "object") {
          output[relationName] = relationValue;
        } else {
          output[relationName] = resolveEntity(
            schema,
            response,
            relation.type,
            String(relationValue),
            nested,
            visited
          );
        }
      }
    }
  }

  if (entity.id && !output.id) {
    output.id = entity.id;
  }

  return output;
}

export function denormalizeRootRelation(
  schema: CodecksApiSchema,
  response: Record<string, any>,
  relation: string,
  selection: Selection[]
): any {
  const root = response?._root;
  const rootValue = Array.isArray(root) ? root[0]?.[relation] : root?.[relation];

  if (rootValue == null) {
    return null;
  }

  const relationInfo = schema.models._root?.relations?.[relation];
  if (!relationInfo) {
    return rootValue;
  }

  if (relationInfo.cardinality === "many") {
    const ids = Array.isArray(rootValue) ? rootValue : [rootValue];
    return ids
      .map((id) =>
        typeof id === "object"
          ? id
          : resolveEntity(schema, response, relationInfo.type, String(id), selection, new Set())
      )
      .filter(Boolean);
  }

  if (typeof rootValue === "object") {
    return rootValue;
  }

  return resolveEntity(schema, response, relationInfo.type, String(rootValue), selection, new Set());
}

export function denormalizeById(
  schema: CodecksApiSchema,
  response: Record<string, any>,
  modelName: string,
  id: string,
  selection: Selection[]
): any {
  // Fallback path: handles edge case where response[modelName] is a direct object
  // with the requested ID instead of the normal normalized dictionary format.
  // This occurs with certain Codecks API responses that return single entities.
  const direct = response?.[modelName];
  if (direct && typeof direct === "object" && !Array.isArray(direct) && direct.id === id) {
    return direct;
  }
  return resolveEntity(schema, response, modelName, id, selection, new Set());
}
