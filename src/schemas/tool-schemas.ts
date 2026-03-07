/**
 * Zod schemas for tool input validation
 */

import { z } from "zod";
import { ResponseFormat, ResponseMode } from "../types.js";
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

export const ResponseModeSchema = z.nativeEnum(ResponseMode)
  .default(ResponseMode.COMPACT)
  .describe("Response verbosity for markdown list output: 'compact' (default) or 'full'");

const CardStatusSchema = z.string().min(1)
  .describe("Card status value (API-driven, e.g. unassigned, started, review, blocked, done, hero, archivedDone, doc)");

// Card schemas
export const ListCardsSchema = z.object({
  deck_id: z.string().optional().describe("Filter by specific deck ID"),
  milestone_id: z.string().optional().describe("Filter by specific milestone ID"),
  assignee_id: z.string().optional().describe("Filter by assigned user ID"),
  status: CardStatusSchema.optional()
    .describe("Filter by status (API-derived; values vary by account/workflow)"),
  search: z.string().optional().describe("Search term to filter cards by title/content"),
  exclude_deleted: z.boolean().default(true).describe("Exclude deleted cards by default"),
  limit: z.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
  offset: z.number().int().min(0).default(0),
  response_mode: ResponseModeSchema,
  response_format: ResponseFormatSchema
}).strict();

export const BulkUpdateCardsSchema = z.object({
  ids: z.array(z.string()).min(1).describe("Card IDs to update"),
  status: CardStatusSchema.optional()
    .describe("Updated workflow status"),
  deck_id: z.string().optional().describe("Move cards to the specified deck ID"),
  milestone_id: z.string().optional().describe("Assign cards to the specified milestone ID"),
  session_id: z.string().optional().describe("[DEPRECATED] Client session ID - not required for MCP usage")
}).strict().refine(
  (value) => Boolean(value.status || value.deck_id || value.milestone_id),
  { message: "Provide at least one of status, deck_id, or milestone_id." }
);
export const UpdateCardSchema = z.object({
  card_id: z.string().describe("Card ID to update"),
  status: CardStatusSchema.optional().describe("Updated workflow status"),
  deck_id: z.string().optional().describe("Move card to the specified deck ID"),
  milestone_id: z.string().optional().describe("Assign card to the specified milestone ID"),
  parent_card_id: z.string().nullable().optional().describe("Parent card ID; set null to unlink from current parent"),
  child_cards: z.array(z.string()).optional().describe("Set/replace child card IDs for this card; use [] to clear all children"),
  content: z.string().optional().describe("Updated card content/body (first line is rendered as title in Codecks UI)"),
  assignee_id: z.string().nullable().optional().describe("Assign card to user ID; set null to clear assignee"),
  session_id: z.string().optional().describe("[DEPRECATED] Client session ID - not required for MCP usage")
}).strict().refine(
  (value) => Boolean(
    value.status ||
    value.deck_id ||
    value.milestone_id ||
    value.parent_card_id !== undefined ||
    value.child_cards !== undefined ||
    value.content !== undefined ||
    value.assignee_id !== undefined
  ),
  { message: "Provide at least one updatable field: status, deck_id, milestone_id, parent_card_id, child_cards, content, or assignee_id." }
);

export const GetCardSchema = z.object({
  card_id: z.string().describe("The card ID to retrieve"),
  include_relations: z.boolean().default(false).describe("Include deck/milestone/assignee relation objects when available"),
  response_format: ResponseFormatSchema
}).strict();

export const DeleteCardSchema = z.object({
  card_id: z.string().describe("The card ID to archive/delete"),
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
  response_mode: ResponseModeSchema,
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
  deck_type: z.string().optional().describe("Optional deck type (e.g. hero, mixed)"),
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

export const UpdateDeckSchema = z.object({
  deck_id: z.string().describe("Deck ID to update"),
  title: z.string().min(1).optional().describe("Updated deck title"),
  deck_type: z.string().optional().describe("Updated deck type (e.g. hero, mixed, task)"),
  session_id: z.string().optional().describe("[DEPRECATED] Client session ID - not required for MCP usage")
}).strict().refine(
  (value) => Boolean(value.title !== undefined || value.deck_type !== undefined),
  { message: "Provide at least one field to update (title or deck_type)." }
);

export const DeleteDeckSchema = z.object({
  deck_id: z.string().describe("Deck ID to delete/archive"),
  session_id: z.string().optional().describe("[DEPRECATED] Client session ID - not required for MCP usage")
}).strict();
// Space schemas
export const ListSpacesSchema = z.object({
  project_id: z.string().optional().describe("Filter by specific project ID"),
  include_archived: z.boolean().default(false).describe("Include archived projects when collecting spaces"),
  response_mode: ResponseModeSchema,
  response_format: ResponseFormatSchema
}).strict();

export const GetSpaceSchema = z.object({
  project_id: z.string().describe("Project ID that owns the space"),
  space_id: z.number().int().describe("Numeric space ID within the project"),
  response_format: ResponseFormatSchema
}).strict();

export const CreateSpaceSchema = z.object({
  project_id: z.string().describe("Project ID that will own the new space"),
  name: z.string().min(1).describe("Space name"),
  icon: z.string().nullable().optional().describe("Optional icon slug (e.g., tasks, gdd); use null for no icon"),
  default_deck_type: z.string().default("task").describe("Default deck type for decks created in this space"),
  session_id: z.string().optional().describe("[DEPRECATED] Client session ID - not required for MCP usage")
}).strict();

export const UpdateSpaceSchema = z.object({
  project_id: z.string().describe("Project ID that owns the space"),
  space_id: z.number().int().describe("Space ID to update"),
  name: z.string().min(1).optional().describe("Updated space name"),
  icon: z.string().nullable().optional().describe("Updated icon slug; set null to clear icon"),
  default_deck_type: z.string().optional().describe("Updated default deck type"),
  session_id: z.string().optional().describe("[DEPRECATED] Client session ID - not required for MCP usage")
}).strict().refine(
  (value) => Boolean(
    value.name !== undefined ||
    value.icon !== undefined ||
    value.default_deck_type !== undefined
  ),
  { message: "Provide at least one field to update (name, icon, or default_deck_type)." }
);

export const DeleteSpaceSchema = z.object({
  project_id: z.string().describe("Project ID that owns the space"),
  space_id: z.number().int().describe("Space ID to delete"),
  session_id: z.string().optional().describe("[DEPRECATED] Client session ID - not required for MCP usage")
}).strict();

// Project schemas
export const ListProjectsSchema = z.object({
  include_archived: z.boolean().default(false).describe("Include archived projects"),
  response_mode: ResponseModeSchema,
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
  include_deleted: z.boolean().default(false).describe("Include deleted milestones (default: false)"),
  response_mode: ResponseModeSchema,
  response_format: ResponseFormatSchema
}).strict();

export const GetMilestoneSchema = z.object({
  milestone_id: z.string().describe("The milestone ID to retrieve"),
  response_format: ResponseFormatSchema
}).strict();
export const CreateMilestoneSchema = z.object({
  name: z.string().min(1).describe("Milestone name"),
  color: z.string().min(1).default("pink").describe("Milestone color label (e.g. pink, blue, green)"),
  date: z.string().describe("Milestone due date in YYYY-MM-DD format"),
  start_date: z.string().optional().describe("Optional start date in YYYY-MM-DD format"),
  is_global: z.boolean().default(false).describe("Whether the milestone should be globally visible"),
  project_ids: z.array(z.string()).min(1).describe("Project IDs linked to this milestone"),
  user_id: z.string().optional().describe("Creator user ID (auto-resolved if omitted)"),
  account_id: z.string().optional().describe("Account ID (auto-resolved if omitted)"),
  session_id: z.string().optional().describe("[DEPRECATED] Client session ID - not required for MCP usage")
}).strict();

export const CreateMilestoneProjectSchema = z.object({
  milestone_id: z.string().describe("Milestone ID to link"),
  project_id: z.string().describe("Project ID to link to the milestone"),
  session_id: z.string().optional().describe("[DEPRECATED] Client session ID - not required for MCP usage")
}).strict();

export const StartJourneySchema = z.object({
  card_id: z.string().describe("Hero/journey parent card ID to expand"),
  user_id: z.string().optional().describe("Actor user ID (auto-resolved if omitted)"),
  account_id: z.string().optional().describe("Actor account ID (auto-resolved if omitted)"),
  session_id: z.string().optional().describe("[DEPRECATED] Client session ID - not required for MCP usage"),
  response_format: ResponseFormatSchema
}).strict();

export const AddToHandSchema = z.object({
  card_ids: z.array(z.string()).min(1).describe("Card IDs to add to hand"),
  user_id: z.string().optional().describe("Actor user ID (auto-resolved if omitted)"),
  session_id: z.string().optional().describe("[DEPRECATED] Client session ID - not required for MCP usage"),
  response_format: ResponseFormatSchema
}).strict();

export const RemoveFromHandSchema = z.object({
  card_ids: z.array(z.string()).min(1).describe("Card IDs to remove from hand"),
  user_id: z.string().optional().describe("Actor user ID (auto-resolved if omitted)"),
  session_id: z.string().optional().describe("[DEPRECATED] Client session ID - not required for MCP usage"),
  response_format: ResponseFormatSchema
}).strict();

export const AddToQueueSchema = z.object({
  card_ids: z.array(z.string()).min(1).describe("Card IDs to add to queue"),
  user_id: z.string().optional().describe("Actor user ID (auto-resolved if omitted)"),
  account_id: z.string().optional().describe("Actor account ID (auto-resolved if omitted)"),
  session_id: z.string().optional().describe("[DEPRECATED] Client session ID - not required for MCP usage"),
  response_format: ResponseFormatSchema
}).strict();

export const RemoveFromQueueSchema = z.object({
  card_ids: z.array(z.string()).min(1).describe("Card IDs to remove from queue"),
  user_id: z.string().optional().describe("Actor user ID (auto-resolved if omitted)"),
  account_id: z.string().optional().describe("Actor account ID (auto-resolved if omitted)"),
  session_id: z.string().optional().describe("[DEPRECATED] Client session ID - not required for MCP usage"),
  response_format: ResponseFormatSchema
}).strict();

export const ReorderQueueSchema = z.object({
  card_ids: z.array(z.string()).min(1).describe("Queue card IDs in desired order"),
  dragged_card_ids: z.array(z.string()).min(1).describe("Dragged card IDs within the new queue ordering"),
  user_id: z.string().optional().describe("Actor user ID (auto-resolved if omitted)"),
  account_id: z.string().optional().describe("Actor account ID (auto-resolved if omitted)"),
  session_id: z.string().optional().describe("[DEPRECATED] Client session ID - not required for MCP usage"),
  response_format: ResponseFormatSchema
}).strict();

export const UpvoteCardSchema = z.object({
  card_id: z.string().describe("Card ID to upvote"),
  response_format: ResponseFormatSchema
}).strict();

export const RemoveCardUpvoteSchema = z.object({
  card_id: z.string().optional().describe("Card ID to remove your upvote from"),
  upvote_id: z.string().optional().describe("Specific cardUpvote ID to remove"),
  response_format: ResponseFormatSchema
}).strict().refine(
  (value) => Boolean(value.card_id || value.upvote_id),
  { message: "Provide at least one of card_id or upvote_id." }
);

export const SubscribeCardSchema = z.object({
  card_id: z.string().describe("Card ID to subscribe to"),
  user_id: z.string().optional().describe("Actor user ID (auto-resolved if omitted)"),
  session_id: z.string().optional().describe("[DEPRECATED] Client session ID - not required for MCP usage"),
  response_format: ResponseFormatSchema
}).strict();

export const UnsubscribeCardSchema = z.object({
  card_id: z.string().describe("Card ID to unsubscribe from"),
  user_id: z.string().optional().describe("Actor user ID (auto-resolved if omitted)"),
  session_id: z.string().optional().describe("[DEPRECATED] Client session ID - not required for MCP usage"),
  response_format: ResponseFormatSchema
}).strict();

export const SubscribeDeckSchema = z.object({
  deck_id: z.string().describe("Deck ID to subscribe to"),
  user_id: z.string().optional().describe("Actor user ID (auto-resolved if omitted)"),
  session_id: z.string().optional().describe("[DEPRECATED] Client session ID - not required for MCP usage"),
  response_format: ResponseFormatSchema
}).strict();

export const UnsubscribeDeckSchema = z.object({
  deck_id: z.string().describe("Deck ID to unsubscribe from"),
  user_id: z.string().optional().describe("Actor user ID (auto-resolved if omitted)"),
  session_id: z.string().optional().describe("[DEPRECATED] Client session ID - not required for MCP usage"),
  response_format: ResponseFormatSchema
}).strict();

export const UpdateMilestoneSchema = z.object({
  milestone_id: z.string().describe("Milestone ID to update"),
  name: z.string().optional().describe("Updated milestone name"),
  color: z.string().optional().describe("Updated milestone color"),
  date: z.string().optional().describe("Updated due date in YYYY-MM-DD format"),
  start_date: z.string().optional().describe("Updated start date in YYYY-MM-DD format"),
  hand_sync_enabled: z.boolean().optional().describe("Updated hand sync flag"),
  is_global: z.boolean().optional().describe("Updated global flag"),
  project_ids: z.array(z.string()).optional().describe("Updated full milestone project ID set"),
  session_id: z.string().optional().describe("[DEPRECATED] Client session ID - not required for MCP usage"),
  response_format: ResponseFormatSchema
}).strict().refine(
  (value) => Boolean(
    value.name !== undefined ||
    value.color !== undefined ||
    value.date !== undefined ||
    value.start_date !== undefined ||
    value.hand_sync_enabled !== undefined ||
    value.is_global !== undefined ||
    value.project_ids !== undefined
  ),
  { message: "Provide at least one field to update." }
);

export const DeleteMilestoneSchema = z.object({
  milestone_id: z.string().describe("Milestone ID to delete/archive"),
  response_format: ResponseFormatSchema
}).strict();

export const UnlinkMilestoneProjectSchema = z.object({
  milestone_id: z.string().describe("Milestone ID to update"),
  project_id: z.string().describe("Project ID to unlink from milestone"),
  globalize_if_last_project: z.boolean().default(false).describe("Allow converting a non-global milestone to global when unlinking its final project"),
  session_id: z.string().optional().describe("[DEPRECATED] Client session ID - not required for MCP usage"),
  response_format: ResponseFormatSchema
}).strict();

// User schema
export const GetCurrentUserSchema = z.object({
  response_format: ResponseFormatSchema
}).strict();

export const StatsSchema = z.object({}).strict();

// Type exports
export type ListCardsInput = z.infer<typeof ListCardsSchema>;
export type GetCardInput = z.infer<typeof GetCardSchema>;
export type DeleteCardInput = z.infer<typeof DeleteCardSchema>;
export type CreateCardInput = z.infer<typeof CreateCardSchema>;
export type BulkUpdateCardsInput = z.infer<typeof BulkUpdateCardsSchema>;
export type UpdateCardInput = z.infer<typeof UpdateCardSchema>;
export type ListDecksInput = z.infer<typeof ListDecksSchema>;
export type GetDeckInput = z.infer<typeof GetDeckSchema>;
export type CreateDeckInput = z.infer<typeof CreateDeckSchema>;
export type AddDecksToSpaceAfterInput = z.infer<typeof AddDecksToSpaceAfterSchema>;
export type UpdateDeckInput = z.infer<typeof UpdateDeckSchema>;
export type DeleteDeckInput = z.infer<typeof DeleteDeckSchema>;
export type ListSpacesInput = z.infer<typeof ListSpacesSchema>;
export type GetSpaceInput = z.infer<typeof GetSpaceSchema>;
export type CreateSpaceInput = z.infer<typeof CreateSpaceSchema>;
export type UpdateSpaceInput = z.infer<typeof UpdateSpaceSchema>;
export type DeleteSpaceInput = z.infer<typeof DeleteSpaceSchema>;
export type ListProjectsInput = z.infer<typeof ListProjectsSchema>;
export type CreateProjectInput = z.infer<typeof CreateProjectSchema>;
export type SetProjectVisibilityInput = z.infer<typeof SetProjectVisibilitySchema>;
export type ListMilestonesInput = z.infer<typeof ListMilestonesSchema>;
export type GetMilestoneInput = z.infer<typeof GetMilestoneSchema>;
export type CreateMilestoneInput = z.infer<typeof CreateMilestoneSchema>;
export type CreateMilestoneProjectInput = z.infer<typeof CreateMilestoneProjectSchema>;
export type StartJourneyInput = z.infer<typeof StartJourneySchema>;
export type AddToHandInput = z.infer<typeof AddToHandSchema>;
export type RemoveFromHandInput = z.infer<typeof RemoveFromHandSchema>;
export type AddToQueueInput = z.infer<typeof AddToQueueSchema>;
export type RemoveFromQueueInput = z.infer<typeof RemoveFromQueueSchema>;
export type ReorderQueueInput = z.infer<typeof ReorderQueueSchema>;
export type UpvoteCardInput = z.infer<typeof UpvoteCardSchema>;
export type RemoveCardUpvoteInput = z.infer<typeof RemoveCardUpvoteSchema>;
export type SubscribeCardInput = z.infer<typeof SubscribeCardSchema>;
export type UnsubscribeCardInput = z.infer<typeof UnsubscribeCardSchema>;
export type SubscribeDeckInput = z.infer<typeof SubscribeDeckSchema>;
export type UnsubscribeDeckInput = z.infer<typeof UnsubscribeDeckSchema>;
export type UpdateMilestoneInput = z.infer<typeof UpdateMilestoneSchema>;
export type DeleteMilestoneInput = z.infer<typeof DeleteMilestoneSchema>;
export type UnlinkMilestoneProjectInput = z.infer<typeof UnlinkMilestoneProjectSchema>;
export type GetCurrentUserInput = z.infer<typeof GetCurrentUserSchema>;
export type StatsInput = z.infer<typeof StatsSchema>;
