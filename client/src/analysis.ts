import { serverError } from "./sandbox.ts";
import type { AiAssist, AiStatus, Analysis, Dispute, DisputeDocument, DocumentPage, DraftCheck, EvidenceChecklist } from "../../shared/types.ts";

// Sends only which record to analyze; the server loads the record itself. Nothing here talks to PayPal.
export async function fetchAnalysis(dispute: Dispute, signal?: AbortSignal): Promise<Analysis> {
  const response = await fetch("/api/analysis", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source: dispute.source, dispute_id: dispute.dispute_id }),
    signal,
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw serverError(response, body);

  const analysis = body as Analysis | null;
  if (
    analysis?.dispute_id !== dispute.dispute_id ||
    analysis.source !== dispute.source ||
    !Array.isArray(analysis.evidence) ||
    typeof analysis.draft?.text !== "string"
  ) {
    throw new Error("The DisputeDesk server sent an unexpected analysis.");
  }
  return analysis;
}

// On demand only: asks the server for an AI-assisted draft. The server holds the Gemini key, loads the record,
// and checks every line the model writes; this only names the record.
// example asks instead for the validation example: fixed wrong text through the same checks, never Gemini.
export async function fetchAiAssist(dispute: Dispute, signal?: AbortSignal, example = false): Promise<AiAssist> {
  const response = await fetch(example ? "/api/analysis/ai/example" : "/api/analysis/ai", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source: dispute.source, dispute_id: dispute.dispute_id }),
    signal,
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw serverError(response, body);

  const assist = body as AiAssist | null;
  if (
    assist?.dispute_id !== dispute.dispute_id ||
    assist.source !== dispute.source ||
    (assist.status !== "ok" && assist.status !== "flagged") ||
    !Array.isArray(assist.explanations) ||
    !Array.isArray(assist.flags) ||
    typeof assist.draft?.text !== "string"
  ) {
    throw new Error("The DisputeDesk server sent an unexpected AI draft.");
  }
  return assist;
}

// Sends the merchant's edited text for the same checks as AI text. The server stores nothing and calls no AI.
export async function fetchDraftCheck(target: Pick<Dispute, "source" | "dispute_id">, text: string, signal?: AbortSignal): Promise<DraftCheck> {
  const response = await fetch("/api/analysis/check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source: target.source, dispute_id: target.dispute_id, text }),
    signal,
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw serverError(response, body);
  const check = body as DraftCheck | null;
  if (check?.dispute_id !== target.dispute_id || !Array.isArray(check.flagged) || typeof check.markers_left !== "number") {
    throw new Error("The DisputeDesk server sent an unexpected check result.");
  }
  return check;
}

// The evidence checklist for the dispute's reason. The server builds it from the same rules as the analysis.
export async function fetchChecklist(dispute: Pick<Dispute, "source" | "dispute_id">, signal?: AbortSignal): Promise<EvidenceChecklist> {
  const response = await fetch("/api/analysis/checklist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source: dispute.source, dispute_id: dispute.dispute_id }),
    signal,
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw serverError(response, body);
  const checklist = body as EvidenceChecklist | null;
  if (checklist?.dispute_id !== dispute.dispute_id || checklist.source !== dispute.source || !Array.isArray(checklist.items)) {
    throw new Error("The DisputeDesk server sent an unexpected checklist.");
  }
  return checklist;
}

// Records or withdraws the signed-in merchant's statement that they hold a record for a gap. Sends IDs only; the
// server checks the item is a gap, stores who and when, and answers with the updated checklist.
export async function fetchConfirm(
  dispute: Pick<Dispute, "source" | "dispute_id">,
  itemId: string,
  confirmed: boolean,
  signal?: AbortSignal,
): Promise<EvidenceChecklist> {
  const response = await fetch("/api/analysis/checklist/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source: dispute.source, dispute_id: dispute.dispute_id, item_id: itemId, confirmed }),
    signal,
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw serverError(response, body);
  const checklist = body as EvidenceChecklist | null;
  if (checklist?.dispute_id !== dispute.dispute_id || !Array.isArray(checklist.items) || !Array.isArray(checklist.confirmations)) {
    throw new Error("The DisputeDesk server sent an unexpected checklist.");
  }
  return checklist;
}

// ---- Merchant documents (Stage 3). Demo disputes only. The server answers with the dispute's document list. ----

async function documentList(response: Response): Promise<DisputeDocument[]> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw serverError(response, body);
  const documents = (body as { documents?: unknown } | null)?.documents;
  if (!Array.isArray(documents)) throw new Error("The DisputeDesk server sent an unexpected document list.");
  return documents as DisputeDocument[];
}

const lookupBody = (dispute: Pick<Dispute, "source" | "dispute_id">, extra: object = {}) =>
  JSON.stringify({ source: dispute.source, dispute_id: dispute.dispute_id, ...extra });

export async function fetchDocuments(dispute: Pick<Dispute, "source" | "dispute_id">, signal?: AbortSignal): Promise<DisputeDocument[]> {
  return documentList(await fetch("/api/documents", { method: "POST", headers: { "Content-Type": "application/json" }, body: lookupBody(dispute), signal }));
}

// The body is the file itself. The filename travels percent-encoded in a header, never in the URL.
export async function uploadDocument(dispute: Pick<Dispute, "dispute_id">, file: File, signal?: AbortSignal): Promise<DisputeDocument[]> {
  return documentList(
    await fetch("/api/documents/upload", {
      method: "POST",
      headers: { "Content-Type": file.type, "X-Dispute-Id": dispute.dispute_id, "X-Document-Name": encodeURIComponent(file.name) },
      body: file,
      signal,
    }),
  );
}

// The text read from one PDF, page by page. Untrusted: it is shown as plain text only.
export async function fetchDocumentPages(dispute: Pick<Dispute, "source" | "dispute_id">, documentId: string, signal?: AbortSignal): Promise<DocumentPage[]> {
  const response = await fetch("/api/documents/pages", { method: "POST", headers: { "Content-Type": "application/json" }, body: lookupBody(dispute, { document_id: documentId }), signal });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw serverError(response, body);
  const pages = (body as { pages?: unknown } | null)?.pages;
  if (!Array.isArray(pages) || !pages.every((p) => typeof p?.page === "number" && typeof p?.text === "string")) {
    throw new Error("The DisputeDesk server sent unexpected document text.");
  }
  return pages as DocumentPage[];
}

export async function deleteDocument(dispute: Pick<Dispute, "source" | "dispute_id">, documentId: string, signal?: AbortSignal): Promise<DisputeDocument[]> {
  return documentList(
    await fetch("/api/documents/delete", { method: "POST", headers: { "Content-Type": "application/json" }, body: lookupBody(dispute, { document_id: documentId }), signal }),
  );
}

export { MAX_CHECK_TEXT, countMarkers, readiness } from "../../shared/readiness.ts";
export type { Readiness } from "../../shared/readiness.ts";

// Whether the server has AI drafting on, so the page can say so before anyone clicks. Never calls Gemini.
export async function fetchAiStatus(signal?: AbortSignal): Promise<AiStatus> {
  const response = await fetch("/api/health", { signal });
  const body = (await response.json().catch(() => null)) as { ai?: { configured?: unknown; model?: unknown; reason?: unknown } } | null;
  if (!response.ok) throw serverError(response, body);
  const ai = body?.ai;
  if (ai?.configured === true && typeof ai.model === "string") return { on: true, model: ai.model };
  if (ai?.configured === false && typeof ai.reason === "string") return { on: false, reason: ai.reason };
  throw new Error("The DisputeDesk server sent an unexpected status.");
}
