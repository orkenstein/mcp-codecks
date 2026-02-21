# Codecks MCP Server

MCP (Model Context Protocol) server for integrating with [Codecks](https://www.codecks.io/), a game development project tracker. This server enables LLMs to interact with your Codecks organization to manage cards, decks, milestones, and projects.

## Features

- **Card Management**: List, retrieve, and create cards with full metadata
- **Deck Operations**: List and view decks across projects
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

- `codecks_list_cards` - List cards with filtering by deck, milestone, assignee, status, or search term
- `codecks_get_card` - Get detailed information about a specific card
- `codecks_create_card` - Create a new card with content, properties, and assignments
- `codecks_bulk_update_cards` - Bulk update card status and/or move cards to a deck

### Deck Operations

- `codecks_list_decks` - List all decks, optionally filtered by project
- `codecks_get_deck` - Get detailed information about a specific deck
- `codecks_create_deck` - Create a new deck in a project
- `codecks_add_decks_to_space_after` - Reorder decks within a space

### Project & Milestone Operations

- `codecks_list_projects` - List all projects (with optional archived projects)
- `codecks_create_project` - Create a new project
- `codecks_set_project_visibility` - Update project visibility (use `deleted` to remove)
- `codecks_list_milestones` - List all milestones with due dates
- `codecks_get_milestone` - Get detailed information about a specific milestone

### User Operations

- `codecks_get_current_user` - Get information about the authenticated user (useful for getting your user ID)

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

## API Rate Limits

Codecks API has a rate limit of **40 requests per 5 seconds** per IP address. The server will return clear error messages if you hit this limit.

## Testing

You can test the server using the MCP Inspector:

```bash
npx @modelcontextprotocol/inspector dist/index.js
```

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
│   │   └── tool-schemas.ts   # Zod validation schemas
│   └── utils/
│       └── format.ts         # Response formatting utilities
├── dist/                     # Compiled JavaScript
├── package.json
├── tsconfig.json
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
