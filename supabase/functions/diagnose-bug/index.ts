import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, validateAuth, unauthorizedResponse } from "../_shared/auth.ts";
import { callAIWithFailover } from "../_shared/ai-failover.ts";

const SYSTEM_PROMPT = `You are a sharp, no-nonsense competitive programming debugger. You analyze code bugs and give DIRECT, CONCISE answers. No fluff.

You will receive one of four scenarios:

**Scenario A — Syntax/Runtime Errors (from Branch 2a):**
You get syntax check results. List each error with its line number and a one-line fix. That's it.

**Scenario B — Compilation Error (from Branch 3 - Judge0):**
The code failed to compile when executed. You get the compiler error message and possibly partial results. Analyze the compilation error, identify the exact issue (wrong syntax, missing headers, etc.), and provide the fix. Do NOT just repeat the compiler message — explain what's wrong and how to fix it.

**Scenario C — Failing Test Cases (from Branch 3 - Judge0):**
You get buggy code, correct code, and a failing test case with both outputs. Identify the EXACT logical bug causing the mismatch. Be specific — point to the exact line/logic error.

**Scenario D — All Tests Passed:**
Both codes produce identical output on all test cases. Do a CAREFUL line-by-line diff of the two codes. Look for:
1. Any logical differences (different operators, different formulas, different conditions)
2. Output format differences (endl vs \\n, spacing, etc.)
3. Edge cases that might not be covered by the generated test cases
4. Performance differences

If the codes are truly identical in logic, confirm that. But if there ARE differences (even subtle ones like endl vs \\n), explain each difference and whether it could cause issues on a judge system.

RESPONSE FORMAT — You MUST return ONLY valid JSON, no markdown, no code fences:

{
  "scenario": "syntax_error" | "logic_bug" | "all_correct" | "compilation_error",
  "verdict": "string — one sentence summary",
  "failing_test": {
    "input": "string — the failing test input",
    "buggy_output": "string — what buggy code produced",
    "correct_output": "string — what correct code produced"
  } | null,
  "issues": [
    {
      "type": "syntax" | "runtime" | "logic" | "performance" | "compilation",
      "line": number or null,
      "description": "string — direct, specific, max 2 sentences",
      "fix": "string — exact fix, max 1-2 sentences"
    }
  ],
  "root_cause": "string or null — for logic/compilation bugs, the core reason in 1-2 sentences",
  "improvements": [
    {
      "type": "performance" | "edge_case" | "style",
      "description": "string — max 1 sentence"
    }
  ]
}

RULES:
- For logic_bug scenario: ALWAYS include failing_test with the first failing test case data. This is the MOST important part — show users exactly which input breaks their code.
- For compilation_error: set failing_test to null, list the compilation issues in issues array with type "compilation".
- For syntax_error or all_correct: set failing_test to null.
- Maximum 5 issues. Only the most critical ones.
- Maximum 3 improvements.
- Be SPECIFIC: "Line 12: uses < instead of <=" not "comparison operator might be wrong"
- No generic advice. Every point must reference actual code.
- For logic bugs: trace through the failing input step-by-step mentally, then explain the divergence point.
- For all_correct: list ALL code differences you find between buggy and correct code, even minor ones like endl vs \\n. Explain whether each could cause issues.`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const auth = await validateAuth(req);
  if (!auth) {
    return unauthorizedResponse();
  }

  try {
    const {
      buggyCode,
      correctCode,
      language,
      syntaxErrors,
      executionResults,
      compilationError,
      runId,
    } = await req.json();

    let userPrompt = `Language: ${language || "cpp"}\n\n`;
    userPrompt += `## Buggy Code:\n\`\`\`\n${buggyCode}\n\`\`\`\n\n`;
    userPrompt += `## Correct Code:\n\`\`\`\n${correctCode}\n\`\`\`\n\n`;

    if (syntaxErrors?.has_errors) {
      userPrompt += `## Scenario: SYNTAX/RUNTIME ERRORS DETECTED\n`;
      userPrompt += `Errors found by static analysis:\n${JSON.stringify(syntaxErrors.errors, null, 2)}\n\n`;
      userPrompt += `Analyze these errors and provide fixes.`;
    } else if (compilationError) {
      userPrompt += `## Scenario: COMPILATION ERROR\n`;
      userPrompt += `The code failed to compile when executed by the judge.\n`;
      userPrompt += `**Compiler Output:**\n\`\`\`\n${compilationError}\n\`\`\`\n\n`;
      if (executionResults?.results?.length > 0) {
        const firstResult = executionResults.results[0];
        if (firstResult.buggy_stderr) {
          userPrompt += `**Stderr:** ${firstResult.buggy_stderr}\n`;
        }
      }
      userPrompt += `\nAnalyze the compilation error. Identify the exact issue and provide a specific fix.`;
    } else if (executionResults?.summary?.failing > 0) {
      const firstFail = executionResults.summary.first_failing;
      userPrompt += `## Scenario: FAILING TEST CASE FOUND\n`;
      userPrompt += `Total: ${executionResults.summary.total} tests, ${executionResults.summary.failing} failing\n\n`;
      userPrompt += `### First Failing Test Case:\n`;
      userPrompt += `**Input:**\n\`\`\`\n${firstFail.input}\n\`\`\`\n`;
      userPrompt += `**Buggy Output:** \`${firstFail.buggy_output}\`\n`;
      userPrompt += `**Correct Output:** \`${firstFail.correct_output}\`\n`;
      if (firstFail.buggy_status && firstFail.buggy_status !== "OK") {
        userPrompt += `**Buggy Status:** ${firstFail.buggy_status}\n`;
      }
      if (firstFail.buggy_stderr) {
        userPrompt += `**Buggy Stderr:** ${firstFail.buggy_stderr}\n`;
      }

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
      userPrompt += `## Scenario: ALL TESTS PASSED\n`;
      userPrompt += `All ${executionResults?.summary?.total || 0} test cases produced identical output.\n\n`;
      userPrompt += `IMPORTANT: Do a careful LINE-BY-LINE comparison of the buggy code vs the correct code. List EVERY difference you find, no matter how small (e.g., "endl" vs "\\n", different variable names, different loop bounds, etc.). For each difference, explain whether it could cause issues on an online judge.\n\n`;
      userPrompt += `If the codes are logically identical, confirm that and suggest improvements.`;
    }

    const response = await callAIWithFailover({
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
      console.error("AI returned invalid JSON:", jsonContent.substring(0, 500));
      return new Response(JSON.stringify({ error: "AI returned invalid JSON", raw: jsonContent.substring(0, 1000) }), {
        status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!parsed.scenario) {
      parsed.scenario = compilationError ? "compilation_error" 
        : syntaxErrors?.has_errors ? "syntax_error"
        : executionResults?.summary?.failing > 0 ? "logic_bug"
        : "all_correct";
    }
    if (!parsed.verdict) parsed.verdict = "Analysis complete.";
    if (!parsed.issues) parsed.issues = [];
    if (!parsed.improvements) parsed.improvements = [];

    if (runId) {
      await auth.supabase
        .from("runs")
        .update({ ai_diagnosis: parsed, status: "diagnosed" })
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
