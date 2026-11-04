import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { MIGRATIONS, migrate, openDatabase, schemaVersion, transaction } from "./db.ts";

const HASH = "scrypt$16384$8$1$c2FsdHNhbHRzYWx0c2FsdA==$a2V5a2V5a2V5a2V5a2V5a2V5a2V5a2V5a2V5a2V5a2U=";
const account = (db: DatabaseSync, id: string, fields: Record<string, unknown> = {}) => {
  const a = { id, email: `${id}@demo.disputedesk.test`, role: "merchant", display_name: "Demo", paypal_sandbox: 0, password_hash: HASH, ...fields };
  db.prepare("INSERT INTO accounts (id, email, role, display_name, paypal_sandbox, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, 0)").run(
    a.id as string,
    a.email as string,
    a.role as string,
    a.display_name as string,
    a.paypal_sandbox as number,
    a.password_hash as string,
  );
};
const dispute = (db: DatabaseSync, id: string) =>
  db.prepare("INSERT INTO disputes (dispute_id, source, reason, status, has_evidence, updated_at) VALUES (?, 'demo', 'R', 'S', 0, 0)").run(id);

test("a new database gets every migration in order, once", () => {
  const db = openDatabase(":memory:");
  assert.equal(schemaVersion(db), MIGRATIONS.at(-1)!.version);
  MIGRATIONS.forEach((m, i) => assert.equal(m.version, i + 1, "versions are 1, 2, 3… with no gaps"));
  const applied = db.prepare("SELECT version FROM schema_migrations ORDER BY version").all().map((r) => r.version);
  assert.deepEqual(applied, MIGRATIONS.map((m) => m.version));
  migrate(db);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get()!.n, MIGRATIONS.length, "running again changes nothing");
  assert.equal(db.prepare("PRAGMA foreign_keys").get()!.foreign_keys, 1);
});

test("a database file keeps its data after it is closed and opened again", () => {
  const dir = mkdtempSync(join(tmpdir(), "dd-db-"));
  try {
    const path = join(dir, "test.sqlite");
    const first = openDatabase(path);
    account(first, "merchant-x");
    first.close();
    const second = openDatabase(path);
    assert.equal(second.prepare("SELECT email FROM accounts WHERE id = ?").get("merchant-x")!.email, "merchant-x@demo.disputedesk.test");
    assert.equal(schemaVersion(second), MIGRATIONS.at(-1)!.version);
    second.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a database from a newer server version is refused", () => {
  const db = openDatabase(":memory:");
  db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, 'future', 0)").run(MIGRATIONS.length + 1);
  assert.throws(() => migrate(db), /newer than this server/);
});

test("a failing migration is rolled back completely and stops startup", () => {
  const db = new DatabaseSync(":memory:");
  const broken = [...MIGRATIONS, { version: MIGRATIONS.length + 1, name: "broken", sql: "CREATE TABLE half_done (x); SELECT * FROM no_such_table;" }];
  assert.throws(() => migrate(db, broken), /no_such_table/);
  assert.equal(schemaVersion(db), MIGRATIONS.length, "earlier migrations stay applied");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'half_done'").get()!.n, 0, "nothing half-applied");
});

test("a transaction commits all of its writes or none", () => {
  const db = openDatabase(":memory:");
  assert.throws(() =>
    transaction(db, () => {
      account(db, "merchant-x");
      throw new Error("stop");
    }),
  );
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM accounts").get()!.n, 0, "rolled back");
  assert.throws(() =>
    transaction(db, () => {
      account(db, "merchant-x");
      account(db, "merchant-y", { email: "merchant-x@demo.disputedesk.test" });
    }),
    /UNIQUE/,
  );
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM accounts").get()!.n, 0, "a constraint failure rolls back the earlier insert");
  assert.equal(transaction(db, () => (account(db, "merchant-x"), "done")), "done");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM accounts").get()!.n, 1);
});

test("account constraints reject invalid rows", () => {
  const db = openDatabase(":memory:");
  account(db, "merchant-a", { paypal_sandbox: 1 });
  const bad: [string, Record<string, unknown>][] = [
    ["owner", { role: "owner" }],
    ["upper-email", { email: "Upper@demo.disputedesk.test" }],
    ["no-at", { email: "no-at.example" }],
    ["dup-email", { email: "merchant-a@demo.disputedesk.test" }],
    ["buyer-sandbox", { role: "buyer", paypal_sandbox: 1 }],
    ["plain-password", { password_hash: "hunter2" }],
    ["blank-name", { display_name: "  " }],
    ["Bad_Id", { email: "bad-id@demo.disputedesk.test" }],
  ];
  for (const [id, fields] of bad) assert.throws(() => account(db, id, fields), /constraint failed/, id);
  assert.throws(() => account(db, "merchant-a"), /UNIQUE/, "duplicate id");
});

test("dispute, evidence, access and session rows must point at real records", () => {
  const db = openDatabase(":memory:");
  account(db, "merchant-a");
  dispute(db, "DEMO-1");
  const fk = /FOREIGN KEY/;
  assert.throws(() => db.prepare("INSERT INTO dispute_access (account_id, dispute_id) VALUES ('merchant-a', 'DEMO-404')").run(), fk);
  assert.throws(() => db.prepare("INSERT INTO dispute_access (account_id, dispute_id) VALUES ('nobody', 'DEMO-1')").run(), fk);
  assert.throws(() => db.prepare("INSERT INTO dispute_evidence (dispute_id, evidence_key, available) VALUES ('DEMO-404', 'proof_of_delivery', 1)").run(), fk);
  assert.throws(() => db.prepare("INSERT INTO sessions (token_hash, account_id, created_at, last_seen_at) VALUES (?, 'nobody', 0, 0)").run("h".repeat(43)), fk);
  assert.throws(() => db.prepare("INSERT INTO dispute_evidence (dispute_id, evidence_key, available) VALUES ('DEMO-1', 'gut_feeling', 1)").run(), /constraint/);
  assert.throws(() => db.prepare("INSERT INTO dispute_evidence (dispute_id, evidence_key, available) VALUES ('DEMO-1', 'proof_of_delivery', 2)").run(), /constraint/);
  assert.throws(() => db.prepare("INSERT INTO disputes (dispute_id, source, reason, status, has_evidence, updated_at) VALUES ('PP-1', 'paypal_sandbox', 'R', 'S', 0, 0)").run(), /constraint/, "only demo records are stored");
  assert.throws(() => db.prepare("INSERT INTO disputes (dispute_id, source, reason, status, has_evidence, order_json, updated_at) VALUES ('DEMO-2', 'demo', 'R', 'S', 0, '{broken', 0)").run(), /constraint/);
  assert.throws(() => db.prepare("INSERT INTO sessions (token_hash, account_id, created_at, last_seen_at) VALUES ('short', 'merchant-a', 0, 0)").run(), /constraint/, "only token hashes fit");

  // Deleting an account or dispute removes what depended on it.
  db.prepare("INSERT INTO dispute_access (account_id, dispute_id) VALUES ('merchant-a', 'DEMO-1')").run();
  db.prepare("INSERT INTO sessions (token_hash, account_id, created_at, last_seen_at) VALUES (?, 'merchant-a', 0, 0)").run("h".repeat(43));
  db.prepare("DELETE FROM accounts WHERE id = 'merchant-a'").run();
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM dispute_access").get()!.n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sessions").get()!.n, 0);
});

test("the audit log can be added to but never changed or emptied", () => {
  const db = openDatabase(":memory:");
  db.prepare("INSERT INTO audit_log (at, event) VALUES (1, 'login_succeeded')").run();
  assert.throws(() => db.prepare("UPDATE audit_log SET event = 'logout'").run(), /append-only/);
  assert.throws(() => db.prepare("DELETE FROM audit_log").run(), /append-only/);
  assert.throws(() => db.prepare("INSERT INTO audit_log (at, event) VALUES (1, 'made_up')").run(), /constraint/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM audit_log").get()!.n, 1);
});

test("a released migration's SQL never changes", () => {
  const v1 = createHash("sha256").update(MIGRATIONS[0].sql).digest("hex");
  assert.equal(v1, "eb652aac866aa9c6745af4b36c048c5fdd1d0dfd51f1e7aa61e19b4f5d3a7fea", "add a new migration instead of editing version 1");
  const v2 = createHash("sha256").update(MIGRATIONS[1].sql).digest("hex");
  assert.equal(v2, "0855325b25f2d23729b386a21d9205a1ab8454acaa187690d352fb929524933b", "add a new migration instead of editing version 2");
});

test("upgrading a version 2 database adds the insights audit events and keeps every entry", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db, MIGRATIONS.slice(0, 2));
  db.prepare("INSERT INTO audit_log (at, event, account_id, dispute_id, detail) VALUES (1, 'buyer_explanation_generated', 'buyer-b', 'DEMO-1002', 'rules')").run();
  const before = db.prepare("SELECT * FROM audit_log ORDER BY id").all().map((r) => ({ ...r }));
  assert.throws(() => db.prepare("INSERT INTO audit_log (at, event) VALUES (2, 'intelligence_viewed')").run(), /constraint/);

  migrate(db);
  assert.equal(schemaVersion(db), 3);
  assert.deepEqual(db.prepare("SELECT * FROM audit_log ORDER BY id").all().map((r) => ({ ...r })), before, "entries copied unchanged");
  for (const event of ["intelligence_viewed", "intelligence_explanation_generated"]) db.prepare("INSERT INTO audit_log (at, event) VALUES (2, ?)").run(event);
  assert.equal(db.prepare("SELECT MAX(id) AS id FROM audit_log").get()!.id, 3, "ids keep counting after the copied rows");
  assert.throws(() => db.prepare("UPDATE audit_log SET event = 'logout'").run(), /append-only/);
  assert.throws(() => db.prepare("DELETE FROM audit_log").run(), /append-only/);
  assert.throws(() => db.prepare("INSERT INTO audit_log (at, event) VALUES (4, 'made_up')").run(), /constraint/);
  const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'audit_log' AND name LIKE 'idx_%'").all().map((r) => r.name);
  assert.deepEqual(indexes.sort(), ["idx_audit_account_at", "idx_audit_event_at"]);
});

test("upgrading a version 1 database keeps every audit entry and the append-only rule", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db, MIGRATIONS.slice(0, 1));
  db.prepare("INSERT INTO audit_log (at, event, account_id, dispute_id, detail) VALUES (1, 'login_succeeded', 'buyer-b', NULL, NULL)").run();
  db.prepare("INSERT INTO audit_log (at, event, account_id, dispute_id, detail) VALUES (2, 'analysis_viewed', 'merchant-a', 'DEMO-1001', 'demo')").run();
  dispute(db, "DEMO-1");
  const before = db.prepare("SELECT * FROM audit_log ORDER BY id").all().map((r) => ({ ...r }));
  assert.throws(() => db.prepare("INSERT INTO audit_log (at, event) VALUES (3, 'buyer_explanation_generated')").run(), /constraint/);

  migrate(db);
  assert.equal(schemaVersion(db), MIGRATIONS.at(-1)!.version);
  assert.deepEqual(db.prepare("SELECT * FROM audit_log ORDER BY id").all().map((r) => ({ ...r })), before, "entries copied unchanged");
  const added = db.prepare("INSERT INTO audit_log (at, event) VALUES (3, 'buyer_explanation_generated')").run();
  assert.equal(Number(added.lastInsertRowid), 3, "ids keep counting after the copied rows");
  assert.throws(() => db.prepare("UPDATE audit_log SET event = 'logout'").run(), /append-only/);
  assert.throws(() => db.prepare("DELETE FROM audit_log").run(), /append-only/);
  assert.throws(() => db.prepare("INSERT INTO audit_log (at, event) VALUES (4, 'made_up')").run(), /constraint/);

  // The opened date has its own column; an existing dispute simply has none.
  assert.equal(db.prepare("SELECT create_time FROM disputes WHERE dispute_id = 'DEMO-1'").get()!.create_time, null);
  db.prepare("UPDATE disputes SET create_time = '2026-10-18T09:30:00Z' WHERE dispute_id = 'DEMO-1'").run();
  assert.throws(() => db.prepare("UPDATE disputes SET create_time = ? WHERE dispute_id = 'DEMO-1'").run("x".repeat(41)), /constraint/);
});

test("the indexes the server's lookups use exist", () => {
  const db = openDatabase(":memory:");
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%'").all().map((r) => r.name);
  for (const name of ["idx_dispute_access_dispute", "idx_sessions_account", "idx_sessions_created", "idx_audit_account_at", "idx_audit_event_at"]) {
    assert.ok(names.includes(name), name);
  }
});
