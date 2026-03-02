import { describe, expect, it } from "vitest";
import {
  AddDecksToSpaceAfterSchema,
  AddToHandSchema,
  AddToQueueSchema,
  BulkUpdateCardsSchema,
  CreateMilestoneProjectSchema,
  CreateMilestoneSchema,
  CreateCardSchema,
  CreateDeckSchema,
  CreateProjectSchema,
  DeleteMilestoneSchema,
  DeleteCardSchema,
  ListCardsSchema,
  RemoveCardUpvoteSchema,
  RemoveFromHandSchema,
  RemoveFromQueueSchema,
  ReorderQueueSchema,
  SetProjectVisibilitySchema,
  StartJourneySchema,
  SubscribeCardSchema,
  SubscribeDeckSchema,
  UnlinkMilestoneProjectSchema,
  UnsubscribeCardSchema,
  UnsubscribeDeckSchema,
  UpdateMilestoneSchema,
  UpvoteCardSchema
} from "../../src/schemas/tool-schemas.js";

describe("tool schemas", () => {
  it("validates bulk update cards inputs", () => {
    expect(() => BulkUpdateCardsSchema.parse({ ids: ["a"], status: "done" })).not.toThrow();
    expect(() => BulkUpdateCardsSchema.parse({ ids: ["a"], status: "hero" })).not.toThrow();
    expect(() => BulkUpdateCardsSchema.parse({ ids: ["a"], deck_id: "deck1" })).not.toThrow();
    expect(() => BulkUpdateCardsSchema.parse({ ids: ["a"], milestone_id: "ms1" })).not.toThrow();
    expect(() => BulkUpdateCardsSchema.parse({ ids: ["a"] })).toThrow();
  });

  it("accepts API-driven card status values for list filters", () => {
    expect(() => ListCardsSchema.parse({ status: "hero", response_format: "json" })).not.toThrow();
    expect(() => ListCardsSchema.parse({ status: "archivedDone", response_format: "json" })).not.toThrow();
    expect(ListCardsSchema.parse({ response_format: "json" }).exclude_deleted).toBe(true);
  });

  it("validates create deck inputs", () => {
    const value = {
      title: "Deck",
      project_id: "project-1",
      user_id: "user-1",
      space_id: 1
    };
    expect(() => CreateDeckSchema.parse(value)).not.toThrow();
  });

  it("validates add decks to space after inputs", () => {
    const value = {
      deck_ids: ["deck-1"],
      target_id: "deck-2",
      target_project_id: "project-1",
      target_space_id: 1
    };
    expect(() => AddDecksToSpaceAfterSchema.parse(value)).not.toThrow();
  });

  it("validates create card inputs", () => {
    const value = {
      content: "Hello",
      user_id: "user-1"
    };
    expect(() => CreateCardSchema.parse(value)).not.toThrow();
  });

  it("validates delete card inputs", () => {
    expect(() => DeleteCardSchema.parse({ card_id: "card-1", response_format: "json" })).not.toThrow();
  });

  it("validates create project inputs", () => {
    const value = {
      name: "Project",
      default_user_access: "everyone",
      template_id: "cdx/survival"
    };
    expect(() => CreateProjectSchema.parse(value)).not.toThrow();
  });
  it("validates create milestone inputs", () => {
    const value = {
      name: "Prototype",
      color: "pink",
      date: "2026-12-31",
      is_global: false,
      project_ids: ["project-1"]
    };
    expect(() => CreateMilestoneSchema.parse(value)).not.toThrow();
  });

  it("validates create milestone-project link inputs", () => {
    const value = {
      milestone_id: "milestone-1",
      project_id: "project-1"
    };
    expect(() => CreateMilestoneProjectSchema.parse(value)).not.toThrow();
  });
  it("validates start journey inputs", () => {
    expect(() => StartJourneySchema.parse({ card_id: "card-1", response_format: "json" })).not.toThrow();
  });

  it("validates interaction write inputs", () => {
    expect(() => AddToHandSchema.parse({ card_ids: ["card-1"], response_format: "json" })).not.toThrow();
    expect(() => RemoveFromHandSchema.parse({ card_ids: ["card-1"], response_format: "json" })).not.toThrow();
    expect(() => AddToQueueSchema.parse({ card_ids: ["card-1"], response_format: "json" })).not.toThrow();
    expect(() => RemoveFromQueueSchema.parse({ card_ids: ["card-1"], response_format: "json" })).not.toThrow();
    expect(() => ReorderQueueSchema.parse({ card_ids: ["card-1"], response_format: "json" })).not.toThrow();
    expect(() => UpvoteCardSchema.parse({ card_id: "card-1", response_format: "json" })).not.toThrow();
    expect(() => RemoveCardUpvoteSchema.parse({ response_format: "json" })).toThrow();
    expect(() => RemoveCardUpvoteSchema.parse({ card_id: "card-1", response_format: "json" })).not.toThrow();
    expect(() => SubscribeCardSchema.parse({ card_id: "card-1", response_format: "json" })).not.toThrow();
    expect(() => UnsubscribeCardSchema.parse({ card_id: "card-1", response_format: "json" })).not.toThrow();
    expect(() => SubscribeDeckSchema.parse({ deck_id: "deck-1", response_format: "json" })).not.toThrow();
    expect(() => UnsubscribeDeckSchema.parse({ deck_id: "deck-1", response_format: "json" })).not.toThrow();
  });

  it("validates milestone lifecycle inputs", () => {
    expect(() => UpdateMilestoneSchema.parse({ milestone_id: "ms-1", name: "Renamed", response_format: "json" })).not.toThrow();
    expect(() => UpdateMilestoneSchema.parse({ milestone_id: "ms-1", response_format: "json" })).toThrow();
    expect(() => DeleteMilestoneSchema.parse({ milestone_id: "ms-1", response_format: "json" })).not.toThrow();
    expect(() => UnlinkMilestoneProjectSchema.parse({
      milestone_id: "ms-1",
      project_id: "project-1",
      response_format: "json"
    })).not.toThrow();
  });

  it("validates set project visibility inputs", () => {
    const value = {
      project_id: "project-1",
      visibility: "deleted"
    };
    expect(() => SetProjectVisibilitySchema.parse(value)).not.toThrow();
  });
});
