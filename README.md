# Codecks MCP Server

## TL;DR Installation

```bash
npm install
npm run build
export CODECKS_AUTH_TOKEN="your-token-here"
export CODECKS_ACCOUNT_SUBDOMAIN="your-subdomain"
npm start
```

This starts the MCP server over stdio (default transport).

### Claude Code (`.mcp.json`)

```json
{
  "mcpServers": {
    "codecks": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-codecks/dist/index.js"],
      "env": {
        "CODECKS_AUTH_TOKEN": "${CODECKS_AUTH_TOKEN}",
        "CODECKS_ACCOUNT_SUBDOMAIN": "${CODECKS_ACCOUNT_SUBDOMAIN}"
      }
    }
  }
}
```


### Warp Oz Cloud Agent (`--mcp` inline JSON)

```bash
oz agent run \
  --mcp '{"codecks":{"command":"node","args":["/absolute/path/to/mcp-codecks/dist/index.js"],"env":{"CODECKS_AUTH_TOKEN":"${CODECKS_AUTH_TOKEN}","CODECKS_ACCOUNT_SUBDOMAIN":"${CODECKS_ACCOUNT_SUBDOMAIN}"}}}' \
  -p "Use the Codecks MCP server to list projects"
```

MCP (Model Context Protocol) server for integrating with [Codecks](https://www.codecks.io/), a game development project tracker. This server enables LLMs to interact with your Codecks organization to manage cards, decks, milestones, and projects.

## Features

- **Card Management**: List, retrieve, and create cards with full metadata
- **Deck Operations**: List and view decks across projects
- **Space Discovery**: List spaces and inspect a specific space by project
- **Project Management**: List all projects in your organization
- **Milestone Tracking**: View and manage milestones
- **User Information**: Get current authenticated user details
- **Flexible Formatting**: Support for both human-readable markdown and structured JSON output
- **Pagination**: Efficient handling of large result sets
- **Error Handling**: Clear, actionable error messages

## Prerequisites

- Node.js 18 or higher
- A Codecks account with API access
- Codecks API token and organization subdomain

## Installation

1. Clone or download this repository
2. Install dependencies:

```bash
npm install
```

3. Build the TypeScript code:

```bash
npm run build
```

## Configuration

The server requires two environment variables:

- `CODECKS_AUTH_TOKEN`: Your Codecks API token (extract from the `at` cookie when logged into Codecks)
- `CODECKS_ACCOUNT_SUBDOMAIN`: Your organization's subdomain (e.g., if your org is at `team123.codecks.io`, use `team123`)

### Extracting Your API Token

1. Log into your Codecks account at https://codecks.io
2. Open your browser's developer tools (F12)
3. Go to the Network tab
4. Look for requests to `api.codecks.io`
5. Find the `at` cookie value - this is your API token

## Usage

### Running Locally (stdio transport)

```bash
export CODECKS_AUTH_TOKEN="your-token-here"
export CODECKS_ACCOUNT_SUBDOMAIN="your-subdomain"
npm start
```

### Running as HTTP Server

```bash
export CODECKS_AUTH_TOKEN="your-token-here"
export CODECKS_ACCOUNT_SUBDOMAIN="your-subdomain"
export TRANSPORT=http
export PORT=3000
npm start
```

### Development Mode

```bash
export CODECKS_AUTH_TOKEN="your-token-here"
export CODECKS_ACCOUNT_SUBDOMAIN="your-subdomain"
npm run dev
```


## Available Tools

In addition to the curated tools below, the server auto-generates `codecks_list_<model>` and
`codecks_get_<model>` tools for most models defined in `docs/codecks-api/api-reference.md`.
Tool names use snake_case model names (e.g., `codecks_list_account_user_setting`).

### Card Operations
- `codecks_list_cards` - List cards with filtering by deck, milestone, assignee, status, or search term (`exclude_deleted` defaults to `true`; `response_mode` supports `compact`/`full`)
- `codecks_get_card` - Get detailed information about a specific card (supports optional `include_relations`)
- `codecks_get_card` - Get detailed information about a specific card
- `codecks_delete_card` - Archive (soft-delete) a card by ID
- `codecks_create_card` - Create a new card with content, properties, and assignments (when `child_cards` is provided, the server enforces linkage post-create for existing child IDs)
- `codecks_update_card` - Update one card's status/deck/milestone, parent linkage (`parent_card_id`) and/or child set (`child_cards`) plus content/assignee
- `codecks_bulk_update_cards` - Bulk update card status and/or move cards to a deck
- `codecks_start_journey` - Explicitly apply workflow/journey expansion to a card

### Deck Operations

- `codecks_list_decks` - List all decks, optionally filtered by project (`response_mode`: `compact`/`full`)
- `codecks_get_deck` - Get detailed information about a specific deck
- `codecks_create_deck` - Create a new deck in a project
- `codecks_update_deck` - Update deck title and/or deck type
- `codecks_delete_deck` - Delete/archive a deck
- `codecks_add_decks_to_space_after` - Reorder decks within a space
- `codecks_list_spaces` - List spaces across projects (or for one project) with `space_id`, icon, and default deck type
- `codecks_get_space` - Get one space by `project_id` + numeric `space_id`
- `codecks_create_space` - Create a space in a project (uses `projects/update` under the hood)
- `codecks_update_space` - Rename/change icon/default deck type for a space
- `codecks_delete_space` - Delete a space from a project

### Project & Milestone Operations

- `codecks_list_projects` - List all projects (with optional archived projects; `response_mode`: `compact`/`full`)
- `codecks_create_project` - Create a new project
- `codecks_set_project_visibility` - Update project visibility (use `deleted` to remove)
- `codecks_list_milestones` - List all milestones with due dates (`response_mode`: `compact`/`full`)
- `codecks_get_milestone` - Get detailed information about a specific milestone
- `codecks_create_milestone` - Create a milestone and attach it to project(s)
- `codecks_create_milestone_project` - Link an existing milestone to an additional project
- `codecks_update_milestone` - Update milestone fields and linked projects
- `codecks_delete_milestone` - Delete/archive a milestone
- `codecks_unlink_milestone_project` - Remove a project from a milestone's linked projects

### Interaction Operations

- `codecks_add_to_hand` / `codecks_remove_from_hand` - Add/remove cards from your hand
- `codecks_add_to_queue` / `codecks_remove_from_queue` / `codecks_reorder_queue` - Manage queue membership and ordering
- `codecks_upvote_card` / `codecks_remove_card_upvote` - Add/remove your upvote on a card
- `codecks_subscribe_card` / `codecks_unsubscribe_card` - Subscribe/unsubscribe to card updates
- `codecks_subscribe_deck` / `codecks_unsubscribe_deck` - Subscribe/unsubscribe to deck updates

### User Operations

- `codecks_get_current_user` - Get information about the authenticated user (useful for getting your user ID)
- `codecks_stats` - View lightweight per-tool session metrics (calls, errors, and response bytes)

## Examples

### List recent cards
```typescript
{
  "name": "codecks_list_cards",
  "arguments": {
    "limit": 10,
    "response_format": "markdown"
  }
}
```

### Create a hero deck
```typescript
{
  "name": "codecks_create_deck",
  "arguments": {
    "title": "Core Hero",
    "project_id": "your-project-id",
    "user_id": "your-user-id",
    "space_id": 1,
    "deck_type": "hero"
  }
}
```

### Rename a deck and change its type
```typescript
{
  "name": "codecks_update_deck",
  "arguments": {
    "deck_id": "your-deck-id",
    "title": "Gameplay Systems",
    "deck_type": "hero"
  }
}
```

### List spaces in a project
```typescript
{
  "name": "codecks_list_spaces",
  "arguments": {
    "project_id": "your-project-id",
    "response_format": "json"
  }
}
```

### Create a space in a project
```typescript
{
  "name": "codecks_create_space",
  "arguments": {
    "project_id": "your-project-id",
    "name": "QA",
    "icon": null,
    "default_deck_type": "task"
  }
}
```

### Create a new card
```typescript
{
  "name": "codecks_create_card",
  "arguments": {
    "content": "Fix login bug\n\nUsers are unable to log in with special characters in their password.",
    "priority": "a",
    "effort": 5,
    "user_id": "your-user-id"
  }
}
```

### Search for cards
```typescript
{
  "name": "codecks_list_cards",
  "arguments": {
    "search": "login",
    "status": "started",
    "response_format": "json"
  }
}
```

### Update one card
```typescript
{
  "name": "codecks_update_card",
  "arguments": {
    "card_id": "your-card-id",
    "status": "review",
    "parent_card_id": "your-parent-card-id",
    "child_cards": ["child-card-id-1", "child-card-id-2"],
    "content": "Updated title line\\n\\nUpdated body text",
    "assignee_id": "your-user-id"
  }
}
```
Note: set `parent_card_id` to `null` to unlink a card from its current parent, and set `child_cards` to `[]` to clear all current children. Codecks currently applies text edits through `content`; `title`-only mutation is not reliably supported by the API endpoint.

## API Rate Limits

Codecks API has a rate limit of **40 requests per 5 seconds** per IP address. The server will return clear error messages if you hit this limit.

## Testing

### Unit and Integration Tests

Run the test suite:

```bash
npm test                    # Unit tests
npm run test:integration    # Integration tests (requires API credentials)
npm run test:watch          # Watch mode
```

### MCP Inspector

You can test the server interactively using the MCP Inspector:

```bash
npx @modelcontextprotocol/inspector dist/index.js
```

### Evaluation Suite

Run the comprehensive evaluation suite to test all MCP tools:

```bash
npm run eval          # Run evaluation suite
npm run eval:verbose  # Run with detailed output
```

See [evaluations/README.md](evaluations/README.md) for more details on the evaluation framework.

## Architecture

The server follows MCP best practices:

- **TypeScript** with strict type checking
- **Zod** schemas for runtime input validation
- **Comprehensive error handling** with actionable messages
- **Pagination support** for large result sets
- **Both stdio and HTTP transports** for local and remote usage
- **Character limits** to prevent overwhelming responses
- **Proper tool annotations** (readOnlyHint, destructiveHint, etc.)

## Project Structure

```
codecks-mcp-server/
├── src/
│   ├── index.ts              # Main server and tool registrations
│   ├── types.ts              # TypeScript interfaces
│   ├── constants.ts          # Configuration constants
│   ├── services/
│   │   └── codecks-client.ts # Codecks API client
│   ├── schemas/
│   │   ├── tool-schemas.ts   # Zod validation schemas
│   │   └── codecks-api-schema.json # Generated API schema
│   └── utils/
│       ├── format.ts         # Response formatting utilities
│       ├── query-builder.ts  # Query construction and denormalization
│       ├── auto-tools.ts     # Auto-generated list/get tools
│       └── schema.ts         # Schema loader
├── scripts/
│   └── generate-api-schema.mjs # Schema generation from API docs
├── tests/
│   ├── unit/                 # Unit tests (100% coverage)
│   └── integration/          # Integration tests
├── docs/
│   └── codecks-api/          # Codecks API documentation
├── dist/                     # Compiled JavaScript
├── coverage/                 # Test coverage reports
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── eslint.config.js
└── README.md
```

## Contributing

This server was built following the [MCP Server Development Guide](https://modelcontextprotocol.io/) best practices for TypeScript implementations.

## License

MIT

## Links

- [Codecks](https://www.codecks.io/)
- [Codecks API Documentation](https://manual.codecks.io/api/)
- [Model Context Protocol](https://modelcontextprotocol.io/)
