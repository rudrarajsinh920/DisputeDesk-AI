import { serverError } from "./sandbox.ts";
import type { AiAssist, AiStatus, Analysis, Dispute } from "../../shared/types.ts";

// Sends only which record to analyze; the server loads the record itself. Nothing here talks to PayPal.
export async function fetchAnalysis(dispute: Dispute, signal?: AbortSignal): Promise<Analysis> {
  const response = await fetch("/api/analysis", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source: dispute.source, dispute_id: dispute.dispute_id }),
    signal,
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw serverError(response, body);

  const analysis = body as Analysis | null;
  if (
    analysis?.dispute_id !== dispute.dispute_id ||
    analysis.source !== dispute.source ||
    !Array.isArray(analysis.evidence) ||
    typeof analysis.draft?.text !== "string"
  ) {
    throw new Error("The DisputeDesk server sent an unexpected analysis.");
  }
  return analysis;
}

// On demand only: asks the server for an AI-assisted draft. The server holds the Gemini key, loads the record,
// and checks every line the model writes; this only names the record.
// example asks instead for the validation example: fixed wrong text through the same checks, never Gemini.
export async function fetchAiAssist(dispute: Dispute, signal?: AbortSignal, example = false): Promise<AiAssist> {
  const response = await fetch(example ? "/api/analysis/ai/example" : "/api/analysis/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source: dispute.source, dispute_id: dispute.dispute_id }),
    signal,
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw serverError(response, body);

  const assist = body as AiAssist | null;
  if (
    assist?.dispute_id !== dispute.dispute_id ||
    assist.source !== dispute.source ||
    (assist.status !== "ok" && assist.status !== "flagged") ||
    !Array.isArray(assist.explanations) ||
    !Array.isArray(assist.flags) ||
    typeof assist.draft?.text !== "string"
  ) {
    throw new Error("The DisputeDesk server sent an unexpected AI draft.");
  }
  return assist;
}

const MARKER =/\[(MISSING|UNVERIFIED|UNSUPPORTED|NEEDS MERCHANT INPUT|CONFLICT):/g;

// Gaps the merchant still has to fill or remove before the draft can be used.
// Lines starting with ">" are quoted buyer text, so brackets typed by the buyer are not counted.
export const countMarkers = (text: string) =>
  text
    .split(/\r?\n/)
    .filter((line) => !line.startsWith(">"))
    .join("\n")
    .match(MARKER)?.length ?? 0;

// Whether the server has AI drafting on, so the page can say so before anyone clicks. Never calls Gemini.
export async function fetchAiStatus(signal?: AbortSignal): Promise<AiStatus> {
  const response = await fetch("/api/health", { signal });
  const body = (await response.json().catch(() => null)) as { ai?: { configured?: unknown; model?: unknown; reason?: unknown } } | null;
  if (!response.ok) throw serverError(response, body);
  const ai = body?.ai;
  if (ai?.configured === true && typeof ai.model === "string") return { on: true, model: ai.model };
  if (ai?.configured === false && typeof ai.reason === "string") return { on: false, reason: ai.reason };
  throw new Error("The DisputeDesk server sent an unexpected status.");
}
