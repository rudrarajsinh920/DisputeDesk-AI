import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ABSOLUTE_MS,
  IDLE_MS,
  LOGIN_MAX_FAILURES,
  LOGIN_MAX_FAILURES_PER_ADDRESS,
  LOGIN_WINDOW_MS,
  SESSION_COOKIE,
  canAccess,
  clearSessionCookie,
  createLoginLimiter,
  createSessions,
  hashPassword,
  readCookie,
  sessionCookie,
  validateAccounts,
  verifyPassword,
} from "./auth.ts";
import type { Account } from "./auth.ts";
import type { Dispute } from "../../shared/types.ts";

test("passwords are stored as salted scrypt hashes and verified exactly", async () => {
  const hash = await hashPassword("correct horse");
  assert.match(hash, /^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  assert.ok(!hash.includes("correct horse"));
  assert.equal(await verifyPassword("correct horse", hash), true);
  assert.equal(await verifyPassword("correct horsE", hash), false);
  assert.equal(await verifyPassword("", hash), false);
  assert.notEqual(await hashPassword("correct horse"), hash, "a new salt every time");
  for (const broken of ["", "plain-text", "bcrypt$1$2$3$a$b", "scrypt$16384$8$1$$"]) {
    assert.equal(await verifyPassword("correct horse", broken), false, broken);
  }
});

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

test("a session finds its account until it is deleted", () => {
  const sessions = createSessions(clock().now);
  const token = sessions.create("merchant-a");
  assert.equal(sessions.get(token), "merchant-a");
  assert.equal(sessions.get(token + "x"), null);
  assert.equal(sessions.get(""), null);
  assert.notEqual(sessions.create("merchant-a"), token, "every login gets a new token");
  sessions.delete(token);
  assert.equal(sessions.get(token), null);
});

test("sessions end after 30 idle minutes, and activity keeps them alive", () => {
  const c = clock();
  const sessions = createSessions(c.now);
  const idle = sessions.create("buyer-a");
  const busy = sessions.create("buyer-a");
  c.advance(IDLE_MS - 1);
  assert.equal(sessions.get(busy), "buyer-a");
  c.advance(2);
  assert.equal(sessions.get(idle), null, "idle session expired");
  assert.equal(sessions.get(busy), "buyer-a", "used 2 ms ago");
  assert.equal(sessions.get(idle), null, "an expired session stays gone");
});

test("sessions end 8 hours after login even when used constantly", () => {
  const c = clock();
  const sessions = createSessions(c.now);
  const token = sessions.create("admin");
  for (let t = 0; t < ABSOLUTE_MS - IDLE_MS; t += IDLE_MS / 2) {
    c.advance(IDLE_MS / 2);
    assert.equal(sessions.get(token), "admin");
  }
  c.advance(IDLE_MS / 2);
  assert.equal(sessions.get(token), "admin", "7 h 45 min after login");
  // Used 15 minutes ago, so only the 8-hour limit can end it.
  c.advance(IDLE_MS / 2 + 1);
  assert.equal(sessions.get(token), null);
});

test("the session cookie is HttpOnly, Secure, SameSite=Strict and host-only", () => {
  assert.equal(SESSION_COOKIE, "__Host-dd_session");
  assert.equal(sessionCookie("abc"), `__Host-dd_session=abc; Path=/; Max-Age=${ABSOLUTE_MS / 1000}; HttpOnly; Secure; SameSite=Strict`);
  assert.equal(clearSessionCookie(), "__Host-dd_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict");
  assert.ok(!sessionCookie("abc").includes("Domain"));
});

test("readCookie finds one cookie by exact name", () => {
  assert.equal(readCookie("a=1; __Host-dd_session=tok; b=2", SESSION_COOKIE), "tok");
  assert.equal(readCookie("x__Host-dd_session=evil", SESSION_COOKIE), null);
  assert.equal(readCookie(undefined, SESSION_COOKIE), null);
  assert.equal(readCookie("", SESSION_COOKIE), null);
});

test("login attempts are limited per key, and the limit lifts after the window", () => {
  const c = clock();
  const limiter = createLoginLimiter(c.now);
  const keys = ["email:a@demo.test", "ip:127.0.0.1"];
  for (let i = 0; i < LOGIN_MAX_FAILURES; i++) {
    assert.equal(limiter.blocked(keys), false, `attempt ${i + 1}`);
    limiter.fail(keys);
  }
  assert.equal(limiter.blocked(keys), true);
  assert.equal(limiter.blocked(["email:b@demo.test", "ip:127.0.0.1"]), true, "the IP is limited too");
  assert.equal(limiter.blocked(["email:a@demo.test", "ip:10.0.0.9"]), true, "and the email");
  c.advance(LOGIN_WINDOW_MS + 1);
  assert.equal(limiter.blocked(keys), false);
  limiter.fail(keys);
  limiter.reset("email:a@demo.test");
  assert.equal(limiter.blocked(["email:a@demo.test"]), false);
});

test("a key can have its own, higher limit, and expired failures are dropped from memory", () => {
  const c = clock();
  const limiter = createLoginLimiter(c.now);
  for (let i = 0; i < LOGIN_MAX_FAILURES; i++) limiter.fail(["ip:127.0.0.1"]);
  assert.equal(limiter.blocked(["ip:127.0.0.1"]), true, "the default limit");
  assert.equal(limiter.blocked(["ip:127.0.0.1"], LOGIN_MAX_FAILURES_PER_ADDRESS), false, "under the address limit");
  for (let i = LOGIN_MAX_FAILURES; i < LOGIN_MAX_FAILURES_PER_ADDRESS; i++) limiter.fail(["ip:127.0.0.1"]);
  assert.equal(limiter.blocked(["ip:127.0.0.1"], LOGIN_MAX_FAILURES_PER_ADDRESS), true);

  for (let i = 0; i < 50; i++) limiter.fail([`email:guess-${i}@demo.test`]);
  assert.equal(limiter.size(), 51);
  c.advance(LOGIN_WINDOW_MS + 1);
  limiter.fail(["email:late@demo.test"]);
  assert.equal(limiter.size(), 1, "only the new failure is kept");
});

const account = (over: Partial<Account>): Account => ({
  id: "x",
  email: "x@demo.disputedesk.test",
  role: "merchant",
  display_name: "X",
  paypal_sandbox: false,
  dispute_ids: [],
  password_hash: "scrypt$16384$8$1$c2FsdA==$aGFzaA==",
  ...over,
});
const demo = (id: string) => ({ source: "demo", dispute_id: id }) as Dispute;
const sandbox = (id: string) => ({ source: "paypal_sandbox", dispute_id: id }) as Dispute;

test("accounts reach only their own disputes; admin reaches all", () => {
  const merchantA = account({ id: "ma", dispute_ids: ["DEMO-1001"], paypal_sandbox: true });
  const merchantB = account({ id: "mb", dispute_ids: ["DEMO-1003"] });
  const buyer = account({ id: "b", role: "buyer", dispute_ids: ["DEMO-1001"] });
  const admin = account({ id: "ad", role: "admin" });

  assert.equal(canAccess(merchantA, demo("DEMO-1001")), true);
  assert.equal(canAccess(merchantA, demo("DEMO-1003")), false);
  assert.equal(canAccess(merchantB, demo("DEMO-1001")), false);
  assert.equal(canAccess(buyer, demo("DEMO-1001")), true);
  assert.equal(canAccess(buyer, demo("DEMO-1003")), false);
  assert.equal(canAccess(merchantA, sandbox("PP-1")), true);
  assert.equal(canAccess(merchantB, sandbox("PP-1")), false);
  assert.equal(canAccess(buyer, sandbox("PP-1")), false);
  // A sandbox dispute that reuses a demo ID is still only reachable through sandbox access.
  assert.equal(canAccess(merchantB, sandbox("DEMO-1003")), false);
  for (const d of [demo("DEMO-1001"), demo("DEMO-1003"), sandbox("PP-1")]) assert.equal(canAccess(admin, d), true);
});

test("the account list is checked at startup", () => {
  const ids = ["DEMO-1001", "DEMO-1003"];
  const good = [account({ id: "a", email: "a@demo.disputedesk.test" }), account({ id: "b", email: "b@demo.disputedesk.test", role: "buyer" })];
  assert.deepEqual(validateAccounts(good, ids), []);

  const errors = validateAccounts(
    [
      account({ id: "a", email: "a@demo.disputedesk.test" }),
      account({ id: "a", email: "a@demo.disputedesk.test" }),
      account({ id: "c", email: "c@demo.disputedesk.test", role: "owner" as Account["role"] }),
      account({ id: "d", email: "d@demo.disputedesk.test", dispute_ids: ["DEMO-9999"] }),
      account({ id: "e", email: "e@demo.disputedesk.test", password_hash: "hunter2" }),
      account({ id: "f", email: "F@demo.disputedesk.test" }),
      account({ id: "g", email: "g@demo.disputedesk.test", role: "buyer", paypal_sandbox: true }),
    ],
    ids,
  ).join(" ");
  for (const expected of [/duplicate id a/, /duplicate email/, /c: role/, /d: unknown dispute DEMO-9999/, /e: password_hash/, /f: email/, /g: only merchants/]) {
    assert.match(errors, expected);
  }
});
