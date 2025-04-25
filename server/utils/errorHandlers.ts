/**
 * Centralized error handling utilities for API calls and responses
 */
import { Response } from 'express';
import { TokenExpiredError, isTokenExpiredError, isGaxiosRequestError } from '../services/google';

/**
 * Standard error codes for the application
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
 * Standard error response format
 */
export interface ErrorResponse {
  message: string;
  code: ErrorCode | string;
  details?: string;
  [key: string]: any;
}

/**
 * Handle Google Calendar API errors and send appropriate responses
 * 
 * @param error The error thrown by Google Calendar API
 * @param res Express response object
 * @returns Whether the error was handled
 */
export function handleGoogleCalendarError(error: any, res: Response): boolean {
  // Handle token expiration errors
  if (error instanceof TokenExpiredError || isTokenExpiredError(error)) {
    console.log('Google Calendar token has expired, returning appropriate response');
    res.status(401).json({
      message: 'Google Calendar authorization expired. Please reconnect your calendar.',
      code: ErrorCode.CALENDAR_AUTH_EXPIRED
    });
    return true;
  }
  
  // Handle Gaxios request formatting errors
  if (isGaxiosRequestError && isGaxiosRequestError(error)) {
    console.log('Received Gaxios request error, sending appropriate response');
    
    // Extract helpful info from Gaxios error
    const statusCode = error.response?.status;
    const errorMessage = error.response?.data?.error?.message || 
                        error.response?.data?.error || 
                        error.message || 
                        'Bad request to Google Calendar API';
    
    res.status(400).json({
      message: 'Error in Google Calendar request format',
      error: errorMessage,
      details: `Status: ${statusCode || 'Unknown'}`,
      code: ErrorCode.CALENDAR_REQUEST_ERROR
    });
    return true;
  }
  
  // If we didn't handle the error specifically, return false
  return false;
}