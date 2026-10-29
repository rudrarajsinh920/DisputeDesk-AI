import type { Dispute } from "./types.ts";

// The server owns PayPal credentials; the browser only sees normalized disputes or an error message.
export async function fetchSandboxDisputes(signal?: AbortSignal): Promise<Dispute[]> {
  const response = await fetch("/api/sandbox/disputes", { signal });
  const body = (await response.json().catch(() => null)) as {
    source?: unknown;
    disputes?: unknown;
    error?: { message?: unknown };
  } | null;

  if (!response.ok) {
    const message =
      typeof body?.error?.message === "string" ? body.error.message : "The DisputeDesk server is not responding.";
    throw new Error(`${message} (HTTP ${response.status})`);
  }
  if (body?.source !== "paypal_sandbox" || !Array.isArray(body.disputes)) {
    throw new Error("The DisputeDesk server sent an unexpected response.");
  }
  return body.disputes.map((d: Dispute) => ({ ...d, source: "paypal_sandbox" }));
}
