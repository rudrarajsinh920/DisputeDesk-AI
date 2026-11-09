import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DEMO_ACCOUNTS, DEMO_DISPUTES } from "./app.ts";
import { DatabaseSync } from "node:sqlite";
import { MIGRATIONS, migrate, openDatabase, schemaVersion } from "./db.ts";
import { audit, confirmGap, createAccount, findAccountByEmail, getAccount, listAccounts, listConfirmations, loadDisputes, seedDemo, withdrawGap } from "./store.ts";
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
  migrate(db);
  assert.equal(schemaVersion(db), 4);
  assert.deepEqual(db.prepare("SELECT * FROM audit_log ORDER BY id").all().map((r) => ({ ...r })), before, "entries copied unchanged");
  for (const event of ["gap_confirmed", "gap_confirmation_withdrawn"]) db.prepare("INSERT INTO audit_log (at, event) VALUES (2, ?)").run(event);
  assert.throws(() => db.prepare("DELETE FROM audit_log").run(), /append-only/);
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name = 'gap_confirmations'").get());
});
