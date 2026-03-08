import Editor from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { useRef } from "react";

interface CodeEditorPanelProps {
  label: string;
  language: string;
  value: string;
  onChange: (value: string) => void;
}

const languageMap: Record<string, string> = {
  cpp: "cpp",
  "c++": "cpp",
  python: "python",
  java: "java",
  javascript: "javascript",
};

export default function CodeEditorPanel({ label, language, value, onChange }: CodeEditorPanelProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  const handleEditorMount = (ed: editor.IStandaloneCodeEditor) => {
    editorRef.current = ed;

    // Keep native Monaco clipboard behavior (Ctrl/Cmd + C/V/X/A)
    ed.onDidFocusEditorText(() => {
      ed.updateOptions({ renderLineHighlight: "all" });
    });

    ed.onDidBlurEditorText(() => {
      ed.updateOptions({ renderLineHighlight: "none" });
    });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center border-b border-border bg-secondary/30 px-4 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
      </div>
      <div className="flex-1 min-h-0">
        <Editor
          height="100%"
          language={languageMap[language] || "cpp"}
          value={value}
          onChange={(val) => onChange(val || "")}
          theme="vs-dark"
          onMount={handleEditorMount}
          options={{
            minimap: { enabled: false },
            fontSize: 14,
            lineNumbers: "on",
            scrollBeyondLastLine: false,
            automaticLayout: true,
            tabSize: 4,
            insertSpaces: true,
            wordWrap: "on",
            padding: { top: 12, bottom: 12 },
            smoothScrolling: true,
            cursorBlinking: "smooth",
            cursorSmoothCaretAnimation: "on",
            cursorStyle: "line",
            cursorWidth: 2,
            readOnly: false,
            selectOnLineNumbers: true,
            roundedSelection: true,
            bracketPairColorization: { enabled: true },
            guides: { bracketPairs: true, indentation: true, highlightActiveIndentation: true },
            renderLineHighlight: "all",
            renderLineHighlightOnlyWhenFocus: true,
            multiCursorModifier: "ctrlCmd",
            occurrencesHighlight: "singleFile",
            selectionHighlight: true,
            scrollbar: {
              verticalScrollbarSize: 8,
              horizontalScrollbarSize: 8,
              useShadows: false,
            },
            overviewRulerBorder: false,
            overviewRulerLanes: 0,
            hideCursorInOverviewRuler: true,
            autoClosingBrackets: "always",
            autoClosingQuotes: "always",
            autoIndent: "advanced",
            autoSurround: "languageDefined",
            formatOnPaste: false,
            formatOnType: false,
            quickSuggestions: true,
            suggest: {
              showWords: true,
              showSnippets: true,
              preview: true,
              shareSuggestSelections: true,
              showMethods: true,
              showFunctions: true,
              showVariables: true,
              showClasses: true,
              showKeywords: true,
            },
            acceptSuggestionOnCommitCharacter: true,
            suggestOnTriggerCharacters: true,
            parameterHints: { enabled: true },
            folding: true,
            foldingHighlight: true,
            foldingStrategy: "auto",
            showFoldingControls: "mouseover",
            matchBrackets: "always",
            mouseWheelZoom: true,
            dragAndDrop: true,
            copyWithSyntaxHighlighting: false,
            glyphMargin: false,
            lineDecorationsWidth: 8,
            lineNumbersMinChars: 3,
            links: true,
            contextmenu: true,
            columnSelection: false,
            find: {
              addExtraSpaceOnTop: false,
              autoFindInSelection: "multiline",
              seedSearchStringFromSelection: "always",
            },
            snippetSuggestions: "inline",
            tabCompletion: "on",
            wordBasedSuggestions: "currentDocument",
            renderWhitespace: "none",
            stickyScroll: { enabled: false },
          }}
        />
      </div>
    </div>
  );
}
