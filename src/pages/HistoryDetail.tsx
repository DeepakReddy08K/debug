import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import CollapsibleText from "@/components/CollapsibleText";
import DiagnosisDisplay from "@/components/DiagnosisDisplay";
import {
  ArrowLeft,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Code,
  FileText,
  Sun,
  Moon,
} from "lucide-react";
import { format } from "date-fns";

interface TestCase {
  id: string;
  input_data: string;
  output_buggy: string | null;
  output_correct: string | null;
  is_failing: boolean | null;
  created_at: string;
}

interface Run {
  id: string;
  buggy_code: string;
  correct_code: string;
  language: string;
  status: string;
  sample_input: string | null;
  failing_input: string | null;
  output_buggy: string | null;
  output_correct: string | null;
  ai_diagnosis: any;
  syntax_check: any;
  constraints_json: any;
  created_at: string;
}

const statusConfig: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  pending: { label: "Pending", variant: "secondary" },
  analyzed: { label: "Analyzed", variant: "secondary" },
  syntax_errors_found: { label: "Syntax Errors", variant: "destructive" },
  syntax_clean: { label: "Syntax Clean", variant: "default" },
  tests_generated: { label: "Tests Generated", variant: "secondary" },
  failing_found: { label: "Bug Found", variant: "destructive" },
  all_passed: { label: "All Passed", variant: "default" },
  diagnosed: { label: "Diagnosed", variant: "default" },
};

export default function HistoryDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [run, setRun] = useState<Run | null>(null);
  const [testCases, setTestCases] = useState<TestCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDark, setIsDark] = useState(() => localStorage.getItem("theme") !== "light");

  const toggleTheme = () => {
    setIsDark((prev) => {
      const next = !prev;
      localStorage.setItem("theme", next ? "dark" : "light");
      return next;
    });
  };

  useEffect(() => {
    if (!user || !id) return;

    const fetchRun = async () => {
      setLoading(true);
      const [{ data: runData, error: runError }, { data: tcData }] = await Promise.all([
        supabase.from("runs").select("*").eq("id", id).eq("user_id", user.id).single(),
        supabase
          .from("test_cases")
          .select("*")
          .eq("run_id", id)
          .order("created_at", { ascending: true }),
      ]);

      if (runError || !runData) {
        console.error("Failed to fetch run:", runError);
        navigate("/history");
        return;
      }

      setRun(runData as Run);
      setTestCases((tcData || []) as TestCase[]);
      setLoading(false);
    };

    fetchRun();
  }, [user, id, navigate]);

  if (loading) {
    return (
      <div className={`${isDark ? "dark" : ""} min-h-screen bg-background text-foreground flex items-center justify-center`}>
        <Clock className="h-5 w-5 animate-spin mr-2 text-muted-foreground" />
        <span className="text-muted-foreground">Loading…</span>
      </div>
    );
  }

  if (!run) return null;

  const sc = statusConfig[run.status] || { label: run.status, variant: "outline" as const };
  const failingCount = testCases.filter((tc) => tc.is_failing).length;
  const passingCount = testCases.length - failingCount;

  return (
    <div className={`${isDark ? "dark" : ""} min-h-screen bg-background text-foreground`}>
      {/* Header */}
      <header className="border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/history")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-lg font-bold truncate">Run Detail</h1>
              <Badge variant={sc.variant}>{sc.label}</Badge>
              <Badge variant="outline" className="uppercase text-xs">
                {run.language}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {format(new Date(run.created_at), "MMMM d, yyyy · h:mm a")}
              {testCases.length > 0 && ` · ${testCases.length} test cases`}
            </p>
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={toggleTheme}>
            {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        {/* AI Diagnosis Section */}
        {run.ai_diagnosis && (
          <section>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" /> AI Diagnosis
            </h2>
            <div className="rounded-lg border border-border bg-card overflow-hidden">
              <DiagnosisDisplay diagnosis={run.ai_diagnosis as any} />
            </div>
          </section>
        )}

        {/* Code Side by Side */}
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
            <Code className="h-4 w-4" /> Source Code
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-lg border border-border bg-card overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-destructive/5">
                <XCircle className="h-3.5 w-3.5 text-destructive" />
                <span className="text-xs font-semibold text-destructive">Buggy Code</span>
              </div>
              <ScrollArea className="h-72">
                <pre className="p-4 text-xs font-mono whitespace-pre text-foreground leading-relaxed">
                  {run.buggy_code}
                </pre>
              </ScrollArea>
            </div>
            <div className="rounded-lg border border-border bg-card overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-primary/5">
                <CheckCircle className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs font-semibold text-primary">Correct Code</span>
              </div>
              <ScrollArea className="h-72">
                <pre className="p-4 text-xs font-mono whitespace-pre text-foreground leading-relaxed">
                  {run.correct_code}
                </pre>
              </ScrollArea>
            </div>
          </div>
        </section>

        {/* Failing Input & Output */}
        {run.failing_input && (
          <section>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" /> First Failing Test
            </h2>
            <div className="rounded-lg border border-border bg-card p-4 space-y-3">
              <div>
                <span className="text-[10px] font-mono text-muted-foreground uppercase">Input</span>
                <pre className="mt-1 p-3 rounded-md bg-muted/50 border border-border text-xs font-mono whitespace-pre-wrap break-all">
                  <CollapsibleText text={run.failing_input} className="text-xs font-mono" />
                </pre>
                </pre>
              </div>
              {(run.output_buggy || run.output_correct) && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {run.output_buggy !== null && (
                    <div>
                      <span className="text-[10px] font-mono text-destructive uppercase">
                        Your Output
                      </span>
                      <pre className="mt-1 p-3 rounded-md bg-destructive/5 border border-destructive/20 text-xs font-mono whitespace-pre-wrap break-all text-destructive">
                        {run.output_buggy}
                      </pre>
                    </div>
                  )}
                  {run.output_correct !== null && (
                    <div>
                      <span className="text-[10px] font-mono text-primary uppercase">
                        Expected Output
                      </span>
                      <pre className="mt-1 p-3 rounded-md bg-primary/5 border border-primary/20 text-xs font-mono whitespace-pre-wrap break-all text-primary">
                        {run.output_correct}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>
        )}

        {/* Test Cases */}
        {testCases.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
              <FileText className="h-4 w-4" /> Test Cases
              <span className="text-xs font-normal ml-1">
                ({passingCount} passed, {failingCount} failed)
              </span>
            </h2>
            <div className="space-y-2">
              {testCases.map((tc, i) => (
                <div
                  key={tc.id}
                  className={`rounded-lg border p-4 ${
                    tc.is_failing
                      ? "border-destructive/30 bg-destructive/5"
                      : "border-border bg-card"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-bold text-foreground">
                      Test #{i + 1}
                    </span>
                    {tc.is_failing ? (
                      <Badge variant="destructive" className="text-[10px]">
                        FAIL
                      </Badge>
                    ) : (
                      <Badge variant="default" className="text-[10px]">
                        PASS
                      </Badge>
                    )}
                  </div>
                  <div className="space-y-2">
                    <div>
                      <span className="text-[10px] font-mono text-muted-foreground uppercase">
                        Input
                      </span>
                      <div className="mt-0.5 p-2 rounded bg-muted/40 border border-border text-xs font-mono">
                        <CollapsibleText text={tc.input_data} className="text-xs font-mono" />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {tc.output_buggy !== null && (
                        <div>
                          <span className="text-[10px] font-mono text-muted-foreground uppercase">
                            Your Output
                          </span>
                          <pre
                            className={`mt-0.5 p-2 rounded border text-xs font-mono whitespace-pre-wrap break-all ${
                              tc.is_failing
                                ? "bg-destructive/5 border-destructive/20 text-destructive"
                                : "bg-muted/40 border-border"
                            }`}
                          >
                            {tc.output_buggy}
                          </pre>
                        </div>
                      )}
                      {tc.output_correct !== null && (
                        <div>
                          <span className="text-[10px] font-mono text-muted-foreground uppercase">
                            Expected
                          </span>
                          <pre className="mt-0.5 p-2 rounded bg-primary/5 border border-primary/20 text-xs font-mono whitespace-pre-wrap break-all">
                            {tc.output_correct}
                          </pre>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Syntax Check Errors */}
        {run.syntax_check &&
          typeof run.syntax_check === "object" &&
          (run.syntax_check as any).errors?.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                Syntax Check Errors
              </h2>
              <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4 space-y-2">
                {((run.syntax_check as any).errors as any[]).map((err: any, i: number) => (
                  <div key={i} className="text-xs font-mono text-foreground">
                    {err.line && (
                      <span className="text-destructive font-bold">Line {err.line}: </span>
                    )}
                    {err.message || err.description || JSON.stringify(err)}
                  </div>
                ))}
              </div>
            </section>
          )}

        {/* Constraints / Problem Analysis */}
        {run.constraints_json && (
          <section>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              Problem Analysis
            </h2>
            <div className="rounded-lg border border-border bg-card p-4">
              <pre className="text-xs font-mono whitespace-pre-wrap text-muted-foreground">
                {JSON.stringify(run.constraints_json, null, 2)}
              </pre>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
