import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Search, Filter } from "lucide-react";
import { Task } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import TaskCard from "@/components/TaskCard";
import TaskDetailModal from "@/components/modals/TaskDetailModal";

export default function Tasks() {
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Fetch all tasks
  const { data: tasks, isLoading } = useQuery({
    queryKey: ['/api/tasks'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/tasks');
      return res.json();
    }
  });

  // Filter tasks based on search query and filters
  const filterTasks = (taskList: Task[]) => {
    if (!taskList) return [];
    
    return taskList.filter(task => {
      // Search filter
      const matchesSearch = 
        task.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (task.description && task.description.toLowerCase().includes(searchQuery.toLowerCase()));
      
      // Priority filter
      const matchesPriority = 
        priorityFilter === "all" || 
        task.priority.toLowerCase() === priorityFilter.toLowerCase();
      
      // Status filter
      const matchesStatus = 
        statusFilter === "all" || 
        (statusFilter === "completed" && task.completed) || 
        (statusFilter === "pending" && !task.completed);
      
      return matchesSearch && matchesPriority && matchesStatus;
    });
  };

  // Filter completed and pending tasks
  const pendingTasks = tasks ? tasks.filter((task: Task) => !task.completed) : [];
  const completedTasks = tasks ? tasks.filter((task: Task) => task.completed) : [];

  // Apply filters to the appropriate task list based on tab
  const filteredPendingTasks = filterTasks(pendingTasks);
  const filteredCompletedTasks = filterTasks(completedTasks);
  const filteredAllTasks = filterTasks(tasks || []);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Already filtering as you type, so no additional action needed
  };

  return (
    <>
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-2xl font-semibold text-[#1D1C1D]">Tasks</h1>
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

      {/* Search and Filters */}
      <div className="bg-white p-4 rounded-lg shadow mb-6">
        <form onSubmit={handleSearchSubmit} className="flex flex-col sm:flex-row gap-4">
          <div className="relative flex-grow">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={18} />
            <Input
              placeholder="Search tasks..."
              className="pl-9"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
              <SelectTrigger className="w-[130px]">
                <div className="flex items-center">
                  <Filter className="mr-2 h-4 w-4" />
                  <span>Priority</span>
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="low">Low</SelectItem>
              </SelectContent>
            </Select>
            
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[130px]">
                <div className="flex items-center">
                  <Filter className="mr-2 h-4 w-4" />
                  <span>Status</span>
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </form>
      </div>

      {/* Tasks Tabs */}
      <div className="bg-white overflow-hidden shadow rounded-lg">
        <Tabs defaultValue="pending" className="w-full">
          <div className="px-4 py-3 border-b border-gray-200">
            <TabsList className="grid w-full md:w-[400px] grid-cols-3">
              <TabsTrigger value="pending">Pending</TabsTrigger>
              <TabsTrigger value="completed">Completed</TabsTrigger>
              <TabsTrigger value="all">All</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="pending" className="p-4">
            {isLoading ? (
              <div className="space-y-4">
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
              </div>
            ) : filteredPendingTasks.length > 0 ? (
              <div className="space-y-4">
                {filteredPendingTasks.map((task: Task) => (
                  <TaskCard key={task.id} task={task} />
                ))}
              </div>
            ) : (
              <div className="text-center py-10 text-gray-500">
                {searchQuery || priorityFilter !== "all" || statusFilter !== "all" 
                  ? "No tasks match your filters."
                  : "No pending tasks. Add a new task to get started!"}
              </div>
            )}
          </TabsContent>

          <TabsContent value="completed" className="p-4">
            {isLoading ? (
              <div className="space-y-4">
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
              </div>
            ) : filteredCompletedTasks.length > 0 ? (
              <div className="space-y-4">
                {filteredCompletedTasks.map((task: Task) => (
                  <TaskCard key={task.id} task={task} />
                ))}
              </div>
            ) : (
              <div className="text-center py-10 text-gray-500">
                {searchQuery || priorityFilter !== "all" || statusFilter !== "all" 
                  ? "No tasks match your filters."
                  : "No completed tasks yet."}
              </div>
            )}
          </TabsContent>

          <TabsContent value="all" className="p-4">
            {isLoading ? (
              <div className="space-y-4">
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-24 w-full" />
              </div>
            ) : filteredAllTasks.length > 0 ? (
              <div className="space-y-4">
                {filteredAllTasks.map((task: Task) => (
                  <TaskCard key={task.id} task={task} />
                ))}
              </div>
            ) : (
              <div className="text-center py-10 text-gray-500">
                {searchQuery || priorityFilter !== "all" || statusFilter !== "all" 
                  ? "No tasks match your filters."
                  : "No tasks found. Add a new task to get started!"}
              </div>
            )}
          </TabsContent>
        </Tabs>
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
