/**
 * Codecks API Client
 * Handles authentication and API communication with Codecks GraphQL-like API
 */

import axios, { AxiosError } from "axios";
import { API_BASE_URL } from "../constants.js";

/**
 * Handle API errors with descriptive messages
 */
export function handleError(error: unknown): Error {
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError;
    
    if (axiosError.response) {
      const status = axiosError.response.status;
      const data = axiosError.response.data as any;
      
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
            `API request failed with status ${status}: ${
              data?.message || axiosError.message
            }`
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

  constructor(authToken: string, accountSubdomain: string) {
    this.authToken = authToken;
    this.accountSubdomain = accountSubdomain;
  }

  /**
   * Execute a GraphQL-like query against the Codecks API
   */
  async query<T = any>(query: Record<string, any>): Promise<T> {
    try {
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
    } catch (error) {
      throw handleError(error);
    }
  }

  /**
   * Execute a dispatch (mutation) operation
   */
  async dispatch<T = any>(
    endpoint: string,
    data: Record<string, any>
  ): Promise<T> {
    try {
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
    } catch (error) {
      throw handleError(error);
    }
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
