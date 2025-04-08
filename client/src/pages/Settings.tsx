import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar, Clock } from "lucide-react";
import TimezoneSelector from "@/components/TimezoneSelector";
import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function Settings() {
  // Fetch user data with minimal error handling
  const { data: user, isLoading: isLoadingUser } = useQuery({
    queryKey: ['/api/auth/me'],
    retry: 1
  });

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
        
        {/* Google Calendar Integration Status */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Calendar className="w-6 h-6 mr-2" />
              Connected Services Status
            </CardTitle>
            <CardDescription>
              View the status of your connected services
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
                  <h3 className="font-medium mb-2">Google Calendar</h3>
                  <div className="flex items-center space-x-2">
                    <div className={`w-3 h-3 rounded-full ${user?.googleRefreshToken ? 'bg-green-500' : 'bg-red-500'}`}></div>
                    <span>{user?.googleRefreshToken ? 'Connected' : 'Not connected'}</span>
                  </div>
                </div>
                
                <div className="p-3 border rounded-md bg-gray-50">
                  <h3 className="font-medium mb-2">Slack</h3>
                  <div className="flex items-center space-x-2">
                    <div className={`w-3 h-3 rounded-full ${user?.slackUserId ? 'bg-green-500' : 'bg-red-500'}`}></div>
                    <span>{user?.slackUserId ? 'Connected' : 'Not connected'}</span>
                  </div>
                  {user?.slackWorkspace && (
                    <div className="mt-2 text-sm text-gray-600">
                      Workspace: {user.slackWorkspace}
                    </div>
                  )}
                </div>
                
                <p className="text-xs text-gray-500 mt-4">
                  To manage service connections, please visit the Dashboard page.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}