import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { getGoogleLoginUrl } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";

export default function Login() {
  const [, setLocation] = useLocation();
  const [searchParams] = useLocation();
  const { toast } = useToast();
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { user, loginMutation, registerMutation } = useAuth();
  
  // Redirect if already logged in
  useEffect(() => {
    if (user) {
      setLocation('/');
    }
  }, [user, setLocation]);

  // Check for error in URL
  useEffect(() => {
    if (searchParams.includes('error=profile_fetch_failed')) {
      setErrorMessage('Failed to fetch your Google profile. Please try again.');
    } else if (searchParams.includes('error=auth_failed')) {
      setErrorMessage('Google authentication failed. Please try again.');
    } else if (searchParams.includes('error=no_email')) {
      setErrorMessage('No email address found in your Google account. Email is required.');
    } else if (searchParams.includes('error=google_auth_failed')) {
      setErrorMessage('Google authentication failed. Please try again.');
    }
  }, [searchParams]);

  // Fetch Google login URL
  const { data: googleLoginData } = useQuery({
    queryKey: ['/api/auth/google/login/url'],
    queryFn: async () => {
      try {
        return await getGoogleLoginUrl();
      } catch (error) {
        console.error("Error fetching Google login URL:", error);
        return { url: "" };
      }
    }
  });

  // Login form state
  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  // Register form state
  const [registerUsername, setRegisterUsername] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [registerEmail, setRegisterEmail] = useState("");

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    
    loginMutation.mutate({
      username: loginUsername,
      password: loginPassword
    });
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    
    registerMutation.mutate({
      username: registerUsername,
      password: registerPassword,
      email: registerEmail
    });
  };
  
  const handleGoogleLogin = () => {
    // Check if googleLoginData exists and has a url property
    if (googleLoginData && typeof googleLoginData === 'object' && 'url' in googleLoginData) {
      setIsGoogleLoading(true);
      window.location.href = googleLoginData.url;
    } else {
      toast({
        title: "Error",
        description: "Could not connect to Google. Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="w-full max-w-md p-4">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-[#4A154B]">TaskFlow</h1>
          <p className="text-gray-600 mt-2">Slack-integrated task management</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Welcome</CardTitle>
            <CardDescription>
              Sign in to manage your tasks or create a new account
            </CardDescription>
          </CardHeader>
          <CardContent>
            {errorMessage && (
              <Alert variant="destructive" className="mb-4">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>
                  {errorMessage}

                </AlertDescription>
              </Alert>
            )}
            <Tabs defaultValue="login" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="login">Login</TabsTrigger>
                <TabsTrigger value="register">Register</TabsTrigger>
              </TabsList>

              <TabsContent value="login">
                <form onSubmit={handleLogin} className="space-y-4 mt-4">
                  <div className="space-y-2">
                    <Label htmlFor="login-username">Username</Label>
                    <Input 
                      id="login-username"
                      type="text"
                      placeholder="your_username"
                      value={loginUsername}
                      onChange={(e) => setLoginUsername(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="login-password">Password</Label>
                    <Input 
                      id="login-password"
                      type="password"
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      required
                    />
                  </div>
                  <Button 
                    type="submit" 
                    className="w-full bg-[#4A154B] hover:bg-[#4A154B]/90"
                    disabled={loginMutation.isPending}
                  >
                    {loginMutation.isPending ? "Logging in..." : "Login"}
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="register">
                <form onSubmit={handleRegister} className="space-y-4 mt-4">
                  <div className="space-y-2">
                    <Label htmlFor="register-username">Username</Label>
                    <Input 
                      id="register-username"
                      type="text"
                      placeholder="your_username"
                      value={registerUsername}
                      onChange={(e) => setRegisterUsername(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="register-email">Email</Label>
                    <Input 
                      id="register-email"
                      type="email"
                      placeholder="you@example.com"
                      value={registerEmail}
                      onChange={(e) => setRegisterEmail(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="register-password">Password</Label>
                    <Input 
                      id="register-password"
                      type="password"
                      value={registerPassword}
                      onChange={(e) => setRegisterPassword(e.target.value)}
                      required
                    />
                  </div>
                  <Button 
                    type="submit" 
                    className="w-full bg-[#36C5F0] hover:bg-[#36C5F0]/90"
                    disabled={registerMutation.isPending}
                  >
                    {registerMutation.isPending ? "Creating account..." : "Register"}
                  </Button>
                </form>
              </TabsContent>
            </Tabs>
          </CardContent>
          <CardFooter className="flex flex-col space-y-4">
            <div className="w-full">
              <Separator className="my-4" />
              <div className="text-center mb-2 text-sm text-gray-500">
                Or continue with
              </div>
              <Button 
                type="button"
                variant="outline" 
                className="w-full"
                onClick={handleGoogleLogin}
                disabled={isGoogleLoading || !(googleLoginData && typeof googleLoginData === 'object' && 'url' in googleLoginData)}
              >
                <svg className="mr-2 h-5 w-5" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                </svg>
                {isGoogleLoading ? "Connecting to Google..." : "Sign in with Google"}
              </Button>
            </div>
            <div className="text-xs text-center text-gray-500 mt-4">
              TaskFlow helps you manage tasks from Slack and schedule them in your calendar.
            </div>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
