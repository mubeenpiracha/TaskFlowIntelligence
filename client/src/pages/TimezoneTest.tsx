import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import TimezoneSelector from '@/components/TimezoneSelector';
import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

/**
 * A testing page to verify our timezone handling fixes
 */
export default function TimezoneTest() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [timezone, setTimezone] = useState<string>(user?.timezone || 'UTC');
  const [loading, setLoading] = useState(false);
  const [testResult, setTestResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const runTest = async () => {
    setLoading(true);
    setError(null);
    setTestResult(null);

    try {
      const response = await fetch('/api/test/timezone-fix', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ timezone }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'An error occurred during the test');
      }

      setTestResult(data.results);
      toast({
        title: 'Test completed',
        description: 'Timezone handling test completed successfully',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred during the test');
      toast({
        title: 'Test failed',
        description: err instanceof Error ? err.message : 'An error occurred during the test',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const canRunTest = !!user?.googleRefreshToken;

  return (
    <div className="container mx-auto py-6 space-y-6">
      <h1 className="text-2xl font-bold">Timezone Handling Test</h1>
      <p className="text-slate-500 dark:text-slate-400">
        This page lets you test if timezone handling is working correctly in the application.
        It will create an event in your Google Calendar and verify that the times are correctly preserved.
      </p>

      <Card>
        <CardHeader>
          <CardTitle>Test Configuration</CardTitle>
          <CardDescription>
            Select a timezone to use for the test. This will override your default timezone for this test only.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="grid w-full items-center gap-1.5">
              <label htmlFor="timezone">Timezone for Test</label>
              <TimezoneSelector value={timezone} onChange={setTimezone} />
            </div>
          </div>
        </CardContent>
        <CardFooter>
          <Button 
            onClick={runTest} 
            disabled={loading || !canRunTest}
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Running Test...
              </>
            ) : (
              'Run Timezone Test'
            )}
          </Button>
          {!canRunTest && (
            <p className="ml-4 text-sm text-red-500">
              You must connect Google Calendar to run this test
            </p>
          )}
        </CardFooter>
      </Card>

      {error && (
        <Card className="border-red-500">
          <CardHeader>
            <CardTitle className="text-red-500">Test Failed</CardTitle>
          </CardHeader>
          <CardContent>
            <p>{error}</p>
          </CardContent>
        </Card>
      )}

      {testResult && (
        <Card>
          <CardHeader>
            <CardTitle>Test Results</CardTitle>
            <CardDescription>
              {testResult.success ? 'Test completed successfully' : 'Test failed'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <h3 className="font-medium">Test Information</h3>
                <ul className="list-disc list-inside mt-2">
                  <li>Timezone: {testResult.timezone}</li>
                  <li>Local Time: {testResult.localTime}</li>
                  <li>UTC Time: {testResult.testTime}</li>
                </ul>
              </div>
              
              {testResult.event && (
                <div>
                  <h3 className="font-medium">Event Details</h3>
                  <ul className="list-disc list-inside mt-2">
                    <li>Event ID: {testResult.event.id}</li>
                    {testResult.event.start?.dateTime && (
                      <li>Start Time: {testResult.event.start.dateTime}</li>
                    )}
                    {testResult.event.start?.timeZone && (
                      <li>Start Timezone: {testResult.event.start.timeZone}</li>
                    )}
                    {testResult.event.end?.dateTime && (
                      <li>End Time: {testResult.event.end.dateTime}</li>
                    )}
                    {testResult.event.end?.timeZone && (
                      <li>End Timezone: {testResult.event.end.timeZone}</li>
                    )}
                  </ul>
                  
                  {testResult.event.htmlLink && (
                    <div className="mt-4">
                      <a 
                        href={testResult.event.htmlLink} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="text-blue-500 hover:underline"
                      >
                        View Event in Google Calendar
                      </a>
                    </div>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}