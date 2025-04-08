import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { updateUserTimezone } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RefreshCw } from "lucide-react";

// List of common IANA timezone strings for the selector
const COMMON_TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Asia/Kolkata",
  "Australia/Sydney",
  "Pacific/Auckland"
];

interface TimezoneSelectorProps {
  currentTimezone: string;
}

export default function TimezoneSelector({ currentTimezone }: TimezoneSelectorProps) {
  const [selectedTimezone, setSelectedTimezone] = useState(currentTimezone || "UTC");
  const [isSaving, setIsSaving] = useState(false);
  const [detectedTimezone, setDetectedTimezone] = useState<string | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Try to detect the user's timezone
  useEffect(() => {
    try {
      const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (userTimezone) {
        setDetectedTimezone(userTimezone);
      }
    } catch (error) {
      console.error("Error detecting timezone:", error);
    }
  }, []);

  // Update timezone mutation
  const timezoneMutation = useMutation({
    mutationFn: updateUserTimezone,
    onMutate: () => {
      setIsSaving(true);
    },
    onSuccess: (updatedUser) => {
      queryClient.invalidateQueries({ queryKey: ['/api/auth/me'] });
      toast({
        title: "Timezone updated",
        description: `Your timezone has been set to ${updatedUser.timezone}.`
      });
      setIsSaving(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to update timezone",
        description: error.message || "There was an error updating your timezone.",
        variant: "destructive"
      });
      setIsSaving(false);
    }
  });

  // Use the detected timezone
  const handleUseDetectedTimezone = () => {
    if (detectedTimezone) {
      setSelectedTimezone(detectedTimezone);
      timezoneMutation.mutate(detectedTimezone);
    }
  };

  // Save the selected timezone
  const handleSaveTimezone = () => {
    if (selectedTimezone && selectedTimezone !== currentTimezone) {
      timezoneMutation.mutate(selectedTimezone);
    }
  };

  // Get a user-friendly timezone name
  const formatTimezone = (tz: string) => {
    try {
      // Use the timezone offset to show a more user-friendly name
      const now = new Date();
      const offset = new Intl.DateTimeFormat('en', {
        timeZone: tz,
        timeZoneName: 'short'
      }).format(now).split(' ').pop();
      
      // Format: "America/New_York (EST)"
      return `${tz.replace('_', ' ')} (${offset})`;
    } catch (error) {
      return tz;
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 md:flex-row md:items-end">
        <div className="flex-grow">
          <Select
            value={selectedTimezone}
            onValueChange={setSelectedTimezone}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a timezone" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {COMMON_TIMEZONES.map((timezone) => (
                  <SelectItem key={timezone} value={timezone}>
                    {formatTimezone(timezone)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        
        <div className="flex gap-2">
          {detectedTimezone && detectedTimezone !== selectedTimezone && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleUseDetectedTimezone}
              disabled={isSaving}
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Use detected ({detectedTimezone.split('/').pop()})
            </Button>
          )}
          
          <Button
            onClick={handleSaveTimezone}
            disabled={isSaving || selectedTimezone === currentTimezone}
            size="sm"
          >
            {isSaving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}