import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, validateAuth, unauthorizedResponse } from "../_shared/auth.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Validate authentication
  const auth = await validateAuth(req);
  if (!auth) {
    return unauthorizedResponse();
  }

  try {
    const { messages, runContext } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    // Build system prompt with run context
    let systemPrompt = `You are a sharp competitive programming debugging assistant. You help users understand bugs in their code and suggest fixes.

CRITICAL RESPONSE RULES:
- Keep EVERY response to 1-3 lines MAX. No exceptions.
- Be extremely concise — one short sentence per point.
- Reference specific line numbers directly (e.g. "Line 21: use <= instead of <").
- No long explanations, no paragraphs, no bullet lists longer than 3 items.
- If the user asks for more detail, give slightly more but still stay under 5 lines.`;

    if (runContext) {
      systemPrompt += `\n\n## Current Debugging Context\n`;
      if (runContext.language) {
        systemPrompt += `**Language:** ${runContext.language}\n`;
      }
      if (runContext.buggyCode) {
        systemPrompt += `\n**User's Buggy Code:**\n\`\`\`${runContext.language || "cpp"}\n${runContext.buggyCode}\n\`\`\`\n`;
      }
      if (runContext.correctCode) {
        systemPrompt += `\n**Correct Reference Code:**\n\`\`\`${runContext.language || "cpp"}\n${runContext.correctCode}\n\`\`\`\n`;
      }
      if (runContext.diagnosis) {
        systemPrompt += `\n**AI Diagnosis:**\n${JSON.stringify(runContext.diagnosis, null, 2)}\n`;
      }
      if (runContext.failingInput) {
        systemPrompt += `\n**Failing Input:**\n\`\`\`\n${runContext.failingInput}\n\`\`\`\n`;
      }
      if (runContext.outputBuggy) {
        systemPrompt += `**Buggy Output:** \`${runContext.outputBuggy}\`\n`;
      }
      if (runContext.outputCorrect) {
        systemPrompt += `**Correct Output:** \`${runContext.outputCorrect}\`\n`;
      }
      systemPrompt += `\nUse this context to answer the user's questions. Reference specific lines, variables, and logic from the code above.`;
    }

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemPrompt },
          ...messages,
        ],
        stream: true,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI usage limit reached. Please add credits." }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      return new Response(JSON.stringify({ error: "AI service error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("debug-chat error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
