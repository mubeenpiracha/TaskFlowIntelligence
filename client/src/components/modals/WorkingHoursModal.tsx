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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { WorkingHours } from "@shared/schema";
import { useQueryClient, useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface WorkingHoursModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function WorkingHoursModal({ isOpen, onClose }: WorkingHoursModalProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  // Define state for all working hours settings
  const [monday, setMonday] = useState(true);
  const [tuesday, setTuesday] = useState(true);
  const [wednesday, setWednesday] = useState(true);
  const [thursday, setThursday] = useState(true);
  const [friday, setFriday] = useState(true);
  const [saturday, setSaturday] = useState(false);
  const [sunday, setSunday] = useState(false);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
  const [breakStartTime, setBreakStartTime] = useState('12:00');
  const [breakEndTime, setBreakEndTime] = useState('13:00');
  const [focusTimeEnabled, setFocusTimeEnabled] = useState(true);
  const [focusTimeDuration, setFocusTimeDuration] = useState('01:00');
  const [focusTimePreference, setFocusTimePreference] = useState('morning');
  
  // Fetch working hours data
  const { data: workingHours, isLoading } = useQuery({
    queryKey: ['/api/working-hours'],
    queryFn: async () => {
      try {
        const res = await apiRequest('GET', '/api/working-hours');
        return res.json();
      } catch (error) {
        console.error("Error fetching working hours:", error);
        return null;
      }
    }
  });
  
  // Update state when data is loaded
  useEffect(() => {
    if (workingHours) {
      setMonday(workingHours.monday);
      setTuesday(workingHours.tuesday);
      setWednesday(workingHours.wednesday);
      setThursday(workingHours.thursday);
      setFriday(workingHours.friday);
      setSaturday(workingHours.saturday);
      setSunday(workingHours.sunday);
      setStartTime(workingHours.startTime);
      setEndTime(workingHours.endTime);
      setBreakStartTime(workingHours.breakStartTime || '12:00');
      setBreakEndTime(workingHours.breakEndTime || '13:00');
      setFocusTimeEnabled(workingHours.focusTimeEnabled);
      setFocusTimeDuration(workingHours.focusTimeDuration || '01:00');
      setFocusTimePreference(workingHours.focusTimePreference || 'morning');
    }
  }, [workingHours]);
  
  // Update working hours mutation
  const updateMutation = useMutation({
    mutationFn: async () => {
      const workingHoursData = {
        monday,
        tuesday,
        wednesday,
        thursday,
        friday,
        saturday,
        sunday,
        startTime,
        endTime,
        breakStartTime,
        breakEndTime,
        focusTimeEnabled,
        focusTimeDuration,
        focusTimePreference
      };
      
      await apiRequest('PATCH', '/api/working-hours', workingHoursData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/working-hours'] });
      
      toast({
        title: "Settings saved",
        description: "Your working hours preferences have been updated.",
      });
      
      onClose();
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update working hours preferences",
        variant: "destructive",
      });
    }
  });
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateMutation.mutate();
  };
  
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Working Hours Preferences
          </DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="py-4">Loading preferences...</div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Workdays */}
            <div>
              <Label className="block text-sm font-medium text-gray-700">Work Days</Label>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={monday ? "default" : "outline"}
                  className={cn(
                    monday ? "bg-[#36C5F0] text-white" : "text-gray-700",
                    "rounded-full text-sm"
                  )}
                  onClick={() => setMonday(!monday)}
                >
                  Mon
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={tuesday ? "default" : "outline"}
                  className={cn(
                    tuesday ? "bg-[#36C5F0] text-white" : "text-gray-700",
                    "rounded-full text-sm"
                  )}
                  onClick={() => setTuesday(!tuesday)}
                >
                  Tue
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={wednesday ? "default" : "outline"}
                  className={cn(
                    wednesday ? "bg-[#36C5F0] text-white" : "text-gray-700",
                    "rounded-full text-sm"
                  )}
                  onClick={() => setWednesday(!wednesday)}
                >
                  Wed
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={thursday ? "default" : "outline"}
                  className={cn(
                    thursday ? "bg-[#36C5F0] text-white" : "text-gray-700",
                    "rounded-full text-sm"
                  )}
                  onClick={() => setThursday(!thursday)}
                >
                  Thu
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={friday ? "default" : "outline"}
                  className={cn(
                    friday ? "bg-[#36C5F0] text-white" : "text-gray-700",
                    "rounded-full text-sm"
                  )}
                  onClick={() => setFriday(!friday)}
                >
                  Fri
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={saturday ? "default" : "outline"}
                  className={cn(
                    saturday ? "bg-[#36C5F0] text-white" : "text-gray-700",
                    "rounded-full text-sm"
                  )}
                  onClick={() => setSaturday(!saturday)}
                >
                  Sat
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={sunday ? "default" : "outline"}
                  className={cn(
                    sunday ? "bg-[#36C5F0] text-white" : "text-gray-700",
                    "rounded-full text-sm"
                  )}
                  onClick={() => setSunday(!sunday)}
                >
                  Sun
                </Button>
              </div>
            </div>
            
            {/* Working Hours */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="work-start" className="block text-sm font-medium text-gray-700">
                  Start Time
                </Label>
                <div className="mt-1">
                  <Input
                    type="time"
                    id="work-start"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="work-end" className="block text-sm font-medium text-gray-700">
                  End Time
                </Label>
                <div className="mt-1">
                  <Input
                    type="time"
                    id="work-end"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                  />
                </div>
              </div>
            </div>
            
            {/* Break Time */}
            <div>
              <Label className="block text-sm font-medium text-gray-700">Break Time</Label>
              <div className="grid grid-cols-2 gap-4 mt-2">
                <div>
                  <Label htmlFor="break-start" className="block text-sm font-medium text-gray-700">
                    Start
                  </Label>
                  <div className="mt-1">
                    <Input
                      type="time"
                      id="break-start"
                      value={breakStartTime}
                      onChange={(e) => setBreakStartTime(e.target.value)}
                    />
                  </div>
                </div>
                <div>
                  <Label htmlFor="break-end" className="block text-sm font-medium text-gray-700">
                    End
                  </Label>
                  <div className="mt-1">
                    <Input
                      type="time"
                      id="break-end"
                      value={breakEndTime}
                      onChange={(e) => setBreakEndTime(e.target.value)}
                    />
                  </div>
                </div>
              </div>
            </div>
            
            {/* Focus Time */}
            <div>
              <div className="flex items-center justify-between">
                <Label htmlFor="focus-time" className="block text-sm font-medium text-gray-700">
                  Schedule Daily Focus Time
                </Label>
                <div className="ml-2 flex items-center">
                  <Switch
                    id="focus-time-enabled"
                    checked={focusTimeEnabled}
                    onCheckedChange={setFocusTimeEnabled}
                  />
                </div>
              </div>
              {focusTimeEnabled && (
                <div className="grid grid-cols-2 gap-4 mt-2">
                  <div>
                    <Select
                      value={focusTimeDuration}
                      onValueChange={setFocusTimeDuration}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Duration" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="00:30">30 minutes</SelectItem>
                        <SelectItem value="01:00">1 hour</SelectItem>
                        <SelectItem value="02:00">2 hours</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Select
                      value={focusTimePreference}
                      onValueChange={setFocusTimePreference}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="When" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="early">Early morning</SelectItem>
                        <SelectItem value="morning">Morning</SelectItem>
                        <SelectItem value="afternoon">Afternoon</SelectItem>
                        <SelectItem value="late">Late afternoon</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}
            </div>
            
            <DialogFooter>
              <Button 
                type="button" 
                variant="outline" 
                onClick={onClose}
                disabled={updateMutation.isPending}
              >
                Cancel
              </Button>
              <Button 
                type="submit"
                disabled={updateMutation.isPending}
                className="bg-[#36C5F0] hover:bg-[#36C5F0]/90"
              >
                {updateMutation.isPending ? 'Saving...' : 'Save Preferences'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
