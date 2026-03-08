import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, Search } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ConfigPanelProps {
  additionalInfo: string;
  onAdditionalInfoChange: (val: string) => void;
  onFindFailing: () => void;
  loading: boolean;
  progressStep?: string;
  language: string;
  onLanguageChange: (val: string) => void;
}

export default function ConfigPanel({
  additionalInfo,
  onAdditionalInfoChange,
  onFindFailing,
  loading,
  progressStep,
  language,
  onLanguageChange,
}: ConfigPanelProps) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center border-b border-border bg-secondary/30 px-4 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Configuration
        </span>
      </div>
      <div className="flex flex-col flex-1 p-4">
        <div className="space-y-3 flex-1">
          <div className="space-y-1.5">
            <Label className="text-foreground text-sm">Language</Label>
            <Select value={language} onValueChange={onLanguageChange}>
              <SelectTrigger className="h-9 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cpp">C++</SelectItem>
                <SelectItem value="python">Python</SelectItem>
                <SelectItem value="java">Java</SelectItem>
                <SelectItem value="javascript">JavaScript</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 flex-1">
            <Label className="text-foreground text-sm">Problem Details (Optional)</Label>
            <Textarea
              placeholder={`• Problem constraints (e.g., 1 ≤ N ≤ 10^5)\n• Problem statement\n• Input/output format`}
              className="min-h-[80px] h-full font-mono text-xs text-foreground resize-none"
              value={additionalInfo}
              onChange={(e) => onAdditionalInfoChange(e.target.value)}
            />
          </div>
        </div>

        {/* Progress indicator */}
        {loading && progressStep && (
          <div className="space-y-2 rounded-md border border-border bg-secondary/20 p-3 mt-3 animate-fade-in">
            <div className="flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
              <span className="text-xs font-medium text-foreground">{progressStep}</span>
            </div>
            <Progress value={undefined} className="h-1.5" />
            <div className="flex gap-2 mt-2">
              <div className="h-2 w-1/3 rounded bg-muted animate-pulse" />
              <div className="h-2 w-1/4 rounded bg-muted animate-pulse delay-100" />
              <div className="h-2 w-1/5 rounded bg-muted animate-pulse delay-200" />
            </div>
          </div>
        )}

        {!loading && progressStep && (
          <div className="rounded-md border border-border bg-secondary/20 p-3 mt-3">
            <span className="text-xs font-medium text-muted-foreground">{progressStep}</span>
          </div>
        )}

        <Button className="w-full gap-2 mt-3 shrink-0" onClick={onFindFailing} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          {loading ? "Processing..." : "Find Failing Test Case"}
        </Button>
        <p className="text-[11px] text-muted-foreground mt-1.5">
          Language & input format are used for code execution
        </p>
      </div>
    </div>
  );
}
