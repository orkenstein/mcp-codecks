export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function isWorkflowApplyVersionGateError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  return message.includes("old version of the app") && message.includes("please refresh");
}

export function resolveMilestoneUnlinkGlobalize(input: {
  remainingProjectCount: number;
  currentIsGlobal: boolean;
  globalizeIfLastProject: boolean;
}): {
  allowed: boolean;
  requiresConfirmation: boolean;
  wouldGlobalize: boolean;
  nextIsGlobal: boolean;
} {
  const wouldGlobalize = input.remainingProjectCount === 0 && input.currentIsGlobal === false;
  if (wouldGlobalize && input.globalizeIfLastProject !== true) {
    return {
      allowed: false,
      requiresConfirmation: true,
      wouldGlobalize: true,
      nextIsGlobal: input.currentIsGlobal
    };
  }
  return {
    allowed: true,
    requiresConfirmation: false,
    wouldGlobalize,
    nextIsGlobal: wouldGlobalize ? true : input.currentIsGlobal
  };
}
