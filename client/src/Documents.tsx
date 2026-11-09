import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { formatDate } from "../../shared/disputes.ts";
import { DOCUMENT_LIMITS, DOCUMENT_MEDIA_TYPES } from "../../shared/types.ts";
import type { Dispute, DisputeDocument, DocumentMediaType, DocumentPage } from "../../shared/types.ts";
import { deleteDocument, fetchDocumentPages, fetchDocuments, uploadDocument } from "./analysis.ts";

// Merchant documents (Stage 3). Demo disputes only. DisputeDesk stores a file and reads the text layer of a PDF;
// it has not checked what the file says or whether it is genuine, and nothing here changes an evidence status,
// the checklist or the draft. Text read from a file is untrusted and is shown as plain text only.

export const DOCUMENT_NOTICE =
  "Upload only synthetic test files. DisputeDesk stores the file and reads the text of a PDF, but has not checked it: it does not change any evidence status, and files are not scanned for viruses.";
export const DOCUMENT_ADMIN_NOTICE = "Files merchants attached to this dispute. DisputeDesk has not checked them. Read-only.";
export const DOCUMENT_TEXT_NOTICE = "Text as written in the file. DisputeDesk has not checked it against your records.";

const KIND: Record<DocumentMediaType, string> = { "application/pdf": "PDF", "image/png": "PNG image", "image/jpeg": "JPEG image" };

export function documentStatusLine(doc: Pick<DisputeDocument, "status" | "page_count" | "media_type">): string {
  switch (doc.status) {
    case "pending":
      return "Reading the text…";
    case "extracted":
      return `Text read from ${doc.page_count} ${doc.page_count === 1 ? "page" : "pages"}.`;
    case "no_text":
      return doc.media_type === "application/pdf"
        ? "No text found. It may be a scanned image; DisputeDesk does not read text in pictures."
        : "An image: DisputeDesk does not read text in pictures.";
    case "failed":
      return "DisputeDesk couldn't read text from this file.";
  }
}

export const formatSize = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

// Checked here only to answer quickly; the server checks the type and size again from the bytes.
export function fileProblem(file: Pick<File, "type" | "size">): string | null {
  if (!DOCUMENT_MEDIA_TYPES.includes(file.type as DocumentMediaType)) return "Choose a PDF, PNG or JPEG file.";
  if (file.size === 0) return "The file is empty.";
  if (file.size > DOCUMENT_LIMITS.maxBytes) return "The file is larger than 5 MB.";
  return null;
}

export type DocumentsLoad = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; documents: DisputeDocument[] };
export type PagesLoad = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; pages: DocumentPage[] };

export interface DocumentActions {
  canEdit: boolean;
  pending: string | null;
  announce: string;
  error: string | null;
  onUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  onDelete: (doc: DisputeDocument) => void;
  // Open text views, by document ID.
  texts: Record<string, PagesLoad>;
  onToggleText: (doc: DisputeDocument) => void;
}
const READ_ONLY: DocumentActions = { canEdit: false, pending: null, announce: "", error: null, onUpload: () => {}, onDelete: () => {}, texts: {}, onToggleText: () => {} };

// While a PDF is being read, the list is asked again every few seconds, a limited number of times.
const POLL_MS = 2000;
const MAX_POLLS = 15;

export function DocumentsSection({ dispute, canEdit }: { dispute: Dispute; canEdit: boolean }) {
  const [load, setLoad] = useState<DocumentsLoad>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [texts, setTexts] = useState<Record<string, PagesLoad>>({});
  const busy = useRef(false);
  const polls = useRef(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoad({ status: "loading" });
    setTexts({});
    polls.current = 0;
    fetchDocuments(dispute, controller.signal)
      .then((documents) => setLoad({ status: "ready", documents }))
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setLoad({ status: "error", message: e instanceof Error ? e.message : String(e) });
      });
    return () => controller.abort();
  }, [dispute, attempt]);

  const reading = load.status === "ready" && load.documents.some((d) => d.status === "pending");
  useEffect(() => {
    if (!reading || polls.current >= MAX_POLLS) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      polls.current += 1;
      fetchDocuments(dispute, controller.signal)
        .then((documents) => setLoad({ status: "ready", documents }))
        .catch(() => {}); // a missed refresh keeps the last list; the next one or a reload catches up
    }, POLL_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [dispute, load, reading]);

  // The list redraws from the server's answer, never from a guess.
  const run = (key: string, action: () => Promise<DisputeDocument[]>, done: string) => {
    if (busy.current) return;
    busy.current = true;
    setPending(key);
    setError(null);
    setAnnounce("");
    action()
      .then((documents) => {
        polls.current = 0;
        setLoad({ status: "ready", documents });
        setAnnounce(done);
        // A deleted row takes its button with it: keep keyboard focus in the section.
        if (key !== "upload") document.getElementById("documents-title")?.focus();
      })
      .catch((e: unknown) => setError(`Couldn't save that. ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => {
        busy.current = false;
        setPending(null);
      });
  };
  const onUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    const problem = fileProblem(file);
    if (problem) {
      setAnnounce("");
      setError(problem);
      return;
    }
    run("upload", () => uploadDocument(dispute, file), `${file.name} added.`);
  };
  const onDelete = (doc: DisputeDocument) => {
    if (!window.confirm(`Delete ${doc.display_name}? This can't be undone.`)) return;
    run(doc.id, () => deleteDocument(dispute, doc.id), `${doc.display_name} deleted.`);
  };
  const onToggleText = (doc: DisputeDocument) => {
    if (texts[doc.id]) {
      setTexts(({ [doc.id]: _closed, ...rest }) => rest);
      return;
    }
    setTexts((t) => ({ ...t, [doc.id]: { status: "loading" } }));
    fetchDocumentPages(dispute, doc.id)
      .then((pages) => setTexts((t) => (t[doc.id] ? { ...t, [doc.id]: { status: "ready", pages } } : t)))
      .catch((e: unknown) => setTexts((t) => (t[doc.id] ? { ...t, [doc.id]: { status: "error", message: e instanceof Error ? e.message : String(e) } } : t)));
  };
  const actions: DocumentActions = { canEdit, pending, announce, error, onUpload, onDelete, texts, onToggleText };
  return <DocumentsView load={load} onRetry={() => setAttempt((n) => n + 1)} actions={actions} />;
}

function DocumentText({ id, text }: { id: string; text: PagesLoad }) {
  if (text.status === "loading") return <p className="muted" id={id}>Loading the text…</p>;
  if (text.status === "error") return <p id={id}>Couldn't load the text. {text.message}</p>;
  return (
    <div className="document-text" id={id}>
      <p className="muted">{DOCUMENT_TEXT_NOTICE}</p>
      <ol className="document-pages">
        {text.pages.map((p) => (
          <li key={p.page}>
            <p className="document-page-label">Page {p.page}</p>
            {/* Plain text only: React escapes it, and it is never parsed as HTML or Markdown. */}
            {p.text === "" ? <p className="muted">No text on this page.</p> : <pre className="document-page-text">{p.text}</pre>}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function DocumentsView({ load, onRetry, actions = READ_ONLY }: { load: DocumentsLoad; onRetry: () => void; actions?: DocumentActions }) {
  const documents = load.status === "ready" ? load.documents : [];
  const full = documents.length >= DOCUMENT_LIMITS.perDispute;
  return (
    <section className="detail-section documents" id="case-documents" aria-labelledby="documents-title" aria-busy={load.status === "loading" || actions.pending !== null}>
      <h3 id="documents-title" tabIndex={-1}>{actions.canEdit ? "Your documents" : "Documents"}</h3>
      <p className="documents-notice">{actions.canEdit ? DOCUMENT_NOTICE : DOCUMENT_ADMIN_NOTICE}</p>
      <p className="sr-only" role="status" aria-live="polite">
        {actions.announce}
      </p>
      {load.status === "loading" && <p className="muted">Loading documents…</p>}
      {load.status === "error" && (
        <>
          <p>Couldn't load the documents. {load.message}</p>
          <button type="button" className="button" onClick={onRetry}>
            Try again
          </button>
        </>
      )}
      {load.status === "ready" && documents.length === 0 && <p className="muted">No documents attached.</p>}
      {documents.length > 0 && (
        <ul className="document-list">
          {documents.map((doc) => {
            const text = actions.texts[doc.id];
            const textId = `document-text-${doc.id}`;
            return (
              <li key={doc.id}>
                <div className="document-head">
                  <span className="document-name">{doc.display_name}</span>
                  <span className="tag tag-missing">Not verified</span>
                </div>
                <p className="muted">
                  {KIND[doc.media_type]} · {formatSize(doc.byte_size)} · added {formatDate(doc.uploaded_at)}
                  {!actions.canEdit && ` · ${doc.account_id}`}
                </p>
                <p>{documentStatusLine(doc)}</p>
                {(doc.status === "extracted" || actions.canEdit) && (
                  <div className="document-actions">
                    {doc.status === "extracted" && (
                      <button
                        type="button"
                        className="button button-secondary"
                        aria-expanded={Boolean(text)}
                        aria-controls={text ? textId : undefined}
                        aria-label={`${text ? "Hide" : "Show"} text of ${doc.display_name}`}
                        onClick={() => actions.onToggleText(doc)}
                      >
                        {text ? "Hide text" : "Show text"}
                      </button>
                    )}
                    {actions.canEdit && (
                      <button
                        type="button"
                        className="button button-secondary"
                        aria-label={`Delete ${doc.display_name}`}
                        aria-disabled={actions.pending === doc.id || undefined}
                        onClick={() => actions.onDelete(doc)}
                      >
                        {actions.pending === doc.id ? "Deleting…" : "Delete"}
                      </button>
                    )}
                  </div>
                )}
                {text && <DocumentText id={textId} text={text} />}
              </li>
            );
          })}
        </ul>
      )}
      {actions.canEdit && load.status === "ready" && (
        <div className="document-upload">
          <label htmlFor="document-file">
            {full ? `This dispute already has ${DOCUMENT_LIMITS.perDispute} documents. Delete one to add another.` : "Add a file (PDF, PNG or JPEG, up to 5 MB)"}
          </label>
          <input
            id="document-file"
            type="file"
            accept={DOCUMENT_MEDIA_TYPES.join(",")}
            disabled={full || actions.pending !== null}
            aria-describedby={actions.error ? "document-error" : undefined}
            onChange={actions.onUpload}
          />
          {actions.pending === "upload" && <p className="muted">Uploading…</p>}
        </div>
      )}
      {actions.error && (
        <p className="document-error" id="document-error" role="alert">
          {actions.error}
        </p>
      )}
    </section>
  );
}
