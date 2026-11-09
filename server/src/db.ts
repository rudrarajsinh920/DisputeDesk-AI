import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

// SQLite through Node's built-in node:sqlite: no extra dependency. Every query in the server uses
// prepared statements with ? placeholders; values are never put into SQL text.

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

const EVIDENCE_KEYS = "'order_confirmation', 'shipping_tracking', 'proof_of_delivery', 'customer_communication'";
// Version 1's list, frozen with that migration. New events are added in a later migration.
const V1_AUDIT_EVENTS = [
  "login_succeeded",
  "login_failed",
  "login_locked",
  "logout",
  "dispute_access_denied",
  "analysis_viewed",
  "ai_draft_generated",
  "ai_example_viewed",
] as const;
// Version 2's list, frozen with that migration.
const V2_AUDIT_EVENTS = [...V1_AUDIT_EVENTS, "buyer_explanation_generated"] as const;
// Version 3's list, frozen with that migration. A new event needs a new migration and a new list.
const V3_AUDIT_EVENTS = [...V2_AUDIT_EVENTS, "intelligence_viewed", "intelligence_explanation_generated"] as const;
// Version 4's list, frozen with that migration.
const V4_AUDIT_EVENTS = [...V3_AUDIT_EVENTS, "gap_confirmed", "gap_confirmation_withdrawn"] as const;
export const AUDIT_EVENTS = V4_AUDIT_EVENTS;

// SQLite can't change a CHECK constraint, so a longer event list means copying the audit log into a new table.
// Rows keep their ids; the indexes and append-only triggers are recreated on the new table.
const rebuildAuditLog = (events: readonly string[]) => `
      CREATE TABLE audit_log_next (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at INTEGER NOT NULL,
        event TEXT NOT NULL CHECK (event IN (${events.map((e) => `'${e}'`).join(", ")})),
        account_id TEXT,
        dispute_id TEXT,
        detail TEXT CHECK (detail IS NULL OR length(detail) <= 200)
      ) STRICT;
      INSERT INTO audit_log_next (id, at, event, account_id, dispute_id, detail) SELECT id, at, event, account_id, dispute_id, detail FROM audit_log;
      DROP TRIGGER audit_log_no_update;
      DROP TRIGGER audit_log_no_delete;
      DROP TABLE audit_log;
      ALTER TABLE audit_log_next RENAME TO audit_log;
      CREATE INDEX idx_audit_account_at ON audit_log (account_id, at);
      CREATE INDEX idx_audit_event_at ON audit_log (event, at);
      CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
      CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
    `;

// Forward-only and never edited once released: a change to the schema is a new migration at the end.
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "accounts, demo disputes, evidence, access, sessions and audit log",
    sql: `
      CREATE TABLE accounts (
        id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 40 AND id NOT GLOB '*[^a-z0-9-]*'),
        email TEXT NOT NULL UNIQUE CHECK (length(email) <= 254 AND email = lower(email) AND instr(email, '@') > 1),
        role TEXT NOT NULL CHECK (role IN ('merchant', 'buyer', 'admin')),
        display_name TEXT NOT NULL CHECK (trim(display_name) <> ''),
        paypal_sandbox INTEGER NOT NULL DEFAULT 0 CHECK (paypal_sandbox IN (0, 1) AND (paypal_sandbox = 0 OR role = 'merchant')),
        password_hash TEXT NOT NULL CHECK (password_hash GLOB 'scrypt$*'),
        created_at INTEGER NOT NULL
      ) STRICT;

      -- Synthetic demo records only. PayPal sandbox disputes are read live and never stored.
      CREATE TABLE disputes (
        dispute_id TEXT PRIMARY KEY CHECK (length(dispute_id) BETWEEN 1 AND 100),
        source TEXT NOT NULL CHECK (source = 'demo'),
        reason TEXT NOT NULL,
        status TEXT NOT NULL,
        amount_currency TEXT,
        amount_value TEXT,
        customer_message TEXT,
        order_json TEXT CHECK (order_json IS NULL OR json_valid(order_json)),
        -- 1 when the record had an evidence object, even an empty one.
        has_evidence INTEGER NOT NULL CHECK (has_evidence IN (0, 1)),
        updated_at INTEGER NOT NULL,
        CHECK ((amount_currency IS NULL) = (amount_value IS NULL))
      ) STRICT;

      -- One row per supplied evidence flag. No row means "not supplied", never "false".
      CREATE TABLE dispute_evidence (
        dispute_id TEXT NOT NULL REFERENCES disputes (dispute_id) ON DELETE CASCADE,
        evidence_key TEXT NOT NULL CHECK (evidence_key IN (${EVIDENCE_KEYS})),
        available INTEGER NOT NULL CHECK (available IN (0, 1)),
        PRIMARY KEY (dispute_id, evidence_key)
      ) STRICT, WITHOUT ROWID;

      CREATE TABLE dispute_access (
        account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
        dispute_id TEXT NOT NULL REFERENCES disputes (dispute_id) ON DELETE CASCADE,
        PRIMARY KEY (account_id, dispute_id)
      ) STRICT, WITHOUT ROWID;
      CREATE INDEX idx_dispute_access_dispute ON dispute_access (dispute_id);

      -- Keyed by the SHA-256 of the token (43 base64url characters); the token itself is never stored.
      CREATE TABLE sessions (
        token_hash TEXT PRIMARY KEY CHECK (length(token_hash) = 43),
        account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        revoked_at INTEGER,
        CHECK (last_seen_at >= created_at)
      ) STRICT;
      CREATE INDEX idx_sessions_account ON sessions (account_id);
      CREATE INDEX idx_sessions_created ON sessions (created_at);

      -- No foreign keys: entries must outlive the accounts and disputes they mention.
      CREATE TABLE audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at INTEGER NOT NULL,
        event TEXT NOT NULL CHECK (event IN (${V1_AUDIT_EVENTS.map((e) => `'${e}'`).join(", ")})),
        account_id TEXT,
        dispute_id TEXT,
        detail TEXT CHECK (detail IS NULL OR length(detail) <= 200)
      ) STRICT;
      CREATE INDEX idx_audit_account_at ON audit_log (account_id, at);
      CREATE INDEX idx_audit_event_at ON audit_log (event, at);
      CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
      CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
    `,
  },
  {
    version: 2,
    name: "dispute opened date; buyer explanation audit event",
    // SQLite can't change a CHECK constraint, so the audit log is copied into a new table with the longer event
    // list. Rows keep their ids; the indexes and append-only triggers are recreated on the new table.
    sql: `
      ALTER TABLE disputes ADD COLUMN create_time TEXT CHECK (create_time IS NULL OR length(create_time) BETWEEN 1 AND 40);

      CREATE TABLE audit_log_v2 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        at INTEGER NOT NULL,
        event TEXT NOT NULL CHECK (event IN (${V2_AUDIT_EVENTS.map((e) => `'${e}'`).join(", ")})),
        account_id TEXT,
        dispute_id TEXT,
        detail TEXT CHECK (detail IS NULL OR length(detail) <= 200)
      ) STRICT;
      INSERT INTO audit_log_v2 (id, at, event, account_id, dispute_id, detail) SELECT id, at, event, account_id, dispute_id, detail FROM audit_log;
      DROP TRIGGER audit_log_no_update;
      DROP TRIGGER audit_log_no_delete;
      DROP TABLE audit_log;
      ALTER TABLE audit_log_v2 RENAME TO audit_log;
      CREATE INDEX idx_audit_account_at ON audit_log (account_id, at);
      CREATE INDEX idx_audit_event_at ON audit_log (event, at);
      CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
      CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit_log is append-only'); END;
    `,
  },
  {
    version: 3,
    name: "insights audit events",
    sql: rebuildAuditLog(V3_AUDIT_EVENTS),
  },
  {
    version: 4,
    name: "merchant gap confirmations; their audit events",
    // A merchant's statement that they hold a record for a checklist gap. IDs and a time only: no note, file or value.
    // Demo disputes only, through the disputes foreign key (sandbox disputes are never stored). Removing a dispute or
    // an account from the demo files removes its confirmations; restarts keep them (seedDemo upserts disputes).
    sql: `
      CREATE TABLE gap_confirmations (
        account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
        dispute_id TEXT NOT NULL REFERENCES disputes (dispute_id) ON DELETE CASCADE,
        item_id TEXT NOT NULL CHECK (length(item_id) BETWEEN 1 AND 40 AND item_id NOT GLOB '*[^a-z_]*'),
        confirmed_at INTEGER NOT NULL,
        PRIMARY KEY (account_id, dispute_id, item_id)
      ) STRICT, WITHOUT ROWID;
      CREATE INDEX idx_gap_confirmations_dispute ON gap_confirmations (dispute_id);
      ${rebuildAuditLog(V4_AUDIT_EVENTS)}
    `,
  },
];

// Runs fn inside one write transaction: every write commits, or none does. fn must be synchronous.
export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export const schemaVersion = (db: DatabaseSync) =>
  Number(db.prepare("SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations").get()!.v);

// Applies each missing migration in its own transaction. Throws, so the server does not start, on a failed
// migration or a database written by a newer server.
export function migrate(db: DatabaseSync, migrations: Migration[] = MIGRATIONS) {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL) STRICT");
  const current = schemaVersion(db);
  const latest = migrations.at(-1)?.version ?? 0;
  if (current > latest) throw new Error(`The database schema (version ${current}) is newer than this server (version ${latest}).`);
  for (const m of migrations) {
    if (m.version <= current) continue;
    transaction(db, () => {
      db.exec(m.sql);
      db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(m.version, m.name, Date.now());
    });
  }
}

// ":memory:" for tests; a file path for the server (its folder is created if needed).
export function openDatabase(path: string): DatabaseSync {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  if (path !== ":memory:") db.exec("PRAGMA journal_mode = WAL;");
  migrate(db);
  return db;
}
