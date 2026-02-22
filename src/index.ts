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
import { ResponseFormat } from "./types.js";
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

// Initialize MCP server
const server = new McpServer({
  name: "codecks-mcp-server",
  version: "1.0.0"
});

const schema = loadSchema();

// Tool name constants - prevents sync issues between manualTools Set and registrations
const TOOL_LIST_CARDS = "codecks_list_cards";
const TOOL_GET_CARD = "codecks_get_card";
const TOOL_CREATE_CARD = "codecks_create_card";
const TOOL_BULK_UPDATE_CARDS = "codecks_bulk_update_cards";
const TOOL_LIST_DECKS = "codecks_list_decks";
const TOOL_GET_DECK = "codecks_get_deck";
const TOOL_CREATE_DECK = "codecks_create_deck";
const TOOL_ADD_DECKS_TO_SPACE = "codecks_add_decks_to_space_after";
const TOOL_LIST_PROJECTS = "codecks_list_projects";
const TOOL_CREATE_PROJECT = "codecks_create_project";
const TOOL_SET_PROJECT_VISIBILITY = "codecks_set_project_visibility";
const TOOL_LIST_MILESTONES = "codecks_list_milestones";
const TOOL_GET_MILESTONE = "codecks_get_milestone";
const TOOL_GET_CURRENT_USER = "codecks_get_current_user";

const manualTools = new Set<string>([
  TOOL_LIST_CARDS,
  TOOL_GET_CARD,
  TOOL_CREATE_CARD,
  TOOL_BULK_UPDATE_CARDS,
  TOOL_LIST_DECKS,
  TOOL_GET_DECK,
  TOOL_CREATE_DECK,
  TOOL_ADD_DECKS_TO_SPACE,
  TOOL_LIST_PROJECTS,
  TOOL_CREATE_PROJECT,
  TOOL_SET_PROJECT_VISIBILITY,
  TOOL_LIST_MILESTONES,
  TOOL_GET_MILESTONE,
  TOOL_GET_CURRENT_USER
]);

// Codecks client - initialized eagerly at startup after env validation
let client: CodecksClient;

function getClient(): CodecksClient {
  if (!client) {
    throw new Error("CodecksClient not initialized. Ensure runStdio() or runHTTP() has been called.");
  }
  return client;
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
      if (params.search) {
        filters.content = { op: "search", value: params.search };
      }

      const cardSelection: Selection[] = [
        "id",
        "accountSeq",
        "title",
        "content",
        "derivedStatus",
        "effort",
        "priority",
        { assignee: ["id", "name"] },
        { deck: ["id", "name"] },
        { milestone: ["id", "name"] },
        "createdAt",
        "lastUpdatedAt"
      ];

      const cardsKey = buildRelationKey("cards", {
        ...filters,
        $order: "-lastUpdatedAt",
        $limit: params.limit,
        $offset: params.offset
      });

      const accountSelection: Selection[] = [{ [cardsKey]: cardSelection }];
      validateSelection(schema, "account", accountSelection);

      const query = {
        _root: [
          {
            account: accountSelection
          }
        ]
      };

      const response = await client.query(query);
      const account = denormalizeRootRelation(schema, response as Record<string, any>, "account", accountSelection);
      const cards = account?.cards || [];

      // Calculate pagination metadata
      // Note: has_more is a heuristic based on result count. If total items is
      // exactly a multiple of limit, this may return true on the last page.
      const meta = {
        count: cards.length,
        offset: params.offset,
        has_more: cards.length === params.limit,
        ...(cards.length === params.limit ? { next_offset: params.offset + params.limit } : {})
      };

      const formatted = format.formatCardList(cards, params.response_format, meta);
      const { content, truncated } = format.checkAndTruncate(formatted, cards.length);

      return {
        content: [{ type: "text", text: content }],
        structuredContent: params.response_format === ResponseFormat.JSON ? { cards, ...meta, truncated } : undefined
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: formatError(error) }]
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

      const cardSelection: Selection[] = [
        "id",
        "accountSeq",
        "title",
        "content",
        "derivedStatus",
        "effort",
        "priority",
        { assignee: ["id", "name"] },
        { deck: ["id", "name"] },
        { milestone: ["id", "name", "dueDate"] },
        "createdAt",
        "lastUpdatedAt"
      ];

      const query = buildIdQuery(schema, "card", params.card_id, cardSelection);
      const response = await client.query(query);
      const card = denormalizeById(
        schema,
        response as Record<string, any>,
        "card",
        params.card_id,
        cardSelection
      );

      if (!card) {
        return {
          content: [{ type: "text", text: `Error: Card with ID '${params.card_id}' not found.` }]
        };
      }

      const formatted = format.formatCard(card, params.response_format);

      return {
        content: [{ type: "text", text: formatted }],
        structuredContent: params.response_format === ResponseFormat.JSON ? card : undefined
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: formatError(error) }]
      };
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

      return {
        content: [{ 
          type: "text", 
          text: `Card created successfully! ID: ${response.cardId || response.id}` 
        }],
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

      const filters: Record<string, unknown> = {};
      if (params.project_id) {
        filters.projectId = params.project_id;
      }

      const deckSelection: Selection[] = [
        "id",
        "name",
        "type",
        { project: ["id", "name"] }
      ];

      const decksKey = buildRelationKey(
        "decks",
        Object.keys(filters).length > 0 ? filters : undefined
      );

      const accountSelection: Selection[] = [{ [decksKey]: deckSelection }];
      validateSelection(schema, "account", accountSelection);

      const query = {
        _root: [
          {
            account: accountSelection
          }
        ]
      };

      const response = await client.query(query);
      const account = denormalizeRootRelation(schema, response as Record<string, any>, "account", accountSelection);
      const decks = account?.decks || [];

      const formatted = format.formatDeckList(decks, params.response_format);

      return {
        content: [{ type: "text", text: formatted }],
        structuredContent: params.response_format === ResponseFormat.JSON ? { decks } : undefined
      };
    } catch (error) {
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
        "name",
        "type",
        "description",
        "isArchived",
        { project: ["id", "name"] }
      ];

      const query = buildIdQuery(schema, "deck", params.deck_id, deckSelection);
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
  List of projects with their IDs, names, and archived status.`,
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

      const projectSelection: Selection[] = ["id", "name", "isArchived"];
      // Use server-side filtering: 'projects' excludes archived, 'anyProjects' includes all
      const projectRelation = params.include_archived ? "anyProjects" : "projects";
      const accountSelection: Selection[] = [{ [projectRelation]: projectSelection }];
      validateSelection(schema, "account", accountSelection);

      const query = {
        _root: [
          {
            account: accountSelection
          }
        ]
      };

      const response = await client.query(query);
      const account = denormalizeRootRelation(schema, response as Record<string, any>, "account", accountSelection);
      const projects = account?.[projectRelation] || [];

      const formatted = format.formatProjectList(projects, params.response_format);

      return {
        content: [{ type: "text", text: formatted }],
        structuredContent: params.response_format === ResponseFormat.JSON ? { projects } : undefined
      };
    } catch (error) {
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

      const milestoneSelection: Selection[] = ["id", "name", "dueDate", "description"];
      const accountSelection: Selection[] = [{ milestones: milestoneSelection }];
      validateSelection(schema, "account", accountSelection);

      const query = {
        _root: [
          {
            account: accountSelection
          }
        ]
      };

      const response = await client.query(query);
      const account = denormalizeRootRelation(schema, response as Record<string, any>, "account", accountSelection);
      const milestones = account?.milestones || [];

      const formatted = format.formatMilestoneList(milestones, params.response_format);

      return {
        content: [{ type: "text", text: formatted }],
        structuredContent: params.response_format === ResponseFormat.JSON ? { milestones } : undefined
      };
    } catch (error) {
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
  Complete milestone details including fields and relationships.`,
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
        "dueDate",
        "description",
        "isArchived",
        { project: ["id", "name"] }
      ];

      const query = buildIdQuery(schema, "milestone", params.milestone_id, milestoneSelection);
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
