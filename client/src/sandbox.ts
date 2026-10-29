import type { Dispute } from "./types.ts";

// Turns a non-2xx server reply into an error carrying the server's own message.
export function serverError(response: Response, body: unknown): Error {
  const message = (body as { error?: { message?: unknown } } | null)?.error?.message;
  return new Error(`${typeof message === "string" ? message : "The DisputeDesk server is not responding."} (HTTP ${response.status})`);
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
