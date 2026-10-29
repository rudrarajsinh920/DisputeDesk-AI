import sample from "../../sample-dispute.json";
import type { Dispute } from "./types.ts";

// Synthetic only. Sandbox disputes never mix into this list.
export const demoDisputes: Dispute[] = [{ ...sample, source: "demo" }];

// The backend owns PayPal credentials; the browser only sees normalized disputes.
export async function fetchSandboxDisputes(signal: AbortSignal): Promise<Dispute[]> {
  const response = await fetch("/api/sandbox/disputes", { signal });
  if (!response.ok) throw new Error(`Server answered HTTP ${response.status}`);
  const body: unknown = await response.json().catch(() => null);
  const disputes = (body as { disputes?: unknown } | null)?.disputes;
  if (!Array.isArray(disputes)) throw new Error("Server sent an unexpected response");
  return disputes.map((d: Dispute) => ({ ...d, source: "paypal_sandbox" }));
}
