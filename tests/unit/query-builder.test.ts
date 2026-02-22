import { describe, expect, it } from "vitest";
import { loadSchema } from "../../src/utils/schema.js";
import {
  buildRelationKey,
  buildRootQuery,
  denormalizeRootRelation,
  denormalizeById,
  normalizeSelection,
  parseRelationKey,
  validateSelection,
  type Selection
} from "../../src/utils/query-builder.js";

const schema = loadSchema();

describe("query builder", () => {
  it("buildRelationKey stringifies query params", () => {
    const key = buildRelationKey("cards", { deckId: "123", $limit: 5 });
    expect(key).toBe("cards({\"deckId\":\"123\",\"$limit\":5})");
  });

  it("normalizes user email selection to primaryEmail", () => {
    const selection: Selection[] = ["id", "name", "email"];
    const normalized = normalizeSelection(schema, "user", selection);
    expect(normalized).toContain("id");
    expect(normalized).toContain("name");
    expect(normalized).not.toContain("email");
    const hasPrimaryEmail = normalized.some(
      (item) => typeof item === "object" && Object.keys(item)[0]?.startsWith("primaryEmail")
    );
    expect(hasPrimaryEmail).toBe(true);
  });

  it("buildRootQuery returns _root structure", () => {
    const query = buildRootQuery(schema, "account", ["name"]);
    expect(query).toHaveProperty("_root");
    expect(Array.isArray(query._root)).toBe(true);
    expect(query._root[0]).toHaveProperty("account");
  });

  it("denormalizeRootRelation resolves nested relations", () => {
    const selection: Selection[] = ["id", "title", { deck: ["id", "name"] }];
    const accountSelection: Selection[] = [{ cards: selection }];

    const response = {
      _root: [{ account: "acc1" }],
      account: {
        acc1: { id: "acc1", cards: ["c1"] }
      },
      card: {
        c1: { id: "c1", title: "Card One", deck: "d1" }
      },
      deck: {
        d1: { id: "d1", name: "Main Deck" }
      }
    };

    const account = denormalizeRootRelation(schema, response, "account", accountSelection);
    expect(account?.cards?.[0]?.deck?.name).toBe("Main Deck");
  });

  it("parseRelationKey detects queries", () => {
    expect(parseRelationKey("cards({\"$limit\":1})")).toEqual({ name: "cards", hasQuery: true });
    expect(parseRelationKey("deck")).toEqual({ name: "deck", hasQuery: false });
  });

  it("validateSelection allows unknown fields but validates relations", () => {
    // Field validation is disabled because schema is incomplete
    const fieldSelection: Selection[] = ["unknownField"];
    expect(() => validateSelection(schema, "account", fieldSelection)).not.toThrow();
    
    // But relation validation still works
    const relationSelection: Selection[] = [{ unknownRelation: ["id"] }];
    expect(() => validateSelection(schema, "account", relationSelection)).toThrow("Unknown relation");
  });

  it("validateSelection rejects unknown models", () => {
    expect(() =>
      validateSelection({ models: {} } as any, "missing", ["id"])
    ).toThrow("Unknown model 'missing' in schema");
  });

  it("validateSelection rejects unknown relations", () => {
    const minimalSchema = {
      models: {
        account: { fields: { id: "string" }, relations: {} }
      }
    } as any;
    expect(() =>
      validateSelection(minimalSchema, "account", [{ missing: ["id"] }])
    ).toThrow("Unknown relation 'missing' on model 'account'");
  });

  it("normalizeSelection merges primaryEmail when present", () => {
    const selection: Selection[] = ["id", { primaryEmail: ["id"] }, "email"];
    const normalized = normalizeSelection(schema, "user", selection);
    const primary = normalized.find(
      (item) => typeof item === "object" && Object.keys(item)[0]?.startsWith("primaryEmail")
    ) as Record<string, Selection[]> | undefined;
    expect(primary?.primaryEmail).toContain("email");
  });

  it("denormalizeById returns direct object when response is non-normalized", () => {
    const response = { card: { id: "c1", title: "Direct" } };
    const result = denormalizeById(schema, response, "card", "c1", ["id", "title"]);
    expect(result.title).toBe("Direct");
  });

  it("denormalizeById returns null when model is missing", () => {
    const minimalSchema = { models: { _root: { relations: {} } } } as any;
    const result = denormalizeById(minimalSchema, { thing: { t1: { id: "t1" } } }, "thing", "t1", ["id"]);
    expect(result).toBeNull();
  });

  it("buildRelationKey returns relation when query is empty", () => {
    expect(buildRelationKey("cards", {})).toBe("cards");
  });

  it("normalizeSelection returns input when model is missing", () => {
    const selection: Selection[] = ["id"];
    const normalized = normalizeSelection({ models: {} } as any, "missing", selection);
    expect(normalized).toEqual(selection);
  });

  it("normalizeSelection preserves unknown relations", () => {
    const minimalSchema = {
      models: {
        account: { fields: { id: "string" }, relations: {} }
      }
    } as any;
    const selection: Selection[] = [{ missing: ["id"] }];
    const normalized = normalizeSelection(minimalSchema, "account", selection);
    expect(normalized).toEqual(selection);
  });

  it("denormalizeRootRelation handles null and missing relation info", () => {
    const minimalSchema = {
      models: {
        _root: { relations: {} },
        thing: { fields: { id: "string" }, relations: {} }
      }
    } as any;
    const response = { _root: { other: "x" } };
    expect(denormalizeRootRelation(minimalSchema, response, "missing", ["id"])).toBeNull();
    expect(denormalizeRootRelation(minimalSchema, response, "other", ["id"])).toBe("x");
  });

  it("denormalizeRootRelation resolves cardinality-one relation ids and objects", () => {
    const minimalSchema = {
      models: {
        _root: { relations: { thing: { type: "thing", cardinality: "one" } } },
        thing: { fields: { id: "string", name: "string" }, relations: {} }
      }
    } as any;
    const responseId = { _root: { thing: "t1" }, thing: { t1: { id: "t1", name: "Thing" } } };
    const responseObj = { _root: { thing: { id: "t2", name: "Obj" } } };
    expect(denormalizeRootRelation(minimalSchema, responseId, "thing", ["id", "name"]).name).toBe("Thing");
    expect(denormalizeRootRelation(minimalSchema, responseObj, "thing", ["id", "name"]).name).toBe("Obj");
  });

  it("resolveEntity handles null relations, object relations, arrays, and cycles", () => {
    const cycSchema = {
      models: {
        _root: { relations: {} },
        node: {
          fields: { id: "string", name: "string" },
          relations: { parent: { type: "node", cardinality: "one" }, children: { type: "node", cardinality: "many" } }
        }
      }
    } as any;
    const response = {
      node: {
        n1: { id: "n1", name: "Node", parent: "n1", children: [{ id: "n2", name: "Child" }], missing: null }
      }
    };
    const result = denormalizeById(cycSchema, response, "node", "n1", [
      "id",
      "name",
      { parent: ["id"] },
      { children: ["id", "name"] }
    ]);
    expect(result.parent.id).toBe("n1");
    expect(result.children[0].name).toBe("Child");
  });

  it("resolveEntity skips unknown relations and populates null relation values", () => {
    const localSchema = {
      models: {
        _root: { relations: {} },
        item: {
          fields: { id: "string", name: "string" },
          relations: { tags: { type: "tag", cardinality: "many" } }
        },
        tag: { fields: { id: "string" }, relations: {} }
      }
    } as any;
    const response = {
      item: { i1: { id: "i1", name: "Item", tags: null } }
    };
    const result = denormalizeById(localSchema, response, "item", "i1", [
      { missingRel: ["id"] },
      { tags: ["id"] }
    ]);
    expect(result.id).toBe("i1");
    expect(result.tags).toEqual([]);
  });

  it("resolveEntity handles null cardinality-one relations", () => {
    const localSchema = {
      models: {
        _root: { relations: {} },
        item: {
          fields: { id: "string" },
          relations: { owner: { type: "user", cardinality: "one" } }
        },
        user: { fields: { id: "string" }, relations: {} }
      }
    } as any;
    const response = {
      item: { i1: { id: "i1", owner: null } }
    };
    const result = denormalizeById(localSchema, response, "item", "i1", ["id", { owner: ["id"] }]);
    expect(result.owner).toBeNull();
  });

  it("resolveEntity returns object relations for cardinality-one", () => {
    const localSchema = {
      models: {
        _root: { relations: {} },
        item: {
          fields: { id: "string" },
          relations: { owner: { type: "user", cardinality: "one" } }
        },
        user: { fields: { id: "string", name: "string" }, relations: {} }
      }
    } as any;
    const response = {
      item: { i1: { id: "i1", owner: { id: "u1", name: "Owner" } } }
    };
    const result = denormalizeById(localSchema, response, "item", "i1", [
      "id",
      { owner: ["id", "name"] }
    ]);
    expect(result.owner.name).toBe("Owner");
  });

  it("resolveEntity handles non-array relation values for cardinality-many", () => {
    const localSchema = {
      models: {
        _root: { relations: {} },
        item: {
          fields: { id: "string" },
          relations: { tags: { type: "tag", cardinality: "many" } }
        },
        tag: { fields: { id: "string" }, relations: {} }
      }
    } as any;
    const response = {
      item: { i1: { id: "i1", tags: "t1" } },
      tag: { t1: { id: "t1" } }
    };
    const result = denormalizeById(localSchema, response, "item", "i1", ["id", { tags: ["id"] }]);
    expect(result.tags[0].id).toBe("t1");
  });

  it("resolveEntity uses fallback id when revisiting missing entity", () => {
    const localSchema = {
      models: {
        _root: { relations: {} },
        node: {
          fields: { id: "string" },
          relations: { parent: { type: "node", cardinality: "one" } }
        }
      }
    } as any;
    const response: any = { node: {} };
    let accessed = false;
    Object.defineProperty(response.node, "n1", {
      configurable: true,
      get() {
        if (!accessed) {
          accessed = true;
          return { id: "n1", parent: "n1" };
        }
        return undefined;
      }
    });
    const result = denormalizeById(localSchema, response, "node", "n1", ["id", { parent: ["id"] }]);
    expect(result.parent).toEqual({ id: "n1" });
  });

  it("denormalizeRootRelation returns object entries for list relations", () => {
    const minimalSchema = {
      models: {
        _root: { relations: { things: { type: "thing", cardinality: "many" } } },
        thing: { fields: { id: "string", name: "string" }, relations: {} }
      }
    } as any;
    const response = { _root: { things: [{ id: "t1", name: "Obj" }] } };
    const result = denormalizeRootRelation(minimalSchema, response, "things", ["id", "name"]);
    expect(result[0].name).toBe("Obj");
  });

  it("denormalizeRootRelation handles non-array values for many relations", () => {
    const minimalSchema = {
      models: {
        _root: { relations: { things: { type: "thing", cardinality: "many" } } },
        thing: { fields: { id: "string", name: "string" }, relations: {} }
      }
    } as any;
    const response = { _root: { things: "t1" }, thing: { t1: { id: "t1", name: "One" } } };
    const result = denormalizeRootRelation(minimalSchema, response, "things", ["id", "name"]);
    expect(result[0].name).toBe("One");
  });
});
