import { useState } from "react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import TaskDetailModal from "./modals/TaskDetailModal";
import { createTaskFromSlackMessage } from "@/lib/api";
import { SlackMessage } from "@/lib/api";
import { Task } from "@shared/schema";
import { cn } from "@/lib/utils";

interface SlackMessage {
  user: string;
  user_profile?: {
    image_72?: string;
    display_name?: string;
    real_name?: string;
  };
  text: string;
  ts: string;
  channel?: string;
  channelName?: string;
}

interface SlackMessageCardProps {
  message: SlackMessage;
  isTaskAdded?: boolean;
}

export default function SlackMessageCard({ message, isTaskAdded = false }: SlackMessageCardProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [localIsTaskAdded, setLocalIsTaskAdded] = useState(isTaskAdded);
  const [taskDetails, setTaskDetails] = useState<Task | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Calculate time ago
  const getTimeAgo = (ts: string) => {
    const timestamp = parseFloat(ts) * 1000;
    const now = Date.now();
    const diffSeconds = Math.floor((now - timestamp) / 1000);
    
    if (diffSeconds < 60) return `${diffSeconds} seconds ago`;
    if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)} minutes ago`;
    if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)} hours ago`;
    return `${Math.floor(diffSeconds / 86400)} days ago`;
  };

  // Format message for display
  const formatMessage = (text: string) => {
    // Replace user mentions with a highlighted span
    // This is a simplified version - a real implementation would need to handle more Slack formatting
    return text.replace(/<@([A-Z0-9]+)>/g, '@user');
  };

  // Mutation for creating a task from a Slack message
  const createTaskMutation = useMutation({
    mutationFn: () => {
      // Convert to our API SlackMessage format
      const slackMessage: SlackMessage = {
        user: message.user,
        text: message.text,
        ts: message.ts,
        user_profile: message.user_profile,
        channelId: message.channel,
        channelName: message.channelName
      };
      
      return createTaskFromSlackMessage(slackMessage);
    },
    onSuccess: (data) => {
      // Update UI state
      setLocalIsTaskAdded(true);
      setTaskDetails(data);
      
      // Invalidate related queries
      queryClient.invalidateQueries({ queryKey: ['/api/tasks'] });
      queryClient.invalidateQueries({ queryKey: ['/api/tasks/today'] });
      if (data.dueDate) {
        queryClient.invalidateQueries({ queryKey: [`/api/tasks/${data.dueDate}`] });
      }
      
      toast({
        title: "Task created",
        description: "The Slack message has been converted to a task.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to create task from Slack message.",
        variant: "destructive",
      });
    }
  });

  // Handle adding as task with the modal for customization
  const handleAddAsTask = () => {
    setIsModalOpen(true);
  };
  
  // Handle quick add (immediately create task without customization)
  const handleQuickAdd = () => {
    createTaskMutation.mutate();
  };

  // Handle ignoring message
  const ignoreMessage = () => {
    toast({
      title: "Message ignored",
      description: "This message won't be shown as a task suggestion again.",
    });
    // In a real app, we would store this preference
  };

  // Get display name
  const displayName = message.user_profile?.display_name || 
    message.user_profile?.real_name || 
    `User ${message.user.substring(0, 5)}`;

  // Get avatar URL or generate a placeholder
  const avatarUrl = message.user_profile?.image_72 || '';

  return (
    <>
      <div className="border border-gray-200 bg-white p-4 rounded-md">
        <div className="flex justify-between">
          <div className="flex items-start">
            <div className="flex-shrink-0">
              {avatarUrl ? (
                <img className="h-10 w-10 rounded-full" src={avatarUrl} alt={displayName} />
              ) : (
                <div className="h-10 w-10 rounded-full bg-[#4A154B] text-white flex items-center justify-center font-medium">
                  {displayName.charAt(0).toUpperCase()}
                </div>
              )}
            </div>
            <div className="ml-3">
              <p className="text-sm font-medium text-gray-900">{displayName}</p>
              <div className="mt-1 text-sm text-gray-600">
                <p>{formatMessage(message.text)}</p>
              </div>
              <div className="mt-2 text-xs text-gray-500">
                From {message.channelName ? `#${message.channelName}` : 'Slack'} • {getTimeAgo(message.ts)}
              </div>
            </div>
          </div>
          <div>
            <span className={cn(
              "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium",
              localIsTaskAdded 
                ? "bg-green-100 text-green-800" 
                : "bg-purple-100 text-[#4A154B]"
            )}>
              {localIsTaskAdded ? 'Added to Tasks' : 'Needs Action'}
            </span>
          </div>
        </div>
        
        {!localIsTaskAdded && (
          <div className="mt-4 flex">
            <button 
              type="button" 
              className="inline-flex items-center mr-2 px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md text-white bg-[#2EB67D] hover:bg-opacity-90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#2EB67D]"
              onClick={handleQuickAdd}
              disabled={createTaskMutation.isPending}
            >
              {createTaskMutation.isPending ? (
                <>
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Processing...
                </>
              ) : (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Quick Add
                </>
              )}
            </button>
            <button 
              type="button" 
              className="inline-flex items-center mr-2 px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md text-white bg-[#36C5F0] hover:bg-opacity-90 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#36C5F0]"
              onClick={handleAddAsTask}
              disabled={createTaskMutation.isPending}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
              Customize
            </button>
            <button 
              type="button" 
              className="inline-flex items-center px-3 py-2 border border-gray-300 shadow-sm text-sm leading-4 font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#36C5F0]"
              onClick={ignoreMessage}
              disabled={createTaskMutation.isPending}
            >
              Ignore
            </button>
          </div>
        )}

        {localIsTaskAdded && (
          <div className="mt-2 border-t border-gray-100 pt-2">
            <div className="flex justify-between items-center">
              <div className="text-xs text-gray-500">
                Added as task with 
                <span className={cn(
                  "font-medium mx-1",
                  taskDetails?.priority === 'high' ? "text-red-600" :
                  taskDetails?.priority === 'medium' ? "text-yellow-600" : "text-green-600"
                )}>
                  {taskDetails?.priority === 'high' ? 'High' : 
                   taskDetails?.priority === 'medium' ? 'Medium' : 'Low'} Priority
                </span>
                • Due {taskDetails?.dueDate ? new Date(taskDetails.dueDate).toLocaleDateString() : 'soon'}
                {taskDetails?.dueTime ? ` at ${taskDetails.dueTime}` : ''}
              </div>
              <button 
                type="button" 
                className="inline-flex items-center px-2 py-1 text-xs font-medium text-gray-700 hover:text-gray-500"
                onClick={handleAddAsTask}
              >
                Edit Details
              </button>
            </div>
          </div>
        )}
      </div>

      {isModalOpen && (
        <TaskDetailModal
          slackMessage={message}
          isOpen={isModalOpen}
          onClose={() => {
            setIsModalOpen(false);
            
            // If task was created through the modal, update the UI state
            queryClient.getQueryData(['/api/tasks']).then((data: Task[] | undefined) => {
              if (data) {
                // Check if any tasks were created from this message
                const taskFromThisMessage = data.find(t => t.slackMessageId === message.ts);
                if (taskFromThisMessage) {
                  setLocalIsTaskAdded(true);
                  setTaskDetails(taskFromThisMessage);
                }
              }
            }).catch(() => {
              // Silently ignore error
            });
          }}
        />
      )}
    </>
  );
}
