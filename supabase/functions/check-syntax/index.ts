import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, validateAuth, unauthorizedResponse } from "../_shared/auth.ts";
import { callAIWithFailover } from "../_shared/ai-failover.ts";

const SYSTEM_PROMPT = `You are a strict syntax-only checker for competitive programming code. Your ONLY job is to find errors that would prevent the code from COMPILING or that would ALWAYS crash at runtime regardless of input.

CHECK FOR:
1. **Syntax Errors**: Missing semicolons, unmatched brackets/braces/parentheses, invalid keywords, typos in language keywords (e.g., "whlie" instead of "while"), undeclared variables used without any declaration, missing #include headers for used functions.
2. **Guaranteed Runtime Crashes**: Division by a literal zero, accessing a hardcoded negative index, infinite recursion with no base case at all, calling a function that doesn't exist.

DO NOT FLAG (these are logic bugs, NOT syntax/runtime errors):
- Wrong comparison operators (< vs <=, > vs >=, == vs !=)
- Off-by-one errors in loop bounds
- Wrong variable used in an expression
- Wrong algorithm or approach
- Different logic than the reference code
- Wrong formula or calculation
- Array access with a variable index (even if it MIGHT be out of bounds for some inputs)
- Wrong sort order or comparator
- Missing edge case handling
- Any difference from the correct code that is about LOGIC, not syntax

IMPORTANT: Do NOT compare the buggy code's logic against the reference code. The reference code is provided ONLY to help you understand the language being used. Logic differences are handled by a separate testing phase.

You MUST respond with ONLY valid JSON — no markdown, no explanation, no code fences.

{
  "has_errors": true/false,
  "error_type": "syntax" | "runtime" | "both" | "none",
  "errors": [
    {
      "type": "syntax" | "runtime",
      "line": number or null,
      "description": "string describing the error",
      "severity": "critical" | "warning",
      "fix_suggestion": "string suggesting the fix"
    }
  ],
  "summary": "string - brief summary",
  "can_proceed_to_testing": true/false
}

Rules:
- Default to has_errors: false. Only set true for REAL syntax/compilation errors or GUARANTEED crashes.
- If the code would compile and run (even if it produces wrong output), set has_errors to false and can_proceed_to_testing to true.
- When in doubt, set has_errors to false — let the testing phase catch logic bugs.
- Line numbers should reference the buggy code.`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const auth = await validateAuth(req);
  if (!auth) {
    return unauthorizedResponse();
  }

  try {
    const { buggyCode, correctCode, language } = await req.json();

    let userPrompt = `Check the following ${language || "code"} for syntax and runtime errors:\n\n`;
    userPrompt += `## Buggy Code:\n\`\`\`\n${buggyCode}\n\`\`\`\n\n`;
    userPrompt += `## Correct/Reference Code:\n\`\`\`\n${correctCode}\n\`\`\`\n\n`;
    userPrompt += "Analyze for syntax and runtime errors. Produce the JSON now.";

    const { response, provider, model } = await callAIWithFailover({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      model: "google/gemini-2.5-flash",
      temperature: 0.2,
    });

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      return new Response(JSON.stringify({ error: "No response from AI" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let jsonContent = content.trim();
    if (jsonContent.startsWith("```")) {
      jsonContent = jsonContent.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonContent);
    } catch {
      return new Response(JSON.stringify({ error: "AI returned invalid JSON", raw: jsonContent }), {
        status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ result: parsed, ai_provider: provider, ai_model: model }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("check-syntax error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
