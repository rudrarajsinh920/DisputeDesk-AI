import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { AccountInfo, Dispute } from "../../shared/types.ts";

// Server-only account record. password_hash and dispute_ids never leave the server.
export interface Account extends AccountInfo {
  password_hash: string;
  dispute_ids: string[];
}

// ---- Passwords: scrypt from node:crypto, random salt, constant-time compare ----

const SCRYPT = { N: 16384, r: 8, p: 1 };
const KEY_LENGTH = 32;
const HASH_FORMAT = /^scrypt\$(\d+)\$(\d+)\$(\d+)\$([A-Za-z0-9+/=]+)\$([A-Za-z0-9+/=]+)$/;

function derive(password: string, salt: Buffer, length: number, { N, r, p }: typeof SCRYPT): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, length, { N, r, p, maxmem: 64 * 1024 * 1024 }, (error, key) => (error ? reject(error) : resolve(key))),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, KEY_LENGTH, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

// False for a wrong password and for any malformed stored value.
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const match = HASH_FORMAT.exec(stored);
  if (!match) return false;
  const expected = Buffer.from(match[5], "base64");
  if (expected.length < 16) return false;
  try {
    const params = { N: Number(match[1]), r: Number(match[2]), p: Number(match[3]) };
    const key = await derive(password, Buffer.from(match[4], "base64"), expected.length, params);
    return timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}

// ---- Sessions ----

export const IDLE_MS = 30 * 60_000;
export const ABSOLUTE_MS = 8 * 60 * 60_000;
export const SESSION_COOKIE = "__Host-dd_session";

// shortcut: in-memory, one server process; a restart signs everyone out. Move to node:sqlite with the dispute store.
export function createSessions(now: () => number = Date.now) {
  // Keyed by a hash of the token, so the store itself holds nothing a browser could replay.
  const store = new Map<string, { accountId: string; created: number; seen: number }>();
  const key = (token: string) => createHash("sha256").update(token).digest("base64url");
  const expired = (s: { created: number; seen: number }, t: number) => t - s.seen > IDLE_MS || t - s.created > ABSOLUTE_MS;

  return {
    create(accountId: string): string {
      const t = now();
      for (const [k, s] of store) if (expired(s, t)) store.delete(k);
      const token = randomBytes(32).toString("base64url");
      store.set(key(token), { accountId, created: t, seen: t });
      return token;
    },
    get(token: string): string | null {
      if (!token) return null;
      const k = key(token);
      const session = store.get(k);
      if (!session) return null;
      const t = now();
      if (expired(session, t)) {
        store.delete(k);
        return null;
      }
      session.seen = t;
      return session.accountId;
    },
    delete(token: string) {
      store.delete(key(token));
    },
  };
}

// __Host- makes browsers require Secure, Path=/ and no Domain, so the cookie stays on the exact host that set it.
const COOKIE_FLAGS = "Path=/; Max-Age=%s; HttpOnly; Secure; SameSite=Strict";
export const sessionCookie = (token: string) => `${SESSION_COOKIE}=${token}; ${COOKIE_FLAGS.replace("%s", String(ABSOLUTE_MS / 1000))}`;
export const clearSessionCookie = () => `${SESSION_COOKIE}=; ${COOKIE_FLAGS.replace("%s", "0")}`;

export function readCookie(header: string | undefined, name: string): string | null {
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

// ---- Login attempt limit ----

export const LOGIN_MAX_FAILURES = 10;
export const LOGIN_WINDOW_MS = 15 * 60_000;

// shortcut: in-memory, one server process; keys are only added on failed logins. Use a shared store with more processes.
export function createLoginLimiter(now: () => number = Date.now) {
  const failures = new Map<string, number[]>();
  const recent = (key: string) => {
    const list = (failures.get(key) ?? []).filter((t) => now() - t <= LOGIN_WINDOW_MS);
    if (list.length > 0) failures.set(key, list);
    else failures.delete(key);
    return list;
  };
  return {
    blocked: (keys: string[]) => keys.some((k) => recent(k).length >= LOGIN_MAX_FAILURES),
    fail: (keys: string[]) => {
      for (const k of keys) failures.set(k, [...recent(k), now()]);
    },
    reset: (key: string) => {
      failures.delete(key);
    },
  };
}

// ---- Authorization ----

// Admin reads everything. Merchants and buyers reach only disputes listed on their account;
// sandbox disputes belong to the merchant whose PayPal app the server uses.
export function canAccess(account: Account, dispute: Dispute): boolean {
  if (account.role === "admin") return true;
  if (dispute.source === "paypal_sandbox") return account.role === "merchant" && account.paypal_sandbox;
  return account.dispute_ids.includes(dispute.dispute_id);
}

export const toAccountInfo = ({ id, email, role, display_name, paypal_sandbox }: Account): AccountInfo => ({
  id,
  email,
  role,
  display_name,
  paypal_sandbox,
});

const ROLES = new Set(["merchant", "buyer", "admin"]);
const ACCOUNT_ID = /^[a-z0-9-]{1,40}$/;
const EMAIL = /^[a-z0-9._+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;

// Returns every problem; the server refuses to start on any.
export function validateAccounts(accounts: Account[], disputeIds: string[]): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const emails = new Set<string>();
  for (const a of accounts) {
    const name = typeof a.id === "string" ? a.id : "?";
    if (typeof a.id !== "string" || !ACCOUNT_ID.test(a.id)) errors.push(`${name}: id must be lowercase letters, digits or hyphens.`);
    else if (ids.has(a.id)) errors.push(`duplicate id ${a.id}.`);
    ids.add(a.id);
    if (typeof a.email !== "string" || !EMAIL.test(a.email)) errors.push(`${name}: email must be a lowercase address.`);
    else if (emails.has(a.email)) errors.push(`duplicate email ${a.email}.`);
    emails.add(a.email);
    if (!ROLES.has(a.role)) errors.push(`${name}: role must be merchant, buyer or admin.`);
    if (typeof a.display_name !== "string" || a.display_name.trim() === "") errors.push(`${name}: display_name is required.`);
    if (typeof a.paypal_sandbox !== "boolean") errors.push(`${name}: paypal_sandbox must be true or false.`);
    else if (a.paypal_sandbox && a.role !== "merchant") errors.push(`${name}: only merchants can have PayPal sandbox access.`);
    if (!Array.isArray(a.dispute_ids)) errors.push(`${name}: dispute_ids must be a list.`);
    else for (const id of a.dispute_ids) if (!disputeIds.includes(id)) errors.push(`${name}: unknown dispute ${String(id)}.`);
    if (typeof a.password_hash !== "string" || !HASH_FORMAT.test(a.password_hash)) errors.push(`${name}: password_hash must be an scrypt hash.`);
  }
  return errors;
}
