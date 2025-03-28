import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { apiRequest } from "@/lib/queryClient";
import { Task } from "@shared/schema";
import TaskCard from "@/components/TaskCard";
import SlackMessageCard from "@/components/SlackMessageCard";
import TaskDetailModal from "@/components/modals/TaskDetailModal";
import CalendarView from "@/components/CalendarView";

export default function Dashboard() {
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  
  // Fetch today's tasks
  const { data: todayTasks, isLoading: isLoadingTasks } = useQuery({
    queryKey: ['/api/tasks/today'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/tasks/today');
      return res.json();
    }
  });
  
  // Fetch Slack detected tasks
  const { data: slackTasks, isLoading: isLoadingSlackTasks } = useQuery({
    queryKey: ['/api/slack/detect-tasks'],
    queryFn: async () => {
      try {
        const res = await apiRequest('GET', '/api/slack/detect-tasks');
        return res.json();
      } catch (error) {
        console.error("Error fetching Slack tasks:", error);
        return [];
      }
    }
  });
  
  return (
    <>
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-2xl font-semibold text-[#1D1C1D]">Dashboard</h1>
        <div>
          <Button 
            className="bg-[#2EB67D] hover:bg-opacity-90 text-white"
            onClick={() => setIsTaskModalOpen(true)}
          >
            <Plus className="h-5 w-5 mr-2" />
            Add Task
          </Button>
        </div>
      </div>

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
          <div className="px-4 py-5 sm:px-6 border-b border-gray-200">
            <h3 className="text-lg leading-6 font-medium text-[#1D1C1D]">Recently Detected Tasks</h3>
            <p className="mt-1 text-sm text-gray-500">Tasks detected from Slack messages in the last 24 hours</p>
          </div>
          <div className="bg-white px-4 py-5 sm:p-6 space-y-4">
            {isLoadingSlackTasks ? (
              <div className="space-y-4">
                <Skeleton className="h-32 w-full" />
                <Skeleton className="h-32 w-full" />
              </div>
            ) : slackTasks?.length > 0 ? (
              slackTasks.slice(0, 3).map((message: any) => (
                <SlackMessageCard 
                  key={message.ts} 
                  message={{
                    user: message.user,
                    user_profile: message.user_profile,
                    text: message.text,
                    ts: message.ts,
                    channel: message.channel,
                    channelName: message.channel_name
                  }}
                />
              ))
            ) : (
              <div className="text-center py-4 text-gray-500">
                No new tasks detected from Slack.
              </div>
            )}
          </div>
        </div>
        
        {/* Calendar View */}
        <CalendarView tasks={todayTasks} />
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
