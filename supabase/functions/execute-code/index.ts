import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const JUDGE0_HOST = "judge0-extra-ce1.p.rapidapi.com";
const JUDGE0_URL = `https://${JUDGE0_HOST}`;

// Language mapping for Judge0 Extra CE
const LANGUAGE_MAP: Record<string, number> = {
  cpp: 54,      // C++ (GCC 9.2.0)
  "c++": 54,
  c: 50,        // C (GCC 9.2.0)
  python: 71,   // Python (3.8.1)
  py: 71,
  python3: 71,
  java: 62,     // Java (OpenJDK 13.0.1)
  javascript: 63, // JavaScript (Node.js 12.14.0)
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

// Submit a batch of submissions to Judge0
async function submitBatch(
  submissions: { language_id: number; source_code: string; stdin: string }[],
  apiKey: string
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
      headers: {
        "Content-Type": "application/json",
        "x-rapidapi-host": JUDGE0_HOST,
        "x-rapidapi-key": apiKey,
      },
      body: JSON.stringify({ submissions: encoded }),
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Judge0 submit failed [${res.status}]: ${errText}`);
  }

  return await res.json();
}

// Poll for results until all are done
async function pollResults(
  tokens: string[],
  apiKey: string,
  maxAttempts = 30
): Promise<Record<string, any>[]> {
  const tokenStr = tokens.join(",");

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise((r) => setTimeout(r, 1500));

    const res = await fetch(
      `${JUDGE0_URL}/submissions/batch?tokens=${tokenStr}&base64_encoded=true&fields=token,stdout,stderr,status,compile_output,time,memory`,
      {
        method: "GET",
        headers: {
          "x-rapidapi-host": JUDGE0_HOST,
          "x-rapidapi-key": apiKey,
        },
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Judge0 poll failed [${res.status}]: ${errText}`);
    }

    const data = await res.json();
    const submissions = data.submissions || data;
    
    // Check if all are done (status.id >= 3 means finished)
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

  try {
    const { buggyCode, correctCode, language, testCases, runId } = await req.json();

    const JUDGE0_KEY = Deno.env.get("JUDGE0_RAPIDAPI_KEY");
    if (!JUDGE0_KEY) {
      throw new Error("JUDGE0_RAPIDAPI_KEY is not configured");
    }

    const langId = LANGUAGE_MAP[language?.toLowerCase()] || LANGUAGE_MAP["cpp"];

    if (!testCases || !Array.isArray(testCases) || testCases.length === 0) {
      throw new Error("No test cases provided");
    }

    // Validate test case inputs have content
    const validTestCases = testCases.filter(
      (tc: any) => tc.input && tc.input.trim().length > 0
    );

    if (validTestCases.length === 0) {
      return new Response(
        JSON.stringify({
          error: "invalid_inputs",
          message: "All test case inputs are empty or invalid. Re-analyze the problem.",
          retry_branch1: true,
        }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build submissions: for each test case, submit both buggy and correct code
    // Interleaved: [buggy_tc1, correct_tc1, buggy_tc2, correct_tc2, ...]
    const submissions: { language_id: number; source_code: string; stdin: string }[] = [];
    for (const tc of validTestCases) {
      submissions.push({ language_id: langId, source_code: buggyCode, stdin: tc.input });
      submissions.push({ language_id: langId, source_code: correctCode, stdin: tc.input });
    }

    // Judge0 batch limit is typically 20 submissions at a time
    const BATCH_SIZE = 20;
    const allResults: any[] = [];

    for (let i = 0; i < submissions.length; i += BATCH_SIZE) {
      const batch = submissions.slice(i, i + BATCH_SIZE);
      const tokens = await submitBatch(batch, JUDGE0_KEY);
      const tokenList = tokens.map((t: any) => t.token);
      const results = await pollResults(tokenList, JUDGE0_KEY);
      allResults.push(...results);
    }

    // Parse results into structured output
    const executionResults: any[] = [];
    let hasCompileError = false;
    let compileErrorMsg = "";

    for (let i = 0; i < validTestCases.length; i++) {
      const buggyResult = allResults[i * 2];
      const correctResult = allResults[i * 2 + 1];

      // Check for compilation errors
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

      // Build status description
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

    // If compilation error, signal to retry Branch 1
    if (hasCompileError) {
      return new Response(
        JSON.stringify({
          error: "compilation_error",
          message: compileErrorMsg,
          retry_branch1: true,
          results: executionResults,
        }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const failingCases = executionResults.filter((r) => r.is_failing);
    const firstFailing = failingCases.length > 0 ? failingCases[0] : null;

    // Store results in DB if runId is provided
    if (runId) {
      const authHeader = req.headers.get("Authorization");
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
      const supabase = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: authHeader ? { Authorization: authHeader } : {} },
      });

      // Update each test case with execution outputs
      for (const result of executionResults) {
        if (result.test_case_id) {
          await supabase
            .from("test_cases")
            .update({
              output_buggy: result.buggy_output,
              output_correct: result.correct_output,
              is_failing: result.is_failing,
            })
            .eq("id", result.test_case_id);
        }
      }

      // Update run with first failing input and outputs
      const updatePayload: Record<string, any> = {
        status: failingCases.length > 0 ? "failing_found" : "all_passed",
      };

      if (firstFailing) {
        updatePayload.failing_input = firstFailing.input;
        updatePayload.output_buggy = firstFailing.buggy_output;
        updatePayload.output_correct = firstFailing.correct_output;
      }

      await supabase.from("runs").update(updatePayload).eq("id", runId);
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
