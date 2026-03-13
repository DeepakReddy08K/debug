/**
 * AI Provider Failover System
 * 
 * Chain: Lovable → Gemini 1 → Gemini 2 → Anthropic → OpenRouter Paid → OpenRouter Free
 * Automatically switches on 402/429/5xx errors.
 * Returns response, provider name, and model used.
 */

export interface AIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AIRequestOptions {
  messages: AIMessage[];
  model?: string;
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  response_format?: { type: string };
}

export interface AIFailoverResult {
  response: Response;
  provider: string;
  model: string;
}

interface ProviderConfig {
  name: string;
  keyEnvVar: string;
  getModel: (requestedModel?: string) => string;
  call: (options: AIRequestOptions, apiKey: string) => Promise<Response>;
}

// ─── Model Mapping ───────────────────────────────────────────────

function getLovableModel(requestedModel?: string): string {
  return requestedModel || "google/gemini-2.5-flash";
}

function getGeminiModel(requestedModel?: string): string {
  if (!requestedModel) return "gemini-2.5-flash";
  if (requestedModel.includes("gemini-2.5-pro") || requestedModel.includes("gpt-5")) return "gemini-2.5-pro";
  return "gemini-2.5-flash";
}

function getAnthropicModel(_requestedModel?: string): string {
  return "claude-sonnet-4-20250514";
}

function getOpenRouterPaidModel(requestedModel?: string): string {
  if (!requestedModel) return "google/gemini-2.5-flash";
  if (requestedModel.includes("gemini-2.5-pro") || requestedModel.includes("gpt-5")) return "google/gemini-2.5-pro";
  return "google/gemini-2.5-flash";
}

function getOpenRouterFreeModel(requestedModel?: string): string {
  if (!requestedModel) return "qwen/qwen3-coder:free";
  if (requestedModel.includes("gemini-2.5-pro") || requestedModel.includes("gpt-5")) return "deepseek/deepseek-r1-0528:free";
  return "qwen/qwen3-coder:free";
}

// Backup free models to try if primary free model is rate-limited
const FREE_MODEL_FALLBACKS = [
  "qwen/qwen3-coder:free",
  "deepseek/deepseek-r1-0528:free",
  "microsoft/mai-ds-r1:free",
  "google/gemma-3-27b-it:free",
];

// ─── Helper: Inject JSON instruction into system prompt ──────────
// For providers/models that don't natively support response_format
function injectJsonInstruction(messages: AIMessage[], responseFormat?: { type: string }): AIMessage[] {
  if (!responseFormat || responseFormat.type !== "json_object") return messages;
  
  return messages.map(m => {
    if (m.role === "system") {
      const hasJsonInstruction = m.content.includes("MUST respond with ONLY valid JSON") || 
                                  m.content.includes("respond with ONLY valid JSON");
      if (!hasJsonInstruction) {
        return {
          ...m,
          content: m.content + "\n\nCRITICAL: You MUST respond with ONLY valid JSON. No markdown, no code fences, no explanations outside the JSON."
        };
      }
    }
    return m;
  });
}

// ─── LOVABLE PROVIDER ────────────────────────────────────────────

async function callLovable(options: AIRequestOptions, apiKey: string): Promise<Response> {
  return await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: options.model || "google/gemini-2.5-flash",
      messages: options.messages,
      temperature: options.temperature ?? 0.3,
      ...(options.max_tokens ? { max_tokens: options.max_tokens } : {}),
      ...(options.stream ? { stream: true } : {}),
      ...(options.response_format ? { response_format: options.response_format } : {}),
    }),
  });
}

// ─── GOOGLE GEMINI PROVIDER (OpenAI-compatible) ──────────────────

async function callGemini(options: AIRequestOptions, apiKey: string): Promise<Response> {
  const model = getGeminiModel(options.model);
  return await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: options.messages,
      temperature: options.temperature ?? 0.3,
      ...(options.max_tokens ? { max_tokens: options.max_tokens } : {}),
      ...(options.stream ? { stream: true } : {}),
      ...(options.response_format ? { response_format: options.response_format } : {}),
    }),
  });
}

// ─── ANTHROPIC CLAUDE PROVIDER ───────────────────────────────────

async function callAnthropic(options: AIRequestOptions, apiKey: string): Promise<Response> {
  const model = getAnthropicModel(options.model);

  const systemMsg = options.messages.find(m => m.role === "system")?.content || "";
  const conversationMsgs = options.messages
    .filter(m => m.role !== "system")
    .map(m => ({ role: m.role as "user" | "assistant", content: m.content }));

  let effectiveSystem = systemMsg;
  if (options.response_format?.type === "json_object") {
    effectiveSystem += "\n\nIMPORTANT: You MUST respond with ONLY valid JSON. No markdown, no code fences, no explanations outside the JSON.";
  }

  if (options.stream) {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        system: effectiveSystem,
        messages: conversationMsgs,
        max_tokens: options.max_tokens || 4096,
        temperature: options.temperature ?? 0.3,
        stream: true,
      }),
    });

    if (!resp.ok) return resp;

    // Transform Anthropic SSE → OpenAI-compatible SSE
    const reader = resp.body!.getReader();
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const stream = new ReadableStream({
      async start(controller) {
        let buffer = "";
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.close();
              break;
            }
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;
              const jsonStr = line.slice(6).trim();
              if (!jsonStr) continue;
              try {
                const event = JSON.parse(jsonStr);
                if (event.type === "content_block_delta" && event.delta?.text) {
                  const chunk = {
                    choices: [{ delta: { content: event.delta.text }, index: 0 }],
                  };
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
                }
              } catch { /* skip */ }
            }
          }
        } catch (e) {
          controller.error(e);
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  }

  // Non-streaming
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      system: effectiveSystem,
      messages: conversationMsgs,
      max_tokens: options.max_tokens || 4096,
      temperature: options.temperature ?? 0.3,
    }),
  });

  if (!resp.ok) return resp;

  const data = await resp.json();
  const textContent = data.content
    ?.filter((c: any) => c.type === "text")
    ?.map((c: any) => c.text)
    ?.join("") || "";

  return new Response(
    JSON.stringify({ choices: [{ message: { role: "assistant", content: textContent } }] }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

// ─── OPENROUTER PROVIDER ────────────────────────────────────────

async function callOpenRouter(options: AIRequestOptions, apiKey: string, modelFn: (m?: string) => string): Promise<Response> {
  const model = modelFn(options.model);
  
  // Free models may not support response_format — inject JSON instruction instead
  const isFreeModel = model.endsWith(":free");
  let messages = options.messages;
  if (isFreeModel && options.response_format?.type === "json_object") {
    messages = injectJsonInstruction(messages, options.response_format);
  }

  // Cap max_tokens for OpenRouter to avoid 402 credit errors
  // Paid models: cap at 8192; Free models: cap at 4096
  const maxTokensCap = isFreeModel ? 4096 : 8192;
  const cappedMaxTokens = options.max_tokens ? Math.min(options.max_tokens, maxTokensCap) : maxTokensCap;

  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: options.temperature ?? 0.3,
    max_tokens: cappedMaxTokens,
    // IMPORTANT: Never request streaming for paid models to allow body-level error detection
    // For free models, respect the stream flag
    ...(options.stream ? { stream: true } : {}),
    // Only pass response_format for paid models that support it
    ...(!isFreeModel && options.response_format ? { response_format: options.response_format } : {}),
  };

  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://debugforcompetitiveprogramming.lovable.app",
      "X-Title": "Debug for CP",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) return resp;

  // ─── CRITICAL: Detect hidden errors in 200 responses ──────────
  // OpenRouter sometimes returns HTTP 200 with {"error": {...}} in body.
  // We must detect this and convert to a proper error response so failover continues.

  // For non-streaming responses, check body for errors
  if (!options.stream) {
    const data = await resp.json();
    
    // Check for OpenRouter error objects hidden in 200 responses
    if (data.error) {
      const errorCode = data.error.code || data.error.status || 502;
      const errorMsg = data.error.message || JSON.stringify(data.error);
      console.warn(`[OpenRouter] Hidden error in 200 response (model: ${model}): ${errorCode} - ${errorMsg}`);
      return new Response(
        JSON.stringify({ error: data.error }),
        { status: typeof errorCode === "number" ? errorCode : 502, headers: { "Content-Type": "application/json" } },
      );
    }

    // Check for empty/missing choices (another failure mode)
    if (!data.choices || data.choices.length === 0 || !data.choices[0]?.message?.content) {
      console.warn(`[OpenRouter] Empty response from model: ${model}`);
      return new Response(
        JSON.stringify({ error: { message: "Empty response from model", code: 502 } }),
        { status: 502, headers: { "Content-Type": "application/json" } },
      );
    }

    // For free models, clean thinking tags
    if (isFreeModel) {
      let content = data.choices[0].message.content || "";
      content = content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
      return new Response(
        JSON.stringify({ ...data, choices: [{ ...data.choices[0], message: { ...data.choices[0].message, content } }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    // Paid model success — return reconstructed response
    return new Response(
      JSON.stringify(data),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  // For streaming responses, peek at the first chunk to detect errors
  if (options.stream && resp.body) {
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    
    // Read first chunk to check for errors
    const firstRead = await reader.read();
    if (firstRead.done) {
      console.warn(`[OpenRouter] Empty stream from model: ${model}`);
      return new Response(
        JSON.stringify({ error: { message: "Empty stream", code: 502 } }),
        { status: 502, headers: { "Content-Type": "application/json" } },
      );
    }

    const firstChunk = decoder.decode(firstRead.value, { stream: true });
    
    // Check if the first chunk is a JSON error (not SSE format)
    if (!firstChunk.startsWith("data:") && !firstChunk.startsWith(":")) {
      try {
        const errorData = JSON.parse(firstChunk.trim());
        if (errorData.error) {
          const errorCode = errorData.error.code || errorData.error.status || 502;
          console.warn(`[OpenRouter] Hidden stream error (model: ${model}): ${JSON.stringify(errorData.error).substring(0, 200)}`);
          return new Response(
            JSON.stringify({ error: errorData.error }),
            { status: typeof errorCode === "number" ? errorCode : 502, headers: { "Content-Type": "application/json" } },
          );
        }
      } catch {
        // Not JSON, might be valid SSE without "data:" prefix — continue
      }
    }

    // Check for error in SSE data lines
    const sseLines = firstChunk.split("\n");
    for (const line of sseLines) {
      if (line.startsWith("data: ") && line.includes('"error"')) {
        try {
          const sseData = JSON.parse(line.slice(6).trim());
          if (sseData.error) {
            const errorCode = sseData.error.code || sseData.error.status || 502;
            console.warn(`[OpenRouter] SSE error (model: ${model}): ${JSON.stringify(sseData.error).substring(0, 200)}`);
            return new Response(
              JSON.stringify({ error: sseData.error }),
              { status: typeof errorCode === "number" ? errorCode : 502, headers: { "Content-Type": "application/json" } },
            );
          }
        } catch { /* not an error line */ }
      }
    }

    // First chunk is valid — create a new stream that starts with it
    let inThinking = false;
    const stream = new ReadableStream({
      async start(controller) {
        // Process the first chunk we already read
        let buffer = firstChunk;
        
        const processBuffer = () => {
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const jsonStr = line.slice(6).trim();
            if (jsonStr === "[DONE]") {
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              continue;
            }
            if (!jsonStr) continue;
            try {
              const parsed = JSON.parse(jsonStr);
              let content = parsed.choices?.[0]?.delta?.content || "";
              
              if (isFreeModel) {
                // Track <think> blocks and suppress them
                if (content.includes("<think>")) { inThinking = true; content = content.replace(/<think>[\s\S]*/g, ""); }
                if (inThinking) {
                  if (content.includes("</think>")) {
                    inThinking = false;
                    content = content.replace(/[\s\S]*<\/think>/g, "");
                  } else {
                    continue;
                  }
                }
              }
              
              if (content) {
                const chunk = { choices: [{ delta: { content }, index: 0 }] };
                controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
              }
            } catch { /* skip */ }
          }
        };

        try {
          processBuffer(); // Process first chunk
          
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.close();
              break;
            }
            buffer += decoder.decode(value, { stream: true });
            processBuffer();
          }
        } catch (e) {
          controller.error(e);
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  }

  return resp;
}

// ─── PROVIDER CHAIN ──────────────────────────────────────────────
// Order: Lovable → Gemini 1 → Gemini 2 → Anthropic → OpenRouter Paid → OpenRouter Free

const PROVIDERS: ProviderConfig[] = [
  {
    name: "Lovable",
    keyEnvVar: "LOVABLE_API_KEY",
    getModel: getLovableModel,
    call: callLovable,
  },
  {
    name: "Google Gemini",
    keyEnvVar: "GEMINI_API_KEY",
    getModel: getGeminiModel,
    call: callGemini,
  },
  {
    name: "Google Gemini 2",
    keyEnvVar: "GEMINI_API_KEY_2",
    getModel: getGeminiModel,
    call: callGemini,
  },
  {
    name: "Anthropic Claude",
    keyEnvVar: "ANTHROPIC_API_KEY",
    getModel: getAnthropicModel,
    call: callAnthropic,
  },
  {
    name: "OpenRouter Paid",
    keyEnvVar: "OPENROUTER_API_KEY",
    getModel: getOpenRouterPaidModel,
    call: (opts, key) => callOpenRouter(opts, key, getOpenRouterPaidModel),
  },
  ...FREE_MODEL_FALLBACKS.map((freeModel, i) => ({
    name: `OpenRouter Free${i > 0 ? ` (${freeModel.split("/")[0]})` : ""}`,
    keyEnvVar: "OPENROUTER_API_KEY",
    getModel: () => freeModel,
    call: (opts: AIRequestOptions, key: string) => callOpenRouter(opts, key, () => freeModel),
  })),
];

// ─── FAILOVER ENGINE ─────────────────────────────────────────────

export async function callAIWithFailover(options: AIRequestOptions): Promise<AIFailoverResult> {
  const errors: string[] = [];

  for (const provider of PROVIDERS) {
    const apiKey = Deno.env.get(provider.keyEnvVar);
    if (!apiKey) {
      errors.push(`${provider.name}: no API key configured`);
      continue;
    }

    try {
      console.log(`[AI Failover] Trying ${provider.name}...`);
      const response = await provider.call(options, apiKey);

      if (response.ok) {
        const modelUsed = `${provider.name}/${provider.getModel(options.model)}`;
        console.log(`[AI Failover] ✓ ${provider.name} succeeded (model: ${modelUsed})`);
        return { response, provider: provider.name, model: modelUsed };
      }

      // Failover on auth/credits/rate-limit/quota/server errors
      const failoverStatuses = [401, 402, 403, 429];
      if (failoverStatuses.includes(response.status) || response.status >= 500) {
        const errText = await response.text();
        errors.push(`${provider.name}: HTTP ${response.status} - ${errText.substring(0, 200)}`);
        console.warn(`[AI Failover] ✗ ${provider.name} returned ${response.status}, trying next...`);
        continue;
      }

      // For other 4xx errors, also failover for OpenRouter (model-specific issues)
      // and for any provider returning 400 (bad request can be model-specific)
      const errText = await response.text();
      errors.push(`${provider.name}: HTTP ${response.status} - ${errText.substring(0, 200)}`);
      if (response.status === 400) {
        console.warn(`[AI Failover] ✗ ${provider.name} returned 400, trying next...`);
        continue;
      }
      // For other unexpected 4xx, still try next provider rather than throwing
      console.warn(`[AI Failover] ✗ ${provider.name} returned ${response.status}, trying next...`);
      continue;
    } catch (e) {
      errors.push(`${provider.name}: ${e instanceof Error ? e.message : "Unknown error"}`);
      console.warn(`[AI Failover] ✗ ${provider.name} threw error, trying next...`);
      continue;
    }
  }

  console.error("[AI Failover] All providers failed:", errors);
  throw new Error(`All AI providers failed:\n${errors.join("\n")}`);
}
