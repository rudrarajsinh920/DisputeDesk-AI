import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

// Repo-root .env, found from this file's location so the shell's folder never matters.
export const ENV_PATH = fileURLToPath(new URL("../../.env", import.meta.url));

export interface Config {
  port: number;
  paypal: { clientId: string; clientSecret: string } | null;
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
  return { port, paypal: clientId && clientSecret ? { clientId, clientSecret } : null };
}
