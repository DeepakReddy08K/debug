/**
 * AI Provider Failover System
 * 
 * Tries providers in order: Lovable → Google Gemini → Anthropic Claude
 * Automatically switches on 402 (credits exhausted), 429 (rate limit), or 5xx errors.
 * Returns both the response and which provider was used.
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

// Model mapping for each provider
function getGeminiModel(requestedModel?: string): string {
  if (!requestedModel) return "gemini-2.5-flash";
  if (requestedModel.includes("gemini-3-flash")) return "gemini-2.5-flash";
  if (requestedModel.includes("gemini-2.5-flash")) return "gemini-2.5-flash";
  if (requestedModel.includes("gemini-2.5-pro")) return "gemini-2.5-pro";
  if (requestedModel.includes("gpt-5")) return "gemini-2.5-pro";
  return "gemini-2.5-flash";
}

function getAnthropicModel(_requestedModel?: string): string {
  return "claude-sonnet-4-20250514";
}

function getLovableModel(requestedModel?: string): string {
  return requestedModel || "google/gemini-2.5-flash";
}

// --- LOVABLE PROVIDER ---
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

// --- GOOGLE GEMINI PROVIDER (OpenAI-compatible endpoint) ---
async function callGemini(options: AIRequestOptions, apiKey: string): Promise<Response> {
  const model = getGeminiModel(options.model);
  
  return await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: model,
      messages: options.messages,
      temperature: options.temperature ?? 0.3,
      ...(options.max_tokens ? { max_tokens: options.max_tokens } : {}),
      ...(options.stream ? { stream: true } : {}),
      ...(options.response_format ? { response_format: options.response_format } : {}),
    }),
  });
}

// --- ANTHROPIC CLAUDE PROVIDER ---
async function callAnthropic(options: AIRequestOptions, apiKey: string): Promise<Response> {
  const model = getAnthropicModel(options.model);
  
  // Separate system message from conversation messages
  const systemMsg = options.messages.find(m => m.role === "system")?.content || "";
  const conversationMsgs = options.messages
    .filter(m => m.role !== "system")
    .map(m => ({ role: m.role as "user" | "assistant", content: m.content }));

  // For Anthropic, if response_format is json_object, add instruction to system prompt
  let effectiveSystem = systemMsg;
  if (options.response_format?.type === "json_object") {
    effectiveSystem += "\n\nIMPORTANT: You MUST respond with ONLY valid JSON. No markdown, no code fences, no explanations outside the JSON.";
  }

  if (options.stream) {
    const anthropicResp = await fetch("https://api.anthropic.com/v1/messages", {
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

    if (!anthropicResp.ok) return anthropicResp;

    // Transform Anthropic SSE to OpenAI-compatible SSE
    const reader = anthropicResp.body!.getReader();
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
                  const openAIChunk = {
                    choices: [{ delta: { content: event.delta.text }, index: 0 }],
                  };
                  controller.enqueue(encoder.encode(`data: ${JSON.stringify(openAIChunk)}\n\n`));
                }
              } catch { /* skip unparseable lines */ }
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

  // Non-streaming Anthropic call
  const anthropicResp = await fetch("https://api.anthropic.com/v1/messages", {
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

  if (!anthropicResp.ok) return anthropicResp;

  // Convert Anthropic response to OpenAI format
  const anthropicData = await anthropicResp.json();
  const textContent = anthropicData.content
    ?.filter((c: any) => c.type === "text")
    ?.map((c: any) => c.text)
    ?.join("") || "";

  const openAIResponse = {
    choices: [{ message: { role: "assistant", content: textContent } }],
  };

  return new Response(JSON.stringify(openAIResponse), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

// Provider chain
const PROVIDERS: ProviderConfig[] = [
  { name: "Lovable", keyEnvVar: "LOVABLE_API_KEY", getModel: getLovableModel, call: callLovable },
  { name: "Google Gemini", keyEnvVar: "GEMINI_API_KEY", getModel: getGeminiModel, call: callGemini },
  { name: "Anthropic Claude", keyEnvVar: "ANTHROPIC_API_KEY", getModel: getAnthropicModel, call: callAnthropic },
];

/**
 * Call AI with automatic failover across providers.
 * Returns the Response object, provider name, and model used.
 * Throws if ALL providers fail.
 */
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
        console.log(`[AI Failover] ${provider.name} succeeded (model: ${modelUsed})`);
        return { response, provider: provider.name, model: modelUsed };
      }

      // Failover on 402 (credits), 429 (rate limit), 5xx (server error)
      if (response.status === 402 || response.status === 429 || response.status >= 500) {
        const errText = await response.text();
        errors.push(`${provider.name}: HTTP ${response.status} - ${errText.substring(0, 200)}`);
        console.warn(`[AI Failover] ${provider.name} returned ${response.status}, trying next...`);
        continue;
      }

      // For 4xx errors (except 402/429), don't failover — it's a client error
      const errText = await response.text();
      errors.push(`${provider.name}: HTTP ${response.status} - ${errText.substring(0, 200)}`);
      throw new Error(`AI request failed: ${response.status} - ${errText.substring(0, 200)}`);
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("AI request failed:")) {
        throw e;
      }
      errors.push(`${provider.name}: ${e instanceof Error ? e.message : "Unknown error"}`);
      console.warn(`[AI Failover] ${provider.name} threw error, trying next...`);
      continue;
    }
  }

  console.error("[AI Failover] All providers failed:", errors);
  throw new Error(`All AI providers failed:\n${errors.join("\n")}`);
}
