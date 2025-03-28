import { useState } from "react";
import { Task } from "@shared/schema";
import { cn } from "@/lib/utils";
import { Clock } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import TaskDetailModal from "./modals/TaskDetailModal";
import { format } from "date-fns";

interface TaskCardProps {
  task: Task;
}

export default function TaskCard({ task }: TaskCardProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Determine border color based on priority
  const getBorderColor = (priority: string) => {
    switch (priority.toLowerCase()) {
      case 'high':
        return 'border-l-[#E01E5A]'; // Slack red
      case 'medium':
        return 'border-l-yellow-400';
      case 'low':
        return 'border-l-[#2EB67D]'; // Slack green
      default:
        return 'border-l-[#36C5F0]'; // Slack blue
    }
  };

  // Get badge color based on priority
  const getBadgeColor = (priority: string) => {
    switch (priority.toLowerCase()) {
      case 'high':
        return 'bg-red-100 text-red-800';
      case 'medium':
        return 'bg-yellow-100 text-yellow-800';
      case 'low':
        return 'bg-green-100 text-green-800';
      default:
        return 'bg-blue-100 text-blue-800';
    }
  };

  // Format the due time to be more readable
  const formatDueTime = (dueTime: string | null | undefined) => {
    if (!dueTime) return '';
    
    try {
      // Create a date with today's date and the due time
      const today = new Date();
      const [hours, minutes] = dueTime.split(':');
      today.setHours(parseInt(hours, 10), parseInt(minutes, 10));
      
      return format(today, 'h:mm a');
    } catch (error) {
      return dueTime;
    }
  };

  // Mark task as complete mutation
  const completeMutation = useMutation({
    mutationFn: async () => {
      await apiRequest('POST', `/api/tasks/${task.id}/complete`, { completed: !task.completed });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/tasks'] });
      queryClient.invalidateQueries({ queryKey: ['/api/tasks/today'] });
      if (task.dueDate) {
        queryClient.invalidateQueries({ queryKey: [`/api/tasks/${task.dueDate}`] });
      }
      
      toast({
        title: task.completed ? "Task marked as incomplete" : "Task completed",
        description: task.title,
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update task status",
        variant: "destructive",
      });
    }
  });

  // Reschedule task - opens the modal for editing
  const handleReschedule = () => {
    setIsModalOpen(true);
  };

  return (
    <>
      <div className={cn(
        "border-l-4 bg-slate-50 p-4 rounded-r-md",
        getBorderColor(task.priority),
        task.completed && "opacity-70"
      )}>
        <div className="flex justify-between items-start">
          <div>
            <h4 className={cn(
              "font-medium text-[#1D1C1D]",
              task.completed && "line-through"
            )}>{task.title}</h4>
            {task.description && (
              <p className="text-sm text-gray-500 mt-1">{task.description}</p>
            )}
          </div>
          <div>
            <span className={cn(
              "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium",
              getBadgeColor(task.priority)
            )}>
              {task.priority.charAt(0).toUpperCase() + task.priority.slice(1)} Priority
            </span>
          </div>
        </div>
        <div className="flex justify-between items-center mt-3">
          <div className="flex items-center text-sm text-gray-500">
            <Clock className="h-4 w-4 mr-1" />
            <span>
              {task.dueTime ? `Due ${formatDueTime(task.dueTime)}` : 'No due time'}
            </span>
          </div>
          <div className="flex space-x-2">
            <button 
              className={cn(
                "text-[#36C5F0] hover:text-blue-700 text-sm font-medium",
                task.completed && "text-gray-400 hover:text-gray-500"
              )}
              onClick={() => completeMutation.mutate()}
              disabled={completeMutation.isPending}
            >
              {task.completed ? 'Undo' : 'Complete'}
            </button>
            <button 
              className="text-gray-500 hover:text-gray-700 text-sm font-medium"
              onClick={handleReschedule}
            >
              Reschedule
            </button>
          </div>
        </div>
      </div>

      {isModalOpen && (
        <TaskDetailModal
          task={task}
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
        />
      )}
    </>
  );
}
