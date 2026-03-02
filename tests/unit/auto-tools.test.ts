import { describe, expect, it } from "vitest";
import { registerAutoTools } from "../../src/utils/auto-tools.js";
import { ResponseFormat } from "../../src/types.js";

type ToolHandler = (params: any) => Promise<any>;

function createServer() {
  const tools: Record<string, { handler: ToolHandler }> = {};
  return {
    tools,
    registerTool: (name: string, _meta: any, handler: ToolHandler) => {
      tools[name] = { handler };
    }
  };
}

const schema = {
  models: {
    _root: {
      type: "root",
      fields: {},
      relations: {
        foos: { type: "foo", cardinality: "many" },
        account: { type: "account", cardinality: "one" }
      }
    },
    account: {
      type: "model",
      fields: {},
      relations: {
        bars: { type: "bar", cardinality: "many" }
      }
    },
    foo: {
      type: "model",
      fields: { id: "string", name: "string", createdAt: "date" },
      relations: {}
    },
    bar: {
      type: "model",
      fields: { id: "string", title: "string" },
      relations: {}
    },
    orphan: {
      type: "model",
      fields: { id: "string" },
      relations: {}
    }
  }
};

describe("auto tools", () => {
  it("registers list/get tools and resolves root relation list", async () => {
    const server = createServer();
    const getClient = () => ({
      query: async () => ({
        _root: [{ foos: ["f1"] }],
        foo: { f1: { id: "f1", name: "Foo" } }
      })
    });
    registerAutoTools({
      server: server as any,
      schema: schema as any,
      getClient: getClient as any,
      formatError: (e) => String(e)
    });

    expect(server.tools["codecks_list_foo"]).toBeTruthy();
    expect(server.tools["codecks_get_foo"]).toBeTruthy();

    const result = await server.tools["codecks_list_foo"].handler({
      response_format: ResponseFormat.JSON
    });
    expect(result.structuredContent.items[0].name).toBe("Foo");
  });

  it("resolves account relation lists when root is missing", async () => {
    const server = createServer();
    const getClient = () => ({
      query: async () => ({
        _root: [{ account: "a1" }],
        account: { a1: { bars: ["b1"] } },
        bar: { b1: { id: "b1", title: "Bar" } }
      })
    });
    registerAutoTools({
      server: server as any,
      schema: schema as any,
      getClient: getClient as any,
      formatError: (e) => String(e)
    });

    const result = await server.tools["codecks_list_bar"].handler({
      response_format: ResponseFormat.JSON
    });
    expect(result.structuredContent.items[0].title).toBe("Bar");

    const markdownResult = await server.tools["codecks_list_bar"].handler({
      response_format: ResponseFormat.MARKDOWN
    });
    expect(markdownResult.structuredContent).toBeUndefined();
  });

  it("returns error when no root/account relation exists", async () => {
    const server = createServer();
    const getClient = () => ({
      query: async () => ({})
    });
    registerAutoTools({
      server: server as any,
      schema: schema as any,
      getClient: getClient as any,
      formatError: (e) => String(e)
    });

    const result = await server.tools["codecks_list_orphan"].handler({
      response_format: ResponseFormat.MARKDOWN
    });
    expect(result.content[0].text).toContain("No root or account relation");
  });

  it("handles get tool and selection parsing", async () => {
    const server = createServer();
    const getClient = () => ({
      query: async () => ({
        foo: { f1: { id: "f1", name: "Foo", createdAt: "2025-01-01" } }
      })
    });
    registerAutoTools({
      server: server as any,
      schema: schema as any,
      getClient: getClient as any,
      formatError: (e) => String(e)
    });

    const result = await server.tools["codecks_get_foo"].handler({
      id: "f1",
      selection: "[\"id\",\"name\"]",
      response_format: ResponseFormat.JSON
    });
    expect(result.structuredContent.name).toBe("Foo");
  });

  it("skips models and existing tool names", () => {
    const server = createServer();
    registerAutoTools({
      server: server as any,
      schema: schema as any,
      getClient: () => ({ query: async () => ({}) }) as any,
      formatError: (e) => String(e),
      skipModels: new Set(["foo"]),
      existingToolNames: new Set(["codecks_list_bar"])
    });

    expect(server.tools["codecks_list_foo"]).toBeUndefined();
    expect(server.tools["codecks_list_bar"]).toBeUndefined();
  });

  it("uses filters and ordering when listing", async () => {
    const server = createServer();
    let lastQuery: any = null;
    const getClient = () => ({
      query: async (query: any) => {
        lastQuery = query;
        return {
          _root: [{ foos: ["f1"] }],
          foo: { f1: { id: "f1", name: "Foo", createdAt: "2026-01-01" } }
        };
      }
    });
    registerAutoTools({
      server: server as any,
      schema: schema as any,
      getClient: getClient as any,
      formatError: (e) => String(e)
    });

    await server.tools["codecks_list_foo"].handler({
      order_by: "createdAt",
      order_desc: false,
      limit: 5,
      offset: 10,
      filters: { name: "x" },
      selection: "not-json",
      response_format: ResponseFormat.JSON
    });

    const key = Object.keys(lastQuery._root[0])[0];
    expect(key.startsWith("foos(")).toBe(true);
    expect(lastQuery._root[0][key]).toBeDefined();
  });

  it("handles order_desc true when ordering", async () => {
    const server = createServer();
    let lastQuery: any = null;
    const getClient = () => ({
      query: async (query: any) => {
        lastQuery = query;
        return { _root: [{ foos: [] }] };
      }
    });
    registerAutoTools({
      server: server as any,
      schema: schema as any,
      getClient: getClient as any,
      formatError: (e) => String(e)
    });

    await server.tools["codecks_list_foo"].handler({
      order_by: "createdAt",
      order_desc: true,
      limit: 1,
      offset: 0,
      response_format: ResponseFormat.JSON
    });

    const key = Object.keys(lastQuery._root[0])[0];
    expect(key).toContain("\"$order\":\"-createdAt\"");
  });

  it("parses non-array json selections and array selections", async () => {
    const server = createServer();
    let lastQuery: any = null;
    const getClient = () => ({
      query: async (query: any) => {
        lastQuery = query;
        return { _root: [{ foos: [] }] };
      }
    });
    registerAutoTools({
      server: server as any,
      schema: schema as any,
      getClient: getClient as any,
      formatError: (e) => String(e)
    });

    await server.tools["codecks_list_foo"].handler({
      selection: "{}",
      response_format: ResponseFormat.JSON
    });
    const keyFallback = Object.keys(lastQuery._root[0])[0];
    expect(lastQuery._root[0][keyFallback]).toEqual(["id", "name", "createdAt"]);

    await server.tools["codecks_list_foo"].handler({
      selection: ["id"],
      response_format: ResponseFormat.JSON
    });
    const keyArray = Object.keys(lastQuery._root[0])[0];
    expect(lastQuery._root[0][keyArray]).toEqual(["id"]);

    await server.tools["codecks_list_foo"].handler({
      selection: { bad: "value" },
      response_format: ResponseFormat.JSON
    });
    const keyObject = Object.keys(lastQuery._root[0])[0];
    expect(lastQuery._root[0][keyObject]).toEqual(["id", "name", "createdAt"]);
  });

  it("falls back to empty items when root relation response is missing", async () => {
    const server = createServer();
    const getClient = () => ({
      query: async () => ({ _root: [{}] })
    });
    registerAutoTools({
      server: server as any,
      schema: schema as any,
      getClient: getClient as any,
      formatError: (e) => String(e)
    });

    const result = await server.tools["codecks_list_foo"].handler({
      response_format: ResponseFormat.JSON
    });
    expect(result.structuredContent.items).toEqual([]);
  });

  it("returns not found for missing get item", async () => {
    const server = createServer();
    const getClient = () => ({
      query: async () => ({ foo: {} })
    });
    registerAutoTools({
      server: server as any,
      schema: schema as any,
      getClient: getClient as any,
      formatError: (e) => String(e)
    });

    const result = await server.tools["codecks_get_foo"].handler({
      id: "missing",
      response_format: ResponseFormat.MARKDOWN
    });
    expect(result.content[0].text).toContain("not found");
  });

  it("uses default field selection when no preferred fields exist", async () => {
    const server = createServer();
    let lastQuery: any = null;
    const customSchema = {
      models: {
        _root: { type: "root", fields: {}, relations: { weirds: { type: "weird", cardinality: "many" } } },
        weird: { type: "model", fields: { foo: "string", bar: "string", baz: "string" }, relations: {} }
      }
    };
    const getClient = () => ({
      query: async (query: any) => {
        lastQuery = query;
        return { _root: [{ weirds: [] }] };
      }
    });
    registerAutoTools({
      server: server as any,
      schema: customSchema as any,
      getClient: getClient as any,
      formatError: (e) => String(e)
    });

    await server.tools["codecks_list_weird"].handler({ response_format: ResponseFormat.JSON });
    const key = Object.keys(lastQuery._root[0])[0];
    expect(lastQuery._root[0][key]).toEqual(["foo", "bar", "baz"]);
  });

  it("uses relation fallback selection when model has no fields", async () => {
    const server = createServer();
    let lastQuery: any = null;
    const customSchema = {
      models: {
        _root: { type: "root", fields: {}, relations: { relonlies: { type: "relonly", cardinality: "many" } } },
        relonly: { type: "model", fields: {}, relations: { child: { type: "foo", cardinality: "one" } } },
        foo: { type: "model", fields: { id: "string" }, relations: {} }
      }
    };
    const getClient = () => ({
      query: async (query: any) => {
        lastQuery = query;
        return { _root: [{ relonlies: [] }] };
      }
    });
    registerAutoTools({
      server: server as any,
      schema: customSchema as any,
      getClient: getClient as any,
      formatError: (e) => String(e)
    });

    await server.tools["codecks_list_relonly"].handler({ response_format: ResponseFormat.JSON });
    const key = Object.keys(lastQuery._root[0])[0];
    expect(lastQuery._root[0][key]).toEqual(["child"]);
  });

  it("handles missing models by returning no relation-path error", async () => {
    const server = createServer();
    const mutableSchema: any = {
      models: {
        _root: { type: "root", fields: {}, relations: { ghosts: { type: "ghost", cardinality: "many" } } },
        ghost: { type: "model", fields: { id: "string" }, relations: {} }
      }
    };
    const getClient = () => ({
      query: async () => ({ _root: [{ ghosts: [] }] })
    });
    registerAutoTools({
      server: server as any,
      schema: mutableSchema as any,
      getClient: getClient as any,
      formatError: (e) => String(e)
    });

    delete mutableSchema.models.ghost;
    const result = await server.tools["codecks_list_ghost"].handler({ response_format: ResponseFormat.JSON });
    expect(result.content[0].text).toContain("Unknown model 'ghost' in schema");
  });

  it("renders markdown output for list and get tools", async () => {
    const server = createServer();
    const getClient = () => ({
      query: async () => ({
        _root: [{ foos: ["f1"] }],
        foo: { f1: { id: "f1", name: "Foo" } }
      })
    });
    registerAutoTools({
      server: server as any,
      schema: schema as any,
      getClient: getClient as any,
      formatError: (e) => String(e)
    });

    const listResult = await server.tools["codecks_list_foo"].handler({
      response_format: ResponseFormat.MARKDOWN
    });
    expect(listResult.content[0].text).toContain("# foo list");
    expect(listResult.content[0].text).toContain("```json");

    const getResult = await server.tools["codecks_get_foo"].handler({
      id: "f1",
      response_format: ResponseFormat.MARKDOWN
    });
    expect(getResult.content[0].text).toContain("# foo");
    expect(getResult.content[0].text).toContain("```json");
  });

  it("formats errors for list and get handler failures", async () => {
    const server = createServer();
    const getClient = () => ({
      query: async () => {
        throw new Error("boom");
      }
    });
    registerAutoTools({
      server: server as any,
      schema: schema as any,
      getClient: getClient as any,
      formatError: (e) => `ERR:${(e as Error).message}`
    });

    const listResult = await server.tools["codecks_list_foo"].handler({
      response_format: ResponseFormat.MARKDOWN
    });
    expect(listResult.content[0].text).toBe("ERR:boom");

    const getResult = await server.tools["codecks_get_foo"].handler({
      id: "f1",
      response_format: ResponseFormat.MARKDOWN
    });
    expect(getResult.content[0].text).toBe("ERR:boom");
  });

  it("uses account relation when root model is missing", async () => {
    const server = createServer();
    const customSchema = {
      models: {
        account: {
          type: "model",
          fields: {},
          relations: { bars: { type: "bar", cardinality: "many" } }
        },
        bar: { type: "model", fields: { id: "string", title: "string" }, relations: {} }
      }
    };
    const getClient = () => ({
      query: async () => ({
        _root: [{ account: "a1" }],
        account: { a1: { bars: ["b1"] } },
        bar: { b1: { id: "b1", title: "Bar" } }
      })
    });
    registerAutoTools({
      server: server as any,
      schema: customSchema as any,
      getClient: getClient as any,
      formatError: (e) => String(e)
    });

    const result = await server.tools["codecks_list_bar"].handler({
      response_format: ResponseFormat.JSON
    });
    expect(result.structuredContent.items).toEqual([]);
  });

  it("returns error when account model is missing", async () => {
    const server = createServer();
    const customSchema = {
      models: {
        _root: { type: "root", fields: {}, relations: { foos: { type: "foo", cardinality: "many" } } },
        foo: { type: "model", fields: { id: "string" }, relations: {} },
        orphan: { type: "model", fields: { id: "string" }, relations: {} }
      }
    };
    const getClient = () => ({ query: async () => ({}) });
    registerAutoTools({
      server: server as any,
      schema: customSchema as any,
      getClient: getClient as any,
      formatError: (e) => String(e)
    });

    const result = await server.tools["codecks_list_orphan"].handler({
      response_format: ResponseFormat.MARKDOWN
    });
    expect(result.content[0].text).toContain("No root or account relation");
  });

  it("handles schemas with missing root/account relations", async () => {
    const server = createServer();
    const customSchema = {
      models: {
        _root: { type: "root", fields: {} },
        account: { type: "model", fields: {} },
        bar: { type: "model", fields: { id: "string" }, relations: {} }
      }
    };
    const getClient = () => ({ query: async () => ({}) });
    registerAutoTools({
      server: server as any,
      schema: customSchema as any,
      getClient: getClient as any,
      formatError: (e) => String(e)
    });

    const result = await server.tools["codecks_list_bar"].handler({
      response_format: ResponseFormat.MARKDOWN
    });
    expect(result.content[0].text).toContain("No root or account relation");
  });

  it("resolves nested account paths for overridden models", async () => {
    const server = createServer();
    const response = {
      _root: [{ account: "a1" }],
      account: { a1: { projects: ["p1"] } },
      project: { p1: { id: "p1", publicProjectInfo: "ppi1", milestoneProjects: ["mp1"] } },
      publicProjectInfo: { ppi1: { id: "ppi1", cardCount: "7" } },
      milestoneProject: { mp1: { id: "mp1" } }
    };
    const getClient = () => ({
      query: async (query: any) => {
        const firstKey = Object.keys(query)[0] || "";
        if (firstKey.startsWith("publicProjectInfo(")) {
          throw new Error("id lookup unsupported");
        }
        return response;
      }
    });
    registerAutoTools({
      server: server as any,
      schema: {
        models: {
          _root: { type: "root", fields: {}, relations: { account: { type: "account", cardinality: "one" } } },
          account: { type: "model", fields: {}, relations: { projects: { type: "project", cardinality: "many" } } },
          project: {
            type: "model",
            fields: { id: "string" },
            relations: {
              publicProjectInfo: { type: "publicProjectInfo", cardinality: "one" },
              milestoneProjects: { type: "milestoneProject", cardinality: "many" }
            }
          },
          publicProjectInfo: { type: "model", fields: { id: "string", cardCount: "string" }, relations: {} },
          milestoneProject: { type: "model", fields: { id: "string" }, relations: {} }
        }
      } as any,
      getClient: getClient as any,
      formatError: (e) => `ERR:${(e as Error).message}`
    });

    const listPpi = await server.tools["codecks_list_public_project_info"].handler({
      response_format: ResponseFormat.JSON
    });
    expect(listPpi.structuredContent.items[0].id).toBe("ppi1");

    const getPpi = await server.tools["codecks_get_public_project_info"].handler({
      id: "ppi1",
      response_format: ResponseFormat.JSON
    });
    expect(getPpi.structuredContent.id).toBe("ppi1");

    const listMp = await server.tools["codecks_list_milestone_project"].handler({
      response_format: ResponseFormat.JSON
    });
    expect(listMp.structuredContent.items[0].id).toBe("mp1");
  });

  it("supports get_public_project_info with project id fallback", async () => {
    const server = createServer();
    const getClient = () => ({
      query: async (query: any) => {
        const firstKey = Object.keys(query)[0] || "";
        if (firstKey.startsWith("project(")) {
          return {
            project: {
              p1: { id: "p1", name: "Project", isPublic: false, visibility: "default", publicProjectInfo: null }
            }
          };
        }
        throw new Error("unexpected query");
      }
    });
    registerAutoTools({
      server: server as any,
      schema: {
        models: {
          _root: { type: "root", fields: {}, relations: { account: { type: "account", cardinality: "one" } } },
          account: { type: "model", fields: {}, relations: { projects: { type: "project", cardinality: "many" } } },
          project: {
            type: "model",
            fields: { id: "string", name: "string", isPublic: "bool", visibility: "string" },
            relations: { publicProjectInfo: { type: "publicProjectInfo", cardinality: "one" } }
          },
          publicProjectInfo: {
            type: "model",
            fields: { cardCount: "string", cardDoneStreak: "string", lastActivityAt: "string" },
            relations: {}
          }
        }
      } as any,
      getClient: getClient as any,
      formatError: (e) => String(e)
    });

    const result = await server.tools["codecks_get_public_project_info"].handler({
      id: "p1",
      response_format: ResponseFormat.JSON
    });
    expect(result.structuredContent.projectId).toBe("p1");
    expect(result.structuredContent.isAvailable).toBe(false);
  });

  it("sanitizes unsafe publicProjectInfo selection fields", async () => {
    const server = createServer();
    const getClient = () => ({
      query: async (query: any) => {
        const serialized = JSON.stringify(query);
        if (serialized.includes("activities7d") || serialized.includes("visits7d")) {
          throw new Error("unsafe field leaked");
        }

        const firstKey = Object.keys(query)[0] || "";
        if (firstKey.startsWith("project(")) {
          return {
            project: { p1: { id: "p1", name: "Project", publicProjectInfo: "ppi1" } },
            publicProjectInfo: { ppi1: { cardCount: "12" } }
          };
        }
        return {
          _root: [{ account: "a1" }],
          account: { a1: { projects: ["p1"] } },
          project: { p1: { id: "p1", publicProjectInfo: "ppi1" } },
          publicProjectInfo: { ppi1: { cardCount: "12" } }
        };
      }
    });
    registerAutoTools({
      server: server as any,
      schema: {
        models: {
          _root: { type: "root", fields: {}, relations: { account: { type: "account", cardinality: "one" } } },
          account: { type: "model", fields: {}, relations: { projects: { type: "project", cardinality: "many" } } },
          project: {
            type: "model",
            fields: { id: "string", name: "string" },
            relations: { publicProjectInfo: { type: "publicProjectInfo", cardinality: "one" } }
          },
          publicProjectInfo: {
            type: "model",
            fields: { cardCount: "string", cardDoneStreak: "string", lastActivityAt: "string", activities7d: "string", visits7d: "string" },
            relations: {}
          }
        }
      } as any,
      getClient: getClient as any,
      formatError: (e) => String(e)
    });

    const listResult = await server.tools["codecks_list_public_project_info"].handler({
      selection: ["activities7d", "visits7d", "cardCount"],
      response_format: ResponseFormat.JSON
    });
    expect(listResult.structuredContent.items[0].cardCount).toBe("12");

    const getResult = await server.tools["codecks_get_public_project_info"].handler({
      id: "p1",
      selection: ["activities7d", "cardCount"],
      response_format: ResponseFormat.JSON
    });
    expect(getResult.structuredContent.cardCount).toBe("12");
  });

  it("registers activity compatibility aliases", async () => {
    const server = createServer();
    const getClient = () => ({
      query: async () => ({
        _root: [{ account: "a1" }],
        account: { a1: { activities: ["ac1"] } },
        activity: { ac1: { id: "ac1", type: "statusChanged", createdAt: "2026-01-01" } }
      })
    });
    registerAutoTools({
      server: server as any,
      schema: {
        models: {
          _root: { type: "root", fields: {}, relations: { account: { type: "account", cardinality: "one" } } },
          account: { type: "model", fields: {}, relations: { activities: { type: "activity", cardinality: "many" } } },
          activity: { type: "model", fields: { id: "string", type: "string", createdAt: "date" }, relations: {} }
        }
      } as any,
      getClient: getClient as any,
      formatError: (e) => String(e)
    });

    expect(server.tools["codecks_list_activities"]).toBeTruthy();
    expect(server.tools["codecks_get_activities"]).toBeTruthy();

    const listAlias = await server.tools["codecks_list_activities"].handler({
      response_format: ResponseFormat.JSON
    });
    expect(listAlias.structuredContent.items[0].id).toBe("ac1");

    const getAlias = await server.tools["codecks_get_activities"].handler({
      id: "ac1",
      response_format: ResponseFormat.JSON
    });
    expect(getAlias.structuredContent.id).toBe("ac1");
  });

  it("registers sprint compatibility aliases", async () => {
    const server = createServer();
    const getClient = () => ({
      query: async () => ({
        _root: [{ account: "a1" }],
        account: { a1: { sprints: ["sp1"] } },
        sprint: { sp1: { id: "sp1", name: "Sprint 1" } }
      })
    });
    registerAutoTools({
      server: server as any,
      schema: {
        models: {
          _root: { type: "root", fields: {}, relations: { account: { type: "account", cardinality: "one" } } },
          account: { type: "model", fields: {}, relations: { sprints: { type: "sprint", cardinality: "many" } } },
          sprint: { type: "model", fields: { id: "string", name: "string" }, relations: {} }
        }
      } as any,
      getClient: getClient as any,
      formatError: (e) => String(e)
    });

    expect(server.tools["codecks_list_sprints"]).toBeTruthy();

    const listAlias = await server.tools["codecks_list_sprints"].handler({
      response_format: ResponseFormat.JSON
    });
    expect(listAlias.structuredContent.items[0].id).toBe("sp1");
  });

  it("handles queried relation keys for activity and account list responses", async () => {
    const server = createServer();
    const seenQueries: any[] = [];
    const getClient = () => ({
      query: async (query: any) => {
        seenQueries.push(query);
        const root = query?._root?.[0] || {};
        const accountSelection = root.account;

        if (Array.isArray(accountSelection)) {
          const relationObj = accountSelection.find((item: unknown) => typeof item === "object") as Record<string, any> | undefined;
          const relationKey = relationObj ? Object.keys(relationObj)[0] : "";

          if (relationKey.startsWith("activities(")) {
            return {
              _root: [{ account: "a1" }],
              account: {
                a1: {
                  id: "a1",
                  [relationKey]: ["ac1"]
                }
              },
              activity: {
                ac1: { id: "ac1", type: "statusChanged", createdAt: "2026-01-01" }
              }
            };
          }

          return {
            _root: [{ "account({\"$order\":\"-createdAt\",\"$limit\":20,\"$offset\":0})": "a1" }],
            account: {
              a1: { id: "a1", name: "RGSTD", createdAt: "2026-01-01" }
            }
          };
        }

        return { _root: [{ account: "a1" }], account: { a1: { id: "a1", name: "RGSTD" } } };
      }
    });

    registerAutoTools({
      server: server as any,
      schema: {
        models: {
          _root: { type: "root", fields: {}, relations: { account: { type: "account", cardinality: "one" } } },
          account: {
            type: "model",
            fields: { id: "string", name: "string", createdAt: "date" },
            relations: { activities: { type: "activity", cardinality: "many" } }
          },
          activity: { type: "model", fields: { id: "string", type: "string", createdAt: "date" }, relations: {} }
        }
      } as any,
      getClient: getClient as any,
      formatError: (e) => String(e)
    });

    const activities = await server.tools["codecks_list_activity"].handler({
      limit: 20,
      offset: 0,
      response_format: ResponseFormat.JSON
    });
    expect(activities.structuredContent.items).toHaveLength(1);
    expect(activities.structuredContent.items[0].id).toBe("ac1");

    const accounts = await server.tools["codecks_list_account"].handler({
      limit: 20,
      offset: 0,
      response_format: ResponseFormat.JSON
    });
    expect(accounts.structuredContent.items).toHaveLength(1);
    expect(accounts.structuredContent.items[0].id).toBe("a1");
    expect(accounts.structuredContent.items[0].name).toBe("RGSTD");

    const accountListQuery = seenQueries.find((q) => Array.isArray(q?._root) && q._root[0]?.account);
    expect(Object.keys(accountListQuery._root[0])[0]).toBe("account");
  });

  it("does not append query args for singleton root relations", async () => {
    const server = createServer();
    let lastQuery: any = null;
    const getClient = () => ({
      query: async (query: any) => {
        lastQuery = query;
        return {
          _root: [{ account: "a1" }],
          account: { a1: { id: "a1", name: "Main", createdAt: "2026-01-01" } }
        };
      }
    });

    registerAutoTools({
      server: server as any,
      schema: {
        models: {
          _root: { type: "root", fields: {}, relations: { account: { type: "account", cardinality: "one" } } },
          account: { type: "model", fields: { id: "string", name: "string", createdAt: "date" }, relations: {} }
        }
      } as any,
      getClient: getClient as any,
      formatError: (e) => String(e)
    });

    await server.tools["codecks_list_account"].handler({
      limit: 10,
      offset: 0,
      response_format: ResponseFormat.JSON
    });

    expect(Object.keys(lastQuery._root[0])[0]).toBe("account");
  });

  it("falls back to unfiltered milestoneProject queries and filters client-side", async () => {
    const server = createServer();
    const getClient = () => ({
      query: async (query: any) => {
        const serialized = JSON.stringify(query);
        if (serialized.includes("\"projectId\"")) {
          throw new Error("API 500");
        }
        return {
          _root: [{ account: "a1" }],
          account: { a1: { milestones: ["m1"] } },
          milestone: { m1: { milestoneProjects: ["mp1", "mp2"] } },
          milestoneProject: {
            mp1: { id: "mp1", project: "p1", milestone: "m1", account: "a1" },
            mp2: { id: "mp2", project: "p2", milestone: "m1", account: "a1" }
          }
        };
      }
    });

    registerAutoTools({
      server: server as any,
      schema: {
        models: {
          _root: { type: "root", fields: {}, relations: { account: { type: "account", cardinality: "one" } } },
          account: { type: "model", fields: {}, relations: { milestones: { type: "milestone", cardinality: "many" } } },
          milestone: { type: "model", fields: {}, relations: { milestoneProjects: { type: "milestoneProject", cardinality: "many" } } },
          milestoneProject: {
            type: "model",
            fields: {},
            relations: {
              account: { type: "account", cardinality: "one" },
              milestone: { type: "milestone", cardinality: "one" },
              project: { type: "project", cardinality: "one" }
            }
          },
          project: { type: "model", fields: { id: "string", name: "string" }, relations: {} }
        }
      } as any,
      getClient: getClient as any,
      formatError: (e) => String(e)
    });

    const result = await server.tools["codecks_list_milestone_project"].handler({
      filters: { projectId: "p1" },
      response_format: ResponseFormat.JSON
    });
    expect(result.structuredContent.items).toHaveLength(1);
    expect(result.structuredContent.items[0].project).toBe("p1");
  });

  it("normalizes activity data card_id keys to cardId", async () => {
    const server = createServer();
    const getClient = () => ({
      query: async (query: any) => {
        const firstKey = Object.keys(query)[0] || "";
        if (firstKey.startsWith("activity(")) {
          return {
            activity: {
              ac1: {
                id: "ac1",
                createdAt: "2026-01-01",
                data: { card_id: "c1" }
              }
            }
          };
        }
        return {
          _root: [{ account: "a1" }],
          account: { a1: { activities: ["ac1"] } },
          activity: {
            ac1: {
              id: "ac1",
              createdAt: "2026-01-01",
              data: { card_id: "c1", nested: { card_id: "c2" } }
            }
          }
        };
      }
    });

    registerAutoTools({
      server: server as any,
      schema: {
        models: {
          _root: { type: "root", fields: {}, relations: { account: { type: "account", cardinality: "one" } } },
          account: { type: "model", fields: {}, relations: { activities: { type: "activity", cardinality: "many" } } },
          activity: { type: "model", fields: { createdAt: "date", data: "json" }, relations: {} }
        }
      } as any,
      getClient: getClient as any,
      formatError: (e) => String(e)
    });

    const listResult = await server.tools["codecks_list_activity"].handler({
      selection: ["createdAt", "data"],
      response_format: ResponseFormat.JSON
    });
    expect(listResult.structuredContent.items[0].data.cardId).toBe("c1");
    expect(listResult.structuredContent.items[0].data.card_id).toBeUndefined();
    expect(listResult.structuredContent.items[0].data.nested.cardId).toBe("c2");

    const getResult = await server.tools["codecks_get_activity"].handler({
      id: "ac1",
      selection: ["createdAt", "data"],
      response_format: ResponseFormat.JSON
    });
    expect(getResult.structuredContent.data.cardId).toBe("c1");
    expect(getResult.structuredContent.data.card_id).toBeUndefined();
  });

  it("sanitizes activity relation selections to avoid upstream failures", async () => {
    const server = createServer();
    const getClient = () => ({
      query: async (query: any) => {
        const serialized = JSON.stringify(query);
        if (serialized.includes("\"card\"") || serialized.includes("\"project\"")) {
          throw new Error("unsafe activity relation selection");
        }
        return {
          _root: [{ account: "a1" }],
          account: { a1: { activities: ["ac1"] } },
          activity: { ac1: { id: "ac1", createdAt: "2026-01-01", type: "changed", data: {} } }
        };
      }
    });

    registerAutoTools({
      server: server as any,
      schema: {
        models: {
          _root: { type: "root", fields: {}, relations: { account: { type: "account", cardinality: "one" } } },
          account: { type: "model", fields: {}, relations: { activities: { type: "activity", cardinality: "many" } } },
          activity: {
            type: "model",
            fields: { createdAt: "date", type: "string", data: "json" },
            relations: { card: { type: "card", cardinality: "one" }, project: { type: "project", cardinality: "one" } }
          },
          card: { type: "model", fields: { title: "string" }, relations: {} },
          project: { type: "model", fields: { name: "string" }, relations: {} }
        }
      } as any,
      getClient: getClient as any,
      formatError: (e) => String(e)
    });

    const listResult = await server.tools["codecks_list_activity"].handler({
      selection: ["createdAt", { card: ["title"] }, { project: ["name"] }],
      response_format: ResponseFormat.JSON
    });
    expect(listResult.structuredContent.items[0].id).toBe("ac1");
    expect(listResult.structuredContent.items[0].createdAt).toBe("2026-01-01");

    const getResult = await server.tools["codecks_get_activity"].handler({
      id: "ac1",
      selection: ["createdAt", { card: ["title"] }],
      response_format: ResponseFormat.JSON
    });
    expect(getResult.structuredContent.id).toBe("ac1");
  });

  it("sanitizes queueEntry relation selections to avoid upstream failures", async () => {
    const server = createServer();
    const getClient = () => ({
      query: async (query: any) => {
        const serialized = JSON.stringify(query);
        if (serialized.includes("\"card\"")) {
          throw new Error("unsafe queueEntry relation selection");
        }
        const firstKey = Object.keys(query)[0] || "";
        if (firstKey.startsWith("queueEntry(")) {
          return {
            queueEntry: {
              qe1: { id: "qe1", createdAt: "2026-01-01", sortIndex: 1, cardDoneAt: null }
            }
          };
        }
        return {
          _root: [{ account: "a1" }],
          account: { a1: { queueEntries: ["qe1"] } },
          queueEntry: {
            qe1: { id: "qe1", createdAt: "2026-01-01", sortIndex: 1, cardDoneAt: null }
          }
        };
      }
    });

    registerAutoTools({
      server: server as any,
      schema: {
        models: {
          _root: { type: "root", fields: {}, relations: { account: { type: "account", cardinality: "one" } } },
          account: { type: "model", fields: {}, relations: { queueEntries: { type: "queueEntry", cardinality: "many" } } },
          queueEntry: {
            type: "model",
            fields: { createdAt: "date", sortIndex: "int", cardDoneAt: "date" },
            relations: { card: { type: "card", cardinality: "one" } }
          },
          card: { type: "model", fields: { title: "string" }, relations: {} }
        }
      } as any,
      getClient: getClient as any,
      formatError: (e) => String(e)
    });

    const listResult = await server.tools["codecks_list_queue_entry"].handler({
      selection: ["createdAt", { card: ["title"] }],
      response_format: ResponseFormat.JSON
    });
    expect(listResult.structuredContent.items[0].id).toBe("qe1");
    expect(listResult.structuredContent.items[0].createdAt).toBe("2026-01-01");

    const getResult = await server.tools["codecks_get_queue_entry"].handler({
      id: "qe1",
      selection: ["createdAt", { card: ["title"] }],
      response_format: ResponseFormat.JSON
    });
    expect(getResult.structuredContent.id).toBe("qe1");
  });

  it("sanitizes cardUpvote relation selections to avoid upstream failures", async () => {
    const server = createServer();
    const getClient = () => ({
      query: async (query: any) => {
        const serialized = JSON.stringify(query);
        if (serialized.includes("\"card\"")) {
          throw new Error("unsafe cardUpvote relation selection");
        }
        const firstKey = Object.keys(query)[0] || "";
        if (firstKey.startsWith("cardUpvote(")) {
          return {
            cardUpvote: {
              cu1: { id: "cu1", createdAt: "2026-01-01", type: "upvote", discordUserInfo: {} }
            }
          };
        }
        return {
          _root: [{ account: "a1" }],
          account: { a1: { cardUpvotes: ["cu1"] } },
          cardUpvote: {
            cu1: { id: "cu1", createdAt: "2026-01-01", type: "upvote", discordUserInfo: {} }
          }
        };
      }
    });

    registerAutoTools({
      server: server as any,
      schema: {
        models: {
          _root: { type: "root", fields: {}, relations: { account: { type: "account", cardinality: "one" } } },
          account: { type: "model", fields: {}, relations: { cardUpvotes: { type: "cardUpvote", cardinality: "many" } } },
          cardUpvote: {
            type: "model",
            fields: { createdAt: "date", type: "string", discordUserInfo: "json" },
            relations: { card: { type: "card", cardinality: "one" } }
          },
          card: { type: "model", fields: { title: "string" }, relations: {} }
        }
      } as any,
      getClient: getClient as any,
      formatError: (e) => String(e)
    });

    const listResult = await server.tools["codecks_list_card_upvote"].handler({
      selection: ["createdAt", { card: ["title"] }],
      response_format: ResponseFormat.JSON
    });
    expect(listResult.structuredContent.items[0].id).toBe("cu1");
    expect(listResult.structuredContent.items[0].createdAt).toBe("2026-01-01");

    const getResult = await server.tools["codecks_get_card_upvote"].handler({
      id: "cu1",
      selection: ["createdAt", { card: ["title"] }],
      response_format: ResponseFormat.JSON
    });
    expect(getResult.structuredContent.id).toBe("cu1");
  });

  it("sanitizes handCard relation selections to avoid upstream failures", async () => {
    const server = createServer();
    const getClient = () => ({
      query: async (query: any) => {
        const serialized = JSON.stringify(query);
        if (serialized.includes("\"card\"")) {
          throw new Error("unsafe handCard relation selection");
        }
        const firstKey = Object.keys(query)[0] || "";
        if (firstKey.startsWith("handCard(")) {
          return {
            handCard: {
              hc1: { id: "hc1", sortIndex: 1 }
            }
          };
        }
        return {
          _root: [{ account: "a1" }],
          account: { a1: { handCards: ["hc1"] } },
          handCard: {
            hc1: { id: "hc1", sortIndex: 1 }
          }
        };
      }
    });

    registerAutoTools({
      server: server as any,
      schema: {
        models: {
          _root: { type: "root", fields: {}, relations: { account: { type: "account", cardinality: "one" } } },
          account: { type: "model", fields: {}, relations: { handCards: { type: "handCard", cardinality: "many" } } },
          handCard: {
            type: "model",
            fields: { sortIndex: "int" },
            relations: { card: { type: "card", cardinality: "one" } }
          },
          card: { type: "model", fields: { title: "string" }, relations: {} }
        }
      } as any,
      getClient: getClient as any,
      formatError: (e) => String(e)
    });

    const listResult = await server.tools["codecks_list_hand_card"].handler({
      selection: ["sortIndex", { card: ["title"] }],
      response_format: ResponseFormat.JSON
    });
    expect(listResult.structuredContent.items[0].id).toBe("hc1");

    const getResult = await server.tools["codecks_get_hand_card"].handler({
      id: "hc1",
      selection: ["sortIndex", { card: ["title"] }],
      response_format: ResponseFormat.JSON
    });
    expect(getResult.structuredContent.id).toBe("hc1");
  });

  it("sanitizes cardSubscription relation selections to avoid upstream failures", async () => {
    const server = createServer();
    const getClient = () => ({
      query: async (query: any) => {
        const serialized = JSON.stringify(query);
        if (serialized.includes("\"card\"")) {
          throw new Error("unsafe cardSubscription relation selection");
        }
        const firstKey = Object.keys(query)[0] || "";
        if (firstKey.startsWith("cardSubscription(")) {
          return {
            cardSubscription: {
              cs1: { id: "cs1", createdAt: "2026-01-01" }
            }
          };
        }
        return {
          _root: [{ account: "a1" }],
          account: { a1: { cardSubscriptions: ["cs1"] } },
          cardSubscription: {
            cs1: { id: "cs1", createdAt: "2026-01-01" }
          }
        };
      }
    });

    registerAutoTools({
      server: server as any,
      schema: {
        models: {
          _root: { type: "root", fields: {}, relations: { account: { type: "account", cardinality: "one" } } },
          account: { type: "model", fields: {}, relations: { cardSubscriptions: { type: "cardSubscription", cardinality: "many" } } },
          cardSubscription: {
            type: "model",
            fields: { createdAt: "date" },
            relations: { card: { type: "card", cardinality: "one" } }
          },
          card: { type: "model", fields: { title: "string" }, relations: {} }
        }
      } as any,
      getClient: getClient as any,
      formatError: (e) => String(e)
    });

    const listResult = await server.tools["codecks_list_card_subscription"].handler({
      selection: ["createdAt", { card: ["title"] }],
      response_format: ResponseFormat.JSON
    });
    expect(listResult.structuredContent.items[0].id).toBe("cs1");

    const getResult = await server.tools["codecks_get_card_subscription"].handler({
      id: "cs1",
      selection: ["createdAt", { card: ["title"] }],
      response_format: ResponseFormat.JSON
    });
    expect(getResult.structuredContent.id).toBe("cs1");
  });

  it("excludes deleted milestones from milestoneProject by default and supports include_deleted override", async () => {
    const server = createServer();
    const getClient = () => ({
      query: async () => ({
        _root: [{ account: "a1" }],
        account: { a1: { milestoneProjects: ["mp1", "mp2"] } },
        milestone: {
          m1: { id: "m1", isDeleted: true },
          m2: { id: "m2", isDeleted: false }
        },
        project: {
          p1: { id: "p1", name: "P1" },
          p2: { id: "p2", name: "P2" }
        },
        milestoneProject: {
          mp1: { id: "mp1", milestone: "m1", project: "p1" },
          mp2: { id: "mp2", milestone: "m2", project: "p2" }
        }
      })
    });

    registerAutoTools({
      server: server as any,
      schema: {
        models: {
          _root: { type: "root", fields: {}, relations: { account: { type: "account", cardinality: "one" } } },
          account: { type: "model", fields: {}, relations: { milestoneProjects: { type: "milestoneProject", cardinality: "many" } } },
          milestoneProject: {
            type: "model",
            fields: {},
            relations: {
              milestone: { type: "milestone", cardinality: "one" },
              project: { type: "project", cardinality: "one" }
            }
          },
          milestone: { type: "model", fields: { isDeleted: "bool" }, relations: {} },
          project: { type: "model", fields: { name: "string" }, relations: {} }
        }
      } as any,
      getClient: getClient as any,
      formatError: (e) => String(e)
    });

    const defaultResult = await server.tools["codecks_list_milestone_project"].handler({
      response_format: ResponseFormat.JSON
    });
    expect(defaultResult.structuredContent.items).toHaveLength(1);
    expect(defaultResult.structuredContent.items[0].id).toBe("mp2");

    const includeDeletedResult = await server.tools["codecks_list_milestone_project"].handler({
      include_deleted: true,
      response_format: ResponseFormat.JSON
    });
    expect(includeDeletedResult.structuredContent.items).toHaveLength(2);
  });
});
