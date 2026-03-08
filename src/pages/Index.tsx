import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Bug, LogOut, History } from "lucide-react";
import CodeEditorPanel from "@/components/CodeEditorPanel";
import ConfigPanel from "@/components/ConfigPanel";
import DiagnosisDisplay from "@/components/DiagnosisDisplay";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

const Index = () => {
  const { user, signOut } = useAuth();
  const [buggyCode, setBuggyCode] = useState("");
  const [correctCode, setCorrectCode] = useState("");
  const [additionalInfo, setAdditionalInfo] = useState("");
  const [loading, setLoading] = useState(false);
  const [progressStep, setProgressStep] = useState("");
  const [diagnosis, setDiagnosis] = useState<any>(null);
  const [singleTestLoading, setSingleTestLoading] = useState(false);

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
    setDiagnosis(null);

    try {
      setProgressStep("Step 1/5: Analyzing problem structure...");
      toast.info("Step 1/5: Analyzing problem structure...");

      const { data: analysisData, error: analysisError } = await supabase.functions.invoke(
        "analyze-problem",
        { body: { buggyCode, correctCode, additionalInfo } }
      );

      if (analysisError) throw new Error(analysisError.message || "Analysis failed");
      if (analysisData?.error) throw new Error(analysisData.error);
      if (!analysisData?.schema) throw new Error("No analysis result");

      const schema = analysisData.schema;
      const detectedLanguage = schema?.problem_meta?.problem_type || "cpp";

      const { data: runData, error: insertError } = await supabase
        .from("runs")
        .insert({
          user_id: user!.id,
          buggy_code: buggyCode,
          correct_code: correctCode,
          language: detectedLanguage,
          constraints_json: schema,
          status: "analyzed",
          sample_input: additionalInfo || null,
        })
        .select("id")
        .single();

      if (insertError) console.error("Failed to store run:", insertError);
      const runId = runData?.id;

      setProgressStep("Step 2/5: Checking for syntax & runtime errors...");
      toast.info("Step 2/5: Checking for syntax & runtime errors...");

      const { data: syntaxData, error: syntaxError } = await supabase.functions.invoke(
        "check-syntax",
        { body: { buggyCode, correctCode, language: detectedLanguage } }
      );

      if (syntaxError) throw new Error(syntaxError.message || "Syntax check failed");
      if (syntaxData?.error) throw new Error(syntaxData.error);

      const syntaxResult = syntaxData?.result;

      if (runId && syntaxResult) {
        await supabase.from("runs").update({
          ai_diagnosis: JSON.stringify(syntaxResult),
          status: syntaxResult.has_errors ? "syntax_errors_found" : "syntax_clean",
        }).eq("id", runId);
      }

      if (syntaxResult?.has_errors) {
        toast.warning(`Found ${syntaxResult.errors?.length || 0} syntax/runtime error(s).`);
        setProgressStep("Step 5/5: AI diagnosing syntax errors...");

        const { data: diagData, error: diagError } = await supabase.functions.invoke(
          "diagnose-bug",
          { body: { buggyCode, correctCode, language: detectedLanguage, syntaxErrors: syntaxResult, executionResults: null, runId } }
        );

        if (diagError) throw new Error(diagError.message || "Diagnosis failed");
        if (diagData?.error) throw new Error(diagData.error);

        setDiagnosis(diagData.diagnosis);
        setProgressStep("Diagnosis complete.");
        toast.success("🔍 Diagnosis complete!");
        return;
      }

      setProgressStep("Step 3/5: Generating test cases...");
      toast.info("Step 3/5: Generating test cases...");

      const { data: testData, error: testError } = await supabase.functions.invoke(
        "generate-test-cases",
        { body: { schema, runId } }
      );

      if (testError) throw new Error(testError.message || "Test case generation failed");
      if (testData?.error) throw new Error(testData.error);

      const testResult = testData?.result;
      const testCount = testResult?.test_cases?.length || 0;

      if (testCount === 0) {
        toast.warning("No test cases generated.");
        setProgressStep("No test cases generated.");
        return;
      }

      setProgressStep(`Step 4/5: Executing ${testCount} test cases...`);
      toast.info(`Step 4/5: Running ${testCount} test cases...`);

      let storedTestCases = testResult.test_cases.map((tc: any) => ({ id: tc.id || null, input: tc.input }));

      if (runId) {
        const { data: dbTestCases } = await supabase.from("test_cases").select("id, input_data").eq("run_id", runId);
        if (dbTestCases && dbTestCases.length > 0) {
          storedTestCases = dbTestCases.map((tc) => ({ id: tc.id, input: tc.input_data }));
        }
      }

      const { data: execData, error: execError } = await supabase.functions.invoke(
        "execute-code",
        { body: { buggyCode, correctCode, language: detectedLanguage, testCases: storedTestCases, runId } }
      );

      if (execError) throw new Error(execError.message || "Code execution failed");

      if (execData?.retry_branch1) {
        toast.error(`Execution error: ${execData.message}. Restarting...`);
        setLoading(false);
        handleFindFailing();
        return;
      }

      if (execData?.error) throw new Error(execData.error);

      setProgressStep("Step 5/5: AI diagnosing...");
      toast.info("Step 5/5: AI analyzing results...");

      const { data: diagData, error: diagError } = await supabase.functions.invoke(
        "diagnose-bug",
        { body: { buggyCode, correctCode, language: detectedLanguage, syntaxErrors: null, executionResults: execData, runId } }
      );

      if (diagError) throw new Error(diagError.message || "Diagnosis failed");
      if (diagData?.error) throw new Error(diagData.error);

      setDiagnosis(diagData.diagnosis);
      setProgressStep("Diagnosis complete.");
      toast.success("🔍 Diagnosis complete!");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Analysis failed";
      toast.error(message);
      setProgressStep("");
    } finally {
      setLoading(false);
    }
  };

  const handleRunSingle = async (testInput: string) => {
    if (!buggyCode.trim()) {
      toast.error("Please paste your buggy code");
      return;
    }
    if (!correctCode.trim()) {
      toast.error("Please paste the correct reference code");
      return;
    }
    if (!testInput.trim()) {
      toast.error("Please enter test input");
      return;
    }

    setSingleTestLoading(true);
    setDiagnosis(null);

    try {
      // Detect language quickly via analyze-problem or default to cpp
      const detectedLanguage = "cpp";

      const testCases = [{ id: null, input: testInput }];

      toast.info("Running your test case...");

      const { data: execData, error: execError } = await supabase.functions.invoke(
        "execute-code",
        { body: { buggyCode, correctCode, language: detectedLanguage, testCases, runId: null } }
      );

      if (execError) throw new Error(execError.message || "Execution failed");
      if (execData?.error) throw new Error(execData.error);

      const result = execData?.results?.[0];
      if (!result) throw new Error("No result returned");

      if (result.is_failing) {
        setDiagnosis({
          scenario: "logic_bug",
          verdict: "Your code produces incorrect output for this test case.",
          failing_test: {
            input: result.input,
            buggy_output: result.buggy_output,
            correct_output: result.correct_output,
          },
          issues: [],
          root_cause: `Buggy output "${result.buggy_output}" differs from expected "${result.correct_output}" for the given input.`,
          improvements: [],
        });
        toast.warning("Test failed — outputs differ!");
      } else {
        setDiagnosis({
          scenario: "all_correct",
          verdict: "Both codes produce the same output for this test case.",
          failing_test: null,
          issues: [],
          root_cause: null,
          improvements: [
            { type: "edge_case", description: "Try more edge cases to find differences." },
          ],
        });
        toast.success("Test passed — outputs match!");
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Execution failed";
      toast.error(message);
    } finally {
      setSingleTestLoading(false);
    }
  };

  return (
    <div className="dark flex h-screen flex-col bg-background">
      {/* Header */}
      <header className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary">
            <Bug className="h-3.5 w-3.5 text-primary-foreground" />
          </div>
          <span className="text-base font-bold text-foreground">Debug</span>
          <span className="ml-1 rounded bg-secondary px-2 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
            Beta
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground text-xs">
            <History className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">History</span>
          </Button>
          <span className="text-xs text-muted-foreground hidden md:inline">{user?.email}</span>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={signOut}>
            <LogOut className="h-3.5 w-3.5" />
          </Button>
        </div>
      </header>

      {/* Main content - scrollable on mobile, grid on desktop */}
      <div className="flex-1 min-h-0 overflow-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 lg:gap-0 h-full lg:grid-rows-2">
          {/* Editor 1: Buggy Code */}
          <div className="h-[50vh] lg:h-full border-b lg:border-b-0 lg:border-r border-border">
            <CodeEditorPanel
              label="Your Code (Buggy)"
              language="cpp"
              value={buggyCode}
              onChange={setBuggyCode}
            />
          </div>

          {/* Editor 2: Correct Code */}
          <div className="h-[50vh] lg:h-full border-b border-border">
            <CodeEditorPanel
              label="Correct Code (Reference)"
              language="cpp"
              value={correctCode}
              onChange={setCorrectCode}
            />
          </div>

          {/* Config Panel */}
          <div className="min-h-[300px] lg:h-full border-b lg:border-b-0 lg:border-r border-border">
            <ConfigPanel
              additionalInfo={additionalInfo}
              onAdditionalInfoChange={setAdditionalInfo}
              onFindFailing={handleFindFailing}
              onRunSingle={handleRunSingle}
              loading={loading}
              singleTestLoading={singleTestLoading}
              progressStep={progressStep}
            />
          </div>

          {/* Diagnosis Panel */}
          <div className="min-h-[300px] lg:h-full">
            <DiagnosisDisplay diagnosis={diagnosis} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default Index;
