import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ArrowLeft, ChevronDown, ChevronRight, Clock, Code, AlertTriangle, CheckCircle, XCircle, Sun, Moon } from "lucide-react";
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
  test_cases: TestCase[];
}

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  pending: { label: "Pending", variant: "secondary" },
  analyzed: { label: "Analyzed", variant: "secondary" },
  syntax_errors_found: { label: "Syntax Errors", variant: "destructive" },
  syntax_clean: { label: "Syntax Clean", variant: "default" },
  tests_generated: { label: "Tests Generated", variant: "secondary" },
  failing_found: { label: "Bug Found", variant: "destructive" },
  all_passed: { label: "All Passed", variant: "default" },
  diagnosed: { label: "Diagnosed", variant: "default" },
};

export default function History() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;

    const fetchHistory = async () => {
      setLoading(true);
      const threeMonthsAgo = new Date();
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

      const { data: runsData, error } = await supabase
        .from("runs")
        .select("*")
        .eq("user_id", user.id)
        .gte("created_at", threeMonthsAgo.toISOString())
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Failed to fetch runs:", error);
        setLoading(false);
        return;
      }

      // Fetch test cases for all runs
      const runIds = (runsData || []).map((r) => r.id);
      let testCasesMap: Record<string, TestCase[]> = {};

      if (runIds.length > 0) {
        const { data: tcData } = await supabase
          .from("test_cases")
          .select("*")
          .in("run_id", runIds)
          .order("created_at", { ascending: true });

        (tcData || []).forEach((tc) => {
          if (!testCasesMap[tc.run_id]) testCasesMap[tc.run_id] = [];
          testCasesMap[tc.run_id].push(tc as TestCase);
        });
      }

      setRuns(
        (runsData || []).map((r) => ({
          ...r,
          test_cases: testCasesMap[r.id] || [],
        })) as Run[]
      );
      setLoading(false);
    };

    fetchHistory();
  }, [user]);

  const getVerdict = (run: Run): string => {
    if (run.ai_diagnosis && typeof run.ai_diagnosis === "object") {
      const d = run.ai_diagnosis as any;
      return d.verdict || d.scenario || "—";
    }
    return "—";
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-xl font-bold">Run History</h1>
          <span className="text-sm text-muted-foreground ml-auto">
            Last 3 months · {runs.length} runs
          </span>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Clock className="h-5 w-5 animate-spin mr-2" /> Loading history…
          </div>
        ) : runs.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center text-muted-foreground">
              No runs found in the last 3 months.
            </CardContent>
          </Card>
        ) : (
          runs.map((run) => {
            const isExpanded = expandedRun === run.id;
            const sc = statusConfig[run.status] || { label: run.status, variant: "outline" as const };

            return (
              <Collapsible key={run.id} open={isExpanded} onOpenChange={() => setExpandedRun(isExpanded ? null : run.id)}>
                <Card className="overflow-hidden transition-shadow hover:shadow-md">
                  <CollapsibleTrigger asChild>
                    <CardHeader className="cursor-pointer py-3 px-4">
                      <div className="flex items-center gap-3">
                        {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <CardTitle className="text-sm font-mono truncate max-w-[300px]">
                              {run.buggy_code.split("\n")[0].slice(0, 60)}
                            </CardTitle>
                            <Badge variant={sc.variant} className="text-xs">{sc.label}</Badge>
                            <Badge variant="outline" className="text-xs uppercase">{run.language}</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">
                            {format(new Date(run.created_at), "MMM d, yyyy · h:mm a")}
                            {run.test_cases.length > 0 && ` · ${run.test_cases.length} test cases`}
                            {run.test_cases.some(tc => tc.is_failing) && (
                              <span className="text-destructive ml-1">
                                · {run.test_cases.filter(tc => tc.is_failing).length} failing
                              </span>
                            )}
                          </p>
                        </div>
                      </div>
                    </CardHeader>
                  </CollapsibleTrigger>

                  <CollapsibleContent>
                    <CardContent className="px-4 pb-4 pt-0 space-y-4">
                      {/* Verdict */}
                      {getVerdict(run) !== "—" && (
                        <div className="p-3 rounded-md bg-muted/50 border border-border text-sm">
                          <span className="font-semibold text-foreground">AI Verdict: </span>
                          <span className="text-muted-foreground">{getVerdict(run)}</span>
                        </div>
                      )}

                      {/* Code snippets */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
                            <XCircle className="h-3 w-3 text-destructive" /> Buggy Code
                          </p>
                          <ScrollArea className="h-40 rounded-md border border-border bg-muted/30">
                            <pre className="p-3 text-xs font-mono whitespace-pre-wrap">{run.buggy_code}</pre>
                          </ScrollArea>
                        </div>
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
                            <CheckCircle className="h-3 w-3 text-primary" /> Correct Code
                          </p>
                          <ScrollArea className="h-40 rounded-md border border-border bg-muted/30">
                            <pre className="p-3 text-xs font-mono whitespace-pre-wrap">{run.correct_code}</pre>
                          </ScrollArea>
                        </div>
                      </div>

                      {/* Failing input */}
                      {run.failing_input && (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3 text-destructive" /> Failing Input
                          </p>
                          <pre className="p-2 rounded-md bg-destructive/10 border border-destructive/20 text-xs font-mono">{run.failing_input}</pre>
                        </div>
                      )}

                      {/* Test cases */}
                      {run.test_cases.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
                            <Code className="h-3 w-3" /> Test Cases ({run.test_cases.length})
                          </p>
                          <div className="space-y-2 max-h-60 overflow-y-auto">
                            {run.test_cases.map((tc, i) => (
                              <div key={tc.id} className={`p-2 rounded-md border text-xs font-mono ${tc.is_failing ? "border-destructive/30 bg-destructive/5" : "border-border bg-muted/20"}`}>
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="font-semibold text-foreground">#{i + 1}</span>
                                  {tc.is_failing ? (
                                    <Badge variant="destructive" className="text-[10px] px-1 py-0">FAIL</Badge>
                                  ) : (
                                    <Badge variant="default" className="text-[10px] px-1 py-0">PASS</Badge>
                                  )}
                                </div>
                                <p><span className="text-muted-foreground">Input:</span> {tc.input_data}</p>
                                {tc.output_correct && <p><span className="text-muted-foreground">Expected:</span> {tc.output_correct}</p>}
                                {tc.output_buggy && <p><span className="text-muted-foreground">Got:</span> {tc.output_buggy}</p>}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Syntax check */}
                      {run.syntax_check && typeof run.syntax_check === "object" && (run.syntax_check as any).errors && (
                        <div>
                          <p className="text-xs font-medium text-muted-foreground mb-1">Syntax Errors</p>
                          <pre className="p-2 rounded-md bg-destructive/10 border border-destructive/20 text-xs font-mono whitespace-pre-wrap">
                            {JSON.stringify((run.syntax_check as any).errors, null, 2)}
                          </pre>
                        </div>
                      )}
                    </CardContent>
                  </CollapsibleContent>
                </Card>
              </Collapsible>
            );
          })
        )}
      </main>
    </div>
  );
}
