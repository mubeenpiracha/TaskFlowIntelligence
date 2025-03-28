import { useState } from "react";
import { Menu, Search, Bell } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";

export default function Header() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");

  const { data: user } = useQuery({
    queryKey: ['/api/auth/me'],
  });

  const handleLogout = async () => {
    try {
      await apiRequest('POST', '/api/auth/logout');
      toast({
        title: "Logged out successfully",
      });
      setLocation('/login');
    } catch (error) {
      toast({
        title: "Logout failed",
        description: "There was an error logging out",
        variant: "destructive",
      });
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    // Implement search functionality
    toast({
      title: "Search",
      description: `Searching for "${searchQuery}"`,
    });
  };

  const userInitials = user?.username 
    ? user.username.split(' ').map(n => n[0]).join('').toUpperCase()
    : '?';

  return (
    <div className="relative z-10 flex-shrink-0 flex h-16 bg-white shadow">
      <button
        type="button"
        className="px-4 border-r border-gray-200 text-gray-500 focus:outline-none focus:bg-gray-100 focus:text-gray-600 md:hidden"
      >
        <Menu className="h-6 w-6" />
      </button>
      
      {/* Search Bar */}
      <div className="flex-1 px-4 flex justify-between">
        <div className="flex-1 flex">
          <form onSubmit={handleSearch} className="w-full flex md:ml-0">
            <label htmlFor="search-field" className="sr-only">
              Search
            </label>
            <div className="relative w-full text-gray-400 focus-within:text-gray-600">
              <div className="absolute inset-y-0 left-0 flex items-center pointer-events-none">
                <Search className="h-5 w-5" />
              </div>
              <Input 
                id="search-field"
                className="block w-full h-full pl-8 pr-3 py-2 border-transparent text-gray-900 placeholder-gray-500 focus:outline-none focus:ring-0 focus:border-transparent sm:text-sm"
                placeholder="Search tasks..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </form>
        </div>
        
        {/* Profile Dropdown */}
        <div className="ml-4 flex items-center md:ml-6">
          {/* Notifications */}
          <Button variant="ghost" size="icon" className="p-1 text-gray-400 rounded-full">
            <span className="sr-only">View notifications</span>
            <Bell className="h-6 w-6" />
          </Button>

          {/* Profile */}
          <div className="ml-3 relative">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="max-w-xs rounded-full flex items-center text-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#36C5F0]">
                  <span className="sr-only">Open user menu</span>
                  <Avatar>
                    <AvatarImage src="" alt={user?.username || 'User'} />
                    <AvatarFallback>{userInitials}</AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>{user?.username}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setLocation('/settings')}>Settings</DropdownMenuItem>
                <DropdownMenuItem onClick={handleLogout}>Logout</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </div>
  );
}
