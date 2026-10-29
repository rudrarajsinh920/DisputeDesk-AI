import { REASON_LABELS, evidenceChecklist, formatMoney, humanize, labelFor } from "./disputes.ts";
import type { Dispute } from "./types.ts";
import { StatusBadge } from "./ui.tsx";

export function DisputeDetail({ dispute }: { dispute: Dispute }) {
  const checklist = evidenceChecklist(dispute);
  const missing = checklist?.filter((e) => !e.present) ?? [];

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
            <dd className="mono">{dispute.order.order_id}</dd>
            <dt>Item</dt>
            <dd>{dispute.order.item}</dd>
            <dt>Shipping status</dt>
            <dd>{humanize(dispute.order.shipping_status)}</dd>
            <dt>Tracking number</dt>
            <dd>{dispute.order.tracking_number ?? <span className="muted">Not recorded</span>}</dd>
          </dl>
        </section>
      )}

      <section className="detail-section">
        <h3>Evidence checklist</h3>
        {checklist ? (
          <>
            <p className="muted">
              {checklist.length - missing.length} of {checklist.length} available
            </p>
            <ul className="checklist">
              {checklist.map((e) => (
                <li key={e.item} className={e.present ? "is-present" : "is-missing"}>
                  <span className="check-icon" aria-hidden="true">
                    {e.present ? "✓" : "!"}
                  </span>
                  <span>
                    <span className="check-item">{e.item}</span>
                    <span className="check-state">{e.present ? "Available" : "Missing"}</span>
                    {!e.present && <span className="check-reason">{e.reason}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="muted">This source does not include evidence details.</p>
        )}
      </section>

      <section className="detail-section">
        <h3>Suggested next steps</h3>
        <ol className="steps">
          {missing.map((e) => (
            <li key={e.item}>Find or confirm the {e.item.toLowerCase()} record.</li>
          ))}
          <li>Review all evidence and confirm every fact before preparing a response.</li>
        </ol>
      </section>

      <p className="footnote">DisputeDesk never submits responses to PayPal automatically.</p>
    </article>
  );
}
