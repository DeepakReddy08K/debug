import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Bug, LogOut, History } from "lucide-react";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import CodeEditorPanel from "@/components/CodeEditorPanel";
import ConfigPanel from "@/components/ConfigPanel";
import { toast } from "sonner";

const DEFAULT_CODE: Record<string, string> = {
  cpp: `#include <bits/stdc++.h>
using namespace std;

int main() {
    int n;
    cin >> n;
    // Your solution here
    return 0;
}`,
  python: `n = int(input())
# Your solution here
`,
  java: `import java.util.*;

public class Main {
    public static void main(String[] args) {
        Scanner sc = new Scanner(System.in);
        int n = sc.nextInt();
        // Your solution here
    }
}`,
  javascript: `const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });

rl.on('line', (line) => {
    const n = parseInt(line);
    // Your solution here
});`,
};

const Index = () => {
  const { user, signOut } = useAuth();
  const [buggyCode, setBuggyCode] = useState("");
  const [correctCode, setCorrectCode] = useState("");
  const [additionalInfo, setAdditionalInfo] = useState("");
  const [loading, setLoading] = useState(false);

  const handleFindFailing = () => {
    if (!buggyCode.trim()) {
      toast.error("Please paste your buggy code");
      return;
    }
    if (!correctCode.trim()) {
      toast.error("Please paste the correct reference code");
      return;
    }
    toast.info("AI agent integration coming in Phase 3!");
  };

  const handleRunSingle = () => {
    toast.info("Single test run coming in Phase 3!");
  };

  return (
    <div className="dark flex h-screen flex-col bg-background">
      {/* Header */}
      <header className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary">
            <Bug className="h-3.5 w-3.5 text-primary-foreground" />
          </div>
          <span className="text-base font-bold text-foreground">Debug</span>
          <span className="ml-2 rounded bg-secondary px-2 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
            Beta
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground text-xs">
            <History className="h-3.5 w-3.5" />
            History
          </Button>
          <span className="text-xs text-muted-foreground hidden sm:inline">{user?.email}</span>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={signOut}>
            <LogOut className="h-3.5 w-3.5" />
          </Button>
        </div>
      </header>

      {/* Main Editor Area */}
      <div className="flex-1 min-h-0">
        <ResizablePanelGroup direction="horizontal">
          {/* Panel 1: Buggy Code */}
          <ResizablePanel defaultSize={35} minSize={20}>
            <CodeEditorPanel
              label="Your Code (Buggy)"
              language={language}
              value={buggyCode}
              onChange={setBuggyCode}
            />
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* Panel 2: Correct Code */}
          <ResizablePanel defaultSize={35} minSize={20}>
            <CodeEditorPanel
              label="Correct Code (Reference)"
              language={language}
              value={correctCode}
              onChange={setCorrectCode}
            />
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* Panel 3: Config & Input */}
          <ResizablePanel defaultSize={30} minSize={20}>
            <ConfigPanel
              language={language}
              onLanguageChange={handleLanguageChange}
              sampleInput={sampleInput}
              onSampleInputChange={setSampleInput}
              constraints={constraints}
              onConstraintChange={handleConstraintChange}
              onFindFailing={handleFindFailing}
              onRunSingle={handleRunSingle}
              loading={loading}
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </div>
  );
};

export default Index;
