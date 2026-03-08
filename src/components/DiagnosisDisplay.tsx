import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle, XCircle, Lightbulb, ArrowRight } from "lucide-react";

interface DiagnosisIssue {
  type: "syntax" | "runtime" | "logic" | "performance";
  line: number | null;
  description: string;
  fix: string;
}

interface DiagnosisImprovement {
  type: "performance" | "edge_case" | "style";
  description: string;
}

interface FailingTest {
  input: string;
  buggy_output: string;
  correct_output: string;
}

interface DiagnosisResult {
  scenario: "syntax_error" | "logic_bug" | "all_correct";
  verdict: string;
  failing_test: FailingTest | null;
  issues: DiagnosisIssue[];
  root_cause: string | null;
  improvements: DiagnosisImprovement[];
}

interface DiagnosisDisplayProps {
  diagnosis: DiagnosisResult | null;
}

const scenarioConfig = {
  syntax_error: {
    icon: XCircle,
    color: "text-red-400",
    bg: "bg-red-500/10 border-red-500/20",
    badge: "destructive" as const,
    label: "Syntax/Runtime Errors",
  },
  logic_bug: {
    icon: AlertTriangle,
    color: "text-yellow-400",
    bg: "bg-yellow-500/10 border-yellow-500/20",
    badge: "secondary" as const,
    label: "Logic Bug Found",
  },
  all_correct: {
    icon: CheckCircle,
    color: "text-green-400",
    bg: "bg-green-500/10 border-green-500/20",
    badge: "default" as const,
    label: "All Correct",
  },
};

const issueTypeColors: Record<string, string> = {
  syntax: "bg-red-500/20 text-red-300",
  runtime: "bg-orange-500/20 text-orange-300",
  logic: "bg-yellow-500/20 text-yellow-300",
  performance: "bg-blue-500/20 text-blue-300",
};

const improvementTypeColors: Record<string, string> = {
  performance: "bg-blue-500/20 text-blue-300",
  edge_case: "bg-purple-500/20 text-purple-300",
  style: "bg-muted text-muted-foreground",
};

export default function DiagnosisDisplay({ diagnosis }: DiagnosisDisplayProps) {
  if (!diagnosis) return null;

  const config = scenarioConfig[diagnosis.scenario] || scenarioConfig.logic_bug;
  const Icon = config.icon;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center border-b border-border bg-secondary/30 px-4 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Diagnosis
        </span>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {/* Verdict */}
          <div className={`rounded-lg border p-3 ${config.bg}`}>
            <div className="flex items-start gap-2">
              <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${config.color}`} />
              <div className="space-y-1">
                <Badge variant={config.badge} className="text-[10px]">
                  {config.label}
                </Badge>
                <p className="text-sm font-medium text-foreground">{diagnosis.verdict}</p>
              </div>
            </div>
          </div>

          {/* Failing Test Case (logic bugs) */}
          {diagnosis.failing_test && (
            <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-3 space-y-2">
              <span className="text-[10px] font-semibold uppercase text-yellow-400">Failing Test Case</span>
              <div className="space-y-1.5">
                <div>
                  <span className="text-[10px] text-muted-foreground font-mono">INPUT</span>
                  <pre className="text-xs text-foreground bg-secondary/40 rounded p-1.5 mt-0.5 overflow-x-auto whitespace-pre-wrap">{diagnosis.failing_test.input}</pre>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-[10px] text-red-400 font-mono">YOUR OUTPUT</span>
                    <pre className="text-xs text-red-300 bg-red-500/10 rounded p-1.5 mt-0.5 overflow-x-auto whitespace-pre-wrap">{diagnosis.failing_test.buggy_output}</pre>
                  </div>
                  <div>
                    <span className="text-[10px] text-green-400 font-mono">EXPECTED</span>
                    <pre className="text-xs text-green-300 bg-green-500/10 rounded p-1.5 mt-0.5 overflow-x-auto whitespace-pre-wrap">{diagnosis.failing_test.correct_output}</pre>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Root Cause (logic bugs only) */}
          {diagnosis.root_cause && (
            <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 p-3">
              <div className="flex items-start gap-2">
                <ArrowRight className="h-3.5 w-3.5 mt-0.5 shrink-0 text-yellow-400" />
                <div>
                  <span className="text-[10px] font-semibold uppercase text-yellow-400">Root Cause</span>
                  <p className="text-xs text-foreground mt-1">{diagnosis.root_cause}</p>
                </div>
              </div>
            </div>
          )}

          {/* Issues */}
          {diagnosis.issues?.length > 0 && (
            <div className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Issues ({diagnosis.issues.length})
              </span>
              {diagnosis.issues.map((issue, i) => (
                <div key={i} className="rounded-md border border-border bg-secondary/20 p-3 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${issueTypeColors[issue.type] || "bg-muted text-muted-foreground"}`}>
                      {issue.type.toUpperCase()}
                    </span>
                    {issue.line && (
                      <span className="text-[10px] text-muted-foreground font-mono">
                        Line {issue.line}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-foreground">{issue.description}</p>
                  <div className="flex items-start gap-1.5 pt-1 border-t border-border/50">
                    <span className="text-[10px] text-green-400 font-semibold shrink-0">FIX:</span>
                    <p className="text-xs text-green-300/90">{issue.fix}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Improvements (all_correct only) */}
          {diagnosis.improvements?.length > 0 && (
            <div className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Improvements
              </span>
              {diagnosis.improvements.map((imp, i) => (
                <div key={i} className="flex items-start gap-2 rounded-md border border-border bg-secondary/20 p-3">
                  <Lightbulb className="h-3.5 w-3.5 mt-0.5 shrink-0 text-primary" />
                  <div className="space-y-1">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${improvementTypeColors[imp.type] || "bg-muted text-muted-foreground"}`}>
                      {imp.type.replace("_", " ").toUpperCase()}
                    </span>
                    <p className="text-xs text-foreground">{imp.description}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
