import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { 
  getSlackChannels, 
  getSlackChannelPreferences, 
  saveSlackChannelPreferences, 
  type SlackChannel 
} from "@/lib/api";
import { ExternalLink, Calendar, AlertCircle, MessageSquare, RefreshCw } from "lucide-react";
import WorkingHoursModal from "@/components/modals/WorkingHoursModal";
import { useLocation } from "wouter";

export default function Settings() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [isWorkingHoursModalOpen, setIsWorkingHoursModalOpen] = useState(false);
  
  // Form state
  const [slackUserId, setSlackUserId] = useState("");
  const [slackWorkspace, setSlackWorkspace] = useState("");
  const [selectedChannels, setSelectedChannels] = useState<string[]>([]);
  const [isLoadingChannels, setIsLoadingChannels] = useState(false);
  
  // Fetch user data
  const { data: user, isLoading: isLoadingUser } = useQuery({
    queryKey: ['/api/auth/me'],
    queryFn: async () => {
      const res = await apiRequest('GET', '/api/auth/me');
      return res.json();
    }
  });
  
  // Update form state when user data is available
  useEffect(() => {
    if (user) {
      if (user.slackUserId) setSlackUserId(user.slackUserId);
      if (user.slackWorkspace) setSlackWorkspace(user.slackWorkspace);
    }
  }, [user]);
  
  // Fetch Google auth URL
  const { data: googleAuthData, isLoading: isLoadingGoogleAuth } = useQuery({
    queryKey: ['/api/auth/google/calendar/url'],
    queryFn: async () => {
      try {
        const res = await apiRequest('GET', '/api/auth/google/calendar/url');
        return res.json();
      } catch (error) {
        console.error("Error fetching Google auth URL:", error);
        return { url: "" };
      }
    }
  });
  
  // Connect Slack mutation
  const connectSlackMutation = useMutation({
    mutationFn: async () => {
      if (!slackUserId || !slackWorkspace) {
        throw new Error("Slack User ID and Workspace are required");
      }
      
      await apiRequest('POST', '/api/slack/connect', {
        slackUserId,
        workspace: slackWorkspace
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/auth/me'] });
      
      toast({
        title: "Slack connected",
        description: "Your Slack account has been connected successfully.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to connect Slack account.",
        variant: "destructive",
      });
    }
  });
  
  // Handle Slack connection
  const handleConnectSlack = (e: React.FormEvent) => {
    e.preventDefault();
    connectSlackMutation.mutate();
  };
  
  // Handle Google Calendar connection
  const handleConnectGoogle = () => {
    if (googleAuthData?.url) {
      window.location.href = googleAuthData.url;
    } else {
      toast({
        title: "Error",
        description: "Could not get Google authorization URL.",
        variant: "destructive",
      });
    }
  };
  
  // Check connection status
  const isSlackConnected = !!user?.slackUserId;
  const isGoogleConnected = !!user?.googleRefreshToken;
  
  // Fetch Slack channels
  const { data: slackChannels, isLoading: isLoadingSlackChannels, refetch: refetchChannels } = useQuery({
    queryKey: ['/api/slack/channels'],
    queryFn: async () => {
      if (!isSlackConnected) return [];
      setIsLoadingChannels(true);
      try {
        const channels = await getSlackChannels();
        setIsLoadingChannels(false);
        return channels;
      } catch (error) {
        console.error("Error fetching Slack channels:", error);
        setIsLoadingChannels(false);
        return [];
      }
    },
    enabled: false // Don't fetch on component mount
  });
  
  // Fetch channel preferences
  const { data: channelPreferences, refetch: refetchChannelPreferences } = useQuery({
    queryKey: ['/api/slack/channels/preferences'],
    queryFn: async () => {
      if (!isSlackConnected) return { channelIds: [] };
      try {
        return await getSlackChannelPreferences();
      } catch (error) {
        console.error("Error fetching channel preferences:", error);
        return { channelIds: [] };
      }
    },
    enabled: isSlackConnected
  });
  
  // Save channel preferences mutation
  const saveChannelsMutation = useMutation({
    mutationFn: (channelIds: string[]) => saveSlackChannelPreferences(channelIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/slack/channels/preferences'] });
      toast({
        title: "Channels saved",
        description: `You've selected ${selectedChannels.length} channels for task detection.`,
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to save channel preferences.",
        variant: "destructive",
      });
    }
  });

  // Fetch channels when Slack is connected
  useEffect(() => {
    if (isSlackConnected) {
      refetchChannels();
      refetchChannelPreferences();
    }
  }, [isSlackConnected, refetchChannels, refetchChannelPreferences]);
  
  // Set selected channels from preferences when they're loaded
  useEffect(() => {
    if (channelPreferences?.channelIds) {
      setSelectedChannels(channelPreferences.channelIds);
    }
  }, [channelPreferences]);
  
  // Handle channel selection
  const handleChannelToggle = (channelId: string) => {
    setSelectedChannels(prev => 
      prev.includes(channelId)
        ? prev.filter(id => id !== channelId)
        : [...prev, channelId]
    );
  };
  
  // Handle saving channel preferences
  const handleSaveChannelPreferences = () => {
    if (selectedChannels.length === 0) return;
    
    // Save channel preferences to the server
    saveChannelsMutation.mutate(selectedChannels);
  };
  
  // Check URL parameters for Google Auth feedback
  const [location] = useLocation();
  const isGoogleAuthSuccess = location.includes('google_connected=true');
  const isGoogleAuthError = location.includes('error=google_auth_failed') || location.includes('error=no_refresh_token');
  
  // Show toast for Google Auth feedback on component mount
  useState(() => {
    if (isGoogleAuthSuccess) {
      toast({
        title: "Google Calendar connected",
        description: "Your Google Calendar has been connected successfully.",
      });
    } else if (isGoogleAuthError) {
      toast({
        title: "Google Calendar connection failed",
        description: "There was an error connecting your Google Calendar.",
        variant: "destructive",
      });
    }
  });
  
  return (
    <>
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-2xl font-semibold text-[#1D1C1D]">Settings</h1>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Slack Integration */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <svg className="w-6 h-6 mr-2" viewBox="0 0 54 54" xmlns="http://www.w3.org/2000/svg">
                <path d="M19.712.133a5.381 5.381 0 0 0-5.376 5.387 5.381 5.381 0 0 0 5.376 5.386h5.376V5.52A5.381 5.381 0 0 0 19.712.133m0 14.365H5.376A5.381 5.381 0 0 0 0 19.884a5.381 5.381 0 0 0 5.376 5.387h14.336a5.381 5.381 0 0 0 5.376-5.387 5.381 5.381 0 0 0-5.376-5.386" fill="#36C5F0"/>
                <path d="M53.76 19.884a5.381 5.381 0 0 0-5.376-5.386 5.381 5.381 0 0 0-5.376 5.386v5.387h5.376a5.381 5.381 0 0 0 5.376-5.387m-14.336 0V5.52A5.381 5.381 0 0 0 34.048.133a5.381 5.381 0 0 0-5.376 5.387v14.364a5.381 5.381 0 0 0 5.376 5.387 5.381 5.381 0 0 0 5.376-5.387" fill="#2EB67D"/>
                <path d="M34.048 54a5.381 5.381 0 0 0 5.376-5.387 5.381 5.381 0 0 0-5.376-5.386h-5.376v5.386A5.381 5.381 0 0 0 34.048 54m0-14.365h14.336a5.381 5.381 0 0 0 5.376-5.386 5.381 5.381 0 0 0-5.376-5.387H34.048a5.381 5.381 0 0 0-5.376 5.387 5.381 5.381 0 0 0 5.376 5.386" fill="#ECB22E"/>
                <path d="M0 34.249a5.381 5.381 0 0 0 5.376 5.386 5.381 5.381 0 0 0 5.376-5.386v-5.387H5.376A5.381 5.381 0 0 0 0 34.25m14.336-.001v14.364A5.381 5.381 0 0 0 19.712 54a5.381 5.381 0 0 0 5.376-5.387V34.25a5.381 5.381 0 0 0-5.376-5.387 5.381 5.381 0 0 0-5.376 5.387" fill="#E01E5A"/>
              </svg>
              Slack Integration
            </CardTitle>
            <CardDescription>
              Connect your Slack account to detect tasks from messages
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingUser ? (
              <div className="space-y-4">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : (
              <form onSubmit={handleConnectSlack} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="slack-user-id">Slack User ID</Label>
                  <Input
                    id="slack-user-id"
                    placeholder="e.g. U01ABCDEFGH"
                    value={slackUserId}
                    onChange={(e) => setSlackUserId(e.target.value)}
                    disabled={isSlackConnected}
                  />
                  <p className="text-xs text-gray-500">
                    Your Slack User ID starts with "U" and can be found in your profile
                  </p>
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="slack-workspace">Slack Workspace</Label>
                  <Input
                    id="slack-workspace"
                    placeholder="e.g. my-company"
                    value={slackWorkspace}
                    onChange={(e) => setSlackWorkspace(e.target.value)}
                    disabled={isSlackConnected}
                  />
                </div>
                
                {!isSlackConnected && (
                  <Button 
                    type="submit" 
                    className="w-full bg-[#4A154B] hover:bg-[#4A154B]/90"
                    disabled={connectSlackMutation.isPending || !slackUserId || !slackWorkspace}
                  >
                    {connectSlackMutation.isPending ? "Connecting..." : "Connect Slack"}
                  </Button>
                )}
                
                {isSlackConnected && (
                  <div className="flex items-center space-x-2 p-2 bg-green-50 text-green-800 rounded-md">
                    <div className="h-3 w-3 bg-[#2EB67D] rounded-full"></div>
                    <span className="text-sm">Slack connected successfully</span>
                  </div>
                )}
              </form>
            )}
          </CardContent>
        </Card>
        
        {/* Google Calendar Integration */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Calendar className="w-6 h-6 mr-2" />
              Google Calendar Integration
            </CardTitle>
            <CardDescription>
              Connect your Google Calendar to schedule tasks automatically
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingUser || isLoadingGoogleAuth ? (
              <div className="space-y-4">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-gray-600">
                  By connecting your Google Calendar, TaskFlow will be able to:
                </p>
                <ul className="text-sm text-gray-600 list-disc pl-5 space-y-1">
                  <li>Create events for your tasks</li>
                  <li>Check your availability for scheduling</li>
                  <li>Update or delete task-related events</li>
                </ul>
                
                {!isGoogleConnected ? (
                  <Button 
                    onClick={handleConnectGoogle}
                    className="w-full mt-4"
                    disabled={!googleAuthData?.url}
                  >
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Connect Google Calendar
                  </Button>
                ) : (
                  <div className="flex items-center space-x-2 p-2 bg-green-50 text-green-800 rounded-md">
                    <div className="h-3 w-3 bg-[#2EB67D] rounded-full"></div>
                    <span className="text-sm">Google Calendar connected successfully</span>
                  </div>
                )}
                
                {isGoogleAuthError && (
                  <div className="flex items-center space-x-2 p-2 bg-red-50 text-red-800 rounded-md">
                    <AlertCircle className="h-4 w-4" />
                    <span className="text-sm">Failed to connect Google Calendar. Please try again.</span>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
        
        {/* Slack Channels */}
        {isSlackConnected && (
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center">
                <MessageSquare className="w-6 h-6 mr-2" />
                Slack Channels for Task Detection
              </CardTitle>
              <CardDescription>
                Select which Slack channels to monitor for potential tasks
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoadingChannels || isLoadingSlackChannels ? (
                <div className="space-y-4">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : (
                <>
                  <div className="flex justify-between items-center mb-4">
                    <p className="text-sm text-gray-600">
                      TaskFlow will only detect tasks from channels you select.
                    </p>
                    <Button variant="outline" size="sm" onClick={() => refetchChannels()}>
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Refresh Channels
                    </Button>
                  </div>
                  
                  {slackChannels && slackChannels.length > 0 ? (
                    <div className="space-y-2 max-h-60 overflow-y-auto border rounded-md p-2">
                      {slackChannels.map((channel: SlackChannel) => (
                        <div key={channel.id} className="flex items-center space-x-2 py-2 border-b last:border-b-0">
                          <Checkbox 
                            id={`channel-${channel.id}`}
                            checked={selectedChannels.includes(channel.id)}
                            onCheckedChange={() => handleChannelToggle(channel.id)}
                          />
                          <Label 
                            htmlFor={`channel-${channel.id}`}
                            className="flex-1 flex justify-between items-center cursor-pointer"
                          >
                            <span className="font-medium">#{channel.name}</span>
                            {channel.is_private && (
                              <span className="text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded-full">
                                Private
                              </span>
                            )}
                          </Label>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-6 border rounded-md bg-gray-50">
                      <p className="text-gray-500">No channels available or you are not a member of any channels.</p>
                    </div>
                  )}
                  
                  <div className="mt-4 flex justify-end">
                    <Button 
                      className="bg-[#4A154B] hover:bg-[#4A154B]/90"
                      disabled={selectedChannels.length === 0}
                      onClick={handleSaveChannelPreferences}
                    >
                      Save Channel Preferences
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )}
        
        {/* Working Hours */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Working Hours & Preferences</CardTitle>
            <CardDescription>
              Set your preferred working hours to help schedule tasks efficiently
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="text-base font-medium">Working Hours Schedule</h3>
                  <p className="text-sm text-gray-500">Configure your workdays and hours</p>
                </div>
                <Button
                  variant="outline"
                  onClick={() => setIsWorkingHoursModalOpen(true)}
                >
                  Configure
                </Button>
              </div>
              
              <Separator />
              
              {/* Notification Preferences - Simulated since not part of the backend yet */}
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="text-base font-medium">Task Reminders</h3>
                  <p className="text-sm text-gray-500">Get notified before task deadlines</p>
                </div>
                <Switch id="notifications" defaultChecked />
              </div>
              
              <Separator />
              
              <div className="flex justify-between items-center">
                <div>
                  <h3 className="text-base font-medium">Work-Life Balance Mode</h3>
                  <p className="text-sm text-gray-500">Prevent scheduling tasks outside working hours</p>
                </div>
                <Switch id="work-life-balance" />
              </div>
            </div>
          </CardContent>
          <CardFooter className="border-t border-gray-100 p-6">
            <div className="text-sm text-gray-500">
              Your working hours settings help TaskFlow to intelligently schedule tasks and respect your work-life balance.
            </div>
          </CardFooter>
        </Card>
      </div>
      
      {/* Working Hours Modal */}
      {isWorkingHoursModalOpen && (
        <WorkingHoursModal
          isOpen={isWorkingHoursModalOpen}
          onClose={() => setIsWorkingHoursModalOpen(false)}
        />
      )}
    </>
  );
}
