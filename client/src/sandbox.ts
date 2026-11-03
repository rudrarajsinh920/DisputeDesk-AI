import type { BuyerDispute, BuyerExplanation, Dispute, Source } from "../../shared/types.ts";

// Fired when the server says the session is gone, so the app can return to sign-in from any screen.
export const SIGNED_OUT_EVENT = "disputedesk:signed-out";

// Turns a non-2xx server reply into an error carrying the server's own message and error code.
export function serverError(response: Response, body: unknown): Error & { code?: string } {
  const error = (body as { error?: { message?: unknown; code?: unknown } } | null)?.error;
  const message = typeof error?.message === "string" ? error.message : "The DisputeDesk server is not responding.";
  const code = typeof error?.code === "string" ? error.code : undefined;
  if (code === "not_signed_in" && typeof window !== "undefined") window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
  return Object.assign(new Error(`${message} (HTTP ${response.status})`), { code });
}

// Checks every record's label rather than overwrite it, so a mislabeled record is caught instead of hidden.
async function fetchList(path: string, source: Source, signal?: AbortSignal): Promise<Dispute[]> {
  const response = await fetch(path, { signal });
  const body = (await response.json().catch(() => null)) as { source?: unknown; disputes?: unknown } | null;

  if (!response.ok) throw serverError(response, body);
  if (body?.source !== source || !Array.isArray(body.disputes) || !body.disputes.every((d: Partial<Dispute> | null) => d?.source === source)) {
    throw new Error("The DisputeDesk server sent an unexpected response.");
  }
  return body.disputes as Dispute[];
}

// The server owns PayPal credentials; the browser only sees normalized disputes or an error message.
export const fetchSandboxDisputes = (signal?: AbortSignal) => fetchList("/api/sandbox/disputes", "paypal_sandbox", signal);

// Demo disputes come from the server, filtered to the signed-in account; none are bundled into the page.
export const fetchDemoDisputes = (signal?: AbortSignal) => fetchList("/api/disputes", "demo", signal);

// Buyers get a reduced record (no order, evidence or message fields) with rule-based guidance.
export async function fetchBuyerDisputes(signal?: AbortSignal): Promise<BuyerDispute[]> {
  const disputes = (await fetchList("/api/buyer/disputes", "demo", signal)) as unknown as BuyerDispute[];
  if (!disputes.every((d) => typeof d.guidance?.meaning === "string" && Array.isArray(d.guidance.stages))) {
    throw new Error("The DisputeDesk server sent an unexpected response.");
  }
  return disputes;
}

// Names the dispute only; the server loads it, checks access and checks any AI wording before it returns.
export async function fetchBuyerExplanation(dispute: BuyerDispute, signal?: AbortSignal): Promise<BuyerExplanation> {
  const response = await fetch("/api/buyer/explain", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source: dispute.source, dispute_id: dispute.dispute_id }),
    signal,
  });
  const body = (await response.json().catch(() => null)) as BuyerExplanation | null;
  if (!response.ok) throw serverError(response, body);
  if (
    body?.dispute_id !== dispute.dispute_id ||
    (body.origin !== "ai" && body.origin !== "rules") ||
    !Array.isArray(body.paragraphs) ||
    !body.paragraphs.every((p) => typeof p === "string") ||
    !Array.isArray(body.flags)
  ) {
    throw new Error("The DisputeDesk server sent an unexpected explanation.");
  }
  return body;
}
