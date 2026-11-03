import { useRef, useState } from "react";
import type { ReactNode } from "react";
import { DisputeList } from "./DisputeList.tsx";
import { fetchBuyerExplanation } from "./sandbox.ts";
import { REASON_LABELS, formatDate, formatMoney, labelFor } from "../../shared/disputes.ts";
import type { BuyerDispute, BuyerExplanation, BuyerStage } from "../../shared/types.ts";
import { StatePanel, StatusBadge } from "./ui.tsx";

// Buyer Dispute Clarity. Every block says where it comes from: the record, general guidance, or checked AI wording.

export type BuyerLoad = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; disputes: BuyerDispute[] };

type Origin = "record" | "missing" | "guidance" | "ai" | "standard";
const ORIGIN_LABELS: Record<Origin, string> = {
  record: "From the record",
  missing: "Not on record",
  guidance: "General guidance",
  ai: "AI wording (checked)",
  standard: "Standard explanation",
};
export const SourceTag = ({ origin }: { origin: Origin }) => <span className={`tag tag-${origin}`}>{ORIGIN_LABELS[origin]}</span>;

const STAGE_STATE: Record<BuyerStage["state"], string> = {
  earlier: "Usually before this",
  current: "Current status",
  later: "Usually after this",
  unknown: "Not known",
};

export function BuyerDisputes({ load, onRetry }: { load: BuyerLoad; onRetry: () => void }) {
  const [selectedId, setSelectedId] = useState<string>();
  const detail = useRef<HTMLElement>(null);

  if (load.status === "loading") return <StatePanel title="Loading your disputes…" busy />;
  if (load.status === "error") {
    return (
      <StatePanel title="Couldn't load your disputes" tone="error">
        <p>{load.message}</p>
        <button type="button" className="button" onClick={onRetry}>
          Try again
        </button>
      </StatePanel>
    );
  }
  if (load.disputes.length === 0) {
    return (
      <StatePanel title="You have no disputes">
        <p>Disputes you open with the payment provider appear here.</p>
      </StatePanel>
    );
  }

  const selected = load.disputes.find((d) => d.dispute_id === selectedId) ?? load.disputes[0];
  function select(id: string) {
    setSelectedId(id);
    // On one-column layouts the details sit below the list; take the buyer there.
    if (window.matchMedia("(max-width: 899px)").matches) detail.current?.focus();
  }

  return (
    <div className="workspace">
      <section className="panel" aria-labelledby="buyer-heading">
        <div className="panel-head">
          <h2 id="buyer-heading">Your disputes</h2>
          <span className="muted">{load.disputes.length} on this account</span>
        </div>
        <DisputeList disputes={load.disputes} selectedId={selected.dispute_id} onSelect={select} />
      </section>
      <section className="panel detail-panel" aria-label="Dispute details" ref={detail} tabIndex={-1}>
        <BuyerDetail key={selected.dispute_id} dispute={selected} />
      </section>
    </div>
  );
}

function Section({ title, origin, children }: { title: string; origin: Origin; children: ReactNode }) {
  return (
    <section className="detail-section">
      <div className="section-head">
        <h3>{title}</h3>
        <SourceTag origin={origin} />
      </div>
      {children}
    </section>
  );
}

const onRecord = (value: string | null | undefined, show: (v: string) => ReactNode = (v) => v) =>
  value ? (
    <>
      {show(value)} <SourceTag origin="record" />
    </>
  ) : (
    <SourceTag origin="missing" />
  );

export function BuyerDetail({ dispute }: { dispute: BuyerDispute }) {
  const g = dispute.guidance;
  return (
    <article className="detail">
      <header className="detail-head">
        <div>
          <p className="eyebrow">Demo dispute</p>
          <h2 className="mono">{dispute.dispute_id}</h2>
        </div>
        <StatusBadge status={dispute.status} />
      </header>

      <dl className="facts">
        <div>
          <dt>Amount</dt>
          <dd>{onRecord(dispute.amount && formatMoney(dispute.amount))}</dd>
        </div>
        <div>
          <dt>Reason</dt>
          <dd>
            {onRecord(labelFor(REASON_LABELS, dispute.reason))}
            <span className="code">{dispute.reason}</span>
          </dd>
        </div>
        <div>
          <dt>Opened</dt>
          <dd>{onRecord(dispute.create_time, formatDate)}</dd>
        </div>
      </dl>

      <Section title="What this status means" origin="guidance">
        <p>{g.meaning}</p>
      </Section>

      <Section title="Usual stages" origin="guidance">
        <p className="muted">The usual order of a dispute, not a recorded history. Only the opened date comes from the record.</p>
        <ol className="stages">
          {g.stages.map((s) => (
            <li key={s.id} className="stage" aria-current={s.state === "current" ? "step" : undefined}>
              <span className="stage-name">{s.label}</span>
              <span className="stage-state">{STAGE_STATE[s.state]}</span>
              {s.date && <span className="stage-date">{formatDate(s.date)}</span>}
            </li>
          ))}
        </ol>
      </Section>

      <Section title="Next steps" origin="guidance">
        <ul className="steps">
          {g.next_steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </Section>

      <Section title="Information you may want to have" origin="guidance">
        <p className="muted">Have these ready in case the payment provider asks. You don't need all of them.</p>
        <ul className="steps">
          {g.may_provide.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </Section>

      <Section title="Talking to the seller" origin="guidance">
        <ul className="steps">
          {g.contact.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </Section>

      <Section title="Not on record" origin="missing">
        <p className="muted">This record doesn't include these. That doesn't say anything about the dispute either way.</p>
        <ul className="steps">
          {g.not_on_record.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </Section>

      <Explain dispute={dispute} />

      <p className="footnote">{g.notice}</p>
    </article>
  );
}

export type ExplainState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; explanation: BuyerExplanation };

function Explain({ dispute }: { dispute: BuyerDispute }) {
  const [state, setState] = useState<ExplainState>({ status: "idle" });
  async function run() {
    setState({ status: "loading" });
    try {
      setState({ status: "ready", explanation: await fetchBuyerExplanation(dispute) });
    } catch (error) {
      setState({ status: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }
  return <ExplainView state={state} onRun={run} />;
}

export function ExplainView({ state, onRun }: { state: ExplainState; onRun: () => void }) {
  const busy = state.status === "loading";
  return (
    <section className="detail-section" aria-labelledby="explain-heading">
      <div className="section-head">
        <h3 id="explain-heading">Plain-language explanation</h3>
        {state.status === "ready" && <SourceTag origin={state.explanation.origin === "ai" ? "ai" : "standard"} />}
      </div>
      {state.status !== "ready" && (
        <>
          <p className="muted">
            An optional rewording of the guidance above. AI may write it; DisputeDesk checks every line and shows the standard
            explanation if a check fails.
          </p>
          <div>
            <button type="button" className="button" aria-disabled={busy} onClick={busy ? undefined : onRun}>
              {busy ? "Writing explanation…" : state.status === "error" ? "Try again" : "Explain in plain language"}
            </button>
          </div>
        </>
      )}
      <div className="explain-body" aria-live="polite">
        {state.status === "error" && <p className="error-text">{state.message}</p>}
        {state.status === "ready" && (
          <>
            {state.explanation.fallback_reason && <p className="notice">{state.explanation.fallback_reason}</p>}
            {state.explanation.paragraphs.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
            {state.explanation.flags.length > 0 && <p className="muted">Checks the AI wording failed: {state.explanation.flags.join("; ")}.</p>}
          </>
        )}
      </div>
    </section>
  );
}
