import { createContext, ReactNode, useContext } from "react";
import {
  useQuery,
  useMutation,
  UseMutationResult,
} from "@tanstack/react-query";
import { queryClient } from "../lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { getMe, login, logout, register } from "@/lib/api";

interface User {
  id: number;
  username: string;
  email: string;
  googleRefreshToken: string | null;
  slackUserId: string | null;
  slackWorkspace: string | null;
  slackAccessToken: string | null;
  slackChannelPreferences: string | null;
}

type LoginCredentials = {
  username: string;
  password: string;
};

type RegisterCredentials = {
  username: string;
  password: string;
  email: string;
};

type AuthContextType = {
  user: User | null;
  isLoading: boolean;
  error: Error | null;
  loginMutation: UseMutationResult<User, Error, LoginCredentials>;
  registerMutation: UseMutationResult<User, Error, RegisterCredentials>;
  logoutMutation: UseMutationResult<void, Error, void>;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { toast } = useToast();
  
  const {
    data: user,
    error,
    isLoading,
  } = useQuery<User | null, Error>({
    queryKey: ['/api/auth/me'],
    queryFn: async () => {
      try {
        // Use getMe which now handles auth errors properly
        return await getMe();
      } catch (error) {
        console.error('Error fetching user data:', error);
        return null;
      }
    },
    // Don't retry 401 errors since they are expected when not logged in
    retry: (failureCount, error) => {
      if (error instanceof Error && error.message.includes('Unauthorized')) {
        return false;
      }
      return failureCount < 3;
    },
  });

  const loginMutation = useMutation({
    mutationFn: async (credentials: LoginCredentials) => {
      return await login(credentials.username, credentials.password);
    },
    onSuccess: (user) => {
      queryClient.setQueryData(['/api/auth/me'], user);
      toast({
        title: "Login successful",
        description: "You have been logged in successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Login failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const registerMutation = useMutation({
    mutationFn: async (credentials: RegisterCredentials) => {
      return await register(credentials.username, credentials.password, credentials.email);
    },
    onSuccess: (user) => {
      queryClient.setQueryData(['/api/auth/me'], user);
      toast({
        title: "Registration successful",
        description: "Your account has been created and you are now logged in",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Registration failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await logout();
    },
    onSuccess: () => {
      queryClient.setQueryData(['/api/auth/me'], null);
      toast({
        title: "Logged out",
        description: "You have been logged out successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Logout failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <AuthContext.Provider
      value={{
        user: user ?? null,
        isLoading,
        error,
        loginMutation,
        registerMutation,
        logoutMutation,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}