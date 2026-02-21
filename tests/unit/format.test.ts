import { describe, expect, it } from "vitest";
import {
  checkAndTruncate,
  formatCard,
  formatCardList,
  formatDeck,
  formatDeckList,
  formatMilestone,
  formatMilestoneList,
  formatProjectList
} from "../../src/utils/format.js";
import { ResponseFormat } from "../../src/types.js";

describe("format utilities", () => {
  it("formats card as markdown", () => {
    const card = {
      id: "c1",
      accountSeq: 12,
      title: "Card",
      derivedStatus: "started",
      assignee: { id: "u1", name: "User" },
      deck: { id: "d1", name: "Deck" },
      milestone: { id: "m1", name: "Milestone" },
      effort: 3,
      priority: "a",
      content: "Content",
      createdAt: new Date("2025-01-01T00:00:00Z").toISOString(),
      lastUpdatedAt: new Date("2025-01-02T00:00:00Z").toISOString()
    };
    const output = formatCard(card, ResponseFormat.MARKDOWN);
    expect(output).toContain("# Card");
    expect(output).toContain("**ID**");
    expect(output).toContain("**Assignee**");
    expect(output).toContain("**Deck**");
    expect(output).toContain("**Milestone**");
    expect(output).toContain("## Content");
  });

  it("formats card as json", () => {
    const card = { id: "c1", title: "Card" };
    const output = formatCard(card, ResponseFormat.JSON);
    expect(output).toContain("\"id\"");
  });

  it("formats card with missing title/status and unknown priority", () => {
    const card = {
      id: "c1",
      accountSeq: 1,
      priority: "z",
      createdAt: new Date("2025-01-01T00:00:00Z").toISOString(),
      lastUpdatedAt: new Date("2025-01-02T00:00:00Z").toISOString()
    };
    const output = formatCard(card, ResponseFormat.MARKDOWN);
    expect(output).toContain("(Untitled)");
    expect(output).toContain("**Status**: unknown");
    expect(output).toContain("**Priority**: z");
  });

  it("formats card list", () => {
    const cards = [{ accountSeq: 1, title: "A", derivedStatus: "done" }];
    const output = formatCardList(cards, ResponseFormat.MARKDOWN, { total: 1, count: 1 });
    expect(output).toContain("# Cards");
  });

  it("formats deck and deck list", () => {
    const deck = {
      id: "d1",
      name: "Deck",
      type: "standard",
      project: { id: "p1", name: "Project" },
      cardCount: 4,
      description: "Desc"
    };
    expect(formatDeck(deck, ResponseFormat.MARKDOWN)).toContain("# Deck");
    const list = formatDeckList([deck], ResponseFormat.MARKDOWN);
    expect(list).toContain("# Decks");
  });

  it("formats projects and milestones", () => {
    const projects = [
      { id: "p1", name: "Proj", isArchived: false },
      { id: "p2", name: "Archived", isArchived: true }
    ];
    const projOutput = formatProjectList(projects, ResponseFormat.MARKDOWN);
    expect(projOutput).toContain("# Projects");
    const milestones = [{ id: "m1", name: "M1", dueDate: "2025-01-01", description: "Desc" }];
    const listOutput = formatMilestoneList(milestones, ResponseFormat.MARKDOWN);
    expect(listOutput).toContain("# Milestones");
    const singleOutput = formatMilestone(milestones[0], ResponseFormat.MARKDOWN);
    expect(singleOutput).toContain("# M1");
  });

  it("formats milestones with missing names", () => {
    const output = formatMilestone({ id: "m2" }, ResponseFormat.MARKDOWN);
    expect(output).toContain("(Untitled Milestone)");
  });
  it("formats milestone as json", () => {
    const milestone = { id: "m1", name: "M1" };
    const output = formatMilestone(milestone, ResponseFormat.JSON);
    expect(output).toContain("\"id\"");
  });

  it("formats card list as json and includes meta", () => {
    const cards = [{ accountSeq: 1, title: "A", derivedStatus: "done" }];
    const output = formatCardList(cards, ResponseFormat.JSON, { total: 2 });
    expect(output).toContain("\"cards\"");
    expect(output).toContain("\"total\"");
  });

  it("formats card list with zero total and missing title", () => {
    const cards = [{ accountSeq: 1, derivedStatus: "done" }];
    const output = formatCardList(cards, ResponseFormat.MARKDOWN, { total: 0 });
    expect(output).toContain("Total: 1 | Showing: 1");
    expect(output).toContain("(Untitled)");
  });

  it("formats card list with meta and optional fields", () => {
    const cards = [
      {
        accountSeq: 1,
        title: "A",
        derivedStatus: "done",
        assignee: { name: "User" },
        deck: { name: "Deck" },
        effort: 2
      }
    ];
    const output = formatCardList(cards, ResponseFormat.MARKDOWN, {
      total: 3,
      has_more: true,
      next_offset: 20
    });
    expect(output).toContain("More results available");
    expect(output).toContain("Assignee");
    expect(output).toContain("Deck");
    expect(output).toContain("Effort");
  });

  it("formats lists as json", () => {
    const deck = { id: "d1", name: "Deck", type: "standard" };
    expect(formatDeck(deck, ResponseFormat.JSON)).toContain("\"id\"");
    expect(formatDeckList([deck], ResponseFormat.JSON)).toContain("\"decks\"");

    const projects = [{ id: "p1", name: "Proj" }];
    expect(formatProjectList(projects, ResponseFormat.JSON)).toContain("\"projects\"");

    const milestones = [{ id: "m1", name: "M1" }];
    expect(formatMilestoneList(milestones, ResponseFormat.JSON)).toContain("\"milestones\"");
  });

  it("truncates output exceeding character limit", () => {
    const large = "a".repeat(30000);
    const result = checkAndTruncate(large, 10);
    expect(result.truncated).toBe(true);
    expect(result.content).toContain("Response truncated");
  });

  it("does not truncate small output", () => {
    const result = checkAndTruncate("short", 1);
    expect(result.truncated).toBe(false);
  });
});
