import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Play, Loader2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

interface ConfigPanelProps {
  additionalInfo: string;
  onAdditionalInfoChange: (val: string) => void;
  onFindFailing: () => void;
  onRunSingle: () => void;
  loading: boolean;
}

export default function ConfigPanel({
  additionalInfo,
  onAdditionalInfoChange,
  onFindFailing,
  onRunSingle,
  loading,
}: ConfigPanelProps) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center border-b border-border bg-secondary/30 px-4 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Configuration
        </span>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-5">
          <div className="space-y-2">
            <Label className="text-foreground text-sm">
              Problem Details (Optional)
            </Label>
            <Textarea
              placeholder={`Paste any additional context here:\n\n• Problem constraints (e.g., 1 ≤ N ≤ 10^5)\n• Problem statement or description\n• Input/output format\n• Edge cases to consider`}
              className="min-h-[180px] font-mono text-xs text-foreground"
              value={additionalInfo}
              onChange={(e) => onAdditionalInfoChange(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              AI will auto-detect the language and input format from your code
            </p>
          </div>

          <div className="space-y-3 pt-2">
            <Button
              className="w-full gap-2"
              onClick={onFindFailing}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Play className="h-4 w-4" />
              )}
              {loading ? "Analyzing..." : "🔍 Find Failing Test Case"}
            </Button>
            <Button
              variant="outline"
              className="w-full gap-2"
              onClick={onRunSingle}
              disabled={loading}
            >
              <Play className="h-4 w-4" />
              Run Single Test
            </Button>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
