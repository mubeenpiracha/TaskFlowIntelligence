import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Task } from "@shared/schema";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface SlackMessage {
  user: string;
  text: string;
  ts: string;
  channel?: string;
}

interface TaskDetailModalProps {
  task?: Task;
  slackMessage?: SlackMessage;
  isOpen: boolean;
  onClose: () => void;
}

export default function TaskDetailModal({ task, slackMessage, isOpen, onClose }: TaskDetailModalProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const [title, setTitle] = useState(task?.title || '');
  const [description, setDescription] = useState(task?.description || '');
  const [priority, setPriority] = useState(task?.priority || 'medium');
  const [timeRequired, setTimeRequired] = useState(task?.timeRequired || '01:00');
  const [dueDate, setDueDate] = useState(task?.dueDate || new Date().toISOString().split('T')[0]);
  const [dueTime, setDueTime] = useState(task?.dueTime || '17:00');
  
  // If we have a Slack message, auto-populate fields
  useEffect(() => {
    if (slackMessage && !task) {
      setTitle(slackMessage.text.substring(0, 50));
      setDescription(slackMessage.text);
    }
  }, [slackMessage, task]);
  
  // Create or update task mutation
  const taskMutation = useMutation({
    mutationFn: async () => {
      const taskData = {
        title,
        description,
        priority,
        timeRequired,
        dueDate,
        dueTime,
        ...(slackMessage && {
          slackMessageId: slackMessage.ts,
          slackChannelId: slackMessage.channel
        })
      };
      
      if (task) {
        // Update existing task
        await apiRequest('PATCH', `/api/tasks/${task.id}`, taskData);
      } else {
        // Create new task
        await apiRequest('POST', '/api/tasks', taskData);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/tasks'] });
      queryClient.invalidateQueries({ queryKey: ['/api/tasks/today'] });
      queryClient.invalidateQueries({ queryKey: [`/api/tasks/${dueDate}`] });
      
      toast({
        title: task ? "Task updated" : "Task created",
        description: title,
      });
      
      onClose();
    },
    onError: () => {
      toast({
        title: "Error",
        description: task ? "Failed to update task" : "Failed to create task",
        variant: "destructive",
      });
    }
  });
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    taskMutation.mutate();
  };
  
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {task ? "Edit Task Details" : "Add Task Details"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Task Name */}
          <div>
            <label htmlFor="task-name" className="block text-sm font-medium text-gray-700">Task Name</label>
            <div className="mt-1">
              <Input
                id="task-name"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </div>
          </div>
          
          {/* Description */}
          <div>
            <label htmlFor="task-description" className="block text-sm font-medium text-gray-700">Description</label>
            <div className="mt-1">
              <Textarea
                id="task-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          
          {/* Priority & Time Required */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="priority" className="block text-sm font-medium text-gray-700">Priority</label>
              <Select
                value={priority}
                onValueChange={setPriority}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select priority" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label htmlFor="time-required" className="block text-sm font-medium text-gray-700">Time Required</label>
              <Select
                value={timeRequired}
                onValueChange={setTimeRequired}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select time" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="00:15">15 min</SelectItem>
                  <SelectItem value="00:30">30 min</SelectItem>
                  <SelectItem value="01:00">1 hour</SelectItem>
                  <SelectItem value="02:00">2 hours</SelectItem>
                  <SelectItem value="04:00">4+ hours</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          
          {/* Due Date & Time */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="due-date" className="block text-sm font-medium text-gray-700">Due Date</label>
              <div className="mt-1">
                <Input
                  type="date"
                  id="due-date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label htmlFor="due-time" className="block text-sm font-medium text-gray-700">Due Time</label>
              <div className="mt-1">
                <Input
                  type="time"
                  id="due-time"
                  value={dueTime}
                  onChange={(e) => setDueTime(e.target.value)}
                />
              </div>
            </div>
          </div>
          
          <DialogFooter>
            <Button 
              type="button" 
              variant="outline" 
              onClick={onClose}
              disabled={taskMutation.isPending}
            >
              Cancel
            </Button>
            <Button 
              type="submit"
              disabled={taskMutation.isPending}
            >
              {taskMutation.isPending ? 'Processing...' : task ? 'Update Task' : 'Schedule Task'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
