import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { DisputeDocument, Dispute, DocumentMediaType, DocumentPage, DocumentStatus, GapConfirmation } from "../../shared/types.ts";
import { DOCUMENT_LIMITS } from "../../shared/types.ts";
import type { Account } from "./auth.ts";
import { transaction } from "./db.ts";
import type { AUDIT_EVENTS } from "./db.ts";
import type { WorkerResult } from "./extract.ts";
import { validateDispute } from "./validate.ts";

// Reads and writes accounts, demo disputes and the audit log. Parameterized statements only.

const EVIDENCE_KEYS = ["order_confirmation", "shipping_tracking", "proof_of_delivery", "customer_communication"] as const;

type Row = Record<string, string | number | null>;

function toAccount(db: DatabaseSync, row: Row | undefined): Account | null {
  if (!row) return null;
  const ids = db.prepare("SELECT dispute_id FROM dispute_access WHERE account_id = ? ORDER BY dispute_id").all(row.id as string);
  return {
    id: row.id as string,
    email: row.email as string,
    role: row.role as Account["role"],
    display_name: row.display_name as string,
    paypal_sandbox: row.paypal_sandbox === 1,
    dispute_ids: ids.map((r) => r.dispute_id as string),
    password_hash: row.password_hash as string,
  };
}

const ACCOUNT_COLUMNS = "id, email, role, display_name, paypal_sandbox, password_hash";

export const getAccount = (db: DatabaseSync, id: string) =>
  toAccount(db, db.prepare(`SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE id = ?`).get(id) as Row | undefined);

export const findAccountByEmail = (db: DatabaseSync, email: string) =>
  toAccount(db, db.prepare(`SELECT ${ACCOUNT_COLUMNS} FROM accounts WHERE email = ?`).get(email) as Row | undefined);

// In the order the accounts were first stored.
export const listAccounts = (db: DatabaseSync) =>
  (db.prepare(`SELECT ${ACCOUNT_COLUMNS} FROM accounts ORDER BY rowid`).all() as Row[]).map((r) => toAccount(db, r)!);

function writeAccount(db: DatabaseSync, a: Account, now: number) {
  const previous = db.prepare("SELECT password_hash FROM accounts WHERE id = ?").get(a.id) as Row | undefined;
  db.prepare(
    `INSERT INTO accounts (${ACCOUNT_COLUMNS}, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET email = excluded.email, role = excluded.role, display_name = excluded.display_name,
       paypal_sandbox = excluded.paypal_sandbox, password_hash = excluded.password_hash`,
  ).run(a.id, a.email, a.role, a.display_name, a.paypal_sandbox ? 1 : 0, a.password_hash, now);
  // A new password ends every session signed in with the old one.
  if (previous && previous.password_hash !== a.password_hash) db.prepare("DELETE FROM sessions WHERE account_id = ?").run(a.id);
  db.prepare("DELETE FROM dispute_access WHERE account_id = ?").run(a.id);
  const grant = db.prepare("INSERT INTO dispute_access (account_id, dispute_id) VALUES (?, ?)");
  for (const id of a.dispute_ids) grant.run(a.id, id);
}

// The account and its dispute access are stored together, or not at all.
export function createAccount(db: DatabaseSync, account: Account, now: number) {
  transaction(db, () => {
    db.prepare(`INSERT INTO accounts (${ACCOUNT_COLUMNS}, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      account.id,
      account.email,
      account.role,
      account.display_name,
      account.paypal_sandbox ? 1 : 0,
      account.password_hash,
      now,
    );
    const grant = db.prepare("INSERT INTO dispute_access (account_id, dispute_id) VALUES (?, ?)");
    for (const id of account.dispute_ids) grant.run(account.id, id);
  });
}

function writeDispute(db: DatabaseSync, d: Dispute, now: number) {
  db.prepare(
    `INSERT INTO disputes (dispute_id, source, reason, status, amount_currency, amount_value, create_time, customer_message, order_json, has_evidence, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (dispute_id) DO UPDATE SET source = excluded.source, reason = excluded.reason, status = excluded.status,
       amount_currency = excluded.amount_currency, amount_value = excluded.amount_value, create_time = excluded.create_time,
       customer_message = excluded.customer_message, order_json = excluded.order_json, has_evidence = excluded.has_evidence,
       updated_at = excluded.updated_at`,
  ).run(
    d.dispute_id,
    d.source,
    d.reason,
    d.status,
    d.amount?.currency_code ?? null,
    d.amount?.value ?? null,
    d.create_time ?? null,
    d.customer_message ?? null,
    d.order === undefined ? null : JSON.stringify(d.order),
    d.evidence === undefined ? 0 : 1,
    now,
  );
  db.prepare("DELETE FROM dispute_evidence WHERE dispute_id = ?").run(d.dispute_id);
  const flag = db.prepare("INSERT INTO dispute_evidence (dispute_id, evidence_key, available) VALUES (?, ?, ?)");
  for (const key of EVIDENCE_KEYS) {
    const value = d.evidence?.[key];
    if (value !== undefined) flag.run(d.dispute_id, key, value ? 1 : 0);
  }
}

// Rebuilt through the same validation as the fixture files, so a stored record has exactly the fixture's shape.
export function loadDisputes(db: DatabaseSync): Dispute[] {
  const evidence = new Map<string, Record<string, boolean>>();
  for (const r of db.prepare("SELECT dispute_id, evidence_key, available FROM dispute_evidence").all() as Row[]) {
    const flags = evidence.get(r.dispute_id as string) ?? {};
    flags[r.evidence_key as string] = r.available === 1;
    evidence.set(r.dispute_id as string, flags);
  }
  return (db.prepare("SELECT * FROM disputes ORDER BY dispute_id").all() as Row[]).map((r) => {
    const result = validateDispute({
      source: r.source,
      dispute_id: r.dispute_id,
      reason: r.reason,
      status: r.status,
      amount: r.amount_currency === null ? null : { currency_code: r.amount_currency, value: r.amount_value },
      create_time: r.create_time ?? undefined,
      customer_message: r.customer_message ?? undefined,
      order: r.order_json === null ? undefined : JSON.parse(r.order_json as string),
      evidence: r.has_evidence === 1 ? (evidence.get(r.dispute_id as string) ?? {}) : undefined,
    });
    if (!result.ok) throw new Error(`Stored dispute ${String(r.dispute_id)} is not valid: ${result.errors.join(" ")}`);
    return result.dispute;
  });
}

// The demo files are the source of truth: on every start the database is made to match them, in one transaction.
// Records no longer in the files are removed, with their access and sessions.
export function seedDemo(db: DatabaseSync, accounts: Account[], disputes: Dispute[], now: number) {
  transaction(db, () => {
    const keepDisputes = JSON.stringify(disputes.map((d) => d.dispute_id));
    db.prepare("DELETE FROM disputes WHERE dispute_id NOT IN (SELECT value FROM json_each(?))").run(keepDisputes);
    for (const d of disputes) writeDispute(db, d, now);
    const keepAccounts = JSON.stringify(accounts.map((a) => a.id));
    db.prepare("DELETE FROM accounts WHERE id NOT IN (SELECT value FROM json_each(?))").run(keepAccounts);
    for (const a of accounts) writeAccount(db, a, now);
  });
}

export type AuditEvent = (typeof AUDIT_EVENTS)[number];

// Never pass a password, token, cookie or hash here: entries are kept for good and cannot be changed.
export function audit(
  db: DatabaseSync,
  at: number,
  event: AuditEvent,
  { account_id = null, dispute_id = null, detail = null }: { account_id?: string | null; dispute_id?: string | null; detail?: string | null } = {},
) {
  db.prepare("INSERT INTO audit_log (at, event, account_id, dispute_id, detail) VALUES (?, ?, ?, ?, ?)").run(at, event, account_id, dispute_id, detail);
}

// ---- Merchant gap confirmations (migration v4). IDs and a time only. ----

// One dispute's confirmations, from accounts that still have access to it. onlyAccount limits them to one account
// (a merchant sees only their own); null returns every account's (admin).
export function listConfirmations(db: DatabaseSync, disputeId: string, onlyAccount: string | null): GapConfirmation[] {
  const rows = db
    .prepare(
      `SELECT c.item_id, c.account_id, a.display_name, c.confirmed_at FROM gap_confirmations c
       JOIN accounts a ON a.id = c.account_id
       JOIN dispute_access x ON x.account_id = c.account_id AND x.dispute_id = c.dispute_id
       WHERE c.dispute_id = ? AND (? IS NULL OR c.account_id = ?)
       ORDER BY c.confirmed_at, c.item_id, c.account_id`,
    )
    .all(disputeId, onlyAccount, onlyAccount) as Row[];
  return rows.map((r) => ({
    item_id: r.item_id as string,
    account_id: r.account_id as string,
    display_name: r.display_name as string,
    confirmed_at: new Date(r.confirmed_at as number).toISOString(),
  }));
}

// Records the confirmation and its audit entry together. Confirming again changes nothing and is not audited.
// Returns whether anything changed.
export function confirmGap(db: DatabaseSync, at: number, accountId: string, disputeId: string, itemId: string): boolean {
  return transaction(db, () => {
    const { changes } = db
      .prepare("INSERT INTO gap_confirmations (account_id, dispute_id, item_id, confirmed_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING")
      .run(accountId, disputeId, itemId, at);
    if (changes > 0) audit(db, at, "gap_confirmed", { account_id: accountId, dispute_id: disputeId, detail: itemId });
    return changes > 0;
  });
}

// Deletes the account's own confirmation and audits it. Withdrawing one that doesn't exist changes nothing.
export function withdrawGap(db: DatabaseSync, at: number, accountId: string, disputeId: string, itemId: string): boolean {
  return transaction(db, () => {
    const { changes } = db
      .prepare("DELETE FROM gap_confirmations WHERE account_id = ? AND dispute_id = ? AND item_id = ?")
      .run(accountId, disputeId, itemId);
    if (changes > 0) audit(db, at, "gap_confirmation_withdrawn", { account_id: accountId, dispute_id: disputeId, detail: itemId });
    return changes > 0;
  });
}

// ---- Merchant documents (migration v5). The bytes stay in document_blobs and are never listed. ----

const toDocument = (r: Row): DisputeDocument => ({
  id: r.id as string,
  account_id: r.account_id as string,
  display_name: r.display_name as string,
  media_type: r.media_type as DocumentMediaType,
  byte_size: r.byte_size as number,
  page_count: r.page_count as number | null,
  status: r.status as DocumentStatus,
  uploaded_at: new Date(r.uploaded_at as number).toISOString(),
});

// One dispute's documents from accounts that still have access to it. onlyAccount limits them to one account
// (a merchant sees only their own); null returns every account's (admin, read-only).
export function listDocuments(db: DatabaseSync, disputeId: string, onlyAccount: string | null): DisputeDocument[] {
  const rows = db
    .prepare(
      `SELECT d.id, d.account_id, d.display_name, d.media_type, d.byte_size, d.page_count, d.status, d.uploaded_at FROM documents d
       JOIN dispute_access x ON x.account_id = d.account_id AND x.dispute_id = d.dispute_id
       WHERE d.dispute_id = ? AND (? IS NULL OR d.account_id = ?)
       ORDER BY d.uploaded_at, d.id`,
    )
    .all(disputeId, onlyAccount, onlyAccount) as Row[];
  return rows.map(toDocument);
}

export type AddDocumentResult = { ok: true; document: DisputeDocument } | { ok: false; reason: "too_many" | "account_full" | "duplicate" };

// Stores a file and audits it in one transaction. The limits are checked inside it, so two uploads at once can't
// both slip under them. A PDF starts "pending" until its text is read (extract.ts); an image has no text layer and
// DisputeDesk does no OCR, so it starts as "no_text".
export function addDocument(
  db: DatabaseSync,
  at: number,
  doc: { id: string; account_id: string; dispute_id: string; display_name: string; media_type: DocumentMediaType; sha256: string },
  bytes: Uint8Array,
): AddDocumentResult {
  return transaction(db, (): AddDocumentResult => {
    const onDispute = db.prepare("SELECT COUNT(*) AS n FROM documents WHERE account_id = ? AND dispute_id = ?").get(doc.account_id, doc.dispute_id)!.n as number;
    if (onDispute >= DOCUMENT_LIMITS.perDispute) return { ok: false, reason: "too_many" };
    const used = db.prepare("SELECT COALESCE(SUM(byte_size), 0) AS n FROM documents WHERE account_id = ?").get(doc.account_id)!.n as number;
    if (used + bytes.length > DOCUMENT_LIMITS.perAccountBytes) return { ok: false, reason: "account_full" };
    const same = db.prepare("SELECT 1 FROM documents WHERE account_id = ? AND dispute_id = ? AND sha256 = ?").get(doc.account_id, doc.dispute_id, doc.sha256);
    if (same) return { ok: false, reason: "duplicate" };
    db.prepare(
      "INSERT INTO documents (id, account_id, dispute_id, display_name, media_type, byte_size, sha256, page_count, status, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)",
    ).run(doc.id, doc.account_id, doc.dispute_id, doc.display_name, doc.media_type, bytes.length, doc.sha256, doc.media_type === "application/pdf" ? "pending" : "no_text", at);
    db.prepare("INSERT INTO document_blobs (document_id, bytes) VALUES (?, ?)").run(doc.id, bytes);
    // IDs only: never the filename, the text or a hash.
    audit(db, at, "document_uploaded", { account_id: doc.account_id, dispute_id: doc.dispute_id, detail: doc.id });
    const row = db.prepare("SELECT * FROM documents WHERE id = ?").get(doc.id) as Row;
    return { ok: true, document: toDocument(row) };
  });
}

// Deletes the account's own document on that dispute; the bytes, pages and links go with it (foreign keys).
// Returns false, changing nothing, when there is no such document for this account and dispute.
export function deleteDocument(db: DatabaseSync, at: number, accountId: string, disputeId: string, documentId: string): boolean {
  return transaction(db, () => {
    const { changes } = db.prepare("DELETE FROM documents WHERE id = ? AND account_id = ? AND dispute_id = ?").run(documentId, accountId, disputeId);
    if (changes > 0) audit(db, at, "document_deleted", { account_id: accountId, dispute_id: disputeId, detail: documentId });
    return changes > 0;
  });
}

// ---- Extracted text (Stage 3.3). Untrusted, merchant-private, never sent to Gemini, never an evidence status. ----

// PDFs still waiting to be read, oldest first: queued again when the server starts.
export function pendingPdfIds(db: DatabaseSync): string[] {
  const rows = db.prepare("SELECT id FROM documents WHERE status = 'pending' AND media_type = 'application/pdf' ORDER BY uploaded_at, id").all() as Row[];
  return rows.map((r) => r.id as string);
}

// The bytes of a PDF that is still waiting to be read, or null.
export function pendingPdf(db: DatabaseSync, documentId: string): Uint8Array | null {
  const row = db
    .prepare("SELECT b.bytes FROM documents d JOIN document_blobs b ON b.document_id = d.id WHERE d.id = ? AND d.status = 'pending' AND d.media_type = 'application/pdf'")
    .get(documentId) as { bytes: Uint8Array } | undefined;
  return row?.bytes ?? null;
}

// Saves what the extractor found, with its audit entry, in one transaction. Only a document that still exists and
// is still "pending" changes, so a file deleted while it was read stays deleted. Every page gets a row (an empty
// page keeps its number), with a hash of its text. No page with text means "no_text": a scan or an empty file.
// Returns the new status, or null when nothing changed.
export function saveExtraction(db: DatabaseSync, at: number, documentId: string, result: WorkerResult): DocumentStatus | null {
  return transaction(db, (): DocumentStatus | null => {
    const doc = db.prepare("SELECT account_id, dispute_id FROM documents WHERE id = ? AND status = 'pending'").get(documentId) as Row | undefined;
    if (!doc) return null;
    const who = { account_id: doc.account_id as string, dispute_id: doc.dispute_id as string, detail: documentId };
    if (!result.ok) {
      db.prepare("UPDATE documents SET status = 'failed', page_count = NULL WHERE id = ?").run(documentId);
      // The ID and a fixed failure code: never text from the file.
      audit(db, at, "document_extraction_failed", { ...who, detail: `${documentId} ${result.code}` });
      return "failed";
    }
    const insert = db.prepare("INSERT INTO document_pages (document_id, page, text, text_sha256, method) VALUES (?, ?, ?, ?, 'pdf_text')");
    for (const { page, text } of result.pages) insert.run(documentId, page, text, createHash("sha256").update(text).digest("hex"));
    const status: DocumentStatus = result.pages.some((p) => p.text.trim() !== "") ? "extracted" : "no_text";
    db.prepare("UPDATE documents SET status = ?, page_count = ? WHERE id = ?").run(status, result.pages.length, documentId);
    audit(db, at, "document_extracted", who);
    return status;
  });
}

// One document's pages, for its owner (onlyAccount) or for admin (null), only while that account still has access
// to the dispute. Null for another account's document, exactly like a missing one.
export function getDocumentPages(
  db: DatabaseSync,
  disputeId: string,
  documentId: string,
  onlyAccount: string | null,
): { document: DisputeDocument; pages: DocumentPage[] } | null {
  const row = db
    .prepare(
      `SELECT d.* FROM documents d JOIN dispute_access x ON x.account_id = d.account_id AND x.dispute_id = d.dispute_id
       WHERE d.id = ? AND d.dispute_id = ? AND (? IS NULL OR d.account_id = ?)`,
    )
    .get(documentId, disputeId, onlyAccount, onlyAccount) as Row | undefined;
  if (!row) return null;
  const pages = (db.prepare("SELECT page, text, text_sha256 FROM document_pages WHERE document_id = ? ORDER BY page").all(documentId) as Row[]).map(
    (p): DocumentPage => ({ page: p.page as number, text: p.text as string, text_sha256: p.text_sha256 as string }),
  );
  return { document: toDocument(row), pages };
}

export type AuditEntry ={ id: number; at: number; event: AuditEvent; account_id: string | null; dispute_id: string | null; detail: string | null };

// Newest first. Entries never hold secrets (see `audit`), so admin may read them as they are.
export function listAudit(db: DatabaseSync, limit = 200): AuditEntry[] {
  return db.prepare("SELECT id, at, event, account_id, dispute_id, detail FROM audit_log ORDER BY at DESC, id DESC LIMIT ?").all(limit) as AuditEntry[];
}
