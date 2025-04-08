import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Home, Calendar, CheckSquare, Settings, Beaker } from "lucide-react";
import { cn } from "@/lib/utils";
import { User } from "@shared/schema";
import { getMe } from "@/lib/api";

export default function Sidebar() {
  const [location] = useLocation();

  // Check integrations status
  const { data: user } = useQuery<User | null>({
    queryKey: ['/api/auth/me'],
    queryFn: async () => {
      try {
        return await getMe();
      } catch (error) {
        console.error('Error fetching user data:', error);
        return null;
      }
    }
  });

  const isSlackConnected = !!user?.slackUserId;
  const isGoogleConnected = !!user?.googleRefreshToken;

  const navigation = [
    {
      name: 'Dashboard',
      href: '/',
      icon: Home,
      current: location === '/'
    },
    {
      name: 'Tasks',
      href: '/tasks',
      icon: CheckSquare,
      current: location === '/tasks'
    },
    {
      name: 'Calendar',
      href: '/calendar',
      icon: Calendar,
      current: location === '/calendar'
    },
    {
      name: 'Settings',
      href: '/settings',
      icon: Settings,
      current: location === '/settings'
    },
    {
      name: 'Task Detection Test',
      href: '/test-task-detection',
      icon: Beaker,
      current: location === '/test-task-detection'
    },
  ];

  return (
    <div className="hidden md:flex md:flex-shrink-0">
      <div className="flex flex-col w-64 bg-[#4A154B]">
        {/* App Logo/Brand */}
        <div className="flex items-center justify-center h-16 px-4 bg-[#4A154B] border-b border-slate-700">
          <h1 className="text-xl font-semibold text-white">TaskFlow</h1>
        </div>
        
        {/* Navigation Links */}
        <div className="flex flex-col flex-grow pt-5 pb-4 overflow-y-auto">
          <nav className="flex-1 px-2 space-y-1">
            {navigation.map((item) => (
              <Link key={item.name} href={item.href}>
                <a
                  className={cn(
                    item.current
                      ? 'bg-[#36C5F0] bg-opacity-25 text-white'
                      : 'text-white hover:bg-[#36C5F0] hover:bg-opacity-25',
                    'group flex items-center px-2 py-2 text-sm font-medium rounded-md'
                  )}
                >
                  <item.icon
                    className="mr-3 h-6 w-6 flex-shrink-0"
                    aria-hidden="true"
                  />
                  {item.name}
                </a>
              </Link>
            ))}
          </nav>
          
          <div className="px-3 py-4 mt-auto">
            {/* Integration Status */}
            <div className="space-y-3">
              <div className="flex items-center">
                <div className={cn(
                  "w-3 h-3 rounded-full mr-2",
                  isSlackConnected ? "bg-[#2EB67D]" : "bg-gray-400"
                )}></div>
                <p className="text-xs text-white">
                  {isSlackConnected ? "Slack connected" : "Slack not connected"}
                </p>
              </div>
              <div className="flex items-center">
                <div className={cn(
                  "w-3 h-3 rounded-full mr-2",
                  isGoogleConnected ? "bg-[#2EB67D]" : "bg-gray-400"
                )}></div>
                <p className="text-xs text-white">
                  {isGoogleConnected ? "Google Calendar connected" : "Google Calendar not connected"}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
