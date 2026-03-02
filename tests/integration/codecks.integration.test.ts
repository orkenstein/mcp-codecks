import { describe, expect, it } from "vitest";
import { CodecksClient } from "../../src/services/codecks-client.js";
import { spawn } from "child_process";
import { existsSync } from "fs";

const authToken = process.env.CODECKS_AUTH_TOKEN;
const subdomain = process.env.CODECKS_ACCOUNT_SUBDOMAIN;
const runWriteTests = process.env.CODECKS_RUN_WRITE_TESTS === "1";

const maybeDescribe = authToken && subdomain ? describe : describe.skip;

maybeDescribe("codecks integration (read)", () => {
  const client = new CodecksClient(authToken as string, subdomain as string);

  async function callMcpTool(toolName: string, args: Record<string, unknown>) {
    return new Promise<any>((resolve, reject) => {
      const child = spawn("node", ["dist/index.js"], {
        env: process.env,
        stdio: ["pipe", "pipe", "pipe"]
      });

      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => {
        stdout += d.toString();
      });
      child.stderr.on("data", (d) => {
        stderr += d.toString();
      });

      child.on("close", () => {
        try {
          const jsonLine = stdout.split("\n").find((l) => l.trim().startsWith("{"));
          if (!jsonLine) {
            reject(new Error(`No JSON response from MCP tool call. stderr=${stderr}`));
            return;
          }
          resolve(JSON.parse(jsonLine));
        } catch (error) {
          reject(error);
        }
      });

      child.stdin.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: {
            name: toolName,
            arguments: args
          }
        }) + "\n"
      );
      child.stdin.end();
    });
  }

  it("fetches current user", async () => {
    const query = {
      _root: [
        {
          loggedInUser: ["id", "name"]
        }
      ]
    };

    const response: any = await client.query(query);
    const userId = response?._root?.loggedInUser;
    expect(userId).toBeTruthy();
  });

  it("reads account info", async () => {
    const query = {
      _root: [
        {
          account: ["id", "name", "subdomain"]
        }
      ]
    };

    const response: any = await client.query(query);
    const root = response?._root;
    const accountId = Array.isArray(root) ? root[0]?.account : root?.account;
    expect(accountId).toBeTruthy();
  });

  it("supports project-scoped deck filtering via client-side deck.project relation", async () => {
    const query = {
      _root: [
        {
          account: [
            {
              decks: ["id", "title", { project: ["id", "name"] }]
            }
          ]
        }
      ]
    };

    const response: any = await client.query(query);
    const root = response?._root;
    const accountId = Array.isArray(root) ? root[0]?.account : root?.account;
    const deckIds = accountId ? response?.account?.[accountId]?.decks || [] : [];
    expect(Array.isArray(deckIds)).toBe(true);

    if (deckIds.length === 0) {
      return;
    }

    const firstProjectId = response?.deck?.[deckIds[0]]?.project;
    expect(firstProjectId).toBeTruthy();

    const filteredDecks = deckIds.filter((deckId: string) => response?.deck?.[deckId]?.project === firstProjectId);
    expect(filteredDecks.length).toBeGreaterThan(0);
  });

  it("reads deck by ID using array syntax", async () => {
    const listQuery = {
      _root: [
        {
          account: [
            {
              decks: ["id", "title"]
            }
          ]
        }
      ]
    };
    const listResponse: any = await client.query(listQuery);
    const root = listResponse?._root;
    const accountId = Array.isArray(root) ? root[0]?.account : root?.account;
    const deckId = accountId ? listResponse?.account?.[accountId]?.decks?.[0] : undefined;

    if (!deckId) {
      return;
    }

    const getQuery = {
      [`deck(${JSON.stringify([deckId])})`]: ["id", "title", "deckType"]
    };
    const getResponse: any = await client.query(getQuery);
    expect(getResponse?.deck?.[deckId]?.id).toBe(deckId);
  });

  it("reads milestone by ID using array syntax", async () => {
    const listQuery = {
      _root: [
        {
          account: [
            {
              milestones: ["id", "name"]
            }
          ]
        }
      ]
    };
    const listResponse: any = await client.query(listQuery);
    const root = listResponse?._root;
    const accountId = Array.isArray(root) ? root[0]?.account : root?.account;
    const milestoneId = accountId ? listResponse?.account?.[accountId]?.milestones?.[0] : undefined;

    if (!milestoneId) {
      return;
    }

    const getQuery = {
      [`milestone(${JSON.stringify([milestoneId])})`]: ["id", "name", "description", "date"]
    };
    const getResponse: any = await client.query(getQuery);
    expect(getResponse?.milestone?.[milestoneId]?.id).toBe(milestoneId);
  });

  it("lists cards by deck via MCP tool without false-empty results", async () => {
    if (!existsSync("dist/index.js")) {
      return;
    }

    const rawQuery = {
      _root: [
        {
          account: [
            {
              cards: ["title", { deck: ["id", "title"] }]
            }
          ]
        }
      ]
    };
    const raw: any = await client.query(rawQuery);
    const root = raw?._root;
    const accountId = Array.isArray(root) ? root[0]?.account : root?.account;
    const cardIds: string[] = accountId ? raw?.account?.[accountId]?.cards || [] : [];

    const cardsByDeck = new Map<string, string[]>();
    for (const cardId of cardIds) {
      const deckId = raw?.card?.[cardId]?.deck;
      const title = raw?.card?.[cardId]?.title;
      if (!deckId || !title) continue;
      const arr = cardsByDeck.get(deckId) || [];
      arr.push(title);
      cardsByDeck.set(deckId, arr);
    }

    const candidate = [...cardsByDeck.entries()].find(([, titles]) => titles.length > 0);
    if (!candidate) {
      return;
    }

    const [deckId, expectedTitles] = candidate;
    const result = await callMcpTool("codecks_list_cards", {
      deck_id: deckId,
      limit: 100,
      offset: 0,
      response_format: "json"
    });

    expect(result?.result?.isError).not.toBe(true);
    const listedCards = result?.result?.structuredContent?.cards || [];
    expect(listedCards.length).toBeGreaterThan(0);
    expect(listedCards.length).toBe(Math.min(100, expectedTitles.length));
    for (const card of listedCards) {
      expect(card?.id).toBeTruthy();
      expect(card?.cardId).toBeUndefined();
      const listedDeckId = typeof card?.deck === "object" ? card.deck?.id : card?.deck;
      expect(listedDeckId).toBe(deckId);
    }
  });

  it("retrieves card details via codecks_get_card without 500", async () => {
    if (!existsSync("dist/index.js")) {
      return;
    }

    const listResult = await callMcpTool("codecks_list_cards", {
      limit: 1,
      offset: 0,
      response_format: "json"
    });
    expect(listResult?.result?.isError).not.toBe(true);
    const firstCard = listResult?.result?.structuredContent?.cards?.[0];
    const cardId = firstCard?.id;
    if (!cardId) {
      return;
    }

    const getResult = await callMcpTool("codecks_get_card", {
      card_id: cardId,
      response_format: "json"
    });
    expect(getResult?.result?.isError).not.toBe(true);
    const card = getResult?.result?.structuredContent || {};
    expect(card.id).toBe(cardId);
  });

  it("keeps account and activity list tools consistent with get_account", async () => {
    if (!existsSync("dist/index.js")) {
      return;
    }

    const listAccount = await callMcpTool("codecks_list_account", {
      limit: 20,
      offset: 0,
      response_format: "json"
    });

    expect(listAccount?.result?.isError).not.toBe(true);
    const listedAccounts = listAccount?.result?.structuredContent?.items || [];
    expect(Array.isArray(listedAccounts)).toBe(true);
    expect(listedAccounts.length).toBeGreaterThan(0);

    const accountId = listedAccounts[0]?.id;
    if (!accountId) {
      return;
    }

    const getAccount = await callMcpTool("codecks_get_account", {
      id: accountId,
      selection: [{ activities: ["type", "createdAt"] }],
      response_format: "json"
    });
    expect(getAccount?.result?.isError).not.toBe(true);
    const getAccountPayload = getAccount?.result?.structuredContent || {};
    expect(getAccountPayload.id).toBe(accountId);

    const listActivity = await callMcpTool("codecks_list_activity", {
      limit: 20,
      offset: 0,
      response_format: "json"
    });
    expect(listActivity?.result?.isError).not.toBe(true);
    const listedActivities = listActivity?.result?.structuredContent?.items || [];
    expect(Array.isArray(listedActivities)).toBe(true);

    const getAccountActivities = getAccountPayload.activities || [];
    if (Array.isArray(getAccountActivities) && getAccountActivities.length > 0) {
      expect(listedActivities.length).toBeGreaterThan(0);
    }
  });
});

const maybeDescribeWrite =
  authToken && subdomain && runWriteTests ? describe : describe.skip;

maybeDescribeWrite("codecks integration (write)", () => {
  const client = new CodecksClient(authToken as string, subdomain as string);

  it("creates and deletes a project", async () => {
    const name = `MCP Integration Test ${Date.now()}`;
    const createPayload = {
      name,
      fileId: null,
      defaultUserAccess: "everyone",
      templateId: "cdx/survival"
    };

    const created: any = await client.dispatch("projects/create", createPayload);

    const projectId =
      created?.projectId ||
      created?.id ||
      created?.payload?.id ||
      created?.payload?.projectId;

    expect(projectId).toBeTruthy();

    const deletePayload = {
      id: projectId,
      visibility: "deleted"
    };

    await client.dispatch("projects/setVisibility", deletePayload);
  });
});
