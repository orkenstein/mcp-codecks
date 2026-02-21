# AGENTS.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Common commands
- Install deps: `npm install`
- Build (compiles TS + copies schema to `dist/`): `npm run build`
- Dev mode (ts-node watch): `npm run dev`
- Run built server (stdio by default): `npm start`
- Generate Codecks schema from docs: `npm run generate:schema`
- Unit tests: `npm test`
- Watch tests: `npm run test:watch`
- Integration tests (read): `npm run test:integration`
- Run a single test file: `npx vitest run tests/unit/codecks-client.test.ts`

## Required configuration
- `CODECKS_AUTH_TOKEN` and `CODECKS_ACCOUNT_SUBDOMAIN` are required for running the server and integration tests.
- HTTP transport uses `TRANSPORT=http` and optionally `PORT=3000`.
- Write integration tests are gated by `CODECKS_RUN_WRITE_TESTS=1`.

## Architecture overview
- `src/index.ts` is the main entrypoint. It:
  - Loads the API schema via `loadSchema()` and defines a set of manual tools (cards, decks, projects, milestones, user).
  - Registers auto-generated `codecks_list_*` / `codecks_get_*` tools via `registerAutoTools()` for remaining models.
  - Chooses transport (`stdio` vs `http`) based on `TRANSPORT` and validates required env vars.
- `src/services/codecks-client.ts` wraps the Codecks API:
  - `query()` sends GraphQL-like JSON queries to `https://api.codecks.io/`
  - `dispatch()` hits `/dispatch/*` endpoints for mutations
  - Centralized error mapping + formatting in `formatError()`.
- `src/schemas/tool-schemas.ts` defines Zod input schemas for manual tools (shared response format, pagination, etc.).
- `src/utils/query-builder.ts` builds query keys, validates selections against schema, and denormalizes Codecks’ normalized responses.
- `src/utils/auto-tools.ts` inspects the schema to generate list/get tools with default selections, ordering, and formatting.
- `src/utils/format.ts` handles markdown/JSON output formatting and response truncation.
- `src/utils/schema.ts` loads `src/schemas/codecks-api-schema.json` in dev (or `dist/schemas/` in production).

## Schema generation flow
- `scripts/generate-api-schema.mjs` parses `docs/codecks-api/api-reference.md` to produce `src/schemas/codecks-api-schema.json`.
- `npm run build` copies that schema into `dist/schemas/` so the runtime loader can find it.
