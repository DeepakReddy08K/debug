import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, validateAuth, unauthorizedResponse } from "../_shared/auth.ts";

const SYSTEM_PROMPT = `You are an expert competitive programming analyst. Your task is to analyze provided code and/or problem description and produce a comprehensive JSON schema that describes:

1. Problem metadata (name, source, type)
2. Input structure (format, variables, types, constraints)
3. Output structure
4. Test case generation strategy with multiple categories covering edge cases

You MUST respond with ONLY valid JSON — no markdown, no explanation, no code fences.

The JSON must follow this exact structure:
{
  "problem_meta": {
    "name": "string",
    "source": "string (e.g. Codeforces, LeetCode, Unknown)",
    "problem_type": "string (e.g. greedy, dp, sorting, graph)",
    "language": "string — the PROGRAMMING LANGUAGE of the code. MUST be one of: cpp, c, python, java, javascript. Detect from syntax: #include → cpp, import java → java, def/print() → python, etc. Default to cpp if ambiguous.",
    "is_class_based": "boolean — true if the code uses a class-based solution style (like LeetCode: a class with a method that solves the problem, e.g. 'class Solution { public: int solve(...) { ... } }' or 'class Solution: def solve(self, ...)'). false if it reads from stdin/cout and has a main() or equivalent entry point."
  },
  "input_structure": {
    "format": "single_test_case | multi_test_case",
    "outer": { "variable": "string", "type": "string", "constraints": { "min": number, "max": number }, "description": "string" },
    "per_test_case": [
      {
        "line": number,
        "variable": "string",
        "type": "string (int, int[], string, etc.)",
        "constraints": { "min": number, "max": number },
        "length": "string (optional, reference to another variable)",
        "element_constraints": { "min": number, "max": number },
        "separator": "string",
        "description": "string"
      }
    ],
    "global_constraints": {}
  },
  "output_structure": {
    "per_test_case": {
      "type": "string",
      "description": "string"
    }
  },
  "test_case_generation_strategy": {
    "categories": [
      {
        "name": "string",
        "description": "string",
        "examples": [ { ... } ],
        "generation": { ... }
      }
    ]
  },
  "ai_generation_prompt_hint": "string - a detailed prompt hint for generating test cases respecting all constraints and covering all categories"
}

Rules:
- Analyze the code to detect the programming language, input parsing pattern, and variable types/constraints.
- If a problem description is provided, extract constraints from it.
- If no problem description is given, infer constraints from the code (loop bounds, array sizes, etc.).
- Always include at minimum these test case categories: small/trivial, edge cases (n=1, n=2, all equal), nearly sorted, reverse sorted, large stress tests, max constraints.
- The "outer" field should only exist if the format is "multi_test_case".
- Be precise about constraints — use exact values from the problem statement when available.`;

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
    const { buggyCode, correctCode, additionalInfo } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    // Build the user prompt
    let userPrompt = "Analyze the following and produce the JSON schema:\n\n";

    if (buggyCode?.trim()) {
      userPrompt += `## Buggy Code:\n\`\`\`\n${buggyCode}\n\`\`\`\n\n`;
    }
    if (correctCode?.trim()) {
      userPrompt += `## Correct/Reference Code:\n\`\`\`\n${correctCode}\n\`\`\`\n\n`;
    }
    if (additionalInfo?.trim()) {
      userPrompt += `## Additional Info (Problem Statement / Constraints):\n${additionalInfo}\n\n`;
    }

    userPrompt += "Produce the comprehensive JSON schema now.";

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI usage limit reached. Please add credits to continue." }), {
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

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      return new Response(JSON.stringify({ error: "No response from AI" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Robust JSON extraction and repair
    function extractAndRepairJson(response: string): unknown {
      // Remove markdown code blocks
      let cleaned = response
        .replace(/```json\s*/gi, "")
        .replace(/```\s*/g, "")
        .trim();

      // Find JSON boundaries
      const jsonStart = cleaned.search(/[\{\[]/);
      const jsonEnd = cleaned[jsonStart] === '['
        ? cleaned.lastIndexOf(']')
        : cleaned.lastIndexOf('}');

      if (jsonStart === -1 || jsonEnd === -1) {
        throw new Error("No JSON object found in response");
      }

      cleaned = cleaned.substring(jsonStart, jsonEnd + 1);

      // Remove code-like expressions (e.g., (1 << 30), 2**30, etc.)
      cleaned = cleaned
        .replace(/\(\s*\d+\s*<<\s*\d+\s*\)\s*\+?\s*\d*/g, "0") // (1 << 30) + 1 -> 0
        .replace(/\d+\s*\*\*\s*\d+/g, "0") // 2**30 -> 0
        .replace(/,\s*}/g, "}") // trailing commas in objects
        .replace(/,\s*]/g, "]") // trailing commas in arrays
        .replace(/[\x00-\x1F\x7F]/g, ""); // control characters

      try {
        return JSON.parse(cleaned);
      } catch (e) {
        // If still failing, try to recover truncated JSON
        if (cleaned.startsWith('{') && !cleaned.endsWith('}')) {
          // Find last complete property
          const lastQuote = cleaned.lastIndexOf('"');
          const lastBrace = cleaned.lastIndexOf('}');
          const lastBracket = cleaned.lastIndexOf(']');
          const cutPoint = Math.max(lastBrace, lastBracket);
          if (cutPoint > 0) {
            const repairedObj = cleaned.substring(0, cutPoint + 1) + "}".repeat(5);
            try {
              return JSON.parse(repairedObj);
            } catch {
              // Last resort - try to balance braces
            }
          }
        }
        throw new Error(`Cannot parse JSON: ${e}`);
      }
    }

    let parsed;
    try {
      parsed = extractAndRepairJson(content);
    } catch (parseErr) {
      console.error("JSON extraction failed:", parseErr);
      return new Response(JSON.stringify({ error: "AI returned invalid JSON", raw: content.substring(0, 500) }), {
        status: 422,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ schema: parsed }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("analyze-problem error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
