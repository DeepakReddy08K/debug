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

  const handleEditorMount = (editor: editor.IStandaloneCodeEditor) => {
    editorRef.current = editor;

    // Enable native clipboard (Ctrl+C, Ctrl+V, Ctrl+X, Ctrl+A)
    editor.addAction({
      id: "editor.action.clipboardCopyAction",
      label: "Copy",
      keybindings: [2048 | 33], // Ctrl+C
      run: () => {
        document.execCommand("copy");
      },
    });

    editor.addAction({
      id: "editor.action.clipboardPasteAction",
      label: "Paste",
      keybindings: [2048 | 52], // Ctrl+V
      run: () => {
        document.execCommand("paste");
      },
    });

    editor.addAction({
      id: "editor.action.clipboardCutAction",
      label: "Cut",
      keybindings: [2048 | 54], // Ctrl+X
      run: () => {
        document.execCommand("cut");
      },
    });

    editor.addAction({
      id: "editor.action.selectAllAction",
      label: "Select All",
      keybindings: [2048 | 31], // Ctrl+A
      run: (ed) => {
        const model = ed.getModel();
        if (model) {
          ed.setSelection(model.getFullModelRange());
        }
      },
    });

    // Focus the editor on click
    editor.onDidFocusEditorText(() => {
      editor.updateOptions({ renderLineHighlight: "all" });
    });

    editor.onDidBlurEditorText(() => {
      editor.updateOptions({ renderLineHighlight: "none" });
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
            // Smooth editing experience
            smoothScrolling: true,
            cursorBlinking: "smooth",
            cursorSmoothCaretAnimation: "on",
            cursorStyle: "line",
            cursorWidth: 2,
            // Bracket & indent guides
            bracketPairColorization: { enabled: true },
            guides: { bracketPairs: true, indentation: true, highlightActiveIndentation: true },
            renderLineHighlight: "all",
            renderLineHighlightOnlyWhenFocus: true,
            // Selection
            multiCursorModifier: "ctrlCmd",
            occurrencesHighlight: "singleFile",
            selectionHighlight: true,
            // Scrollbar
            scrollbar: {
              verticalScrollbarSize: 8,
              horizontalScrollbarSize: 8,
              useShadows: false,
            },
            overviewRulerBorder: false,
            overviewRulerLanes: 0,
            hideCursorInOverviewRuler: true,
            // Auto features
            autoClosingBrackets: "always",
            autoClosingQuotes: "always",
            autoIndent: "advanced",
            formatOnPaste: true,
            formatOnType: true,
            // Code intelligence
            suggest: { showWords: true, showSnippets: true, preview: true, shareSuggestSelections: true },
            quickSuggestions: { other: true, comments: false, strings: false },
            acceptSuggestionOnCommitCharacter: true,
            suggestOnTriggerCharacters: true,
            // Code folding
            folding: true,
            foldingHighlight: true,
            showFoldingControls: "mouseover",
            // Matching
            matchBrackets: "always",
            // Mouse features
            mouseWheelZoom: true,
            dragAndDrop: true,
            // Clipboard
            copyWithSyntaxHighlighting: true,
            // Line decorations
            glyphMargin: false,
            lineDecorationsWidth: 8,
            lineNumbersMinChars: 3,
            // Misc UX
            links: true,
            contextmenu: true,
            columnSelection: false,
            find: {
              addExtraSpaceOnTop: false,
              autoFindInSelection: "multiline",
              seedSearchStringFromSelection: "selection",
            },
          }}
        />
      </div>
    </div>
  );
}
