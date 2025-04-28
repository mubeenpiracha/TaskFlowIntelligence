import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Calendar, AlertTriangle, MessageSquare, RefreshCw, Radar, ThumbsUp, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest } from "@/lib/queryClient";
import { Task } from "@shared/schema";
import TaskCard from "@/components/TaskCard";
import SlackMessageCard from "@/components/SlackMessageCard";
import TaskDetailModal from "@/components/modals/TaskDetailModal";
import CalendarView from "@/components/CalendarView";
import TaskNotifications from "@/components/TaskNotifications";
import { Link } from "wouter";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { Badge } from "@/components/ui/badge";
import { checkTasksNow, forceScanSlack, detectSlackTasks, SlackMessage, WebhookTaskResponse } from "@/lib/api";

export default function Dashboard() {
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  // Polling is used instead of WebSockets
  
  // Polling for task updates is disabled since we're using webhooks
  // Uncomment this if you want to re-enable polling alongside webhooks
  /*
  useEffect(() => {
    const pollInterval = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ['/api/tasks/today'] });
    }, 30000); // 30 seconds
    
    return () => clearInterval(pollInterval);
  }, [queryClient]);
  */

  // Fetch current user data
  const { data: user } = useQuery({
    queryKey: ['/api/auth/me'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/auth/me');
      return res.json();
    }
  });
  
  // Fetch today's tasks
  const { data: todayTasks, isLoading: isLoadingTasks } = useQuery({
    queryKey: ['/api/tasks/today'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/tasks/today');
      return res.json();
    }
  });
  
  // Fetch potential Slack task messages (using webhook-only mode)
  const { data: slackTasksResponse, isLoading: isLoadingSlackTasks } = useQuery({
    queryKey: ['/api/slack/detect-tasks'],
    queryFn: async () => {
      try {
        // Pass:
        // - forceScan=true to get webhook status info too
        // - initialLoad=true to get ALL pending tasks on initial page load
        const data = await detectSlackTasks(undefined, true, true, false);
        console.log("Slack tasks response:", data);
        
        // If we got the webhook response format, extract the tasks
        if ('webhookMode' in data) {
          return {
            tasks: data.tasks || [],
            webhookStatus: data.webhookStatus,
            webhookMode: true,
            message: data.message
          };
        }
        
        // Otherwise it's just an array of tasks (legacy format)
        return {
          tasks: data as SlackMessage[],
          webhookMode: false
        };
      } catch (error) {
        console.error("Error fetching Slack tasks:", error);
        return { tasks: [], webhookMode: false, error: String(error) };
      }
    }
  });
  
  // Extract just the tasks for easier use in the UI
  const slackTasks = slackTasksResponse?.tasks || [];
  const webhookStatus = slackTasksResponse?.webhookStatus;
  
  // Mutation for manually triggering task detection through UI
  const detectTasksMutation = useMutation({
    mutationFn: async () => {
      // Add parameters:
      // - sendDMs=true to send notifications for detected tasks
      // - isManualRefresh=true to show ALL pending tasks again
      const data = await detectSlackTasks(undefined, true, false, true);
      return data;
    },
    onSuccess: (data) => {
      // Invalidate the slack tasks query to refresh the data
      queryClient.invalidateQueries({ queryKey: ['/api/slack/detect-tasks'] });
      
      // Extract tasks based on response format
      const tasks = 'webhookMode' in data ? data.tasks : data;
      
      // Display appropriate message based on response
      if ('webhookMode' in data && data.webhookMode) {
        toast({
          title: "Webhook-Only Mode",
          description: data.message || "Using webhook-only mode for task detection. New Slack messages will be processed automatically.",
          variant: "default",
        });
      } else {
        // Handle differently based on the response type
        const numTasks = 'tasks' in tasks && Array.isArray(tasks.tasks) 
          ? tasks.tasks.length 
          : Array.isArray(tasks) ? tasks.length : 0;
        
        toast({
          title: "Task Detection Complete",
          description: `Found ${numTasks} potential tasks in your Slack channels.`,
          variant: "default",
        });
      }
    },
    onError: (error) => {
      console.error("Error detecting tasks:", error);
      toast({
        title: "Task Detection Failed",
        description: "There was an error checking for tasks in Slack. Please try again.",
        variant: "destructive",
      });
    }
  });
  
  // Mutation for triggering the backend immediate task check
  const checkNowMutation = useMutation({
    mutationFn: checkTasksNow,
    onSuccess: (data) => {
      // Invalidate the slack tasks query to refresh the data
      queryClient.invalidateQueries({ queryKey: ['/api/slack/detect-tasks'] });
      queryClient.invalidateQueries({ queryKey: ['/api/tasks/today'] });
      
      const { details } = data;
      
      toast({
        title: "Slack Task Scan Complete",
        description: `Processed ${details.tasksDetected} messages for ${details.usersProcessed} user(s). Refresh to see any new tasks.`,
        variant: details.success ? "default" : "destructive",
      });
    },
    onError: (error) => {
      console.error("Error forcing Slack task scan:", error);
      toast({
        title: "Slack Scan Failed",
        description: "There was an error scanning for tasks in Slack. Please try again.",
        variant: "destructive",
      });
    }
  });
  
  // Mutation for force scanning with the new backend endpoint
  const forceScanMutation = useMutation({
    mutationFn: forceScanSlack,
    onSuccess: (data) => {
      // Invalidate the slack tasks query to refresh the data
      queryClient.invalidateQueries({ queryKey: ['/api/slack/detect-tasks'] });
      queryClient.invalidateQueries({ queryKey: ['/api/tasks/today'] });
      
      toast({
        title: "Deep Slack Scan Complete",
        description: `Processed ${data.result.tasksDetected} messages for ${data.result.usersProcessed} user(s). Check for new task notifications.`,
        variant: data.success ? "default" : "destructive",
      });
    },
    onError: (error) => {
      console.error("Error forcing deep Slack scan:", error);
      toast({
        title: "Deep Slack Scan Failed",
        description: "There was an error performing a deep scan of Slack messages. Please try again.",
        variant: "destructive",
      });
    }
  });

  return (
    <>
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-2xl font-semibold text-[#1D1C1D]">Dashboard</h1>
        <div className="flex space-x-2">
          {user && !user.googleRefreshToken && (
            <Link href="/settings">
              <Button
                variant="outline"
                className="flex items-center bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100"
              >
                <Calendar className="mr-2 h-4 w-4" />
                Connect Calendar
              </Button>
            </Link>
          )}
          {user && !user.slackUserId && (
            <Link href="/settings">
              <Button
                variant="outline"
                className="flex items-center bg-purple-50 text-purple-800 border-purple-200 hover:bg-purple-100"
              >
                <MessageSquare className="mr-2 h-4 w-4" />
                Connect Slack
              </Button>
            </Link>
          )}
          <Button 
            className="bg-[#2EB67D] hover:bg-opacity-90 text-white"
            onClick={() => setIsTaskModalOpen(true)}
          >
            <Plus className="h-5 w-5 mr-2" />
            Add Task
          </Button>
        </div>
      </div>
      
      {user && !user.googleRefreshToken && (
        <Alert className="mb-6 bg-amber-50 text-amber-800 border-amber-200">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Calendar Not Connected</AlertTitle>
          <AlertDescription>
            Your Google Calendar is not connected. Tasks will not be automatically scheduled until you connect your calendar.
            <div className="mt-2">
              <Link href="/settings">
                <Button size="sm" variant="outline" className="bg-white border-amber-300 text-amber-800 hover:bg-amber-100">
                  Connect Calendar
                </Button>
              </Link>
            </div>
          </AlertDescription>
        </Alert>
      )}
      
      {user && !user.slackUserId && (
        <Alert className="mb-6 bg-purple-50 text-purple-800 border-purple-200">
          <MessageSquare className="h-4 w-4" />
          <AlertTitle>Slack Not Connected</AlertTitle>
          <AlertDescription>
            Your Slack account is not connected. Task detection from Slack messages won't work until you connect Slack.
            <div className="mt-2">
              <Link href="/settings">
                <Button size="sm" variant="outline" className="bg-white border-purple-300 text-purple-800 hover:bg-purple-100">
                  Connect Slack
                </Button>
              </Link>
            </div>
          </AlertDescription>
        </Alert>
      )}
      

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Tasks Pending */}
        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="px-4 py-5 sm:px-6 border-b border-gray-200">
            <h3 className="text-lg leading-6 font-medium text-[#1D1C1D]">Tasks Pending Today</h3>
          </div>
          <div className="bg-white px-4 py-5 sm:p-6 space-y-4">
            {isLoadingTasks ? (
              <div className="space-y-4">
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
              </div>
            ) : todayTasks?.length > 0 ? (
              todayTasks.map((task: Task) => (
                <TaskCard key={task.id} task={task} />
              ))
            ) : (
              <div className="text-center py-4 text-gray-500">
                No tasks due today. Enjoy your day!
              </div>
            )}
          </div>
        </div>

        {/* Recent Slack Tasks */}
        <div className="bg-white overflow-hidden shadow rounded-lg">
          <div className="px-4 py-5 sm:px-6 border-b border-gray-200 flex justify-between items-center">
            <div>
              <h3 className="text-lg leading-6 font-medium text-[#1D1C1D]">Recently Detected Tasks</h3>
              <p className="mt-1 text-sm text-gray-500">
                Tasks detected from Slack messages in the last 24 hours
                <Badge variant="outline" className="ml-2 bg-green-100 text-green-800 border-green-300">
                  <Clock className="h-3 w-3 mr-1" />
                  Webhook-Powered
                </Badge>
              </p>
            </div>
            <div className="flex space-x-2">
              {/* Button for deep scanning using the new backend endpoint */}
              <Button
                onClick={() => forceScanMutation.mutate()}
                disabled={forceScanMutation.isPending || checkNowMutation.isPending || detectTasksMutation.isPending}
                variant="outline"
                className="flex items-center bg-[#E01D5A] hover:bg-opacity-90 text-white border-none"
                size="sm"
              >
                <Radar className={`h-4 w-4 mr-2 ${forceScanMutation.isPending ? 'animate-spin' : ''}`} />
                {forceScanMutation.isPending ? 'Deep Scan...' : 'Deep Scan'}
              </Button>
            
              {/* Button for immediate backend task check */}
              <Button
                onClick={() => checkNowMutation.mutate()}
                disabled={checkNowMutation.isPending || forceScanMutation.isPending || detectTasksMutation.isPending}
                variant="outline"
                className="flex items-center bg-[#36C5F0] hover:bg-opacity-90 text-white border-none"
                size="sm"
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${checkNowMutation.isPending ? 'animate-spin' : ''}`} />
                {checkNowMutation.isPending ? 'Scanning...' : 'Force Scan'}
              </Button>
              
              {/* Button for UI-based task detection */}
              <Button
                onClick={() => detectTasksMutation.mutate()}
                disabled={detectTasksMutation.isPending || forceScanMutation.isPending || checkNowMutation.isPending}
                variant="outline"
                className="flex items-center bg-[#4A154B] hover:bg-opacity-90 text-white border-none"
                size="sm"
              >
                <ThumbsUp className={`h-4 w-4 mr-2 ${detectTasksMutation.isPending ? 'animate-spin' : ''}`} />
                {detectTasksMutation.isPending ? 'Detecting...' : 'Quick Check'}
              </Button>
            </div>
          </div>
          <div className="bg-white px-4 py-5 sm:p-6 space-y-4">
            {isLoadingSlackTasks ? (
              <div className="space-y-4">
                <Skeleton className="h-32 w-full" />
                <Skeleton className="h-32 w-full" />
              </div>
            ) : slackTasks && slackTasks.length > 0 ? (
              slackTasks.slice(0, 3).map((message: any) => {
                console.log("Processing individual message:", message);
                return (
                  <SlackMessageCard 
                    key={message.ts} 
                    message={{
                      user: message.user,
                      user_profile: message.user_profile,
                      text: message.text,
                      ts: message.ts,
                      channel: message.channel || message.channelId,
                      channelName: message.channel_name || message.channelName
                    }}
                  />
                );
              })
            ) : (
              <div className="text-center py-4 text-gray-500">
                No new tasks detected from Slack.
              </div>
            )}
          </div>
        </div>
        
        {/* Calendar View */}
        <CalendarView tasks={todayTasks} />
        
        {/* Task Notifications */}
        {user?.slackUserId && (
          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="px-4 py-5 sm:px-6 border-b border-gray-200">
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="text-lg leading-6 font-medium text-[#1D1C1D]">Recent Task Notifications</h3>
                  <p className="mt-1 text-sm text-gray-500">
                    Most recent task notifications from Slack
                  </p>
                </div>
                <Badge variant="outline" className="bg-green-100 text-green-800 border-green-300">
                  <Clock className="h-3 w-3 mr-1" />
                  Webhook-Powered
                </Badge>
              </div>
            </div>
            <div className="bg-white px-4 py-5 sm:p-6">
              <TaskNotifications />
            </div>
          </div>
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
