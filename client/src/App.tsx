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
import TaskDetectionTest from "@/pages/TaskDetectionTest";
import TimezoneTest from "@/pages/TimezoneTest";
import Layout from "@/components/Layout";
import { useEffect, useState } from "react";
import { apiRequest } from "./lib/queryClient";
import { AuthProvider, useAuth } from "@/hooks/use-auth";

function PrivateRoute({ component: Component, ...rest }: { component: React.ComponentType<any>, path: string }) {
  const { user, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && !user) {
      setLocation('/login');
    }
  }, [user, isLoading, setLocation]);

  if (isLoading) {
    return <div className="flex items-center justify-center h-screen">Loading...</div>;
  }

  return (
    <Route
      {...rest}
      component={(props: any) => 
        user ? (
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
      <PrivateRoute path="/test-task-detection" component={TaskDetectionTest} />
      <PrivateRoute path="/test-timezone" component={TimezoneTest} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Router />
        <Toaster />
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
