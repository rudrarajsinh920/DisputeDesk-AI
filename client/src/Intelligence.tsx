import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { formatDate, formatShare } from "../../shared/disputes.ts";
import type { CountRow, EvidenceTally, Intelligence, IntelligenceExplanation, Recommendation } from "../../shared/types.ts";
import { SourceTag } from "./Buyer.tsx";
import { fetchIntelligence, fetchIntelligenceExplanation } from "./sandbox.ts";
import { StatePanel } from "./ui.tsx";

// Dispute insights: counts and the disputes behind them, from the server's fixed rules. Every bar carries its count
// as text; a share becomes a percentage only when the total is large enough (formatShare).

export type InsightsLoad = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; insights: Intelligence };

export function Insights({ canExplain }: { canExplain: boolean }) {
  const [load, setLoad] = useState<InsightsLoad>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoad({ status: "loading" });
    fetchIntelligence(controller.signal)
      .then((insights) => setLoad({ status: "ready", insights }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLoad({ status: "error", message: error instanceof Error ? error.message : String(error) });
      });
    return () => controller.abort();
  }, [attempt]);
  return <InsightsState load={load} onRetry={() => setAttempt((n) => n + 1)} canExplain={canExplain} />;
}

export function InsightsState({ load, onRetry, canExplain }: { load: InsightsLoad; onRetry: () => void; canExplain: boolean }) {
  if (load.status === "loading") return <StatePanel title="Loading insights…" busy />;
  if (load.status === "error") {
    return (
      <StatePanel title="Couldn't load insights" tone="error">
        <p>{load.message}</p>
        <button type="button" className="button" onClick={onRetry}>
          Try again
        </button>
      </StatePanel>
    );
  }
  if (load.insights.total === 0) {
    return (
      <StatePanel title="No demo disputes on this account">
        <p>Insights appear once demo disputes are assigned to this account in demo-accounts.json.</p>
      </StatePanel>
    );
  }
  return <InsightsView insights={load.insights} canExplain={canExplain} />;
}

const ids = (list: string[]) => <span className="id-list mono">{list.join(", ")}</span>;
const width = (count: number, of: number) => ({ width: `${of > 0 ? (count / of) * 100 : 0}%` });

function Bars({ rows, of, label }: { rows: CountRow[]; of: number; label: string }) {
  return (
    <ul className="bars" aria-label={label}>
      {rows.map((r) => (
        <li key={r.key} className="bar-row">
          <span className="bar-label">{r.label}</span>
          <span className="bar-track" aria-hidden="true">
            <span className="bar-fill" style={width(r.count, of)} />
          </span>
          <span className="bar-value">{formatShare(r.count, of)}</span>
        </li>
      ))}
    </ul>
  );
}

function Panel({ title, id, children, aside }: { title: string; id: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="panel insight-panel" aria-labelledby={id}>
      <div className="panel-head">
        <h2 id={id}>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function EvidenceTable({ rows, total }: { rows: EvidenceTally[]; total: number }) {
  return (
    <div className="table-wrap">
      <table className="evidence-table">
        <caption className="muted">Statuses from the evidence engine, across {total} disputes.</caption>
        <thead>
          <tr>
            <th scope="col">Evidence</th>
            <th scope="col">Available</th>
            <th scope="col">Unverified</th>
            <th scope="col">Missing</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.id}>
              <th scope="row">
                {e.label}
                <span className="stack" aria-hidden="true">
                  <span className="stack-available" style={width(e.available, total)} />
                  <span className="stack-unverified" style={width(e.unverified, total)} />
                  <span className="stack-missing" style={width(e.missing, total)} />
                </span>
              </th>
              <td>{formatShare(e.available, total)}</td>
              <td>
                {formatShare(e.unverified, total)}
                {e.unverified_ids.length > 0 && ids(e.unverified_ids)}
              </td>
              <td>
                {formatShare(e.missing, total)}
                {e.missing_ids.length > 0 && ids(e.missing_ids)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RecommendationCard({ r }: { r: Recommendation }) {
  return (
    <article className="rec" aria-labelledby={`rec-${r.id}`}>
      <div className="section-head">
        <h3 id={`rec-${r.id}`}>{r.title}</h3>
        <span className={`tag ${r.confidence === "moderate" ? "tag-guidance" : "tag-missing"}`}>
          {r.confidence === "moderate" ? "Moderate confidence" : "Limited data"}
        </span>
      </div>
      <dl className="rec-facts">
        <dt>What was detected</dt>
        <dd>{r.detected}</dd>
        <dt>Supporting records</dt>
        <dd>
          {ids(r.supporting.dispute_ids)}
          <span className="code">{r.supporting.records.join(", ")}</span>
        </dd>
        <dt>Why it matters</dt>
        <dd>{r.why}</dd>
        <dt>Practical action</dt>
        <dd>{r.action}</dd>
        <dt>Limitation</dt>
        <dd className="muted">{r.limitation}</dd>
      </dl>
    </article>
  );
}

export function InsightsView({ insights: i, canExplain }: { insights: Intelligence; canExplain: boolean }) {
  const recurring = i.patterns.filter((p) => p.recurring).length;
  // Month bars are scaled to the busiest month; each row states its own count.
  const peak = i.trend.shown ? Math.max(...i.trend.months.map((m) => m.disputes)) : 0;
  return (
    <div className="insights">
      <section className="summary" aria-label="Insights summary">
        <Stat label="Disputes checked" value={i.total} />
        <Stat label="Unresolved" value={formatShare(i.resolution.unresolved, i.total)} />
        <Stat label="Recurring patterns" value={recurring} />
        <Stat label="Suggestions" value={i.recommendations.length} />
      </section>

      <Panel title="About this data" id="insights-about" aside={<span className="muted">{i.scope === "all" ? "All demo merchants (read-only)" : "Your demo disputes"}</span>}>
        <ul className="steps">
          {i.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
          <li>Ages are measured to {formatDate(`${i.as_of}T00:00:00Z`)}.</li>
        </ul>
      </Panel>

      <Panel title="Suggestions to check" id="insights-recs">
        {i.recommendations.length > 0 ? (
          <div className="recs">
            {i.recommendations.map((r) => (
              <RecommendationCard key={r.id} r={r} />
            ))}
          </div>
        ) : (
          <p className="empty-inline">Nothing to suggest yet. No gap appears in at least {i.thresholds.recurring_min} disputes, and no dispute needs review.</p>
        )}
        <p className="footnote">Suggestions are prompts to check your own records. They do not predict or change any dispute's outcome.</p>
      </Panel>

      <Panel title="Patterns found" id="insights-patterns">
        {i.patterns.length > 0 ? (
          <ul className="bars" aria-label="Patterns found">
            {i.patterns.map((p) => (
              <li key={p.id} className="bar-row bar-row-wide">
                <span className="bar-label">
                  {p.title} <span className={`tag ${p.recurring ? "tag-guidance" : "tag-standard"}`}>{p.recurring ? "Recurring" : "Below pattern minimum"}</span>
                </span>
                <span className="bar-track" aria-hidden="true">
                  <span className="bar-fill" style={width(p.count, p.of)} />
                </span>
                <span className="bar-value">{formatShare(p.count, p.of)}</span>
                {ids(p.dispute_ids)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty-inline">No gaps, conflicts or waiting disputes were found in these records.</p>
        )}
      </Panel>

      <Panel title="Evidence completeness" id="insights-evidence">
        <EvidenceTable rows={i.evidence} total={i.total} />
      </Panel>

      <div className="insight-grid">
        <Panel title="Status" id="insights-status" aside={<span className="muted">Resolved {i.resolution.resolved} · outcome not on record</span>}>
          <Bars rows={i.status} of={i.total} label="Disputes by status" />
        </Panel>
        <Panel title="Reasons" id="insights-reasons">
          <Bars rows={i.reasons} of={i.total} label="Disputes by reason" />
        </Panel>
      </div>

      <Panel title="By month opened" id="insights-trend">
        {i.trend.shown ? (
          <>
            <ul className="bars" aria-label="Disputes by month opened">
              {i.trend.months.map((m) => (
                <li key={m.month} className="bar-row">
                  <span className="bar-label mono">{m.month}</span>
                  <span className="bar-track" aria-hidden="true">
                    <span className="bar-fill" style={width(m.disputes, peak)} />
                  </span>
                  <span className="bar-value">
                    {m.disputes} {m.disputes === 1 ? "dispute" : "disputes"}
                    {m.disputes > 0 && <span className="muted"> · {m.evidence_available} of {m.evidence_total} evidence items available</span>}
                  </span>
                </li>
              ))}
            </ul>
            <p className="muted">
              {i.trend.dated} dated disputes. {i.trend.undated > 0 && `${i.trend.undated} without an opened date ${i.trend.undated === 1 ? "is" : "are"} not shown.`}
            </p>
          </>
        ) : (
          <p className="empty-inline">Not enough dated disputes for a monthly view. {i.trend.reason}</p>
        )}
      </Panel>

      {canExplain && <Explain />}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  );
}

export type InsightsExplainState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; explanation: IntelligenceExplanation };

function Explain() {
  const [state, setState] = useState<InsightsExplainState>({ status: "idle" });
  async function run() {
    setState({ status: "loading" });
    try {
      setState({ status: "ready", explanation: await fetchIntelligenceExplanation() });
    } catch (error) {
      setState({ status: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }
  return <InsightsExplainView state={state} onRun={run} />;
}

export function InsightsExplainView({ state, onRun }: { state: InsightsExplainState; onRun: () => void }) {
  const busy = state.status === "loading";
  return (
    <section className="panel insight-panel" aria-labelledby="insights-explain">
      <div className="panel-head section-head">
        <h2 id="insights-explain">Plain-language summary</h2>
        {state.status === "ready" && <SourceTag origin={state.explanation.origin === "ai" ? "ai" : "standard"} />}
      </div>
      {state.status !== "ready" && (
        <>
          <p className="muted">
            Optional. AI may reword the findings above; DisputeDesk checks every line for invented numbers, causes and predictions, and
            shows the standard summary if a check fails.
          </p>
          <div>
            <button type="button" className="button" aria-disabled={busy} onClick={busy ? undefined : onRun}>
              {busy ? "Writing summary…" : state.status === "error" ? "Try again" : "Summarize these insights"}
            </button>
          </div>
        </>
      )}
      <div className="explain-body" aria-live="polite">
        {state.status === "error" && <p className="error-text">{state.message}</p>}
        {state.status === "ready" && (
          <>
            {state.explanation.fallback_reason && <p className="notice">{state.explanation.fallback_reason}</p>}
            {state.explanation.paragraphs.map((p, n) => (
              <p key={n}>{p}</p>
            ))}
            {state.explanation.flags.length > 0 && <p className="muted">Checks the AI wording failed: {state.explanation.flags.join("; ")}.</p>}
          </>
        )}
      </div>
    </section>
  );
}
