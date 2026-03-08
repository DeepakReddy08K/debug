import { useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Bug, Zap, Search, ShieldCheck, TestTube } from "lucide-react";

export default function Signup() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [checkingUsername, setCheckingUsername] = useState(false);

  const checkUsernameAvailable = async (uname: string): Promise<boolean> => {
    const { data } = await supabase
      .from("profiles")
      .select("id")
      .eq("username", uname)
      .maybeSingle();
    return !data;
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || username.length < 3) {
      toast.error("Username must be at least 3 characters");
      return;
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      toast.error("Username can only contain letters, numbers, and underscores");
      return;
    }

    setLoading(true);

    // Check uniqueness
    setCheckingUsername(true);
    const available = await checkUsernameAvailable(username.trim());
    setCheckingUsername(false);

    if (!available) {
      toast.error("Username is already taken. Please choose another.");
      setLoading(false);
      return;
    }

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: name, username: username.trim() },
        emailRedirectTo: window.location.origin,
      },
    });
    setLoading(false);
    if (error) {
      // Handle unique constraint violation for username
      const errorMsg = error.message?.toLowerCase() || "";
      if (errorMsg.includes("duplicate") || errorMsg.includes("username") || errorMsg.includes("profiles_username")) {
        toast.error("Username is already taken. Please choose another.");
      } else if (error.message?.includes("password") && error.message?.includes("leaked")) {
        toast.error("This password has been found in a data breach. Please choose a stronger password.");
      } else {
        toast.error("Signup failed. Please try again.");
      }
    } else {
      toast.success("Check your email for a verification link!");
    }
  };

  const handleGoogleLogin = async () => {
    const { error } = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (error) toast.error("Google sign-in failed");
  };

  const features = [
    { icon: Search, title: "Find Failing Test Cases", desc: "Automatically generate edge-case inputs that expose bugs." },
    { icon: Zap, title: "AI Diagnosis", desc: "Instant analysis pinpointing what's wrong and how to fix it." },
    { icon: TestTube, title: "Run Tests", desc: "Test specific inputs against buggy and correct code." },
    { icon: ShieldCheck, title: "Error Detection", desc: "Catch syntax errors, segfaults, and TLE automatically." },
  ];

  return (
    <div className="dark flex min-h-screen flex-col bg-background">
      <div className="flex flex-1 items-center justify-center px-4 py-8">
        <div className="w-full max-w-4xl grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
          {/* Left: App description */}
          <div className="space-y-6">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary">
                <Bug className="h-6 w-6 text-primary-foreground" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-foreground">Debug</h1>
                <p className="text-sm text-muted-foreground">Competitive Programming Bug Finder</p>
              </div>
            </div>
            <p className="text-muted-foreground leading-relaxed">
              Paste your buggy code alongside a correct solution and let Debug automatically find the failing test case, diagnose the bug, and suggest a fix — all powered by AI.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {features.map((f) => (
                <div key={f.title} className="flex items-start gap-2.5 rounded-lg border border-border bg-card/50 p-3">
                  <f.icon className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-foreground">{f.title}</p>
                    <p className="text-xs text-muted-foreground">{f.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right: Signup form */}
          <Card className="border-border bg-card">
            <CardHeader className="text-center">
              <CardTitle className="text-2xl font-bold text-foreground">Create Account</CardTitle>
              <CardDescription className="text-muted-foreground">
                Join Debug and squash your bugs
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button variant="outline" className="w-full" onClick={handleGoogleLogin}>
                <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                Continue with Google
              </Button>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">or</span>
                </div>
              </div>

              <form onSubmit={handleSignup} className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="name" className="text-foreground">Full Name</Label>
                  <Input id="name" placeholder="John Doe" value={name} onChange={(e) => setName(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="username" className="text-foreground">Username <span className="text-xs text-muted-foreground">(unique)</span></Label>
                  <Input
                    id="username"
                    placeholder="cool_coder_42"
                    value={username}
                    onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ""))}
                    required
                    minLength={3}
                    maxLength={24}
                  />
                  <p className="text-[11px] text-muted-foreground">Letters, numbers, and underscores only. This is your public display name.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-foreground">Email</Label>
                  <Input id="email" type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password" className="text-foreground">Password</Label>
                  <Input id="password" type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
                </div>
                <Button type="submit" className="w-full" disabled={loading || checkingUsername}>
                  {loading ? "Creating account..." : "Sign Up"}
                </Button>
              </form>

              <p className="text-center text-sm text-muted-foreground">
                Already have an account?{" "}
                <Link to="/login" className="text-primary hover:underline">Sign in</Link>
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-border py-4 px-4">
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <Bug className="h-3.5 w-3.5 text-primary" />
            <span>Debug — AI-Powered Bug Finder for Competitive Programming</span>
          </div>
          <p>© {new Date().getFullYear()} Debug. Built with ❤️ for competitive programmers.</p>
        </div>
      </footer>
    </div>
  );
}
