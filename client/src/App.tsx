import { useEffect, useState } from "react";
import { DisputeDetail } from "./DisputeDetail.tsx";
import { DisputeList } from "./DisputeList.tsx";
import { demoDisputes } from "./data.ts";
import { STATUS_FILTERS, STATUS_LABELS, countByStatus, filterByStatus, formatMoney, labelFor, summarize } from "./disputes.ts";
import { fetchSandboxDisputes } from "./sandbox.ts";
import type { Dispute, Source } from "./types.ts";
import { StatePanel } from "./ui.tsx";

type SandboxLoad =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; disputes: Dispute[] };

const SOURCES: { id: Source; label: string }[] = [
  { id: "demo", label: "Demo data" },
  { id: "paypal_sandbox", label: "PayPal sandbox" },
];

export default function App() {
  const [source, setSource] = useState<Source>("demo");
  const [sandbox, setSandbox] = useState<SandboxLoad>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [filter, setFilter] = useState("ALL");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (source !== "paypal_sandbox") return;
    const controller = new AbortController();
    setSandbox({ status: "loading" });
    fetchSandboxDisputes(controller.signal)
      .then((disputes) => setSandbox({ status: "ready", disputes }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setSandbox({ status: "error", message: error instanceof Error ? error.message : String(error) });
      });
    return () => controller.abort();
  }, [source, attempt]);

  const disputes = source === "demo" ? demoDisputes : sandbox.status === "ready" ? sandbox.disputes : null;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            DD
          </span>
          <span className="brand-name">DisputeDesk</span>
        </div>
        <div className="segmented" role="group" aria-label="Data source">
          {SOURCES.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-pressed={source === s.id}
              onClick={() => {
                setSource(s.id);
                setSelectedId(null);
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      </header>

      {source === "demo" ? (
        <div className="banner banner-demo" role="note">
          <strong>DEMO DATA — NOT A REAL PAYPAL DISPUTE</strong>
          <span>Synthetic example loaded from sample-dispute.json. Nothing here is connected to PayPal.</span>
        </div>
      ) : (
        <div className="banner banner-sandbox" role="note">
          <strong>PAYPAL SANDBOX</strong>
          <span>Test environment only. No live payments or real customers.</span>
        </div>
      )}

      <main className="main">
        {disputes === null ? (
          sandbox.status === "error" ? (
            <StatePanel title="Couldn't load PayPal sandbox disputes" tone="error">
              <p>{sandbox.message}</p>
              <p className="muted">The sandbox is reached through the DisputeDesk server, which holds the PayPal credentials.</p>
              <button type="button" className="button" onClick={() => setAttempt((n) => n + 1)}>
                Try again
              </button>
            </StatePanel>
          ) : (
            <StatePanel title="Loading PayPal sandbox disputes…" busy />
          )
        ) : disputes.length === 0 ? (
          <StatePanel title="No disputes in the PayPal sandbox">
            <p>Sandbox disputes appear here after a sandbox buyer account opens one.</p>
            <button type="button" className="button" onClick={() => setAttempt((n) => n + 1)}>
              Refresh
            </button>
          </StatePanel>
        ) : (
          <Workspace
            disputes={disputes}
            filter={filter}
            onFilter={setFilter}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        )}
      </main>
    </div>
  );
}

function Workspace({
  disputes,
  filter,
  onFilter,
  selectedId,
  onSelect,
}: {
  disputes: Dispute[];
  filter: string;
  onFilter: (status: string) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const summary = summarize(disputes);
  const counts = countByStatus(disputes);
  const visible = filterByStatus(disputes, filter);
  const selected = visible.find((d) => d.dispute_id === selectedId) ?? visible[0];

  return (
    <>
      <section className="summary" aria-label="Summary">
        <Stat label="Total disputes" value={summary.total} />
        <Stat label="Unresolved" value={summary.unresolved} />
        <Stat label="Amount in dispute" value={summary.amounts.map(formatMoney).join(" · ") || "—"} />      </section>

      <div className="workspace">
        <section className="panel" aria-labelledby="list-heading">
          <div className="panel-head">
            <h2 id="list-heading">Disputes</h2>
            <span className="muted">{visible.length} shown</span>
          </div>
          <div className="filters" role="group" aria-label="Filter by status">
            {STATUS_FILTERS.map((f) => (
              <button key={f} type="button" className="chip" aria-pressed={filter === f} onClick={() => onFilter(f)}>
                {f === "ALL" ? "All" : labelFor(STATUS_LABELS, f)}
                <span className="chip-count">{counts[f] ?? 0}</span>
              </button>
            ))}
          </div>
          {visible.length > 0 ? (
            <DisputeList disputes={visible} selectedId={selected?.dispute_id} onSelect={onSelect} />
          ) : (
            <p className="empty-inline">No disputes with this status.</p>
          )}
        </section>

        <section className="panel detail-panel" aria-label="Dispute details">
          {selected ? (
            <DisputeDetail key={selected.dispute_id} dispute={selected} />
          ) : (
            <p className="empty-inline">Select a dispute to see its details.</p>
          )}
        </section>
      </div>
    </>
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
