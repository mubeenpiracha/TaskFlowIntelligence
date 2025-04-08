import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";
import { Loader2 } from "lucide-react";

interface TestResponse {
  success: boolean;
  is_task: boolean;
  analysis: {
    is_task: boolean;
    confidence: number;
    deadline?: string;
    deadline_text?: string;
    urgency?: number;
    importance?: number;
    time_required_minutes?: number;
    task_title?: string;
    task_description?: string;
    reasoning: string;
  };
  message: string;
}

export default function TaskDetectionTest() {
  const { toast } = useToast();
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<TestResponse | null>(null);

  const testTaskDetection = async () => {
    if (!text.trim()) {
      toast({
        title: "Error",
        description: "Please enter some text to test",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      const response = await apiRequest("POST", "/api/slack/test-task-detection", { text });
      const data = await response.json();
      setResult(data);
      
      if (response.ok) {
        toast({
          title: data.is_task ? "Task Detected" : "Not a Task",
          description: data.message,
          variant: data.is_task ? "default" : "destructive",
        });
      } else {
        toast({
          title: "Error",
          description: data.message || "Something went wrong",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Error testing task detection:", error);
      toast({
        title: "Error",
        description: "Failed to test task detection",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container py-8">
      <h1 className="text-3xl font-bold mb-6">Task Detection Testing Tool</h1>
      <p className="text-muted-foreground mb-6">
        Use this tool to test the AI task detection functionality directly. Enter any message to see if it would be detected as a task.
      </p>

      <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Test Input</CardTitle>
            <CardDescription>Enter a message to test if it would be detected as a task</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="text">Message Text</Label>
                <Textarea
                  id="text"
                  placeholder="Enter a message to test task detection, e.g.: @user Please review the document by tomorrow"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={6}
                />
              </div>
            </div>
          </CardContent>
          <CardFooter>
            <Button onClick={testTaskDetection} disabled={loading || !text.trim()}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Testing...
                </>
              ) : (
                "Test Task Detection"
              )}
            </Button>
          </CardFooter>
        </Card>

        {result && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Analysis Result
                <Badge variant={result.is_task ? "default" : "secondary"}>
                  {result.is_task ? "Is a Task" : "Not a Task"}
                </Badge>
              </CardTitle>
              <CardDescription>
                Confidence: {(result.analysis.confidence * 100).toFixed(1)}%
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {result.analysis.task_title && (
                  <div className="space-y-1">
                    <p className="text-sm font-medium">Task Title:</p>
                    <p className="text-sm">{result.analysis.task_title}</p>
                  </div>
                )}

                {result.analysis.deadline && (
                  <div className="space-y-1">
                    <p className="text-sm font-medium">Deadline:</p>
                    <p className="text-sm">
                      {result.analysis.deadline} 
                      {result.analysis.deadline_text && ` (${result.analysis.deadline_text})`}
                    </p>
                  </div>
                )}

                {result.analysis.urgency && (
                  <div className="space-y-1">
                    <p className="text-sm font-medium">Urgency:</p>
                    <p className="text-sm">{result.analysis.urgency}/5</p>
                  </div>
                )}

                {result.analysis.importance && (
                  <div className="space-y-1">
                    <p className="text-sm font-medium">Importance:</p>
                    <p className="text-sm">{result.analysis.importance}/5</p>
                  </div>
                )}

                {result.analysis.time_required_minutes && (
                  <div className="space-y-1">
                    <p className="text-sm font-medium">Time Required:</p>
                    <p className="text-sm">{result.analysis.time_required_minutes} minutes</p>
                  </div>
                )}

                <div className="space-y-1">
                  <p className="text-sm font-medium">Reasoning:</p>
                  <p className="text-sm whitespace-pre-wrap">{result.analysis.reasoning}</p>
                </div>
              </div>
            </CardContent>
            <CardFooter>
              <p className="text-xs text-muted-foreground">{result.message}</p>
            </CardFooter>
          </Card>
        )}
      </div>
    </div>
  );
}