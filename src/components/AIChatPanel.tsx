import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { MessageCircle, Send, X, Loader2, Bot, User } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface RunContext {
  runId?: string;
  language?: string;
  buggyCode?: string;
  correctCode?: string;
  diagnosis?: any;
  failingInput?: string;
  outputBuggy?: string;
  outputCorrect?: string;
}

interface AIChatPanelProps {
  runContext: RunContext;
  className?: string;
}

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/debug-chat`;

export default function AIChatPanel({ runContext, className = "" }: AIChatPanelProps) {
  const { user } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [loadedRunId, setLoadedRunId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load chat history when opening for a run
  useEffect(() => {
    if (isOpen && runContext.runId && runContext.runId !== loadedRunId && user) {
      loadChatHistory(runContext.runId);
    }
  }, [isOpen, runContext.runId, user]);

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const loadChatHistory = async (runId: string) => {
    const { data } = await supabase
      .from("chat_messages")
      .select("role, content")
      .eq("run_id", runId)
      .order("created_at", { ascending: true });

    if (data && data.length > 0) {
      setMessages(data.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })));
    } else {
      setMessages([]);
    }
    setLoadedRunId(runId);
  };

  const saveMessage = async (role: "user" | "assistant", content: string) => {
    if (!runContext.runId || !user) return;
    await supabase.from("chat_messages").insert({
      run_id: runContext.runId,
      user_id: user.id,
      role,
      content,
    });
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || isLoading) return;

    const userMsg: ChatMessage = { role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);

    // Save user message
    await saveMessage("user", text);

    let assistantContent = "";
    const allMessages = [...messages, userMsg];

    try {
      const resp = await fetch(CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          messages: allMessages.map((m) => ({ role: m.role, content: m.content })),
          runContext,
        }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error || `Error ${resp.status}`);
      }

      if (!resp.body) throw new Error("No response stream");

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let textBuffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        textBuffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = textBuffer.indexOf("\n")) !== -1) {
          let line = textBuffer.slice(0, newlineIndex);
          textBuffer = textBuffer.slice(newlineIndex + 1);

          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (line.startsWith(":") || line.trim() === "") continue;
          if (!line.startsWith("data: ")) continue;

          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") break;

          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              assistantContent += content;
              setMessages((prev) => {
                const last = prev[prev.length - 1];
                if (last?.role === "assistant") {
                  return prev.map((m, i) =>
                    i === prev.length - 1 ? { ...m, content: assistantContent } : m
                  );
                }
                return [...prev, { role: "assistant", content: assistantContent }];
              });
            }
          } catch {
            textBuffer = line + "\n" + textBuffer;
            break;
          }
        }
      }

      // Save assistant message
      if (assistantContent) {
        await saveMessage("assistant", assistantContent);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Chat failed";
      toast.error(msg);
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `⚠️ Error: ${msg}` },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!isOpen) {
    return (
      <Button
        onClick={() => setIsOpen(true)}
        className={`fixed bottom-5 right-5 z-50 h-12 w-12 rounded-full shadow-lg gap-0 p-0 ${className}`}
        title="Ask AI about this debug session"
      >
        <MessageCircle className="h-5 w-5" />
      </Button>
    );
  }

  return (
    <div className={`fixed bottom-5 right-5 z-50 w-[380px] max-w-[calc(100vw-2rem)] h-[520px] max-h-[calc(100vh-6rem)] rounded-xl border border-border bg-card shadow-2xl flex flex-col overflow-hidden ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-secondary/30 shrink-0">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">Debug Assistant</span>
        </div>
        <Button variant="secondary" size="icon" className="h-7 w-7 border border-border" onClick={() => setIsOpen(false)}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 min-h-0">
        <div ref={scrollRef} className="p-3 space-y-3">
          {messages.length === 0 && (
            <div className="text-center py-8 space-y-2">
              <Bot className="h-8 w-8 text-muted-foreground/40 mx-auto" />
              <p className="text-xs text-muted-foreground">
                Ask me anything about this debug session — why a test fails, how to fix the bug, or explain the logic.
              </p>
            </div>
          )}

          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              {msg.role === "assistant" && (
                <div className="shrink-0 h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center mt-0.5">
                  <Bot className="h-3.5 w-3.5 text-primary" />
                </div>
              )}
              <div
                className={`max-w-[85%] rounded-lg px-3 py-2 text-xs leading-relaxed break-words overflow-hidden ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-foreground"
                }`}
              >
                {msg.role === "assistant" ? (
                  <div className="prose prose-xs prose-invert max-w-none break-words [&_pre]:bg-secondary/60 [&_pre]:rounded [&_pre]:p-2 [&_pre]:text-[10px] [&_pre]:overflow-x-auto [&_code]:text-[10px] [&_code]:break-all [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0">
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  </div>
                ) : (
                  msg.content
                )}
              </div>
              {msg.role === "user" && (
                <div className="shrink-0 h-6 w-6 rounded-full bg-secondary flex items-center justify-center mt-0.5">
                  <User className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
              )}
            </div>
          ))}

          {isLoading && messages[messages.length - 1]?.role !== "assistant" && (
            <div className="flex gap-2">
              <div className="shrink-0 h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center">
                <Bot className="h-3.5 w-3.5 text-primary" />
              </div>
              <div className="bg-muted rounded-lg px-3 py-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="border-t border-border p-2 shrink-0">
        <div className="flex items-end gap-1.5">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about this bug..."
            rows={1}
            className="flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary min-h-[36px] max-h-[80px]"
          />
          <Button
            size="icon"
            className="h-9 w-9 shrink-0"
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
          >
            <Send className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
