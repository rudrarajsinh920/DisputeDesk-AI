import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

// Repo-root .env, found from this file's location so the shell's folder never matters.
export const ENV_PATH = fileURLToPath(new URL("../../.env", import.meta.url));

// The server's SQLite database. Override with the DATABASE_PATH shell variable. Gitignored: it holds password hashes.
export const DEFAULT_DATABASE_PATH = fileURLToPath(new URL("../data/disputedesk.sqlite", import.meta.url));

// Google's model list (checked 2026-10-29) suggests "3.5 Flash-Lite or 3.8 Flash" for new projects.
export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";

// Why AI drafting is off. Safe to show and log: they never include a configured value.
export const AI_OFF_NO_KEY = "GEMINI_API_KEY is not set on the server.";
export const AI_OFF_BAD_MODEL = "GEMINI_MODEL is not a valid model code, such as gemini-3.5-flash-lite.";

export interface Config {
  port: number;
  paypal: { clientId: string; clientSecret: string } | null;
  // null when Gemini is not usable; AI drafting is then off and everything else still works.
  ai: { apiKey: string; model: string } | null;
  // The reason when ai is null.
  aiOff: string | null;
  // Reverse proxies in front of the server, so sign-in limits key on the real client address. 0 (default): none.
  trustProxy: number;
}

// Reads .env without copying secrets into process.env. Shell variables win, as with dotenv.
export function loadConfig(envPath: string = ENV_PATH, env: NodeJS.ProcessEnv = process.env): Config {
  let file: NodeJS.Dict<string> = {};
  try {
    file = parseEnv(readFileSync(envPath, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const get = (key: string) => env[key] || file[key] || undefined;

  const port = Number(get("PORT") ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be a whole number between 1 and 65535.");
  }

  // Set only when a proxy you control adds X-Forwarded-For. Otherwise anyone could pick their own address with it.
  const trustProxy = Number(get("TRUST_PROXY") ?? 0);
  if (!Number.isInteger(trustProxy) || trustProxy < 0 || trustProxy > 10) {
    throw new Error("TRUST_PROXY must be a whole number of proxies between 0 and 10.");
  }

  const clientId = get("PAYPAL_CLIENT_ID");
  const clientSecret = get("PAYPAL_CLIENT_SECRET");
  const apiKey = get("GEMINI_API_KEY");
  const model = get("GEMINI_MODEL") ?? DEFAULT_GEMINI_MODEL;
  // The model code goes into the request URL, so only plain model codes are accepted.
  // An invalid one turns AI drafting off instead of stopping the server; no other model is picked in its place.
  const aiOff = !apiKey ? AI_OFF_NO_KEY : !/^[a-z0-9][a-z0-9.-]{0,63}$/.test(model) ? AI_OFF_BAD_MODEL : null;

  return {
    port,
    paypal: clientId && clientSecret ? { clientId, clientSecret } : null,
    ai: apiKey && !aiOff ? { apiKey, model } : null,
    aiOff,
    trustProxy,
  };
}
