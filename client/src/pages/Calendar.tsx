import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, addDays, subDays, startOfWeek, endOfWeek, isToday } from "date-fns";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, AlertCircle } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import CalendarView from "@/components/CalendarView";
import TaskDetailModal from "@/components/modals/TaskDetailModal";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";

export default function Calendar() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewType, setViewType] = useState<'day' | 'week' | 'month'>('week');
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [calendarError, setCalendarError] = useState<{message: string, code?: string} | null>(null);
  const { toast } = useToast();
  
  // Calculate date range based on view type
  const calculateDateRange = () => {
    if (viewType === 'day') {
      return {
        start: currentDate,
        end: currentDate
      };
    } else if (viewType === 'week') {
      return {
        start: startOfWeek(currentDate, { weekStartsOn: 1 }),
        end: endOfWeek(currentDate, { weekStartsOn: 1 })
      };
    } else {
      // For month view, we'd need more complex logic
      // For now just showing current week
      return {
        start: startOfWeek(currentDate, { weekStartsOn: 1 }),
        end: endOfWeek(currentDate, { weekStartsOn: 1 })
      };
    }
  };
  
  const { start, end } = calculateDateRange();
  
  // Format date range for display
  const formatDateRange = () => {
    if (viewType === 'day') {
      return format(currentDate, 'MMMM d, yyyy');
    } else if (viewType === 'week') {
      return `${format(start, 'MMM d')} - ${format(end, 'MMM d, yyyy')}`;
    } else {
      return format(currentDate, 'MMMM yyyy');
    }
  };
  
  // Navigation functions
  const goToPrev = () => {
    if (viewType === 'day') {
      setCurrentDate(subDays(currentDate, 1));
    } else if (viewType === 'week') {
      setCurrentDate(subDays(currentDate, 7));
    } else {
      // For month view
      const newDate = new Date(currentDate);
      newDate.setMonth(newDate.getMonth() - 1);
      setCurrentDate(newDate);
    }
  };
  
  const goToNext = () => {
    if (viewType === 'day') {
      setCurrentDate(addDays(currentDate, 1));
    } else if (viewType === 'week') {
      setCurrentDate(addDays(currentDate, 7));
    } else {
      // For month view
      const newDate = new Date(currentDate);
      newDate.setMonth(newDate.getMonth() + 1);
      setCurrentDate(newDate);
    }
  };
  
  const goToToday = () => {
    setCurrentDate(new Date());
  };
  
  // Fetch calendar events for the selected date range
  const { data: calendarEvents, isLoading: isLoadingCalendar } = useQuery({
    queryKey: [`/api/calendar/events/${format(start, 'yyyy-MM-dd')}_${format(end, 'yyyy-MM-dd')}`],
    queryFn: async () => {
      try {
        // Reset any previous errors
        setCalendarError(null);
        
        // Format dates as ISO strings for the API
        const startStr = start.toISOString();
        const endStr = end.toISOString();
        
        const res = await apiRequest('GET', `/api/calendar/events?start=${startStr}&end=${endStr}`);
        
        if (!res.ok) {
          // Parse the error response
          const errorData = await res.json();
          
          // Handle known error codes
          if (errorData.code === 'CALENDAR_AUTH_EXPIRED') {
            setCalendarError({
              message: errorData.message || 'Your Google Calendar connection has expired. Please reconnect.',
              code: errorData.code
            });
            
            toast({
              title: "Calendar Connection Expired",
              description: "Your Google Calendar authorization has expired. Please reconnect in Settings.",
              variant: "destructive"
            });
            
            return [];
          } else if (errorData.code === 'CALENDAR_NOT_CONNECTED') {
            setCalendarError({
              message: 'Connect Google Calendar to view your events here.',
              code: errorData.code
            });
            return [];
          }
          
          // Handle other errors
          throw new Error(errorData.message || 'Failed to fetch calendar events');
        }
        
        return res.json();
      } catch (error) {
        console.error("Error fetching calendar events:", error);
        setCalendarError({
          message: error instanceof Error ? error.message : 'Failed to fetch calendar events'
        });
        return [];
      }
    }
  });
  
  // Fetch tasks for the selected date range
  const { data: tasks, isLoading: isLoadingTasks } = useQuery({
    queryKey: [`/api/tasks/${format(start, 'yyyy-MM-dd')}_${format(end, 'yyyy-MM-dd')}`],
    queryFn: async () => {
      try {
        // In a real app, we'd have an API endpoint that accepts a date range
        // For now, let's fetch all tasks
        const res = await apiRequest('GET', '/api/tasks');
        return res.json();
      } catch (error) {
        console.error("Error fetching tasks:", error);
        return [];
      }
    }
  });
  
  // Combine loading states
  const isLoading = isLoadingCalendar || isLoadingTasks;
  
  return (
    <>
      <div className="flex flex-col space-y-4">
        {/* Calendar Header */}
        <div className="flex justify-between items-center">
          <div className="flex items-center space-x-4">
            <h1 className="text-2xl font-semibold text-[#1D1C1D]">Calendar</h1>
            <div className="flex space-x-2">
              <Button 
                variant="outline" 
                size="sm"
                onClick={goToPrev}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button 
                variant="outline" 
                size="sm"
                onClick={goToNext}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button 
                variant="outline" 
                size="sm"
                onClick={goToToday}
                className={cn(
                  isToday(currentDate) && "bg-[#36C5F0] text-white hover:bg-[#36C5F0]/90 hover:text-white"
                )}
              >
                Today
              </Button>
            </div>
          </div>
          
          <div className="flex items-center space-x-2">
            <span className="text-lg font-medium">{formatDateRange()}</span>
            <Button 
              variant="ghost" 
              size="icon"
              onClick={() => setIsTaskModalOpen(true)}
            >
              <CalendarIcon className="h-5 w-5" />
            </Button>
          </div>
          
          <div className="flex space-x-2">
            <Button 
              className={cn(
                viewType === 'day' ? "bg-[#36C5F0] text-white" : "bg-white text-gray-500 border-gray-300"
              )}
              variant={viewType === 'day' ? "default" : "outline"}
              onClick={() => setViewType('day')}
              size="sm"
            >
              Day
            </Button>
            <Button 
              className={cn(
                viewType === 'week' ? "bg-[#36C5F0] text-white" : "bg-white text-gray-500 border-gray-300"
              )}
              variant={viewType === 'week' ? "default" : "outline"}
              onClick={() => setViewType('week')}
              size="sm"
            >
              Week
            </Button>
            <Button 
              className={cn(
                viewType === 'month' ? "bg-[#36C5F0] text-white" : "bg-white text-gray-500 border-gray-300"
              )}
              variant={viewType === 'month' ? "default" : "outline"}
              onClick={() => setViewType('month')}
              size="sm"
            >
              Month
            </Button>
          </div>
        </div>
        
        {/* Calendar error alert */}
        {calendarError && (
          <Alert variant="destructive" className="mb-4">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>
              {calendarError.code === 'CALENDAR_AUTH_EXPIRED' 
                ? 'Calendar Authorization Expired' 
                : calendarError.code === 'CALENDAR_NOT_CONNECTED' 
                  ? 'Calendar Not Connected'
                  : 'Calendar Error'}
            </AlertTitle>
            <AlertDescription className="flex flex-col">
              <span>{calendarError.message}</span>
              {(calendarError.code === 'CALENDAR_AUTH_EXPIRED' || calendarError.code === 'CALENDAR_NOT_CONNECTED') && (
                <Button asChild variant="outline" size="sm" className="mt-2 w-fit">
                  <Link to="/settings">Go to Settings</Link>
                </Button>
              )}
            </AlertDescription>
          </Alert>
        )}
        
        {/* Calendar Content */}
        {isLoading ? (
          <Skeleton className="h-[600px] w-full" />
        ) : (
          <CalendarView tasks={tasks} events={calendarEvents || []} />
        )}
      </div>
      
      {isTaskModalOpen && (
        <TaskDetailModal 
          isOpen={isTaskModalOpen} 
          onClose={() => setIsTaskModalOpen(false)}
        />
      )}
    </>
  );
}
