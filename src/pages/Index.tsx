import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Bug, LogOut, History } from "lucide-react";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import CodeEditorPanel from "@/components/CodeEditorPanel";
import ConfigPanel from "@/components/ConfigPanel";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

const Index = () => {
  const { user, signOut } = useAuth();
  const [buggyCode, setBuggyCode] = useState("");
  const [correctCode, setCorrectCode] = useState("");
  const [additionalInfo, setAdditionalInfo] = useState("");
  const [loading, setLoading] = useState(false);

  const handleFindFailing = async () => {
    if (!buggyCode.trim()) {
      toast.error("Please paste your buggy code");
      return;
    }
    if (!correctCode.trim()) {
      toast.error("Please paste the correct reference code");
      return;
    }

    setLoading(true);

    try {
      // Branch 1: Analyze problem and get JSON schema
      toast.info("Step 1/3: Analyzing problem structure...");
      const { data: analysisData, error: analysisError } = await supabase.functions.invoke(
        "analyze-problem",
        {
          body: { buggyCode, correctCode, additionalInfo },
        }
      );

      if (analysisError) throw new Error(analysisError.message || "Analysis failed");
      if (analysisData?.error) throw new Error(analysisData.error);
      if (!analysisData?.schema) throw new Error("No analysis result");

      const schema = analysisData.schema;
      const detectedLanguage = schema?.problem_meta?.problem_type || "cpp";

      // Store the run + JSON schema in database
      const { error: insertError } = await supabase.from("runs").insert({
        user_id: user!.id,
        buggy_code: buggyCode,
        correct_code: correctCode,
        language: detectedLanguage,
        constraints_json: schema,
        status: "analyzed",
        sample_input: additionalInfo || null,
      });

      if (insertError) {
        console.error("Failed to store run:", insertError);
        // Non-blocking — continue even if DB insert fails
      }

      toast.success("Problem analyzed! Branches 2 & 3 coming next.");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Analysis failed";
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const handleRunSingle = () => {
    toast.info("Single test run coming soon!");
  };

  return (
    <div className="dark flex h-screen flex-col bg-background">
      <header className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary">
            <Bug className="h-3.5 w-3.5 text-primary-foreground" />
          </div>
          <span className="text-base font-bold text-foreground">Debug</span>
          <span className="ml-2 rounded bg-secondary px-2 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
            Beta
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground text-xs">
            <History className="h-3.5 w-3.5" />
            History
          </Button>
          <span className="text-xs text-muted-foreground hidden sm:inline">{user?.email}</span>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={signOut}>
            <LogOut className="h-3.5 w-3.5" />
          </Button>
        </div>
      </header>

      <div className="flex-1 min-h-0">
        <ResizablePanelGroup direction="horizontal">
          <ResizablePanel defaultSize={35} minSize={20}>
            <CodeEditorPanel
              label="Your Code (Buggy)"
              language="cpp"
              value={buggyCode}
              onChange={setBuggyCode}
            />
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel defaultSize={35} minSize={20}>
            <CodeEditorPanel
              label="Correct Code (Reference)"
              language="cpp"
              value={correctCode}
              onChange={setCorrectCode}
            />
          </ResizablePanel>

          <ResizableHandle withHandle />

          <ResizablePanel defaultSize={30} minSize={20}>
            <ConfigPanel
              additionalInfo={additionalInfo}
              onAdditionalInfoChange={setAdditionalInfo}
              onFindFailing={handleFindFailing}
              onRunSingle={handleRunSingle}
              loading={loading}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
};

export default Index;
