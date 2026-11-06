import type { Analysis } from "./types.ts";

const MARKER = /\[(MISSING|UNVERIFIED|UNSUPPORTED|NEEDS MERCHANT INPUT|CONFLICT):/g;

// Gaps the merchant still has to fill or remove before the draft can be used.
// Lines starting with ">" are quoted buyer text, so brackets typed by the buyer are not counted.
export const countMarkers = (text: string) =>
  text
    .split(/\r?\n/)
    .filter((line) => !line.startsWith(">"))
    .join("\n")
    .match(MARKER)?.length ?? 0;

// Evidence readiness: counts taken straight from the rules' analysis. Not a score and not a prediction of the outcome.
export interface Readiness {
  key_total: number;
  key_on_record: number;
  on_record: number;
  total: number;
  missing: number;
  unverified: number;
  conflicts: number;
  markers: number;
}

export function readiness(analysis: Analysis): Readiness {
  const count = (status: string, list = analysis.evidence) => list.filter((e) => e.status === status).length;
  const key = analysis.evidence.filter((e) => e.priority === "key");
  return {
    key_total: key.length,
    key_on_record: count("available", key),
    on_record: count("available"),
    total: analysis.evidence.length,
    missing: count("missing"),
    unverified: count("unverified"),
    conflicts: analysis.contradictions.length,
    markers: countMarkers(analysis.draft.text),
  };
}
