import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, validateAuth, unauthorizedResponse } from "../_shared/auth.ts";
import { callAIWithFailover } from "../_shared/ai-failover.ts";

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

  const auth = await validateAuth(req);
  if (!auth) {
    return unauthorizedResponse();
  }

  try {
    const { buggyCode, correctCode, additionalInfo } = await req.json();

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

    const response = await callAIWithFailover({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      model: "google/gemini-2.5-flash",
      temperature: 0.3,
      max_tokens: 8000,
      response_format: { type: "json_object" },
    });

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
      let cleaned = response
        .replace(/```json\s*/gi, "")
        .replace(/```\s*/g, "")
        .trim();

      const jsonStart = cleaned.search(/[\{\[]/);
      if (jsonStart === -1) {
        throw new Error("No JSON object found in response");
      }

      const isArray = cleaned[jsonStart] === '[';
      const jsonEnd = isArray ? cleaned.lastIndexOf(']') : cleaned.lastIndexOf('}');

      if (jsonEnd === -1 || jsonEnd <= jsonStart) {
        cleaned = cleaned.substring(jsonStart);
      } else {
        cleaned = cleaned.substring(jsonStart, jsonEnd + 1);
      }

      cleaned = cleaned
        .replace(/\(\s*\d+\s*<<\s*\d+\s*\)\s*\+?\s*\d*/g, "0")
        .replace(/\d+\s*\*\*\s*\d+/g, "0")
        .replace(/,\s*}/g, "}")
        .replace(/,\s*]/g, "]")
        .replace(/[\x00-\x1F\x7F]/g, "");

      try {
        return JSON.parse(cleaned);
      } catch (_e) {
        // ignore, try repair
      }

      function balanceAndParse(str: string): unknown {
        let openBraces = 0, openBrackets = 0;
        let lastGoodPos = -1;
        let inString = false;
        let escape = false;

        for (let i = 0; i < str.length; i++) {
          const ch = str[i];
          if (escape) { escape = false; continue; }
          if (ch === '\\' && inString) { escape = true; continue; }
          if (ch === '"') { inString = !inString; continue; }
          if (inString) continue;

          if (ch === '{') openBraces++;
          else if (ch === '}') { openBraces--; if (openBraces >= 0) lastGoodPos = i; }
          else if (ch === '[') openBrackets++;
          else if (ch === ']') { openBrackets--; if (openBrackets >= 0) lastGoodPos = i; }
        }

        if (lastGoodPos > 0) {
          let attempt = str.substring(0, lastGoodPos + 1);
          attempt = attempt.replace(/,\s*$/, "");
          let ob = 0, obrk = 0;
          inString = false; escape = false;
          for (let i = 0; i < attempt.length; i++) {
            const ch = attempt[i];
            if (escape) { escape = false; continue; }
            if (ch === '\\' && inString) { escape = true; continue; }
            if (ch === '"') { inString = !inString; continue; }
            if (inString) continue;
            if (ch === '{') ob++;
            else if (ch === '}') ob--;
            else if (ch === '[') obrk++;
            else if (ch === ']') obrk--;
          }
          attempt += "]".repeat(Math.max(0, obrk)) + "}".repeat(Math.max(0, ob));
          try {
            return JSON.parse(attempt);
          } catch {
            // fall through
          }
        }

        let brute = str.replace(/,\s*$/, "");
        for (let closers = 0; closers < 10; closers++) {
          brute += "}";
          try { return JSON.parse(brute); } catch { /* continue */ }
          const bruteBracket = str.replace(/,\s*$/, "") + "]".repeat(closers + 1);
          try { return JSON.parse(bruteBracket); } catch { /* continue */ }
        }

        throw new Error("Cannot repair truncated JSON");
      }

      try {
        return balanceAndParse(cleaned);
      } catch (e) {
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
