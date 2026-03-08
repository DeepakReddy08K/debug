import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  ChevronRight,
  Sun,
  Moon,
} from "lucide-react";
import { format } from "date-fns";

interface RunSummary {
  id: string;
  language: string;
  status: string;
  created_at: string;
  buggy_code: string;
  ai_diagnosis: any;
  failing_input: string | null;
  test_case_count: number;
  failing_count: number;
}

const statusConfig: Record<
  string,
  {
    label: string;
    variant: "default" | "secondary" | "destructive" | "outline";
    icon: typeof CheckCircle;
  }
> = {
  pending: { label: "Pending", variant: "secondary", icon: Clock },
  analyzed: { label: "Analyzed", variant: "secondary", icon: Clock },
  syntax_errors_found: { label: "Syntax Errors", variant: "destructive", icon: XCircle },
  syntax_clean: { label: "Syntax Clean", variant: "default", icon: CheckCircle },
  tests_generated: { label: "Tests Generated", variant: "secondary", icon: Clock },
  failing_found: { label: "Bug Found", variant: "destructive", icon: AlertTriangle },
  all_passed: { label: "All Passed", variant: "default", icon: CheckCircle },
  diagnosed: { label: "Diagnosed", variant: "default", icon: CheckCircle },
};

export default function History() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [runs, setRuns] = useState<RunSummary[]>([]);
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
    if (!user) return;

    const fetchHistory = async () => {
      setLoading(true);
      const threeMonthsAgo = new Date();
      threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

      const { data: runsData, error } = await supabase
        .from("runs")
        .select("id, language, status, created_at, buggy_code, ai_diagnosis, failing_input")
        .eq("user_id", user.id)
        .gte("created_at", threeMonthsAgo.toISOString())
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Failed to fetch runs:", error);
        setLoading(false);
        return;
      }

      // Fetch test case counts
      const runIds = (runsData || []).map((r) => r.id);
      let tcCounts: Record<string, { total: number; failing: number }> = {};

      if (runIds.length > 0) {
        const { data: tcData } = await supabase
          .from("test_cases")
          .select("run_id, is_failing")
          .in("run_id", runIds);

        (tcData || []).forEach((tc) => {
          if (!tcCounts[tc.run_id]) tcCounts[tc.run_id] = { total: 0, failing: 0 };
          tcCounts[tc.run_id].total++;
          if (tc.is_failing) tcCounts[tc.run_id].failing++;
        });
      }

      setRuns(
        (runsData || []).map((r) => ({
          ...r,
          test_case_count: tcCounts[r.id]?.total || 0,
          failing_count: tcCounts[r.id]?.failing || 0,
        })) as RunSummary[]
      );
      setLoading(false);
    };

    fetchHistory();
  }, [user]);

  const getVerdict = (run: RunSummary): string | null => {
    if (run.ai_diagnosis && typeof run.ai_diagnosis === "object") {
      return (run.ai_diagnosis as any).verdict || null;
    }
    return null;
  };

  const getCodePreview = (code: string): string => {
    const lines = code.split("\n").filter((l) => l.trim());
    // Find first meaningful line (skip includes/imports)
    const meaningful = lines.find(
      (l) => !l.startsWith("#include") && !l.startsWith("import") && !l.startsWith("using")
    );
    return (meaningful || lines[0] || "").slice(0, 80);
  };

  return (
    <div className={`${isDark ? "dark" : ""} min-h-screen bg-background text-foreground`}>
      <header className="border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-xl font-bold">Run History</h1>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={toggleTheme}>
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <span className="text-sm text-muted-foreground">
              Last 3 months · {runs.length} runs
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-2">
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
            const sc = statusConfig[run.status] || {
              label: run.status,
              variant: "outline" as const,
              icon: Clock,
            };
            const StatusIcon = sc.icon;
            const verdict = getVerdict(run);

            return (
              <Card
                key={run.id}
                className="cursor-pointer transition-all hover:shadow-md hover:border-primary/30 active:scale-[0.995]"
                onClick={() => navigate(`/history/${run.id}`)}
              >
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div
                      className={`shrink-0 rounded-full p-2 ${
                        run.status === "failing_found" || run.status === "syntax_errors_found"
                          ? "bg-destructive/10 text-destructive"
                          : run.status === "all_passed" || run.status === "diagnosed"
                          ? "bg-primary/10 text-primary"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      <StatusIcon className="h-4 w-4" />
                    </div>

                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant={sc.variant} className="text-[10px]">
                          {sc.label}
                        </Badge>
                        <Badge variant="outline" className="text-[10px] uppercase">
                          {run.language}
                        </Badge>
                        {run.test_case_count > 0 && (
                          <span className="text-[10px] text-muted-foreground">
                            {run.test_case_count} tests
                            {run.failing_count > 0 && (
                              <span className="text-destructive">
                                {" "}
                                · {run.failing_count} failing
                              </span>
                            )}
                          </span>
                        )}
                      </div>

                      <p className="text-xs font-mono text-foreground truncate">
                        {getCodePreview(run.buggy_code)}
                      </p>

                      {verdict && (
                        <p className="text-xs text-muted-foreground truncate">{verdict}</p>
                      )}

                      <p className="text-[10px] text-muted-foreground">
                        {format(new Date(run.created_at), "MMM d, yyyy · h:mm a")}
                      </p>
                    </div>

                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </main>
    </div>
  );
}
