import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { countMarkers, fetchAiAssist, fetchAiStatus, fetchAnalysis } from "./analysis.ts";
import type { AiAssist, AiStatus, Analysis, Dispute, EvidenceStatus, RecordRef } from "../../shared/types.ts";
import { StatePanel } from "./ui.tsx";

type Load = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; analysis: Analysis };
// The last good AI result stays on screen while a new one is written and if that fails.
// run changes with each new result, so its draft editor starts fresh. status is null until the server says.
export type AiState = { run: number; assist: AiAssist | null; pending: boolean; error: string | null; status: AiStatus | null };

const STATUS: Record<EvidenceStatus, { label: string; tone: string }> = {
  available: { label: "Available", tone: "ok" },
  missing: { label: "Missing", tone: "warn" },
  unverified: { label: "Unverified", tone: "info" },
};

const recordText = (r: RecordRef) => `${r.path} = ${r.value === null ? "not on record" : String(r.value)}`;

// canDraft is false for the read-only admin view: no AI draft button, since the server would refuse it.
export function AnalysisPanel({ dispute, canDraft = true }: { dispute: Dispute; canDraft?: boolean }) {
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

  return <AnalysisView dispute={dispute} analysis={load.analysis} canDraft={canDraft} />;
}

export function AnalysisView({ dispute, analysis, canDraft = true }: { dispute: Dispute; analysis: Analysis; canDraft?: boolean }) {
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

      {canDraft ? (
        <AiSection dispute={dispute} />
      ) : (
        <section className="detail-section">
          <h3>AI-assisted draft</h3>
          <p className="notice" role="note">
            Admin view is read-only. AI drafts are written by the merchant who owns the dispute.
          </p>
        </section>
      )}
      <ValidationExample dispute={dispute} />
    </>
  );
}

// Optional AI-assisted wording. Runs only when the merchant asks, and only through the DisputeDesk server.
function AiSection({ dispute }: { dispute: Dispute }) {
  const [ai, setAi] = useState<AiState>({ run: 0, assist: null, pending: false, error: null, status: null });
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    const status = new AbortController();
    // If the status can't be read, the button stays and any error shows when it is pressed.
    fetchAiStatus(status.signal)
      .then((result) => setAi((s) => ({ ...s, status: result })))
      .catch(() => {});
    return () => status.abort();
  }, []);

  function generate() {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setAi((s) => ({ ...s, pending: true, error: null }));
    fetchAiAssist(dispute, current.signal)
      .then((assist) => setAi((s) => ({ ...s, run: s.run + 1, assist, pending: false, error: null })))
      .catch((error: unknown) => {
        if (current.signal.aborted) return;
        const message = error instanceof Error ? error.message : String(error);
        // Retrying can't help when the server has AI drafting off, so show that state instead of an error.
        if ((error as { code?: string }).code === "ai_not_configured") {
          const reason = message.replace(/^AI drafting is off: /, "").replace(/ \(HTTP \d+\)$/, "");
          setAi((s) => ({ ...s, pending: false, status: { on: false, reason } }));
          return;
        }
        setAi((s) => ({ ...s, pending: false, error: message }));
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
        {ai.status?.on && ` Model: ${ai.status.model}.`}
      </p>

      {ai.status?.on === false && (
        <p className="notice" role="note">
          <strong>AI drafting is off on this server.</strong> {ai.status.reason} The rule-based analysis and draft above work
          without it.
        </p>
      )}

      {!ai.assist && ai.status?.on !== false && (
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
  return (
    <>
      <AiFindings assist={assist} wording="AI wording" />

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

// Check result, flags (with the text that was not used) and explanations with their citations.
function AiFindings({ assist, wording, openUnused = false }: { assist: AiAssist; wording: string; openUnused?: boolean }) {
  const flagged = assist.flags.length;
  return (
    <>
      <p>
        <span className={`badge badge-${flagged > 0 ? "warn" : "ok"}`}>{flagSummary(assist)}</span>{" "}
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
                <details open={openUnused}>
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
              <span className="key-tag">{e.source === "ai" ? wording : "Rules' wording"}</span>
              <span className={`badge badge-${STATUS[e.status].tone}`}>{STATUS[e.status].label}</span>
            </div>
            <p>{e.text}</p>
            {e.cites.length > 0 && <p className="records">Cites: {e.cites.map((c) => factText(assist, c)).join("; ")}</p>}
          </li>
        ))}
      </ul>
    </>
  );
}

// A fixed, deliberately wrong answer (never Gemini) run through the server's checks, to show what they catch.
// Read-only and on demand; nothing from it reaches any draft.
function ValidationExample({ dispute }: { dispute: Dispute }) {
  const [example, setExample] = useState<ExampleState>({ assist: null, pending: false, error: null });
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);

  function show() {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setExample({ assist: null, pending: true, error: null });
    fetchAiAssist(dispute, current.signal, true)
      .then((assist) => setExample({ assist, pending: false, error: null }))
      .catch((error: unknown) => {
        if (current.signal.aborted) return;
        setExample({ assist: null, pending: false, error: error instanceof Error ? error.message : String(error) });
      });
  }

  return <ValidationExampleView example={example} onShow={show} onHide={() => setExample({ assist: null, pending: false, error: null })} />;
}

export type ExampleState = { assist: AiAssist | null; pending: boolean; error: string | null };

export function ValidationExampleView({ example, onShow, onHide }: { example: ExampleState; onShow: () => void; onHide: () => void }) {
  return (
    <section className="detail-section">
      <h3>How the AI checks work</h3>
      <p className="muted">
        Runs a fixed answer with deliberate mistakes, written in advance and not by Gemini, through the same checks as a real
        AI answer. Nothing from it is used in any draft.
      </p>
      <div className="draft-actions">
        <button
          type="button"
          className="button button-secondary"
          aria-disabled={example.pending}
          aria-expanded={example.assist !== null}
          onClick={() => (example.pending ? undefined : example.assist ? onHide() : onShow())}
        >
          {example.pending ? "Checking example…" : example.assist ? "Hide validation example" : "Show a validation example"}
        </button>
      </div>
      {example.error && (
        <p className="error-text" role="alert">
          {example.error}
        </p>
      )}
      {example.assist && (
        <>
          <p className="example-note" role="note">
            <strong>VALIDATION EXAMPLE — NOT WRITTEN BY GEMINI.</strong> Fixed test text with planted mistakes: an invented
            carrier, tracking number, date and person, a signature story, proof of delivery claimed as Available, and an
            instruction.
          </p>
          <AiFindings assist={example.assist} wording="Example wording" openUnused />
        </>
      )}
    </section>
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
