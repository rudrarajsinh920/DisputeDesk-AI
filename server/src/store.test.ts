import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DEMO_ACCOUNTS, DEMO_DISPUTES } from "./app.ts";
import { DatabaseSync } from "node:sqlite";
import { MIGRATIONS, migrate, openDatabase, schemaVersion } from "./db.ts";
import { addDocument, audit, confirmGap, createAccount, findAccountByEmail, getAccount, listAccounts, listConfirmations, loadDisputes, seedDemo, withdrawGap } from "./store.ts";
import type { Account } from "./auth.ts";

const HASH = "scrypt$16384$8$1$c2FsdHNhbHRzYWx0c2FsdA==$a2V5a2V5a2V5a2V5a2V5a2V5a2V5a2V5a2V5a2V5a2U=";
const OTHER_HASH = "scrypt$16384$8$1$b3RoZXJvdGhlcm90aGVy$a2V5a2V5a2V5a2V5a2V5a2V5a2V5a2V5a2V5a2V5a2U=";
// What the API sends: fields that are undefined are left out.
const asJson = (value: unknown) => JSON.parse(JSON.stringify(value));
const seeded = () => {
  const db = openDatabase(":memory:");
  seedDemo(db, DEMO_ACCOUNTS, DEMO_DISPUTES, 1);
  return db;
};

test("demo disputes and their evidence read back exactly as the fixture files", () => {
  const db = seeded();
  assert.deepEqual(asJson(loadDisputes(db)), asJson(DEMO_DISPUTES));
  for (const d of loadDisputes(db)) assert.equal(d.source, "demo", "every stored record stays labelled demo");
  // DEMO-1001 has no opened date in its file; it stays absent, never filled in.
  assert.deepEqual(loadDisputes(db).slice(0, 3).map((d) => d.create_time), [undefined, "2026-10-18T09:30:00Z", "2026-10-22T14:05:00Z"]);
  // DEMO-2014 also has none.
  assert.equal(loadDisputes(db).find((d) => d.dispute_id === "DEMO-2014")!.create_time, undefined);
});

test("missing evidence stays missing; it is never stored as false", () => {
  const db = openDatabase(":memory:");
  const partial = { ...DEMO_DISPUTES[0], dispute_id: "DEMO-9001", evidence: { order_confirmation: true, proof_of_delivery: false } };
  const none = { ...DEMO_DISPUTES[0], dispute_id: "DEMO-9002", evidence: undefined, order: undefined, amount: null };
  seedDemo(db, [], [partial, none], 1);
  const [a, b] = loadDisputes(db);
  assert.deepEqual(asJson(a.evidence), { order_confirmation: true, proof_of_delivery: false });
  assert.equal(a.evidence!.shipping_tracking, undefined);
  assert.equal(b.evidence, undefined);
  assert.equal(b.order, undefined);
  assert.equal(b.amount, null);
  assert.deepEqual(
    db.prepare("SELECT evidence_key, available FROM dispute_evidence ORDER BY evidence_key").all().map((r) => ({ ...r })),
    [
      { evidence_key: "order_confirmation", available: 1 },
      { evidence_key: "proof_of_delivery", available: 0 },
    ],
  );
});

test("demo accounts are stored with their access, and found by id or email", () => {
  const db = seeded();
  assert.deepEqual(listAccounts(db), DEMO_ACCOUNTS);
  assert.deepEqual(getAccount(db, "buyer-b"), DEMO_ACCOUNTS.find((a) => a.id === "buyer-b"));
  assert.deepEqual(findAccountByEmail(db, "merchant-a@demo.disputedesk.test")?.dispute_ids, ["DEMO-1001", "DEMO-1002"]);
  assert.equal(getAccount(db, "nobody"), null);
  assert.equal(findAccountByEmail(db, "nobody@demo.disputedesk.test"), null);
});

test("a created account and its access survive closing and reopening the database", () => {
  const dir = mkdtempSync(join(tmpdir(), "dd-store-"));
  try {
    const path = join(dir, "test.sqlite");
    const first = openDatabase(path);
    seedDemo(first, [], DEMO_DISPUTES, 1);
    const account: Account = {
      id: "merchant-x",
      email: "merchant-x@demo.disputedesk.test",
      role: "merchant",
      display_name: "Demo Merchant C",
      paypal_sandbox: false,
      dispute_ids: ["DEMO-1003"],
      password_hash: HASH,
    };
    createAccount(first, account, 1);
    first.close();
    const second = openDatabase(path);
    assert.deepEqual(getAccount(second, "merchant-x"), account);
    second.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("creating an account is all or nothing", () => {
  const db = seeded();
  const bad: Account = { ...DEMO_ACCOUNTS[1], id: "merchant-x", email: "merchant-x@demo.disputedesk.test", dispute_ids: ["DEMO-1001", "DEMO-404"] };
  assert.throws(() => createAccount(db, bad, 1), /FOREIGN KEY/);
  assert.equal(getAccount(db, "merchant-x"), null, "the account row was rolled back with its access");
  assert.throws(() => createAccount(db, { ...bad, email: DEMO_ACCOUNTS[0].email, dispute_ids: [] }, 1), /UNIQUE/);
});

test("seeding again mirrors the demo files: changes apply, removed records go, sessions of a changed password end", () => {
  const db = seeded();
  const at = (sql: string, ...args: string[]) => db.prepare(sql).get(...args);
  db.prepare("INSERT INTO sessions (token_hash, account_id, created_at, last_seen_at) VALUES (?, 'merchant-a', 1, 1)").run("a".repeat(43));
  db.prepare("INSERT INTO sessions (token_hash, account_id, created_at, last_seen_at) VALUES (?, 'merchant-b', 1, 1)").run("b".repeat(43));
  seedDemo(db, DEMO_ACCOUNTS, DEMO_DISPUTES, 2);
  assert.equal(at("SELECT COUNT(*) AS n FROM sessions")!.n, 2, "an unchanged seed keeps sessions");

  const accounts = DEMO_ACCOUNTS.filter((a) => a.id !== "buyer-a")
    .map((a) => ({ ...a, dispute_ids: a.dispute_ids.filter((id) => id === "DEMO-1001" || id === "DEMO-1002") }))
    .map((a) => (a.id === "merchant-a" ? { ...a, password_hash: OTHER_HASH, dispute_ids: ["DEMO-1001"] } : a));
  seedDemo(db, accounts, DEMO_DISPUTES.slice(0, 2), 3);
  assert.equal(getAccount(db, "buyer-a"), null);
  assert.deepEqual(getAccount(db, "merchant-a")!.dispute_ids, ["DEMO-1001"]);
  assert.deepEqual(getAccount(db, "buyer-b")!.dispute_ids, ["DEMO-1002"]);
  assert.equal(at("SELECT COUNT(*) AS n FROM dispute_access WHERE dispute_id = ?", "DEMO-1003")!.n, 0);
  assert.deepEqual(loadDisputes(db).map((d) => d.dispute_id), ["DEMO-1001", "DEMO-1002"]);
  assert.equal(at("SELECT COUNT(*) AS n FROM sessions WHERE account_id = ?", "merchant-a")!.n, 0, "new password ends old sessions");
  assert.equal(at("SELECT COUNT(*) AS n FROM sessions WHERE account_id = ?", "merchant-b")!.n, 1);
});

test("a failed seed changes nothing", () => {
  const db = seeded();
  const broken = [...DEMO_ACCOUNTS, { ...DEMO_ACCOUNTS[1], id: "merchant-z", email: "merchant-z@demo.disputedesk.test", role: "owner" }] as Account[];
  assert.throws(() => seedDemo(db, broken, DEMO_DISPUTES, 2), /constraint/);
  assert.deepEqual(listAccounts(db), DEMO_ACCOUNTS);
});

test("audit entries record who did what, with no free text beyond a short detail", () => {
  const db = seeded();
  audit(db, 5, "analysis_viewed", { account_id: "merchant-a", dispute_id: "DEMO-1001" });
  audit(db, 6, "login_failed");
  const rows = db.prepare("SELECT at, event, account_id, dispute_id, detail FROM audit_log ORDER BY id").all().map((r) => ({ ...r }));
  assert.deepEqual(rows, [
    { at: 5, event: "analysis_viewed", account_id: "merchant-a", dispute_id: "DEMO-1001", detail: null },
    { at: 6, event: "login_failed", account_id: null, dispute_id: null, detail: null },
  ]);
});

// ---- Stage 2.2b: merchant gap confirmations (migration v4). ----

const events = (db: ReturnType<typeof seeded>) =>
  (db.prepare("SELECT event, account_id, dispute_id, detail FROM audit_log ORDER BY id").all() as Record<string, unknown>[]).map((r) => ({ ...r }));

test("a confirmation is recorded once with its audit entry, and withdrawing removes it", () => {
  const db = seeded();
  assert.equal(confirmGap(db, 10, "merchant-a", "DEMO-1001", "shipping_tracking"), true);
  assert.equal(confirmGap(db, 20, "merchant-a", "DEMO-1001", "shipping_tracking"), false, "confirming again changes nothing");
  assert.deepEqual(listConfirmations(db, "DEMO-1001", "merchant-a"), [
    { item_id: "shipping_tracking", account_id: "merchant-a", display_name: "Demo Merchant A", confirmed_at: new Date(10).toISOString() },
  ]);
  assert.equal(withdrawGap(db, 30, "merchant-a", "DEMO-1001", "shipping_tracking"), true);
  assert.equal(withdrawGap(db, 40, "merchant-a", "DEMO-1001", "shipping_tracking"), false, "nothing left to withdraw");
  assert.deepEqual(listConfirmations(db, "DEMO-1001", null), []);
  assert.deepEqual(events(db), [
    { event: "gap_confirmed", account_id: "merchant-a", dispute_id: "DEMO-1001", detail: "shipping_tracking" },
    { event: "gap_confirmation_withdrawn", account_id: "merchant-a", dispute_id: "DEMO-1001", detail: "shipping_tracking" },
  ]);
});

test("the table holds only IDs and a time, for stored demo disputes, with a plain item ID", () => {
  const db = seeded();
  const columns = (db.prepare("PRAGMA table_info(gap_confirmations)").all() as { name: string }[]).map((c) => c.name);
  assert.deepEqual(columns, ["account_id", "dispute_id", "item_id", "confirmed_at"]);
  const insert = (dispute: string, item: string) =>
    db.prepare("INSERT INTO gap_confirmations (account_id, dispute_id, item_id, confirmed_at) VALUES ('merchant-a', ?, ?, 1)").run(dispute, item);
  assert.throws(() => insert("PP-D-1", "shipping_tracking"), /FOREIGN KEY/, "sandbox disputes are never stored, so they can't be confirmed");
  for (const bad of ["", "Shipping", "drop table; --", "x".repeat(41)]) assert.throws(() => insert("DEMO-1001", bad), /constraint/, bad);
});

test("confirmations survive a restart and go with their dispute or account; only accounts with access are listed", () => {
  const db = seeded();
  confirmGap(db, 10, "merchant-a", "DEMO-1001", "shipping_tracking");
  confirmGap(db, 10, "merchant-d", "DEMO-3001", "customer_communication");
  seedDemo(db, DEMO_ACCOUNTS, DEMO_DISPUTES, 2);
  assert.equal(listConfirmations(db, "DEMO-1001", null).length, 1, "kept across a restart");
  assert.deepEqual(listConfirmations(db, "DEMO-1001", "merchant-b"), [], "one account never sees another's");

  // Merchant A loses access to DEMO-1001: the row stays, but is not listed.
  const lessAccess = DEMO_ACCOUNTS.map((a) => (a.id === "merchant-a" ? { ...a, dispute_ids: ["DEMO-1002"] } : a));
  seedDemo(db, lessAccess, DEMO_DISPUTES, 3);
  assert.deepEqual(listConfirmations(db, "DEMO-1001", null), []);

  // DEMO-3001 leaves the demo files: its confirmation goes with it.
  const without = DEMO_DISPUTES.filter((d) => d.dispute_id !== "DEMO-3001");
  const accounts = DEMO_ACCOUNTS.map((a) => ({ ...a, dispute_ids: a.dispute_ids.filter((id) => id !== "DEMO-3001") }));
  seedDemo(db, accounts, without, 4);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM gap_confirmations WHERE dispute_id = 'DEMO-3001'").get()!.n, 0);
});

test("upgrading a version 3 database adds the confirmation table and events and keeps every audit entry", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db, MIGRATIONS.slice(0, 3));
  db.prepare("INSERT INTO audit_log (at, event, account_id, dispute_id, detail) VALUES (1, 'intelligence_viewed', 'merchant-c', NULL, 'account, 14 demo disputes')").run();
  const before = db.prepare("SELECT * FROM audit_log ORDER BY id").all().map((r) => ({ ...r }));
  assert.throws(() => db.prepare("INSERT INTO audit_log (at, event) VALUES (2, 'gap_confirmed')").run(), /constraint/);
  // Up to version 4 only: this test is about that migration. Version 5 has its own test.
  migrate(db, MIGRATIONS.slice(0, 4));
  assert.equal(schemaVersion(db), 4);
  assert.deepEqual(db.prepare("SELECT * FROM audit_log ORDER BY id").all().map((r) => ({ ...r })), before, "entries copied unchanged");
  for (const event of ["gap_confirmed", "gap_confirmation_withdrawn"]) db.prepare("INSERT INTO audit_log (at, event) VALUES (2, ?)").run(event);
  assert.throws(() => db.prepare("DELETE FROM audit_log").run(), /append-only/);
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name = 'gap_confirmations'").get());
});

const DOCUMENT_EVENTS = [
  "document_uploaded",
  "document_extracted",
  "document_extraction_failed",
  "document_deleted",
  "document_linked",
  "document_unlinked",
  "document_downloaded",
];

test("upgrading a version 4 database adds the document tables and events, keeps every audit entry and confirmation", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db, MIGRATIONS.slice(0, 4));
  seedDemo(db, DEMO_ACCOUNTS, DEMO_DISPUTES, 1);
  confirmGap(db, 2, "merchant-a", "DEMO-1001", "shipping_tracking");
  db.prepare("INSERT INTO audit_log (at, event, account_id, dispute_id, detail) VALUES (3, 'login_succeeded', 'merchant-a', NULL, NULL)").run();
  const before = db.prepare("SELECT * FROM audit_log ORDER BY id").all().map((r) => ({ ...r }));
  const confirmations = db.prepare("SELECT * FROM gap_confirmations").all().map((r) => ({ ...r }));
  assert.throws(() => db.prepare("INSERT INTO audit_log (at, event) VALUES (4, 'document_uploaded')").run(), /constraint/);

  // Up to version 5 only: this test is about that migration. Version 6 has its own test.
  migrate(db, MIGRATIONS.slice(0, 5));
  assert.equal(schemaVersion(db), 5);
  assert.deepEqual(db.prepare("SELECT * FROM audit_log ORDER BY id").all().map((r) => ({ ...r })), before, "entries copied unchanged");
  assert.deepEqual(db.prepare("SELECT * FROM gap_confirmations").all().map((r) => ({ ...r })), confirmations);
  for (const event of DOCUMENT_EVENTS) db.prepare("INSERT INTO audit_log (at, event) VALUES (4, ?)").run(event);
  assert.equal(Number(db.prepare("SELECT MAX(id) AS id FROM audit_log").get()!.id), before.length + DOCUMENT_EVENTS.length, "ids keep counting");
  assert.throws(() => db.prepare("UPDATE audit_log SET event = 'logout'").run(), /append-only/);
  assert.throws(() => db.prepare("DELETE FROM audit_log").run(), /append-only/);
  for (const table of ["documents", "document_blobs", "document_pages", "document_links"]) {
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table), table);
  }
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name = 'idx_documents_dispute'").get());
});

test("the documents table refuses bad rows; a removed demo dispute takes its documents with it", () => {
  const db = openDatabase(":memory:");
  seedDemo(db, DEMO_ACCOUNTS, DEMO_DISPUTES, 1);
  const insert = (id: string, fields: Partial<Record<string, string | number>> = {}) => {
    const row = { account_id: "merchant-d", dispute_id: "DEMO-3001", display_name: "x.pdf", media_type: "application/pdf", byte_size: 10, sha256: id.slice(0, 1).repeat(64), status: "pending", ...fields };
    db.prepare(
      "INSERT INTO documents (id, account_id, dispute_id, display_name, media_type, byte_size, sha256, status, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)",
    ).run(id, row.account_id, row.dispute_id, row.display_name, row.media_type, row.byte_size, row.sha256, row.status);
  };
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  for (const [label, fields] of [
    ["short id", { id: "abc" }],
    ["HTML", { media_type: "text/html" }],
    ["SVG", { media_type: "image/svg+xml" }],
    ["empty", { byte_size: 0 }],
    ["over 5 MB", { byte_size: 5 * 1024 * 1024 + 1 }],
    ["no name", { display_name: "" }],
    ["long name", { display_name: "a".repeat(121) }],
    ["bad hash", { sha256: "abc" }],
    ["unknown status", { status: "verified" }],
    ["unknown account", { account_id: "nobody" }],
  ] as [string, Record<string, string | number>][]) {
    const { id: badId, ...rest } = fields;
    assert.throws(() => insert(String(badId ?? id(1)), rest), /constraint/i, label);
  }
  insert(id(2));
  assert.throws(() => db.prepare("INSERT INTO document_pages (document_id, page, text, text_sha256, method) VALUES (?, 21, 'x', ?, 'pdf_text')").run(id(2), "0".repeat(64)), /constraint/);
  assert.throws(() => db.prepare("INSERT INTO document_pages (document_id, page, text, text_sha256, method) VALUES (?, 1, 'x', ?, 'ocr')").run(id(2), "0".repeat(64)), /constraint/);
  assert.throws(() => db.prepare("INSERT INTO document_links (document_id, item_id, linked_at) VALUES (?, 'Bad-Item', 1)").run(id(2)), /constraint/);
  db.prepare("INSERT INTO document_blobs (document_id, bytes) VALUES (?, ?)").run(id(2), new Uint8Array([1, 2, 3]));
  assert.deepEqual(new Uint8Array(db.prepare("SELECT bytes FROM document_blobs").get()!.bytes as Uint8Array), new Uint8Array([1, 2, 3]));
  // A restart with the same demo files keeps the document; a dispute dropped from them removes it.
  seedDemo(db, DEMO_ACCOUNTS, DEMO_DISPUTES, 2);
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS n FROM documents").get()!.n), 1);
  const accounts = DEMO_ACCOUNTS.map((a) => ({ ...a, dispute_ids: a.dispute_ids.filter((d) => d !== "DEMO-3001") }));
  seedDemo(db, accounts, DEMO_DISPUTES.filter((d) => d.dispute_id !== "DEMO-3001"), 3);
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS n FROM documents").get()!.n), 0);
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS n FROM document_blobs").get()!.n), 0);
});

test("version 6: only a merchant with access to the dispute can own a document, and re-seeding keeps documents", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db, MIGRATIONS.slice(0, 5));
  seedDemo(db, DEMO_ACCOUNTS, DEMO_DISPUTES, 1);
  const raw = (docId: string, account: string, dispute: string, hash: string) =>
    db
      .prepare(
        "INSERT INTO documents (id, account_id, dispute_id, display_name, media_type, byte_size, sha256, status, uploaded_at) VALUES (?, ?, ?, 'x.pdf', 'application/pdf', 1, ?, 'pending', 1)",
      )
      .run(docId, account, dispute, hash.repeat(64));
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  raw(id(1), "merchant-a", "DEMO-1001", "a");
  const auditBefore = db.prepare("SELECT * FROM audit_log ORDER BY id").all().map((r) => ({ ...r }));

  migrate(db);
  assert.equal(schemaVersion(db), 6);
  assert.deepEqual(db.prepare("SELECT * FROM audit_log ORDER BY id").all().map((r) => ({ ...r })), auditBefore, "audit log unchanged");
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS n FROM documents").get()!.n), 1, "existing documents kept");

  // A merchant with access: allowed, directly and through the store.
  raw(id(2), "merchant-a", "DEMO-1002", "b");
  const doc = { account_id: "merchant-a", dispute_id: "DEMO-1001", display_name: "y.pdf", media_type: "application/pdf" as const, sha256: "c".repeat(64) };
  assert.equal(addDocument(db, 2, { id: id(3), ...doc }, new Uint8Array([0x25])).ok, true);
  // Refused by the trigger: no access row, a buyer with access, another merchant, admin, an unknown account.
  for (const [label, account, dispute] of [
    ["merchant without access", "merchant-a", "DEMO-1003"],
    ["buyer with access", "buyer-a", "DEMO-1001"],
    ["another merchant", "merchant-b", "DEMO-1001"],
    ["admin", "admin", "DEMO-1001"],
    ["unknown account", "nobody", "DEMO-1001"],
  ]) {
    assert.throws(() => raw(id(9), account, dispute, "d"), /document owner constraint failed/, label);
  }
  // The store's insert is refused too, and its transaction rolls back (no blob, no audit row).
  const auditRows = () => Number(db.prepare("SELECT COUNT(*) AS n FROM audit_log").get()!.n);
  const rowsBefore = auditRows();
  assert.throws(() => addDocument(db, 3, { id: id(4), ...doc, account_id: "merchant-b", sha256: "e".repeat(64) }, new Uint8Array([0x25])), /document owner/);
  assert.equal(auditRows(), rowsBefore);
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS n FROM document_blobs WHERE document_id = ?").get(id(4))!.n), 0);

  // Restarts delete and re-grant access rows; documents stay, and so does the trigger.
  seedDemo(db, DEMO_ACCOUNTS, DEMO_DISPUTES, 4);
  seedDemo(db, DEMO_ACCOUNTS, DEMO_DISPUTES, 5);
  assert.equal(Number(db.prepare("SELECT COUNT(*) AS n FROM documents").get()!.n), 3);
  assert.throws(() => raw(id(9), "merchant-b", "DEMO-1001", "d"), /document owner constraint failed/);
});
