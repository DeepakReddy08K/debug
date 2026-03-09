import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, validateAuth, unauthorizedResponse } from "../_shared/auth.ts";

const SYSTEM_PROMPT = `You are an expert competitive programmer. Your task is to wrap class-based code (like LeetCode solutions) into a complete, COMPILABLE, runnable program that reads from stdin and writes to stdout.

CRITICAL RULES:
1. Keep the original class code EXACTLY as-is — do NOT modify, fix, rename, or optimize ANY part of it.
2. Add ONLY:
   - Necessary #include / import headers at the TOP (before the class)
   - A main() function (or equivalent) AFTER the class
   - Any helper functions for parsing (e.g., TreeNode/ListNode builders) BEFORE main but AFTER includes
3. The main() function must:
   - Read input from stdin according to the input_structure in the schema
   - Create an instance of the Solution class (or whatever the class is named)
   - Call the correct method with parsed arguments
   - Print the result to stdout (followed by newline)

LANGUAGE-SPECIFIC RULES FOR C++:
- Always include: #include <bits/stdc++.h> and using namespace std;
- For vector<int> input: read n, then read n integers
- For vector<vector<int>>: read rows, cols, then elements
- For string: use cin >> s or getline as appropriate
- For TreeNode*: define struct TreeNode if not in class, build from level-order array
- For ListNode*: define struct ListNode if not in class, build from array
- Use "int main()" not "void main()"
- Print booleans as "true"/"false" (lowercase)
- Print vectors space-separated on one line
- Handle multi_test_case format: read t first, loop t times

LANGUAGE-SPECIFIC RULES FOR PYTHON:
- Import sys if needed for faster input
- Handle input() / sys.stdin
- Print result directly

LANGUAGE-SPECIFIC RULES FOR JAVA:
- Add import java.util.*; at top
- Create public class Main with public static void main
- Instantiate Solution inside main

COMPILATION CORRECTNESS IS THE #1 PRIORITY. Double-check:
- All variables are declared before use
- All brackets/braces are balanced
- All semicolons are present (C++/Java)
- No duplicate class/struct definitions
- The class from user code is included exactly once

RESPOND WITH ONLY THE COMPLETE CODE. No markdown, no code fences, no backticks, no explanation. Just raw compilable code.`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const auth = await validateAuth(req);
  if (!auth) return unauthorizedResponse();

  try {
    const { buggyCode, correctCode, schema, language } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    // Build a concise schema summary for the prompt
    const schemaSummary = {
      input_structure: schema?.input_structure,
      output_structure: schema?.output_structure,
      problem_meta: schema?.problem_meta,
      hint: schema?.ai_generation_prompt_hint,
    };

    // Wrap both codes in parallel
    const wrapCode = async (code: string, label: string): Promise<string> => {
      const userPrompt = `Language: ${language}

Problem Schema:
${JSON.stringify(schemaSummary, null, 2)}

${label} class-based code to wrap:
\`\`\`
${code}
\`\`\`

Generate the COMPLETE runnable program that includes this class exactly as-is, plus main() that reads stdin and prints stdout. Output ONLY raw code.`;

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
          temperature: 0.2,
          max_tokens: 4000,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`AI error for ${label}: ${response.status} - ${errText}`);
      }

      const data = await response.json();
      let content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error(`No AI response for ${label}`);

      // Strip markdown fences if present
      content = content.trim();
      content = content.replace(/^```[\w]*\s*\n?/, "").replace(/\n?```\s*$/, "");

      return content.trim();
    };

    // Run both wraps in parallel
    const [wrappedBuggy, wrappedCorrect] = await Promise.all([
      wrapCode(buggyCode, "Buggy"),
      wrapCode(correctCode, "Correct"),
    ]);

    return new Response(
      JSON.stringify({
        wrappedBuggyCode: wrappedBuggy,
        wrappedCorrectCode: wrappedCorrect,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("wrap-class-code error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
