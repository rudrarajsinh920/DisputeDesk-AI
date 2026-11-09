import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { formatDate } from "../../shared/disputes.ts";
import { DOCUMENT_LIMITS, DOCUMENT_MEDIA_TYPES } from "../../shared/types.ts";
import type { Dispute, DisputeDocument, DocumentMediaType, DocumentStatus } from "../../shared/types.ts";
import { deleteDocument, fetchDocuments, uploadDocument } from "./analysis.ts";

// Merchant documents (Stage 3). Demo disputes only. DisputeDesk stores a file; it has not checked what the file
// says or whether it is genuine, and nothing here changes an evidence status, the checklist or the draft.

export const DOCUMENT_NOTICE =
  "Upload only synthetic test files. DisputeDesk stores the file but has not checked it: it does not change any evidence status, and files are not scanned for viruses.";
export const DOCUMENT_ADMIN_NOTICE = "Files merchants attached to this dispute. DisputeDesk has not checked them. Read-only.";

const KIND: Record<DocumentMediaType, string> = { "application/pdf": "PDF", "image/png": "PNG image", "image/jpeg": "JPEG image" };
// Pending is the only status in this phase: reading text from a PDF comes later.
export const DOCUMENT_STATUS: Record<DocumentStatus, string> = {
  pending: "Stored. Text not read yet.",
  extracted: "Text read from the file.",
  no_text: "No text found. DisputeDesk does not read scanned images yet.",
  failed: "DisputeDesk couldn't read this file.",
};

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

export interface DocumentActions {
  canEdit: boolean;
  pending: string | null;
  announce: string;
  error: string | null;
  onUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  onDelete: (doc: DisputeDocument) => void;
}
const READ_ONLY: DocumentActions = { canEdit: false, pending: null, announce: "", error: null, onUpload: () => {}, onDelete: () => {} };

export function DocumentsSection({ dispute, canEdit }: { dispute: Dispute; canEdit: boolean }) {
  const [load, setLoad] = useState<DocumentsLoad>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    setLoad({ status: "loading" });
    fetchDocuments(dispute, controller.signal)
      .then((documents) => setLoad({ status: "ready", documents }))
      .catch((e: unknown) => {
        if (controller.signal.aborted) return;
        setLoad({ status: "error", message: e instanceof Error ? e.message : String(e) });
      });
    return () => controller.abort();
  }, [dispute, attempt]);

  // The list redraws from the server's answer, never from a guess.
  const run = (key: string, action: () => Promise<DisputeDocument[]>, done: string) => {
    if (busy.current) return;
    busy.current = true;
    setPending(key);
    setError(null);
    setAnnounce("");
    action()
      .then((documents) => {
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
  const actions: DocumentActions = { canEdit, pending, announce, error, onUpload, onDelete };
  return <DocumentsView load={load} onRetry={() => setAttempt((n) => n + 1)} actions={actions} />;
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
          {documents.map((doc) => (
            <li key={doc.id}>
              <div className="document-head">
                <span className="document-name">{doc.display_name}</span>
                <span className="tag tag-missing">Not verified</span>
              </div>
              <p className="muted">
                {KIND[doc.media_type]} · {formatSize(doc.byte_size)} · added {formatDate(doc.uploaded_at)}
                {!actions.canEdit && ` · ${doc.account_id}`}
              </p>
              <p>{DOCUMENT_STATUS[doc.status]}</p>
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
            </li>
          ))}
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
