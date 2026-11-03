import { createApp } from "./app.ts";
import { ENV_PATH, loadConfig } from "./config.ts";
import { createGeminiClient } from "./gemini.ts";
import { createPayPalClient } from "./paypal.ts";

const config = loadConfig();
const app = createApp(
  config.paypal ? createPayPalClient(config.paypal) : null,
  config.ai ? createGeminiClient(config.ai) : null,
  config.aiOff ?? undefined,
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
});
