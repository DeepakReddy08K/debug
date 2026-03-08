import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

export function unauthorizedResponse(): Response {
  return new Response(
    JSON.stringify({ error: "Unauthorized. Please log in." }),
    { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}
