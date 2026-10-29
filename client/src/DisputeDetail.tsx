import type { ReactNode } from "react";
import { AnalysisPanel } from "./AnalysisPanel.tsx";
import { REASON_LABELS, formatDate, formatMoney, humanize, labelFor } from "./disputes.ts";
import type { Dispute } from "./types.ts";
import { StatusBadge } from "./ui.tsx";

const orNotRecorded = (value: ReactNode) => value || <span className="muted">Not recorded</span>;

export function DisputeDetail({ dispute }: { dispute: Dispute }) {
  return (
    <article className="detail">
      <header className="detail-head">
        <div>
          <p className="eyebrow">{dispute.source === "demo" ? "Demo dispute" : "PayPal sandbox dispute"}</p>
          <h2 className="mono">{dispute.dispute_id}</h2>
        </div>
        <StatusBadge status={dispute.status} />
      </header>

      <dl className="facts">
        <div>
          <dt>Amount</dt>
          <dd className="amount-lg">{formatMoney(dispute.amount)}</dd>
        </div>
        <div>
          <dt>Reason</dt>
          <dd>
            {labelFor(REASON_LABELS, dispute.reason)}
            <span className="code">{dispute.reason}</span>
          </dd>
        </div>
        {dispute.create_time && (
          <div>
            <dt>Opened</dt>
            <dd>{formatDate(dispute.create_time)}</dd>
          </div>
        )}
      </dl>

      {dispute.customer_message && (
        <section className="detail-section">
          <h3>Customer message</h3>
          <blockquote>{dispute.customer_message}</blockquote>
        </section>
      )}

      {dispute.order && (
        <section className="detail-section">
          <h3>Order</h3>
          <dl className="kv">
            <dt>Order ID</dt>
            <dd className="mono">{orNotRecorded(dispute.order.order_id)}</dd>
            <dt>Item</dt>
            <dd>{orNotRecorded(dispute.order.item)}</dd>
            <dt>Shipping status</dt>
            <dd>{orNotRecorded(dispute.order.shipping_status && humanize(dispute.order.shipping_status))}</dd>
            <dt>Tracking number</dt>
            <dd>{orNotRecorded(dispute.order.tracking_number)}</dd>
          </dl>
        </section>
      )}

      <AnalysisPanel dispute={dispute} />

      <p className="footnote">DisputeDesk never submits responses to PayPal automatically.</p>
    </article>
  );
}
