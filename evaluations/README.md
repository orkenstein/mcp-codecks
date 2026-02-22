# Codecks MCP Server Evaluation Suite

This directory contains evaluation tests for the Codecks MCP server to verify that tools work correctly and enable LLMs to accomplish real-world tasks.

## Evaluation Files

- **codecks-mcp-eval.xml** - Comprehensive evaluation questions testing all major MCP tools
- **run-evaluation.mjs** - Automated test runner (optional, requires MCP Inspector or custom client)

## Running Evaluations

### Option 1: Manual Testing with MCP Inspector

The recommended way to run evaluations is using the MCP Inspector:

```bash
# 1. Build the server
npm run build

# 2. Start the MCP Inspector
npx @modelcontextprotocol/inspector dist/index.js

# 3. Open the Inspector UI in your browser (typically http://localhost:6277)

# 4. For each question in codecks-mcp-eval.xml:
#    - Read the question
#    - Use the Inspector to call the appropriate tool(s)
#    - Verify the answer matches expectations
```

### Option 2: Testing with an LLM Client

Connect the Codecks MCP server to an LLM client (like Claude Desktop) and ask it the evaluation questions directly:

```json
{
  "mcpServers": {
    "codecks": {
      "command": "node",
      "args": ["/path/to/mcp-codecks/dist/index.js"],
      "env": {
        "CODECKS_AUTH_TOKEN": "your-token",
        "CODECKS_ACCOUNT_SUBDOMAIN": "your-subdomain"
      }
    }
  }
}
```

Then ask the LLM each question from the evaluation suite.

### Option 3: Automated Runner (Experimental)

```bash
# Run all evaluation questions
node scripts/run-evaluation.mjs

# Run with verbose output
node scripts/run-evaluation.mjs --verbose
```

**Note**: The automated runner is experimental and may require adjustments based on your MCP client implementation.

## Evaluation Questions

The evaluation suite includes 10 questions covering:

1. **User Authentication** - Getting current user info
2. **Project Listing** - Filtering projects by visibility
3. **Deck Management** - Listing decks across projects  
4. **Card Filtering** - Filtering cards by status, dates
5. **Milestone Tracking** - Listing milestones and dates
6. **Multi-step Lookups** - Chaining tool calls for complex queries
7. **Pagination** - Handling large result sets
8. **Relationship Traversal** - Following card→deck, card→project relationships

## Creating New Evaluations

When adding new evaluation questions, ensure they:

- Are **independent** - Don't depend on previous questions
- Are **read-only** - Only use non-destructive operations
- Are **complex** - Require multiple tool calls or deep exploration
- Are **realistic** - Based on real use cases
- Are **verifiable** - Have a clear, testable answer
- Are **stable** - Answer won't change frequently

### Example Question Format

```xml
<qa_pair>
  <question>What is the title of the most recently updated card?</question>
  <answer_type>string</answer_type>
  <answer>{"tool": "codecks_list_cards", "params": {"limit": 1, "response_format": "json"}}</answer>
  <notes>Tests card ordering by lastUpdatedAt and pagination</notes>
</qa_pair>
```

## Success Criteria

A successful evaluation run should achieve:

- ✅ **80%+ pass rate** on automated tests
- ✅ All core tools (list/get for cards, decks, projects, milestones, user) working
- ✅ Filtering and pagination working correctly
- ✅ Error messages are clear and actionable
- ✅ Response formats (JSON/Markdown) both work

## Troubleshooting

### Authentication Errors

Ensure your environment variables are set:
```bash
export CODECKS_AUTH_TOKEN="your-token"
export CODECKS_ACCOUNT_SUBDOMAIN="your-subdomain"
```

### Tool Not Found Errors

Make sure the server is built:
```bash
npm run build
```

### Empty Results

Verify your Codecks account has data:
- At least one project
- At least one card
- At least one deck

## Contributing

When modifying tools, update the evaluation suite to test new functionality and ensure existing tests still pass.
