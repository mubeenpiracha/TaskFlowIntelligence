import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar, Clock, ExternalLink, RefreshCw, MessageSquare, BriefcaseIcon } from "lucide-react";
import TimezoneSelector from "@/components/TimezoneSelector";
import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { useState, useEffect } from "react";
import {
  getSlackAuthUrl,
  disconnectSlack,
  disconnectGoogleCalendar,
  getGoogleCalendarAuthUrl,
  getSlackChannels,
  getSlackChannelPreferences,
  saveSlackChannelPreferences,
  getWorkingHours,
  updateWorkingHours,
  SlackChannel
} from "@/lib/api";

export default function Settings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // States for channel selection
  const [selectedChannels, setSelectedChannels] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  
  // States for working hours
  const [workingHours, setWorkingHours] = useState({
    monday: true,
    tuesday: true,
    wednesday: true,
    thursday: true,
    friday: true,
    saturday: false,
    sunday: false,
    startTime: '09:00',
    endTime: '17:00',
    breakStartTime: '12:00',
    breakEndTime: '13:00',
    focusTimeEnabled: true,
    focusTimeDuration: '01:00',
    focusTimePreference: 'morning',
  });
  
  // Fetch user data with minimal error handling
  const { data: user, isLoading: isLoadingUser } = useQuery({
    queryKey: ['/api/auth/me'],
    retry: 1
  });
  
  // Fetch Google Calendar auth URL
  const { data: googleAuthData, isLoading: isLoadingGoogleAuth } = useQuery({
    queryKey: ['/api/auth/google/calendar/url'],
    queryFn: async () => {
      try {
        return await getGoogleCalendarAuthUrl();
      } catch (error) {
        console.error("Error fetching Google auth URL:", error);
        return { url: "" };
      }
    }
  });
  
  // Fetch Slack OAuth URL
  const { data: slackAuthData } = useQuery({
    queryKey: ['/api/auth/slack/url'],
    queryFn: async () => {
      try {
        return await getSlackAuthUrl();
      } catch (error) {
        console.error("Error fetching Slack auth URL:", error);
        return { url: "" };
      }
    }
  });
  
  // Fetch Slack channels
  const { data: slackChannels, isLoading: isLoadingChannels, error: channelsError } = useQuery({
    queryKey: ['/api/slack/channels'],
    queryFn: async () => {
      try {
        if (!isSlackConnected) return [];
        return await getSlackChannels();
      } catch (error) {
        console.error("Error fetching Slack channels:", error);
        return [];
      }
    },
    enabled: !!user?.slackUserId, // Only fetch channels when Slack is connected
  });
  
  // Fetch channel preferences
  const { data: channelPrefs, isLoading: isLoadingPreferences } = useQuery({
    queryKey: ['/api/slack/channels/preferences'],
    queryFn: async () => {
      try {
        if (!isSlackConnected) return { channelIds: [] };
        return await getSlackChannelPreferences();
      } catch (error) {
        console.error("Error fetching channel preferences:", error);
        return { channelIds: [] };
      }
    },
    enabled: !!user?.slackUserId,
  });
  
  // Fetch working hours
  const { data: workingHoursData, isLoading: isLoadingWorkingHours } = useQuery({
    queryKey: ['/api/working-hours'],
    queryFn: async () => {
      try {
        return await getWorkingHours();
      } catch (error) {
        console.error("Error fetching working hours:", error);
        return null;
      }
    }
  });
  
  // Disconnect Google Calendar mutation
  const disconnectGoogleCalendarMutation = useMutation({
    mutationFn: async () => {
      return await disconnectGoogleCalendar();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/auth/me'] });
      
      toast({
        title: "Google Calendar disconnected",
        description: "Your Google Calendar has been disconnected successfully.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to disconnect Google Calendar.",
        variant: "destructive",
      });
    }
  });
  
  // Disconnect Slack mutation
  const disconnectSlackMutation = useMutation({
    mutationFn: async () => {
      return await disconnectSlack();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/auth/me'] });
      queryClient.invalidateQueries({ queryKey: ['/api/slack/channels'] });
      queryClient.invalidateQueries({ queryKey: ['/api/slack/channels/preferences'] });
      
      toast({
        title: "Slack disconnected",
        description: "Your Slack account has been disconnected successfully.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to disconnect Slack account.",
        variant: "destructive",
      });
    }
  });
  
  // Save channel preferences mutation
  const saveChannelPreferencesMutation = useMutation({
    mutationFn: async (channelIds: string[]) => {
      return await saveSlackChannelPreferences(channelIds);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/slack/channels/preferences'] });
      
      toast({
        title: "Preferences saved",
        description: "Your channel preferences have been saved successfully.",
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
  
  // Update working hours mutation
  const updateWorkingHoursMutation = useMutation({
    mutationFn: async (workingHoursUpdate: Partial<typeof workingHours>) => {
      return await updateWorkingHours(workingHoursUpdate);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/working-hours'] });
      
      toast({
        title: "Working hours updated",
        description: "Your working hours settings have been updated successfully.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update working hours settings.",
        variant: "destructive",
      });
    }
  });

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
  
  // Handle Slack connection
  const handleConnectSlack = () => {
    if (slackAuthData?.url) {
      window.location.href = slackAuthData.url;
    } else {
      toast({
        title: "Error",
        description: "Could not get Slack authorization URL.",
        variant: "destructive",
      });
    }
  };
  
  // Handle channel selection
  const handleChannelToggle = (channelId: string) => {
    setSelectedChannels(prev => 
      prev.includes(channelId)
        ? prev.filter(id => id !== channelId)
        : [...prev, channelId]
    );
  };
  
  // Save channel preferences
  const handleSaveChannelPreferences = () => {
    saveChannelPreferencesMutation.mutate(selectedChannels);
  };
  
  // Handle working hours changes
  const handleWorkingHoursChange = (field: keyof typeof workingHours, value: any) => {
    setWorkingHours(prev => ({
      ...prev,
      [field]: value
    }));
  };
  
  // Save working hours
  const handleSaveWorkingHours = () => {
    updateWorkingHoursMutation.mutate(workingHours);
  };
  
  // Filter channels based on search query
  const filteredChannels = slackChannels ? slackChannels.filter(channel => 
    channel.name.toLowerCase().includes(searchQuery.toLowerCase())
  ) : [];
  
  // Effect to set selected channels when preferences are loaded
  useEffect(() => {
    if (channelPrefs?.channelIds) {
      setSelectedChannels(channelPrefs.channelIds);
    }
  }, [channelPrefs]);
  
  // Effect to set working hours when data is loaded
  useEffect(() => {
    if (workingHoursData) {
      setWorkingHours({
        monday: workingHoursData.monday,
        tuesday: workingHoursData.tuesday,
        wednesday: workingHoursData.wednesday,
        thursday: workingHoursData.thursday,
        friday: workingHoursData.friday,
        saturday: workingHoursData.saturday,
        sunday: workingHoursData.sunday,
        startTime: workingHoursData.startTime,
        endTime: workingHoursData.endTime,
        breakStartTime: workingHoursData.breakStartTime || '12:00',
        breakEndTime: workingHoursData.breakEndTime || '13:00',
        focusTimeEnabled: workingHoursData.focusTimeEnabled,
        focusTimeDuration: workingHoursData.focusTimeDuration || '01:00',
        focusTimePreference: workingHoursData.focusTimePreference || 'morning',
      });
    }
  }, [workingHoursData]);
  
  // Check connection status
  const isSlackConnected = !!user?.slackUserId;
  const isGoogleConnected = !!user?.googleRefreshToken;

  return (
    <>
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-2xl font-semibold text-[#1D1C1D]">Settings</h1>
      </div>
      
      <Alert className="mb-6">
        <AlertCircle className="h-4 w-4 mr-2" />
        <AlertDescription>
          The Settings page is currently undergoing maintenance. Some functionality may be limited.
        </AlertDescription>
      </Alert>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Timezone Settings */}
        <Card id="timezone-settings-card">
          <CardHeader>
            <CardTitle className="flex items-center">
              <Clock className="w-6 h-6 mr-2" />
              Timezone Settings
            </CardTitle>
            <CardDescription>
              Set your timezone for accurate scheduling
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingUser ? (
              <Skeleton className="h-10 w-full" />
            ) : (
              <TimezoneSelector currentTimezone={user?.timezone || "UTC"} />
            )}
          </CardContent>
        </Card>
        
        {/* Google Calendar Integration */}
        <Card id="google-calendar">
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
                <div className="p-3 border rounded-md bg-gray-50">
                  <h3 className="font-medium mb-2">Status</h3>
                  <div className="flex items-center space-x-2">
                    <div className={`w-3 h-3 rounded-full ${isGoogleConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
                    <span>{isGoogleConnected ? 'Connected' : 'Not connected'}</span>
                  </div>
                </div>
                
                {/* Show a special message if this was linked from the calendar page */}
                {window.location.hash === '#google-calendar' && !isGoogleConnected && (
                  <Alert className="mb-4">
                    <ExternalLink className="h-4 w-4" />
                    <AlertTitle>Google Calendar Access Required</AlertTitle>
                    <AlertDescription>
                      Connect your Google Calendar using the button below to continue viewing and managing events.
                    </AlertDescription>
                  </Alert>
                )}
                
                {window.location.hash === '#google-calendar' && isGoogleConnected && (
                  <Alert className="mb-4" variant="warning">
                    <RefreshCw className="h-4 w-4" />
                    <AlertTitle>Reconnection Recommended</AlertTitle>
                    <AlertDescription>
                      If you're experiencing calendar issues, try disconnecting and then reconnecting your Google Calendar to refresh the authentication.
                    </AlertDescription>
                  </Alert>
                )}
                
                {!isGoogleConnected ? (
                  <Button 
                    onClick={handleConnectGoogle}
                    className="w-full"
                    disabled={!googleAuthData?.url}
                  >
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Connect Google Calendar
                  </Button>
                ) : (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        onClick={handleConnectGoogle}
                        className="text-sm"
                        variant="outline"
                        size="sm"
                        disabled={!googleAuthData?.url}
                      >
                        <RefreshCw className="mr-2 h-3 w-3" />
                        Reconnect
                      </Button>
                      <Button
                        onClick={() => disconnectGoogleCalendarMutation.mutate()}
                        className="text-sm text-red-600 border-red-300 hover:bg-red-50 hover:text-red-700"
                        variant="outline"
                        size="sm"
                        disabled={disconnectGoogleCalendarMutation.isPending}
                      >
                        {disconnectGoogleCalendarMutation.isPending ? (
                          <><RefreshCw className="mr-1 h-3 w-3 animate-spin" /> Disconnecting...</>
                        ) : (
                          'Disconnect'
                        )}
                      </Button>
                    </div>
                    <div className="text-xs text-gray-500 space-y-2">
                      <p>
                        <strong>Troubleshooting Calendar Issues:</strong>
                      </p>
                      <ol className="list-decimal pl-4 space-y-1">
                        <li>If calendar events aren't showing, try <strong>reconnecting</strong> first.</li>
                        <li>If that doesn't work, <strong>disconnect</strong> and then connect again.</li>
                        <li>Make sure your Google account has calendar permissions enabled.</li>
                      </ol>
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
        
        {/* Slack Integration */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <svg className="w-6 h-6 mr-2" viewBox="0 0 54 54" xmlns="http://www.w3.org/2000/svg">
                <path d="M19.712.133a5.381 5.381 0 0 0-5.376 5.387 5.381 5.381 0 0 0 5.376 5.386h5.376V5.52A5.381 5.381 0 0 0 19.712.133m0 14.365H5.376A5.381 5.381 0 0 0 0 19.884a5.381 5.381 0 0 0 5.376 5.387h14.336a5.381 5.381 0 0 0 5.376-5.387 5.381 5.381 0 0 0-5.376-5.386" fill="#36C5F0"/>
                <path d="M53.76 19.884a5.381 5.381 0 0 0-5.376-5.386 5.381 5.381 0 0 0-5.376 5.386v5.387h5.376a5.381 5.381 0 0 0 5.376-5.387m-14.336 0V5.52A5.381 5.381 0 0 0 34.048.133a5.381 5.381 0 0 0-5.376 5.387v14.364a5.381 5.381 0 0 0 5.376 5.387 5.381 5.381 0 0 0 5.376-5.387" fill="#2EB67D"/>
                <path d="M34.048 54a5.381 5.381 0 0 0 5.376-5.387 5.381 5.381 0 0 0-5.376-5.386h-5.376v5.386A5.381 5.381 0 0 0 34.048 54m0-14.365h14.336a5.381 5.381 0 0 0 5.376-5.386 5.381 5.381 0 0 0-5.376-5.387H34.048a5.381 5.381 0 0 0-5.376 5.387 5.381 5.381 0 0 0 5.376 5.386" fill="#ECB22E"/>
                <path d="M0 34.249a5.381 5.381 0 0 0 5.376 5.386 5.381 5.381 0 0 0 5.376-5.386v-5.387H5.376A5.381 5.381 0 0 0 0 34.25m14.336-.001v14.364A5.381 5.381 0 0 0 19.712 54a5.381 5.381 0 0 0 5.376-5.387V34.25a5.381 5.381 0 0 0-5.376-5.387a5.381 5.381 0 0 0-5.376 5.387" fill="#E01E5A"/>
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
              <div className="space-y-4">
                <div className="p-3 border rounded-md bg-gray-50">
                  <h3 className="font-medium mb-2">Status</h3>
                  <div className="flex items-center space-x-2">
                    <div className={`w-3 h-3 rounded-full ${isSlackConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
                    <span>{isSlackConnected ? 'Connected' : 'Not connected'}</span>
                  </div>
                  {user?.slackWorkspace && (
                    <div className="mt-2 text-sm text-gray-600">
                      Workspace: {user.slackWorkspace}
                    </div>
                  )}
                  {user?.slackUserId && (
                    <div className="mt-1 text-sm text-gray-600">
                      User ID: {user.slackUserId}
                    </div>
                  )}
                </div>
                
                {!isSlackConnected ? (
                  <Button 
                    onClick={handleConnectSlack}
                    className="w-full bg-[#4A154B] hover:bg-[#4A154B]/90"
                    disabled={!slackAuthData?.url}
                  >
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Connect with Slack
                  </Button>
                ) : (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        onClick={handleConnectSlack}
                        className="text-sm"
                        variant="outline"
                        size="sm"
                        disabled={!slackAuthData?.url}
                      >
                        <RefreshCw className="mr-2 h-3 w-3" />
                        Reconnect
                      </Button>
                      <Button 
                        onClick={() => disconnectSlackMutation.mutate()}
                        variant="outline"
                        size="sm"
                        className="text-sm text-red-600 border-red-300 hover:bg-red-50 hover:text-red-700"
                        disabled={disconnectSlackMutation.isPending}
                      >
                        {disconnectSlackMutation.isPending ? (
                          <><RefreshCw className="mr-1 h-3 w-3 animate-spin" /> Disconnecting...</>
                        ) : (
                          'Disconnect'
                        )}
                      </Button>
                    </div>
                    <p className="text-xs text-gray-500">
                      If you're having issues with Slack integration, you can reconnect or disconnect it entirely.
                    </p>
                  </div>
                )}
                
                <div className="mt-2 p-3 border rounded-md bg-purple-50 text-purple-800 text-sm">
                  <p className="text-xs">Note: Slack integration requires specific permissions to monitor channels and send notifications.</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
        
        {/* Channel Selection */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <MessageSquare className="w-6 h-6 mr-2" />
              Slack Channel Selection
            </CardTitle>
            <CardDescription>
              Select the channels to monitor for task detection
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!isSlackConnected ? (
              <div className="text-center p-6">
                <p className="text-gray-500 mb-4">You need to connect your Slack account first.</p>
                <Button 
                  onClick={handleConnectSlack}
                  className="bg-[#4A154B] hover:bg-[#4A154B]/90"
                  disabled={!slackAuthData?.url}
                >
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Connect with Slack
                </Button>
              </div>
            ) : isLoadingChannels ? (
              <div className="space-y-4">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : (
              <div className="space-y-4">
                <div className="relative">
                  <Input
                    type="text"
                    placeholder="Search channels..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="mb-4"
                  />
                </div>
                
                <div className="max-h-64 overflow-y-auto border rounded-md p-2">
                  {filteredChannels.length === 0 ? (
                    <div className="text-center p-4 text-gray-500">
                      {searchQuery ? 'No channels match your search' : 'No channels available'}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {filteredChannels.map((channel) => (
                        <div 
                          key={channel.id} 
                          className="flex items-center space-x-2 p-2 hover:bg-gray-50 rounded"
                        >
                          <Checkbox 
                            id={`channel-${channel.id}`}
                            checked={selectedChannels.includes(channel.id)}
                            onCheckedChange={() => handleChannelToggle(channel.id)}
                          />
                          <Label 
                            htmlFor={`channel-${channel.id}`}
                            className="cursor-pointer flex-1"
                          >
                            <span className="flex items-center">
                              <span className="text-gray-900">
                                {channel.is_private ? '🔒 ' : '# '}
                                {channel.name}
                              </span>
                              {!channel.is_member && (
                                <span className="ml-2 text-xs bg-gray-200 px-1 rounded text-gray-700">
                                  Not a member
                                </span>
                              )}
                            </span>
                          </Label>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                
                <div className="flex justify-end">
                  <Button
                    onClick={handleSaveChannelPreferences}
                    disabled={saveChannelPreferencesMutation.isPending}
                  >
                    {saveChannelPreferencesMutation.isPending ? (
                      <><RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Saving...</>
                    ) : (
                      'Save Preferences'
                    )}
                  </Button>
                </div>
                
                <div className="text-xs text-gray-500 mt-2">
                  <p>The system will only monitor selected channels for tasks. Make sure you're a member of the channels you select.</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
        
        {/* Working Hours Configuration */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <BriefcaseIcon className="w-6 h-6 mr-2" />
              Working Hours Configuration
            </CardTitle>
            <CardDescription>
              Set your work schedule for better task scheduling
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingWorkingHours ? (
              <div className="space-y-4">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-8 w-full" />
              </div>
            ) : (
              <div className="space-y-6">
                <Tabs defaultValue="days">
                  <TabsList className="w-full">
                    <TabsTrigger value="days" className="flex-1">Work Days</TabsTrigger>
                    <TabsTrigger value="hours" className="flex-1">Work Hours</TabsTrigger>
                    <TabsTrigger value="focus" className="flex-1">Focus Time</TabsTrigger>
                  </TabsList>
                  
                  <TabsContent value="days" className="space-y-4 pt-4">
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                      <div className="flex items-center space-x-2">
                        <Checkbox 
                          id="monday" 
                          checked={workingHours.monday}
                          onCheckedChange={(checked) => 
                            handleWorkingHoursChange('monday', checked === true)
                          }
                        />
                        <Label htmlFor="monday">Monday</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Checkbox 
                          id="tuesday" 
                          checked={workingHours.tuesday}
                          onCheckedChange={(checked) => 
                            handleWorkingHoursChange('tuesday', checked === true)
                          }
                        />
                        <Label htmlFor="tuesday">Tuesday</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Checkbox 
                          id="wednesday" 
                          checked={workingHours.wednesday}
                          onCheckedChange={(checked) => 
                            handleWorkingHoursChange('wednesday', checked === true)
                          }
                        />
                        <Label htmlFor="wednesday">Wednesday</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Checkbox 
                          id="thursday" 
                          checked={workingHours.thursday}
                          onCheckedChange={(checked) => 
                            handleWorkingHoursChange('thursday', checked === true)
                          }
                        />
                        <Label htmlFor="thursday">Thursday</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Checkbox 
                          id="friday" 
                          checked={workingHours.friday}
                          onCheckedChange={(checked) => 
                            handleWorkingHoursChange('friday', checked === true)
                          }
                        />
                        <Label htmlFor="friday">Friday</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Checkbox 
                          id="saturday" 
                          checked={workingHours.saturday}
                          onCheckedChange={(checked) => 
                            handleWorkingHoursChange('saturday', checked === true)
                          }
                        />
                        <Label htmlFor="saturday">Saturday</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <Checkbox 
                          id="sunday" 
                          checked={workingHours.sunday}
                          onCheckedChange={(checked) => 
                            handleWorkingHoursChange('sunday', checked === true)
                          }
                        />
                        <Label htmlFor="sunday">Sunday</Label>
                      </div>
                    </div>
                  </TabsContent>
                  
                  <TabsContent value="hours" className="space-y-4 pt-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="start-time">Start Time</Label>
                        <Input 
                          type="time" 
                          id="start-time" 
                          value={workingHours.startTime}
                          onChange={(e) => handleWorkingHoursChange('startTime', e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="end-time">End Time</Label>
                        <Input 
                          type="time" 
                          id="end-time" 
                          value={workingHours.endTime}
                          onChange={(e) => handleWorkingHoursChange('endTime', e.target.value)}
                        />
                      </div>
                    </div>
                    
                    <Separator className="my-4" />
                    
                    <div>
                      <h4 className="text-sm font-medium mb-2">Break Time</h4>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="break-start">Break Start</Label>
                          <Input 
                            type="time" 
                            id="break-start" 
                            value={workingHours.breakStartTime}
                            onChange={(e) => handleWorkingHoursChange('breakStartTime', e.target.value)}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="break-end">Break End</Label>
                          <Input 
                            type="time" 
                            id="break-end" 
                            value={workingHours.breakEndTime}
                            onChange={(e) => handleWorkingHoursChange('breakEndTime', e.target.value)}
                          />
                        </div>
                      </div>
                    </div>
                  </TabsContent>
                  
                  <TabsContent value="focus" className="space-y-4 pt-4">
                    <div className="flex items-center space-x-2 pb-2">
                      <Checkbox 
                        id="focus-enabled" 
                        checked={workingHours.focusTimeEnabled}
                        onCheckedChange={(checked) => 
                          handleWorkingHoursChange('focusTimeEnabled', checked === true)
                        }
                      />
                      <Label htmlFor="focus-enabled">Enable Focus Time</Label>
                    </div>
                    
                    {workingHours.focusTimeEnabled && (
                      <>
                        <div className="space-y-2">
                          <Label htmlFor="focus-duration">Focus Time Duration</Label>
                          <Input 
                            type="time" 
                            id="focus-duration" 
                            value={workingHours.focusTimeDuration}
                            onChange={(e) => handleWorkingHoursChange('focusTimeDuration', e.target.value)}
                          />
                        </div>
                        
                        <div className="space-y-2">
                          <Label htmlFor="focus-preference">Preferred Time of Day</Label>
                          <select
                            id="focus-preference"
                            className="w-full rounded-md border border-input bg-background px-3 py-2"
                            value={workingHours.focusTimePreference}
                            onChange={(e) => handleWorkingHoursChange('focusTimePreference', e.target.value)}
                          >
                            <option value="morning">Morning</option>
                            <option value="afternoon">Afternoon</option>
                            <option value="evening">Evening</option>
                          </select>
                        </div>
                      </>
                    )}
                  </TabsContent>
                </Tabs>
                
                <div className="flex justify-end pt-2">
                  <Button
                    onClick={handleSaveWorkingHours}
                    disabled={updateWorkingHoursMutation.isPending}
                  >
                    {updateWorkingHoursMutation.isPending ? (
                      <><RefreshCw className="mr-2 h-4 w-4 animate-spin" /> Saving...</>
                    ) : (
                      'Save Working Hours'
                    )}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}