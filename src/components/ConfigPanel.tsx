import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, Play } from "lucide-react";

const LANGUAGE_CONSTRAINTS: Record<string, { key: string; label: string; placeholder: string; type: string }[]> = {
  cpp: [
    { key: "maxN", label: "Max value of N", placeholder: "e.g., 100000", type: "number" },
    { key: "testCasesT", label: "Number of test cases T", placeholder: "e.g., 10", type: "number" },
    { key: "valueRange", label: "Value range", placeholder: "e.g., 1 to 10^9", type: "text" },
    { key: "timeLimit", label: "Time limit (seconds)", placeholder: "e.g., 2", type: "number" },
  ],
  python: [
    { key: "maxN", label: "Max value of N", placeholder: "e.g., 100000", type: "number" },
    { key: "testCasesT", label: "Number of test cases T", placeholder: "e.g., 10", type: "number" },
    { key: "valueRange", label: "Value range", placeholder: "e.g., 1 to 10^9", type: "text" },
  ],
  java: [
    { key: "maxN", label: "Max value of N", placeholder: "e.g., 100000", type: "number" },
    { key: "testCasesT", label: "Number of test cases T", placeholder: "e.g., 10", type: "number" },
    { key: "valueRange", label: "Value range", placeholder: "e.g., 1 to 10^9", type: "text" },
    { key: "memoryLimit", label: "Memory limit (MB)", placeholder: "e.g., 256", type: "number" },
  ],
  javascript: [
    { key: "maxN", label: "Max value of N", placeholder: "e.g., 100000", type: "number" },
    { key: "valueRange", label: "Value range", placeholder: "e.g., 1 to 10^9", type: "text" },
  ],
};

interface ConfigPanelProps {
  language: string;
  onLanguageChange: (lang: string) => void;
  sampleInput: string;
  onSampleInputChange: (val: string) => void;
  constraints: Record<string, string>;
  onConstraintChange: (key: string, val: string) => void;
  onFindFailing: () => void;
  onRunSingle: () => void;
  loading: boolean;
}

export default function ConfigPanel({
  language,
  onLanguageChange,
  sampleInput,
  onSampleInputChange,
  constraints,
  onConstraintChange,
  onFindFailing,
  onRunSingle,
  loading,
}: ConfigPanelProps) {
  const currentConstraints = LANGUAGE_CONSTRAINTS[language] || LANGUAGE_CONSTRAINTS.cpp;
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center border-b border-border bg-secondary/30 px-4 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Configuration
        </span>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {/* Language Selector */}
        <div className="space-y-2">
          <Label className="text-foreground text-sm">Language</Label>
          <Select value={language} onValueChange={onLanguageChange}>
            <SelectTrigger>
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

        {/* Sample Input */}
        <div className="space-y-2">
          <Label className="text-foreground text-sm">Sample Input (Optional)</Label>
          <Textarea
            placeholder="Paste a sample input from the problem..."
            className="min-h-[100px] font-mono text-xs"
            value={sampleInput}
            onChange={(e) => onSampleInputChange(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            AI uses this to understand the input format
          </p>
        </div>

        {/* Constraints */}
        <div className="space-y-3">
          <Label className="text-foreground text-sm font-semibold">Constraints</Label>
          {currentConstraints.map((c) => (
            <div key={c.key} className="space-y-2">
              <Label className="text-muted-foreground text-xs">{c.label}</Label>
              <Input
                type={c.type === "number" ? "number" : "text"}
                placeholder={c.placeholder}
                className="text-foreground"
                value={constraints[c.key] || ""}
                onChange={(e) => onConstraintChange(c.key, e.target.value)}
              />
            </div>
          ))}
        </div>

        {/* Action Buttons */}
        <div className="space-y-3 pt-2">
          <Button
            className="w-full gap-2"
            onClick={onFindFailing}
            disabled={loading}
          >
            <Search className="h-4 w-4" />
            {loading ? "Searching..." : "🔍 Find Failing Test Case"}
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
    </div>
  );
}
