import { REASON_LABELS, formatMoney, labelFor } from "./disputes.ts";
import type { Dispute } from "./types.ts";
import { StatusBadge } from "./ui.tsx";

export function DisputeList({
  disputes,
  selectedId,
  onSelect,
}: {
  disputes: Dispute[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
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
          </button>
        </li>
      ))}
    </ul>
  );
}
