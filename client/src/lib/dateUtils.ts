/**
 * Date utility functions for use throughout the application
 * Handles common date formatting and operations
 */
import { format, addDays, addMinutes, addHours, isToday, isThisWeek, isThisMonth, differenceInMinutes, differenceInHours, differenceInDays } from 'date-fns';

/**
 * Format a date for display in the UI
 * 
 * @param date The date to format
 * @param formatStr Optional format string
 * @returns Formatted date string
 */
export function formatDate(date: Date, formatStr: string = 'MMM d, yyyy'): string {
  return format(date, formatStr);
}

/**
 * Format a time for display in the UI
 * 
 * @param date The date containing the time to format
 * @param formatStr Optional format string
 * @returns Formatted time string
 */
export function formatTime(date: Date, formatStr: string = 'h:mm a'): string {
  return format(date, formatStr);
}

/**
 * Format a datetime for display in the UI
 * 
 * @param date The date to format
 * @param formatStr Optional format string
 * @returns Formatted datetime string
 */
export function formatDateTime(date: Date, formatStr: string = 'MMM d, yyyy h:mm a'): string {
  return format(date, formatStr);
}

/**
 * Get a relative time string for a date (e.g., "2 hours ago", "in 3 days")
 * 
 * @param date The date to get a relative string for
 * @param now Reference date (defaults to current time)
 * @returns Relative time string
 */
export function getRelativeTimeString(date: Date, now: Date = new Date()): string {
  const diffMinutes = differenceInMinutes(date, now);
  const diffHours = differenceInHours(date, now);
  const diffDays = differenceInDays(date, now);
  
  // Date is in the past
  if (diffMinutes < 0) {
    if (diffMinutes > -60) return `${Math.abs(diffMinutes)} minutes ago`;
    if (diffHours > -24) return `${Math.abs(diffHours)} hours ago`;
    if (diffDays > -7) return `${Math.abs(diffDays)} days ago`;
    return formatDate(date);
  }
  
  // Date is in the future
  if (diffMinutes < 60) return `in ${diffMinutes} minutes`;
  if (diffHours < 24) return `in ${diffHours} hours`;
  if (diffDays < 7) return `in ${diffDays} days`;
  return formatDate(date);
}

/**
 * Get a friendly date display string
 * 
 * @param date The date to format
 * @returns Friendly date string (e.g., "Today", "Tomorrow", or formatted date)
 */
export function getFriendlyDateString(date: Date): string {
  const now = new Date();
  
  if (isToday(date)) return 'Today';
  if (isToday(addDays(date, -1))) return 'Tomorrow';
  if (isToday(addDays(date, 1))) return 'Yesterday';
  
  if (isThisWeek(date)) return format(date, 'EEEE'); // Day name
  if (isThisMonth(date)) return format(date, 'MMMM d'); // Month day
  
  return formatDate(date);
}

/**
 * Parse a time string to a Date object
 * 
 * @param timeStr Time string in HH:MM format (24-hour)
 * @param baseDate Optional base date (defaults to today)
 * @returns Date object with the specified time
 */
export function parseTimeString(timeStr: string, baseDate: Date = new Date()): Date {
  const [hours, minutes] = timeStr.split(':').map(Number);
  const date = new Date(baseDate);
  date.setHours(hours, minutes, 0, 0);
  return date;
}

/**
 * Calculate time remaining until a deadline
 * 
 * @param deadline Deadline date
 * @returns Object with days, hours, minutes remaining
 */
export function getTimeRemaining(deadline: Date): { days: number, hours: number, minutes: number } {
  const totalMinutes = Math.max(0, differenceInMinutes(deadline, new Date()));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = Math.floor(totalMinutes % 60);
  
  return { days, hours, minutes };
}

/**
 * Format time remaining as a string
 * 
 * @param deadline Deadline date
 * @returns Formatted time remaining string
 */
export function formatTimeRemaining(deadline: Date): string {
  const { days, hours, minutes } = getTimeRemaining(deadline);
  
  if (days > 0) return `${days}d ${hours}h remaining`;
  if (hours > 0) return `${hours}h ${minutes}m remaining`;
  if (minutes > 0) return `${minutes}m remaining`;
  return 'Deadline passed';
}

/**
 * Determine urgency level based on deadline
 * 
 * @param deadline Deadline date
 * @returns Urgency level (high, medium, low)
 */
export function getUrgencyLevel(deadline: Date): 'high' | 'medium' | 'low' {
  const hoursRemaining = differenceInHours(deadline, new Date());
  
  if (hoursRemaining <= 24) return 'high';
  if (hoursRemaining <= 72) return 'medium';
  return 'low';
}