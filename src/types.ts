/**
 * Type definitions for Codecks API
 */

export enum ResponseFormat {
  MARKDOWN = "markdown",
  JSON = "json"
}

export enum ResponseMode {
  COMPACT = "compact",
  FULL = "full"
}

export interface CodecksCard {
  id: string;
  accountSeq: number;
  title: string;
  content: string;
  derivedStatus: string;
  effort?: number;
  priority?: string;
  assignee?: { id: string; name: string };
  deck?: { id: string; name: string };
  milestone?: { id: string; name: string };
  createdAt: string;
  lastUpdatedAt: string;
}

export interface CodecksDeck {
  id: string;
  name: string;
  type: string;
  cardCount?: number;
  project?: { id: string; name: string };
}

export interface CodecksProject {
  id: string;
  name: string;
  isArchived: boolean;
}

export interface CodecksMilestone {
  id: string;
  name: string;
  dueDate?: string;
  description?: string;
}

export interface CodecksAccount {
  id: string;
  name: string;
  subdomain: string;
}

export interface CodecksUser {
  id: string;
  name: string;
  email: string;
}

export interface QueryFilter {
  [key: string]: unknown;
}

export interface PaginationMeta {
  count: number;
  offset: number;
  has_more: boolean;
  next_offset?: number;
}
