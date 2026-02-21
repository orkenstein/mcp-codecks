import fs from "fs";
import path from "path";

export type SchemaCardinality = "one" | "many";

export interface SchemaRelation {
  type: string;
  cardinality: SchemaCardinality;
}

export interface SchemaModel {
  type: "model" | "root";
  fields: Record<string, string>;
  relations: Record<string, SchemaRelation>;
  quirks?: Record<string, unknown>;
}

export interface CodecksApiSchema {
  models: Record<string, SchemaModel>;
  queryOperators?: Record<string, unknown>;
  specialQueryFields?: Record<string, unknown>;
  responseFormat?: Record<string, unknown>;
}

let cachedSchema: CodecksApiSchema | null = null;
export function resetSchemaCache() {
  cachedSchema = null;
}

export function loadSchema(): CodecksApiSchema {
  if (cachedSchema) {
    return cachedSchema;
  }

  const preferSource = process.env.NODE_ENV !== "production";
  const candidates = preferSource
    ? [
        path.join(process.cwd(), "src", "schemas", "codecks-api-schema.json"),
        path.join(process.cwd(), "dist", "schemas", "codecks-api-schema.json")
      ]
    : [
        path.join(process.cwd(), "dist", "schemas", "codecks-api-schema.json"),
        path.join(process.cwd(), "src", "schemas", "codecks-api-schema.json")
      ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      const raw = fs.readFileSync(candidate, "utf8");
      cachedSchema = JSON.parse(raw) as CodecksApiSchema;
      return cachedSchema;
    }
  }

  throw new Error(
    "Codecks API schema not found. Run `npm run generate:schema` and rebuild."
  );
}
