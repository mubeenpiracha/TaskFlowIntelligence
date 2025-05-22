import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, addDays, startOfWeek, endOfWeek, parseISO, isToday } from "date-fns";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { 
  ChevronLeft, 
  ChevronRight, 
  Calendar as CalendarIcon, 
  AlertCircle, 
  Clock, 
  Tag,
  CalendarDays
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// Simple Calendar component that shows a list of events/tasks by date
// instead of a complex calendar grid that might cause rendering issues
export default function Calendar() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewType, setViewType] = useState("week");
  const { toast } = useToast();
  
  // Calculate date range for the week view
  const startDate = startOfWeek(currentDate, { weekStartsOn: 1 }); // Start on Monday
  const endDate = endOfWeek(currentDate, { weekStartsOn: 1 }); // End on Sunday
  
  // Navigation functions
  const goToPrev = () => {
    const newDate = new Date(currentDate);
    if (viewType === "day") {
      newDate.setDate(newDate.getDate() - 1);
    } else if (viewType === "week") {
      newDate.setDate(newDate.getDate() - 7);
    } 
    setCurrentDate(newDate);
  };
  
  const goToNext = () => {
    const newDate = new Date(currentDate);
    if (viewType === "day") {
      newDate.setDate(newDate.getDate() + 1);
    } else if (viewType === "week") {
      newDate.setDate(newDate.getDate() + 7);
    }
    setCurrentDate(newDate);
  };
  
  const goToToday = () => {
    setCurrentDate(new Date());
  };
  
  // Format the current view for display
  const dateRangeText = viewType === "day" 
    ? format(currentDate, "MMMM d, yyyy")
    : `${format(startDate, "MMM d")} - ${format(endDate, "MMM d, yyyy")}`;
  
  // Fetch tasks
  const { data: tasks, isLoading: isLoadingTasks, error: taskError } = useQuery({
    queryKey: ["/api/tasks"],
    queryFn: async () => {
      try {
        const res = await apiRequest("GET", "/api/tasks");
        const data = await res.json();
        return data || [];
      } catch (error) {
        console.error("Error fetching tasks:", error);
        toast({
          title: "Could not load tasks",
          description: "There was an error loading your tasks. Please try again.",
          variant: "destructive"
        });
        return [];
      }
    }
  });
  
  // Generate days for the current view
  const daysToShow = viewType === "day" 
    ? [currentDate] 
    : Array.from({ length: 7 }, (_, i) => addDays(startDate, i));
  
  // Filter tasks for the current view
  const getTasksForDate = (date: Date) => {
    if (!tasks) return [];
    
    const dateStr = format(date, "yyyy-MM-dd");
    
    return tasks.filter(task => {
      // If task has a scheduled date, check if it matches
      if (task.scheduledDate) {
        const taskDate = format(parseISO(task.scheduledDate), "yyyy-MM-dd");
        return taskDate === dateStr;
      }
      
      // If task has a due date, check if it matches
      if (task.dueDate) {
        const dueDate = format(parseISO(task.dueDate), "yyyy-MM-dd");
        return dueDate === dateStr;
      }
      
      // If task has a Google Calendar event, check if it matches
      if (task.googleEventId && task.googleEventStartTime) {
        const eventDate = format(parseISO(task.googleEventStartTime), "yyyy-MM-dd");
        return eventDate === dateStr;
      }
      
      return false;
    });
  };
  
  // Format time for display
  const formatEventTime = (dateTimeStr: string) => {
    if (!dateTimeStr) return "";
    try {
      return format(parseISO(dateTimeStr), "h:mm a");
    } catch (e) {
      return "";
    }
  };
  
  // Handle connection errors and provide helpful guidance
  const showConnectionError = !!taskError;
  
  return (
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
          <span className="text-lg font-medium">{dateRangeText}</span>
          <CalendarIcon className="h-5 w-5 text-gray-500" />
        </div>
        
        <div className="flex space-x-2">
          <Button 
            className={cn(
              viewType === "day" ? "bg-[#36C5F0] text-white" : "bg-white text-gray-500 border-gray-300"
            )}
            variant={viewType === "day" ? "default" : "outline"}
            onClick={() => setViewType("day")}
            size="sm"
          >
            Day
          </Button>
          <Button 
            className={cn(
              viewType === "week" ? "bg-[#36C5F0] text-white" : "bg-white text-gray-500 border-gray-300"
            )}
            variant={viewType === "week" ? "default" : "outline"}
            onClick={() => setViewType("week")}
            size="sm"
          >
            Week
          </Button>
        </div>
      </div>
      
      {/* Connection Error Alert */}
      {showConnectionError && (
        <Alert variant="destructive" className="mb-2">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Connection Error</AlertTitle>
          <AlertDescription>
            Unable to load your calendar data. Check your internet connection or try again later.
            <div className="mt-2">
              <Button asChild variant="outline" size="sm" className="w-fit">
                <Link to="/settings">Check Settings</Link>
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}
      
      {/* Calendar Content */}
      {isLoadingTasks ? (
        <div className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : (
        <Tabs defaultValue={viewType} value={viewType} onValueChange={setViewType} className="w-full">
          <TabsContent value="day" className="mt-0">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2">
                  <CalendarDays className="h-5 w-5" />
                  {format(currentDate, "EEEE, MMMM d, yyyy")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {getTasksForDate(currentDate).length === 0 ? (
                  <div className="text-center py-8 text-gray-500">
                    <CalendarIcon className="h-12 w-12 mx-auto mb-2 opacity-30" />
                    <p>No scheduled tasks for this day</p>
                    <Button variant="outline" className="mt-4">
                      <Link to="/tasks">Manage Tasks</Link>
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {getTasksForDate(currentDate).map((task) => (
                      <div 
                        key={task.id} 
                        className="p-3 border rounded-md hover:shadow-sm transition-shadow"
                      >
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            <h3 className="font-medium">{task.title}</h3>
                            <p className="text-sm text-gray-500 line-clamp-2">
                              {task.description || "No description"}
                            </p>
                            <div className="flex gap-2 mt-2">
                              {task.googleEventStartTime && (
                                <div className="flex items-center text-xs text-gray-500">
                                  <Clock className="h-3 w-3 mr-1" />
                                  {formatEventTime(task.googleEventStartTime)}
                                  {task.googleEventEndTime && ` - ${formatEventTime(task.googleEventEndTime)}`}
                                </div>
                              )}
                              {task.priority && (
                                <Badge 
                                  variant="outline" 
                                  className={cn(
                                    "text-xs",
                                    task.priority === "high" && "bg-red-50 text-red-700 border-red-200",
                                    task.priority === "medium" && "bg-yellow-50 text-yellow-700 border-yellow-200",
                                    task.priority === "low" && "bg-green-50 text-green-700 border-green-200"
                                  )}
                                >
                                  {task.priority}
                                </Badge>
                              )}
                            </div>
                          </div>
                          <div className="flex gap-2">
                            {task.status && (
                              <Badge 
                                variant="outline" 
                                className={cn(
                                  "text-xs",
                                  task.status === "completed" && "bg-blue-50 text-blue-700 border-blue-200",
                                  task.status === "pending" && "bg-gray-50 text-gray-700 border-gray-200",
                                  task.status === "accepted" && "bg-green-50 text-green-700 border-green-200"
                                )}
                              >
                                {task.status}
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="week" className="mt-0">
            <div className="grid grid-cols-1 gap-4">
              {daysToShow.map((day, index) => {
                const dayTasks = getTasksForDate(day);
                const isToday = new Date().toDateString() === day.toDateString();
                
                return (
                  <Card key={index} className={cn(isToday && "border-blue-300 shadow-sm")}>
                    <CardHeader className={cn(
                      "pb-2",
                      isToday && "bg-blue-50"
                    )}>
                      <CardTitle className="flex items-center gap-2 text-base">
                        <CalendarDays className="h-4 w-4" />
                        {format(day, "EEEE, MMMM d")}
                        {isToday && <Badge className="ml-2 bg-blue-500">Today</Badge>}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className={dayTasks.length === 0 ? "py-2 px-4" : "py-3"}>
                      {dayTasks.length === 0 ? (
                        <p className="text-sm text-center text-gray-500 py-2">No scheduled tasks</p>
                      ) : (
                        <div className="space-y-3">
                          {dayTasks.map((task) => (
                            <div 
                              key={task.id} 
                              className="p-3 border rounded-md hover:shadow-sm transition-shadow"
                            >
                              <div className="flex justify-between items-start">
                                <div className="flex-1">
                                  <h3 className="font-medium">{task.title}</h3>
                                  <p className="text-sm text-gray-500 line-clamp-1">
                                    {task.description || "No description"}
                                  </p>
                                  <div className="flex gap-2 mt-2">
                                    {task.googleEventStartTime && (
                                      <div className="flex items-center text-xs text-gray-500">
                                        <Clock className="h-3 w-3 mr-1" />
                                        {formatEventTime(task.googleEventStartTime)}
                                      </div>
                                    )}
                                    {task.priority && (
                                      <Badge 
                                        variant="outline" 
                                        className={cn(
                                          "text-xs",
                                          task.priority === "high" && "bg-red-50 text-red-700 border-red-200",
                                          task.priority === "medium" && "bg-yellow-50 text-yellow-700 border-yellow-200",
                                          task.priority === "low" && "bg-green-50 text-green-700 border-green-200"
                                        )}
                                      >
                                        {task.priority}
                                      </Badge>
                                    )}
                                  </div>
                                </div>
                                <div className="flex gap-2">
                                  {task.status && (
                                    <Badge 
                                      variant="outline" 
                                      className={cn(
                                        "text-xs",
                                        task.status === "completed" && "bg-blue-50 text-blue-700 border-blue-200",
                                        task.status === "pending" && "bg-gray-50 text-gray-700 border-gray-200",
                                        task.status === "accepted" && "bg-green-50 text-green-700 border-green-200"
                                      )}
                                    >
                                      {task.status}
                                    </Badge>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
