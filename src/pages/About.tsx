import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  Bug,
  Code,
  FlaskConical,
  Zap,
  History,
  Shield,
  Sun,
  Moon,
} from "lucide-react";

const steps = [
  {
    icon: Code,
    title: "Paste Both Codes",
    description:
      "Paste your buggy code and a correct reference solution side by side.",
  },
  {
    icon: Zap,
    title: "AI Analyzes the Problem",
    description:
      "The system parses constraints, detects the language, and checks for syntax or runtime errors automatically.",
  },
  {
    icon: FlaskConical,
    title: "Auto-Generated Test Cases",
    description:
      "Smart test cases are generated based on problem constraints and executed against both codes to find mismatches.",
  },
  {
    icon: Bug,
    title: "Pinpoint the Bug",
    description:
      "AI diagnoses the exact logical error, shows the failing test case, and suggests a precise fix.",
  },
];

const features = [
  {
    title: "Differential Debugging",
    description:
      "Compares your code against a correct solution to find the exact input that breaks your logic.",
  },
  {
    title: "Syntax & Runtime Detection",
    description:
      "Catches compilation errors and runtime crashes (segfaults, TLE) before test execution.",
  },
  {
    title: "AI-Powered Diagnosis",
    description:
      "Gemini-powered analysis pinpoints root causes with line-specific fixes — no generic advice.",
  },
  {
    title: "Run Single Test",
    description:
      "Test your own custom input and instantly compare outputs side-by-side.",
  },
  {
    title: "Full Run History",
    description:
      "Every debugging session is saved with test cases, outputs, and AI diagnosis for 3 months.",
  },
  {
    title: "Multi-Language Support",
    description:
      "Works with C++, Python, Java, and JavaScript out of the box.",
  },
];

export default function About() {
  const navigate = useNavigate();
  const [isDark, setIsDark] = useState(
    () => localStorage.getItem("theme") !== "light"
  );

  const toggleTheme = () => {
    setIsDark((prev) => {
      const next = !prev;
      localStorage.setItem("theme", next ? "dark" : "light");
      return next;
    });
  };

  return (
    <div
      className={`${isDark ? "dark" : ""} min-h-screen bg-background text-foreground`}
    >
      {/* Header */}
      <header className="border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary">
              <Bug className="h-3.5 w-3.5 text-primary-foreground" />
            </div>
            <h1 className="text-xl font-bold">About Debug</h1>
          </div>
          <div className="ml-auto">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={toggleTheme}
            >
              {isDark ? (
                <Sun className="h-4 w-4" />
              ) : (
                <Moon className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-10 space-y-16">
        {/* Hero */}
        <section className="text-center space-y-4">
          <div className="inline-flex items-center justify-center h-16 w-16 rounded-2xl bg-primary/10 mx-auto">
            <Bug className="h-8 w-8 text-primary" />
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
            Find bugs in seconds,
            <br />
            <span className="text-primary">not hours.</span>
          </h2>
          <p className="text-muted-foreground max-w-xl mx-auto text-base sm:text-lg leading-relaxed">
            Debug is an AI-powered differential debugger for competitive
            programming. Paste your buggy code and a correct solution — it
            automatically generates test cases, finds the failing input, and
            tells you exactly what's wrong.
          </p>
        </section>

        {/* How it works */}
        <section className="space-y-6">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground text-center">
            How It Works
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {steps.map((step, i) => {
              const Icon = step.icon;
              return (
                <div
                  key={i}
                  className="rounded-xl border border-border bg-card p-5 space-y-3 text-center"
                >
                  <div className="inline-flex items-center justify-center h-10 w-10 rounded-lg bg-primary/10 mx-auto">
                    <Icon className="h-5 w-5 text-primary" />
                  </div>
                  <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Step {i + 1}
                  </div>
                  <h4 className="text-sm font-bold text-foreground">
                    {step.title}
                  </h4>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {step.description}
                  </p>
                </div>
              );
            })}
          </div>
        </section>

        {/* Features */}
        <section className="space-y-6">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground text-center">
            Features
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {features.map((f, i) => (
              <div
                key={i}
                className="rounded-xl border border-border bg-card p-5 space-y-2"
              >
                <h4 className="text-sm font-bold text-foreground">
                  {f.title}
                </h4>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {f.description}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="text-center space-y-4 pb-8">
          <h3 className="text-xl font-bold">Ready to debug smarter?</h3>
          <div className="flex items-center justify-center gap-3">
            <Button onClick={() => navigate("/")} className="gap-2">
              <Bug className="h-4 w-4" /> Start Debugging
            </Button>
            <Button
              variant="outline"
              onClick={() => navigate("/history")}
              className="gap-2"
            >
              <History className="h-4 w-4" /> View History
            </Button>
          </div>
        </section>
      </main>
    </div>
  );
}
