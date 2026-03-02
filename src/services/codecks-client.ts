/**
 * Codecks API Client
 * Handles authentication and API communication with Codecks GraphQL-like API
 */

import axios, { AxiosError } from "axios";
import { API_BASE_URL } from "../constants.js";
function extractApiErrorMessage(data: unknown): string | undefined {
  if (!data || typeof data !== "object") {
    return undefined;
  }
  const record = data as Record<string, unknown>;
  if (typeof record.message === "string" && record.message.trim().length > 0) {
    return record.message;
  }
  if (typeof record.error === "string" && record.error.trim().length > 0) {
    return record.error;
  }
  const payload = record.payload;
  if (payload && typeof payload === "object") {
    const payloadRecord = payload as Record<string, unknown>;
    if (typeof payloadRecord.message === "string" && payloadRecord.message.trim().length > 0) {
      return payloadRecord.message;
    }
    if (typeof payloadRecord.error === "string" && payloadRecord.error.trim().length > 0) {
      return payloadRecord.error;
    }
  }
  return undefined;
}

/**
 * Handle API errors with descriptive messages
 */
export function handleError(error: unknown): Error {
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError;
    
    if (axiosError.response) {
      const status = axiosError.response.status;
      const message = extractApiErrorMessage(axiosError.response.data) || axiosError.message;
      
      switch (status) {
        case 401:
          return new Error(
            "Authentication failed. Please check your X-Auth-Token and X-Account credentials."
          );
        case 403:
          return new Error(
            "Permission denied. You don't have access to this resource."
          );
        case 404:
          return new Error(
            "Resource not found. Please verify the ID or parameters."
          );
        case 429:
          return new Error(
            "Rate limit exceeded (40 requests per 5 seconds). Please wait before retrying."
          );
        default:
          return new Error(
            `API request failed with status ${status}: ${message}`
          );
      }
    } else if (axiosError.code === "ECONNABORTED") {
      return new Error(
        "Request timed out. The Codecks API may be slow or unavailable."
      );
    } else if (axiosError.code === "ENOTFOUND") {
      return new Error(
        "Cannot connect to Codecks API. Please check your internet connection."
      );
    }
  }

  return error instanceof Error
    ? error
    : new Error(`Unexpected error: ${String(error)}`);
}

export class CodecksClient {
  private authToken: string;
  private accountSubdomain: string;
  private maxRetries: number;
  private retryDelay: number;

  constructor(
    authToken: string,
    accountSubdomain: string,
    options?: { maxRetries?: number; retryDelay?: number }
  ) {
    this.authToken = authToken;
    this.accountSubdomain = accountSubdomain;
    this.maxRetries = options?.maxRetries ?? 3;
    this.retryDelay = options?.retryDelay ?? 1000;
  }

  /**
   * Execute a GraphQL-like query against the Codecks API with automatic retry on 429
   */
  async query<T = Record<string, unknown>>(query: Record<string, unknown>): Promise<T> {
    return this.executeWithRetry(async () => {
      const response = await axios.post(
        API_BASE_URL,
        { query },
        {
          headers: {
            "X-Account": this.accountSubdomain,
            "X-Auth-Token": this.authToken,
            "Content-Type": "application/json",
            "Accept": "application/json"
          },
          timeout: 30000
        }
      );
      return response.data;
    });
  }

  /**
   * Execute a dispatch (mutation) operation with automatic retry on 429
   */
  async dispatch<T = Record<string, unknown>>(
    endpoint: string,
    data: Record<string, unknown>
  ): Promise<T> {
    return this.executeWithRetry(async () => {
      const response = await axios.post(
        `${API_BASE_URL}/dispatch/${endpoint}`,
        data,
        {
          headers: {
            "X-Account": this.accountSubdomain,
            "X-Auth-Token": this.authToken,
            "Content-Type": "application/json",
            "Accept": "application/json"
          },
          timeout: 30000
        }
      );
      return response.data;
    });
  }

  /**
   * Execute a request with exponential backoff retry for 429 rate limits
   */
  private async executeWithRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: Error | undefined;
    
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = handleError(error);
        
        if (axios.isAxiosError(error) && error.response?.status === 429 && attempt < this.maxRetries) {
          const delay = this.retryDelay * Math.pow(2, attempt);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        
        throw lastError;
      }
    }
    
    // Unreachable: loop always exits via return or throw
    throw lastError || new Error("Unexpected: retry loop completed without result");
  }

}

/**
 * Format Codecks error for user display
 */
export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return `Error: ${error.message}`;
  }
  return `Error: ${String(error)}`;
}
