import { useState, useEffect, useCallback } from 'react';
import { useToast } from '@/hooks/use-toast';
import { MessageSquare, Calendar, Flag, Clock, AlertCircle, CheckCircle2 } from 'lucide-react';
import {
  Alert,
  AlertTitle,
  AlertDescription,
} from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Task } from "@shared/schema";

// Type for task notifications
interface TaskNotification extends Task {
  isNew?: boolean;
}

export default function TaskNotifications() {
  const [notifications, setNotifications] = useState<TaskNotification[]>([]);
  const { toast } = useToast();
  
  // Fetch latest tasks and use them for notifications
  const fetchLatestTasks = useCallback(async () => {
    try {
      const res = await fetch('/api/tasks/recent?limit=5');
      if (res.ok) {
        const data = await res.json();
        // Keep only newest 5 tasks
        setNotifications(data.slice(0, 5).map((task: Task) => ({...task, isNew: false})));
      }
    } catch (error) {
      console.error('Error fetching latest tasks:', error);
    }
  }, []);
  
  // Initial fetch only - polling is disabled since we use webhooks
  useEffect(() => {
    // One-time fetch on component mount
    fetchLatestTasks();
    
    // Polling has been disabled since we're using webhooks
    // Uncomment this to re-enable polling alongside webhooks
    /*
    const pollingInterval = setInterval(() => {
      fetchLatestTasks();
    }, 30000); // Poll every 30 seconds
    
    return () => clearInterval(pollingInterval);
    */
  }, [fetchLatestTasks]);

  // Always show the component instead of checking WebSocket connection
  
  if (notifications.length === 0) {
    return (
      <div className="text-center p-6 text-gray-500">
        <AlertCircle className="h-12 w-12 mx-auto mb-4 text-gray-400" />
        <p>No task notifications yet</p>
        <p className="text-sm mt-2">When new tasks are detected in your Slack channels, they'll appear here.</p>
      </div>
    );
  }
  
  return (
    <div className="space-y-4">
      {notifications.map((task) => (
        <Card 
          key={task.id} 
          className={`${task.isNew ? 'border-primary shadow-md animate-pulse' : 'border-gray-200'} overflow-hidden transition-all duration-300`}
        >
          <CardHeader className="pb-2">
            <div className="flex justify-between items-center">
              <div className="flex-1">
                <CardTitle className="text-base">{task.title}</CardTitle>
                <CardDescription className="text-xs text-gray-500 line-clamp-1 mt-1">
                  {task.description && task.description.length > 100 
                    ? `${task.description.substring(0, 100)}...` 
                    : task.description}
                </CardDescription>
              </div>
              <Badge 
                variant={
                  task.priority === 'high' ? 'destructive' : 
                  task.priority === 'medium' ? 'default' : 
                  'outline'
                }
                className="ml-2"
              >
                {task.priority}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="pb-2 pt-0">
            <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-gray-600">
              {task.dueDate && (
                <div className="flex items-center">
                  <Calendar className="h-3.5 w-3.5 mr-1 text-gray-400" />
                  <span>{task.dueDate}</span>
                  {task.dueTime && <span> at {task.dueTime}</span>}
                </div>
              )}
              {task.timeRequired && (
                <div className="flex items-center">
                  <Clock className="h-3.5 w-3.5 mr-1 text-gray-400" />
                  <span>{task.timeRequired}</span>
                </div>
              )}
              {task.completed && (
                <div className="flex items-center text-green-600">
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                  <span>Completed</span>
                </div>
              )}
            </div>
          </CardContent>
          <CardFooter className="pt-2 pb-2 flex justify-between items-center border-t border-gray-100 text-xs text-gray-500">
            <div className="flex items-center">
              <MessageSquare className="h-3.5 w-3.5 mr-1 text-gray-400" />
              <span>From Slack</span>
            </div>
            <Button variant="ghost" size="sm" className="h-7 text-xs">
              View
            </Button>
          </CardFooter>
        </Card>
      ))}
    </div>
  );
}