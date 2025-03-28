import { Switch, Route, Redirect, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/Dashboard";
import Calendar from "@/pages/Calendar";
import Tasks from "@/pages/Tasks";
import Settings from "@/pages/Settings";
import Login from "@/pages/Login";
import Layout from "@/components/Layout";
import { useEffect, useState } from "react";
import { apiRequest } from "./lib/queryClient";

function PrivateRoute({ component: Component, ...rest }: { component: React.ComponentType<any>, path: string }) {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [, setLocation] = useLocation();

  useEffect(() => {
    const checkAuth = async () => {
      try {
        await apiRequest('GET', '/api/auth/me');
        setIsAuthenticated(true);
      } catch (error) {
        setIsAuthenticated(false);
        setLocation('/login');
      }
    };
    
    checkAuth();
  }, [setLocation]);

  if (isAuthenticated === null) {
    // Loading state
    return <div className="flex items-center justify-center h-screen">Loading...</div>;
  }

  return (
    <Route
      {...rest}
      component={(props: any) => 
        isAuthenticated ? (
          <Layout>
            <Component {...props} />
          </Layout>
        ) : (
          <Redirect to="/login" />
        )
      }
    />
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <PrivateRoute path="/" component={Dashboard} />
      <PrivateRoute path="/calendar" component={Calendar} />
      <PrivateRoute path="/tasks" component={Tasks} />
      <PrivateRoute path="/settings" component={Settings} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router />
      <Toaster />
    </QueryClientProvider>
  );
}

export default App;
