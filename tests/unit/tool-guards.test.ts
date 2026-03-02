import { describe, expect, it } from "vitest";
import {
  getErrorMessage,
  isWorkflowApplyVersionGateError,
  resolveMilestoneUnlinkGlobalize
} from "../../src/utils/tool-guards.js";

describe("tool guards", () => {
  it("extracts readable error messages", () => {
    expect(getErrorMessage(new Error("boom"))).toBe("boom");
    expect(getErrorMessage("raw error")).toBe("raw error");
  });

  it("detects workflows/apply app-version gate errors", () => {
    expect(isWorkflowApplyVersionGateError(new Error("API request failed with status 400: You're using an old version of the app. Please Refresh."))).toBe(true);
    expect(isWorkflowApplyVersionGateError(new Error("API request failed with status 400: body must have property 'cardId'"))).toBe(false);
  });

  it("requires confirmation before unlinking last project from non-global milestone", () => {
    const guarded = resolveMilestoneUnlinkGlobalize({
      remainingProjectCount: 0,
      currentIsGlobal: false,
      globalizeIfLastProject: false
    });
    expect(guarded.allowed).toBe(false);
    expect(guarded.requiresConfirmation).toBe(true);
    expect(guarded.wouldGlobalize).toBe(true);
    expect(guarded.nextIsGlobal).toBe(false);
  });

  it("allows explicit globalize when unlinking last project", () => {
    const explicit = resolveMilestoneUnlinkGlobalize({
      remainingProjectCount: 0,
      currentIsGlobal: false,
      globalizeIfLastProject: true
    });
    expect(explicit.allowed).toBe(true);
    expect(explicit.requiresConfirmation).toBe(false);
    expect(explicit.wouldGlobalize).toBe(true);
    expect(explicit.nextIsGlobal).toBe(true);
  });
});
