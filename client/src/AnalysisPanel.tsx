import { useEffect, useState } from "react";
import { countMarkers, fetchAnalysis } from "./analysis.ts";
import type { Analysis, Dispute, EvidenceStatus, RecordRef } from "./types.ts";
import { StatePanel } from "./ui.tsx";

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; analysis: Analysis };

const STATUS: Record<EvidenceStatus, { label: string; tone: string }> = {
  available: { label: "Available", tone: "ok" },
  missing: { label: "Missing", tone: "warn" },
  unverified: { label: "Unverified", tone: "info" },
};

const recordText = (r: RecordRef) => `${r.path} = ${r.value === null ? "not on record" : String(r.value)}`;

export function AnalysisPanel({ dispute }: { dispute: Dispute }) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [draft, setDraft] = useState("");
  const [copyStatus, setCopyStatus] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setLoad({ status: "loading" });
    fetchAnalysis(dispute, controller.signal)
      .then((analysis) => {
        setLoad({ status: "ready", analysis });
        setDraft(analysis.draft.text);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setLoad({ status: "error", message: error instanceof Error ? error.message : String(error) });
      });
    return () => controller.abort();
  }, [dispute, attempt]);

  if (load.status === "loading") return <StatePanel title="Analyzing evidence…" busy />;
  if (load.status === "error") {
    return (
      <StatePanel title="Couldn't analyze this dispute" tone="error">
        <p>{load.message}</p>
        <p className="muted">Evidence analysis runs on the DisputeDesk server.</p>
        <button type="button" className="button" onClick={() => setAttempt((n) => n + 1)}>
          Try again
        </button>
      </StatePanel>
    );
  }

  const { analysis } = load;
  const remaining = countMarkers(draft);
  const draftId = `draft-${dispute.dispute_id}`;

  async function copyDraft() {
    try {
      await navigator.clipboard.writeText(draft);
      setCopyStatus("Draft copied.");
    } catch {
      // Some embedded browsers block the clipboard API; selecting and copying still works there.
      const area = document.getElementById(draftId) as HTMLTextAreaElement | null;
      area?.select();
      const copied = area !== null && document.execCommand("copy");
      setCopyStatus(copied ? "Draft copied." : "Copy failed. The text is selected; press Ctrl+C to copy it.");
    }
  }

  return (
    <>
      <section className="detail-section">
        <h3>Evidence analysis</h3>
        <p className="muted">
          Based only on the supplied records. "Available" means the record marks it available; DisputeDesk does not inspect
          the documents themselves.
        </p>
        <ul className="findings">
          {analysis.evidence.map((e) => (
            <li key={e.id} className="finding">
              <div className="finding-head">
                <span className="check-item">{e.label}</span>
                {e.priority === "key" && <span className="key-tag">Key for this reason</span>}
                <span className={`badge badge-${STATUS[e.status].tone}`}>{STATUS[e.status].label}</span>
              </div>
              <p>{e.explanation}</p>
              <p className="muted">Why it matters: {e.relevance}</p>
              <p className="records">Based on: {e.records.map(recordText).join("; ")}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="detail-section">
        <h3>Contradictions</h3>
        {analysis.contradictions.length === 0 ? (
          <p className="muted">No contradictions found between the supplied records.</p>
        ) : (
          <ul className="findings">
            {analysis.contradictions.map((c) => (
              <li key={c.message} className="finding finding-conflict">
                <p>{c.message}</p>
                <p className="records">Records: {c.records.map(recordText).join("; ")}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="detail-section">
        <h3>Next steps</h3>
        <ol className="steps">
          {analysis.next_steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      </section>

      <section className="detail-section">
        <div className="draft-head">
          <h3>
            <label htmlFor={draftId}>Response draft</label>
          </h3>
          <span className={`badge badge-${remaining > 0 ? "warn" : "ok"}`}>
            {remaining > 0 ? `${remaining} marker${remaining === 1 ? "" : "s"} to resolve` : "No markers left"}
          </span>
        </div>
        <p className="muted">
          Draft only. It requires merchant review, is never sent to PayPal, and edits are not saved when you leave this dispute.
        </p>
        <textarea id={draftId} className="draft" value={draft} onChange={(e) => setDraft(e.target.value)} rows={18} />
        <div className="draft-actions">
          <button type="button" className="button" onClick={copyDraft}>
            Copy draft
          </button>
          <button
            type="button"
            className="button button-secondary"
            disabled={draft === analysis.draft.text}
            onClick={() => {
              setDraft(analysis.draft.text);
              setCopyStatus("");
            }}
          >
            Reset to generated draft
          </button>
          <span className="muted" role="status">
            {copyStatus}
          </span>
        </div>
      </section>
    </>
  );
}
