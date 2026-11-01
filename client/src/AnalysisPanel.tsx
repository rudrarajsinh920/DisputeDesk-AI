import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { countMarkers, fetchAiAssist, fetchAnalysis } from "./analysis.ts";
import type { AiAssist, Analysis, Dispute, EvidenceStatus, RecordRef } from "./types.ts";
import { StatePanel } from "./ui.tsx";

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; analysis: Analysis };
// The last good AI result stays on screen while a new one is written and if that fails.
// run changes with each new result, so its draft editor starts fresh.
export type AiState = { run: number; assist: AiAssist | null; pending: boolean; error: string | null };

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

  return <AnalysisView dispute={dispute} analysis={load.analysis} />;
}

export function AnalysisView({ dispute, analysis }: { dispute: Dispute; analysis: Analysis }) {
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
  const [ai, setAi] = useState<AiState>({ run: 0, assist: null, pending: false, error: null });
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  function generate() {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setAi((s) => ({ ...s, pending: true, error: null }));
    fetchAiAssist(dispute, current.signal)
      .then((assist) => setAi((s) => ({ run: s.run + 1, assist, pending: false, error: null })))
      .catch((error: unknown) => {
        if (current.signal.aborted) return;
        setAi((s) => ({ ...s, pending: false, error: error instanceof Error ? error.message : String(error) }));
      });
  }

  return <AiSectionView dispute={dispute} ai={ai} onGenerate={generate} />;
}

export function AiSectionView({ dispute, ai, onGenerate }: { dispute: Dispute; ai: AiState; onGenerate: () => void }) {
  // aria-disabled, not disabled, so keyboard focus stays on the button while Gemini writes.
  const generate = () => {
    if (!ai.pending) onGenerate();
  };
  return (
    <section className="detail-section">
      <h3>AI-assisted draft</h3>
      <p className="muted">
        Optional. Gemini words the findings above using only the listed record values; DisputeDesk checks every line and
        removes anything it can't trace to those records. The evidence statuses above stay authoritative.
      </p>

      {!ai.assist && (
        <div className="draft-actions">
          <button type="button" className="button" onClick={generate} aria-disabled={ai.pending}>
            {ai.pending ? "Writing AI draft…" : ai.error ? "Try again" : "Generate AI draft"}
          </button>
        </div>
      )}
      {ai.error && (
        <p className="error-text" role="alert">
          {ai.assist ? `Couldn't write a new AI draft: ${ai.error} The previous AI draft is still shown.` : ai.error}
        </p>
      )}
      <p className="sr-only" role="status">
        {ai.pending ? "Writing AI draft…" : ai.assist ? `AI draft ready. ${flagSummary(ai.assist)}.` : ""}
      </p>

      {ai.assist && (
        <AiResult
          key={ai.run}
          assist={ai.assist}
          id={`ai-draft-${dispute.dispute_id}`}
          pending={ai.pending}
          onRegenerate={generate}
        />
      )}
    </section>
  );
}

const flagSummary = (assist: AiAssist) => {
  const n = assist.flags.length;
  return n > 0 ? `${n} issue${n === 1 ? "" : "s"} flagged` : "Checked, no issues found";
};

export const DISCARD_EDITS = "Discard your edits to the AI-assisted draft and generate a new one?";

export function AiResult({
  assist,
  id,
  pending = false,
  onRegenerate,
}: {
  assist: AiAssist;
  id: string;
  pending?: boolean;
  onRegenerate: () => void;
}) {
  const flagged = assist.flags.length;
  return (
    <>
      <p>
        <span className={`badge badge-${flagged > 0 ? "warn" : "ok"}`}>
          {flagSummary(assist)}
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
        extraAction={(edited) => (
          <button
            type="button"
            className="button button-secondary"
            aria-disabled={pending}
            onClick={() => {
              if (!pending && (!edited || window.confirm(DISCARD_EDITS))) onRegenerate();
            }}
          >
            {pending ? "Writing AI draft…" : "Generate again"}
          </button>
        )}
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
export function DraftEditor({
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
  // Gets whether the merchant has edited the draft, so an action can warn before discarding edits.
  extraAction?: (edited: boolean) => ReactNode;
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
        {extraAction?.(draft !== generated)}
        <span className="muted" role="status">
          {copyStatus}
        </span>
      </div>
    </section>
  );
}
