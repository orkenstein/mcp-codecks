import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CodecksClient } from "../services/codecks-client.js";
import { ResponseFormat } from "../types.js";
import { DEFAULT_LIMIT, MAX_LIMIT } from "../constants.js";
import { ResponseFormatSchema } from "../schemas/tool-schemas.js";
import {
  buildIdQuery,
  buildRelationKey,
  buildRootQuery,
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

type AutoToolHandler = (params: any) => Promise<any>;
type PathOrigin = "root" | "account";
type RelationPath = {
  origin: PathOrigin;
  relations: string[];
};
type RelationCardinality = "one" | "many";

const MODEL_PATH_OVERRIDES: Record<string, RelationPath[]> = {
  publicProjectInfo: [
    { origin: "account", relations: ["projects", "publicProjectInfo"] },
    { origin: "account", relations: ["decks", "project", "publicProjectInfo"] }
  ],
  milestoneProject: [
    { origin: "account", relations: ["milestones", "milestoneProjects"] },
    { origin: "account", relations: ["projects", "milestoneProjects"] }
  ]
};

const MODEL_SELECTION_OVERRIDES: Record<string, Selection[]> = {
  // activities7d and visits7d currently trigger upstream 500s; keep safe subset by default.
  publicProjectInfo: ["cardCount", "cardDoneStreak", "lastActivityAt"],
  // Relation-heavy activity selections can trigger upstream 500s; keep safe field-only defaults.
  activity: ["createdAt", "type", "data"],
  // Relation-heavy handCard selections can trigger upstream 500s; keep safe field-only defaults.
  handCard: ["sortIndex"],
  // Relation-heavy cardSubscription selections can trigger upstream 500s; keep safe field-only defaults.
  cardSubscription: ["createdAt"],
  // Requesting nested card relation fields on queueEntry can trigger upstream 500s.
  queueEntry: ["createdAt", "sortIndex", "cardDoneAt"],
  // Requesting nested card relation fields on cardUpvote can trigger upstream 500s.
  cardUpvote: ["createdAt", "type", "discordUserInfo"]
};
const MODEL_SELECTION_ALLOWLIST: Record<string, Set<string>> = {
  publicProjectInfo: new Set(["cardCount", "cardDoneStreak", "lastActivityAt"]),
  activity: new Set([
    "createdAt",
    "type",
    "data",
    "isRemovedFromDeckEntry",
    "isRemovedFromMilestoneEntry",
    "isRemovedFromSprintEntry"
  ]),
  handCard: new Set(["sortIndex"]),
  cardSubscription: new Set(["createdAt"]),
  queueEntry: new Set(["createdAt", "sortIndex", "cardDoneAt"]),
  cardUpvote: new Set(["createdAt", "type", "discordUserInfo"])
};
const MODEL_RELATION_EXPANSION_BLOCKLIST: Record<string, Set<string>> = {
  handCard: new Set(["card", "account", "user"]),
  cardSubscription: new Set(["card", "account", "user"]),
  queueEntry: new Set(["card"]),
  cardUpvote: new Set(["card"])
};
const MODEL_FORCE_CLIENT_SIDE_FILTERING = new Set(["milestoneProject"]);
const COMPATIBILITY_ALIASES: Record<string, { list: string[]; get: string[] }> = {
  activity: {
    list: ["codecks_list_activities"],
    get: ["codecks_get_activities"]
  },
  sprint: {
    list: ["codecks_list_sprints"],
    get: ["codecks_get_sprints"]
  }
};

const AutoListSchema = z.object({
  limit: z.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  offset: z.number().int().min(0).default(0),
  order_by: z.string().optional().describe("Field to order by"),
  order_desc: z.boolean().default(true).describe("Whether to order descending"),
  project_id: z.string().optional().describe("Unified project filter key (mapped to projectId internally)"),
  include_deleted: z.boolean().default(false).describe("Include deleted entities where model-specific deleted flags exist"),
  filters: z.record(z.unknown()).optional().describe("Filter object for the query"),
  selection: z.array(z.unknown()).optional().describe("Selection array (fields/relations)"),
  include_relations: z.boolean().default(false).describe("Attempt safe first-level relation expansion with guarded fallback"),
  response_format: ResponseFormatSchema
}).strict();

const AutoGetSchema = z.object({
  id: z.string().describe("Model ID"),
  selection: z.array(z.unknown()).optional().describe("Selection array (fields/relations)"),
  include_relations: z.boolean().default(false).describe("Attempt safe first-level relation expansion with guarded fallback"),
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
  const selectionOverride = MODEL_SELECTION_OVERRIDES[modelName];
  if (selectionOverride) {
    return selectionOverride;
  }
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

function normalizeFilterKeys(filters: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(filters)) {
    if (key === "project_id") {
      normalized.projectId = value;
      continue;
    }
    normalized[key] = value;
  }
  return normalized;
}

function getSafeFieldsForModel(schema: CodecksApiSchema, modelName: string): string[] {
  const model = schema.models[modelName];
  if (!model) {
    return [];
  }
  const fields = Object.keys(model.fields || {});
  const preferred = ["id", "name", "title", "accountSeq", "createdAt", "lastUpdatedAt", "status", "visibility"];
  const picked = preferred.filter((field) => fields.includes(field));
  if (picked.length > 0) {
    return picked.slice(0, 4);
  }
  return fields.slice(0, 4);
}

function withSafeRelationExpansion(
  schema: CodecksApiSchema,
  modelName: string,
  baseSelection: Selection[]
): Selection[] {
  const model = schema.models[modelName];
  if (!model) {
    return baseSelection;
  }
  const relations = Object.entries(model.relations || {});
  const additions: Selection[] = [];
  const blockedRelations = MODEL_RELATION_EXPANSION_BLOCKLIST[modelName] ?? new Set<string>();
  for (const [relationName, relationInfo] of relations) {
    if (blockedRelations.has(relationName)) {
      continue;
    }
    const safeFields = getSafeFieldsForModel(schema, relationInfo.type);
    if (safeFields.length === 0) {
      continue;
    }
    additions.push({ [relationName]: safeFields });
  }
  return [...baseSelection, ...additions];
}
function sanitizeSelectionForModel(modelName: string, selection: Selection[]): Selection[] {
  const allowlist = MODEL_SELECTION_ALLOWLIST[modelName];
  if (!allowlist) {
    return selection;
  }

  const sanitized = selection.filter(
    (item): item is string => typeof item === "string" && allowlist.has(item)
  );
  if (sanitized.length > 0) {
    return sanitized;
  }

  return (MODEL_SELECTION_OVERRIDES[modelName] ?? []) as Selection[];
}

function buildSelectionCandidates(args: {
  schema: CodecksApiSchema;
  modelName: string;
  requestedSelection: Selection[];
  sanitizedSelection: Selection[];
  includeRelations: boolean;
}): Selection[][] {
  const { schema, modelName, requestedSelection, sanitizedSelection, includeRelations } = args;
  const seen = new Set<string>();
  const candidates: Selection[][] = [];
  const addCandidate = (selection: Selection[]) => {
    if (!Array.isArray(selection) || selection.length === 0) {
      return;
    }
    const key = JSON.stringify(selection);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    candidates.push(selection);
  };

  if (includeRelations) {
    addCandidate(withSafeRelationExpansion(schema, modelName, requestedSelection));
  }
  addCandidate(requestedSelection);

  if (includeRelations) {
    addCandidate(withSafeRelationExpansion(schema, modelName, sanitizedSelection));
  }
  addCandidate(sanitizedSelection);

  return candidates.length > 0 ? candidates : [sanitizedSelection];
}

function getRelationNameFromSelectionKey(key: string): string {
  const parenIndex = key.indexOf("(");
  return parenIndex >= 0 ? key.slice(0, parenIndex) : key;
}

function ensureMilestoneProjectSelectionForDeletionFilter(
  schema: CodecksApiSchema,
  selection: Selection[]
): Selection[] {
  const milestoneProjectModel = schema.models.milestoneProject;
  const milestoneRelation = milestoneProjectModel?.relations?.milestone;
  const milestoneModel = milestoneRelation ? schema.models[milestoneRelation.type] : undefined;
  const supportsIsDeleted = Boolean(milestoneRelation && milestoneModel?.fields?.isDeleted);
  if (!supportsIsDeleted) {
    return selection;
  }
  const hasMilestoneWithIsDeleted = selection.some((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return false;
    }
    const [rawKey, rawValue] = Object.entries(item)[0] || [];
    if (!rawKey || getRelationNameFromSelectionKey(rawKey) !== "milestone") {
      return false;
    }
    if (Array.isArray(rawValue)) {
      return rawValue.some((field) => field === "isDeleted");
    }
    return false;
  });

  if (hasMilestoneWithIsDeleted) {
    return selection;
  }
  return [...selection, { milestone: ["id", "isDeleted"] }];
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

function findNestedPath(
  schema: CodecksApiSchema,
  startModel: string,
  targetModel: string,
  maxDepth: number
): string[] | null {
  if (startModel === targetModel) {
    return [];
  }

  const queue: Array<{ model: string; path: string[] }> = [{ model: startModel, path: [] }];
  const seen = new Set<string>([`${startModel}:0`]);

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }
    if (current.path.length >= maxDepth) {
      continue;
    }

    const model = schema.models[current.model];
    if (!model) {
      continue;
    }

    for (const [relationName, relationInfo] of Object.entries(model.relations || {})) {
      const nextPath = [...current.path, relationName];
      if (relationInfo.type === targetModel) {
        return nextPath;
      }
      const depthKey = `${relationInfo.type}:${nextPath.length}`;
      if (!seen.has(depthKey)) {
        seen.add(depthKey);
        queue.push({ model: relationInfo.type, path: nextPath });
      }
    }
  }

  return null;
}

function dedupePaths(paths: RelationPath[]): RelationPath[] {
  const seen = new Set<string>();
  const unique: RelationPath[] = [];
  for (const path of paths) {
    const key = `${path.origin}:${path.relations.join(".")}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(path);
    }
  }
  return unique;
}

function resolveRelationPaths(schema: CodecksApiSchema, modelName: string): RelationPath[] {
  const candidates: RelationPath[] = [];

  const overridePaths = MODEL_PATH_OVERRIDES[modelName];
  if (overridePaths) {
    candidates.push(...overridePaths);
  }

  const rootRelation = findRootRelation(schema, modelName);
  if (rootRelation) {
    candidates.push({ origin: "root", relations: [rootRelation] });
  }

  const accountRelation = findAccountRelation(schema, modelName);
  if (accountRelation) {
    candidates.push({ origin: "account", relations: [accountRelation] });
  }

  const accountNestedPath = findNestedPath(schema, "account", modelName, 4);
  if (accountNestedPath && accountNestedPath.length > 0) {
    candidates.push({ origin: "account", relations: accountNestedPath });
  }

  const root = schema.models._root;
  if (root) {
    for (const [rootRelName, rootRelInfo] of Object.entries(root.relations || {})) {
      if (rootRelName === "account") {
        continue;
      }
      const nested = findNestedPath(schema, rootRelInfo.type, modelName, 3);
      if (nested && nested.length > 0) {
        candidates.push({ origin: "root", relations: [rootRelName, ...nested] });
      }
    }
  }

  return dedupePaths(candidates).filter((path) => path.relations.length > 0);
}

function buildPathSelection(
  relations: string[],
  leafSelection: Selection[],
  leafQuery?: Record<string, unknown>
): Selection[] {
  if (relations.length === 0) {
    return leafSelection;
  }

  const [head, ...rest] = relations;
  if (rest.length === 0) {
    const key = buildRelationKey(head, leafQuery);
    return [{ [key]: leafSelection }];
  }

  return [{ [head]: buildPathSelection(rest, leafSelection, leafQuery) }];
}

function getLeafRelationCardinality(
  schema: CodecksApiSchema,
  path: RelationPath
): RelationCardinality | null {
  let currentModelName = path.origin === "account" ? "account" : "_root";
  let leafCardinality: RelationCardinality | null = null;

  for (const relationName of path.relations) {
    const model = schema.models[currentModelName];
    const relation = model?.relations?.[relationName];
    if (!relation) {
      return null;
    }
    leafCardinality = relation.cardinality;
    currentModelName = relation.type;
  }

  return leafCardinality;
}

function applyClientSidePagination(items: any[], limit: number, offset: number): any[] {
  if (offset >= items.length) {
    return [];
  }
  return items.slice(offset, offset + limit);
}

function extractClientFilterValue(item: Record<string, unknown>, key: string): unknown {
  if (key in item) {
    return item[key];
  }

  const relationKeyFromCamel = key.endsWith("Id")
    ? `${key.slice(0, -2).charAt(0).toLowerCase()}${key.slice(1, -2)}`
    : null;
  if (relationKeyFromCamel && relationKeyFromCamel in item) {
    const relationValue = item[relationKeyFromCamel];
    if (relationValue && typeof relationValue === "object" && !Array.isArray(relationValue)) {
      return (relationValue as Record<string, unknown>).id;
    }
    return relationValue;
  }

  if (key.endsWith("_id")) {
    const relationKeyFromSnake = key.slice(0, -3);
    if (relationKeyFromSnake in item) {
      const relationValue = item[relationKeyFromSnake];
      if (relationValue && typeof relationValue === "object" && !Array.isArray(relationValue)) {
        return (relationValue as Record<string, unknown>).id;
      }
      return relationValue;
    }
  }

  return undefined;
}

function matchesClientFilterValue(actual: unknown, expected: unknown): boolean {
  if (expected && typeof expected === "object" && !Array.isArray(expected)) {
    const op = (expected as Record<string, unknown>).op;
    const value = (expected as Record<string, unknown>).value;
    if ((op === "search" || op === "contains") && typeof value === "string") {
      return String(actual ?? "").toLowerCase().includes(value.toLowerCase());
    }
    if (op === "eq") {
      return actual === value;
    }
  }
  return actual === expected;
}

function applyClientSideFilters(items: any[], filters: Record<string, unknown>): any[] {
  const filterEntries = Object.entries(filters).filter(([key]) => !key.startsWith("$"));
  if (filterEntries.length === 0) {
    return items;
  }

  return items.filter((item) => {
    if (!item || typeof item !== "object") {
      return false;
    }
    const record = item as Record<string, unknown>;
    return filterEntries.every(([key, expected]) =>
      matchesClientFilterValue(extractClientFilterValue(record, key), expected)
    );
  });
}

function extractComparableSortValue(item: Record<string, unknown>, key: string): string | number {
  const value = extractClientFilterValue(item, key);
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    const parsedTime = Date.parse(value);
    if (!Number.isNaN(parsedTime)) {
      return parsedTime;
    }
    return value.toLowerCase();
  }
  return "";
}

function applyClientSideOrdering(
  items: any[],
  orderField: string | undefined,
  orderDesc: boolean
): any[] {
  if (!orderField) {
    return items;
  }

  return [...items].sort((a, b) => {
    const left = a && typeof a === "object"
      ? extractComparableSortValue(a as Record<string, unknown>, orderField)
      : "";
    const right = b && typeof b === "object"
      ? extractComparableSortValue(b as Record<string, unknown>, orderField)
      : "";
    if (left < right) {
      return orderDesc ? 1 : -1;
    }
    if (left > right) {
      return orderDesc ? -1 : 1;
    }
    return 0;
  });
}

function normalizeCardIdKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeCardIdKeysDeep(entry));
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  const source = value as Record<string, unknown>;
  const normalized: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(source)) {
    if (key === "card_id") {
      if (!("cardId" in source)) {
        normalized.cardId = normalizeCardIdKeysDeep(child);
      }
      continue;
    }
    normalized[key] = normalizeCardIdKeysDeep(child);
  }
  return normalized;
}

function normalizeItemForModel(modelName: string, item: any): any {
  if (modelName !== "activity") {
    return item;
  }
  return normalizeCardIdKeysDeep(item);
}

function normalizeItemsForModel(modelName: string, items: any[]): any[] {
  if (modelName !== "activity") {
    return items;
  }
  return items.map((item) => normalizeItemForModel(modelName, item));
}

async function applyModelSpecificListFiltering(
  schema: CodecksApiSchema,
  client: CodecksClient,
  modelName: string,
  items: any[],
  includeDeleted: boolean
): Promise<any[]> {
  if (includeDeleted) {
    return items;
  }

  if (modelName === "milestoneProject") {
    const milestoneDeletedById = new Map<string, boolean>();
    const unresolvedMilestoneIds = new Set<string>();
    const getMilestoneInfo = (item: any): { id: string | undefined; isDeleted: boolean | undefined } => {
      const milestone = item?.milestone;
      if (milestone && typeof milestone === "object" && !Array.isArray(milestone)) {
        const milestoneRecord = milestone as Record<string, unknown>;
        const id = typeof milestoneRecord.id === "string" ? milestoneRecord.id : undefined;
        const isDeleted = typeof milestoneRecord.isDeleted === "boolean" ? milestoneRecord.isDeleted : undefined;
        return { id, isDeleted };
      }
      if (typeof milestone === "string") {
        return { id: milestone, isDeleted: undefined };
      }
      if (typeof item?.milestoneId === "string") {
        return { id: item.milestoneId, isDeleted: undefined };
      }
      return { id: undefined, isDeleted: undefined };
    };

    for (const item of items) {
      const { id, isDeleted } = getMilestoneInfo(item);
      if (!id) {
        continue;
      }
      if (isDeleted !== undefined) {
        milestoneDeletedById.set(id, isDeleted);
      } else if (!milestoneDeletedById.has(id)) {
        unresolvedMilestoneIds.add(id);
      }
    }

    if (unresolvedMilestoneIds.size > 0) {
      try {
        const milestoneSelection: Selection[] = ["id", "isDeleted"];
        const query = buildIdQuery(schema, "milestone", Array.from(unresolvedMilestoneIds), milestoneSelection);
        const response = await client.query(query);
        for (const milestoneId of unresolvedMilestoneIds) {
          const milestone = denormalizeById(
            schema,
            response,
            "milestone",
            milestoneId,
            milestoneSelection
          ) as Record<string, unknown> | null;
          if (typeof milestone?.isDeleted === "boolean") {
            milestoneDeletedById.set(milestoneId, milestone.isDeleted);
          }
        }
      } catch {
        // Best-effort fallback: rely on already-resolved milestone relation fields.
      }
    }

    return items.filter((item) => {
      const { id, isDeleted } = getMilestoneInfo(item);
      if (isDeleted === true) {
        return false;
      }
      if (id && milestoneDeletedById.get(id) === true) {
        return false;
      }
      return true;
    });
  }

  return items;
}

function collectPathItems(value: unknown, relations: string[]): any[] {
  if (value == null) {
    return [];
  }

  if (relations.length === 0) {
    return Array.isArray(value) ? value.filter(Boolean) : [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectPathItems(entry, relations));
  }

  const [relationName, ...rest] = relations;
  return collectPathItems((value as Record<string, unknown>)[relationName], rest);
}

function buildAccountQuery(schema: CodecksApiSchema, accountSelection: Selection[]): Record<string, unknown> {
  if (schema.models._root?.relations?.account) {
    return buildRootQuery(schema, "account", accountSelection);
  }
  return {
    _root: [
      {
        account: accountSelection
      }
    ]
  };
}

async function queryItemsByPath(args: {
  client: CodecksClient;
  schema: CodecksApiSchema;
  path: RelationPath;
  selection: Selection[];
  leafQuery?: Record<string, unknown>;
}): Promise<any[]> {
  const { client, schema, path, selection, leafQuery } = args;

  if (path.origin === "account") {
    const accountSelection = buildPathSelection(path.relations, selection, leafQuery);
    validateSelection(schema, "account", accountSelection);
    const query = buildAccountQuery(schema, accountSelection);
    const response = await client.query(query);
    const account = denormalizeRootRelation(schema, response, "account", accountSelection);
    return collectPathItems(account, path.relations);
  }

  const [rootRelation, ...rest] = path.relations;
  if (!rootRelation) {
    return [];
  }

  if (rest.length === 0) {
    const query = buildRootQuery(schema, rootRelation, selection, leafQuery);
    const response = await client.query(query);
    const rootValue = denormalizeRootRelation(schema, response, rootRelation, selection);
    return collectPathItems(rootValue, []);
  }

  const rootSelection = buildPathSelection(rest, selection, leafQuery);
  const query = buildRootQuery(schema, rootRelation, rootSelection);
  const response = await client.query(query);
  const rootValue = denormalizeRootRelation(schema, response, rootRelation, rootSelection);
  return collectPathItems(rootValue, rest);
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
    let listHandler: AutoToolHandler | null = null;
    let getHandler: AutoToolHandler | null = null;

    if (!existingToolNames.has(listTool)) {
      const model = schema.models[modelName];
      const fields = Object.keys(model.fields || {});
      const relations = Object.keys(model.relations || {});
      const availableFields = [...fields.slice(0, 8), ...(fields.length > 8 ? ["..."] : [])];
      const fieldsDesc = availableFields.length > 0 ? `\n\nAvailable fields: ${availableFields.join(", ")}` : "";
      const relationsDesc = relations.length > 0 ? `\nRelations: ${relations.slice(0, 5).join(", ")}${relations.length > 5 ? ", ..." : ""}` : "";
      const exampleField = fields[1] || "fieldName";
      const filterExample = fields.includes("id") ? `\n\nExample filters: {"${exampleField}": "value"}` : "";

      listHandler = async (params: any) => {
        try {
          const client = getClient();
          const rawSelection = parseSelection(
            params.selection,
            getDefaultSelection(schema, modelName)
          );
          let requestedSelection = rawSelection;
          let sanitizedSelection = sanitizeSelectionForModel(modelName, rawSelection);
          if (modelName === "milestoneProject" && params.include_deleted !== true) {
            requestedSelection = ensureMilestoneProjectSelectionForDeletionFilter(schema, requestedSelection);
            sanitizedSelection = ensureMilestoneProjectSelectionForDeletionFilter(schema, sanitizedSelection);
          }
          const includeRelations = params.include_relations === true;
          const includeDeleted = params.include_deleted === true;
          const selectionCandidates = buildSelectionCandidates({
            schema,
            modelName,
            requestedSelection,
            sanitizedSelection,
            includeRelations
          });
          const limit = typeof params.limit === "number" ? params.limit : DEFAULT_LIMIT;
          const offset = typeof params.offset === "number" ? params.offset : 0;
          const orderDesc = typeof params.order_desc === "boolean" ? params.order_desc : true;
          const orderField = params.order_by || chooseOrderField(schema, modelName);
          const userFiltersInput = { ...(params.filters || {}) } as Record<string, unknown>;
          if (params.project_id !== undefined) {
            userFiltersInput.project_id = params.project_id;
          }
          const userFilters = normalizeFilterKeys(userFiltersInput);
          const filters = { ...userFilters } as Record<string, unknown>;
          if (orderField) {
            filters.$order = orderDesc ? `-${orderField}` : orderField;
            filters.$limit = limit;
            filters.$offset = offset;
          }
          const relationPaths = resolveRelationPaths(schema, modelName);
          if (relationPaths.length === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: `Error: No root or account relation found for model '${modelName}'.`
                }
              ]
            };
          }

          let firstSuccessfulItems: any[] | null = null;
          let usedServerPagination = false;
          let usedUnfilteredFallback = false;
          let firstError: unknown;
          const hasUserFilters = Object.keys(userFilters).length > 0;
          const leafQuery = Object.keys(filters).length > 0 ? filters : undefined;

          outer:
          for (const selection of selectionCandidates) {
            for (const path of relationPaths) {
              try {
                const leafCardinality = getLeafRelationCardinality(schema, path);
                const forceClientFiltering = MODEL_FORCE_CLIENT_SIDE_FILTERING.has(modelName);
                const leafQueryForPath =
                  leafCardinality === "many" && !forceClientFiltering
                    ? leafQuery
                    : undefined;
                let items: any[];
                let pathUsedFallback = false;
                try {
                  items = await queryItemsByPath({
                    client,
                    schema,
                    path,
                    selection,
                    leafQuery: leafQueryForPath
                  });
                } catch (error) {
                  if (leafQueryForPath && hasUserFilters) {
                    items = await queryItemsByPath({
                      client,
                      schema,
                      path,
                      selection
                    });
                    pathUsedFallback = true;
                  } else {
                    throw error;
                  }
                }

                if (leafQueryForPath && hasUserFilters && items.length === 0) {
                  const fallbackItems = await queryItemsByPath({
                    client,
                    schema,
                    path,
                    selection
                  });
                  if (fallbackItems.length > 0) {
                    items = fallbackItems;
                    pathUsedFallback = true;
                  }
                }
                if (firstSuccessfulItems === null) {
                  firstSuccessfulItems = items;
                  usedServerPagination = Boolean(
                    leafQueryForPath &&
                    "$limit" in leafQueryForPath &&
                    "$offset" in leafQueryForPath
                  ) && !pathUsedFallback;
                  usedUnfilteredFallback = pathUsedFallback;
                }
                if (items.length > 0) {
                  firstSuccessfulItems = items;
                  usedServerPagination = Boolean(
                    leafQueryForPath &&
                    "$limit" in leafQueryForPath &&
                    "$offset" in leafQueryForPath
                  ) && !pathUsedFallback;
                  usedUnfilteredFallback = pathUsedFallback;
                  break outer;
                }
              } catch (error) {
                if (!firstError) {
                  firstError = error;
                }
              }
            }
          }

          if (firstSuccessfulItems === null) {
            return {
              content: [{ type: "text", text: formatError(firstError) }]
            };
          }
          let itemsToReturn = firstSuccessfulItems;
          if (usedUnfilteredFallback || MODEL_FORCE_CLIENT_SIDE_FILTERING.has(modelName)) {
            itemsToReturn = applyClientSideFilters(itemsToReturn, userFilters);
            itemsToReturn = applyClientSideOrdering(itemsToReturn, orderField, orderDesc);
          }

          itemsToReturn = await applyModelSpecificListFiltering(
            schema,
            client,
            modelName,
            itemsToReturn,
            includeDeleted
          );

          if (!usedServerPagination || usedUnfilteredFallback || MODEL_FORCE_CLIENT_SIDE_FILTERING.has(modelName)) {
            itemsToReturn = applyClientSidePagination(itemsToReturn, limit, offset);
          }

          const normalizedItems = normalizeItemsForModel(modelName, itemsToReturn);
          const formatted = formatGenericList(modelName, normalizedItems, params.response_format);
          return {
            content: [{ type: "text", text: formatted }],
            structuredContent: params.response_format === ResponseFormat.JSON ? { items: normalizedItems } : undefined
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: formatError(error) }]
          };
        }
      };

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
        listHandler
      );
      existingToolNames.add(listTool);
    }

    if (!existingToolNames.has(getTool)) {
      const model = schema.models[modelName];
      const fields = Object.keys(model.fields || {});
      const relations = Object.keys(model.relations || {});
      const availableFields = [...fields.slice(0, 8), ...(fields.length > 8 ? ["..."] : [])];
      const fieldsDesc = availableFields.length > 0 ? `\n\nAvailable fields: ${availableFields.join(", ")}` : "";
      const relationsDesc = relations.length > 0 ? `\nRelations: ${relations.slice(0, 5).join(", ")}${relations.length > 5 ? ", ..." : ""}` : "";
      const exampleSelection = fields.slice(0, 3).length > 0 ? `\n\nExample selection: [${fields.slice(0, 3).map((f) => `"${f}"`).join(", ")}]` : "";

      getHandler = async (params: any) => {
        try {
          const client = getClient();
          const rawSelection = parseSelection(
            params.selection,
            getDefaultSelection(schema, modelName)
          );
          const sanitizedSelection = sanitizeSelectionForModel(modelName, rawSelection);
          const includeRelations = params.include_relations === true;
          const selectionCandidates = buildSelectionCandidates({
            schema,
            modelName,
            requestedSelection: rawSelection,
            sanitizedSelection,
            includeRelations
          });
          const relationPaths = resolveRelationPaths(schema, modelName);

          if (modelName === "publicProjectInfo") {
            try {
              const safeSelection = sanitizedSelection.length > 0 ? sanitizedSelection : getDefaultSelection(schema, modelName);
              const projectQuery = buildIdQuery(schema, "project", [params.id], [
                "id",
                "name",
                "visibility",
                "isPublic",
                { publicProjectInfo: safeSelection }
              ]);
              const projectResponse = await client.query(projectQuery);
              const project = denormalizeById(schema, projectResponse, "project", params.id, [
                "id",
                "name",
                "visibility",
                "isPublic",
                { publicProjectInfo: safeSelection }
              ]);

              if (project) {
                if (project.publicProjectInfo) {
                  const item = {
                    ...project.publicProjectInfo,
                    projectId: project.id
                  };
                  const formatted = formatGeneric(modelName, item, params.response_format);
                  return {
                    content: [{ type: "text", text: formatted }],
                    structuredContent: params.response_format === ResponseFormat.JSON ? item : undefined
                  };
                }

                const unavailable = {
                  id: params.id,
                  projectId: project.id,
                  isAvailable: false,
                  reason: "publicProjectInfo is only populated for public projects."
                };
                const formatted = formatGeneric(modelName, unavailable, params.response_format);
                return {
                  content: [{ type: "text", text: formatted }],
                  structuredContent: params.response_format === ResponseFormat.JSON ? unavailable : undefined
                };
              }
            } catch {
              // Fall through to generic get logic
            }
          }

          let firstError: unknown;
          let hadSuccessfulLookup = false;
          const idVariants: Array<string | string[]> = [params.id, [params.id]];
          for (const selection of selectionCandidates) {
            for (const idVariant of idVariants) {
              try {
                const query = buildIdQuery(schema, modelName, idVariant, selection);
                const response = await client.query(query);
                hadSuccessfulLookup = true;
                const item = denormalizeById(schema, response, modelName, params.id, selection);
                if (item) {
                  const normalizedItem = normalizeItemForModel(modelName, item);
                  const formatted = formatGeneric(modelName, normalizedItem, params.response_format);
                  return {
                    content: [{ type: "text", text: formatted }],
                    structuredContent: params.response_format === ResponseFormat.JSON ? normalizedItem : undefined
                  };
                }
              } catch (error) {
                if (!firstError) {
                  firstError = error;
                }
                firstError = error;
              }
            }

            for (const path of relationPaths) {
              try {
                const items = await queryItemsByPath({
                  client,
                  schema,
                  path,
                  selection
                });
                hadSuccessfulLookup = true;
                const item = items.find((entry) => entry?.id === params.id);
                if (item) {
                  const normalizedItem = normalizeItemForModel(modelName, item);
                  const formatted = formatGeneric(modelName, normalizedItem, params.response_format);
                  return {
                    content: [{ type: "text", text: formatted }],
                    structuredContent: params.response_format === ResponseFormat.JSON ? normalizedItem : undefined
                  };
                }
              } catch (error) {
                if (!firstError) {
                  firstError = error;
                }
              }
            }
          }

          if (!hadSuccessfulLookup && firstError) {
            return {
              content: [{ type: "text", text: formatError(firstError) }]
            };
          }

          return {
            content: [{ type: "text", text: `Error: ${modelName} '${params.id}' not found.` }]
          };
        } catch (error) {
          return {
            content: [{ type: "text", text: formatError(error) }]
          };
        }
      };

      server.registerTool(
        getTool,
        {
          title: `Get ${modelName}`,
          description: `Get a single ${modelName} by ID with optional field selection.${fieldsDesc}${relationsDesc}${exampleSelection}`,
          inputSchema: AutoGetSchema,
          annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: true
          }
        },
        getHandler
      );
      existingToolNames.add(getTool);
    }

    const aliases = COMPATIBILITY_ALIASES[modelName];
    if (aliases) {
      if (listHandler) {
        for (const listAlias of aliases.list) {
          if (existingToolNames.has(listAlias)) {
            continue;
          }
          server.registerTool(
            listAlias,
            {
              title: `List ${toSnake(modelName)} (alias)`,
              description: `Compatibility alias for ${listTool}.`,
              inputSchema: AutoListSchema,
              annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: true
              }
            },
            listHandler
          );
          existingToolNames.add(listAlias);
        }
      }

      if (getHandler) {
        for (const getAlias of aliases.get) {
          if (existingToolNames.has(getAlias)) {
            continue;
          }
          server.registerTool(
            getAlias,
            {
              title: `Get ${toSnake(modelName)} (alias)`,
              description: `Compatibility alias for ${getTool}.`,
              inputSchema: AutoGetSchema,
              annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: true
              }
            },
            getHandler
          );
          existingToolNames.add(getAlias);
        }
      }
    }
  }
}
