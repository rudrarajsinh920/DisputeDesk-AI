import { REASON_LABELS, REFUND_ID_REASONS, formatMoney, labelFor } from "../../shared/disputes.ts";
import type { Readiness } from "../../shared/readiness.ts";
import type { Dispute } from "../../shared/types.ts";
import { StatusBadge } from "./ui.tsx";

// Plain counts from the rules, never a score: key evidence on record (or all evidence when the reason has no key items)
// and conflicting records.
export function readinessLine(r: Readiness, reason?: string): string {
  const parts = [r.key_total > 0 ? `Key evidence ${r.key_on_record} of ${r.key_total}` : `Evidence ${r.on_record} of ${r.total}`];
  if (r.conflicts > 0) parts.push(`${r.conflicts} conflict${r.conflicts === 1 ? "" : "s"}`);
  // Without this, a refund dispute with every flag set would read as complete while its refund ID is still a gap.
  if (reason && REFUND_ID_REASONS.includes(reason)) parts.push("refund ID needed");
  return parts.join(" · ");
}

export function DisputeList({
  disputes,
  selectedId,
  onSelect,
  owners,
  readiness,
}: {
  disputes: Dispute[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  // Admin only: the merchant account each dispute belongs to.
  owners?: Map<string, string>;
  // Demo data only: the rules' evidence counts per dispute ID.
  readiness?: Record<string, Readiness>;
}) {
  return (
    <ul className="dispute-list">
      {disputes.map((d) => (
        <li key={d.dispute_id}>
          <button
            type="button"
            className="dispute-row"
            aria-current={d.dispute_id === selectedId ? "true" : undefined}
            onClick={() => onSelect(d.dispute_id)}
          >
            <span className="row-line">
              <span className="mono">{d.dispute_id}</span>
              <span className="row-amount">{formatMoney(d.amount)}</span>
            </span>
            <span className="row-line">
              <span className="muted">{labelFor(REASON_LABELS, d.reason)}</span>
              <StatusBadge status={d.status} />
            </span>
            {readiness?.[d.dispute_id] && <span className="row-readiness">{readinessLine(readiness[d.dispute_id], d.reason)}</span>}
            {owners && <span className="row-owner">{owners.get(d.dispute_id) ?? "Owner not listed"}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}
