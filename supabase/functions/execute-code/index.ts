import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, validateAuth, unauthorizedResponse } from "../_shared/auth.ts";

// Primary: RapidAPI (100 free/day, faster)
// Fallback: Public CE (unlimited, may rate-limit)
const RAPIDAPI_URL = "https://judge0-ce.p.rapidapi.com";
const FREE_CE_URL = "https://ce.judge0.com";
const RAPIDAPI_KEY = Deno.env.get("JUDGE0_RAPIDAPI_KEY") || "";

// Simple in-memory tracker for RapidAPI quota (resets on function cold start / daily)
let rapidApiFailedAt: number | null = null;
const QUOTA_RESET_MS = 60 * 60 * 1000; // Try RapidAPI again after 1 hour

function shouldUseRapidApi(): boolean {
  if (!RAPIDAPI_KEY) return false;
  if (!rapidApiFailedAt) return true;
  // If it's been over an hour since failure, try RapidAPI again
  if (Date.now() - rapidApiFailedAt > QUOTA_RESET_MS) {
    rapidApiFailedAt = null;
    return true;
  }
  return false;
}

function getEndpoint(): { url: string; headers: Record<string, string>; label: string } {
  if (shouldUseRapidApi()) {
    return {
      url: RAPIDAPI_URL,
      headers: {
        "Content-Type": "application/json",
        "X-RapidAPI-Key": RAPIDAPI_KEY,
        "X-RapidAPI-Host": "judge0-ce.p.rapidapi.com",
      },
      label: "RapidAPI",
    };
  }
  return {
    url: FREE_CE_URL,
    headers: { "Content-Type": "application/json" },
    label: "FreeCE",
  };
}

const LANGUAGE_MAP: Record<string, number> = {
  cpp: 54, "c++": 54, c: 50,
  python: 71, py: 71, python3: 71,
  java: 62, javascript: 63, js: 63,
};

function toBase64(str: string): string {
  return btoa(unescape(encodeURIComponent(str)));
}

function fromBase64(str: string): string {
  try { return decodeURIComponent(escape(atob(str))); }
  catch { return atob(str); }
}

async function submitBatch(
  submissions: { language_id: number; source_code: string; stdin: string }[]
): Promise<{ token: string }[]> {
  const encoded = submissions.map((s) => ({
    language_id: s.language_id,
    source_code: toBase64(s.source_code),
    stdin: toBase64(s.stdin),
    cpu_time_limit: 5,
    memory_limit: 256000,
  }));

  // Try primary endpoint
  let endpoint = getEndpoint();
  console.log(`[submit] Using ${endpoint.label}`);

  let res = await fetch(`${endpoint.url}/submissions/batch?base64_encoded=true`, {
    method: "POST",
    headers: endpoint.headers,
    body: JSON.stringify({ submissions: encoded }),
  });

  // If RapidAPI quota exceeded (429/403), switch to free CE
  if (!res.ok && endpoint.label === "RapidAPI" && (res.status === 429 || res.status === 403)) {
    console.log(`[submit] RapidAPI returned ${res.status}, switching to FreeCE`);
    rapidApiFailedAt = Date.now();
    endpoint = getEndpoint(); // Now returns FreeCE

    res = await fetch(`${endpoint.url}/submissions/batch?base64_encoded=true`, {
      method: "POST",
      headers: endpoint.headers,
      body: JSON.stringify({ submissions: encoded }),
    });
  }

  // If free CE also rate-limits, retry with backoff
  if (!res.ok && (res.status === 429 || res.status >= 500)) {
    for (let retry = 0; retry < 3; retry++) {
      console.log(`[submit] ${endpoint.label} returned ${res.status}, retry ${retry + 1}/3...`);
      await new Promise((r) => setTimeout(r, 2000 * (retry + 1)));
      res = await fetch(`${endpoint.url}/submissions/batch?base64_encoded=true`, {
        method: "POST",
        headers: endpoint.headers,
        body: JSON.stringify({ submissions: encoded }),
      });
      if (res.ok) break;
    }
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Judge0 submit failed [${res.status}]: ${errText}`);
  }

  return await res.json();
}

async function pollResults(
  tokens: string[],
  maxAttempts = 30
): Promise<Record<string, any>[]> {
  const tokenStr = tokens.join(",");
  const endpoint = getEndpoint();
  const pollHeaders = { ...endpoint.headers };
  delete pollHeaders["Content-Type"]; // GET requests don't need it

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise((r) => setTimeout(r, 2000));

    let res: Response;
    try {
      res = await fetch(
        `${endpoint.url}/submissions/batch?tokens=${tokenStr}&base64_encoded=true&fields=token,stdout,stderr,status,compile_output,time,memory`,
        { method: "GET", headers: pollHeaders }
      );
    } catch (e) {
      console.error(`[poll] Attempt ${attempt} network error:`, e);
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }

    // If rate-limited during polling, wait longer and retry
    if (res.status === 429 || res.status >= 500) {
      console.log(`[poll] ${endpoint.label} returned ${res.status}, waiting...`);
      await res.text(); // consume body
      await new Promise((r) => setTimeout(r, 3000 * (attempt > 5 ? 2 : 1)));
      continue;
    }

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Judge0 poll failed [${res.status}]: ${errText}`);
    }

    const data = await res.json();
    const submissions = data.submissions || data;

    const allDone = submissions.every((s: any) => s.status && s.status.id >= 3);
    if (allDone) {
      return submissions.map((s: any) => ({
        token: s.token,
        stdout: s.stdout ? fromBase64(s.stdout) : null,
        stderr: s.stderr ? fromBase64(s.stderr) : null,
        compile_output: s.compile_output ? fromBase64(s.compile_output) : null,
        status: s.status,
        time: s.time,
        memory: s.memory,
      }));
    }
  }

  throw new Error("Judge0 execution timed out after polling");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const auth = await validateAuth(req);
  if (!auth) return unauthorizedResponse();

  try {
    const { buggyCode, correctCode, language, testCases, runId } = await req.json();
    const langId = LANGUAGE_MAP[language?.toLowerCase()] || LANGUAGE_MAP["cpp"];

    if (!testCases || !Array.isArray(testCases) || testCases.length === 0) {
      throw new Error("No test cases provided");
    }

    const validTestCases = testCases.filter(
      (tc: any) => tc.input && tc.input.trim().length > 0
    );

    if (validTestCases.length === 0) {
      return new Response(
        JSON.stringify({
          compilation_error: true,
          message: "All test case inputs are empty or invalid. Re-analyze the problem.",
          results: [],
          summary: { total: 0, passing: 0, failing: 0, first_failing: null },
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build interleaved submissions [buggy_tc1, correct_tc1, ...]
    const submissions: { language_id: number; source_code: string; stdin: string }[] = [];
    for (const tc of validTestCases) {
      submissions.push({ language_id: langId, source_code: buggyCode, stdin: tc.input });
      submissions.push({ language_id: langId, source_code: correctCode, stdin: tc.input });
    }

    const BATCH_SIZE = 10;
    const allResults: any[] = [];

    for (let i = 0; i < submissions.length; i += BATCH_SIZE) {
      const batch = submissions.slice(i, i + BATCH_SIZE);
      if (i > 0) await new Promise((r) => setTimeout(r, 1500));
      const tokens = await submitBatch(batch);
      const tokenList = tokens.map((t: any) => t.token);
      const results = await pollResults(tokenList);
      allResults.push(...results);
    }

    // Parse results
    const executionResults: any[] = [];
    let hasCompileError = false;
    let compileErrorMsg = "";

    for (let i = 0; i < validTestCases.length; i++) {
      const buggyResult = allResults[i * 2];
      const correctResult = allResults[i * 2 + 1];

      if (buggyResult.status.id === 6) {
        hasCompileError = true;
        compileErrorMsg = buggyResult.compile_output || "Compilation error in buggy code";
      }
      if (correctResult.status.id === 6) {
        hasCompileError = true;
        compileErrorMsg = correctResult.compile_output || "Compilation error in correct code";
      }

      const buggyOutput = buggyResult.stdout?.trim() || "";
      const correctOutput = correctResult.stdout?.trim() || "";
      const isFailing = buggyOutput !== correctOutput;

      const getStatus = (r: any) => {
        if (r.status.id === 5) return "Time Limit Exceeded";
        if (r.status.id === 6) return "Compilation Error";
        if (r.status.id >= 7 && r.status.id <= 12) return "Runtime Error";
        if (r.status.id !== 3) return r.status.description || "Error";
        return "OK";
      };

      executionResults.push({
        test_case_index: i,
        test_case_id: validTestCases[i].id || null,
        input: validTestCases[i].input,
        buggy_output: buggyOutput,
        correct_output: correctOutput,
        buggy_status: getStatus(buggyResult),
        correct_status: getStatus(correctResult),
        buggy_stderr: buggyResult.stderr || null,
        correct_stderr: correctResult.stderr || null,
        buggy_time: buggyResult.time,
        correct_time: correctResult.time,
        is_failing: isFailing,
      });
    }

    if (hasCompileError) {
      const failingCases = executionResults.filter((r) => r.is_failing);
      return new Response(
        JSON.stringify({
          compilation_error: true,
          message: compileErrorMsg,
          results: executionResults,
          summary: {
            total: executionResults.length,
            passing: executionResults.length - failingCases.length,
            failing: failingCases.length,
            first_failing: failingCases.length > 0 ? failingCases[0] : null,
          },
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const failingCases = executionResults.filter((r) => r.is_failing);
    const firstFailing = failingCases.length > 0 ? failingCases[0] : null;

    if (runId) {
      for (const result of executionResults) {
        if (result.test_case_id) {
          await auth.supabase.from("test_cases").update({
            output_buggy: result.buggy_output,
            output_correct: result.correct_output,
            is_failing: result.is_failing,
          }).eq("id", result.test_case_id);
        }
      }
      const updatePayload: Record<string, any> = {
        status: failingCases.length > 0 ? "failing_found" : "all_passed",
      };
      if (firstFailing) {
        updatePayload.failing_input = firstFailing.input;
        updatePayload.output_buggy = firstFailing.buggy_output;
        updatePayload.output_correct = firstFailing.correct_output;
      }
      await auth.supabase.from("runs").update(updatePayload).eq("id", runId);
    }

    return new Response(
      JSON.stringify({
        results: executionResults,
        summary: {
          total: executionResults.length,
          passing: executionResults.length - failingCases.length,
          failing: failingCases.length,
          first_failing: firstFailing,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("execute-code error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
