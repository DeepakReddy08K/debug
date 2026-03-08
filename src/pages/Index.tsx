import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Bug, LogOut, History, Sun, Moon } from "lucide-react";
import CodeEditorPanel from "@/components/CodeEditorPanel";
import ConfigPanel from "@/components/ConfigPanel";
import RunSingleTestPanel from "@/components/RunSingleTestPanel";
import DiagnosisDisplay from "@/components/DiagnosisDisplay";
import AIChatPanel from "@/components/AIChatPanel";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

const Index = () => {
  const { user, username, signOut } = useAuth();
  const navigate = useNavigate();
  const [buggyCode, setBuggyCode] = useState("");
  const [correctCode, setCorrectCode] = useState("");
  const [additionalInfo, setAdditionalInfo] = useState("");
  const [loading, setLoading] = useState(false);
  const [progressStep, setProgressStep] = useState("");
  const [diagnosis, setDiagnosis] = useState<any>(null);
  const [singleTestLoading, setSingleTestLoading] = useState(false);
  const [currentRunId, setCurrentRunId] = useState<string | undefined>(undefined);
  
  const [isDark, setIsDark] = useState(() => {
    return localStorage.getItem("theme") !== "light";
  });

  const toggleTheme = () => {
    setIsDark((prev) => {
      const next = !prev;
      localStorage.setItem("theme", next ? "dark" : "light");
      if (next) {
        document.documentElement.classList.add("dark");
      } else {
        document.documentElement.classList.remove("dark");
      }
      return next;
    });
  };

  const handleFindFailing = async () => {
    if (!buggyCode.trim()) { toast.error("Please paste your buggy code"); return; }
    if (!correctCode.trim()) { toast.error("Please paste the correct reference code"); return; }

    setLoading(true);
    setDiagnosis(null);

    try {
      setProgressStep("Step 1/5: Analyzing problem structure...");
      const { data: analysisData, error: analysisError } = await supabase.functions.invoke("analyze-problem", { body: { buggyCode, correctCode, additionalInfo } });
      if (analysisError) throw new Error(analysisError.message || "Analysis failed");
      if (analysisData?.error) throw new Error(analysisData.error);
      if (!analysisData?.schema) throw new Error("No analysis result");

      const schema = analysisData.schema;
      const detectedLanguage = schema?.problem_meta?.problem_type || "cpp";

      const { data: runData, error: insertError } = await supabase.from("runs").insert({
        user_id: user!.id, buggy_code: buggyCode, correct_code: correctCode, language: detectedLanguage,
        constraints_json: schema, status: "analyzed", sample_input: additionalInfo || null,
      }).select("id").single();
      if (insertError) console.error("Failed to store run:", insertError);
      const runId = runData?.id;
      if (runId) setCurrentRunId(runId);

      setProgressStep("Step 2/5: Checking for syntax & runtime errors...");
      const { data: syntaxData, error: syntaxError } = await supabase.functions.invoke("check-syntax", { body: { buggyCode, correctCode, language: detectedLanguage } });
      if (syntaxError) throw new Error(syntaxError.message || "Syntax check failed");
      if (syntaxData?.error) throw new Error(syntaxData.error);
      const syntaxResult = syntaxData?.result;

      if (runId && syntaxResult) {
        await supabase.from("runs").update({
          syntax_check: syntaxResult,
          status: syntaxResult.has_errors ? "syntax_errors_found" : "syntax_clean",
        }).eq("id", runId);
      }

      if (syntaxResult?.has_errors) {
        toast.warning(`Found ${syntaxResult.errors?.length || 0} syntax/runtime error(s).`);
        setProgressStep("Step 5/5: AI diagnosing syntax errors...");
        const { data: diagData, error: diagError } = await supabase.functions.invoke("diagnose-bug", { body: { buggyCode, correctCode, language: detectedLanguage, syntaxErrors: syntaxResult, executionResults: null, runId } });
        if (diagError) throw new Error(diagError.message || "Diagnosis failed");
        if (diagData?.error) throw new Error(diagData.error);
        if (!diagData?.diagnosis || !diagData.diagnosis.scenario) {
          setDiagnosis({ scenario: "all_correct", verdict: "Error: AI returned no diagnosis. Please try again.", failing_test: null, issues: [], root_cause: null, improvements: [] });
          setProgressStep("Error — try again.");
          toast.error("AI returned an incomplete result. Please try again.");
          return;
        }
        setDiagnosis(diagData.diagnosis);
        return;
      }

      setProgressStep("Step 3/5: Generating test cases...");
      const { data: testData, error: testError } = await supabase.functions.invoke("generate-test-cases", { body: { schema, runId } });
      if (testError) throw new Error(testError.message || "Test case generation failed");
      if (testData?.error) throw new Error(testData.error);
      const testResult = testData?.result;
      const testCount = testResult?.test_cases?.length || 0;
      if (testCount === 0) { toast.warning("No test cases generated."); setProgressStep("No test cases generated."); return; }

      setProgressStep(`Step 4/5: Executing ${testCount} test cases...`);
      let storedTestCases = testResult.test_cases.map((tc: any) => ({ id: tc.id || null, input: tc.input }));
      if (runId) {
        const { data: dbTestCases } = await supabase.from("test_cases").select("id, input_data").eq("run_id", runId);
        if (dbTestCases && dbTestCases.length > 0) storedTestCases = dbTestCases.map((tc) => ({ id: tc.id, input: tc.input_data }));
      }

      const { data: execData, error: execError } = await supabase.functions.invoke("execute-code", { body: { buggyCode, correctCode, language: detectedLanguage, testCases: storedTestCases, runId } });
      if (execError) throw new Error(execError.message || "Code execution failed");
      if (execData?.retry_branch1) { toast.error(`Execution error: ${execData.message}. Restarting...`); setLoading(false); handleFindFailing(); return; }
      if (execData?.error) throw new Error(execData.error);

      setProgressStep("Step 5/5: AI diagnosing...");
      const { data: diagData, error: diagError } = await supabase.functions.invoke("diagnose-bug", { body: { buggyCode, correctCode, language: detectedLanguage, syntaxErrors: null, executionResults: execData, runId } });
      if (diagError) throw new Error(diagError.message || "Diagnosis failed");
      if (diagData?.error) throw new Error(diagData.error);
      if (!diagData?.diagnosis || !diagData.diagnosis.scenario) {
        setDiagnosis({ scenario: "all_correct", verdict: "Error: AI returned no diagnosis. Please try again.", failing_test: null, issues: [], root_cause: null, improvements: [] });
        setProgressStep("Error — try again.");
        toast.error("AI returned an incomplete result. Please try again.");
        return;
      }
      setDiagnosis(diagData.diagnosis);
      setProgressStep("Diagnosis complete.");
      toast.success("🔍 Diagnosis complete!");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Analysis failed";
      toast.error(message);
      setDiagnosis({ scenario: "syntax_error", verdict: `Error: ${message}. Please try again.`, failing_test: null, issues: [], root_cause: null, improvements: [] });
      setProgressStep("Error — try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleRunSingle = async (testInput: string) => {
    if (!buggyCode.trim()) { toast.error("Please paste your buggy code"); return; }
    if (!correctCode.trim()) { toast.error("Please paste the correct reference code"); return; }
    if (!testInput.trim()) { toast.error("Please enter test input"); return; }

    setSingleTestLoading(true);
    setDiagnosis(null);

    try {
      const testCases = [{ id: null, input: testInput }];
      toast.info("Running your test case...");
      const { data: execData, error: execError } = await supabase.functions.invoke("execute-code", { body: { buggyCode, correctCode, language: "cpp", testCases, runId: null } });
      if (execError) throw new Error(execError.message || "Execution failed");
      if (execData?.error) throw new Error(execData.error);
      if (execData?.retry_branch1) throw new Error(execData.message || "Compilation error. Check your code.");
      const result = execData?.results?.[0];
      if (!result) throw new Error("No result returned. Please try again.");

      const buggyHasError = result.buggy_status && result.buggy_status !== "OK";
      const correctHasError = result.correct_status && result.correct_status !== "OK";

      // Both codes crash → likely invalid/malformed input
      if (buggyHasError && correctHasError) {
        const buggyMsg = result.buggy_stderr || result.buggy_status;
        const correctMsg = result.correct_stderr || result.correct_status;
        setDiagnosis({
          scenario: "syntax_error",
          verdict: "Invalid input: both your code and the correct code crashed on this input. The input format is likely incorrect.",
          failing_test: {
            input: result.input,
            buggy_output: result.buggy_stderr || result.buggy_output || "No output (crashed)",
            correct_output: result.correct_stderr || result.correct_output || "No output (crashed)",
          },
          issues: [
            {
              type: "runtime",
              line: null,
              description: `Both codes received "${result.buggy_status}" — this strongly indicates the test input format doesn't match what the programs expect (e.g., wrong number of values, missing lines, or out-of-range data).`,
              fix: "Check the input format: ensure it matches the problem's expected pattern (number of lines, data types, ranges, delimiters).",
            },
            ...(buggyMsg ? [{
              type: "runtime" as const,
              line: null,
              description: `Your code's error: ${buggyMsg}`,
              fix: "Review the input format against your code's reading logic (scanf/cin/input patterns).",
            }] : []),
            ...(correctMsg && correctMsg !== buggyMsg ? [{
              type: "runtime" as const,
              line: null,
              description: `Correct code's error: ${correctMsg}`,
              fix: "The reference solution also crashed, confirming the input is malformed.",
            }] : []),
          ],
          root_cause: `The input format doesn't match what either program expects. Common causes: wrong number of elements, missing newlines, non-integer data where integers are expected, or values exceeding array bounds. Buggy stderr: "${buggyMsg || 'none'}". Correct stderr: "${correctMsg || 'none'}".`,
          improvements: [],
        });
        toast.error("Invalid input — both codes crashed. Check your input format.");
      } else if (buggyHasError) {
        // Only buggy code crashes — send to AI for detailed diagnosis
        toast.info("Runtime error detected — getting AI diagnosis...");
        const { data: diagData, error: diagError } = await supabase.functions.invoke("diagnose-bug", {
          body: {
            buggyCode, correctCode, language: "cpp",
            syntaxErrors: null,
            executionResults: {
              results: [result],
              summary: {
                total: 1,
                passing: 0,
                failing: 1,
                first_failing: {
                  input: result.input,
                  buggy_output: result.buggy_stderr || result.buggy_output || "No output (crashed)",
                  correct_output: result.correct_output || "N/A",
                  buggy_status: result.buggy_status,
                  buggy_stderr: result.buggy_stderr,
                },
              },
            },
            runId: null,
          },
        });
        if (diagError || diagData?.error || !diagData?.diagnosis?.scenario) {
          setDiagnosis({
            scenario: "syntax_error",
            verdict: `Runtime error: ${result.buggy_status}`,
            failing_test: { input: result.input, buggy_output: result.buggy_stderr || result.buggy_output || "No output", correct_output: result.correct_output || "N/A" },
            issues: [{ type: "runtime", line: null, description: `Your code encountered: ${result.buggy_status}. Stderr: ${result.buggy_stderr || "none"}`, fix: "Check for array out-of-bounds, division by zero, null pointer access, or stack overflow." }],
            root_cause: result.buggy_stderr || result.buggy_status, improvements: [],
          });
        } else {
          setDiagnosis(diagData.diagnosis);
        }
        toast.error(`Runtime error: ${result.buggy_status}`);
      } else if (result.is_failing) {
        setDiagnosis({
          scenario: "logic_bug", verdict: "Your code produces incorrect output for this test case.",
          failing_test: { input: result.input, buggy_output: result.buggy_output, correct_output: result.correct_output },
          issues: [], root_cause: `Buggy output "${result.buggy_output}" differs from expected "${result.correct_output}".`, improvements: [],
        });
        toast.warning("Test failed — outputs differ!");
      } else {
        setDiagnosis({
          scenario: "all_correct", verdict: "Both codes produce the same output for this test case.",
          failing_test: null, issues: [], root_cause: null,
          improvements: [{ type: "edge_case", description: "Try more edge cases to find differences." }],
        });
        toast.success("Test passed — outputs match!");
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Execution failed";
      toast.error(message);
      setDiagnosis({ scenario: "syntax_error", verdict: `Error: ${message}. Please try again.`, failing_test: null, issues: [], root_cause: null, improvements: [] });
    } finally {
      setSingleTestLoading(false);
    }
  };

  return (
    <div className={`flex h-screen flex-col bg-background`}>
      {/* Header */}
      <header className="flex shrink-0 items-center justify-between border-b border-border px-3 sm:px-4 py-2">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary">
            <Bug className="h-3.5 w-3.5 text-primary-foreground" />
          </div>
          <span className="text-base font-bold text-foreground">Debug</span>
          <span className="ml-1 rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">Beta</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground text-xs h-8" onClick={() => navigate("/about")}>
            <span className="hidden sm:inline">About</span>
          </Button>
          <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground text-xs h-8" onClick={() => navigate("/history")}>
            <History className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">History</span>
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={toggleTheme}>
            {isDark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
          </Button>
          <span className="text-xs text-muted-foreground hidden md:inline truncate max-w-[140px] font-medium">@{username || "user"}</span>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={signOut}>
            <LogOut className="h-3.5 w-3.5" />
          </Button>
        </div>
      </header>

      {/* Scrollable main area */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* Row 1: Code Editors */}
        <div className="grid grid-cols-1 md:grid-cols-2 border-b border-border" style={{ height: "clamp(300px, 50vh, 560px)" }}>
          <div className="h-[280px] md:h-full border-b md:border-b-0 md:border-r border-border">
            <CodeEditorPanel label="Your Code (Buggy)" language="cpp" value={buggyCode} onChange={setBuggyCode} />
          </div>
          <div className="h-[280px] md:h-full">
            <CodeEditorPanel label="Correct Code (Reference)" language="cpp" value={correctCode} onChange={setCorrectCode} />
          </div>
        </div>

        {/* Row 2: Config + Run Single Test */}
        <div className="grid grid-cols-1 md:grid-cols-2 border-b border-border md:h-[280px]">
          <div className="border-b md:border-b-0 md:border-r border-border">
            <ConfigPanel
              additionalInfo={additionalInfo}
              onAdditionalInfoChange={setAdditionalInfo}
              onFindFailing={handleFindFailing}
              loading={loading}
              progressStep={progressStep}
            />
          </div>
          <div>
            <RunSingleTestPanel onRunSingle={handleRunSingle} loading={singleTestLoading} />
          </div>
        </div>

        {/* Row 3: Diagnosis */}
        <div className="mt-4">
          <DiagnosisDisplay diagnosis={diagnosis} />
        </div>
      </div>

      {/* AI Chat */}
      <AIChatPanel
        runContext={{
          runId: currentRunId,
          language: "cpp",
          buggyCode,
          correctCode,
          diagnosis,
        }}
      />
    </div>
  );
};

export default Index;
