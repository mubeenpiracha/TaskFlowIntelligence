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
  if (!error) return false;
  
  // If the error is an API error response, check the code
  if (error.code) {
    return error.code === code;
  }
  
  // If the error is just a message, check for common patterns
  if (typeof error === 'string' || error instanceof Error) {
    const message = typeof error === 'string' ? error : error.message;
    
    switch (code) {
      case ErrorCode.UNAUTHORIZED:
        return message.includes('unauthorized') || message.includes('unauthenticated') || message.includes('401');
      case ErrorCode.FORBIDDEN:
        return message.includes('forbidden') || message.includes('403');
      case ErrorCode.CALENDAR_NOT_CONNECTED:
        return message.includes('calendar not connected') || message.includes('connect calendar');
      case ErrorCode.CALENDAR_AUTH_EXPIRED:
        return message.includes('token expired') || message.includes('refresh token');
      case ErrorCode.SLACK_NOT_CONNECTED:
        return message.includes('slack not connected') || message.includes('connect slack');
      case ErrorCode.NOT_FOUND:
        return message.includes('not found') || message.includes('404');
      case ErrorCode.VALIDATION_ERROR:
        return message.includes('validation') || message.includes('invalid');
      default:
        return false;
    }
  }
  
  return false;
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
  
  // If the error is an API error response
  if (error.message) {
    return error.message;
  }
  
  // If the error is an Error object
  if (error instanceof Error) {
    return error.message;
  }
  
  // If the error is a string
  if (typeof error === 'string') {
    return error;
  }
  
  // If we can't extract a message, use the fallback
  return fallback;
}