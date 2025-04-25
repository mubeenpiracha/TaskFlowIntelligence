/**
 * Standard error codes used throughout the application
 * These should match the backend error codes in /server/utils/errorHandlers.ts
 */
export enum ErrorCode {
  // Authentication Errors
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  
  // Google Calendar Errors
  CALENDAR_NOT_CONNECTED = 'CALENDAR_NOT_CONNECTED',
  CALENDAR_AUTH_EXPIRED = 'CALENDAR_AUTH_EXPIRED',
  CALENDAR_REQUEST_ERROR = 'CALENDAR_REQUEST_ERROR',
  
  // Slack Errors
  SLACK_NOT_CONNECTED = 'SLACK_NOT_CONNECTED',
  SLACK_AUTH_ERROR = 'SLACK_AUTH_ERROR',
  
  // General Errors
  NOT_FOUND = 'NOT_FOUND',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  SERVER_ERROR = 'SERVER_ERROR'
}

/**
 * Standard API error response interface
 */
export interface ApiErrorResponse {
  message: string;
  code: ErrorCode | string;
  details?: string;
  [key: string]: any;
}

/**
 * Check if an error is a specific type of error
 * 
 * @param error The error to check
 * @param code The error code to check for
 * @returns True if the error matches the code
 */
export function isErrorType(error: any, code: ErrorCode): boolean {
  return error && error.code === code;
}

/**
 * Extract a readable error message from an error object
 * 
 * @param error The error to extract a message from
 * @param fallback Optional fallback message
 * @returns A human-readable error message
 */
export function getErrorMessage(error: any, fallback: string = 'An unexpected error occurred'): string {
  if (!error) return fallback;
  
  // Check if it's our API error response format
  if (error.message) {
    return error.message;
  }
  
  // Check if it's a standard Error object
  if (error instanceof Error) {
    return error.message;
  }
  
  // For other cases, try to convert to string or use fallback
  return String(error) || fallback;
}