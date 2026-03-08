import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, Search } from "lucide-react";
import { Progress } from "@/components/ui/progress";

interface ConfigPanelProps {
  additionalInfo: string;
  onAdditionalInfoChange: (val: string) => void;
  onFindFailing: () => void;
  loading: boolean;
  progressStep?: string;
}

export default function ConfigPanel({
  additionalInfo,
  onAdditionalInfoChange,
  onFindFailing,
  loading,
  progressStep,
}: ConfigPanelProps) {
  return (
    <div className="flex flex-col">
      <div className="flex items-center border-b border-border bg-secondary/30 px-4 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Configuration
        </span>
      </div>
      <div className="p-4 space-y-3">
        <div className="space-y-1.5">
          <Label className="text-foreground text-sm">Problem Details (Optional)</Label>
          <Textarea
            placeholder={`• Problem constraints (e.g., 1 ≤ N ≤ 10^5)\n• Problem statement\n• Input/output format`}
            className="min-h-[100px] font-mono text-xs text-foreground resize-y"
            value={additionalInfo}
            onChange={(e) => onAdditionalInfoChange(e.target.value)}
          />
          <p className="text-[11px] text-muted-foreground">
            AI auto-detects language and input format
          </p>
        </div>

        {/* Progress indicator */}
        {loading && progressStep && (
          <div className="space-y-2 rounded-md border border-border bg-secondary/20 p-3 animate-in fade-in duration-300">
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

        <Button className="w-full gap-2" onClick={onFindFailing} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          {loading ? "Processing..." : "Find Failing Test Case"}
        </Button>
      </div>
    </div>
  );
}
