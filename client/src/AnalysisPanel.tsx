import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { countMarkers, fetchAiAssist, fetchAnalysis } from "./analysis.ts";
import type { AiAssist, Analysis, Dispute, EvidenceStatus, RecordRef } from "./types.ts";
import { StatePanel } from "./ui.tsx";

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; analysis: Analysis };
type AiLoad = { status: "idle" } | { status: "loading" } | { status: "error"; message: string } | { status: "ready"; assist: AiAssist };

const STATUS: Record<EvidenceStatus, { label: string; tone: string }> = {
  available: { label: "Available", tone: "ok" },
  missing: { label: "Missing", tone: "warn" },
  unverified: { label: "Unverified", tone: "info" },
};

const recordText = (r: RecordRef) => `${r.path} = ${r.value === null ? "not on record" : String(r.value)}`;

export function AnalysisPanel({ dispute }: { dispute: Dispute }) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoad({ status: "loading" });
    fetchAnalysis(dispute, controller.signal)
      .then((analysis) => setLoad({ status: "ready", analysis }))
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

      <DraftEditor
        id={`draft-${dispute.dispute_id}`}
        title="Response draft"
        note="Draft only. It requires merchant review, is never sent to PayPal, and edits are not saved when you leave this dispute."
        generated={analysis.draft.text}
      />

      <AiSection dispute={dispute} />
    </>
  );
}

// Optional AI-assisted wording. Runs only when the merchant asks, and only through the DisputeDesk server.
function AiSection({ dispute }: { dispute: Dispute }) {
  const [ai, setAi] = useState<AiLoad>({ status: "idle" });
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  function generate() {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setAi({ status: "loading" });
    fetchAiAssist(dispute, current.signal)
      .then((assist) => setAi({ status: "ready", assist }))
      .catch((error: unknown) => {
        if (current.signal.aborted) return;
        setAi({ status: "error", message: error instanceof Error ? error.message : String(error) });
      });
  }

  return (
    <section className="detail-section">
      <h3>AI-assisted draft</h3>
      <p className="muted">
        Optional. Gemini words the findings above using only the listed record values; DisputeDesk checks every line and
        removes anything it can't trace to those records. The evidence statuses above stay authoritative.
      </p>

      {ai.status !== "ready" && (
        <div className="draft-actions">
          <button type="button" className="button" onClick={generate} disabled={ai.status === "loading"}>
            {ai.status === "loading" ? "Writing AI draft…" : ai.status === "error" ? "Try again" : "Generate AI draft"}
          </button>
          {ai.status === "error" && (
            <span className="muted" role="alert">
              {ai.message}
            </span>
          )}
        </div>
      )}

      {ai.status === "ready" && <AiResult assist={ai.assist} id={`ai-draft-${dispute.dispute_id}`} onRegenerate={generate} />}
    </section>
  );
}

function AiResult({ assist, id, onRegenerate }: { assist: AiAssist; id: string; onRegenerate: () => void }) {
  const flagged = assist.flags.length;
  return (
    <>
      <p>
        <span className={`badge badge-${flagged > 0 ? "warn" : "ok"}`}>
          {flagged > 0 ? `${flagged} issue${flagged === 1 ? "" : "s"} flagged` : "Checked, no issues found"}
        </span>{" "}
        <span className="muted">Written by {assist.model}.</span>
      </p>

      {flagged > 0 && (
        <ul className="findings">
          {assist.flags.map((f, i) => (
            <li key={i} className="finding finding-conflict">
              <p>
                <strong>{f.where}:</strong> {f.reason}
              </p>
              {f.removed_text && (
                <details>
                  <summary className="muted">Text that was not used</summary>
                  <p className="records">{f.removed_text}</p>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}

      <ul className="findings">
        {assist.explanations.map((e) => (
          <li key={e.evidence_id} className="finding">
            <div className="finding-head">
              <span className="check-item">{labelOf(e.evidence_id)}</span>
              <span className="key-tag">{e.source === "ai" ? "AI wording" : "Rules' wording"}</span>
              <span className={`badge badge-${STATUS[e.status].tone}`}>{STATUS[e.status].label}</span>
            </div>
            <p>{e.text}</p>
            {e.cites.length > 0 && <p className="records">Cites: {e.cites.map((c) => factText(assist, c)).join("; ")}</p>}
          </li>
        ))}
      </ul>

      <DraftEditor
        id={id}
        title="AI-assisted response draft"
        note="AI-assisted draft. Check every statement against your records. It is never sent to PayPal, and edits are not saved."
        generated={assist.draft.text}
        extraAction={
          <button type="button" className="button button-secondary" onClick={onRegenerate}>
            Generate again
          </button>
        }
      />
    </>
  );
}

const LABELS: Record<string, string> = {
  order_confirmation: "Order confirmation",
  shipping_tracking: "Shipping tracking",
  proof_of_delivery: "Proof of delivery",
  customer_communication: "Customer communication",
};
const labelOf = (id: string) => LABELS[id] ?? id;

function factText(assist: AiAssist, id: string) {
  const fact = assist.facts.find((f) => f.id === id);
  return fact ? `${id} ${fact.label} = ${fact.value}` : id;
}

// Editable draft with a live count of markers left, Copy and Reset. Edits are local and never saved or sent.
function DraftEditor({
  id,
  title,
  note,
  generated,
  extraAction,
}: {
  id: string;
  title: string;
  note: string;
  generated: string;
  extraAction?: ReactNode;
}) {
  const [draft, setDraft] = useState(generated);
  const [copyStatus, setCopyStatus] = useState("");
  useEffect(() => {
    setDraft(generated);
    setCopyStatus("");
  }, [generated]);
  const remaining = countMarkers(draft);

  async function copyDraft() {
    try {
      await navigator.clipboard.writeText(draft);
      setCopyStatus("Draft copied.");
    } catch {
      // Some embedded browsers block the clipboard API; selecting and copying still works there.
      const area = document.getElementById(id) as HTMLTextAreaElement | null;
      area?.select();
      const copied = area !== null && document.execCommand("copy");
      setCopyStatus(copied ? "Draft copied." : "Copy failed. The text is selected; press Ctrl+C to copy it.");
    }
  }

  return (
    <section className="detail-section">
      <div className="draft-head">
        <h3>
          <label htmlFor={id}>{title}</label>
        </h3>
        <span className={`badge badge-${remaining > 0 ? "warn" : "ok"}`}>
          {remaining > 0 ? `${remaining} marker${remaining === 1 ? "" : "s"} to resolve` : "No markers left"}
        </span>
      </div>
      <p className="muted">{note}</p>
      <textarea id={id} className="draft" value={draft} onChange={(e) => setDraft(e.target.value)} rows={18} />
      <div className="draft-actions">
        <button type="button" className="button" onClick={copyDraft}>
          Copy draft
        </button>
        <button
          type="button"
          className="button button-secondary"
          disabled={draft === generated}
          onClick={() => {
            setDraft(generated);
            setCopyStatus("");
          }}
        >
          Reset to generated draft
        </button>
        {extraAction}
        <span className="muted" role="status">
          {copyStatus}
        </span>
      </div>
    </section>
  );
}
