import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CodecksClient } from "../services/codecks-client.js";
import { ResponseFormat } from "../types.js";
import { DEFAULT_LIMIT, MAX_LIMIT } from "../constants.js";
import { ResponseFormatSchema } from "../schemas/tool-schemas.js";
import {
  buildIdQuery,
  buildRelationKey,
  denormalizeById,
  denormalizeRootRelation,
  validateSelection,
  type Selection
} from "./query-builder.js";
import type { CodecksApiSchema } from "./schema.js";

type RegisterAutoToolsOptions = {
  server: McpServer;
  schema: CodecksApiSchema;
  getClient: () => CodecksClient;
  formatError: (error: unknown) => string;
  skipModels?: Set<string>;
  existingToolNames?: Set<string>;
};

const AutoListSchema = z.object({
  limit: z.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  offset: z.number().int().min(0).default(0),
  order_by: z.string().optional().describe("Field to order by"),
  order_desc: z.boolean().default(true).describe("Whether to order descending"),
  filters: z.record(z.any()).optional().describe("Filter object for the query"),
  selection: z.array(z.any()).optional().describe("Selection array (fields/relations)"),
  response_format: ResponseFormatSchema
}).strict();

const AutoGetSchema = z.object({
  id: z.string().describe("Model ID"),
  selection: z.array(z.any()).optional().describe("Selection array (fields/relations)"),
  response_format: ResponseFormatSchema
}).strict();

function toSnake(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/__+/g, "_")
    .toLowerCase();
}

function getDefaultSelection(schema: CodecksApiSchema, modelName: string): Selection[] {
  const model = schema.models[modelName];
  if (!model) {
    return [];
  }
  const preferred = ["id", "name", "title", "accountSeq", "createdAt", "lastUpdatedAt", "status"];
  const fields = Object.keys(model.fields);
  const picks = preferred.filter((field) => fields.includes(field));

  if (picks.length > 0) {
    return picks;
  }

  if (fields.length > 0) {
    return fields.slice(0, 5);
  }

  const relations = Object.keys(model.relations);
  return relations.slice(0, 3);
}

function parseSelection(input: unknown, fallback: Selection[]): Selection[] {
  if (!input) {
    return fallback;
  }
  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input);
      return Array.isArray(parsed) ? parsed : fallback;
    } catch {
      return fallback;
    }
  }
  return Array.isArray(input) ? (input as Selection[]) : fallback;
}

function chooseOrderField(schema: CodecksApiSchema, modelName: string): string | undefined {
  const model = schema.models[modelName];
  if (!model) {
    return undefined;
  }
  const fields = Object.keys(model.fields);
  const candidates = ["createdAt", "lastUpdatedAt", "name", "title", "accountSeq"];
  return candidates.find((field) => fields.includes(field));
}

function findRootRelation(schema: CodecksApiSchema, modelName: string): string | null {
  const root = schema.models._root;
  if (!root) {
    return null;
  }
  for (const [relName, relInfo] of Object.entries(root.relations || {})) {
    if (relInfo.type === modelName) {
      return relName;
    }
  }
  return null;
}

function findAccountRelation(schema: CodecksApiSchema, modelName: string): string | null {
  const account = schema.models.account;
  if (!account) {
    return null;
  }
  for (const [relName, relInfo] of Object.entries(account.relations || {})) {
    if (relInfo.type === modelName) {
      return relName;
    }
  }
  return null;
}

function formatGeneric(modelName: string, data: any, format: ResponseFormat): string {
  if (format === ResponseFormat.JSON) {
    return JSON.stringify(data, null, 2);
  }
  const header = `# ${modelName}`;
  return `${header}\n\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``;
}

function formatGenericList(modelName: string, items: any[], format: ResponseFormat): string {
  if (format === ResponseFormat.JSON) {
    return JSON.stringify({ items }, null, 2);
  }
  const lines = [`# ${modelName} list`, ""];
  for (const item of items) {
    lines.push("```json");
    lines.push(JSON.stringify(item, null, 2));
    lines.push("```");
    lines.push("");
  }
  return lines.join("\n");
}

export function registerAutoTools(options: RegisterAutoToolsOptions) {
  const { server, schema, getClient, formatError } = options;
  const skipModels = options.skipModels ?? new Set<string>();
  const existingToolNames = options.existingToolNames ?? new Set<string>();

  const modelNames = Object.keys(schema.models)
    .filter((name) => name !== "_root")
    .filter((name) => !skipModels.has(name));

  for (const modelName of modelNames) {
    const snake = toSnake(modelName);
    const listTool = `codecks_list_${snake}`;
    const getTool = `codecks_get_${snake}`;

    if (!existingToolNames.has(listTool)) {
      const model = schema.models[modelName];
      const fields = Object.keys(model.fields || {});
      const relations = Object.keys(model.relations || {});
      const availableFields = [...fields.slice(0, 8), ...(fields.length > 8 ? ["..."] : [])];
      const fieldsDesc = availableFields.length > 0 ? `\n\nAvailable fields: ${availableFields.join(", ")}` : "";
      const relationsDesc = relations.length > 0 ? `\nRelations: ${relations.slice(0, 5).join(", ")}${relations.length > 5 ? ", ..." : ""}` : "";
      const exampleField = fields[1] || "fieldName";
      const filterExample = fields.includes("id") ? `\n\nExample filters: {"${exampleField}": "value"}` : "";
      
      server.registerTool(
        listTool,
        {
          title: `List ${modelName}`,
          description: `List ${modelName} items with optional filters and selection.${fieldsDesc}${relationsDesc}${filterExample}`,
          inputSchema: AutoListSchema,
          annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true
          }
        },
        async (params: any) => {
          try {
            const client = getClient();
            const selection = parseSelection(
              params.selection,
              getDefaultSelection(schema, modelName)
            );
            const orderField = params.order_by || chooseOrderField(schema, modelName);
            const filters = { ...(params.filters || {}) };
            if (orderField) {
              filters.$order = params.order_desc ? `-${orderField}` : orderField;
              filters.$limit = params.limit;
              filters.$offset = params.offset;
            }

            const rootRelation = findRootRelation(schema, modelName);
            if (rootRelation) {
              const query = {
                _root: [
                  {
                    [buildRelationKey(rootRelation, filters)]: selection
                  }
                ]
              };
              const response = await client.query(query);
              const items = denormalizeRootRelation(schema, response, rootRelation, selection) || [];
              const formatted = formatGenericList(modelName, items, params.response_format);
              return {
                content: [{ type: "text", text: formatted }],
                structuredContent: params.response_format === ResponseFormat.JSON ? { items } : undefined
              };
            }

            const accountRelation = findAccountRelation(schema, modelName);
            if (accountRelation) {
              const relationKey = buildRelationKey(accountRelation, filters);
              const accountSelection: Selection[] = [{ [relationKey]: selection }];
              validateSelection(schema, "account", accountSelection);
              const query = {
                _root: [
                  {
                    account: accountSelection
                  }
                ]
              };
              const response = await client.query(query);
              const account = denormalizeRootRelation(schema, response, "account", accountSelection);
              const items = account?.[accountRelation] || [];
              const formatted = formatGenericList(modelName, items, params.response_format);
              return {
                content: [{ type: "text", text: formatted }],
                structuredContent: params.response_format === ResponseFormat.JSON ? { items } : undefined
              };
            }

            return {
              content: [
                {
                  type: "text",
                  text: `Error: No root or account relation found for model '${modelName}'.`
                }
              ]
            };
          } catch (error) {
            return {
              content: [{ type: "text", text: formatError(error) }]
            };
          }
        }
      );
      existingToolNames.add(listTool);
    }

    if (!existingToolNames.has(getTool)) {
      server.registerTool(
        getTool,
        {
          title: `Get ${modelName}`,
          description: `Auto-generated get tool for ${modelName}.`,
          inputSchema: AutoGetSchema,
          annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true
          }
        },
        async (params: any) => {
          try {
            const client = getClient();
            const selection = parseSelection(
              params.selection,
              getDefaultSelection(schema, modelName)
            );
            const query = buildIdQuery(schema, modelName, params.id, selection);
            const response = await client.query(query);
            const item = denormalizeById(schema, response, modelName, params.id, selection);
            if (!item) {
              return {
                content: [{ type: "text", text: `Error: ${modelName} '${params.id}' not found.` }]
              };
            }
            const formatted = formatGeneric(modelName, item, params.response_format);
            return {
              content: [{ type: "text", text: formatted }],
              structuredContent: params.response_format === ResponseFormat.JSON ? item : undefined
            };
          } catch (error) {
            return {
              content: [{ type: "text", text: formatError(error) }]
            };
          }
        }
      );
      existingToolNames.add(getTool);
    }
  }
}
