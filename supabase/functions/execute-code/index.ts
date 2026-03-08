import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders, validateAuth, unauthorizedResponse } from "../_shared/auth.ts";

const JUDGE0_URL = "https://ce.judge0.com";

const LANGUAGE_MAP: Record<string, number> = {
  cpp: 54,
  "c++": 54,
  c: 50,
  python: 71,
  py: 71,
  python3: 71,
  java: 62,
  javascript: 63,
  js: 63,
};

function toBase64(str: string): string {
  return btoa(unescape(encodeURIComponent(str)));
}

function fromBase64(str: string): string {
  try {
    return decodeURIComponent(escape(atob(str)));
  } catch {
    return atob(str);
  }
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

  const res = await fetch(
    `${JUDGE0_URL}/submissions/batch?base64_encoded=true`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ submissions: encoded }),
    }
  );

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

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise((r) => setTimeout(r, 1500));

    const res = await fetch(
      `${JUDGE0_URL}/submissions/batch?tokens=${tokenStr}&base64_encoded=true&fields=token,stdout,stderr,status,compile_output,time,memory`,
      { method: "GET" }
    );

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Judge0 poll failed [${res.status}]: ${errText}`);
    }

    const data = await res.json();
    const submissions = data.submissions || data;

    const allDone = submissions.every(
      (s: any) => s.status && s.status.id >= 3
    );

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

  // Validate authentication
  const auth = await validateAuth(req);
  if (!auth) {
    return unauthorizedResponse();
  }

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
      // Return 200 with error info so frontend can handle it
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

    // Build submissions: interleaved [buggy_tc1, correct_tc1, buggy_tc2, correct_tc2, ...]
    const submissions: { language_id: number; source_code: string; stdin: string }[] = [];
    for (const tc of validTestCases) {
      submissions.push({ language_id: langId, source_code: buggyCode, stdin: tc.input });
      submissions.push({ language_id: langId, source_code: correctCode, stdin: tc.input });
    }

    const BATCH_SIZE = 20;
    const allResults: any[] = [];

    for (let i = 0; i < submissions.length; i += BATCH_SIZE) {
      const batch = submissions.slice(i, i + BATCH_SIZE);
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

      let buggyStatus = "OK";
      if (buggyResult.status.id === 5) buggyStatus = "Time Limit Exceeded";
      else if (buggyResult.status.id === 6) buggyStatus = "Compilation Error";
      else if (buggyResult.status.id >= 7 && buggyResult.status.id <= 12) buggyStatus = "Runtime Error";
      else if (buggyResult.status.id !== 3) buggyStatus = buggyResult.status.description || "Error";

      let correctStatus = "OK";
      if (correctResult.status.id === 5) correctStatus = "Time Limit Exceeded";
      else if (correctResult.status.id === 6) correctStatus = "Compilation Error";
      else if (correctResult.status.id >= 7 && correctResult.status.id <= 12) correctStatus = "Runtime Error";
      else if (correctResult.status.id !== 3) correctStatus = correctResult.status.description || "Error";

      executionResults.push({
        test_case_index: i,
        test_case_id: validTestCases[i].id || null,
        input: validTestCases[i].input,
        buggy_output: buggyOutput,
        correct_output: correctOutput,
        buggy_status: buggyStatus,
        correct_status: correctStatus,
        buggy_stderr: buggyResult.stderr || null,
        correct_stderr: correctResult.stderr || null,
        buggy_time: buggyResult.time,
        correct_time: correctResult.time,
        is_failing: isFailing,
      });
    }

    // Return compilation errors with 200 so frontend can route to diagnosis
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

    // Store results in DB if runId provided using authenticated client
    if (runId) {
      for (const result of executionResults) {
        if (result.test_case_id) {
          await auth.supabase
            .from("test_cases")
            .update({
              output_buggy: result.buggy_output,
              output_correct: result.correct_output,
              is_failing: result.is_failing,
            })
            .eq("id", result.test_case_id);
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
