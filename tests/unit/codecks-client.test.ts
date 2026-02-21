import { describe, expect, it, beforeEach, afterEach } from "vitest";
import axios from "axios";
import MockAdapter from "axios-mock-adapter";
import { CodecksClient, formatError } from "../../src/services/codecks-client.js";
import { API_BASE_URL } from "../../src/constants.js";

describe("CodecksClient", () => {
  let mock: MockAdapter;

  beforeEach(() => {
    mock = new MockAdapter(axios);
  });

  afterEach(() => {
    mock.restore();
  });

  it("sends query requests with headers", async () => {
    const client = new CodecksClient("token123", "subdomain");
    const query = { _root: [{ account: ["name"] }] };

    mock.onPost(API_BASE_URL).reply((config) => {
      expect(config.headers?.["X-Account"]).toBe("subdomain");
      expect(config.headers?.["X-Auth-Token"]).toBe("token123");
      expect(config.headers?.["Content-Type"]).toBe("application/json");
      expect(JSON.parse(config.data)).toEqual({ query });
      return [200, { ok: true }];
    });

    const response = await client.query(query);
    expect(response).toEqual({ ok: true });
  });

  it("sends dispatch requests to dispatch endpoint", async () => {
    const client = new CodecksClient("token123", "subdomain");
    const payload = { content: "Hello" };

    mock.onPost(`${API_BASE_URL}/dispatch/cards/create`).reply((config) => {
      expect(JSON.parse(config.data)).toEqual(payload);
      return [200, { id: "card-1" }];
    });

    const response = await client.dispatch("cards/create", payload);
    expect(response).toEqual({ id: "card-1" });
  });

  it("maps 401 errors to authentication message", async () => {
    const client = new CodecksClient("bad", "subdomain");
    mock.onPost(API_BASE_URL).reply(401, { message: "unauthorized" });

    await expect(client.query({})).rejects.toThrow(
      "Authentication failed. Please check your X-Auth-Token and X-Account credentials."
    );
  });

  it("maps 404 errors to not found message", async () => {
    const client = new CodecksClient("token", "subdomain");
    mock.onPost(API_BASE_URL).reply(404, { message: "missing" });

    await expect(client.query({})).rejects.toThrow(
      "Resource not found. Please verify the ID or parameters."
    );
  });

  it("maps 403 errors to permission denied", async () => {
    const client = new CodecksClient("token", "subdomain");
    mock.onPost(API_BASE_URL).reply(403, { message: "forbidden" });

    await expect(client.query({})).rejects.toThrow(
      "Permission denied. You don't have access to this resource."
    );
  });

  it("maps 429 errors to rate limit message", async () => {
    const client = new CodecksClient("token", "subdomain");
    mock.onPost(API_BASE_URL).reply(429, { message: "rate limit" });

    await expect(client.query({})).rejects.toThrow(
      "Rate limit exceeded (40 requests per 5 seconds). Please wait before retrying."
    );
  });

  it("maps timeout errors to a timeout message", async () => {
    const client = new CodecksClient("token", "subdomain");
    mock.onPost(API_BASE_URL).timeout();

    await expect(client.query({})).rejects.toThrow(
      "Request timed out. The Codecks API may be slow or unavailable."
    );
  });

  it("maps ENOTFOUND errors to connection message", () => {
    const client = new CodecksClient("token", "subdomain") as any;
    const error = { isAxiosError: true, code: "ENOTFOUND" };
    const mapped = client.handleError(error);
    expect(mapped.message).toContain("Cannot connect to Codecks API");
  });
  it("maps ECONNABORTED errors to timeout message", () => {
    const client = new CodecksClient("token", "subdomain") as any;
    const error = { isAxiosError: true, code: "ECONNABORTED" };
    const mapped = client.handleError(error);
    expect(mapped.message).toContain("Request timed out");
  });

  it("handles non-Axios unknown errors", () => {
    const client = new CodecksClient("token", "subdomain") as any;
    const mapped = client.handleError("boom");
    expect(mapped.message).toContain("Unexpected error: boom");
  });

  it("maps default error status with message", async () => {
    const client = new CodecksClient("token", "subdomain");
    mock.onPost(API_BASE_URL).reply(500, { message: "boom" });

    await expect(client.query({})).rejects.toThrow(
      "API request failed with status 500: boom"
    );
  });
  it("maps default error status without message to axios error text", async () => {
    const client = new CodecksClient("token", "subdomain");
    mock.onPost(API_BASE_URL).reply(500, {});

    await expect(client.query({})).rejects.toThrow(
      "API request failed with status 500: Request failed with status code 500"
    );
  });

  it("maps dispatch errors through handleError", async () => {
    const client = new CodecksClient("token", "subdomain");
    mock.onPost(`${API_BASE_URL}/dispatch/cards/create`).reply(404, { message: "missing" });

    await expect(client.dispatch("cards/create", {})).rejects.toThrow(
      "Resource not found. Please verify the ID or parameters."
    );
  });

  it("returns error instance for non-Axios errors", () => {
    const client = new CodecksClient("token", "subdomain") as any;
    const error = new Error("plain");
    const mapped = client.handleError(error);
    expect(mapped).toBe(error);
  });

  it("formats errors for user display", () => {
    expect(formatError(new Error("boom"))).toBe("Error: boom");
    expect(formatError("boom")).toBe("Error: boom");
  });
});
