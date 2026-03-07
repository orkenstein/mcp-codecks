#!/usr/bin/env node
/**
 * Codecks MCP Server
 * 
 * Provides tools to interact with Codecks game project tracker API,
 * including card management, deck organization, and milestone tracking.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";

import { CodecksClient, formatError } from "./services/codecks-client.js";
import { ResponseFormat, ResponseMode } from "./types.js";
import * as schemas from "./schemas/tool-schemas.js";
import * as format from "./utils/format.js";
import { loadSchema } from "./utils/schema.js";
import {
  buildIdQuery,
  buildRelationKey,
  buildRootQuery,
  denormalizeById,
  denormalizeRootRelation,
  validateSelection,
  type Selection
} from "./utils/query-builder.js";
import { registerAutoTools } from "./utils/auto-tools.js";
import {
  isWorkflowApplyVersionGateError,
  resolveMilestoneUnlinkGlobalize
} from "./utils/tool-guards.js";

// Initialize MCP server
const server = new McpServer({
  name: "codecks-mcp-server",
  version: "1.0.0"
});

const schema = loadSchema();

// Tool name constants - prevents sync issues between manualTools Set and registrations
const TOOL_LIST_CARDS = "codecks_list_cards";
const TOOL_GET_CARD = "codecks_get_card";
const TOOL_DELETE_CARD = "codecks_delete_card";
const TOOL_CREATE_CARD = "codecks_create_card";
const TOOL_BULK_UPDATE_CARDS = "codecks_bulk_update_cards";
const TOOL_UPDATE_CARD = "codecks_update_card";
const TOOL_LIST_DECKS = "codecks_list_decks";
const TOOL_GET_DECK = "codecks_get_deck";
const TOOL_CREATE_DECK = "codecks_create_deck";
const TOOL_ADD_DECKS_TO_SPACE = "codecks_add_decks_to_space_after";
const TOOL_UPDATE_DECK = "codecks_update_deck";
const TOOL_DELETE_DECK = "codecks_delete_deck";
const TOOL_LIST_SPACES = "codecks_list_spaces";
const TOOL_GET_SPACE = "codecks_get_space";
const TOOL_CREATE_SPACE = "codecks_create_space";
const TOOL_UPDATE_SPACE = "codecks_update_space";
const TOOL_DELETE_SPACE = "codecks_delete_space";
const TOOL_LIST_PROJECTS = "codecks_list_projects";
const TOOL_CREATE_PROJECT = "codecks_create_project";
const TOOL_SET_PROJECT_VISIBILITY = "codecks_set_project_visibility";
const TOOL_LIST_MILESTONES = "codecks_list_milestones";
const TOOL_GET_MILESTONE = "codecks_get_milestone";
const TOOL_CREATE_MILESTONE = "codecks_create_milestone";
const TOOL_CREATE_MILESTONE_PROJECT = "codecks_create_milestone_project";
const TOOL_UPDATE_MILESTONE = "codecks_update_milestone";
const TOOL_DELETE_MILESTONE = "codecks_delete_milestone";
const TOOL_UNLINK_MILESTONE_PROJECT = "codecks_unlink_milestone_project";
const TOOL_START_JOURNEY = "codecks_start_journey";
const TOOL_ADD_TO_HAND = "codecks_add_to_hand";
const TOOL_REMOVE_FROM_HAND = "codecks_remove_from_hand";
const TOOL_ADD_TO_QUEUE = "codecks_add_to_queue";
const TOOL_REMOVE_FROM_QUEUE = "codecks_remove_from_queue";
const TOOL_REORDER_QUEUE = "codecks_reorder_queue";
const TOOL_UPVOTE_CARD = "codecks_upvote_card";
const TOOL_REMOVE_CARD_UPVOTE = "codecks_remove_card_upvote";
const TOOL_SUBSCRIBE_CARD = "codecks_subscribe_card";
const TOOL_UNSUBSCRIBE_CARD = "codecks_unsubscribe_card";
const TOOL_SUBSCRIBE_DECK = "codecks_subscribe_deck";
const TOOL_UNSUBSCRIBE_DECK = "codecks_unsubscribe_deck";
const TOOL_GET_CURRENT_USER = "codecks_get_current_user";
const TOOL_STATS = "codecks_stats";

const manualTools = new Set<string>([
  TOOL_LIST_CARDS,
  TOOL_GET_CARD,
  TOOL_DELETE_CARD,
  TOOL_CREATE_CARD,
  TOOL_BULK_UPDATE_CARDS,
  TOOL_UPDATE_CARD,
  TOOL_LIST_DECKS,
  TOOL_GET_DECK,
  TOOL_CREATE_DECK,
  TOOL_ADD_DECKS_TO_SPACE,
  TOOL_UPDATE_DECK,
  TOOL_DELETE_DECK,
  TOOL_LIST_SPACES,
  TOOL_GET_SPACE,
  TOOL_CREATE_SPACE,
  TOOL_UPDATE_SPACE,
  TOOL_DELETE_SPACE,
  TOOL_LIST_PROJECTS,
  TOOL_CREATE_PROJECT,
  TOOL_SET_PROJECT_VISIBILITY,
  TOOL_LIST_MILESTONES,
  TOOL_GET_MILESTONE,
  TOOL_CREATE_MILESTONE,
  TOOL_CREATE_MILESTONE_PROJECT,
  TOOL_UPDATE_MILESTONE,
  TOOL_DELETE_MILESTONE,
  TOOL_UNLINK_MILESTONE_PROJECT,
  TOOL_START_JOURNEY,
  TOOL_ADD_TO_HAND,
  TOOL_REMOVE_FROM_HAND,
  TOOL_ADD_TO_QUEUE,
  TOOL_REMOVE_FROM_QUEUE,
  TOOL_REORDER_QUEUE,
  TOOL_UPVOTE_CARD,
  TOOL_REMOVE_CARD_UPVOTE,
  TOOL_SUBSCRIBE_CARD,
  TOOL_UNSUBSCRIBE_CARD,
  TOOL_SUBSCRIBE_DECK,
  TOOL_UNSUBSCRIBE_DECK,
  TOOL_GET_CURRENT_USER,
  TOOL_STATS
]);

// Codecks client - initialized eagerly at startup after env validation
let client: CodecksClient;

const serverStartTime = Date.now();
const toolMetrics: Record<string, { calls: number; errors: number; bytes: number }> = {};

function trackToolUsage(toolName: string, text: string, isError = false): void {
  if (!toolMetrics[toolName]) {
    toolMetrics[toolName] = { calls: 0, errors: 0, bytes: 0 };
  }
  const metric = toolMetrics[toolName];
  metric.calls += 1;
  metric.bytes += Buffer.byteLength(text ?? "", "utf-8");
  if (isError) {
    metric.errors += 1;
  }
}

function getClient(): CodecksClient {
  if (!client) {
    throw new Error("CodecksClient not initialized. Ensure runStdio() or runHTTP() has been called.");
  }
  return client;
}

function normalizeCardId(card: Record<string, any>, fallbackId?: string): Record<string, any> {
  const id = card?.id || card?.cardId || card?.card_id || fallbackId;
  if (!id) {
    return card;
  }
  const normalized: Record<string, any> = { ...card, id };
  delete normalized.cardId;
  delete normalized.card_id;
  return normalized;
}

function normalizeSpacesFromProject(project: any): any[] {
  const rawSpaces = Array.isArray(project?.spaces) ? project.spaces : [];
  const projectRef = {
    id: project?.id,
    name: project?.name,
    visibility: project?.visibility
  };

  return rawSpaces
    .filter((space: any) => space && typeof space === "object" && !Array.isArray(space))
    .map((space: any) => ({
      id: typeof space.id === "number" ? space.id : Number(space.id),
      name: space.name,
      icon: space.icon ?? null,
      defaultDeckType: space.defaultDeckType,
      project: projectRef
    }))
    .filter((space: any) => Number.isFinite(space.id));
}

async function getProjectWithSpaces(client: CodecksClient, projectId: string): Promise<any | null> {
  const projectSelection: Selection[] = ["id", "name", "visibility", "spaces"];
  const query = buildIdQuery(schema, "project", [projectId], projectSelection);
  const response = await client.query(query);
  return denormalizeById(
    schema,
    response as Record<string, any>,
    "project",
    projectId,
    projectSelection
  );
}

function getRawProjectSpaces(project: any): any[] {
  if (!Array.isArray(project?.spaces)) {
    return [];
  }

  return project.spaces.filter((space: any) => space && typeof space === "object" && !Array.isArray(space));
}

async function resolveCurrentUserId(client: CodecksClient): Promise<string | undefined> {
  const userSelection: Selection[] = ["id"];
  const userQuery = buildRootQuery(schema, "loggedInUser", userSelection);
  const userResponse = await client.query(userQuery);
  const user = denormalizeRootRelation(
    schema,
    userResponse as Record<string, any>,
    "loggedInUser",
    userSelection
  ) as Record<string, unknown> | null;
  return typeof user?.id === "string" ? user.id : undefined;
}

async function resolveAccountId(client: CodecksClient): Promise<string | undefined> {
  const accountSelection: Selection[] = ["id"];
  const accountQuery = buildRootQuery(schema, "account", accountSelection);
  const accountResponse = await client.query(accountQuery);
  const account = denormalizeRootRelation(
    schema,
    accountResponse as Record<string, any>,
    "account",
    accountSelection
  ) as Record<string, unknown> | null;
  return typeof account?.id === "string" ? account.id : undefined;
}

async function resolveOwnCardUpvoteId(
  client: CodecksClient,
  cardId: string
): Promise<string | undefined> {
  const currentUserId = await resolveCurrentUserId(client);
  if (!currentUserId) {
    return undefined;
  }

  const cardSelection: Selection[] = [
    { upvotes: ["id", { user: ["id"] }] }
  ];
  const query = buildIdQuery(schema, "card", [cardId], cardSelection);
  const response = await client.query(query);
  const card = denormalizeById(
    schema,
    response as Record<string, any>,
    "card",
    cardId,
    cardSelection
  ) as Record<string, unknown> | null;
  const upvotes = (card?.upvotes as any[]) || [];
  for (const upvote of upvotes) {
    if (!upvote || typeof upvote !== "object") {
      continue;
    }
    const user = (upvote as Record<string, unknown>).user;
    const upvoteUserId = user && typeof user === "object"
      ? (user as Record<string, unknown>).id
      : user;
    if (upvoteUserId === currentUserId) {
      const id = (upvote as Record<string, unknown>).id;
      return typeof id === "string" ? id : undefined;
    }
  }
  return undefined;
}


// ============================================================================
// TOOL: codecks_list_cards
// ============================================================================
server.registerTool(
  TOOL_LIST_CARDS,
  {
    title: "List Codecks Cards",
    description: `List cards from your Codecks account with optional filters.

This tool retrieves cards from Codecks, supporting various filters like deck, milestone, assignee, and status. Perfect for viewing your backlog, finding specific tasks, or getting an overview of work.

Args:
  - deck_id (string, optional): Filter by specific deck ID
  - milestone_id (string, optional): Filter by specific milestone ID
  - assignee_id (string, optional): Filter by assigned user ID
  - status (enum, optional): Filter by workflow status (unassigned, assigned, started, review, blocked, done)
  - search (string, optional): Search term to filter cards by title/content
  - limit (number): Maximum results to return (1-100, default: 20)
  - offset (number): Number of results to skip for pagination (default: 0)
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  For JSON format: Structured data with schema:
  {
    "cards": [{
      "id": string,
      "accountSeq": number,
      "title": string,
      "content": string,
      "derivedStatus": string,
      "effort": number (optional),
      "priority": string (optional),
      "assignee": {id, name} (optional),
      "deck": {id, name} (optional),
      "milestone": {id, name} (optional),
      "createdAt": string,
      "lastUpdatedAt": string
    }],
    "count": number,
    "offset": number,
    "has_more": boolean,
    "next_offset": number (if has_more)
  }

Examples:
  - List all cards in a specific deck
  - Find cards assigned to a user
  - Search for cards containing specific text
  - Get cards in a milestone

Error Handling:
  - Returns authentication errors if credentials are invalid
  - Returns rate limit errors if too many requests
  - Provides clear messages for all error cases`,
    inputSchema: schemas.ListCardsSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true
    }
  },
  async (params: schemas.ListCardsInput) => {
    try {
      const client = getClient();
      
      // Build query filters
      const filters: Record<string, unknown> = {};
      if (params.deck_id) filters.deckId = params.deck_id;
      if (params.milestone_id) filters.milestoneId = params.milestone_id;
      if (params.assignee_id) filters.assigneeId = params.assignee_id;
      if (params.status) filters.derivedStatus = params.status;
      if (params.exclude_deleted) filters.visibility = { op: "neq", value: "deleted" };
      if (params.search) {
        filters.content = { op: "search", value: params.search };
      }

      const cardSelection: Selection[] = [
        "accountSeq",
        "title",
        "content",
        "derivedStatus",
        "visibility",
        "effort",
        "priority",
        "createdAt",
        "lastUpdatedAt",
        { deck: ["id", "title"] },
        { milestone: ["id", "name"] },
        { assignee: ["id", "name"] }
      ];

      const cardsKey = buildRelationKey("cards", {
        ...filters,
        $order: "-lastUpdatedAt",
        $limit: params.limit,
        $offset: params.offset
      });

      const accountSelection: Selection[] = [{ [cardsKey]: cardSelection }];
      const query = buildRootQuery(schema, "account", accountSelection);
      let cards: any[] = [];
      let totalMatching = 0;
      let usedFallback = false;
      let primaryError: unknown;

      try {
        const response = await client.query(query);
        const account = denormalizeRootRelation(schema, response as Record<string, any>, "account", accountSelection);
        cards = account?.cards || [];
        totalMatching = cards.length;
      } catch (error) {
        primaryError = error;
      }

      // Some Codecks accounts return empty results for cards(...) queries with filters/order/limit
      // even when cards exist. Fallback to unfiltered cards relation and apply filters client-side.
      if (cards.length === 0) {
        try {
          const fallbackAccountSelection: Selection[] = [{ cards: cardSelection }];
          const fallbackQuery = buildRootQuery(schema, "account", fallbackAccountSelection);
          const fallbackResponse = await client.query(fallbackQuery);
          const fallbackAccount = denormalizeRootRelation(
            schema,
            fallbackResponse as Record<string, any>,
            "account",
            fallbackAccountSelection
          );
          const allCards = fallbackAccount?.cards || [];

          const searchLower = params.search?.toLowerCase();
          const filtered = allCards.filter((card: any) => {
            const deckId = typeof card?.deck === "object" ? card.deck?.id : card?.deck;
            const milestoneId = typeof card?.milestone === "object" ? card.milestone?.id : card?.milestone;
            const assigneeId = typeof card?.assignee === "object" ? card.assignee?.id : card?.assignee;
            const visibility = card?.visibility;

            if (params.deck_id && deckId !== params.deck_id) return false;
            if (params.milestone_id && milestoneId !== params.milestone_id) return false;
            if (params.assignee_id && assigneeId !== params.assignee_id) return false;
            if (params.status && card?.derivedStatus !== params.status) return false;
            if (params.exclude_deleted && visibility === "deleted") return false;
            if (searchLower) {
              const haystack = `${card?.title || ""}\n${card?.content || ""}`.toLowerCase();
              if (!haystack.includes(searchLower)) return false;
            }
            return true;
          });

          filtered.sort((a: any, b: any) => {
            const aTs = Date.parse(a?.lastUpdatedAt || a?.createdAt || 0);
            const bTs = Date.parse(b?.lastUpdatedAt || b?.createdAt || 0);
            return bTs - aTs;
          });

          totalMatching = filtered.length;
          cards = filtered.slice(params.offset, params.offset + params.limit);
          usedFallback = true;
        } catch (fallbackError) {
          if (primaryError) {
            throw primaryError;
          }
          throw fallbackError;
        }
      }

      // Calculate pagination metadata
      // For fallback mode we know the exact filtered total; otherwise retain heuristic.
      cards = cards.map((card: any) => normalizeCardId(card));
      const meta = usedFallback
        ? {
            count: cards.length,
            offset: params.offset,
            has_more: params.offset + params.limit < totalMatching,
            ...(params.offset + params.limit < totalMatching ? { next_offset: params.offset + params.limit } : {})
          }
        : {
            count: cards.length,
            offset: params.offset,
            has_more: cards.length === params.limit,
            ...(cards.length === params.limit ? { next_offset: params.offset + params.limit } : {})
          };

      let formatted = format.formatCardList(cards, params.response_format, meta, params.response_mode);
      let { content, truncated } = format.checkAndTruncate(formatted, cards.length, {
        responseMode: params.response_mode,
        totalItems: totalMatching
      });
      let responseModeUsed = params.response_mode;

      if (
        truncated &&
        params.response_format === ResponseFormat.MARKDOWN &&
        params.response_mode === ResponseMode.FULL
      ) {
        formatted = format.formatCardList(cards, params.response_format, meta, ResponseMode.COMPACT);
        const compactResult = format.checkAndTruncate(formatted, cards.length, {
          responseMode: ResponseMode.COMPACT,
          totalItems: totalMatching
        });
        content = compactResult.content;
        truncated = compactResult.truncated;
        responseModeUsed = ResponseMode.COMPACT;
        if (!compactResult.truncated) {
          content += "\n\n---\nFull output exceeded response size limits and was automatically switched to response_mode='compact'.";
        }
      }

      trackToolUsage(TOOL_LIST_CARDS, content);
      return {
        content: [{ type: "text", text: content }],
        structuredContent: params.response_format === ResponseFormat.JSON
          ? { cards, ...meta, truncated, response_mode_used: responseModeUsed }
          : undefined
      };
    } catch (error) {
      const message = formatError(error);
      trackToolUsage(TOOL_LIST_CARDS, message, true);
      return {
        content: [{ type: "text", text: message }]
      };
    }
  }
);

// ============================================================================
// TOOL: codecks_get_card
// ============================================================================
server.registerTool(
  TOOL_GET_CARD,
  {
    title: "Get Codecks Card",
    description: `Retrieve detailed information about a specific card.

Fetches complete details for a single card including title, content, status, assignee, deck, milestone, and all metadata.

Args:
  - card_id (string): The card ID to retrieve
  - include_relations (boolean): Include deck/milestone/assignee objects when available (default: false)
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  Complete card details including all fields and relationships.

Error Handling:
  - Returns 404 error if card ID doesn't exist
  - Returns authentication errors if credentials are invalid`,
    inputSchema: schemas.GetCardSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true
    }
  },
  async (params: schemas.GetCardInput) => {
    try {
      const client = getClient();

      const baseCardSelection: Selection[] = [
        "accountSeq",
        "title",
        "content",
        "derivedStatus",
        "effort",
        "priority",
        "deckId",
        "milestoneId",
        "sprintId",
        "createdAt",
        "lastUpdatedAt"
      ];
      const richCardSelection: Selection[] = [
        ...baseCardSelection,
        { deck: ["id", "title"] },
        { milestone: ["id", "name"] },
        { assignee: ["id", "name"] }
      ];
      const selectionVariants = params.include_relations
        ? [richCardSelection, baseCardSelection]
        : [baseCardSelection];

      let card: Record<string, any> | null = null;
      let firstError: unknown;
      const idVariants: Array<string | string[]> = [[params.card_id], params.card_id];
      outer:
      for (const cardSelection of selectionVariants) {
        for (const idVariant of idVariants) {
          try {
            const query = buildIdQuery(schema, "card", idVariant, cardSelection);
            const response = await client.query(query);
            const candidate = denormalizeById(
              schema,
              response as Record<string, any>,
              "card",
              params.card_id,
              cardSelection
            );
            if (candidate) {
              card = candidate;
              break outer;
            }
          } catch (error) {
            if (!firstError) {
              firstError = error;
            }
          }
        }
      }
      if (!card && firstError) {
        throw firstError;
      }

      const normalizedCard = card ? normalizeCardId(card, params.card_id) : card;

      if (!normalizedCard) {
        return {
          content: [{ type: "text", text: `Error: Card with ID '${params.card_id}' not found.` }]
        };
      }
      const formatted = format.formatCard(normalizedCard, params.response_format);

      return {
        content: [{ type: "text", text: formatted }],
        structuredContent: params.response_format === ResponseFormat.JSON ? normalizedCard : undefined
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: formatError(error) }]
      };
    }
  }
);

// ============================================================================
// TOOL: codecks_delete_card
// ============================================================================
server.registerTool(
  TOOL_DELETE_CARD,
  {
    title: "Delete/Archive Codecks Card",
    description: `Archive (soft-delete) a card in Codecks.

Uses Codecks' cards/update dispatch endpoint with deletion flags.

Args:
  - card_id (string): The card ID to archive/delete
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  Confirmation including the affected card ID and dispatch metadata.`,
    inputSchema: schemas.DeleteCardSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true
    }
  },
  async (params: schemas.DeleteCardInput) => {
    try {
      const client = getClient();
      const response = await client.dispatch("cards/update", {
        id: params.card_id,
        isDeleted: true,
        visibility: "deleted"
      });

      const payload = {
        card_id: params.card_id,
        deleted: true,
        response
      };
      const formatted = params.response_format === ResponseFormat.JSON
        ? JSON.stringify(payload, null, 2)
        : `Card archived successfully. ID: ${params.card_id}`;

      return {
        content: [{ type: "text", text: formatted }],
        structuredContent: params.response_format === ResponseFormat.JSON ? payload : undefined
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: formatError(error) }]
      };
    }
  }
);

// ============================================================================
// TOOL: codecks_start_journey
// ============================================================================
server.registerTool(
  TOOL_START_JOURNEY,
  {
    title: "Start Journey from Hero Card",
    description: `Trigger workflow expansion for a hero/journey parent card.

Args:
  - card_id (string): Hero/journey parent card ID
  - user_id (string, optional): Actor user ID (auto-resolved if omitted)
  - account_id (string, optional): Actor account ID (auto-resolved if omitted)
  - session_id (string, optional): Client session ID from web app
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  API response payload with journey expansion result.
  Note: some Codecks accounts currently gate this dispatch endpoint and may require web-app usage.`,
    inputSchema: schemas.StartJourneySchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    }
  },
  async (params: schemas.StartJourneyInput) => {
    try {
      const client = getClient();
      const userId = params.user_id || await resolveCurrentUserId(client);
      const accountId = params.account_id || await resolveAccountId(client);
      const baseData: Record<string, unknown> = {};
      if (params.session_id) baseData.sessionId = params.session_id;
      if (userId) baseData.userId = userId;
      if (accountId) baseData.accountId = accountId;
      const response = await client.dispatch("workflows/apply", {
        ...baseData,
        cardId: params.card_id
      });
      const payload = {
        card_id: params.card_id,
        request_id_key: "cardId",
        response
      };
      const text = params.response_format === ResponseFormat.JSON
        ? JSON.stringify(payload, null, 2)
        : `Journey started successfully for card ${params.card_id}.`;
      return {
        content: [{ type: "text", text }],
        structuredContent: params.response_format === ResponseFormat.JSON ? payload : undefined
      };
    } catch (error) {
      if (isWorkflowApplyVersionGateError(error)) {
        const unsupportedPayload = {
          card_id: params.card_id,
          unsupported: true,
          reason: "workflows_apply_version_gate",
          guidance: "Codecks rejected workflows/apply with an app-version gate. Trigger this action in the Codecks web app for now.",
          error: formatError(error)
        };
        const text = params.response_format === ResponseFormat.JSON
          ? JSON.stringify(unsupportedPayload, null, 2)
          : `Unable to start journey for card ${params.card_id}: Codecks currently gates workflows/apply for this API context ("old version of the app").`;
        return {
          content: [{ type: "text", text }],
          structuredContent: params.response_format === ResponseFormat.JSON ? unsupportedPayload : undefined
        };
      }
      return {
        content: [{ type: "text", text: formatError(error) }]
      };
    }
  }
);

// ============================================================================
// TOOL: codecks_add_to_hand
// ============================================================================
server.registerTool(
  TOOL_ADD_TO_HAND,
  {
    title: "Add Cards to Hand",
    description: "Add one or more cards to hand/bookmarks.",
    inputSchema: schemas.AddToHandSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    }
  },
  async (params: schemas.AddToHandInput) => {
    try {
      const client = getClient();
      const userId = params.user_id || await resolveCurrentUserId(client);
      if (!userId) {
        return {
          content: [{ type: "text", text: "Error: Unable to resolve required user_id for add_to_hand." }]
        };
      }
      const response = await client.dispatch("bookmarks/addCards", {
        sessionId: params.session_id || undefined,
        userId,
        ids: params.card_ids
      });
      const payload = { card_ids: params.card_ids, response };
      const text = params.response_format === ResponseFormat.JSON
        ? JSON.stringify(payload, null, 2)
        : `Added ${params.card_ids.length} card(s) to hand.`;
      return {
        content: [{ type: "text", text }],
        structuredContent: params.response_format === ResponseFormat.JSON ? payload : undefined
      };
    } catch (error) {
      return { content: [{ type: "text", text: formatError(error) }] };
    }
  }
);

// ============================================================================
// TOOL: codecks_remove_from_hand
// ============================================================================
server.registerTool(
  TOOL_REMOVE_FROM_HAND,
  {
    title: "Remove Cards from Hand",
    description: "Remove one or more cards from hand/bookmarks.",
    inputSchema: schemas.RemoveFromHandSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    }
  },
  async (params: schemas.RemoveFromHandInput) => {
    try {
      const client = getClient();
      const userId = params.user_id || await resolveCurrentUserId(client);
      if (!userId) {
        return {
          content: [{ type: "text", text: "Error: Unable to resolve required user_id for remove_from_hand." }]
        };
      }
      const response = await client.dispatch("bookmarks/removeCards", {
        sessionId: params.session_id || undefined,
        userId,
        ids: params.card_ids
      });
      const payload = { card_ids: params.card_ids, response };
      const text = params.response_format === ResponseFormat.JSON
        ? JSON.stringify(payload, null, 2)
        : `Removed ${params.card_ids.length} card(s) from hand.`;
      return {
        content: [{ type: "text", text }],
        structuredContent: params.response_format === ResponseFormat.JSON ? payload : undefined
      };
    } catch (error) {
      return { content: [{ type: "text", text: formatError(error) }] };
    }
  }
);

// ============================================================================
// TOOL: codecks_add_to_queue
// ============================================================================
server.registerTool(
  TOOL_ADD_TO_QUEUE,
  {
    title: "Add Cards to Queue",
    description: "Add one or more cards to queue.",
    inputSchema: schemas.AddToQueueSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    }
  },
  async (params: schemas.AddToQueueInput) => {
    try {
      const client = getClient();
      const accountId = params.account_id || await resolveAccountId(client);
      const userId = params.user_id || await resolveCurrentUserId(client);
      if (!accountId) {
        return {
          content: [{ type: "text", text: "Error: Unable to resolve required account_id for add_to_queue." }]
        };
      }
      const data: Record<string, unknown> = {
        sessionId: params.session_id || undefined,
        cardIds: params.card_ids,
        accountId
      };
      if (userId) {
        data.userId = userId;
      }
      const response = await client.dispatch("handQueue/addCardsToOwner", data);
      const payload = { card_ids: params.card_ids, response };
      const text = params.response_format === ResponseFormat.JSON
        ? JSON.stringify(payload, null, 2)
        : `Added ${params.card_ids.length} card(s) to queue.`;
      return {
        content: [{ type: "text", text }],
        structuredContent: params.response_format === ResponseFormat.JSON ? payload : undefined
      };
    } catch (error) {
      return { content: [{ type: "text", text: formatError(error) }] };
    }
  }
);

// ============================================================================
// TOOL: codecks_remove_from_queue
// ============================================================================
server.registerTool(
  TOOL_REMOVE_FROM_QUEUE,
  {
    title: "Remove Cards from Queue",
    description: "Remove one or more cards from queue.",
    inputSchema: schemas.RemoveFromQueueSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    }
  },
  async (params: schemas.RemoveFromQueueInput) => {
    try {
      const client = getClient();
      const accountId = params.account_id || await resolveAccountId(client);
      const userId = params.user_id || await resolveCurrentUserId(client);
      const data: Record<string, unknown> = {
        sessionId: params.session_id || undefined,
        cardIds: params.card_ids
      };
      if (accountId) {
        data.accountId = accountId;
      }
      if (userId) {
        data.userId = userId;
      }
      const response = await client.dispatch("handQueue/removeCards", data);
      const payload = { card_ids: params.card_ids, response };
      const text = params.response_format === ResponseFormat.JSON
        ? JSON.stringify(payload, null, 2)
        : `Removed ${params.card_ids.length} card(s) from queue.`;
      return {
        content: [{ type: "text", text }],
        structuredContent: params.response_format === ResponseFormat.JSON ? payload : undefined
      };
    } catch (error) {
      return { content: [{ type: "text", text: formatError(error) }] };
    }
  }
);

// ============================================================================
// TOOL: codecks_reorder_queue
// ============================================================================
server.registerTool(
  TOOL_REORDER_QUEUE,
  {
    title: "Reorder Queue Cards",
    description: "Set queue card order using an ordered card ID list and dragged subset.",
    inputSchema: schemas.ReorderQueueSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    }
  },
  async (params: schemas.ReorderQueueInput) => {
    try {
      const client = getClient();
      const userId = params.user_id || await resolveCurrentUserId(client);
      const accountId = params.account_id || await resolveAccountId(client);
      if (!userId) {
        return {
          content: [{ type: "text", text: "Error: Unable to resolve required user_id for reorder_queue." }]
        };
      }
      const data: Record<string, unknown> = {
        sessionId: params.session_id || undefined,
        cardIds: params.card_ids,
        draggedCardIds: params.dragged_card_ids,
        userId
      };
      if (accountId) {
        data.accountId = accountId;
      }
      const response = await client.dispatch("handQueue/setCardOrders", data);
      const payload = { card_ids: params.card_ids, response };
      const text = params.response_format === ResponseFormat.JSON
        ? JSON.stringify(payload, null, 2)
        : `Queue order updated for ${params.card_ids.length} card(s).`;
      return {
        content: [{ type: "text", text }],
        structuredContent: params.response_format === ResponseFormat.JSON ? payload : undefined
      };
    } catch (error) {
      return { content: [{ type: "text", text: formatError(error) }] };
    }
  }
);

// ============================================================================
// TOOL: codecks_upvote_card
// ============================================================================
server.registerTool(
  TOOL_UPVOTE_CARD,
  {
    title: "Upvote Card",
    description: "Upvote a card.",
    inputSchema: schemas.UpvoteCardSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    }
  },
  async (params: schemas.UpvoteCardInput) => {
    try {
      const client = getClient();
      const response = await client.dispatch("votes/vote", { cardId: params.card_id });
      const payload = { card_id: params.card_id, response };
      const text = params.response_format === ResponseFormat.JSON
        ? JSON.stringify(payload, null, 2)
        : `Card ${params.card_id} upvoted.`;
      return {
        content: [{ type: "text", text }],
        structuredContent: params.response_format === ResponseFormat.JSON ? payload : undefined
      };
    } catch (error) {
      return { content: [{ type: "text", text: formatError(error) }] };
    }
  }
);

// ============================================================================
// TOOL: codecks_remove_card_upvote
// ============================================================================
server.registerTool(
  TOOL_REMOVE_CARD_UPVOTE,
  {
    title: "Remove Card Upvote",
    description: "Remove your upvote from a card (by card_id or upvote_id).",
    inputSchema: schemas.RemoveCardUpvoteSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    }
  },
  async (params: schemas.RemoveCardUpvoteInput) => {
    try {
      const client = getClient();
      let upvoteId = params.upvote_id;
      if (!upvoteId && params.card_id) {
        upvoteId = await resolveOwnCardUpvoteId(client, params.card_id);
      }
      if (!upvoteId) {
        return {
          content: [{ type: "text", text: "Error: No upvote found to remove for the provided input." }]
        };
      }
      const response = await client.dispatch("votes/unvote", { id: upvoteId });
      const payload = { upvote_id: upvoteId, card_id: params.card_id, response };
      const text = params.response_format === ResponseFormat.JSON
        ? JSON.stringify(payload, null, 2)
        : `Removed upvote ${upvoteId}.`;
      return {
        content: [{ type: "text", text }],
        structuredContent: params.response_format === ResponseFormat.JSON ? payload : undefined
      };
    } catch (error) {
      return { content: [{ type: "text", text: formatError(error) }] };
    }
  }
);

// ============================================================================
// TOOL: codecks_subscribe_card
// ============================================================================
server.registerTool(
  TOOL_SUBSCRIBE_CARD,
  {
    title: "Subscribe to Card",
    description: "Subscribe to card updates.",
    inputSchema: schemas.SubscribeCardSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    }
  },
  async (params: schemas.SubscribeCardInput) => {
    try {
      const client = getClient();
      const userId = params.user_id || await resolveCurrentUserId(client);
      if (!userId) {
        return {
          content: [{ type: "text", text: "Error: Unable to resolve required user_id for subscribe_card." }]
        };
      }
      const response = await client.dispatch("watchings/addCard", {
        sessionId: params.session_id || undefined,
        userId,
        cardId: params.card_id
      });
      const payload = { card_id: params.card_id, response };
      const text = params.response_format === ResponseFormat.JSON
        ? JSON.stringify(payload, null, 2)
        : `Subscribed to card ${params.card_id}.`;
      return {
        content: [{ type: "text", text }],
        structuredContent: params.response_format === ResponseFormat.JSON ? payload : undefined
      };
    } catch (error) {
      return { content: [{ type: "text", text: formatError(error) }] };
    }
  }
);

// ============================================================================
// TOOL: codecks_unsubscribe_card
// ============================================================================
server.registerTool(
  TOOL_UNSUBSCRIBE_CARD,
  {
    title: "Unsubscribe from Card",
    description: "Unsubscribe from card updates.",
    inputSchema: schemas.UnsubscribeCardSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    }
  },
  async (params: schemas.UnsubscribeCardInput) => {
    try {
      const client = getClient();
      const userId = params.user_id || await resolveCurrentUserId(client);
      if (!userId) {
        return {
          content: [{ type: "text", text: "Error: Unable to resolve required user_id for unsubscribe_card." }]
        };
      }
      const response = await client.dispatch("watchings/removeCard", {
        sessionId: params.session_id || undefined,
        userId,
        cardId: params.card_id
      });
      const payload = { card_id: params.card_id, response };
      const text = params.response_format === ResponseFormat.JSON
        ? JSON.stringify(payload, null, 2)
        : `Unsubscribed from card ${params.card_id}.`;
      return {
        content: [{ type: "text", text }],
        structuredContent: params.response_format === ResponseFormat.JSON ? payload : undefined
      };
    } catch (error) {
      return { content: [{ type: "text", text: formatError(error) }] };
    }
  }
);

// ============================================================================
// TOOL: codecks_subscribe_deck
// ============================================================================
server.registerTool(
  TOOL_SUBSCRIBE_DECK,
  {
    title: "Subscribe to Deck",
    description: "Subscribe to deck updates.",
    inputSchema: schemas.SubscribeDeckSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    }
  },
  async (params: schemas.SubscribeDeckInput) => {
    try {
      const client = getClient();
      const userId = params.user_id || await resolveCurrentUserId(client);
      if (!userId) {
        return {
          content: [{ type: "text", text: "Error: Unable to resolve required user_id for subscribe_deck." }]
        };
      }
      const response = await client.dispatch("watchings/addDeck", {
        sessionId: params.session_id || undefined,
        userId,
        id: params.deck_id
      });
      const payload = { deck_id: params.deck_id, response };
      const text = params.response_format === ResponseFormat.JSON
        ? JSON.stringify(payload, null, 2)
        : `Subscribed to deck ${params.deck_id}.`;
      return {
        content: [{ type: "text", text }],
        structuredContent: params.response_format === ResponseFormat.JSON ? payload : undefined
      };
    } catch (error) {
      return { content: [{ type: "text", text: formatError(error) }] };
    }
  }
);

// ============================================================================
// TOOL: codecks_unsubscribe_deck
// ============================================================================
server.registerTool(
  TOOL_UNSUBSCRIBE_DECK,
  {
    title: "Unsubscribe from Deck",
    description: "Unsubscribe from deck updates.",
    inputSchema: schemas.UnsubscribeDeckSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    }
  },
  async (params: schemas.UnsubscribeDeckInput) => {
    try {
      const client = getClient();
      const userId = params.user_id || await resolveCurrentUserId(client);
      if (!userId) {
        return {
          content: [{ type: "text", text: "Error: Unable to resolve required user_id for unsubscribe_deck." }]
        };
      }
      const response = await client.dispatch("watchings/removeDeck", {
        sessionId: params.session_id || undefined,
        userId,
        id: params.deck_id
      });
      const payload = { deck_id: params.deck_id, response };
      const text = params.response_format === ResponseFormat.JSON
        ? JSON.stringify(payload, null, 2)
        : `Unsubscribed from deck ${params.deck_id}.`;
      return {
        content: [{ type: "text", text }],
        structuredContent: params.response_format === ResponseFormat.JSON ? payload : undefined
      };
    } catch (error) {
      return { content: [{ type: "text", text: formatError(error) }] };
    }
  }
);
// ============================================================================
// TOOL: codecks_create_card
// ============================================================================
server.registerTool(
  TOOL_CREATE_CARD,
  {
    title: "Create Codecks Card",
    description: `Create a new card in Codecks.

Creates a new task card with specified content and properties. The first line of content becomes the card title.

Args:
  - content (string): Card content (first line becomes title)
  - deck_id (string, optional): Deck to place card in
  - assignee_id (string, optional): User ID to assign card to
  - effort (number, optional): Effort/complexity points
  - priority ('a'|'b'|'c', optional): Priority (a=high, b=medium, c=low)
  - milestone_id (string, optional): Milestone to assign card to
  - put_on_hand (boolean): Whether to add card to your hand (default: false)
  - user_id (string): Your user ID (required for creating cards)

Returns:
  The created card with its new ID.

Error Handling:
  - Returns validation errors if parameters are invalid
  - Returns permission errors if you can't create cards in the specified deck`,
    inputSchema: schemas.CreateCardSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    }
  },
  async (params: schemas.CreateCardInput) => {
    try {
      const client = getClient();

      const data = {
        sessionId: params.session_id || undefined,
        assigneeId: params.assignee_id || null,
        content: params.content,
        subscribeCreator: params.subscribe_creator,
        deckId: params.deck_id || null,
        putInQueue: params.put_in_queue,
        addAsBookmark: params.add_as_bookmark,
        milestoneId: params.milestone_id || null,
        sprintId: params.sprint_id || null,
        masterTags: params.master_tags || [],
        attachments: params.attachments || [],
        effort: params.effort ?? null,
        priority: params.priority || null,
        childCards: params.child_cards || [],
        inDeps: params.in_deps || [],
        outDeps: params.out_deps || [],
        isDoc: params.is_doc,
        parentCardId: params.parent_card_id || null,
        userId: params.user_id,
        fakeCoverFileId: params.fake_cover_file_id || null,
        putOnHand: params.put_on_hand
      };

      const response = await client.dispatch("cards/create", data);
      const responseRecord = (response ?? {}) as Record<string, unknown>;
      const payload = responseRecord.payload as Record<string, unknown> | undefined;
      const card = responseRecord.card as Record<string, unknown> | undefined;
      const createdCardId =
        (typeof responseRecord.cardId === "string" ? responseRecord.cardId : undefined) ||
        (typeof responseRecord.id === "string" ? responseRecord.id : undefined) ||
        (payload && typeof payload.cardId === "string" ? payload.cardId : undefined) ||
        (payload && typeof payload.id === "string" ? payload.id : undefined) ||
        (card && typeof card.id === "string" ? card.id : undefined);
      let childLinksApplied = false;
      let childLinksError: string | undefined;
      if (createdCardId && params.child_cards && params.child_cards.length > 0) {
        try {
          await client.dispatch("cards/update", {
            id: createdCardId,
            childCards: params.child_cards,
            sessionId: params.session_id || undefined
          });
          childLinksApplied = true;
        } catch (error) {
          childLinksError = formatError(error);
        }
      }

      const successText = createdCardId
        ? `Card created successfully! ID: ${createdCardId}${
            params.child_cards && params.child_cards.length > 0
              ? childLinksApplied
                ? " Child links applied."
                : childLinksError
                  ? ` Warning: child link assignment failed (${childLinksError}).`
                  : ""
              : ""
          }`
        : "Card created successfully, but no card ID was returned by the API response.";

      return {
        content: [{ 
          type: "text", 
          text: successText
        }],
        structuredContent: {
          ...responseRecord,
          ...(params.child_cards && params.child_cards.length > 0
            ? {
                childLinks: {
                  requested: params.child_cards,
                  applied: childLinksApplied,
                  error: childLinksError
                }
              }
            : {}),
          ...(createdCardId ? { cardId: createdCardId } : {})
        }
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: formatError(error) }]
      };
    }
  }
);

// ============================================================================
// TOOL: codecks_bulk_update_cards
// ============================================================================
server.registerTool(
  TOOL_BULK_UPDATE_CARDS,
  {
    title: "Bulk Update Codecks Cards",
    description: `Update multiple cards at once (status change and/or move to deck).

Args:
  - ids (string[]): Card IDs to update
  - status (enum, optional): New workflow status
  - deck_id (string, optional): Move cards to this deck
  - milestone_id (string, optional): Assign cards to this milestone
  - session_id (string, optional): Client session ID from web app

Returns:
  API response payload with update results.`,
    inputSchema: schemas.BulkUpdateCardsSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    }
  },
  async (params: schemas.BulkUpdateCardsInput) => {
    try {
      const client = getClient();

      const data: Record<string, unknown> = {
        sessionId: params.session_id || undefined,
        ids: params.ids
      };

      if (params.status) {
        data.status = params.status;
      }

      if (params.deck_id) {
        data.deckId = params.deck_id;
      }

      if (params.milestone_id) {
        data.milestoneId = params.milestone_id;
      }

      const response = await client.dispatch("cards/bulkUpdate", data);

      return {
        content: [{ type: "text", text: "Cards updated successfully." }],
        structuredContent: response
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: formatError(error) }]
      };
    }
  }
);

// ============================================================================
// TOOL: codecks_update_card
// ============================================================================
server.registerTool(
  TOOL_UPDATE_CARD,
  {
    title: "Update Codecks Card",
    description: `Update a single card's workflow fields.

Uses the same mutation path as bulk updates but scoped to one card.

Args:
  - card_id (string): Card ID to update
  - status (string, optional): Updated workflow status
  - deck_id (string, optional): Move card to the specified deck ID
  - milestone_id (string, optional): Assign card to the specified milestone ID
  - parent_card_id (string | null, optional): Link card to a parent card ID; null unlinks parent
  - child_cards (string[], optional): Set/replace child card IDs on this card (use [] to clear all children)
  - content (string, optional): Updated card content/body
  - assignee_id (string | null, optional): Updated assignee user ID; null clears assignee
  - session_id (string, optional): Client session ID from web app

Returns:
  API response payload with update results and best-effort refreshed card data.`,
    inputSchema: schemas.UpdateCardSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    }
  },
  async (params: schemas.UpdateCardInput) => {
    try {
      const client = getClient();
      const responses: Record<string, unknown> = {};
      let applied = 0;

      const workflowData: Record<string, unknown> = {
        sessionId: params.session_id || undefined,
        ids: [params.card_id]
      };

      if (params.status) {
        workflowData.status = params.status;
      }
      if (params.deck_id) {
        workflowData.deckId = params.deck_id;
      }
      if (params.milestone_id) {
        workflowData.milestoneId = params.milestone_id;
      }

      if (params.status || params.deck_id || params.milestone_id) {
        responses.workflow_update = await client.dispatch("cards/bulkUpdate", workflowData);
        applied += 1;
      }

      if (
        params.content !== undefined ||
        params.assignee_id !== undefined ||
        params.parent_card_id !== undefined ||
        params.child_cards !== undefined
      ) {
        const directData: Record<string, unknown> = {
          id: params.card_id,
          sessionId: params.session_id || undefined
        };
        if (params.content !== undefined) {
          directData.content = params.content;
        }
        if (params.assignee_id !== undefined) {
          directData.assigneeId = params.assignee_id;
        }
        if (params.parent_card_id !== undefined) {
          directData.parentCardId = params.parent_card_id;
        }
        if (params.child_cards !== undefined) {
          directData.childCards = params.child_cards;
        }
        responses.direct_update = await client.dispatch("cards/update", directData);
        applied += 1;
      }

      const cardSelection: Selection[] = [
        "id",
        "accountSeq",
        "title",
        "derivedStatus",
        "visibility",
        "effort",
        "priority",
        "createdAt",
        "lastUpdatedAt",
        { deck: ["id", "title"] },
        { milestone: ["id", "name"] },
        { assignee: ["id", "name"] }
      ];
      let card: Record<string, any> | null = null;
      try {
        const query = buildIdQuery(schema, "card", [params.card_id], cardSelection);
        const refreshed = await client.query(query);
        card = denormalizeById(
          schema,
          refreshed as Record<string, any>,
          "card",
          params.card_id,
          cardSelection
        ) as Record<string, any> | null;
        if (card) {
          card = normalizeCardId(card, params.card_id);
        }
      } catch {
        // Non-fatal: dispatch already succeeded.
      }

      return {
        content: [{ type: "text", text: `Card updated successfully (${applied} operation${applied === 1 ? "" : "s"}).` }],
        structuredContent: {
          card_id: params.card_id,
          responses,
          card
        }
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: formatError(error) }]
      };
    }
  }
);

// ============================================================================
// TOOL: codecks_list_decks
// ============================================================================
server.registerTool(
  TOOL_LIST_DECKS,
  {
    title: "List Codecks Decks",
    description: `List all decks in your Codecks account.

Retrieves all decks (card containers) from your Codecks organization, optionally filtered by project.

Args:
  - project_id (string, optional): Filter by specific project ID
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  List of decks with their IDs, names, types, and associated projects.

Examples:
  - List all decks across all projects
  - List decks in a specific project`,
    inputSchema: schemas.ListDecksSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true
    }
  },
  async (params: schemas.ListDecksInput) => {
    try {
      const client = getClient();

      // Codecks API does not support server-side projectId filtering on decks,
      // so we always fetch all decks with the project relation and filter locally.
      const deckSelection: Selection[] = [
        "title",
        "deckType",
        "accountSeq",
        "description",
        "createdAt",
        { project: ["id", "name"] }
      ];

      const accountSelection: Selection[] = [{ decks: deckSelection }];
      const query = buildRootQuery(schema, "account", accountSelection);

      const response = await client.query(query);
      const account = denormalizeRootRelation(schema, response as Record<string, any>, "account", accountSelection);
      let decks = account?.decks || [];

      // Client-side project filter
      if (params.project_id) {
        decks = decks.filter((d: any) => {
          const pid = typeof d.project === "object" ? d.project?.id : d.project;
          return pid === params.project_id;
        });
      }

      let formatted = format.formatDeckList(decks, params.response_format, params.response_mode);
      let { content, truncated } = format.checkAndTruncate(formatted, decks.length, {
        responseMode: params.response_mode,
        totalItems: decks.length
      });
      let responseModeUsed = params.response_mode;

      if (
        truncated &&
        params.response_format === ResponseFormat.MARKDOWN &&
        params.response_mode === ResponseMode.FULL
      ) {
        formatted = format.formatDeckList(decks, params.response_format, ResponseMode.COMPACT);
        const compactResult = format.checkAndTruncate(formatted, decks.length, {
          responseMode: ResponseMode.COMPACT,
          totalItems: decks.length
        });
        content = compactResult.content;
        truncated = compactResult.truncated;
        responseModeUsed = ResponseMode.COMPACT;
      }

      trackToolUsage(TOOL_LIST_DECKS, content);
      return {
        content: [{ type: "text", text: content }],
        structuredContent: params.response_format === ResponseFormat.JSON
          ? { decks, truncated, response_mode_used: responseModeUsed }
          : undefined
      };
    } catch (error) {
      const message = formatError(error);
      trackToolUsage(TOOL_LIST_DECKS, message, true);
      return {
        content: [{ type: "text", text: formatError(error) }]
      };
    }
  }
);

// ============================================================================
// TOOL: codecks_get_deck
// ============================================================================
server.registerTool(
  TOOL_GET_DECK,
  {
    title: "Get Codecks Deck",
    description: `Retrieve detailed information about a specific deck.

Fetches deck metadata including name, type, description, project, and archival state.

Args:
  - deck_id (string): The deck ID to retrieve
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  Complete deck details including fields and relationships.`,
    inputSchema: schemas.GetDeckSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true
    }
  },
  async (params: schemas.GetDeckInput) => {
    try {
      const client = getClient();

      const deckSelection: Selection[] = [
        "id",
        "title",
        "deckType",
        "accountSeq",
        "description",
        "createdAt",
        { project: ["id", "name"] }
      ];

      // Codecks expects deck ID lookup as a single-item array; plain string ID can 500.
      const query = buildIdQuery(schema, "deck", [params.deck_id], deckSelection);
      const response = await client.query(query);
      const deck = denormalizeById(
        schema,
        response as Record<string, any>,
        "deck",
        params.deck_id,
        deckSelection
      );

      if (!deck) {
        return {
          content: [{ type: "text", text: `Error: Deck with ID '${params.deck_id}' not found.` }]
        };
      }

      const formatted = format.formatDeck(deck, params.response_format);

      return {
        content: [{ type: "text", text: formatted }],
        structuredContent: params.response_format === ResponseFormat.JSON ? deck : undefined
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: formatError(error) }]
      };
    }
  }
);

// ============================================================================
// TOOL: codecks_create_deck
// ============================================================================
server.registerTool(
  TOOL_CREATE_DECK,
  {
    title: "Create Codecks Deck",
    description: `Create a new deck in Codecks.

Args:
  - title (string): Deck title
  - project_id (string): Project ID for the deck
  - user_id (string): Your user ID
  - space_id (number): Space ID
  - deck_type (string, optional): Deck type (e.g., hero, mixed)
  - cover_file_data (object, optional): Cover file metadata
  - session_id (string, optional): Client session ID from web app

Returns:
  API response payload with the created deck.`,
    inputSchema: schemas.CreateDeckSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    }
  },
  async (params: schemas.CreateDeckInput) => {
    try {
      const client = getClient();

      const data = {
        sessionId: params.session_id || undefined,
        title: params.title,
        deckType: params.deck_type || undefined,
        coverFileData: params.cover_file_data ?? null,
        projectId: params.project_id,
        userId: params.user_id,
        spaceId: params.space_id
      };

      const response = await client.dispatch("decks/create", data);

      return {
        content: [{ type: "text", text: "Deck created successfully." }],
        structuredContent: response
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: formatError(error) }]
      };
    }
  }
);

// ============================================================================
// TOOL: codecks_add_decks_to_space_after
// ============================================================================
server.registerTool(
  TOOL_ADD_DECKS_TO_SPACE,
  {
    title: "Reorder Decks in a Space",
    description: `Move decks to a position after a target deck inside a space.

Args:
  - deck_ids (string[]): Deck IDs to move
  - target_id (string): Target deck ID to insert after
  - target_project_id (string): Target project ID
  - target_space_id (number): Target space ID
  - session_id (string, optional): Client session ID from web app

Returns:
  API response payload with ordering results.`,
    inputSchema: schemas.AddDecksToSpaceAfterSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    }
  },
  async (params: schemas.AddDecksToSpaceAfterInput) => {
    try {
      const client = getClient();

      const data = {
        sessionId: params.session_id || undefined,
        deckIds: params.deck_ids,
        targetId: params.target_id,
        targetProjectId: params.target_project_id,
        targetSpaceId: params.target_space_id
      };

      const response = await client.dispatch("decks/addToSpaceAfter", data);

      return {
        content: [{ type: "text", text: "Decks reordered successfully." }],
        structuredContent: response
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: formatError(error) }]
      };
    }
  }
);

// ============================================================================
// TOOL: codecks_update_deck
// ============================================================================
server.registerTool(
  TOOL_UPDATE_DECK,
  {
    title: "Update Codecks Deck",
    description: `Update mutable deck fields.

Args:
  - deck_id (string): Deck ID to update
  - title (string, optional): Updated deck title
  - deck_type (string, optional): Updated deck type (e.g., hero, mixed, task)
  - session_id (string, optional): Client session ID from web app

Returns:
  Dispatch metadata and refreshed deck details.`,
    inputSchema: schemas.UpdateDeckSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    }
  },
  async (params: schemas.UpdateDeckInput) => {
    try {
      const client = getClient();
      const data = {
        id: params.deck_id,
        title: params.title,
        deckType: params.deck_type,
        sessionId: params.session_id || undefined
      };

      const response = await client.dispatch("decks/update", data);

      const deckSelection: Selection[] = [
        "id",
        "title",
        "deckType",
        "spaceId",
        "isDeleted",
        { project: ["id", "name"] }
      ];
      const query = buildIdQuery(schema, "deck", [params.deck_id], deckSelection);
      const refreshed = await client.query(query);
      const deck = denormalizeById(
        schema,
        refreshed as Record<string, any>,
        "deck",
        params.deck_id,
        deckSelection
      );

      return {
        content: [{ type: "text", text: "Deck updated successfully." }],
        structuredContent: {
          deck,
          response
        }
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: formatError(error) }]
      };
    }
  }
);

// ============================================================================
// TOOL: codecks_delete_deck
// ============================================================================
server.registerTool(
  TOOL_DELETE_DECK,
  {
    title: "Delete Codecks Deck",
    description: `Delete/archive a deck by ID.

Args:
  - deck_id (string): Deck ID to delete/archive
  - session_id (string, optional): Client session ID from web app

Returns:
  Dispatch metadata and post-delete deck state (including isDeleted when available).`,
    inputSchema: schemas.DeleteDeckSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true
    }
  },
  async (params: schemas.DeleteDeckInput) => {
    try {
      const client = getClient();
      const response = await client.dispatch("decks/delete", {
        id: params.deck_id,
        sessionId: params.session_id || undefined
      });

      const deckSelection: Selection[] = ["id", "title", "deckType", "spaceId", "isDeleted"];
      const query = buildIdQuery(schema, "deck", [params.deck_id], deckSelection);
      const refreshed = await client.query(query);
      const deck = denormalizeById(
        schema,
        refreshed as Record<string, any>,
        "deck",
        params.deck_id,
        deckSelection
      );

      return {
        content: [{ type: "text", text: "Deck deleted successfully." }],
        structuredContent: {
          deck,
          response
        }
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: formatError(error) }]
      };
    }
  }
);

// ============================================================================
// TOOL: codecks_list_spaces
// ============================================================================
server.registerTool(
  TOOL_LIST_SPACES,
  {
    title: "List Codecks Spaces",
    description: `List project spaces from your Codecks account.

Spaces are read from each project's \`spaces\` field and returned with project context.

Args:
  - project_id (string, optional): Restrict spaces to a single project
  - include_archived (boolean): Include archived projects (default: false)
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  List of spaces with numeric ID, name, icon, default deck type, and owning project.`,
    inputSchema: schemas.ListSpacesSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true
    }
  },
  async (params: schemas.ListSpacesInput) => {
    try {
      const client = getClient();

      const projectSelection: Selection[] = ["id", "name", "visibility", "spaces"];
      const projectRelation = params.include_archived ? "anyProjects" : "projects";
      const accountSelection: Selection[] = [{ [projectRelation]: projectSelection }];
      validateSelection(schema, "account", accountSelection);

      const query = buildRootQuery(schema, "account", accountSelection);
      const response = await client.query(query);
      const account = denormalizeRootRelation(schema, response as Record<string, any>, "account", accountSelection);

      let projects = account?.[projectRelation] || [];
      if (params.project_id) {
        projects = projects.filter((project: any) => project?.id === params.project_id);
      }

      const spaces = projects.flatMap((project: any) => normalizeSpacesFromProject(project));

      let formatted = format.formatSpaceList(spaces, params.response_format, params.response_mode);
      let { content, truncated } = format.checkAndTruncate(formatted, spaces.length, {
        responseMode: params.response_mode,
        totalItems: spaces.length
      });
      let responseModeUsed = params.response_mode;

      if (
        truncated &&
        params.response_format === ResponseFormat.MARKDOWN &&
        params.response_mode === ResponseMode.FULL
      ) {
        formatted = format.formatSpaceList(spaces, params.response_format, ResponseMode.COMPACT);
        const compactResult = format.checkAndTruncate(formatted, spaces.length, {
          responseMode: ResponseMode.COMPACT,
          totalItems: spaces.length
        });
        content = compactResult.content;
        truncated = compactResult.truncated;
        responseModeUsed = ResponseMode.COMPACT;
      }

      trackToolUsage(TOOL_LIST_SPACES, content);
      return {
        content: [{ type: "text", text: content }],
        structuredContent: params.response_format === ResponseFormat.JSON
          ? { spaces, truncated, response_mode_used: responseModeUsed }
          : undefined
      };
    } catch (error) {
      const message = formatError(error);
      trackToolUsage(TOOL_LIST_SPACES, message, true);
      return {
        content: [{ type: "text", text: message }]
      };
    }
  }
);

// ============================================================================
// TOOL: codecks_get_space
// ============================================================================
server.registerTool(
  TOOL_GET_SPACE,
  {
    title: "Get Codecks Space",
    description: `Retrieve a single space from a project by numeric space ID.

Args:
  - project_id (string): Project ID that owns the space
  - space_id (number): Numeric space ID within that project
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  Space details including name, icon, default deck type, and owning project.`,
    inputSchema: schemas.GetSpaceSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true
    }
  },
  async (params: schemas.GetSpaceInput) => {
    try {
      const client = getClient();

      const projectSelection: Selection[] = ["id", "name", "visibility", "spaces"];
      const query = buildIdQuery(schema, "project", [params.project_id], projectSelection);
      const response = await client.query(query);
      const project = denormalizeById(
        schema,
        response as Record<string, any>,
        "project",
        params.project_id,
        projectSelection
      );

      if (!project) {
        const message = `Error: Project with ID '${params.project_id}' not found.`;
        trackToolUsage(TOOL_GET_SPACE, message, true);
        return {
          content: [{ type: "text", text: message }]
        };
      }

      const spaces = normalizeSpacesFromProject(project);
      const space = spaces.find((entry: any) => entry.id === params.space_id);

      if (!space) {
        const message = `Error: Space ID '${params.space_id}' not found in project '${params.project_id}'.`;
        trackToolUsage(TOOL_GET_SPACE, message, true);
        return {
          content: [{ type: "text", text: message }]
        };
      }

      const formatted = format.formatSpace(space, params.response_format);
      trackToolUsage(TOOL_GET_SPACE, formatted);
      return {
        content: [{ type: "text", text: formatted }],
        structuredContent: params.response_format === ResponseFormat.JSON ? space : undefined
      };
    } catch (error) {
      const message = formatError(error);
      trackToolUsage(TOOL_GET_SPACE, message, true);
      return {
        content: [{ type: "text", text: message }]
      };
    }
  }
);

// ============================================================================
// TOOL: codecks_create_space
// ============================================================================
server.registerTool(
  TOOL_CREATE_SPACE,
  {
    title: "Create Codecks Space",
    description: `Create a new space within an existing project.

Implementation note: this updates the project's \`spaces\` array via \`projects/update\`.

Args:
  - project_id (string): Project ID that will own the new space
  - name (string): Space name
  - icon (string | null, optional): Optional icon slug (e.g., tasks, gdd)
  - default_deck_type (string): Default deck type for decks in this space (default: task)
  - session_id (string, optional): Client session ID from web app

Returns:
  The created space with its numeric \`space_id\` and project context.`,
    inputSchema: schemas.CreateSpaceSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    }
  },
  async (params: schemas.CreateSpaceInput) => {
    try {
      const client = getClient();
      const project = await getProjectWithSpaces(client, params.project_id);
      if (!project) {
        return {
          content: [{ type: "text", text: `Error: Project with ID '${params.project_id}' not found.` }]
        };
      }

      const rawSpaces = getRawProjectSpaces(project);
      const nextSpaceId = rawSpaces.reduce((max: number, space: any) => Math.max(max, Number(space?.id) || 0), 0) + 1;
      const newSpace = {
        id: nextSpaceId,
        name: params.name,
        icon: params.icon ?? null,
        defaultDeckType: params.default_deck_type
      };

      const response = await client.dispatch("projects/update", {
        id: params.project_id,
        sessionId: params.session_id || undefined,
        spaces: [...rawSpaces, newSpace]
      });

      const updatedProject = await getProjectWithSpaces(client, params.project_id);
      const createdSpace = normalizeSpacesFromProject(updatedProject || project)
        .find((space: any) => space.id === nextSpaceId);

      return {
        content: [{ type: "text", text: `Space created successfully with ID ${nextSpaceId}.` }],
        structuredContent: {
          space: createdSpace || {
            ...newSpace,
            project: { id: project.id, name: project.name, visibility: project.visibility }
          },
          response
        }
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: formatError(error) }]
      };
    }
  }
);

// ============================================================================
// TOOL: codecks_update_space
// ============================================================================
server.registerTool(
  TOOL_UPDATE_SPACE,
  {
    title: "Update Codecks Space",
    description: `Update an existing space within a project.

Implementation note: this updates the project's \`spaces\` array via \`projects/update\`.

Args:
  - project_id (string): Project ID that owns the space
  - space_id (number): Numeric space ID to update
  - name (string, optional): Updated name
  - icon (string | null, optional): Updated icon slug, or null to clear
  - default_deck_type (string, optional): Updated default deck type
  - session_id (string, optional): Client session ID from web app

Returns:
  The updated space object with project context.`,
    inputSchema: schemas.UpdateSpaceSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    }
  },
  async (params: schemas.UpdateSpaceInput) => {
    try {
      const client = getClient();
      const project = await getProjectWithSpaces(client, params.project_id);
      if (!project) {
        return {
          content: [{ type: "text", text: `Error: Project with ID '${params.project_id}' not found.` }]
        };
      }

      const rawSpaces = getRawProjectSpaces(project);
      const hasTargetSpace = rawSpaces.some((space: any) => Number(space?.id) === params.space_id);
      if (!hasTargetSpace) {
        return {
          content: [{ type: "text", text: `Error: Space ID '${params.space_id}' not found in project '${params.project_id}'.` }]
        };
      }

      const nextSpaces = rawSpaces.map((space: any) => {
        if (Number(space?.id) !== params.space_id) {
          return space;
        }
        const updated = { ...space };
        if (params.name !== undefined) {
          updated.name = params.name;
        }
        if (params.icon !== undefined) {
          updated.icon = params.icon;
        }
        if (params.default_deck_type !== undefined) {
          updated.defaultDeckType = params.default_deck_type;
        }
        return updated;
      });

      const response = await client.dispatch("projects/update", {
        id: params.project_id,
        sessionId: params.session_id || undefined,
        spaces: nextSpaces
      });

      const updatedProject = await getProjectWithSpaces(client, params.project_id);
      const updatedSpace = normalizeSpacesFromProject(updatedProject || project)
        .find((space: any) => space.id === params.space_id);

      return {
        content: [{ type: "text", text: `Space ${params.space_id} updated successfully.` }],
        structuredContent: {
          space: updatedSpace || null,
          response
        }
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: formatError(error) }]
      };
    }
  }
);

// ============================================================================
// TOOL: codecks_delete_space
// ============================================================================
server.registerTool(
  TOOL_DELETE_SPACE,
  {
    title: "Delete Codecks Space",
    description: `Delete a space from a project.

Implementation note: this removes an entry from the project's \`spaces\` array via \`projects/update\`.

Args:
  - project_id (string): Project ID that owns the space
  - space_id (number): Numeric space ID to delete
  - session_id (string, optional): Client session ID from web app

Returns:
  Confirmation and metadata about the deleted space.`,
    inputSchema: schemas.DeleteSpaceSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true
    }
  },
  async (params: schemas.DeleteSpaceInput) => {
    try {
      const client = getClient();
      const project = await getProjectWithSpaces(client, params.project_id);
      if (!project) {
        return {
          content: [{ type: "text", text: `Error: Project with ID '${params.project_id}' not found.` }]
        };
      }

      const normalizedBefore = normalizeSpacesFromProject(project);
      const deletedSpace = normalizedBefore.find((space: any) => space.id === params.space_id);
      if (!deletedSpace) {
        return {
          content: [{ type: "text", text: `Error: Space ID '${params.space_id}' not found in project '${params.project_id}'.` }]
        };
      }

      const rawSpaces = getRawProjectSpaces(project);
      const nextSpaces = rawSpaces.filter((space: any) => Number(space?.id) !== params.space_id);

      const response = await client.dispatch("projects/update", {
        id: params.project_id,
        sessionId: params.session_id || undefined,
        spaces: nextSpaces
      });

      const updatedProject = await getProjectWithSpaces(client, params.project_id);
      const remainingSpaces = normalizeSpacesFromProject(updatedProject || { spaces: nextSpaces, ...project });

      return {
        content: [{ type: "text", text: `Space ${params.space_id} deleted successfully.` }],
        structuredContent: {
          deleted_space: deletedSpace,
          remaining_space_count: remainingSpaces.length,
          response
        }
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: formatError(error) }]
      };
    }
  }
);

// ============================================================================
// TOOL: codecks_list_projects
// ============================================================================
server.registerTool(
  TOOL_LIST_PROJECTS,
  {
    title: "List Codecks Projects",
    description: `List all projects in your Codecks account.

Retrieves all projects from your Codecks organization.

Args:
  - include_archived (boolean): Include archived projects (default: false)
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  List of projects with their IDs, names, and visibility status (default, archived, deleted, etc.).`,
    inputSchema: schemas.ListProjectsSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true
    }
  },
  async (params: schemas.ListProjectsInput) => {
    try {
      const client = getClient();

      const projectSelection: Selection[] = ["id", "name", "visibility"];
      // Use server-side filtering: 'projects' excludes archived, 'anyProjects' includes all
      const projectRelation = params.include_archived ? "anyProjects" : "projects";
      const accountSelection: Selection[] = [
        { [projectRelation]: projectSelection }
      ];
      validateSelection(schema, "account", accountSelection);

      const query = buildRootQuery(schema, "account", accountSelection);

      const response = await client.query(query);
      const account = denormalizeRootRelation(schema, response as Record<string, any>, "account", accountSelection);
      const projects = account?.[projectRelation] || [];

      let formatted = format.formatProjectList(projects, params.response_format, params.response_mode);
      let { content, truncated } = format.checkAndTruncate(formatted, projects.length, {
        responseMode: params.response_mode,
        totalItems: projects.length
      });
      let responseModeUsed = params.response_mode;

      if (
        truncated &&
        params.response_format === ResponseFormat.MARKDOWN &&
        params.response_mode === ResponseMode.FULL
      ) {
        formatted = format.formatProjectList(projects, params.response_format, ResponseMode.COMPACT);
        const compactResult = format.checkAndTruncate(formatted, projects.length, {
          responseMode: ResponseMode.COMPACT,
          totalItems: projects.length
        });
        content = compactResult.content;
        truncated = compactResult.truncated;
        responseModeUsed = ResponseMode.COMPACT;
      }

      trackToolUsage(TOOL_LIST_PROJECTS, content);
      return {
        content: [{ type: "text", text: content }],
        structuredContent: params.response_format === ResponseFormat.JSON
          ? { projects, truncated, response_mode_used: responseModeUsed }
          : undefined
      };
    } catch (error) {
      const message = formatError(error);
      trackToolUsage(TOOL_LIST_PROJECTS, message, true);
      return {
        content: [{ type: "text", text: formatError(error) }]
      };
    }
  }
);

// ============================================================================
// TOOL: codecks_create_project
// ============================================================================
server.registerTool(
  TOOL_CREATE_PROJECT,
  {
    title: "Create Codecks Project",
    description: `Create a new project in Codecks.

Args:
  - name (string): Project name
  - default_user_access (enum, optional): Default access for users (everyone | onlyMembers)
  - template_id (string, optional): Template ID (e.g., cdx/survival)
  - file_id (string, optional): Cover file ID
  - session_id (string, optional): Client session ID from web app

Returns:
  API response payload with the created project.`,
    inputSchema: schemas.CreateProjectSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    }
  },
  async (params: schemas.CreateProjectInput) => {
    try {
      const client = getClient();

      const data = {
        sessionId: params.session_id || undefined,
        name: params.name,
        fileId: params.file_id ?? null,
        defaultUserAccess: params.default_user_access,
        templateId: params.template_id ?? null
      };

      const response = await client.dispatch("projects/create", data);

      return {
        content: [{ type: "text", text: "Project created successfully." }],
        structuredContent: response
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: formatError(error) }]
      };
    }
  }
);

// ============================================================================
// TOOL: codecks_set_project_visibility
// ============================================================================
server.registerTool(
  TOOL_SET_PROJECT_VISIBILITY,
  {
    title: "Set Codecks Project Visibility",
    description: `Update a project's visibility (including deletion).

Args:
  - project_id (string): Project ID
  - visibility (enum, optional): deleted | archived | private | public (default: deleted)
  - session_id (string, optional): Client session ID from web app

Returns:
  API response payload with the update result.`,
    inputSchema: schemas.SetProjectVisibilitySchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true
    }
  },
  async (params: schemas.SetProjectVisibilityInput) => {
    try {
      const client = getClient();

      const data = {
        sessionId: params.session_id || undefined,
        id: params.project_id,
        visibility: params.visibility
      };

      const response = await client.dispatch("projects/setVisibility", data);

      return {
        content: [{ type: "text", text: "Project visibility updated successfully." }],
        structuredContent: response
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: formatError(error) }]
      };
    }
  }
);

// ============================================================================
// TOOL: codecks_list_milestones
// ============================================================================
server.registerTool(
  TOOL_LIST_MILESTONES,
  {
    title: "List Codecks Milestones",
    description: `List all milestones in your Codecks account.

Retrieves all milestones (delivery date markers) from your Codecks organization.

Args:
  - include_deleted (boolean): Include deleted milestones (default: false)
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  List of milestones with their IDs, names, due dates, and descriptions.`,
    inputSchema: schemas.ListMilestonesSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true
    }
  },
  async (params: schemas.ListMilestonesInput) => {
    try {
      const client = getClient();

      // Codecks uses `date` rather than `dueDate`.
      const milestoneSelection: Selection[] = ["id", "name", "description", "date", "startDate", "isDeleted"];
      const accountSelection: Selection[] = [{ milestones: milestoneSelection }];
      const query = buildRootQuery(schema, "account", accountSelection);

      const response = await client.query(query);
      const account = denormalizeRootRelation(schema, response as Record<string, any>, "account", accountSelection);
      let milestones = account?.milestones || [];
      if (!params.include_deleted) {
        milestones = milestones.filter((milestone: Record<string, unknown>) => milestone?.isDeleted !== true);
      }

      let formatted = format.formatMilestoneList(milestones, params.response_format, params.response_mode);
      let { content, truncated } = format.checkAndTruncate(formatted, milestones.length, {
        responseMode: params.response_mode,
        totalItems: milestones.length
      });
      let responseModeUsed = params.response_mode;

      if (
        truncated &&
        params.response_format === ResponseFormat.MARKDOWN &&
        params.response_mode === ResponseMode.FULL
      ) {
        formatted = format.formatMilestoneList(milestones, params.response_format, ResponseMode.COMPACT);
        const compactResult = format.checkAndTruncate(formatted, milestones.length, {
          responseMode: ResponseMode.COMPACT,
          totalItems: milestones.length
        });
        content = compactResult.content;
        truncated = compactResult.truncated;
        responseModeUsed = ResponseMode.COMPACT;
      }

      trackToolUsage(TOOL_LIST_MILESTONES, content);
      return {
        content: [{ type: "text", text: content }],
        structuredContent: params.response_format === ResponseFormat.JSON
          ? { milestones, truncated, response_mode_used: responseModeUsed }
          : undefined
      };
    } catch (error) {
      const message = formatError(error);
      trackToolUsage(TOOL_LIST_MILESTONES, message, true);
      return {
        content: [{ type: "text", text: formatError(error) }]
      };
    }
  }
);

// ============================================================================
// TOOL: codecks_get_milestone
// ============================================================================
server.registerTool(
  TOOL_GET_MILESTONE,
  {
    title: "Get Codecks Milestone",
    description: `Retrieve detailed information about a specific milestone.

Fetches milestone metadata including name, due date, description, project, and archival state.

Args:
  - milestone_id (string): The milestone ID to retrieve
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  Complete milestone details including fields and relationships.
  Note: Direct ID lookup can return deleted milestones (isDeleted=true).`,
    inputSchema: schemas.GetMilestoneSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true
    }
  },
  async (params: schemas.GetMilestoneInput) => {
    try {
      const client = getClient();

      const milestoneSelection: Selection[] = [
        "id",
        "name",
        "description",
        "date",
        "startDate",
        "isDeleted",
        "createdAt"
      ];

      // Codecks expects milestone ID lookup as a single-item array; plain string ID can 500.
      const query = buildIdQuery(schema, "milestone", [params.milestone_id], milestoneSelection);
      const response = await client.query(query);
      const milestone = denormalizeById(
        schema,
        response as Record<string, any>,
        "milestone",
        params.milestone_id,
        milestoneSelection
      );

      if (!milestone) {
        return {
          content: [
            { type: "text", text: `Error: Milestone with ID '${params.milestone_id}' not found.` }
          ]
        };
      }

      const formatted = format.formatMilestone(milestone, params.response_format);

      return {
        content: [{ type: "text", text: formatted }],
        structuredContent: params.response_format === ResponseFormat.JSON ? milestone : undefined
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: formatError(error) }]
      };
    }
  }
);

// ============================================================================
// TOOL: codecks_create_milestone
// ============================================================================
server.registerTool(
  TOOL_CREATE_MILESTONE,
  {
    title: "Create Codecks Milestone",
    description: `Create a new milestone and link it to one or more projects.

Args:
  - name (string): Milestone name
  - color (string): Milestone color label (default: pink)
  - date (string): Due date in YYYY-MM-DD format
  - start_date (string, optional): Start date in YYYY-MM-DD format
  - is_global (boolean): Whether milestone is global (default: false)
  - project_ids (string[]): Project IDs to link to this milestone
  - user_id (string, optional): Creator user ID (auto-resolved if omitted)
  - account_id (string, optional): Account ID (auto-resolved if omitted)
  - session_id (string, optional): Client session ID from web app`,
    inputSchema: schemas.CreateMilestoneSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    }
  },
  async (params: schemas.CreateMilestoneInput) => {
    try {
      const client = getClient();
      const userId = params.user_id || await resolveCurrentUserId(client);
      const accountId = params.account_id || await resolveAccountId(client);

      if (!userId || !accountId) {
        return {
          content: [{
            type: "text",
            text: "Error: Unable to resolve required user/account IDs for milestone creation."
          }]
        };
      }

      const data: Record<string, unknown> = {
        sessionId: params.session_id || undefined,
        userId,
        accountId,
        name: params.name,
        color: params.color,
        date: params.date,
        isGlobal: params.is_global,
        projectIds: params.project_ids
      };

      if (params.start_date) {
        data.startDate = params.start_date;
      }

      const response = await client.dispatch("milestones/create", data);
      const responseRecord = (response ?? {}) as Record<string, unknown>;
      const payload = responseRecord.payload as Record<string, unknown> | undefined;
      const milestoneId =
        (typeof responseRecord.milestoneId === "string" ? responseRecord.milestoneId : undefined) ||
        (typeof responseRecord.id === "string" ? responseRecord.id : undefined) ||
        (payload && typeof payload.milestoneId === "string" ? payload.milestoneId : undefined) ||
        (payload && typeof payload.id === "string" ? payload.id : undefined);

      const successText = milestoneId
        ? `Milestone created successfully. ID: ${milestoneId}`
        : "Milestone created successfully.";

      return {
        content: [{ type: "text", text: successText }],
        structuredContent: {
          ...responseRecord,
          ...(milestoneId ? { milestoneId } : {})
        }
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: formatError(error) }]
      };
    }
  }
);

// ============================================================================
// TOOL: codecks_create_milestone_project
// ============================================================================
server.registerTool(
  TOOL_CREATE_MILESTONE_PROJECT,
  {
    title: "Link Milestone to Project",
    description: `Create a milestone-project link so a project can use an existing milestone.

This updates the milestone's linked project set via milestones/update.

Args:
  - milestone_id (string): Milestone ID to update
  - project_id (string): Project ID to link
  - session_id (string, optional): Client session ID from web app`,
    inputSchema: schemas.CreateMilestoneProjectSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    }
  },
  async (params: schemas.CreateMilestoneProjectInput) => {
    try {
      const client = getClient();

      const milestoneSelection: Selection[] = [
        "id",
        "isGlobal",
        { milestoneProjects: [{ project: ["id"] }] }
      ];

      const query = buildIdQuery(schema, "milestone", [params.milestone_id], milestoneSelection);
      const response = await client.query(query);
      const milestone = denormalizeById(
        schema,
        response as Record<string, any>,
        "milestone",
        params.milestone_id,
        milestoneSelection
      ) as Record<string, unknown> | null;

      if (!milestone) {
        return {
          content: [{
            type: "text",
            text: `Error: Milestone with ID '${params.milestone_id}' not found.`
          }]
        };
      }

      const existingProjectIds = ((milestone.milestoneProjects as any[]) || [])
        .map((mp) => {
          if (mp && typeof mp === "object") {
            const directProjectId = (mp as Record<string, unknown>).projectId;
            if (typeof directProjectId === "string") {
              return directProjectId;
            }
            const project = (mp as Record<string, unknown>).project;
            if (project && typeof project === "object") {
              const id = (project as Record<string, unknown>).id;
              return typeof id === "string" ? id : undefined;
            }
            return typeof project === "string" ? project : undefined;
          }
          return undefined;
        })
        .filter((id): id is string => Boolean(id));

      if (existingProjectIds.includes(params.project_id)) {
        return {
          content: [{
            type: "text",
            text: `Milestone '${params.milestone_id}' is already linked to project '${params.project_id}'.`
          }],
          structuredContent: {
            milestone_id: params.milestone_id,
            project_id: params.project_id,
            already_linked: true,
            project_ids: existingProjectIds
          }
        };
      }

      const projectIds = [...new Set([...existingProjectIds, params.project_id])];

      const data: Record<string, unknown> = {
        sessionId: params.session_id || undefined,
        id: params.milestone_id,
        isGlobal: milestone.isGlobal,
        projectIds
      };

      const updateResponse = await client.dispatch("milestones/update", data);

      return {
        content: [{
          type: "text",
          text: `Milestone '${params.milestone_id}' linked to project '${params.project_id}' successfully.`
        }],
        structuredContent: {
          milestone_id: params.milestone_id,
          project_id: params.project_id,
          project_ids: projectIds,
          response: updateResponse
        }
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: formatError(error) }]
      };
    }
  }
);

// ============================================================================
// TOOL: codecks_update_milestone
// ============================================================================
server.registerTool(
  TOOL_UPDATE_MILESTONE,
  {
    title: "Update Codecks Milestone",
    description: `Update an existing milestone.

Args:
  - milestone_id (string): Milestone ID to update
  - name, color, date, start_date, hand_sync_enabled, is_global (optional): Updated fields
  - project_ids (string[], optional): Full linked project ID set (requires is_global; auto-resolved if omitted)
  - response_format ('markdown' | 'json'): Output format`,
    inputSchema: schemas.UpdateMilestoneSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    }
  },
  async (params: schemas.UpdateMilestoneInput) => {
    try {
      const client = getClient();
      const data: Record<string, unknown> = {
        sessionId: params.session_id || undefined,
        id: params.milestone_id
      };

      if (params.name !== undefined) data.name = params.name;
      if (params.color !== undefined) data.color = params.color;
      if (params.date !== undefined) data.date = params.date;
      if (params.start_date !== undefined) data.startDate = params.start_date;
      if (params.hand_sync_enabled !== undefined) data.handSyncEnabled = params.hand_sync_enabled;

      if (params.project_ids !== undefined) {
        let isGlobal = params.is_global;
        if (isGlobal === undefined) {
          const milestoneSelection: Selection[] = ["isGlobal"];
          const query = buildIdQuery(schema, "milestone", [params.milestone_id], milestoneSelection);
          const response = await client.query(query);
          const milestone = denormalizeById(
            schema,
            response as Record<string, any>,
            "milestone",
            params.milestone_id,
            milestoneSelection
          ) as Record<string, unknown> | null;
          isGlobal = typeof milestone?.isGlobal === "boolean" ? milestone.isGlobal : undefined;
        }
        if (isGlobal === undefined) {
          return {
            content: [{
              type: "text",
              text: "Error: Unable to resolve milestone is_global value required for project_ids update."
            }]
          };
        }
        data.isGlobal = isGlobal;
        data.projectIds = params.project_ids;
      } else if (params.is_global !== undefined) {
        data.isGlobal = params.is_global;
      }

      const response = await client.dispatch("milestones/update", data);
      const payload = { milestone_id: params.milestone_id, response };
      const text = params.response_format === ResponseFormat.JSON
        ? JSON.stringify(payload, null, 2)
        : `Milestone ${params.milestone_id} updated successfully.`;

      return {
        content: [{ type: "text", text }],
        structuredContent: params.response_format === ResponseFormat.JSON ? payload : undefined
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: formatError(error) }]
      };
    }
  }
);

// ============================================================================
// TOOL: codecks_delete_milestone
// ============================================================================
server.registerTool(
  TOOL_DELETE_MILESTONE,
  {
    title: "Delete Codecks Milestone",
    description: "Delete/archive a milestone via milestones/delete.",
    inputSchema: schemas.DeleteMilestoneSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: true
    }
  },
  async (params: schemas.DeleteMilestoneInput) => {
    try {
      const client = getClient();
      const response = await client.dispatch("milestones/delete", { id: params.milestone_id });
      const payload = { milestone_id: params.milestone_id, deleted: true, response };
      const text = params.response_format === ResponseFormat.JSON
        ? JSON.stringify(payload, null, 2)
        : `Milestone ${params.milestone_id} deleted successfully.`;
      return {
        content: [{ type: "text", text }],
        structuredContent: params.response_format === ResponseFormat.JSON ? payload : undefined
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: formatError(error) }]
      };
    }
  }
);

// ============================================================================
// TOOL: codecks_unlink_milestone_project
// ============================================================================
server.registerTool(
  TOOL_UNLINK_MILESTONE_PROJECT,
  {
    title: "Unlink Milestone from Project",
    description: "Remove an existing milestone-project link. To unlink the final project from a non-global milestone, set globalize_if_last_project=true.",
    inputSchema: schemas.UnlinkMilestoneProjectSchema,
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    }
  },
  async (params: schemas.UnlinkMilestoneProjectInput) => {
    try {
      const client = getClient();
      const milestoneSelection: Selection[] = [
        "id",
        "name",
        "color",
        "date",
        "startDate",
        "handSyncEnabled",
        "isGlobal",
        { milestoneProjects: [{ project: ["id"] }] }
      ];
      const query = buildIdQuery(schema, "milestone", [params.milestone_id], milestoneSelection);
      const response = await client.query(query);
      const milestone = denormalizeById(
        schema,
        response as Record<string, any>,
        "milestone",
        params.milestone_id,
        milestoneSelection
      ) as Record<string, unknown> | null;

      if (!milestone) {
        return {
          content: [{
            type: "text",
            text: `Error: Milestone with ID '${params.milestone_id}' not found.`
          }]
        };
      }

      const existingProjectIds = ((milestone.milestoneProjects as any[]) || [])
        .map((mp) => {
          if (mp && typeof mp === "object") {
            const directProjectId = (mp as Record<string, unknown>).projectId;
            if (typeof directProjectId === "string") {
              return directProjectId;
            }
            const project = (mp as Record<string, unknown>).project;
            if (project && typeof project === "object") {
              const id = (project as Record<string, unknown>).id;
              return typeof id === "string" ? id : undefined;
            }
            return typeof project === "string" ? project : undefined;
          }
          return undefined;
        })
        .filter((id): id is string => Boolean(id));

      if (!existingProjectIds.includes(params.project_id)) {
        const payload = {
          milestone_id: params.milestone_id,
          project_id: params.project_id,
          already_unlinked: true,
          project_ids: existingProjectIds
        };
        const text = params.response_format === ResponseFormat.JSON
          ? JSON.stringify(payload, null, 2)
          : `Milestone '${params.milestone_id}' is already unlinked from project '${params.project_id}'.`;
        return {
          content: [{ type: "text", text }],
          structuredContent: params.response_format === ResponseFormat.JSON ? payload : undefined
        };
      }

      const projectIds = existingProjectIds.filter((id) => id !== params.project_id);
      const resolvedIsGlobal = typeof milestone.isGlobal === "boolean" ? milestone.isGlobal : false;
      const unlinkDecision = resolveMilestoneUnlinkGlobalize({
        remainingProjectCount: projectIds.length,
        currentIsGlobal: resolvedIsGlobal,
        globalizeIfLastProject: params.globalize_if_last_project
      });
      if (!unlinkDecision.allowed) {
        const guardedPayload = {
          milestone_id: params.milestone_id,
          project_id: params.project_id,
          unlink_performed: false,
          requires_globalize_confirmation: unlinkDecision.requiresConfirmation,
          current_is_global: resolvedIsGlobal,
          current_project_ids: existingProjectIds,
          suggested_retry: {
            globalize_if_last_project: true
          }
        };
        const text = params.response_format === ResponseFormat.JSON
          ? JSON.stringify(guardedPayload, null, 2)
          : `Refusing to unlink last project '${params.project_id}' from non-global milestone '${params.milestone_id}' without explicit confirmation. Retry with globalize_if_last_project=true if you want to convert it to global.`;
        return {
          content: [{ type: "text", text }],
          structuredContent: params.response_format === ResponseFormat.JSON ? guardedPayload : undefined
        };
      }
      const nextIsGlobal = unlinkDecision.nextIsGlobal;
      const updateData: Record<string, unknown> = {
        sessionId: params.session_id || undefined,
        id: params.milestone_id,
        isGlobal: nextIsGlobal,
        projectIds
      };
      if (typeof milestone.name === "string") updateData.name = milestone.name;
      if (typeof milestone.color === "string") updateData.color = milestone.color;
      if (typeof milestone.date === "string") updateData.date = milestone.date;
      if (typeof milestone.startDate === "string") updateData.startDate = milestone.startDate;
      if (typeof milestone.handSyncEnabled === "boolean") updateData.handSyncEnabled = milestone.handSyncEnabled;

      let updateResponse: unknown;
      try {
        updateResponse = await client.dispatch("milestones/update", updateData);
      } catch {
        updateResponse = await client.dispatch("milestones/update", {
          sessionId: params.session_id || undefined,
          id: params.milestone_id,
          isGlobal: nextIsGlobal,
          projectIds
        });
      }

      const verifyResponse = await client.query(
        buildIdQuery(schema, "milestone", [params.milestone_id], milestoneSelection)
      );
      const verifiedMilestone = denormalizeById(
        schema,
        verifyResponse as Record<string, any>,
        "milestone",
        params.milestone_id,
        milestoneSelection
      ) as Record<string, unknown> | null;
      const verifiedProjectIds = ((verifiedMilestone?.milestoneProjects as any[]) || [])
        .map((mp) => {
          if (mp && typeof mp === "object") {
            const directProjectId = (mp as Record<string, unknown>).projectId;
            if (typeof directProjectId === "string") {
              return directProjectId;
            }
            const project = (mp as Record<string, unknown>).project;
            if (project && typeof project === "object") {
              const id = (project as Record<string, unknown>).id;
              return typeof id === "string" ? id : undefined;
            }
            return typeof project === "string" ? project : undefined;
          }
          return undefined;
        })
        .filter((id): id is string => Boolean(id));

      const payload = {
        milestone_id: params.milestone_id,
        project_id: params.project_id,
        globalized: unlinkDecision.wouldGlobalize,
        is_global: nextIsGlobal,
        project_ids: projectIds,
        verified_project_ids: verifiedProjectIds,
        unlink_verified: !verifiedProjectIds.includes(params.project_id),
        response: updateResponse
      };
      if (verifiedProjectIds.includes(params.project_id)) {
        const text = params.response_format === ResponseFormat.JSON
          ? JSON.stringify(payload, null, 2)
          : `Warning: unlink request completed but project '${params.project_id}' is still linked to milestone '${params.milestone_id}'.`;
        return {
          content: [{ type: "text", text }],
          structuredContent: params.response_format === ResponseFormat.JSON ? payload : undefined
        };
      }
      const text = params.response_format === ResponseFormat.JSON
        ? JSON.stringify(payload, null, 2)
        : `Milestone '${params.milestone_id}' unlinked from project '${params.project_id}' successfully.`;

      return {
        content: [{ type: "text", text }],
        structuredContent: params.response_format === ResponseFormat.JSON ? payload : undefined
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: formatError(error) }]
      };
    }
  }
);

// ============================================================================
// TOOL: codecks_get_current_user
// ============================================================================
server.registerTool(
  TOOL_GET_CURRENT_USER,
  {
    title: "Get Current Codecks User",
    description: `Get information about the currently authenticated user.

Uses Codecks' read API to fetch the logged-in user (id, name) and (when available) their primary email via the userEmail model.

Args:
  - response_format ('markdown' | 'json'): Output format (default: 'markdown')

Returns:
  User information including id, name, and (if available) email.`,
    inputSchema: schemas.GetCurrentUserSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true
    }
  },
  async (params: schemas.GetCurrentUserInput) => {
    try {
      const client = getClient();

      const userSelection: Selection[] = [
        "id",
        "name",
        { primaryEmail: ["id", "email", "isPrimary", "isVerified", "userId"] }
      ];

      const query = buildRootQuery(schema, "loggedInUser", userSelection);
      const response = await client.query(query);
      const user = denormalizeRootRelation(
        schema,
        response as Record<string, any>,
        "loggedInUser",
        userSelection
      );

      if (!user) {
        return {
          content: [{
            type: "text",
            text: "Error: Unable to retrieve current user information from Codecks. Please verify your token and subdomain, then retry."
          }]
        };
      }
      const emailObj = user.primaryEmail || null;

      const output = {
        id: user.id,
        name: user.name,
        ...(emailObj?.email ? { email: emailObj.email } : {}),
        ...(emailObj ? {
          email_is_primary: emailObj.isPrimary,
          email_is_verified: emailObj.isVerified
        } : {})
      };

      const formatted = params.response_format === ResponseFormat.JSON
        ? JSON.stringify(output, null, 2)
        : [
            "# Current User",
            "",
            `**ID**: ${output.id}`,
            `**Name**: ${output.name}`,
            ...(output.email ? [`**Email**: ${output.email}`] : ["**Email**: (not available)"])
          ].join("\n");

      return {
        content: [{ type: "text", text: formatted }],
        structuredContent: params.response_format === ResponseFormat.JSON ? output : undefined
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: formatError(error) }]
      };
    }
  }
);

// ============================================================================
// TOOL: codecks_stats
// ============================================================================
server.registerTool(
  TOOL_STATS,
  {
    title: "Codecks MCP Session Stats",
    description: "Show lightweight per-tool usage stats for this MCP server session.",
    inputSchema: schemas.StatsSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true
    }
  },
  async (_params: schemas.StatsInput) => {
    const uptimeMinutes = ((Date.now() - serverStartTime) / 60000).toFixed(1);
    const entries = Object.entries(toolMetrics)
      .map(([tool, metric]) => ({ tool, ...metric }))
      .sort((a, b) => b.calls - a.calls);

    const totals = entries.reduce(
      (acc, row) => ({
        calls: acc.calls + row.calls,
        errors: acc.errors + row.errors,
        bytes: acc.bytes + row.bytes
      }),
      { calls: 0, errors: 0, bytes: 0 }
    );

    const lines = [
      "# Codecks MCP Session Stats",
      "",
      `- **Uptime**: ${uptimeMinutes} min`,
      `- **Total Calls**: ${totals.calls}`,
      `- **Total Errors**: ${totals.errors}`,
      `- **Bytes Returned**: ${(totals.bytes / 1024).toFixed(1)} KB`,
      ""
    ];

    if (entries.length === 0) {
      lines.push("No tracked tool calls yet.");
    } else {
      lines.push("| Tool | Calls | Errors | Bytes |");
      lines.push("|---|---:|---:|---:|");
      for (const row of entries) {
        lines.push(`| ${row.tool} | ${row.calls} | ${row.errors} | ${row.bytes} |`);
      }
    }

    const text = lines.join("\n");
    trackToolUsage(TOOL_STATS, text);

    return {
      content: [{ type: "text", text }],
      structuredContent: {
        uptime_minutes: Number(uptimeMinutes),
        totals,
        tools: entries
      }
    };
  }
);

// ============================================================================
// AUTO-GENERATED TOOLS
// ============================================================================
registerAutoTools({
  server,
  schema,
  getClient,
  formatError,
  skipModels: new Set(["card", "deck", "project", "milestone"]),
  existingToolNames: manualTools
});

// ============================================================================
// Transport Setup
// ============================================================================

function validateEnvironment(): { authToken: string; subdomain: string } {
  const authToken = process.env.CODECKS_AUTH_TOKEN;
  const subdomain = process.env.CODECKS_ACCOUNT_SUBDOMAIN;

  if (!authToken || !subdomain) {
    console.error("ERROR: Required environment variables:");
    console.error("  - CODECKS_AUTH_TOKEN: Your Codecks API token");
    console.error("  - CODECKS_ACCOUNT_SUBDOMAIN: Your organization subdomain");
    process.exit(1);
  }

  return { authToken, subdomain };
}

async function runStdio() {
  const { authToken, subdomain } = validateEnvironment();
  client = new CodecksClient(authToken, subdomain);
  
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Codecks MCP server running via stdio");
}

async function runHTTP() {
  const { authToken, subdomain } = validateEnvironment();
  client = new CodecksClient(authToken, subdomain);

  const httpSecret = process.env.MCP_HTTP_SECRET;
  if (!httpSecret) {
    console.error("ERROR: MCP_HTTP_SECRET is required for HTTP transport.");
    console.error("The HTTP endpoint exposes destructive operations and must be authenticated.");
    console.error("Set MCP_HTTP_SECRET environment variable to a secure secret value.");
    process.exit(1);
  }

  const app = express();
  app.use(express.json());

  // Authentication middleware for HTTP transport
  app.use('/mcp', (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${httpSecret}`) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  });


  app.post('/mcp', async (req, res) => {
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true
      });
      res.on('close', () => transport.close());
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("MCP request error:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  const port = parseInt(process.env.PORT || '3000');
  app.listen(port, () => {
    console.error(`Codecks MCP server running on http://localhost:${port}/mcp`);
  });
}

// Choose transport based on environment
const transport = process.env.TRANSPORT || 'stdio';
if (transport === 'http') {
  runHTTP().catch(error => {
    console.error("Server error:", error);
    process.exit(1);
  });
} else {
  runStdio().catch(error => {
    console.error("Server error:", error);
    process.exit(1);
  });
}
