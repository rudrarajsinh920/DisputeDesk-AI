import sample from "../../sample-dispute.json";
import type { Dispute } from "./types.ts";

// Synthetic only. Sandbox disputes never mix into this list.
export const demoDisputes: Dispute[] = [{ ...sample, source: "demo" }];
