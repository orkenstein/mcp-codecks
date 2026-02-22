/**
 * Zod schemas for tool input validation
 */

import { z } from "zod";
import { ResponseFormat } from "../types.js";
import { DEFAULT_LIMIT, MAX_LIMIT } from "../constants.js";

// Common schemas
export const PaginationSchema = z.object({
  limit: z.number()
    .int()
    .min(1)
    .max(MAX_LIMIT)
    .default(DEFAULT_LIMIT)
    .describe("Maximum number of results to return"),
  offset: z.number()
    .int()
    .min(0)
    .default(0)
    .describe("Number of results to skip for pagination")
});

export const ResponseFormatSchema = z.nativeEnum(ResponseFormat)
  .default(ResponseFormat.MARKDOWN)
  .describe("Output format: 'markdown' for human-readable or 'json' for structured data");

// Card schemas
export const ListCardsSchema = z.object({
  deck_id: z.string().optional().describe("Filter by specific deck ID"),
  milestone_id: z.string().optional().describe("Filter by specific milestone ID"),
  assignee_id: z.string().optional().describe("Filter by assigned user ID"),
  status: z.enum(["unassigned", "assigned", "started", "review", "blocked", "done"]).optional()
    .describe("Filter by workflow status"),
  search: z.string().optional().describe("Search term to filter cards by title/content"),
  limit: z.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  offset: z.number().int().min(0).default(0),
  response_format: ResponseFormatSchema
}).strict();

export const BulkUpdateCardsSchema = z.object({
  ids: z.array(z.string()).min(1).describe("Card IDs to update"),
  status: z.enum(["unassigned", "assigned", "started", "review", "blocked", "done"]).optional()
    .describe("Updated workflow status"),
  deck_id: z.string().optional().describe("Move cards to the specified deck ID"),
  session_id: z.string().optional().describe("[DEPRECATED] Client session ID - not required for MCP usage")
}).strict().refine(
  (value) => Boolean(value.status || value.deck_id),
  { message: "Provide at least one of status or deck_id." }
);

export const GetCardSchema = z.object({
  card_id: z.string().describe("The card ID to retrieve"),
  response_format: ResponseFormatSchema
}).strict();

export const CreateCardSchema = z.object({
  content: z.string().min(1).describe("Card content (first line becomes title)"),
  deck_id: z.string().optional().describe("Deck to place card in"),
  assignee_id: z.string().optional().describe("User ID to assign card to"),
  effort: z.number().int().min(0).optional().describe("Effort/complexity points"),
  priority: z.enum(["a", "b", "c"]).optional().describe("Priority: a (high), b (medium), c (low)"),
  milestone_id: z.string().optional().describe("Milestone to assign card to"),
  sprint_id: z.string().optional().describe("Sprint to assign card to"),
  put_on_hand: z.boolean().default(false).describe("Whether to add card to your hand"),
  put_in_queue: z.boolean().default(false).describe("Whether to add card to queue"),
  add_as_bookmark: z.boolean().default(false).describe("Whether to add card as bookmark"),
  subscribe_creator: z.boolean().default(false).describe("Whether creator is subscribed to card"),
  is_doc: z.boolean().default(false).describe("Create card as a doc card"),
  parent_card_id: z.string().optional().describe("Parent card ID"),
  fake_cover_file_id: z.string().optional().describe("Fake cover file ID"),
  session_id: z.string().optional().describe("[DEPRECATED] Client session ID - not required for MCP usage"),
  master_tags: z.array(z.string()).optional().describe("Tag IDs to assign to card"),
  attachments: z.array(
    z.object({
      fileId: z.string().optional(),
      url: z.string().optional(),
      filename: z.string().optional()
    }).passthrough()
  ).optional().describe("Attachment objects to include"),
  child_cards: z.array(z.string()).optional().describe("Child card IDs"),
  in_deps: z.array(z.string()).optional().describe("Inbound dependency card IDs"),
  out_deps: z.array(z.string()).optional().describe("Outbound dependency card IDs"),
  user_id: z.string().describe("Your user ID (required for creating cards)")
}).strict();


// Deck schemas
export const ListDecksSchema = z.object({
  project_id: z.string().optional().describe("Filter by specific project ID"),
  response_format: ResponseFormatSchema
}).strict();

export const GetDeckSchema = z.object({
  deck_id: z.string().describe("The deck ID to retrieve"),
  response_format: ResponseFormatSchema
}).strict();

export const CreateDeckSchema = z.object({
  title: z.string().min(1).describe("Deck title"),
  project_id: z.string().describe("Project ID for the deck"),
  user_id: z.string().describe("Your user ID"),
  space_id: z.number().int().describe("Space ID"),
  cover_file_data: z.any().optional().describe("Cover file metadata (optional)"),
  session_id: z.string().optional().describe("[DEPRECATED] Client session ID - not required for MCP usage")
}).strict();

export const AddDecksToSpaceAfterSchema = z.object({
  deck_ids: z.array(z.string()).min(1).describe("Deck IDs to move"),
  target_id: z.string().describe("Target deck ID to insert after"),
  target_project_id: z.string().describe("Target project ID"),
  target_space_id: z.number().int().describe("Target space ID"),
  session_id: z.string().optional().describe("[DEPRECATED] Client session ID - not required for MCP usage")
}).strict();

// Project schemas
export const ListProjectsSchema = z.object({
  include_archived: z.boolean().default(false).describe("Include archived projects"),
  response_format: ResponseFormatSchema
}).strict();

export const CreateProjectSchema = z.object({
  name: z.string().min(1).describe("Project name"),
  default_user_access: z.enum(["everyone", "onlyMembers"]).default("everyone")
    .describe("Default user access level"),
  template_id: z.string().optional().describe("Template ID (e.g., cdx/survival)"),
  file_id: z.string().optional().describe("Cover file ID"),
  session_id: z.string().optional().describe("[DEPRECATED] Client session ID - not required for MCP usage")
}).strict();

export const SetProjectVisibilitySchema = z.object({
  project_id: z.string().describe("Project ID"),
  visibility: z.enum(["deleted", "archived", "private", "public"]).default("deleted")
    .describe("Visibility to set (use 'deleted' to remove)"),
  session_id: z.string().optional().describe("[DEPRECATED] Client session ID - not required for MCP usage")
}).strict();

// Milestone schemas
export const ListMilestonesSchema = z.object({
  response_format: ResponseFormatSchema
}).strict();

export const GetMilestoneSchema = z.object({
  milestone_id: z.string().describe("The milestone ID to retrieve"),
  response_format: ResponseFormatSchema
}).strict();

// User schema
export const GetCurrentUserSchema = z.object({
  response_format: ResponseFormatSchema
}).strict();

// Type exports
export type ListCardsInput = z.infer<typeof ListCardsSchema>;
export type GetCardInput = z.infer<typeof GetCardSchema>;
export type CreateCardInput = z.infer<typeof CreateCardSchema>;
export type BulkUpdateCardsInput = z.infer<typeof BulkUpdateCardsSchema>;
export type ListDecksInput = z.infer<typeof ListDecksSchema>;
export type GetDeckInput = z.infer<typeof GetDeckSchema>;
export type CreateDeckInput = z.infer<typeof CreateDeckSchema>;
export type AddDecksToSpaceAfterInput = z.infer<typeof AddDecksToSpaceAfterSchema>;
export type ListProjectsInput = z.infer<typeof ListProjectsSchema>;
export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;
export type SetProjectVisibilityInput = z.infer<typeof SetProjectVisibilitySchema>;
export type ListMilestonesInput = z.infer<typeof ListMilestonesSchema>;
export type GetMilestoneInput = z.infer<typeof GetMilestoneSchema>;
export type GetCurrentUserInput = z.infer<typeof GetCurrentUserSchema>;
