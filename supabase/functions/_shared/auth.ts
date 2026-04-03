import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Allowed origins — restrict in production
const ALLOWED_ORIGINS = [
  "https://debugforcompetitiveprogramming.lovable.app",
  "https://id-preview--7d0d176c-48bf-4107-ac98-634944c0e677.lovable.app",
  "http://localhost:5173",
  "http://localhost:8080",
];

function getAllowedOrigin(req: Request): string {
  const origin = req.headers.get("Origin") || "";
  if (ALLOWED_ORIGINS.some(o => origin.startsWith(o))) {
    return origin;
  }
  // For non-browser requests (e.g., Supabase SDK), allow through
  return ALLOWED_ORIGINS[0];
}

export function getCorsHeaders(req: Request): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": getAllowedOrigin(req),
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
  };
}

// Keep backward-compatible export for existing functions during migration
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

export interface AuthResult {
  userId: string;
  supabase: ReturnType<typeof createClient>;
}

/**
 * Validates JWT from Authorization header and returns user ID + authenticated Supabase client.
 * Returns null if auth fails.
 */
export async function validateAuth(req: Request): Promise<AuthResult | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const token = authHeader.replace("Bearer ", "");
  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data?.user) {
    return null;
  }

  return {
    userId: data.user.id,
    supabase,
  };
}

export function unauthorizedResponse(req?: Request): Response {
  const headers = req ? getCorsHeaders(req) : corsHeaders;
  return new Response(
    JSON.stringify({ error: "Unauthorized. Please log in." }),
    { status: 401, headers: { ...headers, "Content-Type": "application/json" } }
  );
}
