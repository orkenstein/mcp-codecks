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

  it("handles missing models by returning empty selection and no order field", async () => {
    const server = createServer();
    let lastQuery: any = null;
    const mutableSchema: any = {
      models: {
        _root: { type: "root", fields: {}, relations: { ghosts: { type: "ghost", cardinality: "many" } } },
        ghost: { type: "model", fields: { id: "string" }, relations: {} }
      }
    };
    const getClient = () => ({
      query: async (query: any) => {
        lastQuery = query;
        return { _root: [{ ghosts: [] }] };
      }
    });
    registerAutoTools({
      server: server as any,
      schema: mutableSchema as any,
      getClient: getClient as any,
      formatError: (e) => String(e)
    });

    delete mutableSchema.models.ghost;
    await server.tools["codecks_list_ghost"].handler({ response_format: ResponseFormat.JSON });
    const key = Object.keys(lastQuery._root[0])[0];
    expect(key).toBe("ghosts");
    expect(lastQuery._root[0][key]).toEqual([]);
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
});
