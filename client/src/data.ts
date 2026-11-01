import extraDemos from "../../demo-disputes.json";
import sample from "../../sample-dispute.json";
import type { Dispute } from "./types.ts";

// Synthetic only. Sandbox disputes never mix into this list.
export const demoDisputes: Dispute[] = [sample, ...extraDemos].map((record) => ({ ...record, source: "demo" }));
