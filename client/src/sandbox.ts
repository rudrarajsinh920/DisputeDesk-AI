import type { Dispute } from "./types.ts";

// Turns a non-2xx server reply into an error carrying the server's own message and error code.
export function serverError(response: Response, body: unknown): Error & { code?: string } {
  const error = (body as { error?: { message?: unknown; code?: unknown } } | null)?.error;
  const message = typeof error?.message === "string" ? error.message : "The DisputeDesk server is not responding.";
  return Object.assign(new Error(`${message} (HTTP ${response.status})`), { code: typeof error?.code === "string" ? error.code : undefined });
}

// The server owns PayPal credentials; the browser only sees normalized disputes or an error message.
export async function fetchSandboxDisputes(signal?: AbortSignal): Promise<Dispute[]> {
  const response = await fetch("/api/sandbox/disputes", { signal });
  const body = (await response.json().catch(() => null)) as { source?: unknown; disputes?: unknown } | null;

  if (!response.ok) throw serverError(response, body);
  // Check every record's label rather than overwrite it, so a mislabeled record is caught instead of hidden.
  if (
    body?.source !== "paypal_sandbox" ||
    !Array.isArray(body.disputes) ||
    !body.disputes.every((d: Partial<Dispute> | null) => d?.source === "paypal_sandbox")
  ) {
    throw new Error("The DisputeDesk server sent an unexpected response.");
  }
  return body.disputes as Dispute[];
}
