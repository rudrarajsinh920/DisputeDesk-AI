import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

// Repo-root .env, found from this file's location so the shell's folder never matters.
export const ENV_PATH = fileURLToPath(new URL("../../.env", import.meta.url));

// Google's model list (checked 2026-10-29) suggests "3.5 Flash-Lite or 3.8 Flash" for new projects.
export const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";

export interface Config {
  port: number;
  paypal: { clientId: string; clientSecret: string } | null;
  // null when GEMINI_API_KEY is not set; AI drafting is then off and everything else still works.
  ai: { apiKey: string; model: string } | null;
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

  const clientId = get("PAYPAL_CLIENT_ID");
  const clientSecret = get("PAYPAL_CLIENT_SECRET");
  const apiKey = get("GEMINI_API_KEY");
  const model = get("GEMINI_MODEL") ?? DEFAULT_GEMINI_MODEL;
  // The model code goes into the request URL, so only plain model codes are accepted.
  if (!/^[a-z0-9][a-z0-9.-]{0,63}$/.test(model)) {
    throw new Error("GEMINI_MODEL must be a model code such as gemini-3.5-flash-lite.");
  }

  return {
    port,
    paypal: clientId && clientSecret ? { clientId, clientSecret } : null,
    ai: apiKey ? { apiKey, model } : null,
  };
}
