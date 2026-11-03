import type { DatabaseSync } from "node:sqlite";
import type { Dispute } from "../../shared/types.ts";
import type { Account } from "./auth.ts";
import { transaction } from "./db.ts";
import type { AUDIT_EVENTS } from "./db.ts";
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
    `INSERT INTO disputes (dispute_id, source, reason, status, amount_currency, amount_value, customer_message, order_json, has_evidence, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (dispute_id) DO UPDATE SET source = excluded.source, reason = excluded.reason, status = excluded.status,
       amount_currency = excluded.amount_currency, amount_value = excluded.amount_value, customer_message = excluded.customer_message,
       order_json = excluded.order_json, has_evidence = excluded.has_evidence, updated_at = excluded.updated_at`,
  ).run(
    d.dispute_id,
    d.source,
    d.reason,
    d.status,
    d.amount?.currency_code ?? null,
    d.amount?.value ?? null,
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
