import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getCorsHeaders, validateAuth, unauthorizedResponse } from "../_shared/auth.ts";
import { checkRateLimit, rateLimitResponse } from "../_shared/rate-limiter.ts";
import { callAIWithFailover } from "../_shared/ai-failover.ts";

function getSystemPrompt(retryRound: number): string {
  const base = `You are an expert competitive programming stress tester. Your job is NOT to generate random test cases — your job is to BREAK code and expose bugs.

Generate test cases specifically designed to expose common competitive programming bugs: integer overflow, off-by-one errors, boundary condition mishandling, incorrect duplicate handling, and edge cases.

RESPOND WITH ONLY VALID JSON. No markdown, no code fences, no explanation.

CRITICAL REQUIREMENTS:
- Every "input" value must be a LITERAL string with \\n for newlines.
- NEVER use Python/code expressions (no map, join, range, lambda, list comprehensions).
- Keep N ≤ 200 for all test cases. Write out ALL numbers literally.
- Generate DIFFERENT test cases each time. Do NOT repeat structures from previous batches.
- Include test cases from EVERY applicable category below in each batch.

## CATEGORY 1 — Boundary & Edge Cases
- n=1 (single element), n=2 (minimum multi-element), n=max constraint
- All elements identical (all 1s, all 10^9), identical except one outlier
- Already sorted, reverse sorted, alternating min-max pattern

## CATEGORY 2 — Overflow Traps
- All elements at 10^9 (max), sum overflow (n=10^5 with 10^9 values)
- Product overflow cases (elements ~10^4 multiplied)
- Differences at extreme ends, answer exceeding 2^31-1

## CATEGORY 3 — Off-by-One Traps
- Index 0 and n-1 access, subarrays of length 1 and n
- Loop boundary tests (n times vs n-1), answer at first/last position
- k=1, k=n when k is a parameter

## CATEGORY 4 — Duplicate & Repeated Values
- All duplicates (should output -1 or 0), two distinct values only
- One unique element with rest duplicates, sorted with duplicates at boundaries
- Duplicates affecting MEX, second largest, or partition logic

## CATEGORY 5 — Mathematical Traps
- Prime vs composite numbers, powers of 2 (1,2,4,...,2^30)
- Values just below powers of 2 (e.g., 2^31-1), GCD/LCM sensitive cases
- Multiples of MOD (10^9+7), zero and negative handling

## CATEGORY 6 — String-Specific (if applicable)
- All same characters ("aaaa"), single character, maximum length string
- Alternating characters ("abab"), boundary alphabets ('a','z')
- Palindromes, strings with all 26 distinct characters

## CATEGORY 7 — Multi Test Case (if format is multi_test_case)
- t=maximum allowed (e.g., 10^4), mix of n=1 and n=max in same batch
- Accumulated state bugs, sum of n at global limit, first test very large then tiny

## CATEGORY 8 — Graph/Tree (if applicable)
- Linear chain, star graph, all disconnected, complete graph
- Single node, single edge only

GENERATION RULES:
1. Include at least ONE test case from EACH applicable category per batch
2. Include at least 3 overflow-prone cases per batch
3. Always include the absolute maximum constraint case
4. Vary batches — do NOT repeat same structure twice
5. Generate inputs in EXACT format the code expects
6. Focus on inputs where buggy and correct code are MOST LIKELY to diverge

JSON format (REQUIRED):
{
  "test_cases": [
    { "category": "string (e.g. Boundary, Overflow, Off-by-One)", "description": "string describing which bug it targets", "input": "literal string with \\n" }
  ],
  "total_count": number,
  "generation_notes": "string"
}`;

  if (retryRound === 0) {
    return base + `\n\n## RETRY ROUND 0 — Targeted Edge Cases
Generate 10-12 test cases with this EXACT distribution:
- 2 edge cases: n=1, n=2, empty input, single element
- 2 large number cases: values at 10^9, 10^18, 2^31-1, sums that overflow int32/int64
- 2 identical/duplicate cases: all same values, all zeros, n identical elements
- 2 special number cases: all 0s, -1, 1, powers of 2, primes, 10^9+7 multiples
- 2 random structured cases: sorted, reverse sorted, alternating min/max
MUST respect constraints. NO constraint violations.`;
  } else if (retryRound === 1) {
    return base + `\n\n## RETRY ROUND 1 — Overflow & Zero Focus (Previous tests found NO bug)
Generate 12 adversarial test cases DIFFERENT from round 0:
- 3 integer overflow traps
- 3 zero/negative edge cases
- 3 off-by-one traps
- 3 boundary extremes
DO NOT repeat any test case structure from round 0.`;
  } else if (retryRound === 2) {
    return base + `\n\n## RETRY ROUND 2 — Duplicate & Pattern Focus (Still no bug after 2 rounds)
Generate 12-15 adversarial test cases COMPLETELY DIFFERENT from rounds 0-1:
- 3 all-duplicate cases
- 3 two-value cases
- 3 pattern cases
- 3 mathematical traps
Generate NOVEL structures not seen before.`;
  } else if (retryRound === 3) {
    return base + `\n\n## RETRY ROUND 3 — Worst Case & Corner Combinations (Still no bug after 3 rounds)
Generate 15 MAXIMUM adversarial test cases targeting obscure bugs:
- 3 worst-case performance
- 3 arithmetic corner cases
- 3 single-element variations
- 3 adjacent-difference traps
- 3 completely random
ALL must be COMPLETELY DIFFERENT from rounds 0-2.`;
  } else {
    return base + `\n\n## RETRY ROUND ${retryRound} — Desperation Mode (No bug found in ${retryRound} rounds)
Generate 15 EXTREME adversarial test cases. Maximum creativity required.`;
  }
}

function extractJsonFromResponse(response: string): any {
  let cleaned = response.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  try { return JSON.parse(cleaned); } catch { /* continue */ }

  // Walk objects inside test_cases array; collect complete ones, and try to repair the last (truncated) one.
  const testCasesMatch = cleaned.match(/"test_cases"\s*:\s*\[/);
  if (testCasesMatch && testCasesMatch.index !== undefined) {
    const arrayStart = testCasesMatch.index + testCasesMatch[0].length;
    const completeObjects: string[] = [];
    let depth = 0, objStart = -1, inStr = false, esc = false;
    for (let i = arrayStart; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (inStr) {
        if (esc) { esc = false; }
        else if (ch === '\\') { esc = true; }
        else if (ch === '"') { inStr = false; }
        continue;
      }
      if (ch === '"') { inStr = true; continue; }
      if (ch === '{') { if (depth === 0) objStart = i; depth++; }
      else if (ch === '}') {
        depth--;
        if (depth === 0 && objStart !== -1) {
          const obj = cleaned.substring(objStart, i + 1);
          try { JSON.parse(obj); completeObjects.push(obj); } catch { /* skip */ }
          objStart = -1;
        }
      }
    }

    // Attempt to salvage a truncated trailing object.
    if (objStart !== -1 && depth > 0) {
      let tail = cleaned.substring(objStart);
      if (inStr) tail += '"'; // close open string
      // Count remaining unclosed braces
      let openBraces = 0, openBrackets = 0, s = false, e = false;
      for (const ch of tail) {
        if (s) { if (e) e = false; else if (ch === '\\') e = true; else if (ch === '"') s = false; continue; }
        if (ch === '"') { s = true; continue; }
        if (ch === '{') openBraces++; else if (ch === '}') openBraces--;
        else if (ch === '[') openBrackets++; else if (ch === ']') openBrackets--;
      }
      // Strip trailing partial key/value after last comma to keep valid structure
      const lastComma = tail.lastIndexOf(',');
      const lastClose = Math.max(tail.lastIndexOf('}'), tail.lastIndexOf(']'));
      if (lastComma > lastClose) tail = tail.substring(0, lastComma);
      while (openBrackets-- > 0) tail += ']';
      while (openBraces-- > 0) tail += '}';
      try { JSON.parse(tail); completeObjects.push(tail); } catch { /* give up on this one */ }
    }

    if (completeObjects.length > 0) {
      return JSON.parse(`{"test_cases":[${completeObjects.join(",")}],"total_count":${completeObjects.length},"generation_notes":"Recovered from truncated response"}`);
    }
  }

  const jsonStart = cleaned.search(/[\{\[]/);
  const jsonEnd = Math.max(cleaned.lastIndexOf("}"), cleaned.lastIndexOf("]"));
  if (jsonStart === -1 || jsonEnd === -1) throw new Error("No JSON found");
  cleaned = cleaned.substring(jsonStart, jsonEnd + 1);
  cleaned = cleaned.replace(/,\s*}/g, "}").replace(/,\s*]/g, "]").replace(/[\x00-\x1F\x7F]/g, (c) => c === "\n" || c === "\t" ? c : "");
  let braces = 0, brackets = 0;
  for (const ch of cleaned) { if (ch === '{') braces++; if (ch === '}') braces--; if (ch === '[') brackets++; if (ch === ']') brackets--; }
  while (brackets > 0) { cleaned += ']'; brackets--; }
  while (braces > 0) { cleaned += '}'; braces--; }
  cleaned = cleaned.replace(/,\s*}/g, "}").replace(/,\s*]/g, "]");
  return JSON.parse(cleaned);
}

function trimSchema(schema: any): any {
  const trimmed: any = {};
  if (schema.problem_meta) trimmed.problem_meta = { name: schema.problem_meta.name, problem_type: schema.problem_meta.problem_type };
  if (schema.input_structure) trimmed.input_structure = schema.input_structure;
  if (schema.output_structure) trimmed.output_structure = schema.output_structure;
  if (schema.ai_generation_prompt_hint) trimmed.hint = schema.ai_generation_prompt_hint;
  return trimmed;
}

serve(async (req) => {
  const headers = getCorsHeaders(req);
  if (req.method === "OPTIONS") { return new Response(null, { headers }); }

  const auth = await validateAuth(req);
  if (!auth) return unauthorizedResponse(req);

  const allowed = await checkRateLimit(auth.userId, "generate-test-cases");
  if (!allowed) return rateLimitResponse("generate-test-cases");

  try {
    const { schema, runId, retryRound = 0 } = await req.json();

    // Validate retryRound
    const safeRetryRound = typeof retryRound === "number" ? Math.min(Math.max(0, Math.floor(retryRound)), 10) : 0;

    if (!schema || typeof schema !== "object") {
      return new Response(JSON.stringify({ error: "Invalid or missing schema" }), {
        status: 400, headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    const SYSTEM_PROMPT = getSystemPrompt(safeRetryRound);
    const trimmedSchema = trimSchema(schema);
    const roundLabel = safeRetryRound > 0 ? ` (retry round ${safeRetryRound} of 4 — generate COMPLETELY DIFFERENT and HARDER tests than all previous rounds)` : "";
    const testCount = safeRetryRound <= 1 ? "10-12" : "12-15";
    const userPrompt = `Generate test cases for this problem${roundLabel}:\n\n${JSON.stringify(trimmedSchema, null, 2)}\n\nGenerate ${testCount} targeted test cases. Each input must be a LITERAL string with \\n for newlines. Keep N ≤ 200.\n\nCRITICAL SIZE LIMITS to avoid truncation:\n- Each "input" string MUST be under 1500 characters total.\n- For array test cases, use AT MOST 30 elements per array (NOT thousands).\n- To stress-test large q/n, use SMALL representative arrays (e.g. q=10 with values like [1, 2, 1000000000]) — NOT q=10000 with 10000 literal values.\n- Output the entire JSON compactly. Do not pad inputs with repeated values.`;

    const { response, provider, model } = await callAIWithFailover({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      model: "google/gemini-2.5-flash",
      temperature: Math.min(0.4 + (safeRetryRound * 0.15), 1.0),
      max_tokens: 8000,
    });

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      return new Response(JSON.stringify({ error: "No response from AI" }), {
        status: 500, headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    let parsed;
    try { parsed = extractJsonFromResponse(content); } catch {
      console.error("Failed to parse AI response:", content.substring(0, 300));
      return new Response(JSON.stringify({ error: "AI returned invalid JSON", raw: content.substring(0, 500) }), {
        status: 422, headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    if (parsed.test_cases) {
      parsed.test_cases = parsed.test_cases.filter((tc: { input: string }) => {
        if (typeof tc.input !== "string") return false;
        if (tc.input.length > 50000) return false;
        return !/\b(map|join|range|lambda|for |import |list\(|\.join\()\b/.test(tc.input);
      });
      parsed.total_count = parsed.test_cases.length;
    }

    if (!parsed.test_cases || parsed.test_cases.length === 0) {
      return new Response(JSON.stringify({ error: "No valid test cases generated. Please try again." }), {
        status: 422, headers: { ...headers, "Content-Type": "application/json" },
      });
    }

    if (runId && parsed.test_cases.length > 0) {
      const testCaseRows = parsed.test_cases.map((tc: { input: string }) => ({ run_id: runId, input_data: tc.input, is_failing: false }));
      const { error: insertError } = await auth.supabase.from("test_cases").insert(testCaseRows);
      if (insertError) console.error("Failed to store test cases:", insertError);
      await auth.supabase.from("runs").update({ status: "tests_generated" }).eq("id", runId);
    }

    return new Response(JSON.stringify({ result: parsed, ai_provider: provider, ai_model: model }), {
      status: 200, headers: { ...headers, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-test-cases error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...headers, "Content-Type": "application/json" } }
    );
  }
});
