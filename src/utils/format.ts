/**
 * Formatting utilities for responses
 */

import { ResponseFormat, ResponseMode } from "../types.js";
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
export function formatCardList(
  cards: any[],
  format: ResponseFormat,
  meta?: any,
  responseMode: ResponseMode = ResponseMode.FULL
): string {
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
    const title = card.title || "(Untitled)";
    const seq = card.accountSeq ?? "?";
    const status = card.derivedStatus || "unknown";
    const assignee = card.assignee?.name;
    const deck = card.deck?.name || card.deck?.title || card.deck?.id || card.deck;
    const milestone = card.milestone?.name || card.milestone?.id || card.milestone;

    if (responseMode === ResponseMode.COMPACT) {
      const details: string[] = [`status: ${status}`];
      if (assignee) details.push(`assignee: ${assignee}`);
      if (deck) details.push(`deck: ${deck}`);
      if (milestone) details.push(`milestone: ${milestone}`);
      lines.push(`- $${seq} ${title} — ${details.join(", ")}`);
      continue;
    }

    lines.push(`## $${seq}: ${title}`);
    lines.push(`- **Status**: ${status}`);
    if (assignee) {
      lines.push(`- **Assignee**: ${assignee}`);
    }
    if (deck) {
      lines.push(`- **Deck**: ${deck}`);
    }
    if (milestone) {
      lines.push(`- **Milestone**: ${milestone}`);
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
export function formatDeckList(
  decks: any[],
  format: ResponseFormat,
  responseMode: ResponseMode = ResponseMode.FULL
): string {
  if (format === ResponseFormat.JSON) {
    return JSON.stringify({ decks }, null, 2);
  }

  const lines = ["# Decks", ""];

  for (const deck of decks) {
    const title = deck.title || deck.name || "(Untitled Deck)";
    const type = deck.deckType || deck.type || "unknown";
    const project = deck.project?.name || deck.project?.id || deck.project;

    if (responseMode === ResponseMode.COMPACT) {
      lines.push(`- ${title} (${deck.id}) — type: ${type}${project ? `, project: ${project}` : ""}`);
      continue;
    }

    lines.push(`## ${title}`);
    lines.push(`- **ID**: ${deck.id}`);
    lines.push(`- **Type**: ${type}`);
    if (project) {
      lines.push(`- **Project**: ${project}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Format projects for listing
 */
export function formatProjectList(
  projects: any[],
  format: ResponseFormat,
  responseMode: ResponseMode = ResponseMode.FULL
): string {
  if (format === ResponseFormat.JSON) {
    return JSON.stringify({ projects }, null, 2);
  }

  const lines = ["# Projects", ""];

  for (const project of projects) {
    const status = project.visibility || (project.isArchived ? "archived" : "active");
    if (responseMode === ResponseMode.COMPACT) {
      lines.push(`- ${project.name} (${project.id}) — ${status}`);
      continue;
    }
    lines.push(`## ${project.name}${project.isArchived ? " (Archived)" : ""}`);
    lines.push(`- **ID**: ${project.id}`);
    lines.push(`- **Visibility**: ${status}`);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Format milestones for listing
 */
export function formatMilestoneList(
  milestones: any[],
  format: ResponseFormat,
  responseMode: ResponseMode = ResponseMode.FULL
): string {
  if (format === ResponseFormat.JSON) {
    return JSON.stringify({ milestones }, null, 2);
  }

  const lines = ["# Milestones", ""];

  for (const milestone of milestones) {
    const dueDate = milestone.date || milestone.dueDate;
    if (responseMode === ResponseMode.COMPACT) {
      lines.push(`- ${milestone.name} (${milestone.id})${dueDate ? ` — due: ${dueDate}` : ""}`);
      continue;
    }
    lines.push(`## ${milestone.name}`);
    lines.push(`- **ID**: ${milestone.id}`);
    if (dueDate) {
      lines.push(`- **Due Date**: ${dueDate}`);
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
export function checkAndTruncate(
  content: string,
  dataLength: number,
  options?: { responseMode?: ResponseMode; totalItems?: number }
): { content: string; truncated: boolean } {
  if (content.length <= CHARACTER_LIMIT) {
    return { content, truncated: false };
  }
  const mode = options?.responseMode || ResponseMode.FULL;
  const total = options?.totalItems ?? dataLength;
  const truncationMsg = `\n\n---\n**Response truncated** - showing partial output for ${dataLength} of ${total} item(s). Use lower limit, higher offset, more filters, or response_mode='compact' to reduce size.`;
  const maxLength = Math.max(0, CHARACTER_LIMIT - truncationMsg.length);
  const cutAt = content.lastIndexOf("\n", maxLength);
  const safeCut = cutAt > Math.floor(maxLength * 0.7) ? cutAt : maxLength;
  
  return {
    content: content.substring(0, safeCut) + truncationMsg + (mode === ResponseMode.COMPACT ? "" : "\nTip: retry with response_mode='compact' for denser summaries."),
    truncated: true
  };
}
