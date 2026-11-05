import { useEffect, useState, type ReactNode } from "react";
import { AnalysisPanel } from "./AnalysisPanel.tsx";
import { REASON_LABELS, formatDate, formatMoney, humanize, labelFor } from "../../shared/disputes.ts";
import type { Dispute } from "../../shared/types.ts";
import { StatusBadge } from "./ui.tsx";

const CASE_PARTS = [
  ["#case-facts", "Facts"],
  ["#case-evidence", "Evidence"],
  ["#case-contradictions", "Contradictions"],
  ["#case-steps", "Next steps"],
  ["#case-draft", "Draft"],
  ["#case-ai", "AI draft"],
] as const;

const orNotRecorded =(value: ReactNode) => value || <span className="muted">Not recorded</span>;

// The part of the case under the sticky header. Sections mount as the analysis arrives, so look them up on each scroll.
function useCurrentPart(): string {
  const [current, setCurrent] = useState<string>(CASE_PARTS[0][0]);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      let at: string = CASE_PARTS[0][0];
      for (const [href] of CASE_PARTS) {
        const top = document.getElementById(href.slice(1))?.getBoundingClientRect().top;
        if (top !== undefined && top <= 160) at = href;
      }
      setCurrent(at);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    update();
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);
  return current;
}

export function DisputeDetail({ dispute, canDraft = true }: { dispute: Dispute; canDraft?: boolean }) {
  const current = useCurrentPart();
  return (
    <article className="detail">
      <div className="case-head">
        <header className="detail-head">
          <div>
            <p className="eyebrow">{dispute.source === "demo" ? "Demo dispute" : "PayPal sandbox dispute"}</p>
            <h2 className="mono">{dispute.dispute_id}</h2>
          </div>
          <StatusBadge status={dispute.status} />
        </header>
        {/* In-page links, not tabs: every part stays rendered for screen readers and search. */}
        <nav className="case-nav" aria-label="Parts of this dispute">
          {CASE_PARTS.map(([href, label]) => (
            <a key={href} href={href} aria-current={current === href ? "location" : undefined}>
              {label}
            </a>
          ))}
        </nav>
      </div>

      <dl className="facts" id="case-facts">
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
        {dispute.seller_response_due_date && (
          <div>
            <dt>Respond by</dt>
            <dd>{formatDate(dispute.seller_response_due_date)}</dd>
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

      <AnalysisPanel dispute={dispute} canDraft={canDraft} />

      <p className="footnote">DisputeDesk never submits responses to PayPal automatically.</p>
    </article>
  );
}
