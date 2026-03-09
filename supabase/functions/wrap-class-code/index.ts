import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, validateAuth, unauthorizedResponse } from "../_shared/auth.ts";
import { callAIWithFailover } from "../_shared/ai-failover.ts";

const SYSTEM_PROMPT = `You are an expert competitive programmer. Your ONLY job is to generate a main() function that:
1. Reads input from stdin according to the given schema
2. Creates an instance of the Solution class
3. Calls the correct method with parsed arguments
4. Prints the result to stdout

CRITICAL RULES:
- Output ONLY the main() function and any helper structs/functions needed (TreeNode, ListNode builders, etc.)
- Do NOT output the class code — it will be prepended automatically
- Do NOT output any #include or import statements — they will be added automatically
- Do NOT output markdown, code fences, backticks, or explanations
- Just raw code: helper structs (if needed) + main() function

FOR C++:
- Use "int main()" with "return 0;"
- For vector<int>: read n, then n integers
- For string: use cin >> s (single word) or getline(cin, s) if multiword
- Print booleans as "true"/"false" (cout << boolalpha)
- Print vectors space-separated
- Handle multi_test_case: read t first, loop t times
- Use long long where the output type requires it

FOR PYTHON:
- Use if __name__ == "__main__": block
- Read with input() or sys.stdin

FOR JAVA:
- Generate public static void main(String[] args) only
- Use Scanner for input

IMPORTANT: The input parsing must match the schema EXACTLY. Read variables in the correct order and on the correct lines.`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const auth = await validateAuth(req);
  if (!auth) return unauthorizedResponse();

  try {
    const { buggyCode, correctCode, schema, language } = await req.json();

    const schemaSummary = {
      input_structure: schema?.input_structure,
      output_structure: schema?.output_structure,
      problem_meta: schema?.problem_meta,
    };

    const detectMethod = (code: string): string => {
      const methodMatches = code.match(/(?:public:\s*[\s\S]*?)(\w[\w\s\*<>,]*?)\s+(\w+)\s*\(([^)]*)\)/g);
      if (methodMatches) {
        return methodMatches[methodMatches.length - 1];
      }
      return "";
    };

    const methodHint = detectMethod(buggyCode) || detectMethod(correctCode) || "";

    const userPrompt = `Language: ${language}

Problem Schema:
${JSON.stringify(schemaSummary, null, 2)}

The Solution class has this method signature (approximate):
${methodHint}

Generate ONLY the main() function (and any needed helper structs like TreeNode/ListNode builders).
Do NOT include the class code or #include statements.
The main() must read stdin per the schema, call the Solution method, and print the result.
Output ONLY raw code.`;

    const response = await callAIWithFailover({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      model: "google/gemini-2.5-flash",
      temperature: 0.1,
      max_tokens: 2000,
    });

    const data = await response.json();
    let mainCode = data.choices?.[0]?.message?.content;
    if (!mainCode) throw new Error("No AI response for main() generation");

    // Strip markdown fences and non-code artifacts
    mainCode = mainCode.trim();
    mainCode = mainCode.replace(/^```[\w\+\#]*\s*\n?/gm, "").replace(/\n?```\s*$/gm, "");
    mainCode = mainCode.replace(/^`+|`+$/g, "");
    const outputMarker = mainCode.search(/\n(Output|Explanation|Note|Example|Input):/i);
    if (outputMarker > 50) {
      mainCode = mainCode.substring(0, outputMarker);
    }
    mainCode = mainCode.trim();

    // Remove any #include or using namespace lines the AI might have sneaked in
    mainCode = mainCode.replace(/^#include\s+.*$/gm, "");
    mainCode = mainCode.replace(/^using namespace\s+.*$/gm, "");
    mainCode = mainCode.trim();

    // Assemble complete programs
    let wrappedBuggy: string;
    let wrappedCorrect: string;

    if (language === "cpp" || language === "c") {
      const header = `#include <bits/stdc++.h>\nusing namespace std;\n\n`;
      wrappedBuggy = header + buggyCode.trim() + "\n\n" + mainCode;
      wrappedCorrect = header + correctCode.trim() + "\n\n" + mainCode;
    } else if (language === "java") {
      wrappedBuggy = buggyCode.trim() + "\n\npublic class Main {\n" + mainCode + "\n}";
      wrappedCorrect = correctCode.trim() + "\n\npublic class Main {\n" + mainCode + "\n}";
    } else if (language === "python") {
      wrappedBuggy = buggyCode.trim() + "\n\n" + mainCode;
      wrappedCorrect = correctCode.trim() + "\n\n" + mainCode;
    } else {
      wrappedBuggy = buggyCode.trim() + "\n\n" + mainCode;
      wrappedCorrect = correctCode.trim() + "\n\n" + mainCode;
    }

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
