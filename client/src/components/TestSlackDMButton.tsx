import { useState } from "react";
import { Button } from "@/components/ui/button";
import { testSlackDM } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { MessageSquare, Loader2 } from "lucide-react";

export default function TestSlackDMButton() {
  const [isTesting, setIsTesting] = useState(false);
  const { toast } = useToast();

  const handleTestDM = async () => {
    setIsTesting(true);
    
    try {
      const result = await testSlackDM();
      
      if (result.success) {
        toast({
          title: "Test message sent",
          description: "Check your Slack DMs to see if you received a test message.",
          variant: "default",
        });
      } else {
        toast({
          title: "Failed to send test message",
          description: result.message || "There was an error sending a DM to your Slack account.",
          variant: "destructive",
        });
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "An unexpected error occurred while testing Slack DMs.",
        variant: "destructive",
      });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <Button 
      onClick={handleTestDM}
      variant="outline"
      size="sm"
      className="bg-[#4A154B]/10 border-[#4A154B]/30 text-[#4A154B] hover:bg-[#4A154B]/20"
      disabled={isTesting}
    >
      {isTesting ? (
        <>
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          Testing...
        </>
      ) : (
        <>
          <MessageSquare className="mr-2 h-4 w-4" />
          Test Slack DM
        </>
      )}
    </Button>
  );
}