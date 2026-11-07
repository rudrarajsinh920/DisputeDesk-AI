import { createApp } from "./app.ts";
import { DEFAULT_DATABASE_PATH, ENV_PATH, loadConfig } from "./config.ts";
import { openDatabase } from "./db.ts";
import { createGeminiClient } from "./gemini.ts";
import { createPayPalClient } from "./paypal.ts";

const config = loadConfig();
// A failed migration or a database from a newer server stops startup here, before anything is served.
const databasePath = process.env.DATABASE_PATH || DEFAULT_DATABASE_PATH;
let db: ReturnType<typeof openDatabase>;
try {
  db = openDatabase(databasePath);
} catch (error) {
  // One plain line instead of a stack trace. The path is not a secret; no .env value is printed.
  console.error(`Could not open the database at ${databasePath}: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
const app = createApp(
  config.paypal ? createPayPalClient(config.paypal) : null,
  config.ai ? createGeminiClient(config.ai) : null,
  config.aiOff ?? undefined,
  { db, trustProxy: config.trustProxy },
);

// Localhost only: this server holds PayPal credentials, and its accounts are synthetic demo accounts.
app.listen(config.port, "127.0.0.1", (error?: Error) => {
  if (error) {
    console.error(`Could not start server: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  const paypal = config.paypal ? "configured" : `not configured (add credentials to ${ENV_PATH})`;
  const ai = config.ai ? `on (${config.ai.model})` : `off (${config.aiOff})`;
  console.log(`DisputeDesk server on http://127.0.0.1:${config.port}. PayPal sandbox: ${paypal}. AI drafting: ${ai}.`);
  // The audit log is append-only and is never trimmed; this makes its growth visible (archive by copying the file).
  const auditRows = Number(db.prepare("SELECT COUNT(*) AS n FROM audit_log").get()!.n);
  console.log(`Audit log: ${auditRows} entries in ${databasePath}.`);
});
