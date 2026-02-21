import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { loadSchema, resetSchemaCache } from "../../src/utils/schema.js";

function writeSchema(dir: string, location: "src" | "dist", payload: any) {
  const folder = path.join(dir, location, "schemas");
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(
    path.join(folder, "codecks-api-schema.json"),
    JSON.stringify(payload, null, 2)
  );
}

describe("schema loader", () => {
  const originalCwd = process.cwd();
  const originalEnv = process.env.NODE_ENV;
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codecks-schema-"));
    resetSchemaCache();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.env.NODE_ENV = originalEnv;
    fs.rmSync(tempDir, { recursive: true, force: true });
    resetSchemaCache();
  });

  it("prefers src schema when not in production", () => {
    writeSchema(tempDir, "src", { marker: "src" });
    writeSchema(tempDir, "dist", { marker: "dist" });
    process.env.NODE_ENV = "test";
    process.chdir(tempDir);
    const schema = loadSchema();
    const cached = loadSchema();
    expect(schema.marker).toBe("src");
    expect(cached.marker).toBe("src");
  });

  it("prefers dist schema in production", () => {
    writeSchema(tempDir, "src", { marker: "src" });
    writeSchema(tempDir, "dist", { marker: "dist" });
    process.env.NODE_ENV = "production";
    process.chdir(tempDir);
    const schema = loadSchema();
    expect(schema.marker).toBe("dist");
  });

  it("throws when schema is missing", () => {
    process.env.NODE_ENV = "test";
    process.chdir(tempDir);
    expect(() => loadSchema()).toThrow(/schema not found/i);
  });
});
