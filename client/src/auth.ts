import type { AccountInfo } from "../../shared/types.ts";
import { serverError } from "./sandbox.ts";

// The session lives in an HttpOnly cookie the page can't read; same-origin fetches send it automatically.

const ROLES = ["merchant", "buyer", "admin"];

function readAccount(body: unknown): AccountInfo {
  const account = (body as { account?: Partial<AccountInfo> } | null)?.account;
  if (!account || typeof account.id !== "string" || typeof account.display_name !== "string" || !ROLES.includes(account.role as string)) {
    throw new Error("The DisputeDesk server sent an unexpected response.");
  }
  return account as AccountInfo;
}

// null when nobody is signed in; throws when the server can't be reached.
export async function fetchMe(signal?: AbortSignal): Promise<AccountInfo | null> {
  const response = await fetch("/api/auth/me", { signal });
  if (response.status === 401) return null;
  const body = await response.json().catch(() => null);
  if (!response.ok) throw serverError(response, body);
  return readAccount(body);
}

export async function signIn(email: string, password: string): Promise<AccountInfo> {
  const response = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw serverError(response, body);
  return readAccount(body);
}

// The server clears the cookie even if the session already ended.
export async function signOut(): Promise<void> {
  await fetch("/api/auth/logout", { method: "POST" });
}
