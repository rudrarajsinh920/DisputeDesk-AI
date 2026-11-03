import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DEMO_ACCOUNTS, DEMO_DISPUTES } from "./app.ts";
import { openDatabase } from "./db.ts";
import { audit, createAccount, findAccountByEmail, getAccount, listAccounts, loadDisputes, seedDemo } from "./store.ts";
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
      id: "merchant-c",
      email: "merchant-c@demo.disputedesk.test",
      role: "merchant",
      display_name: "Demo Merchant C",
      paypal_sandbox: false,
      dispute_ids: ["DEMO-1003"],
      password_hash: HASH,
    };
    createAccount(first, account, 1);
    first.close();
    const second = openDatabase(path);
    assert.deepEqual(getAccount(second, "merchant-c"), account);
    second.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("creating an account is all or nothing", () => {
  const db = seeded();
  const bad: Account = { ...DEMO_ACCOUNTS[1], id: "merchant-c", email: "merchant-c@demo.disputedesk.test", dispute_ids: ["DEMO-1001", "DEMO-404"] };
  assert.throws(() => createAccount(db, bad, 1), /FOREIGN KEY/);
  assert.equal(getAccount(db, "merchant-c"), null, "the account row was rolled back with its access");
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
    .map((a) => ({ ...a, dispute_ids: a.dispute_ids.filter((id) => id !== "DEMO-1003") }))
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
