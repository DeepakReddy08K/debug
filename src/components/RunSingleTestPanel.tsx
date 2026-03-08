import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, FlaskConical } from "lucide-react";

interface RunSingleTestPanelProps {
  onRunSingle: (testInput: string) => void;
  loading: boolean;
}

export default function RunSingleTestPanel({ onRunSingle, loading }: RunSingleTestPanelProps) {
  const [testInput, setTestInput] = useState("");

  return (
    <div className="flex flex-col">
      <div className="flex items-center border-b border-border bg-secondary/30 px-4 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Run Single Test
        </span>
      </div>
      <div className="p-4 space-y-3">
        <div className="space-y-1.5">
          <Label className="text-foreground text-sm">Test Input</Label>
          <Textarea
            placeholder={`Paste your test input here...\n\nExample:\n5\n1 2 3 4 5`}
            className="min-h-[100px] font-mono text-xs text-foreground resize-y"
            value={testInput}
            onChange={(e) => setTestInput(e.target.value)}
          />
        </div>
        <Button
          className="w-full gap-2"
          variant="secondary"
          onClick={() => onRunSingle(testInput)}
          disabled={loading}
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <FlaskConical className="h-4 w-4" />
          )}
          {loading ? "Running..." : "Run Test"}
        </Button>
        <p className="text-[11px] text-muted-foreground">
          Runs both codes with your input and compares outputs
        </p>
      </div>
    </div>
  );
}
