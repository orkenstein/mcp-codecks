import { describe, expect, it, beforeEach, vi } from "vitest";
import { loadSchema, resetSchemaCache } from "../../src/utils/schema.js";
import fs from "fs";

describe("schema loader", () => {
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    resetSchemaCache();
    process.env.NODE_ENV = originalEnv;
  });

  it("loads schema from project structure", () => {
    process.env.NODE_ENV = "test";
    const schema = loadSchema();
    expect(schema).toBeDefined();
    expect(schema.models).toBeDefined();
    expect(typeof schema.models).toBe("object");
  });

  it("caches schema after first load", () => {
    resetSchemaCache();
    const schema1 = loadSchema();
    const schema2 = loadSchema();
    expect(schema1).toBe(schema2);
  });

  it("loads schema in production mode", () => {
    process.env.NODE_ENV = "production";
    resetSchemaCache();
    const schema = loadSchema();
    expect(schema).toBeDefined();
    expect(schema.models).toBeDefined();
  });

  it("throws error when schema file is missing", () => {
    resetSchemaCache();
    const existsSyncSpy = vi.spyOn(fs, "existsSync").mockReturnValue(false);
    
    expect(() => loadSchema()).toThrow(/schema not found/i);
    
    existsSyncSpy.mockRestore();
  });
});
