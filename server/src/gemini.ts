// Gemini REST client (models.generateContent). Built on fetch, like paypal.ts, so tests can mock it.
// It only asks for text; it never receives PayPal credentials and never acts on anything.
export const GEMINI_API_URL = "https://generativelanguage.googleapis.com/v1beta";
const TIMEOUT_MS = 20_000;

export type AiErrorCode =
  | "ai_timeout"
  | "ai_rate_limited"
  | "ai_auth_failed"
  | "ai_unavailable"
  | "ai_error"
  | "ai_blocked"
  | "ai_bad_response";

export class AiError extends Error {
  readonly code: AiErrorCode;
  readonly upstreamStatus: number | null;
  readonly retryAfterSeconds: number | null;

  constructor(code: AiErrorCode, message: string, upstreamStatus: number | null = null, retryAfterSeconds: number | null = null) {
    super(message);
    this.code = code;
    this.upstreamStatus = upstreamStatus;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface JsonRequest {
  system: string;
  prompt: string;
  // OpenAPI-subset schema (uppercase types), as generateContent's responseSchema expects.
  schema: object;
}

export type GeminiClient = ReturnType<typeof createGeminiClient>;

const RETRY_DELAY_MS = 800;
const BLOCKED = new Set(["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION"]);

export function createGeminiClient(config: { apiKey: string; model: string }, fetchImpl: typeof fetch = fetch) {
  // Returns the model's JSON, parsed but unchecked. Callers must validate it (see assist.ts).
  // Google's free tier sometimes answers 5xx when busy; one quiet retry hides most of those blips.
  async function generateJson(request: JsonRequest): Promise<unknown> {
    try {
      return await requestOnce(request);
    } catch (error) {
      if (!(error instanceof AiError) || error.code !== "ai_unavailable" || (error.upstreamStatus ?? 0) < 500) throw error;
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      return requestOnce(request);
    }
  }

  async function requestOnce(request: JsonRequest): Promise<unknown> {
    let response: Response;
    try {
      response = await fetchImpl(`${GEMINI_API_URL}/models/${encodeURIComponent(config.model)}:generateContent`, {
        method: "POST",
        // The key goes in a header, never the URL, so it can't end up in logs of request URLs.
        headers: { "x-goog-api-key": config.apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: request.system }] },
          contents: [{ role: "user", parts: [{ text: request.prompt }] }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: request.schema,
            candidateCount: 1,
            temperature: 0.2,
            maxOutputTokens: 4096,
          },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      if ((error as { name?: unknown })?.name === "TimeoutError") {
        throw new AiError("ai_timeout", "Gemini did not answer in time. Try again.");
      }
      throw new AiError("ai_unavailable", "Could not reach Gemini.");
    }

    // Upstream bodies are never passed on: they are not needed and could echo request details.
    if (!response.ok) {
      const status = response.status;
      if (status === 429) {
        const retry = Number(response.headers.get("retry-after"));
        throw new AiError("ai_rate_limited", "Gemini's rate limit was reached. Try again later.", 429, Number.isFinite(retry) && retry > 0 ? retry : null);
      }
      if (status === 401 || status === 403 || (status === 400 && (await mentionsApiKey(response)))) {
        throw new AiError("ai_auth_failed", "Gemini rejected the server's API key.", status);
      }
      if (status === 404) throw new AiError("ai_unavailable", "The configured Gemini model is not available.", 404);
      if (status >= 500) throw new AiError("ai_unavailable", "Gemini is unavailable right now. Try again later.", status);
      throw new AiError("ai_error", "Gemini refused the request.", status);
    }

    const body = (await response.json().catch(() => undefined)) as
      | { promptFeedback?: { blockReason?: unknown }; candidates?: { finishReason?: unknown; content?: { parts?: { text?: unknown }[] } }[] }
      | undefined;
    if (body === undefined || body === null) throw new AiError("ai_bad_response", "Gemini sent a response that is not JSON.");
    if (body.promptFeedback?.blockReason) throw new AiError("ai_blocked", "Gemini declined to answer this request.");

    const candidate = Array.isArray(body.candidates) ? body.candidates[0] : undefined;
    if (!candidate) throw new AiError("ai_bad_response", "Gemini sent no answer.");
    const finish = candidate.finishReason;
    if (typeof finish === "string" && BLOCKED.has(finish)) throw new AiError("ai_blocked", "Gemini declined to answer this request.");
    if (finish !== undefined && finish !== "STOP") throw new AiError("ai_bad_response", "Gemini's answer was cut off or incomplete.");

    const parts = Array.isArray(candidate.content?.parts) ? candidate.content.parts : [];
    const text = parts.map((p) => (typeof p?.text === "string" ? p.text : "")).join("");
    try {
      return JSON.parse(text);
    } catch {
      throw new AiError("ai_bad_response", "Gemini's answer was not valid JSON.");
    }
  }

  return { model: config.model, generateJson };
}

// Google answers an invalid key with HTTP 400 and API_KEY_INVALID; only that marker is read from the body.
async function mentionsApiKey(response: Response): Promise<boolean> {
  const text = await response.text().catch(() => "");
  return /API_KEY_INVALID|API key not valid/i.test(text);
}
