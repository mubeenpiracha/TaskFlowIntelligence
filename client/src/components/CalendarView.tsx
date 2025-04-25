import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { format, addDays, startOfWeek, getDay, parseISO } from 'date-fns';
import { Task } from '@shared/schema';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { apiRequest } from '@/lib/queryClient';

interface CalendarEvent {
  start: {
    dateTime: string;
  };
  end: {
    dateTime: string;
  };
  summary: string;
  colorId?: string;
  id: string;
}

interface CalendarViewProps {
  tasks?: Task[];
  events?: CalendarEvent[];
}

export default function CalendarView({ tasks, events = [] }: CalendarViewProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewType, setViewType] = useState<'day' | 'week' | 'month'>('week');
  
  // Format date for display
  const formattedDate = format(currentDate, 'MMMM d, yyyy');
  
  // Use the events passed from parent component
  const calendarEvents = events;
  
  // Days of the week
  const daysOfWeek = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  
  // Time slots
  const timeSlots = Array.from({ length: 11 }, (_, i) => i + 9); // 9am to 7pm
  
  // Get color for calendar event
  const getEventColor = (colorId?: string, summary?: string) => {
    if (summary?.toLowerCase().includes('break') || summary?.toLowerCase().includes('lunch')) {
      return 'bg-[#2EB67D] text-white';
    }
    
    switch (colorId) {
      case '1': return 'bg-[#4A154B] text-white'; // Slack purple
      case '2': return 'bg-[#36C5F0] text-white'; // Slack blue
      case '3': return 'bg-[#2EB67D] text-white'; // Slack green
      case '4': 
      case '5': return 'bg-[#E01E5A] text-white'; // Slack red
      default: return 'bg-gray-200 text-gray-700';
    }
  };
  
  // Get task color based on priority
  const getTaskColor = (priority: string) => {
    switch (priority.toLowerCase()) {
      case 'high': return 'bg-[#E01E5A] text-white'; // Slack red
      case 'medium': return 'bg-yellow-400 text-white';
      case 'low': return 'bg-[#2EB67D] text-white'; // Slack green
      default: return 'bg-[#36C5F0] text-white'; // Slack blue
    }
  };
  
  // Determine if a day is today
  const isToday = (day: number) => {
    const today = new Date();
    return startOfWeek(today).getDate() + day === today.getDate() &&
           startOfWeek(today).getMonth() === startOfWeek(currentDate).getMonth() &&
           startOfWeek(today).getFullYear() === startOfWeek(currentDate).getFullYear();
  };
  
  // Filter events for a specific day and time
  const getEventsForDayAndTime = (day: number, hour: number) => {
    if (!calendarEvents) return [];
    
    const date = addDays(startOfWeek(currentDate), day);
    const dateStr = format(date, 'yyyy-MM-dd');
    
    return calendarEvents.filter((event: CalendarEvent) => {
      if (!event.start?.dateTime) return false;
      
      const eventDate = parseISO(event.start.dateTime);
      return format(eventDate, 'yyyy-MM-dd') === dateStr && 
             eventDate.getHours() === hour;
    });
  };
  
  // Filter tasks for a specific day and time
  const getTasksForDayAndTime = (day: number, hour: number) => {
    if (!tasks) return [];
    
    const date = addDays(startOfWeek(currentDate), day);
    const dateStr = format(date, 'yyyy-MM-dd');
    
    return tasks.filter(task => {
      if (!task.dueDate || !task.dueTime) return false;
      
      const [taskHour] = task.dueTime.split(':').map(Number);
      return task.dueDate === dateStr && taskHour === hour;
    });
  };
  
  return (
    <div className="bg-white overflow-hidden shadow rounded-lg col-span-1 lg:col-span-2">
      <div className="px-4 py-5 sm:px-6 border-b border-gray-200 flex justify-between items-center">
        <div>
          <h3 className="text-lg leading-6 font-medium text-[#1D1C1D]">Schedule</h3>
          <p className="mt-1 text-sm text-gray-500">{formattedDate}</p>
        </div>
        <div className="flex space-x-2">
          <Button 
            className={cn(viewType === 'day' ? 'bg-[#36C5F0] text-white' : 'bg-white text-gray-500 border-gray-300')}
            variant={viewType === 'day' ? 'default' : 'outline'}
            onClick={() => setViewType('day')}
            size="sm"
          >
            Day
          </Button>
          <Button 
            className={cn(viewType === 'week' ? 'bg-[#36C5F0] text-white' : 'bg-white text-gray-500 border-gray-300')}
            variant={viewType === 'week' ? 'default' : 'outline'}
            onClick={() => setViewType('week')}
            size="sm"
          >
            Week
          </Button>
          <Button 
            className={cn(viewType === 'month' ? 'bg-[#36C5F0] text-white' : 'bg-white text-gray-500 border-gray-300')}
            variant={viewType === 'month' ? 'default' : 'outline'}
            onClick={() => setViewType('month')}
            size="sm"
          >
            Month
          </Button>
        </div>
      </div>

      {/* Calendar Grid */}
      <div className="bg-white px-4 py-3 sm:px-6 overflow-x-auto">
        <div className="grid grid-cols-[50px_repeat(7,_1fr)] grid-rows-[50px_repeat(11,_60px)] gap-[1px] min-w-full">
          {/* Header */}
          <div className="font-medium bg-slate-50"></div>
          {daysOfWeek.map((day, index) => (
            <div 
              key={day} 
              className={cn(
                "font-medium bg-slate-50 text-center flex flex-col justify-center", 
                isToday(index) && "border-2 border-[#36C5F0] rounded"
              )}
            >
              {day}
            </div>
          ))}
            
            {/* Time slots */}
            {timeSlots.map(hour => (
              <>
                <div key={`time-${hour}`} className="text-right pr-2 text-xs text-gray-500 border-b border-gray-100 flex items-center justify-end">
                  {hour % 12 || 12}{hour < 12 ? 'am' : 'pm'}
                </div>
                
                {daysOfWeek.map((_, dayIndex) => (
                  <div key={`slot-${hour}-${dayIndex}`} className="border-b border-gray-100">
                    {getEventsForDayAndTime(dayIndex, hour).map((event: CalendarEvent) => (
                      <div 
                        key={event.id}
                        className={cn(
                          "text-xs p-1 mx-1 my-0.5 rounded overflow-hidden text-ellipsis whitespace-nowrap",
                          getEventColor(event.colorId, event.summary)
                        )}
                      >
                        {event.summary}
                      </div>
                    ))}
                    
                    {getTasksForDayAndTime(dayIndex, hour).map(task => (
                      <div 
                        key={`task-${task.id}`}
                        className={cn(
                          "text-xs p-1 mx-1 my-0.5 rounded overflow-hidden text-ellipsis whitespace-nowrap",
                          getTaskColor(task.priority)
                        )}
                      >
                        {task.title}
                      </div>
                    ))}
                  </div>
                ))}
              </>
            ))}
          </div>
      </div>
    </div>
  );
}
