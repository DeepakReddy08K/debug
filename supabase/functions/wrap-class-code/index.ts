import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, validateAuth, unauthorizedResponse } from "../_shared/auth.ts";

const SYSTEM_PROMPT = `You are an expert competitive programmer. Your task is to wrap class-based code (like LeetCode solutions) into a complete, runnable program that reads from stdin and writes to stdout.

You will receive:
1. A class-based solution (buggy or correct)
2. The problem schema with input/output structure
3. The programming language

You MUST:
- Keep the original class code EXACTLY as-is (do NOT modify, fix, or optimize it)
- Add a main() function (or equivalent) that:
  - Reads input from stdin according to the input_structure in the schema
  - Creates an instance of the class
  - Calls the appropriate method with the parsed input
  - Prints the result to stdout
- Handle all necessary includes/imports
- Handle edge cases in input parsing (arrays, strings, matrices, linked lists, trees, etc.)

RESPOND WITH ONLY THE COMPLETE CODE. No markdown, no code fences, no explanation. Just the raw code ready to compile and run.

Common LeetCode data structure patterns to handle:
- vector<int>/List[int]: read size then elements, or read elements on one line
- vector<vector<int>>: read rows x cols
- string: read directly  
- TreeNode/ListNode: parse from array representation [1,2,3,null,4]
- For TreeNode: build from level-order array. For ListNode: build from array.

IMPORTANT: The output should match what the problem expects. If the method returns a vector, print elements space-separated. If it returns a bool, print "true"/"false" or "1"/"0" depending on convention. Match the output_structure from the schema.`;

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
