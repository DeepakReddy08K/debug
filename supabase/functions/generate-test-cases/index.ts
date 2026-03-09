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
    return base + `

## RETRY ROUND 0 — Standard Adversarial Coverage
Generate 8-10 test cases covering all 8 categories:
- 1-2 boundary cases (n=1, n=2, n=max)
- 2-3 overflow-targeted cases (10^9 values, sum overflow, product overflow)
- 1-2 off-by-one cases (index edges, subarray boundaries)
- 1 duplicate/repeated value case
- 1 mathematical trap (primes, powers of 2, GCD/LCM)
- 1 string case (if strings are input)
- 1 multi-test-case trap (if applicable)
- 1 graph/tree case (if applicable)

Each test case should target a specific subtle bug. MUST respect constraints. NO constraint violations.`;
  } else if (retryRound === 1) {
    return base + `

## RETRY ROUND 1 — Aggressive Overflow Focus (Previous tests found NO bug)
Generate 10-12 adversarial test cases HEAVILY FOCUSED on integer overflow:
- 3-4 pure overflow cases: all a[i]=10^9, n=10^5; large sums; products of large numbers; answer exceeding 2^31-1
- 2 boundary cases at absolute max constraints: n=max, all values=10^9
- 2 off-by-one cases: index 0/n-1, loop boundary tests
- 1 duplicate case with overflow implications
- 1 mathematical: values just below 2^31-1, GCD edge cases
- 1 alternating min-max pattern across large N
- 1 multi-test-case case with accumulated state

DO NOT repeat previous test cases. Generate HARDER overflow scenarios. Focus on cases where int32 overflow manifests.`;
  } else {
    return base + `

## RETRY ROUND ${retryRound} — Maximum Adversarial (Still no bug found)
Generate 12-15 MAXIMUM adversarial test cases targeting every known competitive programming pitfall:
- 4-5 PURE OVERFLOW: edge cases like 2^31-2, 2^31-1, 10^9 * 10^9, cumulative sums, modular arithmetic traps
- 2-3 OFF-BY-ONE: exact boundaries, loop iterations, array indices, subarray edge lengths (1, n, n-1)
- 2 DUPLICATES: all same values, two distinct values only, MEX/partition sensitive
- 1-2 WORST-CASE PATTERNS: reverse sorted for comparison sorts, already sorted for quicksort, alternating for partitions
- 1-2 MATHEMATICAL EDGE: powers of 2, primes, GCD=1 (coprime), large differences
- 1 STRING: if applicable — palindrome, all same char, max length
- 1 GRAPH/TREE: if applicable — linear chain, star, complete graph
- 1-2 MULTI-TEST-CASE: if applicable — t=max, state reset bugs, sum-of-n limits

Generate COMPLETELY DIFFERENT test cases from previous rounds. Focus on adversarial patterns where buggy logic WILL fail.`;
  }
}

function extractJsonFromResponse(response: string): any {
  let cleaned = response
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    // continue to repair
  }

  const testCasesMatch = cleaned.match(/"test_cases"\s*:\s*\[/);
  if (testCasesMatch && testCasesMatch.index !== undefined) {
    const arrayStart = testCasesMatch.index + testCasesMatch[0].length;
    const completeObjects: string[] = [];
    let depth = 0;
    let objStart = -1;

    for (let i = arrayStart; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (ch === '{') {
        if (depth === 0) objStart = i;
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0 && objStart !== -1) {
          const obj = cleaned.substring(objStart, i + 1);
          try {
            JSON.parse(obj);
            completeObjects.push(obj);
          } catch {
            // incomplete object, skip
          }
          objStart = -1;
        }
      }
    }

    if (completeObjects.length > 0) {
      const reconstructed = `{"test_cases":[${completeObjects.join(",")}],"total_count":${completeObjects.length},"generation_notes":"Recovered from truncated response"}`;
      return JSON.parse(reconstructed);
    }
  }

  const jsonStart = cleaned.search(/[\{\[]/);
  const jsonEnd = Math.max(cleaned.lastIndexOf("}"), cleaned.lastIndexOf("]"));
  if (jsonStart === -1 || jsonEnd === -1) throw new Error("No JSON found in response");

  cleaned = cleaned.substring(jsonStart, jsonEnd + 1);
  cleaned = cleaned
    .replace(/,\s*}/g, "}")
    .replace(/,\s*]/g, "]")
    .replace(/[\x00-\x1F\x7F]/g, (c) => c === "\n" || c === "\t" ? c : "");

  let braces = 0, brackets = 0;
  for (const ch of cleaned) {
    if (ch === '{') braces++;
    if (ch === '}') braces--;
    if (ch === '[') brackets++;
    if (ch === ']') brackets--;
  }
  while (brackets > 0) { cleaned += ']'; brackets--; }
  while (braces > 0) { cleaned += '}'; braces--; }
  cleaned = cleaned.replace(/,\s*}/g, "}").replace(/,\s*]/g, "]");

  return JSON.parse(cleaned);
}

function trimSchema(schema: any): any {
  const trimmed: any = {};
  if (schema.problem_meta) {
    trimmed.problem_meta = { name: schema.problem_meta.name, problem_type: schema.problem_meta.problem_type };
  }
  if (schema.input_structure) {
    trimmed.input_structure = schema.input_structure;
  }
  if (schema.output_structure) {
    trimmed.output_structure = schema.output_structure;
  }
  if (schema.ai_generation_prompt_hint) {
    trimmed.hint = schema.ai_generation_prompt_hint;
  }
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
    const roundLabel = retryRound > 0 ? ` (retry round ${retryRound} — generate DIFFERENT and HARDER tests than before, focus on overflow/edge cases)` : "";
    const userPrompt = `Generate test cases for this problem${roundLabel}:\n\n${JSON.stringify(trimmedSchema, null, 2)}\n\nGenerate 8-10 diverse test cases. Each input must be a literal string. Keep N ≤ 200.${retryRound > 0 ? " Previous basic tests found no bug — try harder edge cases, overflow scenarios, and adversarial inputs." : ""}`;

    const response = await callAIWithFailover({
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      model: "google/gemini-2.5-flash",
      temperature: retryRound === 0 ? 0.4 : 0.7 + (retryRound * 0.1),
      max_tokens: 4000,
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
        const hasCode = /\b(map|join|range|lambda|for |import |list\(|\.join\()\b/.test(tc.input);
        return !hasCode;
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
        run_id: runId,
        input_data: tc.input,
        is_failing: false,
      }));

      const { error: insertError } = await auth.supabase.from("test_cases").insert(testCaseRows);
      if (insertError) console.error("Failed to store test cases:", insertError);

      await auth.supabase.from("runs").update({ status: "tests_generated" }).eq("id", runId);
    }

    return new Response(JSON.stringify({ result: parsed }), {
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
