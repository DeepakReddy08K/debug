import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Play, Loader2, Search, FlaskConical } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";

interface ConfigPanelProps {
  additionalInfo: string;
  onAdditionalInfoChange: (val: string) => void;
  onFindFailing: () => void;
  onRunSingle: (testInput: string) => void;
  loading: boolean;
  singleTestLoading: boolean;
  progressStep?: string;
}

export default function ConfigPanel({
  additionalInfo,
  onAdditionalInfoChange,
  onFindFailing,
  onRunSingle,
  loading,
  singleTestLoading,
  progressStep,
}: ConfigPanelProps) {
  const [singleTestInput, setSingleTestInput] = useState("");
  const isAnyLoading = loading || singleTestLoading;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center border-b border-border bg-secondary/30 px-4 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Configuration
        </span>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {/* Problem Details */}
          <div className="space-y-1.5">
            <Label className="text-foreground text-sm">Problem Details (Optional)</Label>
            <Textarea
              placeholder={`• Problem constraints (e.g., 1 ≤ N ≤ 10^5)\n• Problem statement or description\n• Input/output format`}
              className="min-h-[100px] font-mono text-xs text-foreground resize-y"
              value={additionalInfo}
              onChange={(e) => onAdditionalInfoChange(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              AI auto-detects language and input format from your code
            </p>
          </div>

          {/* Progress */}
          {loading && progressStep && (
            <div className="space-y-2 rounded-md border border-border bg-secondary/20 p-3">
              <div className="flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                <span className="text-xs font-medium text-foreground">{progressStep}</span>
              </div>
              <Progress value={undefined} className="h-1.5" />
            </div>
          )}

          {!loading && progressStep && (
            <div className="rounded-md border border-border bg-secondary/20 p-3">
              <span className="text-xs font-medium text-muted-foreground">{progressStep}</span>
            </div>
          )}

          {/* Find Failing Button */}
          <Button
            className="w-full gap-2"
            onClick={onFindFailing}
            disabled={isAnyLoading}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            {loading ? "Processing..." : "Find Failing Test Case"}
          </Button>

          {/* Divider */}
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-border" />
            <span className="text-[10px] font-medium uppercase text-muted-foreground">or</span>
            <div className="flex-1 h-px bg-border" />
          </div>

          {/* Run Single Test */}
          <div className="space-y-2">
            <Label className="text-foreground text-sm">Run Single Test</Label>
            <Textarea
              placeholder={`Paste your test input here...\n\nExample:\n5\n1 2 3 4 5`}
              className="min-h-[80px] font-mono text-xs text-foreground resize-y"
              value={singleTestInput}
              onChange={(e) => setSingleTestInput(e.target.value)}
            />
            <Button
              variant="outline"
              className="w-full gap-2"
              onClick={() => onRunSingle(singleTestInput)}
              disabled={isAnyLoading}
            >
              {singleTestLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FlaskConical className="h-4 w-4" />
              )}
              {singleTestLoading ? "Running..." : "Run Single Test"}
            </Button>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
