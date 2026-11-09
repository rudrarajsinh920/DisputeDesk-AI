import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { MAX_CHECK_TEXT, countMarkers, fetchAiAssist, fetchAiStatus, fetchAnalysis, fetchChecklist, fetchConfirm, fetchDraftCheck, readiness } from "./analysis.ts";
import { formatDate, humanize } from "../../shared/disputes.ts";
import type {
  AiAssist,
  AiStatus,
  Analysis,
  ChecklistItem,
  ChecklistStatus,
  ClaimSupport,
  Dispute,
  DraftCheck,
  DraftLine,
  EvidenceChecklist,
  GapConfirmation,
  EvidenceRef,
  EvidenceStatus,
  ParagraphClaim,
  RecordRef,
  RequirementTier,
  SourceKind,
  SourceType,
  VerificationState,
} from "../../shared/types.ts";
import { CONFIRMABLE } from "../../shared/types.ts";
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

// "Verified against record" means consistent with the supplied record and not contradicted by it. Nothing more.
export const VERIFICATION: Record<VerificationState, string> = {
  verified: "Verified against record",
  unverified: "Unverified",
  missing: "Missing",
  conflicting: "Conflicting",
};
const SOURCE_TYPES: Record<SourceType, string> = {
  dispute_record: "Dispute record",
  buyer_statement: "Buyer's statement",
  order_record: "Order record",
  transaction_record: "Transaction record",
  delivery_record: "Delivery record",
  merchant_provided: "Merchant-provided",
  refund_record: "Refund record",
  document: "Document",
};
// Refs are "<source>:<dispute_id>:<field>"; the field is what a merchant can look up.
export const fieldOf = (ref: string) => ref.split(":").slice(2).join(":");

// Where each value came from. A null time is said plainly: no evidence field carries one.
export function RefList({ refs }: { refs: EvidenceRef[] }) {
  return (
    <ul className="ref-list">
      {refs.map((r) => (
        <li key={r.ref}>
          <span className="records">
            {r.field} = {r.value === null ? "not on record" : String(r.value)}
          </span>
          <span className="ref-meta">
            {SOURCE_TYPES[r.source_type]} · {r.origin === "demo_fixture" ? "Demo record" : "PayPal sandbox record"}
            {r.record_id ? ` ${r.record_id}` : ""} · {r.recorded_at ?? "No time on record"} · {VERIFICATION[r.verification]}
          </span>
          {r.derivation && <span className="ref-meta">{r.derivation}</span>}
        </li>
      ))}
    </ul>
  );
}

// The generated draft's lines and the records each rests on. Edited text is covered by Check my edits instead.
export function DraftSources({ lines }: { lines: DraftLine[] }) {
  const sourced = lines.filter((l) => (l.refs?.length ?? 0) > 0);
  if (sourced.length === 0) return null;
  return (
    <details className="draft-sources">
      <summary>Sources for the generated draft</summary>
      <p className="muted">The records each generated line rests on. Your own edits are covered by Check my edits.</p>
      <ul>
        {sourced.map((l, i) => (
          <li key={i}>
            <q>{l.text}</q>
            <span className="records">{l.refs!.map(fieldOf).join(", ")}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

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

  if (load.status === "loading") {
    return (
      <section className="detail-section skeleton" role="status" aria-busy="true">
        <h3>Analyzing evidence…</h3>
        {[0, 1, 2, 3].map((n) => (
          <span key={n} className="skeleton-line" aria-hidden="true" />
        ))}
      </section>
    );
  }
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

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// Counts from the evidence rules, read at a glance. Deliberately no score, percentage or outcome.
export function ReadinessSummary({ analysis }: { analysis: Analysis }) {
  const r = readiness(analysis);
  return (
    <section className="detail-section" id="case-readiness" aria-labelledby="readiness-title">
      <h3 id="readiness-title">Evidence readiness</h3>
      <dl className="readiness">
        <div className={r.key_total > 0 && r.key_on_record === r.key_total ? "is-ok" : "is-warn"}>
          <dt>Key evidence on record</dt>
          <dd>{r.key_total > 0 ? `${r.key_on_record} of ${r.key_total}` : `${r.on_record} of ${r.total}`}</dd>
          {r.key_total === 0 && <p className="muted">No key evidence is defined for this reason, so this counts every item.</p>}
        </div>
        <div className={r.missing + r.unverified > 0 ? "is-warn" : "is-ok"}>
          <dt>Missing or unverified</dt>
          <dd>{r.missing + r.unverified}</dd>
          <p className="muted">
            {plural(r.missing, "missing", "missing")}, {plural(r.unverified, "unverified", "unverified")}
          </p>
        </div>
        <div className={r.conflicts > 0 ? "is-conflict" : "is-ok"}>
          <dt>Conflicting records</dt>
          <dd>{r.conflicts}</dd>
        </div>
        <div className={r.markers > 0 ? "is-warn" : "is-ok"}>
          <dt>Gaps to fill in the draft</dt>
          <dd>{r.markers}</dd>
        </div>
      </dl>
      <p className="muted">Counts from the evidence rules below. This is not a score and does not predict the outcome.</p>
    </section>
  );
}

// The buyer's claim next to what the records show and what they leave out. It reports; it never decides who is right.
// Merchant and admin view only: buyers never receive the order, evidence or each other's words through this.
export function ClaimAndRecords({ dispute, analysis }: { dispute: Dispute; analysis: Analysis }) {
  const contested = new Set(analysis.contradictions.flatMap((c) => c.records.map((r) => r.path)));
  const shipping = dispute.order?.shipping_status;
  const tracking = dispute.order?.tracking_number?.trim();
  const shown = analysis.evidence.filter((e) => e.status === "available");
  const gaps = analysis.evidence.filter((e) => e.status !== "available");
  const orderGaps = [!shipping && "Shipping status", !tracking && "Tracking number"].filter((g): g is string => !!g);
  return (
    <section className="detail-section" id="case-sides" aria-labelledby="sides-title">
      <h3 id="sides-title">Claim and records</h3>
      <div className="sides">
        <div className="side">
          <h4>
            Buyer's claim <span className="tag tag-record">From the record</span>
          </h4>
          {dispute.customer_message ? (
            <blockquote>{dispute.customer_message}</blockquote>
          ) : (
            <p className="muted">The buyer's message was not supplied.</p>
          )}
        </div>
        <div className="side">
          <h4>
            What the records show <span className="tag tag-record">From the record</span>
          </h4>
          <ul className="side-list">
            {shipping && !contested.has("order.shipping_status") && (
              <li>
                Shipping status: {humanize(shipping)}
                <span className="records">order.shipping_status</span>
              </li>
            )}
            {tracking && !contested.has("order.tracking_number") && (
              <li>
                Tracking number: <span className="mono">{tracking}</span>
                <span className="records">order.tracking_number</span>
              </li>
            )}
            {shown.map((e) => (
              <li key={e.id}>
                {e.label}: marked available
                <span className="records">evidence.{e.id}</span>
              </li>
            ))}
            {analysis.contradictions.map((c) => (
              <li key={c.message} className="side-conflict">
                Records disagree: {c.message}
                <span className="records">{c.records.map((r) => r.path).join(", ")}</span>
              </li>
            ))}
          </ul>
          {shown.length === 0 && !shipping && !tracking && analysis.contradictions.length === 0 && (
            <p className="muted">No evidence is marked available.</p>
          )}
        </div>
        <div className="side">
          <h4>
            What the records leave out <span className="tag tag-missing">Not on record</span>
          </h4>
          {gaps.length + orderGaps.length === 0 ? (
            <p className="muted">Every evidence item is marked available.</p>
          ) : (
            <ul className="side-list">
              {orderGaps.map((g) => (
                <li key={g}>{g}</li>
              ))}
              {gaps.map((e) => (
                <li key={e.id}>
                  {e.label}: {e.status === "missing" ? "missing" : "unverified"}
                </li>
              ))}
            </ul>
          )}
          <p className="muted">Missing from the records does not show that it did not happen.</p>
        </div>
      </div>
      <p className="muted">
        DisputeDesk lays the buyer's claim next to the records. It does not decide who is right; the payment provider reviews the
        dispute.
      </p>
    </section>
  );
}

// ---- Evidence checklist for the dispute's reason (Stage 2.1). Read-only guidance; no AI, nothing saved. ----

const CHECKLIST_STATUS: Record<ChecklistStatus, { label: string; className: string }> = {
  available: { label: "Available in records", className: "badge badge-ok" },
  missing: { label: "Missing from records", className: "badge badge-warn" },
  conflicting: { label: "Conflicting records", className: "badge badge-conflict" },
  needs_confirmation: { label: "Not shown by records", className: "badge badge-info" },
  not_applicable: { label: "Not applicable", className: "badge badge-neutral" },
};
// Where the merchant may look. Each is the merchant's own system or account, never one DisputeDesk opens.
const SOURCE_LABELS: Record<SourceKind, string> = {
  shipping_provider: "Carrier or shipping",
  payment_records: "PayPal or payment account",
  order_system: "Order system",
  customer_support: "Customer messages",
  refund_records: "Refund records",
  listing_history: "Listing history",
  merchant_documents: "Your documents",
  paypal_dispute: "This PayPal dispute",
};
// "PayPal-documented" only ever appears with a verified source; the server sends none today.
const TIERS: Record<RequirementTier, { label: string; className: string }> = {
  official: { label: "PayPal-documented", className: "tag tag-record" },
  general: { label: "General guidance", className: "tag tag-guidance" },
  disputedesk: { label: "DisputeDesk guidance", className: "tag tag-standard" },
};

export type ChecklistLoad = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; checklist: EvidenceChecklist };

// Merchants may confirm gaps on demo disputes; admin only reads confirmations. Sandbox disputes are never stored.
export interface ConfirmState {
  canConfirm: boolean;
  pending: string | null;
  // Read out by screen readers after a change; focus stays on the button.
  announce: string;
  error: string | null;
  onConfirm: (itemId: string, confirmed: boolean) => void;
}
const READ_ONLY: ConfirmState = { canConfirm: false, pending: null, announce: "", error: null, onConfirm: () => {} };

export const CONFIRM_LIMIT = "Your confirmation is recorded as yours. It does not change the evidence status, and DisputeDesk has not seen the record.";

function ChecklistSection({ dispute, refsById, canConfirm }: { dispute: Dispute; refsById: Map<string, EvidenceRef>; canConfirm: boolean }) {
  const [load, setLoad] = useState<ChecklistLoad>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setLoad({ status: "loading" });
    fetchChecklist(dispute, controller.signal)
      .then((checklist) => setLoad({ status: "ready", checklist }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setLoad({ status: "error", message: error instanceof Error ? error.message : String(error) });
      });
    return () => controller.abort();
  }, [dispute, attempt]);
  const onConfirm = (itemId: string, confirmed: boolean) => {
    if (pending) return;
    setPending(itemId);
    setError(null);
    setAnnounce("");
    // The screen redraws from the server's answer, never from a guess.
    fetchConfirm(dispute, itemId, confirmed)
      .then((checklist) => {
        setLoad({ status: "ready", checklist });
        setAnnounce(confirmed ? "Confirmation recorded." : "Confirmation withdrawn.");
      })
      .catch((e: unknown) => setError(`Couldn't save that. ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => setPending(null));
  };
  const confirm: ConfirmState = { canConfirm: canConfirm && dispute.source === "demo", pending, announce, error, onConfirm };
  return <ChecklistView load={load} refsById={refsById} onRetry={() => setAttempt((n) => n + 1)} confirm={confirm} />;
}

export function ChecklistView({
  load,
  refsById,
  onRetry,
  confirm = READ_ONLY,
}: {
  load: ChecklistLoad;
  refsById: Map<string, EvidenceRef>;
  onRetry: () => void;
  confirm?: ConfirmState;
}) {
  return (
    <section className="detail-section checklist" id="case-checklist" aria-labelledby="checklist-title" aria-busy={load.status === "loading"}>
      <h3 id="checklist-title">Evidence checklist for this reason</h3>
      <p className="sr-only" role="status" aria-live="polite">
        {confirm.announce}
      </p>
      {load.status === "loading" && <p className="muted">Loading the checklist…</p>}
      {load.status === "error" && (
        <>
          <p>Couldn't load the checklist. {load.message}</p>
          <button type="button" className="button" onClick={onRetry}>
            Try again
          </button>
        </>
      )}
      {load.status === "ready" && <ChecklistItems checklist={load.checklist} refsById={refsById} confirm={confirm} />}
    </section>
  );
}

function ChecklistItems({ checklist, refsById, confirm }: { checklist: EvidenceChecklist; refsById: Map<string, EvidenceRef>; confirm: ConfirmState }) {
  const applicable = checklist.items.filter((i) => i.status !== "not_applicable");
  const notApplicable = checklist.items.filter((i) => i.status === "not_applicable");
  const byItem = new Map<string, GapConfirmation[]>();
  for (const c of checklist.confirmations ?? []) byItem.set(c.item_id, [...(byItem.get(c.item_id) ?? []), c]);
  const isConfirmed = (i: ChecklistItem) => CONFIRMABLE.includes(i.status) && byItem.has(i.id);
  const gaps = applicable.filter((i) => CONFIRMABLE.includes(i.status));
  const count = (...s: ChecklistStatus[]) => applicable.filter((i) => s.includes(i.status)).length;
  // Counts only: never a score, a share or a word like "complete". A confirmed gap is counted on its own, never as a record.
  const counts = [
    `Needs attention: ${gaps.filter((i) => !isConfirmed(i)).length}`,
    `Merchant-confirmed: ${gaps.filter(isConfirmed).length}`,
    `Record available: ${count("available")}`,
    `Conflicting: ${count("conflicting")}`,
  ];
  return (
    <>
      {!checklist.reason_known && (
        <p className="notice" role="note">
          No reason-specific checklist for this reason; showing general evidence.
        </p>
      )}
      <p className="muted">{counts.join(" · ")}. Counts only: review each item before you respond.</p>
      {confirm.error && (
        <p className="error-text" role="alert">
          {confirm.error}
        </p>
      )}
      <ul className="findings ledger">
        {applicable.map((item) => {
          const refs = item.refs.flatMap((id) => refsById.get(id) ?? []);
          const confirmations = isConfirmed(item) ? byItem.get(item.id)! : [];
          return (
            <li key={item.id} className="finding">
              <div className="finding-head">
                <span className="check-item">{item.label}</span>
                {item.priority === "key" && <span className="key-tag">Key for this reason</span>}
                <span className={TIERS[item.tier].className}>{TIERS[item.tier].label}</span>
                <span className={CHECKLIST_STATUS[item.status].className}>{CHECKLIST_STATUS[item.status].label}</span>
                {confirmations.length > 0 && <span className="tag tag-confirmed">Merchant-confirmed</span>}
              </div>
              <p className="muted">Why it may matter: {item.why}</p>
              {!confirm.canConfirm &&
                confirmations.map((c) => (
                  <p key={c.account_id} className="muted">
                    Merchant-confirmed by {c.display_name}, {formatDate(c.confirmed_at)}. DisputeDesk has not seen the record.
                  </p>
                ))}
              {item.status !== "available" && (
                <details className="checklist-guide">
                  <summary>How to fill this gap</summary>
                  <h4>Where you might find it</h4>
                  <ul>
                    {item.where.map((w) => (
                      <li key={w.text}>
                        <span className="key-tag">{SOURCE_LABELS[w.kind]}:</span> {w.text}
                      </li>
                    ))}
                  </ul>
                  <h4>Check before adding</h4>
                  <ul>
                    {item.check_before_adding.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                  <h4>What DisputeDesk can't see</h4>
                  <p>{item.limits}</p>
                  {confirm.canConfirm && CONFIRMABLE.includes(item.status) && (
                    <div className="confirm-gap">
                      <button
                        type="button"
                        className="button button-secondary"
                        aria-pressed={confirmations.length > 0}
                        aria-disabled={confirm.pending === item.id || undefined}
                        onClick={() => confirm.onConfirm(item.id, confirmations.length === 0)}
                      >
                        I have this in my records
                      </button>
                      <p className="muted">{CONFIRM_LIMIT}</p>
                    </div>
                  )}
                </details>
              )}
              {refs.length > 0 && (
                <details className="checklist-guide">
                  <summary>Based on</summary>
                  <RefList refs={refs} />
                </details>
              )}
            </li>
          );
        })}
      </ul>
      {notApplicable.length > 0 && (
        <details className="checklist-guide">
          <summary>Not applicable to this reason ({notApplicable.length})</summary>
          <ul>
            {notApplicable.map((item) => (
              <li key={item.id}>
                <span className="check-item">{item.label}</span>: {item.why}
              </li>
            ))}
          </ul>
        </details>
      )}
      <ul className="checklist-notes muted">
        {checklist.notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </>
  );
}

export function AnalysisView({ dispute, analysis, canDraft = true }: { dispute: Dispute; analysis: Analysis; canDraft?: boolean }) {
  const provenance = analysis.provenance;
  const refsById = new Map(provenance?.refs.map((r) => [r.ref, r]));
  return (
    <>
      <ReadinessSummary analysis={analysis} />
      <ClaimAndRecords dispute={dispute} analysis={analysis} />
      <ChecklistSection dispute={dispute} refsById={refsById} canConfirm={canDraft} />

      <section className="detail-section" id="case-evidence">
        <h3>Evidence analysis</h3>
        <p className="muted">
          Based only on the supplied records. "Available" means the record marks it available; DisputeDesk does not inspect
          the documents themselves.
          {provenance && ' "Verified against record" means the supplied record backs it and nothing in the records contradicts it.'}
        </p>
        <ul className="findings ledger">
          {analysis.evidence.map((e) => {
            const found = provenance?.findings.find((f) => f.evidence_id === e.id);
            const refs = found?.refs.flatMap((id) => refsById.get(id) ?? []) ?? [];
            return (
              <li key={e.id} className="finding">
                <div className="finding-head">
                  <span className={`mark mark-${e.status}`} aria-hidden="true" />
                  <span className="check-item">{e.label}</span>
                  {e.priority === "key" && <span className="key-tag">Key for this reason</span>}
                  {/* Missing and unverified say the same as the status badge, so only the states that add something get a tag. */}
                  {(found?.verification === "verified" || found?.verification === "conflicting") && (
                    <span className={`tag tag-v-${found.verification}`}>{VERIFICATION[found.verification]}</span>
                  )}
                  <span className={`badge badge-${STATUS[e.status].tone}`}>{STATUS[e.status].label}</span>
                </div>
                <p>{e.explanation}</p>
                <p className="muted">Why it matters: {e.relevance}</p>
                {refs.length > 0 ? (
                  <>
                    <p className="records">Based on:</p>
                    <RefList refs={refs} />
                  </>
                ) : (
                  <p className="records">Based on: {e.records.map(recordText).join("; ")}</p>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="detail-section" id="case-contradictions">
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

      <section className="detail-section" id="case-steps">
        <h3>Next steps</h3>
        <ol className="steps">
          {analysis.next_steps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      </section>

      <DraftEditor
        id={`draft-${dispute.dispute_id}`}
        sectionId="case-draft"
        title="Response draft"
        note="Draft only. It requires merchant review, is never sent to PayPal, and edits are not saved when you leave this dispute."
        generated={analysis.draft.text}
        sources={analysis.draft.lines}
        checkFor={canDraft ? dispute : undefined}
      />

      {canDraft ? (
        <AiSection dispute={dispute} />
      ) : (
        <section className="detail-section" id="case-ai">
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
    <section className="detail-section" id="case-ai">
      <div className="section-head">
        <h3>AI-assisted draft</h3>
        <span className="tag tag-ai">Worded by Gemini · checked by DisputeDesk</span>
      </div>
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
        sources={assist.draft.lines}
        checkFor={assist}
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

      <ul className="findings ledger">
        {assist.explanations.map((e) => (
          <li key={e.evidence_id} className="finding">
            <div className="finding-head">
              <span className={`mark mark-${e.status}`} aria-hidden="true" />
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
  if (!fact) return id;
  return `${id} ${fact.label} = ${fact.value}${fact.ref ? ` (${fieldOf(fact.ref)})` : ""}`;
}

type CheckState = { pending: boolean; result: DraftCheck | null; error: string | null };
const NO_CHECK: CheckState = { pending: false, result: null, error: null };

// Editable draft with a live count of markers left, Copy and Reset. Edits are never saved. With checkFor (merchants
// only), "Check my edits" sends the text for the same checks as AI text; the result is advisory and changes nothing.
export function DraftEditor({
  id,
  sectionId,
  title,
  note,
  generated,
  sources,
  extraAction,
  checkFor,
}: {
  id: string;
  sectionId?: string;
  title: string;
  note: string;
  generated: string;
  // The generated draft's lines with their refs, listed under the editor as "Sources".
  sources?: DraftLine[];
  // Gets whether the merchant has edited the draft, so an action can warn before discarding edits.
  extraAction?: (edited: boolean) => ReactNode;
  checkFor?: Pick<Dispute, "source" | "dispute_id">;
}) {
  const [draft, setDraft] = useState(generated);
  const [copyStatus, setCopyStatus] = useState("");
  const [check, setCheck] = useState<CheckState>(NO_CHECK);
  const edit = (text: string) => {
    setDraft(text);
    setCheck(NO_CHECK);
  };
  useEffect(() => {
    edit(generated);
    setCopyStatus("");
  }, [generated]);

  // Checked here first, so a long draft gets a plain answer before anything is sent. Copy still works at any length.
  const tooLong = draft.length > MAX_CHECK_TEXT;
  async function checkEdits() {
    if (!checkFor || check.pending || tooLong) return;
    setCheck({ pending: true, result: null, error: null });
    try {
      setCheck({ pending: false, result: await fetchDraftCheck(checkFor, draft), error: null });
    } catch (e) {
      setCheck({ pending: false, result: null, error: e instanceof Error ? e.message : "The check could not run." });
    }
  }
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
    <section className="detail-section" id={sectionId}>
      <div className="draft-head">
        <h3>
          <label htmlFor={id}>{title}</label>
        </h3>
        <span className={`badge badge-${remaining > 0 ? "warn" : "ok"}`}>
          {remaining > 0 ? `${remaining} marker${remaining === 1 ? "" : "s"} to resolve` : "No markers left"}
        </span>
      </div>
      <p className="muted">{note}</p>
      <textarea
        id={id}
        className="draft"
        value={draft}
        onChange={(e) => edit(e.target.value)}
        rows={18}
        aria-describedby={checkFor && tooLong ? `${id}-length` : undefined}
      />
      <div className="draft-actions">
        <button type="button" className="button" onClick={copyDraft}>
          Copy draft
        </button>
        <button
          type="button"
          className="button button-secondary"
          disabled={draft === generated}
          onClick={() => {
            edit(generated);
            setCopyStatus("");
          }}
        >
          Reset to generated draft
        </button>
        {checkFor ? (
          <button type="button" className="button button-secondary" aria-disabled={check.pending || tooLong} onClick={checkEdits}>
            {check.pending ? "Checking…" : "Check my edits"}
          </button>
        ) : null}
        {extraAction?.(draft !== generated)}
        <span className="muted" role="status">
          {copyStatus}
        </span>
      </div>
      {checkFor && tooLong ? (
        <p className="error-text" id={`${id}-length`} role="status">
          {`This draft has ${draft.length.toLocaleString("en-US")} characters. Check my edits works on drafts up to ${MAX_CHECK_TEXT.toLocaleString("en-US")}, so shorten it to check it. Copy still works.`}
        </p>
      ) : null}
      {check.error ? (
        <p className="error-text" role="alert">
          {check.error}
        </p>
      ) : null}
      {check.result ? <CheckResult result={check.result} /> : null}
      {sources ? <DraftSources lines={sources} /> : null}
    </section>
  );
}

// Advisory: the merchant may hold records DisputeDesk does not have, so flags ask for a check and never change the text.
// How far DisputeDesk's records back each paragraph. Never "true" or "false": the merchant may hold other records.
export const CLAIM_LABELS: Record<ClaimSupport, string> = {
  supported: "Backed by DisputeDesk's records",
  unsupported: "Not in DisputeDesk's records",
  flagged: "Check against your records",
  not_a_claim: "No factual claim found",
};

function ClaimList({ claims }: { claims: ParagraphClaim[] }) {
  return (
    <ul className="check-claims">
      {claims.map((c) => (
        <li key={c.paragraph} className={`claim-${c.support}`}>
          <span className="claim-head">
            <strong>Your paragraph {c.paragraph}</strong>
            <span className={`tag tag-claim-${c.support}`}>{CLAIM_LABELS[c.support]}</span>
          </span>
          <q>{c.excerpt}</q>
          {c.reasons.length > 0 && (
            <ul className="check-reasons">
              {c.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
          {c.refs.length > 0 && <span className="records">Records: {c.refs.map(fieldOf).join(", ")}</span>}
        </li>
      ))}
    </ul>
  );
}

export function CheckResult({ result }: { result: DraftCheck }) {
  const markers = `${result.markers_left} marker${result.markers_left === 1 ? "" : "s"} left to resolve.`;
  // Older servers send no claims; the flag list is then shown on its own, as before.
  const claims = result.claims ?? [];
  const unsupported = claims.filter((c) => c.support === "unsupported").length;
  return (
    <div className="draft-check" role="status">
      {result.checked === 0 ? (
        <p>No text of your own to check yet. Lines DisputeDesk wrote, quoted buyer lines and marker lines are skipped. {markers}</p>
      ) : result.flagged.length === 0 && unsupported > 0 ? (
        <>
          <p>
            {unsupported === 1 ? "1 paragraph makes a claim" : `${unsupported} paragraphs make claims`} DisputeDesk has no record for. Confirm
            it from your own records before sending. {markers}
          </p>
          <ClaimList claims={claims} />
        </>
      ) : result.flagged.length === 0 ? (
        <>
          <p>
            Nothing in the {result.checked === 1 ? "paragraph" : `${result.checked} paragraphs`} you wrote goes beyond the records
            DisputeDesk has. {markers}
          </p>
          {claims.length > 0 && <ClaimList claims={claims} />}
        </>
      ) : claims.length > 0 ? (
        <>
          <p>
            {result.flagged.length === 1 ? "1 paragraph mentions" : `${result.flagged.length} paragraphs mention`} something that is not in
            the records DisputeDesk has. Confirm it from your own records before sending. {markers}
          </p>
          <ClaimList claims={claims} />
        </>
      ) : (
        <>
          <p>
            {result.flagged.length === 1 ? "1 paragraph mentions" : `${result.flagged.length} paragraphs mention`} something that is not in
            the records DisputeDesk has. Confirm it from your own records before sending. {markers}
          </p>
          <ul className="check-flags">
            {result.flagged.map((f) => (
              <li key={f.paragraph}>
                <strong>Your paragraph {f.paragraph}</strong>
                <q>{f.excerpt}</q>
                <ul className="check-reasons">
                  {f.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="muted">
        This check compares your text with the records only. You may hold records DisputeDesk does not, so it never edits or blocks your
        text.
      </p>
    </div>
  );
}
