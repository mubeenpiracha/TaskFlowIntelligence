import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { User } from '@shared/schema';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from './queryClient';

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string, email: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  // Check if user is logged in on first render
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const res = await apiRequest('GET', '/api/auth/me');
        const userData = await res.json();
        setUser(userData);
      } catch (error) {
        setUser(null);
      } finally {
        setIsLoading(false);
      }
    };

    checkAuth();
  }, []);

  const login = async (username: string, password: string) => {
    try {
      const res = await apiRequest('POST', '/api/auth/login', { username, password });
      const userData = await res.json();
      setUser(userData);
      toast({
        title: 'Logged in successfully',
        description: `Welcome back, ${userData.username}!`,
      });
    } catch (error) {
      toast({
        title: 'Login failed',
        description: error instanceof Error ? error.message : 'Invalid credentials',
        variant: 'destructive',
      });
      throw error;
    }
  };

  const register = async (username: string, password: string, email: string) => {
    try {
      const res = await apiRequest('POST', '/api/auth/register', { username, password, email });
      const userData = await res.json();
      setUser(userData);
      toast({
        title: 'Registration successful',
        description: `Welcome, ${userData.username}!`,
      });
    } catch (error) {
      toast({
        title: 'Registration failed',
        description: error instanceof Error ? error.message : 'Could not create account',
        variant: 'destructive',
      });
      throw error;
    }
  };

  const logout = async () => {
    try {
      await apiRequest('POST', '/api/auth/logout');
      setUser(null);
      toast({
        title: 'Logged out successfully',
      });
    } catch (error) {
      toast({
        title: 'Logout failed',
        description: error instanceof Error ? error.message : 'Could not log out',
        variant: 'destructive',
      });
      throw error;
    }
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
