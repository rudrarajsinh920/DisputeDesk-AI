import type { ReactNode } from "react";
import { STATUS_LABELS, labelFor, statusTone } from "../../shared/disputes.ts";

// Widths where the list and the open dispute stack (see .workspace in styles.css).
export const ONE_COLUMN = "(max-width: 899px), (min-width: 1024px) and (max-width: 1199px)";

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge badge-${statusTone(status)}`}>{labelFor(STATUS_LABELS, status)}</span>;
}

export function StatePanel({
  title,
  children,
  busy = false,
  tone = "neutral",
}: {
  title: string;
  children?: ReactNode;
  busy?: boolean;
  tone?: "neutral" | "error";
}) {
  return (
    <div className={`state-panel state-${tone}`} role={tone === "error" ? "alert" : "status"} aria-busy={busy}>
      {busy && <span className="spinner" aria-hidden="true" />}
      <h2>{title}</h2>
      {children}
    </div>
  );
}
