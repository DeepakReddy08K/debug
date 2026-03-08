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

interface ConfigPanelProps {
  language: string;
  onLanguageChange: (lang: string) => void;
  sampleInput: string;
  onSampleInputChange: (val: string) => void;
  maxN: string;
  onMaxNChange: (val: string) => void;
  testCasesT: string;
  onTestCasesTChange: (val: string) => void;
  valueRange: string;
  onValueRangeChange: (val: string) => void;
  onFindFailing: () => void;
  onRunSingle: () => void;
  loading: boolean;
}

export default function ConfigPanel({
  language,
  onLanguageChange,
  sampleInput,
  onSampleInputChange,
  maxN,
  onMaxNChange,
  testCasesT,
  onTestCasesTChange,
  valueRange,
  onValueRangeChange,
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
          <div className="space-y-2">
            <Label className="text-muted-foreground text-xs">Max value of N</Label>
            <Input
              type="number"
              placeholder="e.g., 100000"
              value={maxN}
              onChange={(e) => onMaxNChange(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-muted-foreground text-xs">Number of test cases T</Label>
            <Input
              type="number"
              placeholder="e.g., 10"
              value={testCasesT}
              onChange={(e) => onTestCasesTChange(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-muted-foreground text-xs">Value range</Label>
            <Input
              placeholder="e.g., 1 to 10^9"
              value={valueRange}
              onChange={(e) => onValueRangeChange(e.target.value)}
            />
          </div>
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
