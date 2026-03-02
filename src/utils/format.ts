/**
 * Formatting utilities for responses
 */

import { ResponseFormat } from "../types.js";
import { CHARACTER_LIMIT } from "../constants.js";

/**
 * Format a card for display
 */
export function formatCard(card: any, format: ResponseFormat): string {
  if (format === ResponseFormat.JSON) {
    return JSON.stringify(card, null, 2);
  }

  // Markdown format
  const lines = [
    `# ${card.title || "(Untitled)"}`,
    "",
    `**ID**: $${card.accountSeq} (${card.id})`,
    `**Status**: ${card.derivedStatus || "unknown"}`,
  ];

  if (card.assignee) {
    lines.push(`**Assignee**: ${card.assignee.name} (${card.assignee.id})`);
  }

  if (card.deck) {
    lines.push(`**Deck**: ${card.deck.name || card.deck.title || card.deck.id || card.deck}`);
  }

  if (card.milestone) {
    lines.push(`**Milestone**: ${card.milestone.name}`);
  }

  if (card.effort !== undefined) {
    lines.push(`**Effort**: ${card.effort}`);
  }

  if (card.priority) {
    const priorityMap: Record<string, string> = {
      a: "High",
      b: "Medium",
      c: "Low"
    };
    lines.push(`**Priority**: ${priorityMap[card.priority] || card.priority}`);
  }

  lines.push(`**Created**: ${new Date(card.createdAt).toLocaleString()}`);
  lines.push(`**Updated**: ${new Date(card.lastUpdatedAt).toLocaleString()}`);

  if (card.content) {
    lines.push("", "## Content", "", card.content);
  }

  return lines.join("\n");
}

/**
 * Format a single milestone for display
 */
export function formatMilestone(milestone: any, format: ResponseFormat): string {
  if (format === ResponseFormat.JSON) {
    return JSON.stringify(milestone, null, 2);
  }

  const lines = [
    `# ${milestone.name || "(Untitled Milestone)"}`,
    "",
    `**ID**: ${milestone.id}`
  ];

  if (milestone.date || milestone.dueDate) {
    lines.push(`**Due Date**: ${milestone.date || milestone.dueDate}`);
  }

  if (milestone.description) {
    lines.push("", "## Description", "", milestone.description);
  }

  return lines.join("\n");
}

/**
 * Format multiple cards for listing
 */
export function formatCardList(cards: any[], format: ResponseFormat, meta?: any): string {
  if (format === ResponseFormat.JSON) {
    const response = {
      cards,
      ...meta
    };
    return JSON.stringify(response, null, 2);
  }

  // Markdown format
  const lines = ["# Cards", ""];

  if (meta) {
  lines.push(`Showing: ${cards.length} results`);
    if (meta.has_more) {
      lines.push(`*More results available - use offset ${meta.next_offset} to continue*`);
    }
    lines.push("");
  }

  for (const card of cards) {
    lines.push(`## $${card.accountSeq}: ${card.title || "(Untitled)"}`);
    lines.push(`- **Status**: ${card.derivedStatus}`);
    if (card.assignee) {
      lines.push(`- **Assignee**: ${card.assignee.name}`);
    }
    if (card.deck) {
      lines.push(`- **Deck**: ${card.deck.name || card.deck.title || card.deck.id || card.deck}`);
    }
    if (card.effort !== undefined) {
      lines.push(`- **Effort**: ${card.effort}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Format a deck for display
 */
export function formatDeck(deck: any, format: ResponseFormat): string {
  if (format === ResponseFormat.JSON) {
    return JSON.stringify(deck, null, 2);
  }

  const lines = [
    `# ${deck.title || deck.name || "(Untitled Deck)"}`,
    "",
    `**ID**: ${deck.id}`,
    `**Type**: ${deck.deckType || deck.type || "unknown"}`,
  ];

  if (deck.project) {
    lines.push(`**Project**: ${deck.project.name || deck.project.id || deck.project}`);
  }

  if (deck.cardCount !== undefined) {
    lines.push(`**Cards**: ${deck.cardCount}`);
  }

  if (deck.description) {
    lines.push("", "## Description", "", deck.description);
  }

  return lines.join("\n");
}

/**
 * Format multiple decks for listing
 */
export function formatDeckList(decks: any[], format: ResponseFormat): string {
  if (format === ResponseFormat.JSON) {
    return JSON.stringify({ decks }, null, 2);
  }

  const lines = ["# Decks", ""];

  for (const deck of decks) {
    lines.push(`## ${deck.title || deck.name || "(Untitled Deck)"}`);
    lines.push(`- **ID**: ${deck.id}`);
    lines.push(`- **Type**: ${deck.deckType || deck.type || "unknown"}`);
    if (deck.project) {
      lines.push(`- **Project**: ${deck.project.name || deck.project.id || deck.project}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Format projects for listing
 */
export function formatProjectList(projects: any[], format: ResponseFormat): string {
  if (format === ResponseFormat.JSON) {
    return JSON.stringify({ projects }, null, 2);
  }

  const lines = ["# Projects", ""];

  for (const project of projects) {
    const status = project.isArchived ? " (Archived)" : "";
    lines.push(`## ${project.name}${status}`);
    lines.push(`- **ID**: ${project.id}`);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Format milestones for listing
 */
export function formatMilestoneList(milestones: any[], format: ResponseFormat): string {
  if (format === ResponseFormat.JSON) {
    return JSON.stringify({ milestones }, null, 2);
  }

  const lines = ["# Milestones", ""];

  for (const milestone of milestones) {
    lines.push(`## ${milestone.name}`);
    lines.push(`- **ID**: ${milestone.id}`);
    if (milestone.date || milestone.dueDate) {
      lines.push(`- **Due Date**: ${milestone.date || milestone.dueDate}`);
    }
    if (milestone.description) {
      lines.push(`- **Description**: ${milestone.description}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Check if response exceeds character limit and truncate if needed
 */
export function checkAndTruncate(content: string, dataLength: number): { content: string; truncated: boolean } {
  if (content.length <= CHARACTER_LIMIT) {
    return { content, truncated: false };
  }

  const truncationMsg = `\n\n---\n**Response truncated** - showing approximately half of ${dataLength} items. Use pagination (offset/limit) or add filters to see more results.`;
  const maxLength = CHARACTER_LIMIT - truncationMsg.length;
  
  return {
    content: content.substring(0, maxLength) + truncationMsg,
    truncated: true
  };
}
