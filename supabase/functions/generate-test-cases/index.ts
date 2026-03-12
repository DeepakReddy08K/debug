import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, validateAuth, unauthorizedResponse } from "../_shared/auth.ts";
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
- 3 integer overflow traps: n elements all at 10^9, prefix sums exceeding 2^63, product overflow
- 3 zero/negative edge cases: all zeros, answer is 0, empty result expected, n=0 if allowed
- 3 off-by-one traps: answer at index 0, answer at index n-1, k=1, k=n, loop runs n vs n-1
- 3 boundary extremes: minimum valid input, maximum constraint, transition values
DO NOT repeat any test case structure from round 0.`;
  } else if (retryRound === 2) {
    return base + `\n\n## RETRY ROUND 2 — Duplicate & Pattern Focus (Still no bug after 2 rounds)
Generate 12-15 adversarial test cases COMPLETELY DIFFERENT from rounds 0-1:
- 3 all-duplicate cases: every element identical (1s, max value, zeros)
- 3 two-value cases: only 2 distinct values in various arrangements
- 3 pattern cases: strictly increasing then one drop, strictly decreasing, plateau then spike
- 3 mathematical traps: values at 2^31-1, MOD-1, perfect squares, consecutive primes
Generate NOVEL structures not seen before.`;
  } else if (retryRound === 3) {
    return base + `\n\n## RETRY ROUND 3 — Worst Case & Corner Combinations (Still no bug after 3 rounds)
Generate 15 MAXIMUM adversarial test cases targeting obscure bugs:
- 3 worst-case performance: maximum N with adversarial ordering (anti-quicksort, anti-mergesort patterns)
- 3 arithmetic corner cases: INT_MIN, INT_MAX, overflow in intermediate calculations, modular arithmetic edge
- 3 single-element variations: n=1 with max value, n=1 with 0, n=1 with negative
- 3 adjacent-difference traps: consecutive elements differing by 1, by max range, alternating +1/-1
- 3 completely random: truly random values and sizes within constraints
ALL must be COMPLETELY DIFFERENT from rounds 0-2.`;
  } else {
    return base + `\n\n## RETRY ROUND ${retryRound} — Desperation Mode (No bug found in ${retryRound} rounds)
Generate 15 EXTREME adversarial test cases. Think like a problem setter trying to break solutions:
- Craft inputs where naive vs optimal algorithms diverge
- Target subtle initialization bugs (uninitialized variables, wrong defaults)
- Target comparison bugs (<=  vs <, >= vs >)
- Target data type bugs (int vs long long, float precision)
- Include adversarial inputs for common algorithm mistakes (greedy vs DP, wrong sorting order)
EVERY test must be UNIQUE and NOVEL. Maximum creativity required.`;
  }
}

function extractJsonFromResponse(response: string): any {
  let cleaned = response.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
  try { return JSON.parse(cleaned); } catch { /* continue */ }

  const testCasesMatch = cleaned.match(/"test_cases"\s*:\s*\[/);
  if (testCasesMatch && testCasesMatch.index !== undefined) {
    const arrayStart = testCasesMatch.index + testCasesMatch[0].length;
    const completeObjects: string[] = [];
    let depth = 0, objStart = -1;
    for (let i = arrayStart; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (ch === '{') { if (depth === 0) objStart = i; depth++; }
      else if (ch === '}') { depth--; if (depth === 0 && objStart !== -1) { const obj = cleaned.substring(objStart, i + 1); try { JSON.parse(obj); completeObjects.push(obj); } catch { /* skip */ } objStart = -1; } }
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
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const auth = await validateAuth(req);
  if (!auth) {
    return unauthorizedResponse();
  }

  try {
    const { schema, runId, retryRound = 0 } = await req.json();

    const SYSTEM_PROMPT = getSystemPrompt(retryRound);
    const trimmedSchema = trimSchema(schema);
    const roundLabel = retryRound > 0 ? ` (retry round ${retryRound} of 4 — generate COMPLETELY DIFFERENT and HARDER tests than all previous rounds)` : "";
    const testCount = retryRound <= 1 ? "10-12" : "12-15";
    const userPrompt = `Generate test cases for this problem${roundLabel}:\n\n${JSON.stringify(trimmedSchema, null, 2)}\n\nGenerate ${testCount} targeted test cases. Each input must be a LITERAL string with \\n for newlines. Keep N ≤ 200.\n\nMUST include:\n- Edge cases (n=1, n=2, empty)\n- Large numbers (10^9, 2^31-1, overflow-prone sums)\n- All-identical values (all 0s, all 1s, all max)\n- Special numbers (0, -1, primes, powers of 2)\n- Random varied inputs${retryRound > 0 ? `\n\nPrevious ${retryRound} round(s) found NO bug — you MUST generate completely novel test structures targeting different bug types.` : ""}`;

    const { response, provider, model } = await callAIWithFailover({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      model: "google/gemini-2.5-flash",
      temperature: Math.min(0.4 + (retryRound * 0.15), 1.0),
      max_tokens: 6000,
    });

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      return new Response(JSON.stringify({ error: "No response from AI" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let parsed;
    try {
      parsed = extractJsonFromResponse(content);
    } catch {
      console.error("Failed to parse AI response:", content.substring(0, 300));
      return new Response(JSON.stringify({ error: "AI returned invalid JSON", raw: content.substring(0, 500) }), {
        status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
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
        status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (runId && parsed.test_cases.length > 0) {
      const testCaseRows = parsed.test_cases.map((tc: { input: string }) => ({
        run_id: runId, input_data: tc.input, is_failing: false,
      }));
      const { error: insertError } = await auth.supabase.from("test_cases").insert(testCaseRows);
      if (insertError) console.error("Failed to store test cases:", insertError);
      await auth.supabase.from("runs").update({ status: "tests_generated" }).eq("id", runId);
    }

    return new Response(JSON.stringify({ result: parsed, ai_provider: provider, ai_model: model }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-test-cases error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
