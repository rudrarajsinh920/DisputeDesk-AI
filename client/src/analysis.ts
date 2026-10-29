import { serverError } from "./sandbox.ts";
import type { Analysis, Dispute } from "./types.ts";

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

const MARKER = /\[(MISSING|UNVERIFIED|UNSUPPORTED|NEEDS MERCHANT INPUT|CONFLICT):/g;

// Gaps the merchant still has to fill or remove before the draft can be used.
// Lines starting with ">" are quoted buyer text, so brackets typed by the buyer are not counted.
export const countMarkers = (text: string) =>
  text
    .split(/\r?\n/)
    .filter((line) => !line.startsWith(">"))
    .join("\n")
    .match(MARKER)?.length ?? 0;
