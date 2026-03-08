import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `You are a sharp, no-nonsense competitive programming debugger. You analyze code bugs and give DIRECT, CONCISE answers. No fluff.

You will receive one of three scenarios:

**Scenario A — Syntax/Runtime Errors (from Branch 2a):**
You get syntax check results. List each error with its line number and a one-line fix. That's it.

**Scenario B — Failing Test Cases (from Branch 2c/Judge0):**
You get buggy code, correct code, and a failing test case with both outputs. Identify the EXACT logical bug causing the mismatch. Be specific — point to the exact line/logic error.

**Scenario C — All Tests Passed:**
Both codes produce identical output on all test cases. Briefly confirm correctness and give 1-3 targeted improvement suggestions (performance, edge cases, code quality).

RESPONSE FORMAT — You MUST return ONLY valid JSON, no markdown, no code fences:

{
  "scenario": "syntax_error" | "logic_bug" | "all_correct",
  "verdict": "string — one sentence summary",
  "failing_test": {
    "input": "string — the failing test input",
    "buggy_output": "string — what buggy code produced",
    "correct_output": "string — what correct code produced"
  } | null,
  "issues": [
    {
      "type": "syntax" | "runtime" | "logic" | "performance",
      "line": number or null,
      "description": "string — direct, specific, max 2 sentences",
      "fix": "string — exact fix, max 1-2 sentences"
    }
  ],
  "root_cause": "string or null — for logic bugs only, the core reason in 1-2 sentences",
  "improvements": [
    {
      "type": "performance" | "edge_case" | "style",
      "description": "string — max 1 sentence"
    }
  ]
}

RULES:
- For logic_bug scenario: ALWAYS include failing_test with the first failing test case data. This is the MOST important part — show users exactly which input breaks their code.
- For syntax_error or all_correct: set failing_test to null.
- Maximum 5 issues. Only the most critical ones.
- Maximum 3 improvements. Only if scenario is "all_correct".
- Be SPECIFIC: "Line 12: uses < instead of <=" not "comparison operator might be wrong"
- No generic advice. Every point must reference actual code.
- For logic bugs: trace through the failing input step-by-step mentally, then explain the divergence point.`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const {
      buggyCode,
      correctCode,
      language,
      syntaxErrors,    // from Branch 2a (if has_errors)
      executionResults, // from Branch 2c (Judge0 results)
      runId,
    } = await req.json();

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY is not configured");
    }

    // Build context based on which branch triggered this
    let userPrompt = `Language: ${language || "cpp"}\n\n`;
    userPrompt += `## Buggy Code:\n\`\`\`\n${buggyCode}\n\`\`\`\n\n`;
    userPrompt += `## Correct Code:\n\`\`\`\n${correctCode}\n\`\`\`\n\n`;

    if (syntaxErrors?.has_errors) {
      // Scenario A: syntax/runtime errors from Branch 2a
      userPrompt += `## Scenario: SYNTAX/RUNTIME ERRORS DETECTED\n`;
      userPrompt += `Errors found by static analysis:\n${JSON.stringify(syntaxErrors.errors, null, 2)}\n\n`;
      userPrompt += `Analyze these errors and provide fixes.`;
    } else if (executionResults?.summary?.failing > 0) {
      // Scenario B: failing test cases from Judge0
      const firstFail = executionResults.summary.first_failing;
      userPrompt += `## Scenario: FAILING TEST CASE FOUND\n`;
      userPrompt += `Total: ${executionResults.summary.total} tests, ${executionResults.summary.failing} failing\n\n`;
      userPrompt += `### First Failing Test Case:\n`;
      userPrompt += `**Input:**\n\`\`\`\n${firstFail.input}\n\`\`\`\n`;
      userPrompt += `**Buggy Output:** \`${firstFail.buggy_output}\`\n`;
      userPrompt += `**Correct Output:** \`${firstFail.correct_output}\`\n`;
      if (firstFail.buggy_status !== "OK") {
        userPrompt += `**Buggy Status:** ${firstFail.buggy_status}\n`;
      }
      if (firstFail.buggy_stderr) {
        userPrompt += `**Buggy Stderr:** ${firstFail.buggy_stderr}\n`;
      }

      // Include up to 2 more failing cases for context
      const otherFailing = executionResults.results
        ?.filter((r: any) => r.is_failing)
        ?.slice(1, 3);
      if (otherFailing?.length > 0) {
        userPrompt += `\n### Additional Failing Cases:\n`;
        for (const tc of otherFailing) {
          userPrompt += `- Input: \`${tc.input.substring(0, 100)}\` → Buggy: \`${tc.buggy_output}\` vs Correct: \`${tc.correct_output}\`\n`;
        }
      }

      userPrompt += `\nFind the exact logical bug causing the output mismatch. Be specific.`;
    } else {
      // Scenario C: all passed
      userPrompt += `## Scenario: ALL TESTS PASSED\n`;
      userPrompt += `All ${executionResults?.summary?.total || 0} test cases produced identical output.\n`;
      userPrompt += `Confirm correctness and suggest targeted improvements only.`;
    }

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
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI usage limit reached. Please add credits." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const errorText = await response.text();
      console.error("AI gateway error:", response.status, errorText);
      return new Response(JSON.stringify({ error: "AI service error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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

    // Store diagnosis in DB
    if (runId) {
      const authHeader = req.headers.get("Authorization");
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
      const supabase = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: authHeader ? { Authorization: authHeader } : {} },
      });

      await supabase
        .from("runs")
        .update({
          ai_diagnosis: JSON.stringify(parsed),
          status: "diagnosed",
        })
        .eq("id", runId);
    }

    return new Response(JSON.stringify({ diagnosis: parsed }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("diagnose-bug error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
