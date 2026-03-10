import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, validateAuth, unauthorizedResponse } from "../_shared/auth.ts";
import { callAIWithFailover } from "../_shared/ai-failover.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const auth = await validateAuth(req);
  if (!auth) {
    return unauthorizedResponse();
  }

  try {
    const { messages, runContext } = await req.json();

    let systemPrompt = `You are a sharp competitive programming debugging assistant. You help users understand bugs in their code and suggest fixes.

CRITICAL RESPONSE RULES:
- Keep EVERY response to 1-3 lines MAX. No exceptions.
- Be extremely concise — one short sentence per point.
- Reference specific line numbers directly (e.g. "Line 21: use <= instead of <").
- No long explanations, no paragraphs, no bullet lists longer than 3 items.
- If the user asks for more detail, give slightly more but still stay under 5 lines.`;

    if (runContext) {
      systemPrompt += `\n\n## Current Debugging Context\n`;
      if (runContext.language) systemPrompt += `**Language:** ${runContext.language}\n`;
      if (runContext.buggyCode) systemPrompt += `\n**User's Buggy Code:**\n\`\`\`${runContext.language || "cpp"}\n${runContext.buggyCode}\n\`\`\`\n`;
      if (runContext.correctCode) systemPrompt += `\n**Correct Reference Code:**\n\`\`\`${runContext.language || "cpp"}\n${runContext.correctCode}\n\`\`\`\n`;
      if (runContext.diagnosis) systemPrompt += `\n**AI Diagnosis:**\n${JSON.stringify(runContext.diagnosis, null, 2)}\n`;
      if (runContext.failingInput) systemPrompt += `\n**Failing Input:**\n\`\`\`\n${runContext.failingInput}\n\`\`\`\n`;
      if (runContext.outputBuggy) systemPrompt += `**Buggy Output:** \`${runContext.outputBuggy}\`\n`;
      if (runContext.outputCorrect) systemPrompt += `**Correct Output:** \`${runContext.outputCorrect}\`\n`;
      systemPrompt += `\nUse this context to answer the user's questions. Reference specific lines, variables, and logic from the code above.`;
    }

    const { response, provider, model } = await callAIWithFailover({
      messages: [
        { role: "system", content: systemPrompt },
        ...messages,
      ],
      model: "google/gemini-3-flash-preview",
      stream: true,
    });

    // For streaming, add provider info as a custom header
    const headers = new Headers({
      ...corsHeaders,
      "Content-Type": "text/event-stream",
      "X-AI-Provider": provider,
      "X-AI-Model": model,
    });

    return new Response(response.body, { headers });
  } catch (e) {
    console.error("debug-chat error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
